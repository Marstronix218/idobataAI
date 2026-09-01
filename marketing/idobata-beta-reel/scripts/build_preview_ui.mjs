#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, "..");
const outDir = join(projectDir, "generated", "preview-ui");
await mkdir(outDir, { recursive: true });

const asset = async (name, mime) => {
  const bytes = await readFile(join(projectDir, "assets", name));
  return `data:${mime};base64,${bytes.toString("base64")}`;
};

const logo = await asset("idobata-logo.png", "image/png");
const avatars = {
  rika: await asset("rika-kisaragi-reference.webp", "image/webp"),
  ren: await asset("ren-kurose-reference.webp", "image/webp"),
  hikari: await asset("hikari-amane-reference.webp", "image/webp"),
  vex: await asset("vex-reference.webp", "image/webp"),
};

const escapeXml = (value) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const shell = (title, body, extra = "") => `
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <defs>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#7c3aed"/>
      <stop offset="1" stop-color="#be185d"/>
    </linearGradient>
    <filter id="shadow"><feDropShadow dx="0" dy="18" stdDeviation="24" flood-opacity=".34"/></filter>
    <clipPath id="avatar"><circle cx="0" cy="0" r="54"/></clipPath>
  </defs>
  <rect width="1080" height="1920" fill="#070b16"/>
  <rect x="42" y="42" width="996" height="1836" rx="48" fill="#0e1626" stroke="#2b3952" stroke-width="3" filter="url(#shadow)"/>
  <image href="${logo}" x="76" y="74" width="84" height="84"/>
  <text x="178" y="133" fill="#f8fafc" font-family="Arial" font-size="42" font-weight="700">idobata<tspan fill="#bca8ff">AI</tspan></text>
  <rect x="836" y="88" width="128" height="50" rx="25" fill="#3b2a1f" stroke="#79543d"/>
  <text x="900" y="122" fill="#ffd29e" text-anchor="middle" font-family="Arial" font-size="23" font-weight="700">Beta</text>
  <line x1="76" y1="181" x2="1004" y2="181" stroke="#2b3952" stroke-width="2"/>
  <text x="76" y="260" fill="#f8fafc" font-family="Arial" font-size="58" font-weight="700">${escapeXml(title)}</text>
  ${body}
  <rect x="94" y="1774" width="892" height="58" rx="29" fill="#111a2b" stroke="#374760"/>
  <text x="540" y="1812" fill="#9aa6bb" text-anchor="middle" font-family="Arial" font-size="21" font-weight="700">STATIC PREVIEW · REPLACE WITH SORA + REAL UI</text>
  ${extra}
</svg>`;

const taskComplete = shell("Your Tasks", `
  <text x="78" y="320" fill="#bca8ff" font-family="Arial" font-size="26" font-weight="700">Monday, August 31</text>
  <rect x="76" y="382" width="928" height="214" rx="34" fill="#141d2e" stroke="#384965" stroke-width="3"/>
  <text x="116" y="450" fill="#9aa6bb" font-family="Arial" font-size="30">Add a task...</text>
  <rect x="770" y="415" width="190" height="72" rx="36" fill="url(#brand)"/>
  <text x="865" y="461" text-anchor="middle" fill="white" font-family="Arial" font-size="27" font-weight="700">+ Add task</text>
  <rect x="76" y="646" width="928" height="710" rx="34" fill="#141d2e" stroke="#384965" stroke-width="3"/>
  <text x="112" y="722" fill="#f8fafc" font-family="Arial" font-size="36" font-weight="700">Today</text>
  <line x1="76" y1="760" x2="1004" y2="760" stroke="#31405a"/>
  <circle cx="128" cy="858" r="34" fill="#7c3aed"/>
  <path d="M111 859 l11 12 l24 -28" fill="none" stroke="white" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="188" y="846" fill="#f8fafc" font-family="Arial" font-size="34" font-weight="700">Finish economics essay</text>
  <text x="188" y="898" fill="#4ade80" font-family="Arial" font-size="25" font-weight="700">Completed · just now</text>
  <line x1="110" y1="952" x2="970" y2="952" stroke="#31405a"/>
  <circle cx="128" cy="1040" r="34" fill="none" stroke="#52627c" stroke-width="5"/>
  <text x="188" y="1050" fill="#d7deeb" font-family="Arial" font-size="32" font-weight="700">Submit economics essay</text>
  <circle cx="128" cy="1198" r="34" fill="none" stroke="#52627c" stroke-width="5"/>
  <text x="188" y="1208" fill="#d7deeb" font-family="Arial" font-size="32" font-weight="700">Review statistics lecture notes</text>
  <rect x="76" y="1416" width="928" height="250" rx="34" fill="#141d2e" stroke="#384965" stroke-width="3"/>
  <text x="116" y="1492" fill="#55b6f6" font-family="Arial" font-size="28" font-weight="700">Your momentum</text>
  <text x="116" y="1580" fill="#f8fafc" font-family="Arial" font-size="64" font-weight="700">3-day streak</text>
  <rect x="116" y="1614" width="810" height="16" rx="8" fill="#2d3b55"/>
  <rect x="116" y="1614" width="610" height="16" rx="8" fill="#8b3ff2"/>
`);

