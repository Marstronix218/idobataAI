import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The rule that a persona only ever answers a human, and only the human who
 * answered it, is enforced by a database trigger rather than by application
 * code: a reply can be written by the route, by a job, or by a future surface,
 * and all of them insert into the same table. These assertions guard the parts
 * of that trigger whose removal would be invisible until an AI-to-AI loop or a
 * duplicated response appeared in production.
 */
const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260830090000_persona_thread_conversations.sql"),
  "utf8",
);

// The guarantee and public-conversation cap are the latest definitions of the
// post and reply triggers, so contract assertions for the current policy read
// the migration that replaces both functions.
const guaranteedConversations = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260908010000_guaranteed_persona_conversations.sql"),
  "utf8",
);

// `create_social_notification` was redefined again to hold the new kind behind a
// flag, so its assertions read the later file: the last definition wins.
const notificationRollout = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260830100000_thread_reply_notification_rollout.sql"),
  "utf8",
);

function triggerBody() {
  const start = guaranteedConversations.indexOf("create or replace function public.enqueue_human_reply_engagements()");
  expect(start).toBeGreaterThan(-1);
  return guaranteedConversations.slice(start, guaranteedConversations.indexOf("$$;", start));
}

function latestFunctionBody(functionName: "enqueue_human_post_engagements" | "enqueue_human_reply_engagements" | "finalize_social_action") {
  const declaration = functionName === "finalize_social_action"
    ? "create or replace function public.finalize_social_action("
    : `create or replace function public.${functionName}()`;
  const start = guaranteedConversations.indexOf(declaration);
  expect(start).toBeGreaterThan(-1);
  return guaranteedConversations.slice(start, guaranteedConversations.indexOf("$$;", start));
}

describe("guaranteed persona conversations", () => {
  it("guarantees one persona reply for up to four active human posts in a rolling 24-hour window", () => {
    const body = latestFunctionBody("enqueue_human_post_engagements");

    expect(body).toContain("if new.author_id is null or new.companion_id is not null or new.is_ai_generated then return new; end if;");
    expect(body).toContain("if new.content_status <> 'active' then return new; end if;");
    expect(body).toContain("engagement.source='human_post_guarantee'");
    expect(body).toContain("engagement.created_at>=now()-interval '24 hours'");
    expect(body).toContain("public.app_tuning_value('AI_POST_GUARANTEED_REPLIES_PER_USER_DAY',4)");
    expect(body).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(body).toContain("'human-post:reply:'||new.id,'human_post_guarantee','reply'");
    expect(body).toContain("jsonb_build_object('guaranteed',true,'reply_due_at',now()+interval '1 hour')");
  });

  it("does not treat notification preferences as permission to suppress a promised reply", () => {
    const postBody = latestFunctionBody("enqueue_human_post_engagements");
    const replyBody = latestFunctionBody("enqueue_human_reply_engagements");
    const finalizerBody = latestFunctionBody("finalize_social_action");

    expect(postBody).not.toContain("notification_preferences");
    expect(replyBody).not.toContain("notification_preferences");
    expect(finalizerBody).not.toContain("notification_preferences");
    expect(postBody).toContain("public.muted_companions");
    expect(replyBody).toContain("public.muted_companions");
  });

  it("guarantees every eligible direct human follow-up immediately with a one-hour due time", () => {
    const body = latestFunctionBody("enqueue_human_reply_engagements");

    expect(body).toContain("from public.social_replies reply where reply.id=new.parent_reply_id");
    expect(body).toContain("from public.social_posts post where post.id=new.post_id");
    expect(body).not.toContain("AI_THREAD_REPLY_PROBABILITY");
    expect(body).toContain("'human-reply:response:'||new.id,'human_reply_response','reply'");
    expect(body).toContain("new.post_id,target_companion,new.id,now()");
    expect(body).toContain("'guaranteed',true");
    expect(body).toContain("'reply_due_at',new.created_at+interval '1 hour'");
  });

  it("stops the public branch after six turns from the addressed persona", () => {
    const body = latestFunctionBody("enqueue_human_reply_engagements");

    expect(guaranteedConversations).toContain("('AI_THREAD_MAX_PERSONA_REPLIES', 6,");
    expect(body).toContain("where reply.id<>new.id and reply.companion_id=target_companion");
    expect(body).toContain("prior_persona_turns >= public.app_tuning_value('AI_THREAD_MAX_PERSONA_REPLIES',6)");
    expect(body).toContain("skip_reason := 'public thread reply limit reached'");
  });

  it("finalizes replies without silently creating a persona relationship", () => {
    const body = latestFunctionBody("finalize_social_action");

    expect(body).toContain("insert into public.social_replies");
    expect(body).not.toContain("insert into public.user_companion_relationships");
    expect(body).not.toContain("kind='follow'");
  });
});

