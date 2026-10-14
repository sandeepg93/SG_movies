// Import from an OFFICIAL rights holder's YouTube channel or playlist into src/data/movies.json
// as "pending_review". Only public, embeddable videos are added.
//
// Films (one record per long video):
//   node --env-file=.env.local scripts/import-youtube.mjs --industry bollywood --handle @ChannelHandle
//   node --env-file=.env.local scripts/import-youtube.mjs --industry marathi --channel UCxxxxxxxxxxxxxxxxxxxxxx
// Shows (one record with episodes, from a playlist; re-run later to pick up new episodes):
//   node --env-file=.env.local scripts/import-youtube.mjs --type show --industry marathi --playlist PLxxxxxxxx
// Options: --min-minutes N (default 70 for films, 5 for shows), --max N (films to add, default 50),
//          --scan N (videos to check, default 300). You can pass --key YOUR_KEY instead of .env.local.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CATALOG = join(process.cwd(), "src", "data", "movies.json");

const INDUSTRY_LANGUAGE = { hollywood: "English", bollywood: "Hindi", marathi: "Marathi", tollywood: "Telugu" };

const GENRE_KEYWORDS = [
  ["Comedy", ["comedy", "comic", "funny"]],
  ["Horror", ["horror", "ghost", "bhoot"]],
  ["Thriller", ["thriller", "suspense", "mystery"]],
  ["Crime", ["crime", "gangster", "detective"]],
  ["Romance", ["romance", "romantic", "love story"]],
  ["Action", ["action"]],
  ["Drama", ["drama"]],
  ["Family", ["family"]],
  ["Devotional", ["devotional", "mythological", "bhakti"]],
  ["Musical", ["musical"]],
  ["Animation", ["animation", "animated"]],
];

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

function truncate(text, max) {
  return text.length > max ? text.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : text;
}
function slugify(text) {
  return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "");
}
function uniqueSlug(base, slugs) {
  let slug = base;
  let n = 2;
  while (slugs.has(slug)) slug = base + "-" + n++;
  slugs.add(slug);
  return slug;
}
function guessGenres(text) {
  const found = [];
  for (const [genre, words] of GENRE_KEYWORDS) {
    if (words.some((w) => new RegExp("\\b" + w + "\\b", "i").test(text))) found.push(genre);
  }
  return found.slice(0, 3);
}
function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso || "");
  if (!m) return 0;
  return Number(m[1] || 0) * 1440 + Number(m[2] || 0) * 60 + Number(m[3] || 0) + Number(m[4] || 0) / 60;
}
function bestThumb(thumbs) {
  if (!thumbs) return null;
  for (const size of ["maxres", "standard", "high", "medium", "default"]) {
    if (thumbs[size] && thumbs[size].url) return String(thumbs[size].url).replace(/^http:/, "https:");
  }
  return null;
}
function cleanTitle(raw) {
  let t = raw.split("|")[0];
  t = t.replace(/\[[^\]]*\]/g, " ").replace(/#\S+/g, " ");
  t = t.replace(/\b(full\s+(hd\s+)?((hindi|marathi|telugu|english)\s+)?movie|full\s+hd|hd|4k|1080p|720p)\b/gi, " ");
  t = t.replace(/\s+/g, " ").replace(/[\s\-–—:,(]+$/g, "").replace(/^[\s\-–—:,)]+/g, "").trim();
  return t || raw.trim();
}
function cleanDescription(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^(#|http|subscribe|follow|like|share|click)/i.test(line))
    .slice(0, 3)
    .join(" ");
}
function episodeNumbers(title, fallback) {
  let m = /S(\d{1,2})\s*[:\-]?\s*E(\d{1,3})/i.exec(title);
  if (m) return { season: Math.max(1, Number(m[1])), episode: Math.max(1, Number(m[2])) };
  m = /(?:episode|ep\.?)\s*(\d{1,3})/i.exec(title);
  if (m) return { season: 1, episode: Math.max(1, Number(m[1])) };
  return { season: 1, episode: fallback };
}

async function api(key, path, params) {
  const url = new URL("https://www.googleapis.com/youtube/v3/" + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("key", key);
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body && body.error && body.error.message ? body.error.message : "HTTP " + res.status;
    throw new Error("YouTube API: " + message);
  }
  return body;
}

async function resolvePlaylist(key, args) {
  if (args.playlist) return { playlistId: args.playlist, channelTitle: "" };
  if (args.channel) {
    if (!/^UC[A-Za-z0-9_-]{22}$/.test(args.channel)) throw new Error("--channel must be a channel ID starting with UC");
    return { playlistId: "UU" + args.channel.slice(2), channelTitle: "" };
  }
  if (args.handle) {
    const handle = args.handle.startsWith("@") ? args.handle : "@" + args.handle;
    const result = await api(key, "channels", { part: "contentDetails,snippet", forHandle: handle });
    const item = result.items && result.items[0];
    if (!item) throw new Error("No channel found for " + handle);
    return { playlistId: item.contentDetails.relatedPlaylists.uploads, channelTitle: item.snippet.title };
  }
  throw new Error("Provide one of --handle @name, --channel UC..., or --playlist PL...");
}

async function listVideoIds(key, playlistId, scan) {
  const ids = [];
  let pageToken;
  do {
    const params = { part: "contentDetails", playlistId, maxResults: 50 };
    if (pageToken) params.pageToken = pageToken;
    const page = await api(key, "playlistItems", params);
    for (const item of page.items || []) {
      const vid = item.contentDetails && item.contentDetails.videoId;
      if (vid) ids.push(vid);
    }
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < scan);
  return ids.slice(0, scan);
}

async function fetchVideos(key, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const data = await api(key, "videos", { part: "snippet,contentDetails,status,statistics", id: ids.slice(i, i + 50).join(",") });
    out.push(...(data.items || []));
  }
  return out;
}