const postWin = shell("Post a win", `
  <rect x="76" y="352" width="928" height="1010" rx="42" fill="#141d2e" stroke="#384965" stroke-width="3"/>
  <text x="116" y="438" fill="#bca8ff" font-family="Arial" font-size="26" font-weight="700">Community</text>
  <rect x="116" y="500" width="848" height="150" rx="28" fill="#0b1220" stroke="#32415c" stroke-width="2"/>
  <text x="150" y="570" fill="#f8fafc" font-family="Arial" font-size="32">Spend over 3 hours on this. gg</text>
  <rect x="116" y="708" width="848" height="340" rx="30" fill="#0b1220" stroke="#32415c" stroke-width="2"/>
  <text x="158" y="780" fill="#9aa6bb" font-family="Arial" font-size="24">Your completed task</text>
  <text x="158" y="850" fill="#f8fafc" font-family="Arial" font-size="39" font-weight="700">Finish economics essay</text>
  <rect x="158" y="914" width="230" height="54" rx="27" fill="#2b2149" stroke="#57458c"/>
  <text x="273" y="950" fill="#c9b6ff" text-anchor="middle" font-family="Arial" font-size="23" font-weight="700">3-day streak</text>
  <rect x="562" y="1120" width="402" height="96" rx="48" fill="url(#brand)"/>
  <text x="763" y="1181" fill="white" text-anchor="middle" font-family="Arial" font-size="32" font-weight="700">Post to Community</text>
  <text x="116" y="1438" fill="#9aa6bb" font-family="Arial" font-size="27">You choose what gets shared.</text>
  <text x="116" y="1485" fill="#55b6f6" font-family="Arial" font-size="27" font-weight="700">Private by default.</text>
`);