describe("human reply engagement trigger", () => {
  it("refuses to act on anything a persona wrote, so AI cannot answer AI", () => {
    expect(triggerBody()).toContain(
      "if new.author_id is null or new.companion_id is not null or new.is_ai_generated then return new; end if;",
    );
  });

  it("responds as the persona that was answered, never as another character", () => {
    const body = triggerBody();
    expect(body).toContain("select reply.companion_id into target_companion");
    expect(body).toContain("from public.social_replies reply where reply.id=new.parent_reply_id");
    // No companion on the parent means the human answered a human, or commented
    // under a human's post: nothing is queued at all.
    expect(body).toContain("if target_companion is null");
    expect(body).toContain("then return new; end if;");
  });

  it("keys the follow-up on the human reply, so one reply can only ever produce one response", () => {
    expect(triggerBody()).toContain("'human-reply:response:'||new.id");
  });

  it("honours mutes and both kill switches without treating notification preferences as consent", () => {
    const body = triggerBody();
    expect(body).toContain("public.muted_companions");
    expect(body).not.toContain("notification_preferences");
    expect(body).toContain("feature_flag_enabled('AI_PERSONA_THREAD_REPLIES')");
    expect(body).toContain("feature_flag_enabled('AI_PERSONA_REPLIES')");
  });

  it("caps thread depth and public persona turns", () => {
    const body = triggerBody();
    expect(body).toContain("public.app_tuning_value('AI_THREAD_MAX_DEPTH',40)");
    expect(body).toContain("public.app_tuning_value('AI_THREAD_MAX_PERSONA_REPLIES',6)");
    expect(body).not.toContain("AI_THREAD_MAX_PERSONA_REPLIES_PER_DAY");
    expect(body).not.toContain("AI_THREAD_MAX_ACTIVE_PER_USER");
  });

  it("records the funnel without recording what anyone wrote", () => {
    const body = triggerBody();
    expect(body).toContain("'user_replied_to_ai'");
    expect(body).toContain("'ai_thread_conversation_continued'");
    expect(body).toContain("'ai_thread_conversation_started'");
    expect(body).not.toMatch(/capture_beta_product_event\([^)]*content/);
  });
});

describe("reply notifications", () => {
  function notificationBody() {
    const start = notificationRollout.indexOf("create or replace function public.create_social_notification()");
    expect(start).toBeGreaterThan(-1);
    return notificationRollout.slice(start, notificationRollout.indexOf("$$;", start));
  }

  it("tells the person who was answered, not only the post author", () => {
    const body = notificationBody();
    expect(body).toContain("values(parent_author,new.author_id,new.companion_id,new.post_id,new.id,answered_kind)");
  });

  it("says a character answered you when it answered your own reply", () => {
    expect(notificationBody()).toContain(
      "post_author_kind := case when parent_author is not null and parent_author = target_user then answered_kind else 'reply' end;",
    );
  });

  it("holds the new kind behind a flag so a client that predates it is never sent one", () => {
    const body = notificationBody();
    expect(body).toContain(
      "answered_kind := case when public.feature_flag_enabled('THREAD_REPLY_NOTIFICATIONS') then 'thread_reply' else 'reply' end;",
    );
    // Seeded off: the database may lead the deployed client, never the reverse.
    expect(notificationRollout).toContain("('THREAD_REPLY_NOTIFICATIONS', false,");
  });

  it("never writes the same person two rows for one reply", () => {
    const body = notificationBody();
    expect(body).toContain("parent_author is distinct from target_user");
    expect(body).toContain("not exists(select 1 from public.notifications existing");
  });

  it("never notifies someone about their own reply", () => {
    expect(notificationBody()).toContain("parent_author is distinct from new.author_id");
  });
});

describe("thread conversation context", () => {
  it("is limited to the ancestors of the reply being answered", () => {
    const start = migration.indexOf("create or replace function public.get_reply_thread_context");
    const body = migration.slice(start, migration.indexOf("$$;", start));
    expect(body).toContain("public.reply_thread_path(p_reply_id)");
    // Sibling branches are never joined in, which is what keeps two personas
    // replying to one post from reading each other's conversation.
    expect(body).not.toContain("where reply.post_id");
  });

  it("is reachable only by the service role", () => {
    expect(migration).toContain("revoke all on function");
    expect(migration).toContain("public.get_reply_thread_context(uuid,integer)");
    expect(migration).toMatch(/grant execute on function[\s\S]*get_reply_thread_context\(uuid,integer\)\s*\n\s*to service_role;/);
  });
});
