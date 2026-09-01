#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$PROJECT_DIR/../.." && pwd)"
TRIM_DIR="$PROJECT_DIR/generated/trims"
UI_DIR="$PROJECT_DIR/assets/ui-captures"
OUTPUT_DIR="$REPO_DIR/output"
FONT_REGULAR="/System/Library/Fonts/Supplemental/Arial.ttf"
FONT_BOLD="/System/Library/Fonts/Supplemental/Arial Bold.ttf"

inputs=(
  "$TRIM_DIR/student-opening.mp4"
  "$UI_DIR/task-complete.mp4"
  "$UI_DIR/post-win.mp4"
  "$TRIM_DIR/rika-reaction.mp4"
  "$UI_DIR/rika-reply.mp4"
  "$TRIM_DIR/ren-reaction.mp4"
  "$UI_DIR/ren-reply.mp4"
  "$TRIM_DIR/hikari-reaction.mp4"
  "$UI_DIR/hikari-reply.mp4"
  "$TRIM_DIR/vex-reaction.mp4"
  "$UI_DIR/vex-quote-repost.mp4"
  "$TRIM_DIR/student-ending.mp4"
  "$UI_DIR/cta.mp4"
)
durations=(1.5 1.6 1.0 1.2 1.0 1.1 0.9 1.3 1.1 1.3 1.2 1.6 2.7)

missing=()
for input in "${inputs[@]}"; do
  [[ -f "$input" ]] || missing+=("$input")
done
if ((${#missing[@]})); then
  printf 'Final render refused; required source is missing:\n' >&2
  printf '  %s\n' "${missing[@]}" >&2
  exit 2
fi

mkdir -p "$OUTPUT_DIR"
ffmpeg_inputs=()
for input in "${inputs[@]}"; do
  ffmpeg_inputs+=( -i "$input" )
done

video_filter=""
concat_labels=""
for index in "${!inputs[@]}"; do
  video_filter+="[$index:v]trim=duration=${durations[$index]},setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p[v$index];"
  concat_labels+="[v$index]"
done
video_filter+="${concat_labels}concat=n=13:v=1:a=0[story];"
video_filter+="[story]drawtext=fontfile='$FONT_BOLD':text='POV\\:':fontcolor=#c39cff:fontsize=62:x=76:y=210:enable='between(t,0,1.5)',"
video_filter+="drawtext=fontfile='$FONT_BOLD':text='your favorite AI character notices':fontcolor=white:fontsize=46:x=76:y=292:enable='between(t,0,1.5)',"
video_filter+="drawtext=fontfile='$FONT_BOLD':text='when you actually finish something':fontcolor=white:fontsize=46:x=76:y=352:enable='between(t,0,1.5)',"
video_filter+="drawtext=fontfile='$FONT_BOLD':text='small wins feel different':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=268:enable='between(t,13.2,14.8)',"
video_filter+="drawtext=fontfile='$FONT_BOLD':text='when someone notices':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=328:enable='between(t,13.2,14.8)'[vout];"
video_filter+="anullsrc=r=48000:cl=stereo:d=17.5[base];"
video_filter+="anoisesrc=color=pink:duration=1.25:amplitude=0.018,highpass=f=1400,lowpass=f=5200,afade=t=out:st=0.9:d=0.35[typing];"
video_filter+="sine=f=880:d=0.16,volume=0.22,adelay=1500|1500[chime1];sine=f=1320:d=0.22,volume=0.16,adelay=1580|1580[chime2];"
video_filter+="sine=f=650:d=0.10,volume=0.16,adelay=3200|3200[send];sine=f=980:d=0.10,volume=0.12,adelay=5300|5300[rika];"
video_filter+="sine=f=720:d=0.09,volume=0.10,adelay=7400|7400[ren];sine=f=1320:d=0.13,volume=0.12,adelay=9600|9600[hikari];"
video_filter+="sine=f=440:d=0.18,volume=0.13,adelay=12000|12000[v1];sine=f=660:d=0.18,volume=0.13,adelay=12120|12120[v2];sine=f=880:d=0.34,volume=0.14,adelay=12240|12240[v3];"
video_filter+="anoisesrc=color=brown:duration=0.15:amplitude=0.035,lowpass=f=1000,adelay=14350|14350[close];"
video_filter+="[base][typing][chime1][chime2][send][rika][ren][hikari][v1][v2][v3][close]amix=inputs=12:duration=longest:normalize=0,alimiter=limit=0.85[aout]"

master="$OUTPUT_DIR/idobata_beta_reel_v1.mp4"
ffmpeg -y -hide_banner -loglevel error "${ffmpeg_inputs[@]}" -filter_complex "$video_filter" \
  -map "[vout]" -map "[aout]" -c:v libx264 -preset slow -crf 17 -profile:v high -level 4.2 \
  -pix_fmt yuv420p -r 30 -c:a aac -b:a 192k -ar 48000 -movflags +faststart -t 17.5 "$master"

cp "$master" "$OUTPUT_DIR/idobata_beta_reel_clean.mp4"
echo "$master"
