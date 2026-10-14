// Updates "popularity" for every title in src/data/movies.json:
//   Internet Archive titles -> total downloads, YouTube titles -> view count (shows: sum of episodes).
// Usage:
//   node scripts/refresh-popularity.mjs                              (Internet Archive only)
//   node --env-file=.env.local scripts/refresh-popularity.mjs        (also YouTube, if YOUTUBE_API_KEY is set)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CATALOG = join(process.cwd(), "src", "data", "movies.json");

function sourcesOf(movie) {
  const list = [movie];
  if (Array.isArray(movie.episodes)) list.push(...movie.episodes);
  return list;
}

async function archiveDownloads(ids) {
  const result = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const params = new URLSearchParams();
    params.set("q", "identifier:(" + batch.map((id) => '"' + id + '"').join(" OR ") + ")");
    params.append("fl[]", "identifier");
    params.append("fl[]", "downloads");
    params.set("rows", String(batch.length));
    params.set("output", "json");
    const res = await fetch("https://archive.org/advancedsearch.php?" + params.toString(), {
      headers: { "User-Agent": "OpenReel popularity refresh" },
    });
    if (!res.ok) throw new Error("Internet Archive returned HTTP " + res.status);
    const data = await res.json();
    const docs = data && data.response && Array.isArray(data.response.docs) ? data.response.docs : [];
    for (const doc of docs) result.set(String(doc.identifier), Number(doc.downloads) || 0);
  }
  return result;
}

async function youtubeViews(key, ids) {
  const result = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "statistics");
    url.searchParams.set("id", ids.slice(i, i + 50).join(","));
    url.searchParams.set("key", key);
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error("YouTube API: " + (body.error && body.error.message ? body.error.message : "HTTP " + res.status));
    for (const item of body.items || []) result.set(item.id, Number(item.statistics && item.statistics.viewCount) || 0);
  }
  return result;
}

async function main() {
  const catalog = JSON.parse(readFileSync(CATALOG, "utf8"));
  const archiveIds = new Set();
  const youtubeIds = new Set();
  for (const movie of catalog) {
    for (const s of sourcesOf(movie)) {
      if (s.playbackType === "archive" && s.playbackId) archiveIds.add(s.playbackId);
      if (s.playbackType === "youtube" && s.playbackId) youtubeIds.add(s.playbackId);
    }
  }

  console.log("Fetching Internet Archive download counts for " + archiveIds.size + " item(s)...");
  const downloads = archiveIds.size > 0 ? await archiveDownloads([...archiveIds]) : new Map();

  const key = process.env.YOUTUBE_API_KEY;
  let viewsMap = new Map();
  if (youtubeIds.size > 0 && key) {
    console.log("Fetching YouTube view counts for " + youtubeIds.size + " video(s)...");
    viewsMap = await youtubeViews(key, [...youtubeIds]);
  } else if (youtubeIds.size > 0) {
    console.log("Skipping YouTube (no YOUTUBE_API_KEY). Run with --env-file=.env.local to include it.");
  }

  let updated = 0;
  for (const movie of catalog) {
    const isShow = movie.contentType === "show" && Array.isArray(movie.episodes) && movie.episodes.length > 0;
    const sources = isShow ? movie.episodes : [movie];
    let total = 0;
    let found = false;
    for (const s of sources) {
      if (s.playbackType === "archive" && downloads.has(s.playbackId)) { total += downloads.get(s.playbackId); found = true; }
      if (s.playbackType === "youtube" && viewsMap.has(s.playbackId)) { total += viewsMap.get(s.playbackId); found = true; }
    }
    if (found) {
      movie.popularity = total;
      updated++;
    }
  }

  writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  const top = [...catalog].sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 5);
  console.log("Updated popularity for " + updated + " title(s). Top trending:");
  for (const m of top) console.log("  " + (m.popularity || 0).toLocaleString("en-IN").padStart(12) + "  " + m.title);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
