// Discover candidate films on the Internet Archive and add them to src/data/movies.json
// as "pending_review". Nothing becomes public until you review and approve each record.
//
// Usage (run from the project folder):
//   node scripts/import-archive.mjs --industry hollywood
//   node scripts/import-archive.mjs --industry hollywood --rows 50 --page 2
//   node scripts/import-archive.mjs --industry bollywood
//   node scripts/import-archive.mjs --industry hollywood --query "collection:(feature_films) AND year:[1930 TO 1950]"
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CATALOG = join(process.cwd(), "src", "data", "movies.json");

const INDUSTRY_DEFAULTS = {
  hollywood: { language: "English", query: "collection:(feature_films) AND mediatype:(movies)" },
  bollywood: { language: "Hindi", query: "mediatype:(movies) AND language:(Hindi OR hin)" },
  marathi: { language: "Marathi", query: "mediatype:(movies) AND language:(Marathi OR mar)" },
  tollywood: { language: "Telugu", query: "mediatype:(movies) AND language:(Telugu OR tel)" },
};

const GENRE_KEYWORDS = [
  ["Comedy", ["comedy", "comic", "funny"]],
  ["Horror", ["horror", "ghost", "zombie", "vampire", "bhoot"]],
  ["Thriller", ["thriller", "suspense", "mystery"]],
  ["Crime", ["crime", "gangster", "detective", "noir"]],
  ["Romance", ["romance", "romantic", "love story"]],
  ["Action", ["action", "martial arts"]],
  ["Drama", ["drama"]],
  ["Family", ["family"]],
  ["Science Fiction", ["science fiction", "sci-fi", "alien", "space"]],
  ["Western", ["western", "cowboy"]],
  ["Musical", ["musical"]],
  ["Devotional", ["devotional", "mythological", "bhakti"]],
  ["Documentary", ["documentary"]],
  ["Animation", ["animation", "animated", "cartoon"]],
  ["War", ["war"]],
];

const LANGUAGE_NAMES = {
  eng: "English", english: "English", hin: "Hindi", hindi: "Hindi", mar: "Marathi", marathi: "Marathi",
  tel: "Telugu", telugu: "Telugu", tam: "Tamil", tamil: "Tamil", ben: "Bengali", bengali: "Bengali",
  ger: "German", deu: "German", german: "German", fre: "French", fra: "French", french: "French",
  rus: "Russian", russian: "Russian", spa: "Spanish", spanish: "Spanish", ita: "Italian", jpn: "Japanese",
};