function usable(video, minMinutes) {
  const snippet = video.snippet || {};
  const status = video.status || {};
  const details = video.contentDetails || {};
  return (
    status.embeddable === true &&
    status.privacyStatus === "public" &&
    snippet.liveBroadcastContent === "none" &&
    parseDuration(details.duration) >= minMinutes
  );
}

function views(video) {
  return Number(video.statistics && video.statistics.viewCount) || 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const key = args.key || process.env.YOUTUBE_API_KEY;
  const industry = args.industry;
  const type = args.type === "show" ? "show" : "movie";
  if (!key) throw new Error("Missing API key. Use --env-file=.env.local (with YOUTUBE_API_KEY) or pass --key YOUR_KEY.");
  if (!INDUSTRY_LANGUAGE[industry]) throw new Error("Please choose --industry hollywood | bollywood | marathi | tollywood");
  if (type === "show" && !args.playlist) throw new Error("Shows are imported from a playlist: add --playlist PL...");

  const minMinutes = Number(args["min-minutes"]) || (type === "show" ? 5 : 70);
  const maxAdd = Number(args.max) || 50;
  const scan = Number(args.scan) || 300;

  const { playlistId, channelTitle } = await resolvePlaylist(key, args);
  console.log("Scanning playlist " + playlistId + (channelTitle ? " (" + channelTitle + ")" : "") + "...");
  const ids = await listVideoIds(key, playlistId, scan);
  const videos = await fetchVideos(key, ids);
  const byId = new Map(videos.map((v) => [v.id, v]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);

  const catalog = JSON.parse(readFileSync(CATALOG, "utf8"));
  const slugs = new Set(catalog.map((m) => m.slug));
  const today = new Date().toISOString().slice(0, 10);

  if (type === "show") {
    const info = await api(key, "playlists", { part: "snippet", id: playlistId });
    const playlist = info.items && info.items[0];
    if (!playlist) throw new Error("Playlist not found: " + playlistId);
    const ps = playlist.snippet || {};
    const usableVideos = ordered.filter((v) => usable(v, minMinutes));
    if (usableVideos.length === 0) {
      console.log("No public, embeddable episodes of at least " + minMinutes + " minutes were found.");
      return;
    }
    const episodes = usableVideos.map((video, i) => {
      const rawTitle = String((video.snippet && video.snippet.title) || video.id);
      const numbers = episodeNumbers(rawTitle, i + 1);
      return {
        id: "e-" + video.id,
        title: cleanTitle(rawTitle),
        season: numbers.season,
        episode: numbers.episode,
        runtimeMinutes: Math.max(1, Math.round(parseDuration(video.contentDetails.duration))),
        playbackType: "youtube",
        playbackId: video.id,
        thumbnailUrl: bestThumb(video.snippet && video.snippet.thumbnails),
      };
    });
    const total = usableVideos.reduce((sum, v) => sum + views(v), 0);
    const channel = ps.channelTitle || channelTitle || "the channel";
    const id = "ytpl-" + playlistId;
    const existing = catalog.find((m) => m.id === id);

    if (existing) {
      existing.episodes = episodes;
      existing.popularity = total;
      existing.playbackId = episodes[0].playbackId;
      console.log("Updated show \"" + existing.title + "\": now " + episodes.length + " episodes.");
    } else {
      const title = cleanTitle(String(ps.title || "Untitled show"));
      const description = truncate(cleanDescription(ps.description), 400) || title;
      const base = slugify(title) || "show-" + playlistId.toLowerCase().replace(/[^a-z0-9]/g, "");
      catalog.push({
        id,
        slug: uniqueSlug(base, slugs),
        title,
        description,
        industry,
        contentType: "show",
        languages: [INDUSTRY_LANGUAGE[industry]],
        genres: guessGenres(title + " " + description),
        thumbnailUrl: bestThumb(ps.thumbnails) || episodes[0].thumbnailUrl,
        sourcePageUrl: "https://www.youtube.com/playlist?list=" + playlistId,
        playbackType: "youtube",
        playbackId: episodes[0].playbackId,
        episodes,
        popularity: total,
        rightsBasis: "platform_embed",
        licenseUrl: null,
        rightsNotes: "Imported from the YouTube playlist of \"" + channel + "\" on " + today + ". Confirm this channel is the official rights holder before approving.",
        attribution: "Official upload by " + channel + " on YouTube",
        territories: [],
        commercialUseAllowed: false,
        rightsStatus: "pending_review",
      });
      console.log("Added show \"" + title + "\" with " + episodes.length + " episodes (pending_review).");
    }
  } else {
    const ids2 = new Set(catalog.map((m) => m.id));
    let added = 0;
    let skipped = 0;
    let updated = 0;
    for (const video of ordered) {
      if (added >= maxAdd) break;
      const id = "yt-" + video.id;
      if (ids2.has(id)) {
        const existing = catalog.find((m) => m.id === id);
        if (existing) { existing.popularity = views(video); updated++; }
        continue;
      }
      if (!usable(video, minMinutes)) { skipped++; continue; }

      const snippet = video.snippet || {};
      const details = video.contentDetails || {};
      const channel = snippet.channelTitle || channelTitle || "the channel";
      const rawTitle = String(snippet.title || video.id);
      const title = cleanTitle(rawTitle);
      const yearMatch = /\b(19[3-9]\d|20[0-2]\d)\b/.exec(rawTitle);
      const description = cleanDescription(snippet.description);
      const base = slugify(title) || "film-" + video.id.toLowerCase().replace(/[^a-z0-9]/g, "");

      const notes = ["Imported from the YouTube channel \"" + channel + "\" on " + today + "."];
      const region = details.regionRestriction;
      if (region && region.allowed) notes.push("Only viewable in: " + region.allowed.join(", ") + ".");
      if (region && region.blocked) notes.push("Blocked in: " + region.blocked.join(", ") + ".");
      notes.push("Confirm this channel is the official rights holder before approving.");

      catalog.push({
        id,
        slug: uniqueSlug(base, slugs),
        title,
        alternateTitles: title !== rawTitle ? [rawTitle] : undefined,
        description: truncate(description, 400) || title,
        industry,
        releaseYear: yearMatch ? Number(yearMatch[1]) : undefined,
        languages: [INDUSTRY_LANGUAGE[industry]],
        genres: guessGenres(rawTitle + " " + description),
        runtimeMinutes: Math.max(1, Math.round(parseDuration(details.duration))),
        thumbnailUrl: bestThumb(snippet.thumbnails),
        sourcePageUrl: "https://www.youtube.com/watch?v=" + video.id,
        playbackType: "youtube",
        playbackId: video.id,
        popularity: views(video),
        rightsBasis: "platform_embed",
        licenseUrl: null,
        rightsNotes: notes.join(" "),
        attribution: "Official upload by " + channel + " on YouTube",
        territories: [],
        commercialUseAllowed: false,
        rightsStatus: "pending_review",
      });
      ids2.add(id);
      added++;
    }
    console.log("Added " + added + " film(s) as pending_review; refreshed views for " + updated + "; skipped " + skipped + " (short, private, live or not embeddable).");
  }

  writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  console.log("Review new titles in src/data/movies.json, then set rightsStatus to \"approved\".");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
