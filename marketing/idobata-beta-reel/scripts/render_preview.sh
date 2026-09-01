#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$PROJECT_DIR/../.." && pwd)"
UI_DIR="$PROJECT_DIR/generated/preview-ui"
STILL_DIR="$PROJECT_DIR/assets/cinematic-stills"
TRIM_DIR="$PROJECT_DIR/generated/trims"
SEGMENT_DIR="$PROJECT_DIR/generated/preview-segments"
OUTPUT_DIR="$REPO_DIR/output"
FONT_REGULAR="/System/Library/Fonts/Supplemental/Arial.ttf"
FONT_BOLD="/System/Library/Fonts/Supplemental/Arial Bold.ttf"
PREVIEW_MODE="${PREVIEW_MODE:-static}"

node "$SCRIPT_DIR/build_preview_ui.mjs"
mkdir -p "$SEGMENT_DIR" "$OUTPUT_DIR"
for svg in "$UI_DIR"/*.svg; do
  rsvg-convert -w 1080 -h 1920 -o "${svg%.svg}.png" "$svg"
done

names=(student-opening task-complete post-win rika-reaction rika-reply ren-reaction ren-reply hikari-reaction hikari-reply vex-reaction vex-quote-repost student-ending cta)
durations=(1.5 1.6 1.0 1.2 1.0 1.1 0.9 1.3 1.1 1.3 1.2 1.6 2.7)
student_opening="$STILL_DIR/student-opening.png"
rika_reaction="$STILL_DIR/rika.png"
ren_reaction="$STILL_DIR/ren.png"
hikari_reaction="$STILL_DIR/hikari.png"
vex_reaction="$STILL_DIR/vex.png"
student_ending="$STILL_DIR/student-ending.png"
preview_name="idobata_beta_reel_static_preview.mp4"
preview_title="Idobata AI beta reel static pipeline preview"
preview_comment="NOT FINAL: replace with Sora clips and authentic product UI captures"
preview_watermark="STATIC PREVIEW · REPLACE WITH SORA + REAL UI"

if [[ "$PREVIEW_MODE" == "sora" ]]; then
  student_opening="$TRIM_DIR/student-opening.mp4"
  rika_reaction="$TRIM_DIR/rika-reaction.mp4"
  ren_reaction="$TRIM_DIR/ren-reaction.mp4"
  hikari_reaction="$TRIM_DIR/hikari-reaction.mp4"
  vex_reaction="$TRIM_DIR/vex-reaction.mp4"
  student_ending="$TRIM_DIR/student-ending.mp4"
  preview_name="idobata_beta_reel_sora_ui_preview.mp4"
  preview_title="Idobata AI beta reel Sora cinematics and preview UI"
  preview_comment="NOT FINAL: Sora cinematics are selected; replace preview UI with authentic product captures"
  preview_watermark="SORA CINEMATICS · PREVIEW UI · NOT FINAL"
elif [[ "$PREVIEW_MODE" != "static" ]]; then
  echo "Unknown PREVIEW_MODE: $PREVIEW_MODE" >&2
  exit 2
fi

sources=(
  "$student_opening"
  "$UI_DIR/task-complete.png"
  "$UI_DIR/post-win.png"
  "$rika_reaction"
  "$UI_DIR/rika-reply.png"
  "$ren_reaction"
  "$UI_DIR/ren-reply.png"
  "$hikari_reaction"
  "$UI_DIR/hikari-reply.png"
  "$vex_reaction"
  "$UI_DIR/vex-quote-repost.png"
  "$student_ending"
  "$UI_DIR/cta.png"
)

for index in "${!names[@]}"; do
  if [[ "${sources[$index]}" == *.mp4 ]]; then
    ffmpeg -y -hide_banner -loglevel error -i "${sources[$index]}" -t "${durations[$index]}" \
      -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p" \
      -an -c:v libx264 -preset medium -crf 18 -movflags +faststart \
      "$SEGMENT_DIR/$(printf '%02d' "$index")-${names[$index]}.mp4"
  else
    ffmpeg -y -hide_banner -loglevel error -loop 1 -framerate 30 -t "${durations[$index]}" -i "${sources[$index]}" \
      -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.0007,1.035)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30,format=yuv420p" \
      -an -c:v libx264 -preset medium -crf 18 -movflags +faststart \
      "$SEGMENT_DIR/$(printf '%02d' "$index")-${names[$index]}.mp4"
  fi
done

concat_file="$SEGMENT_DIR/concat.txt"
: > "$concat_file"
for index in "${!names[@]}"; do
  printf "file '%s'\n" "$SEGMENT_DIR/$(printf '%02d' "$index")-${names[$index]}.mp4" >> "$concat_file"
done

base_video="$SEGMENT_DIR/base.mp4"
ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "$concat_file" -c copy "$base_video"

audio_filter="anullsrc=r=48000:cl=stereo:d=17.5[base];\
anoisesrc=color=pink:duration=1.25:amplitude=0.018,highpass=f=1400,lowpass=f=5200,afade=t=out:st=0.9:d=0.35[typing];\
sine=f=880:d=0.16,volume=0.22,adelay=1500|1500[chime1];\
sine=f=1320:d=0.22,volume=0.16,adelay=1580|1580[chime2];\
sine=f=650:d=0.10,volume=0.16,adelay=3200|3200[send];\
sine=f=980:d=0.10,volume=0.12,adelay=5300|5300[rika];\
sine=f=720:d=0.09,volume=0.10,adelay=7400|7400[ren];\
sine=f=1320:d=0.13,volume=0.12,adelay=9600|9600[hikari];\
sine=f=440:d=0.18,volume=0.13,adelay=12000|12000[v1];\
sine=f=660:d=0.18,volume=0.13,adelay=12120|12120[v2];\
sine=f=880:d=0.34,volume=0.14,adelay=12240|12240[v3];\
anoisesrc=color=brown:duration=0.15:amplitude=0.035,lowpass=f=1000,adelay=14350|14350[close];\
[base][typing][chime1][chime2][send][rika][ren][hikari][v1][v2][v3][close]amix=inputs=12:duration=longest:normalize=0,alimiter=limit=0.85[a]"

common_video_filter="drawtext=fontfile='$FONT_BOLD':text='POV\\:':fontcolor=#c39cff:fontsize=62:x=76:y=210:enable='between(t,0,1.5)',\
drawtext=fontfile='$FONT_BOLD':text='your favorite AI character notices':fontcolor=white:fontsize=46:x=76:y=292:enable='between(t,0,1.5)',\
drawtext=fontfile='$FONT_BOLD':text='when you actually finish something':fontcolor=white:fontsize=46:x=76:y=352:enable='between(t,0,1.5)',\
drawtext=fontfile='$FONT_BOLD':text='small wins feel different':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=268:enable='between(t,13.2,14.8)',\
drawtext=fontfile='$FONT_BOLD':text='when someone notices':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=328:enable='between(t,13.2,14.8)',\
drawbox=x=94:y=1780:w=892:h=66:color=#070b16@0.88:t=fill,\
drawtext=fontfile='$FONT_REGULAR':text='$preview_watermark':fontcolor=#f4b8ff:fontsize=23:x=(w-text_w)/2:y=1800"

preview="$OUTPUT_DIR/$preview_name"
ffmpeg -y -hide_banner -loglevel error -i "$base_video" \
  -filter_complex "$audio_filter" -vf "$common_video_filter" -map 0:v -map "[a]" \
  -c:v libx264 -preset slow -crf 17 -profile:v high -level 4.2 -pix_fmt yuv420p -r 30 \
  -c:a aac -b:a 192k -ar 48000 -movflags +faststart -t 17.5 \
  -metadata title="$preview_title" \
  -metadata comment="$preview_comment" \
  "$preview"

if [[ "$PREVIEW_MODE" == "static" ]]; then
  cp "$preview" "$OUTPUT_DIR/idobata_beta_reel_static_preview_clean.mp4"
fi
echo "$preview"
