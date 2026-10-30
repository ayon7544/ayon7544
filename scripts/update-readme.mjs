// Rebuilds the project vault, "recently shipped" list and orbit graphic from your real GitHub repos.
// Source of truth: each repo's About description + topics. Tag a repo with the topic `showcase` to include it.
import fs from "node:fs";

const cfg = JSON.parse(fs.readFileSync("projects.config.json", "utf8"));
const PAT = process.env.GH_PAT;          // optional: personal token (lets private repos you list in includePrivate show up)
const TOKEN = PAT || process.env.GH_TOKEN;
const H = { Accept: "application/vnd.github+json", "User-Agent": "profile-readme-bot", ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) };

async function gh(path) {
  const r = await fetch(`https://api.github.com${path}`, { headers: H });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
}

async function listRepos() {
  if (process.env.REPOS_JSON) return JSON.parse(fs.readFileSync(process.env.REPOS_JSON, "utf8"));
  const out = [];
  for (let page = 1; ; page++) {
    const path = PAT
      ? `/user/repos?affiliation=${cfg.affiliation || "owner"}&per_page=100&page=${page}&sort=pushed`
      : `/users/${cfg.username}/repos?per_page=100&page=${page}&sort=pushed`;
    const batch = await gh(path);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const ov = cfg.overrides || {};

function category(r) {
  if (ov[r.name]?.category) return ov[r.name].category;
  const t = r.topics || [];
  if (t.some((x) => ["react-native", "expo", "mobile", "android", "ios"].includes(x))) return "mobile";
  if (t.some((x) => ["esp32", "iot", "arduino", "gis", "postgis", "hardware", "competitive-programming"].includes(x))) return "lab";
  return "web";
}

const SKIP_TOPICS = new Set([cfg.includeTopic, "web", "mobile", "lab"]);
function ago(iso) {
  const d = Math.max(0, (Date.now() - new Date(iso).getTime()) / 864e5);
  if (d < 1) return "today";
  if (d < 2) return "yesterday";
  if (d < 30) return `${Math.floor(d)} days ago`;
  if (d < 365) return `${Math.floor(d / 30)} mo ago`;
  return `${Math.floor(d / 365)} yr ago`;
}

async function languagesOf(r) {
  if (r.languages_mock) return r.languages_mock;
  try {
    const l = await gh(`/repos/${r.full_name}/languages`);
    return Object.entries(l).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  } catch { return r.language ? [r.language] : []; }
}

const repos = await listRepos();
const allowPrivate = (r) => cfg.includePrivate === true || (Array.isArray(cfg.includePrivate) && cfg.includePrivate.includes(r.name));
if (cfg.includePrivate && !PAT && !process.env.REPOS_JSON) console.warn("includePrivate is on but GH_PAT secret is missing: private repos can't be read.");
const picked = repos.filter((r) =>
  !r.fork && !r.archived &&
  ((r.topics || []).includes(cfg.includeTopic) || ov[r.name]) &&
  (!r.private || allowPrivate(r)));

if (!picked.length) {
  console.log(`No repos tagged "${cfg.includeTopic}" yet. Leaving README untouched.`);
  process.exit(0);
}

const items = [];
for (const r of picked) {
  const o = ov[r.name] || {};
  const langs = await languagesOf(r);
  const topics = (r.topics || []).filter((t) => !SKIP_TOPICS.has(t));
  const stack = [...new Set([...langs, ...topics])].slice(0, 5).map((s) => `\`${s}\``).join(" ");
  const title = o.title || r.name;
  items.push({
    cat: category(r), title, emoji: o.emoji || "📦",
    url: r.private ? null : r.html_url,
    desc: o.description || r.description || "_Add a description in this repo's About box and it will appear here._",
    stack, stars: r.stargazers_count || 0, pushed: r.pushed_at, private: !!r.private,
    initials: (o.emoji && o.emoji !== "📦") ? o.emoji : title.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase(),
  });
}

// ---------- Project vault ----------
let vault = `> 🔄 **${items.length} projects tracked live** · last sync ${new Date().toISOString().slice(0, 10)}\n\n`;
for (const [key, c] of Object.entries(cfg.categories)) {
  const list = items.filter((i) => i.cat === key).sort((a, b) => new Date(b.pushed) - new Date(a.pushed));
  if (!list.length) continue;
  vault += `<details open>\n<summary><b>${c.title}</b> (${list.length})</summary>\n<br/>\n\n| Project | What it does | Stack | ⭐ | Last push |\n|---|---|---|---|---|\n`;
  for (const i of list) {
    const name = i.url ? `[${cell(i.title)}](${i.url})` : `${cell(i.title)} 🔒`;
    vault += `| ${i.emoji} **${name}** | ${cell(i.desc)} | ${i.stack || "-"} | ${i.stars} | ${ago(i.pushed)} |\n`;
  }
  vault += `\n</details>\n\n`;
}

// ---------- Recently shipped ----------
const recent = [...items].sort((a, b) => new Date(b.pushed) - new Date(a.pushed)).slice(0, 5)
  .map((i) => `- ${i.emoji} **${i.url ? `[${cell(i.title)}](${i.url})` : `${cell(i.title)} 🔒`}**: pushed ${ago(i.pushed)}`).join("\n");

// ---------- Orbit SVG ----------
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function orbitSvg() {
  const W = 900, H2 = 760, cx = 450, cy = 380, R = rng(7);
  let stars = "";
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(R() * (W - 10)) + 5, y = Math.floor(R() * (H2 - 10)) + 5, r = (0.6 + R() * 1.2).toFixed(1), d = (2 + R() * 3).toFixed(1), b = (R() * 4).toFixed(1);
    stars += `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="0.2"><animate attributeName="opacity" values="0.1;0.9;0.1" dur="${d}s" begin="${b}s" repeatCount="indefinite"/></circle>`;
  }
  let body = "";
  Object.entries(cfg.categories).forEach(([key, c], oi) => {
    const list = items.filter((i) => i.cat === key).slice(0, 9);
    body += `<circle cx="${cx}" cy="${cy}" r="${c.radius}" fill="none" stroke="${c.color}" stroke-opacity="0.35" stroke-dasharray="4 8"/>\n`;
    const dur = (30 + oi * 25) * 4;
    list.forEach((it, i) => {
      const a = Math.round((360 * i) / list.length + oi * 25), pr = oi < 2 ? 24 : 22;
      const label = esc(it.title.length > 14 ? it.title.slice(0, 13) + "…" : it.title);
      body += `<g><animateTransform attributeName="transform" type="rotate" from="${a} ${cx} ${cy}" to="${a + 360} ${cx} ${cy}" dur="${dur}s" repeatCount="indefinite"/>
<g transform="translate(${cx + c.radius},${cy})"><g><animateTransform attributeName="transform" type="rotate" from="${-a} 0 0" to="${-a - 360} 0 0" dur="${dur}s" repeatCount="indefinite"/>
<circle r="${pr + 8}" fill="${c.color}" opacity="0.12"><animate attributeName="r" values="${pr + 4};${pr + 11};${pr + 4}" dur="3s" begin="${(i * 0.4).toFixed(1)}s" repeatCount="indefinite"/></circle>
<circle r="${pr}" fill="#0b1226" stroke="${c.color}" stroke-width="2"/>
<text y="5" text-anchor="middle" font-size="14" font-weight="700" font-family="Segoe UI, Arial, sans-serif" fill="${c.color}">${esc(it.initials)}</text>
<text y="${pr + 17}" text-anchor="middle" font-size="12.5" font-family="Segoe UI, Arial, sans-serif" fill="#e2e8f0">${label}</text>
</g></g></g>\n`;
    });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H2}" width="${W}" height="${H2}">
<defs><radialGradient id="bg" cx="50%" cy="50%" r="70%"><stop offset="0" stop-color="#14204a"/><stop offset="1" stop-color="#04060f"/></radialGradient>
<radialGradient id="sun"><stop offset="0" stop-color="#fff7d6"/><stop offset="0.5" stop-color="#38bdf8"/><stop offset="1" stop-color="#1e3a8a"/></radialGradient>
<clipPath id="rr"><rect width="${W}" height="${H2}" rx="24"/></clipPath></defs>
<g clip-path="url(#rr)"><rect width="${W}" height="${H2}" fill="url(#bg)"/>${stars}
<text x="${W / 2}" y="46" text-anchor="middle" font-size="26" font-weight="800" letter-spacing="6" font-family="Segoe UI, Arial, sans-serif" fill="#e2e8f0">THE DEVELOPER UNIVERSE</text>
<text x="${W / 2}" y="70" text-anchor="middle" font-size="12" letter-spacing="3" font-family="monospace" fill="#64748b">${items.length} PROJECTS · SYNCED ${new Date().toISOString().slice(0, 10)}</text>
${body}
<circle cx="${cx}" cy="${cy}" r="62" fill="#38bdf8" opacity="0.18"><animate attributeName="r" values="56;76;56" dur="4s" repeatCount="indefinite"/></circle>
<circle cx="${cx}" cy="${cy}" r="44" fill="url(#sun)"/>
<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="15" font-weight="800" font-family="Segoe UI, Arial, sans-serif" fill="#04060f">AYON</text>
<g font-family="monospace" font-size="12" transform="translate(30,${H2 - 70})">
<circle cx="6" cy="6" r="6" fill="#38bdf8"/><text x="20" y="10" fill="#cbd5e1">Inner orbit: web platforms &amp; backends</text>
<circle cx="6" cy="28" r="6" fill="#a78bfa"/><text x="20" y="32" fill="#cbd5e1">Middle orbit: mobile apps</text>
<circle cx="6" cy="50" r="6" fill="#f472b6"/><text x="20" y="54" fill="#cbd5e1">Outer orbit: labs, hardware, GIS &amp; problem solving</text></g></g>
<rect x="1" y="1" width="${W - 2}" height="${H2 - 2}" rx="24" fill="none" stroke="#38bdf8" stroke-opacity="0.3"/></svg>`;
}

// ---------- Write ----------
function replaceBlock(src, name, content) {
  const re = new RegExp(`(<!--${name}:START-->)[\\s\\S]*?(<!--${name}:END-->)`);
  return re.test(src) ? src.replace(re, (_, a, b) => `${a}\n${content}\n${b}`) : src;
}
let readme = fs.readFileSync("README.md", "utf8");
readme = replaceBlock(readme, "PROJECTS", vault.trim());
readme = replaceBlock(readme, "RECENT", recent);
fs.writeFileSync("README.md", readme);
fs.mkdirSync("assets", { recursive: true });
fs.writeFileSync("assets/universe.svg", orbitSvg());
console.log(`Updated README + orbit with ${items.length} projects.`);
