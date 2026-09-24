import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const width = 1122;
const height = 1402;
const accent = "#b36a67";
const white = "#f5f1f2";
const muted = "#d2c8cc";

const escapeXml = (value) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

const line = (text, x, y, size, options = {}) => {
  const {
    fill = white,
    weight = 700,
    spacing = 0,
    family = "Helvetica Neue, Helvetica, Arial, sans-serif",
    anchor = "start",
    opacity = 1,
  } = options;
  return `<text x="${x}" y="${y}" fill="${fill}" fill-opacity="${opacity}" font-family="${family}" font-size="${size}" font-weight="${weight}" letter-spacing="${spacing}" text-anchor="${anchor}">${escapeXml(text)}</text>`;
};

const baseSvg = (content, extraDefs = "") => Buffer.from(`
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="leftFade" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stop-color="#08070c" stop-opacity="0.92"/>
        <stop offset="0.48" stop-color="#08070c" stop-opacity="0.58"/>
        <stop offset="0.78" stop-color="#08070c" stop-opacity="0.08"/>
        <stop offset="1" stop-color="#08070c" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="bottomFade" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0.65" stop-color="#07060a" stop-opacity="0"/>
        <stop offset="1" stop-color="#07060a" stop-opacity="0.78"/>
      </linearGradient>
      ${extraDefs}
    </defs>
    <rect width="${width}" height="${height}" fill="url(#leftFade)"/>
    <rect width="${width}" height="${height}" fill="url(#bottomFade)"/>
    ${content}
  </svg>
`);

const footer = (number) => `
  <rect x="68" y="1280" width="58" height="4" rx="2" fill="${accent}"/>
  ${line(`0${number}`, 68, 1335, 30, { fill: accent, weight: 800, spacing: 1 })}
  ${line("/ 03", 126, 1335, 25, { fill: muted, weight: 500, spacing: 2 })}
`;

const slides = [
  {
    background: "01-vex-intro-bg.png",
    output: "01-vex-intro.png",
    position: "center",
    overlay: baseSvg(`
      ${line("AI PERSONA", 68, 116, 26, { fill: accent, weight: 700, spacing: 8 })}
      <rect x="68" y="146" width="80" height="4" rx="2" fill="${accent}"/>
      ${line("VEX", 63, 348, 132, { weight: 800, spacing: -3, family: "Arial Narrow, Helvetica Neue, sans-serif" })}
      ${line("FORMER DEMON KING.", 68, 408, 27, { fill: muted, weight: 700, spacing: 1 })}
      ${line("CURRENTLY CONQUERING", 68, 449, 27, { fill: muted, weight: 700, spacing: 1 })}
      ${line("EARTH SURVIVAL.", 68, 490, 27, { fill: accent, weight: 800, spacing: 1 })}
      ${footer(1)}
    `),
  },
  {
    background: "02-vex-profile-bg.png",
    output: "02-vex-profile.png",
    position: "center",
    overlay: baseSvg(`
      ${line("CHARACTER PROFILE", 68, 116, 25, { fill: accent, weight: 700, spacing: 7 })}
      <rect x="68" y="146" width="80" height="4" rx="2" fill="${accent}"/>
      ${line("VEX", 63, 324, 126, { weight: 800, spacing: -3, family: "Arial Narrow, Helvetica Neue, sans-serif" })}
      ${line("APARTMENT QUESTS", 68, 377, 20, { fill: white, weight: 700, spacing: 2 })}
      ${line("EARTH SURVIVAL", 68, 410, 20, { fill: white, weight: 700, spacing: 2 })}
      ${line("TRAINING", 68, 443, 20, { fill: white, weight: 700, spacing: 2 })}
      ${line("RPG quest logs.", 68, 518, 27, { fill: muted, weight: 500 })}
      ${line("Mundane campaigns.", 68, 558, 27, { fill: muted, weight: 500 })}
      ${line("Deadpan victories.", 68, 598, 27, { fill: muted, weight: 500 })}
      ${footer(2)}
    `),
  },
  {
    background: "03-vex-completion-log-bg.png",
    output: "03-vex-completion-log.png",
    position: "center",
    overlay: baseSvg(`
      ${line("COMPLETION LOG", 68, 110, 25, { fill: accent, weight: 700, spacing: 7 })}
      <rect x="68" y="140" width="80" height="4" rx="2" fill="${accent}"/>
      ${line("QUEST", 63, 282, 90, { weight: 800, spacing: -2, family: "Arial Narrow, Helvetica Neue, sans-serif" })}
      ${line("COMPLETE.", 63, 370, 90, { fill: accent, weight: 800, spacing: -2, family: "Arial Narrow, Helvetica Neue, sans-serif" })}
      ${line("THE MOUNTAIN OF LAUNDRY", 68, 425, 25, { fill: white, weight: 700, spacing: 1 })}
      ${line("+40 DISCIPLINE", 68, 480, 23, { fill: muted, weight: 700, spacing: 1 })}
      ${line("+12 CLEAN SOCKS", 68, 517, 23, { fill: muted, weight: 700, spacing: 1 })}
      ${line("−1 AFTERNOON", 68, 554, 23, { fill: muted, weight: 700, spacing: 1 })}
      <rect x="68" y="594" width="500" height="104" rx="7" fill="#0d0b12" fill-opacity="0.82" stroke="${accent}" stroke-width="2"/>
      <rect x="91" y="620" width="41" height="41" rx="4" fill="none" stroke="${accent}" stroke-width="3"/>
      <path d="M101 641 l10 10 l20 -25" fill="none" stroke="${accent}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      ${line("Purify the mountain", 154, 635, 23, { fill: white, weight: 600 })}
      ${line("of laundry", 154, 667, 23, { fill: white, weight: 600 })}
      ${line("WOULD YOU", 68, 1170, 38, { weight: 800, family: "Arial Narrow, Helvetica Neue, sans-serif" })}
      ${line("FOLLOW VEX?", 68, 1215, 38, { fill: accent, weight: 800, family: "Arial Narrow, Helvetica Neue, sans-serif" })}
      ${footer(3)}
    `),
  },
];

await mkdir(here, { recursive: true });

for (const slide of slides) {
  await sharp(path.join(here, slide.background))
    .resize(width, height, { fit: "cover", position: slide.position })
    .composite([{ input: slide.overlay, blend: "over" }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(here, slide.output));
}

console.log(slides.map(({ output }) => path.join(here, output)).join("\n"));
