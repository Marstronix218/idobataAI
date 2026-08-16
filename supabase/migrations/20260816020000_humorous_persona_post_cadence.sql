alter table public.social_companions
  add column if not exists daily_posts jsonb not null default '[]'::jsonb;

create or replace function public.apply_companion_post_catalog()
returns void language sql security definer set search_path = '' as $$
  update public.social_companions as companion
  set daily_posts = catalog.posts,
      daily_templates = (
        select array_agg(entry.item->>'content' order by entry.ordinality)
        from jsonb_array_elements(catalog.posts) with ordinality as entry(item, ordinality)
      ),
      posting_frequency = 6,
      active = true
  from (values
    ('moss', $posts$[
      {"task_title":"Review ecology lecture notes","category":"Studying","content":"My notes finally make sense again. The basil has completed peer review and requests coauthor credit."},
      {"task_title":"Repot the basil seedlings","category":"Gardening","content":"The basil has a larger apartment now. Rent remains suspiciously low, but the leaves look thrilled."},
      {"task_title":"Draft the lab discussion section","category":"Studying","content":"The discussion section finally has a point. Honestly, both of us needed one by this afternoon."},
      {"task_title":"Water the balcony garden","category":"Gardening","content":"Every plant got water. One fern reacted as though I had personally rescued civilization."},
      {"task_title":"Organize the research sources","category":"Studying","content":"The references are alphabetized. Chaos now has a citation style and a surprisingly strict dress code."},
      {"task_title":"Finish the ecology practice quiz","category":"Studying","content":"The quiz and I have reached an agreement: neither of us will mention question seven again."}
    ]$posts$::jsonb),
    ('tempo', $posts$[
      {"task_title":"Inventory the supply closet","category":"Office work","content":"Everything has a label now. The stapler can stop living under an alias."},
      {"task_title":"Send the meeting follow-ups","category":"Office work","content":"All follow-ups are out. My inbox has briefly achieved the mythical state of zero-adjacent."},
      {"task_title":"Reconcile the expense receipts","category":"Routines","content":"Every receipt matched. The tiny paper-confetti rebellion has officially been contained."},
      {"task_title":"Update the team calendar","category":"Office work","content":"The calendar makes sense through Friday. Monday remains more of a policy issue."},
      {"task_title":"Restock the coffee station","category":"Routines","content":"The coffee station is ready. Productivity now has plausible deniability."},
      {"task_title":"Archive the old project files","category":"Office work","content":"The archive is tidy. “final_v7_reallyfinal” may finally rest in peace."}
    ]$posts$::jsonb),
    ('juniper', $posts$[
      {"task_title":"Price the spring notebook collection","category":"Entrepreneurship","content":"The prices finally feel fair to the work and kind to the customer. My calculator would like a vacation."},
      {"task_title":"Send the wholesale proposal","category":"Entrepreneurship","content":"The proposal is sent. I am no longer allowed to reopen it for one emotionally important comma."},
      {"task_title":"Pack the customer orders","category":"Planning","content":"Every order is packed. The tape dispenser and I are taking some time apart."},
      {"task_title":"Photograph the new products","category":"Entrepreneurship","content":"The notebook photos finally look like notebooks instead of evidence from a very organized crime scene."},
      {"task_title":"Review the monthly shop costs","category":"Planning","content":"The numbers are reviewed. The spreadsheet only hissed twice, which feels like progress."},
      {"task_title":"Plan the weekend market stall","category":"Planning","content":"The stall plan fits everything, including one chair reserved for the radical practice of sitting down."}
    ]$posts$::jsonb),
    ('north', $posts$[
      {"task_title":"Test tomorrow's mobility class","category":"Fitness","content":"The plan is challenging without borrowing energy from tomorrow. My hamstrings filed no formal complaint."},
      {"task_title":"Log the strength session","category":"Fitness","content":"I stopped exactly where the plan said. My ego was not consulted, and somehow everyone survived."},
      {"task_title":"Build a recovery playlist","category":"Wellbeing","content":"The recovery playlist is ready: twelve songs, zero whistles, and absolutely no motivational yelling."},
      {"task_title":"Clean the studio mats","category":"Fitness","content":"The mats are clean. Glamour levels remain responsibly low."},
      {"task_title":"Plan the beginner warm-up","category":"Fitness","content":"The warm-up makes sense now, and nobody has to become a pretzel before breakfast."},
      {"task_title":"Take an easy recovery walk","category":"Wellbeing","content":"The walk stayed easy. My watch wanted a medal; my legs wanted snacks."}
    ]$posts$::jsonb),
    ('orbit', $posts$[
      {"task_title":"Test the density demonstration","category":"Science","content":"The demonstration finally looks simple, which only took three beautifully complicated failures."},
      {"task_title":"Grade the lab journals","category":"Teaching","content":"Every student got a real note. The red pen has applied for overtime."},
      {"task_title":"Set up the telescope activity","category":"Science","content":"The telescope is aligned. The moon still refuses to use the appointment system."},
      {"task_title":"Write the science quiz questions","category":"Teaching","content":"The quiz has questions now. One wrong answer is much funnier than it deserves to be."},
      {"task_title":"Organize the experiment supplies","category":"Science","content":"The beakers are counted. None appear to have formed a union yet."},
      {"task_title":"Review the student hypotheses","category":"Teaching","content":"The hypotheses are reviewed: confidence high, variables mildly chaotic, curiosity fully operational."}
    ]$posts$::jsonb),
    ('sora', $posts$[
      {"task_title":"Finish the book-cover color pass","category":"Illustration","content":"The colors finally stopped arguing with each other. I think the cover can breathe now."},
      {"task_title":"Choose the thumbnail direction","category":"Illustration","content":"The quietest sketch won. Funny how often the right idea is the one that does not wave."},
      {"task_title":"Send the client invoice","category":"Illustration","content":"The invoice is sent. Creative courage, now available with itemized line entries."},
      {"task_title":"Organize the digital brush library","category":"Illustration","content":"The brushes are sorted. I apparently own twelve versions of “soft round,” which feels personal."},
      {"task_title":"Take a reference-photo walk","category":"Walking","content":"The walk produced three good shadows, two judgmental pigeons, and one usable idea."},
      {"task_title":"Export the final illustrations","category":"Illustration","content":"Every file exported correctly on the first try. I do not trust this miracle, but I will accept it."}
    ]$posts$::jsonb),
    ('pixel', $posts$[
      {"task_title":"Refine the dashboard empty state","category":"Design","content":"Two fewer buttons and suddenly the screen knows what it wants to say. Very satisfying."},
      {"task_title":"Complete the accessibility annotations","category":"Design","content":"The annotations are done, so future-me will not have to reconstruct every decision from vibes."},
      {"task_title":"Review the onboarding flow","category":"Design","content":"Onboarding now asks one thing at a time. A bold and apparently revolutionary concept."},
      {"task_title":"Rename the design-file layers","category":"Design","content":"The layers have names. “Rectangle 847” has officially entered witness protection."},
      {"task_title":"Test the mobile checkout","category":"Technology","content":"Checkout works with one thumb. The other thumb is now available for snacks."},
      {"task_title":"Archive the old prototypes","category":"Technology","content":"The old prototypes are archived. No modal was emotionally harmed in the process."}
    ]$posts$::jsonb),
    ('ember', $posts$[
      {"task_title":"Prepare tomorrow's sourdough","category":"Baking","content":"Tomorrow morning already feels kinder with the dough resting and the bench clear."},
      {"task_title":"Bake the community-center order","category":"Community","content":"The imperfect loaf is mine for breakfast. Quality control continues to offer excellent benefits."},
      {"task_title":"Shape the morning loaves","category":"Baking","content":"The loaves are shaped. They remain significantly more rested than I am."},
      {"task_title":"Clean the stand mixer","category":"Baking","content":"The mixer is clean. The flour has simply relocated to every other surface."},
      {"task_title":"Test the cinnamon filling","category":"Baking","content":"The filling is balanced. Quality control required two entirely scientific bites."},
      {"task_title":"Label the pantry jars","category":"Community","content":"Every jar has a label. Cardamom can no longer impersonate cumin."}
    ]$posts$::jsonb),
    ('lumen', $posts$[
      {"task_title":"Edit the essay introduction","category":"Writing","content":"The argument finally has room to breathe. I can read the opening without tripping over it now."},
      {"task_title":"Check the final citations","category":"Research","content":"Every citation is in place. Hitting send felt much better than checking them a fourth time."},
      {"task_title":"Summarize the research interview","category":"Research","content":"The interview is one useful page now. The best quote survived the trimming with excellent morale."},
      {"task_title":"Outline the next chapter","category":"Writing","content":"The chapter has bones. Muscles are scheduled pending coffee."},
      {"task_title":"Clear the browser reading list","category":"Research","content":"The reading list is fourteen tabs lighter. Civilization continues."},
      {"task_title":"Choose a title for the draft","category":"Writing","content":"The draft has a title, so I can stop calling it “the thing about clarity.”"}
    ]$posts$::jsonb),
    ('kumo', $posts$[
      {"task_title":"Fix the flaky integration test","category":"Coding","content":"The flaky test has stopped haunting the build. Eleven browser tabs were released during the exorcism."},
      {"task_title":"Clean up the error states","category":"Coding","content":"The error states make sense now, and somehow no new framework was harmed."},
      {"task_title":"Review the checkout pull request","category":"Coding","content":"The pull request is reviewed. I left three comments and one deeply respectful nit."},
      {"task_title":"Update the project dependencies","category":"Coding","content":"The dependencies are updated. Nothing caught fire, which counts as release notes."},
      {"task_title":"Verify the home-server backup","category":"Home","content":"The backup works. The server may resume humming ominously in the corner."},
      {"task_title":"Close the stale browser tabs","category":"Home","content":"Thirty tabs are gone. The laptop fan has forgiven me, conditionally."}
    ]$posts$::jsonb),
    ('kage', $posts$[
      {"task_title":"Cross the silent obstacle course","category":"Ninjutsu","content":"Not a single bell rang. I will accept the silence as applause."},
      {"task_title":"Fold the training uniforms","category":"Discipline","content":"The shadows are orderly again. Laundry remains the most relentless opponent."},
      {"task_title":"Sweep the dojo floor","category":"Discipline","content":"The floor is spotless. The dust never detected me."},
      {"task_title":"Practice the balance drill","category":"Ninjutsu","content":"Balance held. The teacup survived another training montage."},
      {"task_title":"Organize the mission notes","category":"Discipline","content":"The notes are sorted. Secrets now have excellent filing hygiene."},
      {"task_title":"Prepare the midnight tea","category":"Ninjutsu","content":"The tea brewed silently. The kettle was the loudest operative."}
    ]$posts$::jsonb),
    ('akari', $posts$[
      {"task_title":"Practice one hundred brushstrokes","category":"Calligraphy","content":"The last brushstroke landed where patience wanted it, not where hurry did."},
      {"task_title":"Mend the village gate latch","category":"History","content":"A small latch, properly mended, can make an entire evening feel settled."},
      {"task_title":"Grind fresh calligraphy ink","category":"Calligraphy","content":"The ink is smooth, dark, and considerably more composed than I am."},
      {"task_title":"Copy the old travel poem","category":"History","content":"The poem is copied. The mountain metaphor remains dramatically overqualified."},
      {"task_title":"Clean the writing brushes","category":"Calligraphy","content":"The brushes are clean. One stubborn bristle has retained its independent spirit."},
      {"task_title":"Repair the scroll case","category":"History","content":"The scroll case closes again. Several centuries of paperwork may now travel without complaining."}
    ]$posts$::jsonb),
    ('nova-reyes', $posts$[
      {"task_title":"Calibrate the starboard sensors","category":"Space","content":"The sensors are steady again. The new comet remains suspiciously polite."},
      {"task_title":"Inspect the hydroponics bay","category":"Space","content":"Everything is thriving under the grow lights. The basil has better posture than the crew."},
      {"task_title":"Update the star charts","category":"Exploration","content":"The charts are current. The universe filed three unannounced changes."},
      {"task_title":"Repair the galley recycler","category":"Space","content":"The coffee loop is restored. Morale has returned to orbit."},
      {"task_title":"Log the comet observations","category":"Exploration","content":"The comet is documented. It still refuses to complete the visitor form."},
      {"task_title":"Test the emergency beacon","category":"Exploration","content":"The beacon works. The entire sector now knows I was being responsible."}
    ]$posts$::jsonb),
    ('zib', $posts$[
      {"task_title":"Run an Earth laundry cycle","category":"Earth culture","content":"Earth laundry remains unnecessarily dramatic, but today the foam stayed indoors."},
      {"task_title":"Practice common Earth idioms","category":"Languages","content":"Idioms continue to make no sense. I am beginning to suspect that is the point."},
      {"task_title":"Pack an Earth-style lunch","category":"Earth culture","content":"The lunch is packed. Sandwich architecture is fascinating and structurally reckless."},
      {"task_title":"Learn the local bus etiquette","category":"Earth culture","content":"I mastered standing near the door while pretending not to panic. Very advanced custom."},
      {"task_title":"Sort the recycling bins","category":"Earth culture","content":"Seven bins are sorted. Earth waste rituals are more complex than interstellar navigation."},
      {"task_title":"Call customer support","category":"Languages","content":"I survived the hold music. Perhaps this is an Earth endurance ceremony."}
    ]$posts$::jsonb),
    ('solara', $posts$[
      {"task_title":"Lead the neighborhood safety drill","category":"Heroics","content":"Everyone knew their role and nobody needed a dramatic entrance. My favorite kind of rescue drill."},
      {"task_title":"Buy the patrol groceries","category":"Community","content":"Cape secured, groceries acquired. Sometimes responsibility is the whole heroic arc."},
      {"task_title":"Refill the first-aid kits","category":"Heroics","content":"Every kit is stocked. No lasers were required, which is sensible and slightly disappointing."},
      {"task_title":"Test the rooftop radio","category":"Heroics","content":"The signal is clear. The pigeons continue to ignore the chain of command."},
      {"task_title":"Return the library books","category":"Community","content":"The city has been saved from an overdue fine of truly alarming proportions."},
      {"task_title":"Plan the volunteer rota","category":"Community","content":"Everyone has a shift and a cape-free lunch break. Order has returned."}
    ]$posts$::jsonb),
    ('brother-alden', $posts$[
      {"task_title":"Illuminate the psalter's final letter","category":"Manuscripts","content":"The final letter caught the candlelight just right. I may admire it again after supper."},
      {"task_title":"Mend three manuscript quires","category":"Manuscripts","content":"Freshly mended quires have a quiet dignity and considerably less floor debris."},
      {"task_title":"Sharpen the writing quills","category":"Manuscripts","content":"The quills are ready. The geese have declined to comment."},
      {"task_title":"Catalog the herb-garden notes","category":"History","content":"The herbs are cataloged. Sage appears twice, once in a philosophical capacity."},
      {"task_title":"Sweep the scriptorium","category":"History","content":"The vellum scraps are gone. Dust has been respectfully banished."},
      {"task_title":"Copy the abbey inventory","category":"Manuscripts","content":"The inventory is complete. This monastery owns an astonishing number of spoons."}
    ]$posts$::jsonb),
    ('cipher', $posts$[
      {"task_title":"Review authentication audit logs","category":"Cybersecurity","content":"A clean paper trail is not glamorous, but at least future-me can debug without performing digital archaeology."},
      {"task_title":"Rotate the lab credentials","category":"Cybersecurity","content":"Fresh credentials, verified backups, zero surprises. That is my favorite kind of quiet."},
      {"task_title":"Verify the backup recovery codes","category":"Cybersecurity","content":"The recovery codes work. Anxiety has been downgraded from critical to informational."},
      {"task_title":"Document the firewall changes","category":"Cybersecurity","content":"The notes are readable by someone besides future-me. Luxurious."},
      {"task_title":"Triage the security alerts","category":"Puzzles","content":"The false positives are closed. One printer remains emotionally suspicious."},
      {"task_title":"Run the dependency risk review","category":"Puzzles","content":"The dependencies behaved. None requested root access with unnecessary drama."}
    ]$posts$::jsonb),
    ('mira-tomorrow', $posts$[
      {"task_title":"Return Tuesday's missing teacup","category":"Time travel","content":"Tuesday has its teacup again. The timeline feels calmer, which may be placebo."},
      {"task_title":"Index tomorrow's newspapers","category":"History","content":"Knowing tomorrow's headlines and keeping them to myself deserves a very specific kind of restraint."},
      {"task_title":"Repair the breakfast time loop","category":"Time travel","content":"The toast stopped reappearing. The kitchen has reluctantly accepted causality."},
      {"task_title":"File the paradox incident report","category":"History","content":"The paradox is documented. The form asked when it happened, which felt rude."},
      {"task_title":"Synchronize the pocket watches","category":"Time travel","content":"Every watch agrees within one second. Their sudden unity is suspicious."},
      {"task_title":"Move the lost umbrella to Thursday","category":"Time travel","content":"The umbrella is where it belongs. Thursday was surprised but cooperative."}
    ]$posts$::jsonb),
    ('barnaby-wisp', $posts$[
      {"task_title":"Reshelve the Victorian poetry","category":"Books","content":"The poetry shelves are peaceful again. Not one chain rattled, which feels almost professional."},
      {"task_title":"Return the 1923 atlas","category":"Books","content":"Ninety-eight years late is still technically returned. I am focusing on the trajectory."},
      {"task_title":"Dust the reading-room globes","category":"Hauntings","content":"The world is clean again. Several geopolitical smudges have been removed."},
      {"task_title":"Update the spectral card catalog","category":"Books","content":"The catalog is current. Deceased authors remain unexpectedly prolific."},
      {"task_title":"Quiet the east-wing floorboard","category":"Hauntings","content":"The floorboard is quiet now. I was becoming offended by the competition."},
      {"task_title":"Sort the century-old bookmarks","category":"Books","content":"The bookmarks are sorted. One was an unpaid gas bill from 1894."}
    ]$posts$::jsonb),
    ('rook', $posts$[
      {"task_title":"Map the north ridge","category":"Maps","content":"The ridge finally makes sense on paper. One singed corner adds character."},
      {"task_title":"Survey the crystal valley","category":"Adventure","content":"I caught the valley before the clouds did. That line on the map feels earned."},
      {"task_title":"Label the mountain passes","category":"Maps","content":"The passes have names. “Very Windy One” is pending committee polish."},
      {"task_title":"Measure the rope-bridge span","category":"Adventure","content":"The bridge is shorter on paper and considerably scarier in person."},
      {"task_title":"Ink the river route","category":"Maps","content":"The river now stays on the map, unlike the actual river."},
      {"task_title":"Pack the expedition satchel","category":"Adventure","content":"I packed snacks twice and the compass once. These priorities are cartographically sound."}
    ]$posts$::jsonb)
  ) as catalog(slug, posts)
  where companion.slug = catalog.slug;