function parseArgs(list) {
  const out = {};
  for (let i = 0; i < list.length; i++) {
    const arg = list[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = list[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = "true";
    else { out[key] = next; i++; }
  }
  return out;
}

function first(value) { return Array.isArray(value) ? value[0] : value; }
function asText(value) {
  if (Array.isArray(value)) return value.map(String).join(" ");
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}
function cleanText(value) {
  return asText(value).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}
function truncate(text, max) {
  return text.length > max ? text.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : text;
}
function slugify(text) {
  return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "");
}
function guessGenres(text) {
  const found = [];
  for (const [genre, words] of GENRE_KEYWORDS) {
    if (words.some((w) => new RegExp("\\b" + w + "\\b", "i").test(text))) found.push(genre);
  }
  return found.slice(0, 3);
}
function languagesFrom(value, fallback) {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[;,]/) : [];
  const names = raw.map((v) => String(v).trim()).filter(Boolean)
    .map((v) => LANGUAGE_NAMES[v.toLowerCase()] || v.charAt(0).toUpperCase() + v.slice(1));
  const unique = [...new Set(names)];
  return unique.length > 0 ? unique : [fallback];
}
function parseRuntime(value) {
  const text = asText(value).trim();
  let minutes;
  let m = /^(\d+):(\d{2}):(\d{2})$/.exec(text);
  if (m) minutes = Number(m[1]) * 60 + Number(m[2]);
  else if ((m = /^(\d+):(\d{2})$/.exec(text))) minutes = Number(m[1]);
  else if ((m = /(\d+)\s*min/i.exec(text))) minutes = Number(m[1]);
  else if ((m = /^(\d+)$/.exec(text))) minutes = Number(m[1]);
  return minutes && minutes > 0 ? Math.round(minutes) : undefined;
}
function releaseFrom(doc) {
  const date = asText(first(doc.date));
  const yearText = asText(first(doc.year));
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  const thisYear = new Date().getFullYear();
  if (d && !(d[2] === "01" && d[3] === "01") && Number(d[2]) >= 1 && Number(d[2]) <= 12 && Number(d[1]) > 1870 && Number(d[1]) <= thisYear) {
    return { releaseDate: d[1] + "-" + d[2] };
  }
  const y = /^(\d{4})/.exec(yearText || date);
  if (y && Number(y[1]) > 1870 && Number(y[1]) <= thisYear) return { releaseYear: Number(y[1]) };
  return {};
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const industry = args.industry;
  const defaults = INDUSTRY_DEFAULTS[industry];
  if (!defaults) {
    console.error("Please choose --industry hollywood | bollywood | marathi | tollywood");
    process.exit(1);
  }
  const rows = Math.min(Math.max(Number(args.rows) || 30, 1), 200);
  const page = Math.max(Number(args.page) || 1, 1);
  const query = args.query || defaults.query;

  const params = new URLSearchParams();
  params.set("q", query);
  for (const field of ["identifier", "title", "description", "date", "year", "language", "subject", "licenseurl", "runtime"]) {
    params.append("fl[]", field);
  }
  params.append("sort[]", "downloads desc");
  params.set("rows", String(rows));
  params.set("page", String(page));
  params.set("output", "json");

  console.log("Searching the Internet Archive: " + query);
  const res = await fetch("https://archive.org/advancedsearch.php?" + params.toString(), {
    headers: { "User-Agent": "OpenReel catalog importer" },
  });
  if (!res.ok) throw new Error("Internet Archive returned HTTP " + res.status);
  const data = await res.json();
  const docs = data && data.response && Array.isArray(data.response.docs) ? data.response.docs : [];

  const catalog = JSON.parse(readFileSync(CATALOG, "utf8"));
  const ids = new Set(catalog.map((m) => m.id));
  const slugs = new Set(catalog.map((m) => m.slug));
  const playbackIds = new Set(catalog.map((m) => m.playbackId).filter(Boolean));
  const today = new Date().toISOString().slice(0, 10);
  let added = 0;

  for (const doc of docs) {
    const identifier = asText(first(doc.identifier));
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(identifier)) continue;
    const id = "ia-" + identifier;
    if (ids.has(id) || playbackIds.has(identifier)) continue;

    const title = cleanText(first(doc.title)) || identifier;
    const description = truncate(cleanText(doc.description), 400) || title;
    const release = releaseFrom(doc);
    let licenseUrl = asText(first(doc.licenseurl)).trim().replace(/^http:/, "https:");
    if (!/^https:\/\/\S+$/.test(licenseUrl)) licenseUrl = null;
    const isCreativeCommons = licenseUrl !== null && licenseUrl.includes("creativecommons.org/licenses");

    const year = release.releaseYear || (release.releaseDate ? Number(release.releaseDate.slice(0, 4)) : undefined);
    const base = (slugify(title) || "film") + (year ? "-" + year : "");
    let slug = base;
    let n = 2;
    while (slugs.has(slug)) slug = base + "-" + n++;

    const record = {
      id,
      slug,
      title,
      description,
      industry,
      ...release,
      languages: languagesFrom(doc.language, defaults.language),
      genres: guessGenres(title + " " + cleanText(doc.subject) + " " + description),
      runtimeMinutes: parseRuntime(first(doc.runtime)),
      thumbnailUrl: "https://archive.org/services/img/" + identifier,
      sourcePageUrl: "https://archive.org/details/" + identifier,
      playbackType: "archive",
      playbackId: identifier,
      rightsBasis: isCreativeCommons ? "creative_commons" : "public_domain",
      licenseUrl,
      rightsNotes:
        "Imported from the Internet Archive on " + today + ". " +
        (licenseUrl ? "Item license: " + licenseUrl + "." : "No license on the item; the uploader's public-domain claim is unverified.") +
        " Verify before approving.",
      attribution: title + " via Internet Archive",
      territories: [],
      commercialUseAllowed: false,
      rightsStatus: "pending_review",
    };

    catalog.push(record);
    ids.add(id);
    slugs.add(slug);
    playbackIds.add(identifier);
    added++;
  }

  writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  console.log("Added " + added + " new film(s) as pending_review (" + (docs.length - added) + " skipped or already present).");
  console.log("Review them in src/data/movies.json, then set rightsStatus to \"approved\".");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
