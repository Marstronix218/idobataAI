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

// `create_social_notification` was redefined again to hold the new kind behind a
// flag, so its assertions read the later file: the last definition wins.
const notificationRollout = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260830100000_thread_reply_notification_rollout.sql"),
  "utf8",
);

function triggerBody() {
  const start = migration.indexOf("create or replace function public.enqueue_human_reply_engagements()");
  expect(start).toBeGreaterThan(-1);
  return migration.slice(start, migration.indexOf("$$;", start));
}

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
    expect(migration).toContain("-- One engagement row per human reply, keyed on that reply");
  });

  it("rolls a probability that is deterministic in the reply id", () => {
    const body = triggerBody();
    expect(body).toContain("public.app_tuning_value('AI_THREAD_REPLY_PROBABILITY', 1.0)");
    expect(body).toContain("hashtextextended(new.id::text || ':thread-reply', 0) & 1073741823::bigint");
    expect(body).toContain("elsif roll >= probability then skip_reason := 'probability roll declined'");
  });

  it("honours the mute, the notification preference, and both kill switches", () => {
    const body = triggerBody();
    expect(body).toContain("public.muted_companions");
    expect(body).toContain("companion_activity");
    expect(body).toContain("feature_flag_enabled('AI_PERSONA_THREAD_REPLIES')");
    expect(body).toContain("feature_flag_enabled('AI_PERSONA_REPLIES')");
  });

  it("caps depth, per-conversation daily volume, and work in flight per user", () => {
    const body = triggerBody();
    expect(body).toContain("public.app_tuning_value('AI_THREAD_MAX_DEPTH', 40)");
    expect(body).toContain("public.app_tuning_value('AI_THREAD_MAX_PERSONA_REPLIES_PER_DAY', 24)");
    expect(body).toContain("public.app_tuning_value('AI_THREAD_MAX_ACTIVE_PER_USER', 8)");
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
