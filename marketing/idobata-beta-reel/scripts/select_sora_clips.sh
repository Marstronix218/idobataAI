#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RAW_DIR="$PROJECT_DIR/generated/sora/raw"
SELECTED_DIR="$PROJECT_DIR/generated/sora/selected"
TRIM_DIR="$PROJECT_DIR/generated/trims"
SHEETS_DIR="$PROJECT_DIR/generated/contact-sheets"
SELECTIONS="$PROJECT_DIR/selected-variants.json"

mkdir -p "$SELECTED_DIR" "$TRIM_DIR" "$SHEETS_DIR"

node - "$SELECTIONS" "$RAW_DIR" "$SELECTED_DIR" <<'NODE'
const { copyFileSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const [selectionPath, rawDir, selectedDir] = process.argv.slice(2);
const selections = JSON.parse(readFileSync(selectionPath, "utf8"));
for (const [shot, variant] of Object.entries(selections)) {
  copyFileSync(join(rawDir, shot, `${variant}.mp4`), join(selectedDir, `${shot}.mp4`));
}
NODE

declare -A DURATIONS=(
  [student-opening]=1.5
  [rika-reaction]=1.2
  [ren-reaction]=1.1
  [hikari-reaction]=1.3
  [vex-reaction]=1.3
  [student-ending]=1.6
)

declare -A TRIM_INS=(
  [student-opening]=0.0
  [rika-reaction]=1.1
  [ren-reaction]=0.0
  [hikari-reaction]=0.0
  [vex-reaction]=0.6
  [student-ending]=1.5
)

for shot in student-opening rika-reaction ren-reaction hikari-reaction vex-reaction student-ending; do
  source_file="$SELECTED_DIR/$shot.mp4"
  ffmpeg -y -hide_banner -loglevel error -i "$source_file" -ss "${TRIM_INS[$shot]}" \
    -t "${DURATIONS[$shot]}" -an -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p \
    "$TRIM_DIR/$shot.mp4"

  duration="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$TRIM_DIR/$shot.mp4")"
  q1="$(awk -v d="$duration" 'BEGIN { printf "%.3f", d * 0.25 }')"
  q2="$(awk -v d="$duration" 'BEGIN { printf "%.3f", d * 0.50 }')"
  q3="$(awk -v d="$duration" 'BEGIN { printf "%.3f", d * 0.75 }')"

  ffmpeg -y -hide_banner -loglevel error \
    -ss "$q1" -i "$TRIM_DIR/$shot.mp4" -ss "$q2" -i "$TRIM_DIR/$shot.mp4" -ss "$q3" -i "$TRIM_DIR/$shot.mp4" \
    -filter_complex "[0:v]scale=360:-2[a];[1:v]scale=360:-2[b];[2:v]scale=360:-2[c];[a][b][c]hstack=inputs=3" \
    -frames:v 1 "$SHEETS_DIR/$shot.jpg"
done

echo "Selected trims: $TRIM_DIR"
echo "Contact sheets: $SHEETS_DIR"