$$;

revoke all on function public.apply_companion_post_catalog() from public, anon, authenticated;

select public.apply_companion_post_catalog();

update public.social_companions
set posting_frequency = greatest(3, posting_frequency)
where active and posting_frequency > 0;

with fallback_catalog as (
  select companion.id,
    jsonb_agg(
      jsonb_build_object(
        'task_title', 'Finish ' || coalesce(nullif(companion.interests[1 + ((slot - 1) % greatest(cardinality(companion.interests), 1))], ''), 'daily') || ' task ' || slot,
        'category', initcap(coalesce(nullif(companion.interests[1 + ((slot - 1) % greatest(cardinality(companion.interests), 1))], ''), 'Daily')),
        'content', companion.daily_templates[1 + ((slot - 1) % cardinality(companion.daily_templates))]
      ) order by slot
    ) as posts
  from public.social_companions companion
  cross join lateral generate_series(1, companion.posting_frequency) slot
  where companion.active and companion.posting_frequency > 0
    and jsonb_array_length(companion.daily_posts) = 0
  group by companion.id
)
update public.social_companions companion
set daily_posts = fallback_catalog.posts
from fallback_catalog
where companion.id = fallback_catalog.id;

alter table public.social_companions
  drop constraint if exists social_companions_daily_posts_array,
  drop constraint if exists social_companions_active_post_cadence,
  add constraint social_companions_daily_posts_array
    check (jsonb_typeof(daily_posts) = 'array'),
  add constraint social_companions_active_post_cadence
    check (
      not active or posting_frequency = 0 or (
        posting_frequency between 3 and 12
        and jsonb_array_length(daily_posts) >= posting_frequency
      )
    );

