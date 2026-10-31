# Characters

Every first-party character lives in its own folder, `content/characters/<slug>/`, with three files. The folder name is the slug: lowercase letters and digits joined by single hyphens, at most 48 characters. `schema/` holds the generated JSON Schemas; it is not a character.

The Zod schemas in `src/lib/characters/content-schema.ts` are the source of truth. After changing them, run `npm run content:schema`; a test fails if `schema/*.schema.json` is stale. Each content file can set `"$schema": "../schema/<file>.schema.json"` so editors validate it as you type.

## `sheet.json`

`slug`, `name` (1-60 characters), `role` (`coach`, `rival`, `cheerleader` or `deadpan`), `placeholder`, `voice_notes`, `do`, `dont`, `sample_lines`, `art_url` (or `null`), `is_launch`, `pack_sku` (or `null`), and `companion_slug` (an existing `social_companions` slug whose art the character reuses, or `null`). Every key is required except `active`, which defaults to `true`; set it to `false` to retire a character without deleting its folder. The whole sheet becomes `characters.sheet`, which only the server can read, and feeds the AI system prompt.

## `lines.json`

`{ "placeholder": bool, "lines": [...] }`. Each line has:

- `id`: `<slug>.<event>.<nnn>`, e.g. `sample-coach.task_started.001`. Ids are stable. Never reuse one for different copy; retire a line with `"active": false` instead.
- `event`: `task_started`, `task_finished`, `first_of_day`, `streak`, `comeback`, `session_nudge`, `split_intro` or `chapter_unlocked`. Every event needs at least one active line.
- `text`: under 40 words. It may contain `{task}`, which is replaced with the task title at runtime (it counts as one word). No other `{tokens}`.
- Optional: `min_streak` / `max_streak` (0 or more, max at least min; omit for no bound), `task_age_bucket` (`fresh` < 1 day, `days` 1-6, `weeks` 7-29, `stale` 30+; omit to match any age), `tags`, `active` (default `true`).

## `chapters.json`

`{ "placeholder": bool, "chapters": [...] }`. Each chapter has `number`, `title` (at most 120 characters), `body`, and `unlock_rule: { "consistency_days": n }`. Chapters are numbered 1..n in file order with no gaps, and chapter n unlocks at n consistency days.

## Rules the linter enforces

`tests/domain/character-content.test.ts` lints every folder, and the seed refuses to write while any issue remains. Beyond the schema, the linter checks:

- the slug matches the folder;
- every event is covered;
- every line and sample line is under 40 words;
- lines use no token other than `{task}`, and chapters use none;
- line ids are unique and match the slug and event;
- chapters are contiguous, and each `unlock_rule` matches its number;
- `placeholder` is the same in all three files, and no `[placeholder]` marker is left once it is `false` (checked in the name, `voice_notes`, `do`, lines and chapters);
- no banned content appears in lines, sample lines, `voice_notes`, `do`, chapter titles or chapter bodies (`dont` is exempt, since it names the banned things). The categories are claiming to be human, claiming credentials, romance, guilt, and professional advice. The list is in `src/lib/characters/banned-content.ts`.

## Placeholder copy

While a character's copy is a stand-in, set `"placeholder": true` in all three files and start every text with `[placeholder]`. `sample-coach` is placeholder copy, to be replaced by the founder.

## Seeding

`npm run content:seed` loads every folder into `characters`, `character_lines` and `story_chapters` for the project named by `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, taken from the environment or `.env.local`. It upserts characters by slug, lines by id and chapters by number, and writes only rows that changed. Lines and chapters removed from the files are set inactive, and a full run (without `--only`) also sets inactive any character whose folder is gone. Nothing is ever deleted.

- `--dry-run` prints the plan and writes nothing.
- `--only <slug>` seeds one character.
- `--allow-placeholder` is required to seed a placeholder character anywhere other than a local stack.