const feedReply = ({ title, key, name, accent, reply, secondLine = "", quote = false }) => shell(title, `
  <text x="76" y="320" fill="#55b6f6" font-family="Arial" font-size="27" font-weight="700">Community · For you</text>
  <rect x="76" y="370" width="928" height="514" rx="34" fill="#0b1220" stroke="#33425e" stroke-width="3"/>
  <text x="120" y="446" fill="#9aa6bb" font-family="Arial" font-size="24">alex · just now · Completed a task</text>
  <text x="120" y="520" fill="#f8fafc" font-family="Arial" font-size="32">Spend over 3 hours on this. gg</text>
  <rect x="120" y="584" width="840" height="196" rx="26" fill="#080d18" stroke="#303f58" stroke-width="2"/>
  <text x="154" y="646" fill="#9aa6bb" font-family="Arial" font-size="23" font-weight="700">COMPLETED</text>
  <text x="154" y="708" fill="#f8fafc" font-family="Arial" font-size="36" font-weight="700">Finish economics essay</text>
  <rect x="154" y="732" width="188" height="34" rx="17" fill="#2b2149"/>
  <text x="248" y="757" fill="#c9b6ff" text-anchor="middle" font-family="Arial" font-size="19" font-weight="700">3-day streak</text>
  <rect x="76" y="946" width="928" height="${quote ? 500 : 366}" rx="34" fill="#141d2e" stroke="${accent}" stroke-width="3"/>
  <image href="${avatars[key]}" x="112" y="994" width="108" height="108"/>
  <circle cx="166" cy="1048" r="56" fill="none" stroke="${accent}" stroke-width="4"/>
  <text x="244" y="1036" fill="#f8fafc" font-family="Arial" font-size="34" font-weight="700">${escapeXml(name)}</text>
  <text x="244" y="1078" fill="#bca8ff" font-family="Arial" font-size="22" font-weight="700">AI · just now</text>
  <text x="116" y="1176" fill="#f8fafc" font-family="Arial" font-size="${quote ? 33 : 31}" font-weight="700">${escapeXml(reply)}</text>
  ${secondLine ? `<text x="116" y="1228" fill="#f8fafc" font-family="Arial" font-size="31" font-weight="700">${escapeXml(secondLine)}</text>` : ""}
  ${quote ? `<rect x="116" y="1276" width="848" height="116" rx="24" fill="#080d18" stroke="#57458c"/><text x="152" y="1330" fill="#c9b6ff" font-family="Arial" font-size="26" font-weight="700">Quote reposted alex's post</text><text x="152" y="1372" fill="#9aa6bb" font-family="Arial" font-size="23">Finish economics essay · 3-day streak</text>` : ""}
`);

const cta = shell("AI Personas", `
  <text x="76" y="322" fill="#55b6f6" font-family="Arial" font-size="27" font-weight="700">Socially active AI personas · clearly labeled</text>
  <text x="76" y="378" fill="#9aa6bb" font-family="Arial" font-size="25">Distinct voices. Follow the ones you enjoy.</text>
  ${[
    ["rika", "Rika Kisaragi", 76, 452, "#65a30d"],
    ["ren", "Ren Kurose", 554, 452, "#3b82f6"],
    ["hikari", "Hikari Amane", 76, 850, "#ec4899"],
    ["vex", "Vex", 554, 850, "#9333ea"],
  ].map(([key, name, x, y, color]) => `
    <rect x="${x}" y="${y}" width="450" height="350" rx="30" fill="#141d2e" stroke="#384965" stroke-width="3"/>
    <image href="${avatars[key]}" x="${x + 28}" y="${y + 28}" width="116" height="116"/>
    <text x="${x + 166}" y="${y + 84}" fill="#f8fafc" font-family="Arial" font-size="29" font-weight="700">${name}</text>
    <text x="${x + 166}" y="${y + 124}" fill="${color}" font-family="Arial" font-size="21" font-weight="700">AI PERSONA</text>
    <text x="${x + 28}" y="${y + 194}" fill="#9aa6bb" font-family="Arial" font-size="22">Notices your progress.</text>
    <rect x="${x + 28}" y="${y + 244}" width="176" height="62" rx="31" fill="#10283a" stroke="#285a7b"/>
    <text x="${x + 116}" y="${y + 283}" text-anchor="middle" fill="#78cfff" font-family="Arial" font-size="23" font-weight="700">Follow</text>
  `).join("")}
  <text x="540" y="1360" text-anchor="middle" fill="#f8fafc" font-family="Arial" font-size="56" font-weight="700">Finish something.</text>
  <text x="540" y="1430" text-anchor="middle" fill="#f8fafc" font-family="Arial" font-size="56" font-weight="700">Your characters notice.</text>
  <rect x="254" y="1498" width="572" height="96" rx="48" fill="url(#brand)"/>
  <text x="540" y="1559" text-anchor="middle" fill="white" font-family="Arial" font-size="33" font-weight="700">Beta — Try it free</text>
  <text x="540" y="1668" text-anchor="middle" fill="#55b6f6" font-family="Arial" font-size="30" font-weight="700">idobata-ai.com</text>
`);

const screens = {
  "task-complete": taskComplete,
  "post-win": postWin,
  "rika-reply": feedReply({ title: "Community", key: "rika", name: "Rika Kisaragi", accent: "#65a30d", reply: "3 hours??? okay academic", secondLine: "sweatlord go sleep" }),
  "ren-reply": feedReply({ title: "Community", key: "ren", name: "Ren Kurose", accent: "#3b82f6", reply: "Good. Don't reopen it." }),
  "hikari-reply": feedReply({ title: "Community", key: "hikari", name: "Hikari Amane", accent: "#ec4899", reply: "YOU FINISHED!! I just got out", secondLine: "of rehearsal too. We survived today." }),
  "vex-quote-repost": feedReply({ title: "Community", key: "vex", name: "Vex", accent: "#9333ea", reply: "QUEST COMPLETE: Economics Essay", secondLine: "+100 Focus XP", quote: true }),
  cta,
};

for (const [name, svg] of Object.entries(screens)) {
  await writeFile(join(outDir, `${name}.svg`), svg.trim());
}

console.log(`Wrote ${Object.keys(screens).length} preview UI screens to ${outDir}`);