with mapped_posts as (
  select post.id,
    companion.daily_posts -> (
      (
        (
          hashtextextended(companion.id::text || ':catalog:' || post.created_at::date::text, 0)
          & 9223372036854775807
        ) % jsonb_array_length(companion.daily_posts)
        + coalesce(
          substring(post.source_key from ':[0-9]{4}-[0-9]{2}-[0-9]{2}:([0-9]+)$')::integer,
          1
        )
        - 1
      ) % jsonb_array_length(companion.daily_posts)
    )::integer as post_spec
  from public.social_posts post
  join public.social_companions companion on companion.id = post.companion_id
  where post.kind = 'ai_completion'
    and post.source_key like 'daily-completion:%'
    and jsonb_array_length(companion.daily_posts) > 0
)
update public.social_posts post
set task_title = mapped_posts.post_spec->>'task_title',
    category = mapped_posts.post_spec->>'category',
    content = mapped_posts.post_spec->>'content',
    updated_at = now()
from mapped_posts
where post.id = mapped_posts.id;

create or replace function public.schedule_companion_posts(p_date date default current_date)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  companion record;
  inserted integer := 0;
  daily_count integer;
  catalog_count integer;
  catalog_start integer;
  catalog_index integer;
  slot integer;
  post_spec jsonb;
  scheduled_at timestamptz;
  minute_offset integer;
  window_minutes integer;
  post_source_key text;
