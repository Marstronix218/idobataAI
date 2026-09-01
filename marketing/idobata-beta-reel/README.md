# Idobata AI beta reel

Production package for the 17.5-second vertical beta advertisement.

## Current state

- Six cinematic fallback stills are retained in `assets/cinematic-stills/`.
- The four repository portraits and real Idobata logo are retained in `assets/`.
- All 12 planned Sora 2 Pro clips were generated and retained: two variants for each of six cinematic shots.
- Six takes were selected, frame-accurately trimmed, and contact-sheet reviewed.
- Authentic UI recording remains an input contract. Both available browser-control clients fail before attaching because their bundle imports `node:process`, which this session blocks; no fabricated UI capture is labeled as final.
- A technically verified 17.5-second Sora-plus-preview-UI reel is available at `output/idobata_beta_reel_sora_ui_preview.mp4`. It is visibly watermarked and is not the public-ready ad.

## Generate Sora clips

The runner uses the official `POST /v1/videos` workflow, polls each job, and downloads the MP4. It defaults to two variants per shot, `sora-2-pro`, 4 seconds, and 1024x1792. If `sora-2-pro` is unavailable for the account, it retries with `sora-2`.

```bash
export AI_API_KEY="..."
node marketing/idobata-beta-reel/scripts/generate_sora.mjs --execute
```

Alternatively, add `OPENAI_API_KEY` to the repository's gitignored `.env.local`. The runner accepts either `OPENAI_API_KEY` or the existing `AI_API_KEY` and never logs the value.

Never commit the key. The completed two-variant run requested 12 four-second Sora 2 Pro clips. At the official 1024x1792 rate of $0.50 per generated second, the estimated cost is approximately $24. The runner is resumable and skips downloaded clips; use `--force` only when intentional regeneration is required.

## Select and trim

Put the chosen variant names in `selected-variants.json`, then run:

```bash
bash marketing/idobata-beta-reel/scripts/select_sora_clips.sh
```

This copies selected clips, makes the timeline trims, and creates 25/50/75% contact sheets.

## Authentic UI capture contract

Capture these real app interactions at 1080x1920 or higher and place them under `assets/ui-captures/`:

- `task-complete.mp4`
- `post-win.mp4`
- `rika-reply.mp4`
- `ren-reply.mp4`
- `hikari-reply.mp4`
- `vex-quote-repost.mp4`
- `cta.mp4`

Use the local app with `NEXT_PUBLIC_ENABLE_DEMO_MODE=true` and the `/tasks`, `/feed`, and `/ai-personas` routes. Do not record or modify production data.

## Render

```bash
bash marketing/idobata-beta-reel/scripts/render_final.sh
```

The final renderer refuses to run if any selected Sora clip or authentic UI capture is missing. This prevents a placeholder from being mistaken for the public beta ad.

For pacing review only:

```bash
bash marketing/idobata-beta-reel/scripts/render_preview.sh
bash marketing/idobata-beta-reel/scripts/render_sora_preview.sh
```

The static export is watermarked `STATIC PREVIEW · REPLACE WITH SORA + REAL UI`. The Sora-powered export is watermarked `SORA CINEMATICS · PREVIEW UI · NOT FINAL`.
