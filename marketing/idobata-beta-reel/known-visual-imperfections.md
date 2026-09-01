# Known visual imperfections and blockers

- All 12 planned Sora 2 Pro clips completed. The selected takes and edit in-points are recorded in `selected-variants.json` and `shot_manifest.json`; raw job metadata is preserved beside each clip.
- Real UI recordings are not captured: both the in-app and Chrome-control clients fail during initialization because their current bundle imports `node:process`, which this session's browser runtime disallows.
- The static preview uses repository-grounded UI facsimiles and is visibly watermarked. It is not the public-ready ad.
- The selected student opening and ending use the same exact generated reference and preserve the same identity, wardrobe, desk, and room; their framing is intentionally not identical.
- Sora contact-sheet review passed for identity, anatomy, phone geometry, prohibited readable text, and usable action timing. Ren and Hikari intentionally use very restrained facial movement.