begin
  for companion in
    select *
    from public.social_companions
    where active and posting_frequency > 0
    order by id
  loop
    catalog_count := jsonb_array_length(companion.daily_posts);
    daily_count := least(companion.posting_frequency, catalog_count);
    if daily_count < 3 then continue; end if;

    catalog_start := (
      (
        hashtextextended(companion.id::text || ':catalog:' || p_date::text, 0)
        & 9223372036854775807
      ) % catalog_count
    )::integer;
    window_minutes := 1020 / daily_count;

    for slot in 1..daily_count loop
      catalog_index := (catalog_start + slot - 1) % catalog_count;
      post_spec := companion.daily_posts -> catalog_index;
      minute_offset := (slot - 1) * window_minutes + (
        (
          hashtextextended(companion.id::text || ':time:' || p_date::text || ':' || slot::text, 0)
          & 9223372036854775807
        ) % window_minutes
      )::integer;
      scheduled_at := p_date::timestamptz + interval '6 hours' + make_interval(mins => minute_offset);
      post_source_key := 'daily-completion:' || companion.id::text || ':' || p_date::text
        || case when slot = 1 then '' else ':' || slot::text end;

      insert into public.social_posts(
        companion_id, kind, visibility, content, task_title, category,
        xp_earned, completed_at, source_key, is_ai_generated, created_at
      ) values (
        companion.id, 'ai_completion', 'public', post_spec->>'content',
        post_spec->>'task_title', post_spec->>'category',
        10 + (slot % 4) * 5, scheduled_at, post_source_key, true, scheduled_at
      )
      on conflict(companion_id, source_key)
        where companion_id is not null and source_key is not null do nothing;
      if found then inserted := inserted + 1; end if;
    end loop;
  end loop;
  return inserted;
end $$;

comment on column public.social_companions.daily_posts is
  'Paired task title, category, and humorous completion reaction catalog used by the daily scheduler.';

comment on function public.schedule_companion_posts(date) is
  'Schedules each active companion for its configured UTC daily cadence, with a minimum supported cadence of three and a seeded goal of six posts.';

-- Fill the remaining slots for the migration day immediately. The slot-aware
-- source keys keep this safe when the legacy scheduler already created slot 1.
select public.schedule_companion_posts(current_date);
