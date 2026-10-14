import type { ContentType, Episode, Industry, Movie } from "@/types/movie";
import type { RawRecord } from "@/types/admin";
import { INDUSTRIES } from "@/lib/industries";
import { validateRecord } from "@/lib/validation";
import { ARCHIVE_ID, YOUTUBE_ID, isAllowedDirectUrl } from "@/lib/media";
import { extractArchiveId, extractYouTubeId, parseYouTubeTarget, slugify } from "@/lib/admin/parse";
import { todayIso } from "@/lib/admin/form";

// ---------- shared helpers ----------

const GENRE_KEYWORDS: [string, string[]][] = [
  ["Comedy", ["comedy", "comic", "funny"]],
  ["Horror", ["horror", "ghost", "zombie", "vampire", "bhoot"]],
  ["Thriller", ["thriller", "suspense", "mystery"]],
  ["Crime", ["crime", "gangster", "detective", "noir"]],
  ["Romance", ["romance", "romantic", "love story"]],
  ["Action", ["action", "martial arts"]],
  ["Drama", ["drama"]],
  ["Family", ["family"]],
  ["Science Fiction", ["science fiction", "sci-fi", "alien"]],
  ["Western", ["western", "cowboy"]],
  ["Musical", ["musical"]],
  ["Devotional", ["devotional", "mythological", "bhakti"]],
  ["Documentary", ["documentary"]],
  ["Animation", ["animation", "animated", "cartoon"]],
  ["War", ["war"]],
];

const LANGUAGE_NAMES: Record<string, string> = {
  eng: "English", english: "English", hin: "Hindi", hindi: "Hindi", mar: "Marathi", marathi: "Marathi",
  tel: "Telugu", telugu: "Telugu", tam: "Tamil", tamil: "Tamil", ben: "Bengali", bengali: "Bengali",
  ger: "German", deu: "German", german: "German", fre: "French", fra: "French", french: "French",
  rus: "Russian", russian: "Russian", spa: "Spanish", spanish: "Spanish", ita: "Italian", jpn: "Japanese",
};

const ARCHIVE_DEFAULT_QUERY: Record<Industry, string> = {
  hollywood: "collection:(feature_films) AND mediatype:(movies)",
  bollywood: "mediatype:(movies) AND language:(Hindi OR hin)",
  marathi: "mediatype:(movies) AND language:(Marathi OR mar)",
  tollywood: "mediatype:(movies) AND language:(Telugu OR tel)",
};

function languageFor(industry: Industry): string {
  const info = INDUSTRIES.find((i) => i.value === industry);
  return info ? info.language : "English";
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function asText(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join(" ");
  if (value === undefined || value === null) return "";
  return String(value);
}

function cleanText(value: unknown): string {
  return asText(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : text;
}

export function guessGenres(text: string): string[] {
  const found: string[] = [];
  for (const [genre, words] of GENRE_KEYWORDS) {
    if (words.some((w) => new RegExp("\\b" + w + "\\b", "i").test(text))) found.push(genre);
  }
  return found.slice(0, 3);
}

function languagesFrom(value: unknown, fallback: string): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[;,]/) : [];
  const names = raw
    .map((v) => String(v).trim())
    .filter(Boolean)
    .map((v) => LANGUAGE_NAMES[v.toLowerCase()] || v.charAt(0).toUpperCase() + v.slice(1));
  const unique = Array.from(new Set(names));
  return unique.length > 0 ? unique : [fallback];
}

function parseRuntimeText(value: unknown): number | undefined {
  const text = asText(value).trim();
  let minutes = 0;
  let m = /^(\d+):(\d{2}):(\d{2})$/.exec(text);
  if (m) minutes = Number(m[1]) * 60 + Number(m[2]);
  else if ((m = /^(\d+):(\d{2})$/.exec(text))) minutes = Number(m[1]);
  else if ((m = /(\d+)\s*min/i.exec(text))) minutes = Number(m[1]);
  else if ((m = /^(\d+)$/.exec(text))) minutes = Number(m[1]);
  return minutes > 0 ? Math.round(minutes) : undefined;
}

function releaseFrom(dateValue: unknown, yearValue: unknown): { releaseDate?: string; releaseYear?: number } {
  const date = asText(first(dateValue));
  const yearText = asText(first(yearValue));
  const thisYear = new Date().getFullYear();
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (d && !(d[2] === "01" && d[3] === "01") && Number(d[2]) >= 1 && Number(d[2]) <= 12 && Number(d[1]) > 1870 && Number(d[1]) <= thisYear) {
    return { releaseDate: d[1] + "-" + d[2] };
  }
  const y = /^(\d{4})/.exec(yearText || date);
  if (y && Number(y[1]) > 1870 && Number(y[1]) <= thisYear) return { releaseYear: Number(y[1]) };
  return {};
}

function parseDuration(iso?: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso || "");
  if (!m) return 0;
  return Number(m[1] || 0) * 1440 + Number(m[2] || 0) * 60 + Number(m[3] || 0) + Number(m[4] || 0) / 60;
}

function cleanTitle(raw: string): string {
  let t = raw.split("|")[0];
  t = t.replace(/\[[^\]]*\]/g, " ").replace(/#\S+/g, " ");
  t = t.replace(/\b(full\s+(hd\s+)?((hindi|marathi|telugu|english)\s+)?movie|full\s+hd|hd|4k|1080p|720p)\b/gi, " ");
  t = t.replace(/\s+/g, " ").replace(/[\s\-–—:,(]+$/g, "").replace(/^[\s\-–—:,)]+/g, "").trim();
  return t || raw.trim();
}

function cleanDescription(text: string | undefined): string {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^(#|http|subscribe|follow|like|share|click)/i.test(line))
    .slice(0, 3)
    .join(" ");
}

function episodeNumbers(title: string, fallback: number): { season: number; episode: number } {
  let m = /S(\d{1,2})\s*[:\-]?\s*E(\d{1,3})/i.exec(title);
  if (m) return { season: Math.max(1, Number(m[1])), episode: Math.max(1, Number(m[2])) };
  m = /(?:episode|ep\.?)\s*(\d{1,3})/i.exec(title);
  if (m) return { season: 1, episode: Math.max(1, Number(m[1])) };
  return { season: 1, episode: fallback };
}

// ---------- Internet Archive ----------

type ArchiveDoc = Record<string, unknown>;

function archiveDocToMovie(doc: ArchiveDoc, industry: Industry, today: string): Movie | null {
  const identifier = asText(first(doc.identifier));
  if (!ARCHIVE_ID.test(identifier)) return null;
  const title = cleanText(first(doc.title)) || identifier;
  const description = truncate(cleanText(doc.description), 400) || title;
  const release = releaseFrom(doc.date, doc.year);
  let licenseUrl: string | null = asText(first(doc.licenseurl)).trim().replace(/^http:/, "https:");
  if (!/^https:\/\/\S+$/.test(licenseUrl)) licenseUrl = null;
  const isCC = licenseUrl !== null && licenseUrl.includes("creativecommons.org/licenses");
  const year = release.releaseYear ?? (release.releaseDate ? Number(release.releaseDate.slice(0, 4)) : undefined);

  const movie: Movie = {
    id: "ia-" + identifier,
    slug: (slugify(title) || "film") + (year ? "-" + year : ""),
    title,
    description,
    industry,
    ...release,
    languages: languagesFrom(doc.language, languageFor(industry)),
    genres: guessGenres(title + " " + cleanText(doc.subject) + " " + description),
    thumbnailUrl: "https://archive.org/services/img/" + identifier,
    sourcePageUrl: "https://archive.org/details/" + identifier,
    playbackType: "archive",
    playbackId: identifier,
    rightsBasis: isCC ? "creative_commons" : "public_domain",
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
  const runtime = parseRuntimeText(first(doc.runtime));
  if (runtime) movie.runtimeMinutes = runtime;
  const downloads = Number(first(doc.downloads));
  if (downloads > 0) movie.popularity = downloads;
  return movie;
}

export async function fetchArchiveCandidates(opts: { industry: Industry; query?: string; rows?: number; page?: number }): Promise<Movie[]> {
  const params = new URLSearchParams();
  params.set("q", opts.query || ARCHIVE_DEFAULT_QUERY[opts.industry]);
  for (const field of ["identifier", "title", "description", "date", "year", "language", "subject", "licenseurl", "runtime", "downloads"]) {
    params.append("fl[]", field);
  }
  params.append("sort[]", "downloads desc");
  params.set("rows", String(opts.rows ?? 30));
  params.set("page", String(opts.page ?? 1));
  params.set("output", "json");
  const res = await fetch("https://archive.org/advancedsearch.php?" + params.toString(), {
    headers: { "User-Agent": "OpenReel admin importer" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Internet Archive search failed (HTTP " + res.status + ").");
  const data = (await res.json()) as { response?: { docs?: ArchiveDoc[] } };
  const docs = data.response && Array.isArray(data.response.docs) ? data.response.docs : [];
  const today = todayIso();
  const out: Movie[] = [];
  for (const doc of docs) {
    const movie = archiveDocToMovie(doc, opts.industry, today);
    if (movie) out.push(movie);
  }
  return out;
}

// ---------- YouTube ----------

interface YtThumbs {
  [size: string]: { url?: string } | undefined;
}
interface YtSnippet {
  title?: string;
  description?: string;
  channelTitle?: string;
  liveBroadcastContent?: string;
  thumbnails?: YtThumbs;
}
interface YtDetails {
  duration?: string;
  regionRestriction?: { allowed?: string[]; blocked?: string[] };
}
interface YtVideo {
  id: string;
  snippet?: YtSnippet;
  contentDetails?: YtDetails;
  status?: { embeddable?: boolean; privacyStatus?: string };
  statistics?: { viewCount?: string };
}
interface YtChannel {
  snippet?: { title?: string };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
}
interface YtPlaylist {
  snippet?: YtSnippet;
}
interface YtPlaylistItem {
  contentDetails?: { videoId?: string };
}
interface YtList<T> {
  items?: T[];
  nextPageToken?: string;
}

async function ytApi<T>(key: string, path: string, params: Record<string, string | number>): Promise<T> {
  const url = new URL("https://www.googleapis.com/youtube/v3/" + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("key", key);
  const res = await fetch(url, { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) throw new Error("YouTube API: " + (body.error && body.error.message ? body.error.message : "HTTP " + res.status));
  return body as unknown as T;
}

function bestThumb(thumbs: YtThumbs | undefined): string | undefined {
  if (!thumbs) return undefined;
  for (const size of ["maxres", "standard", "high", "medium", "default"]) {
    const t = thumbs[size];
    if (t && t.url) return t.url.replace(/^http:/, "https:");
  }
  return undefined;
}

function viewsOf(video: YtVideo): number {
  return Number(video.statistics && video.statistics.viewCount) || 0;
}

function usable(video: YtVideo, minMinutes: number): boolean {
  const snippet: YtSnippet = video.snippet ?? {};
  const details: YtDetails = video.contentDetails ?? {};
  return (
    video.status?.embeddable === true &&
    video.status?.privacyStatus === "public" &&
    snippet.liveBroadcastContent === "none" &&
    parseDuration(details.duration) >= minMinutes
  );
}

function videoToMovie(video: YtVideo, industry: Industry, channelFallback: string, today: string): Movie {
  const snippet: YtSnippet = video.snippet ?? {};
  const details: YtDetails = video.contentDetails ?? {};
  const channel = snippet.channelTitle || channelFallback || "the channel";
  const rawTitle = snippet.title || video.id;
  const title = cleanTitle(rawTitle);
  const description = truncate(cleanDescription(snippet.description), 400) || title;
  const notes = ["Imported from the YouTube channel \"" + channel + "\" on " + today + "."];
  const region = details.regionRestriction;
  if (region && region.allowed) notes.push("Only viewable in: " + region.allowed.join(", ") + ".");
  if (region && region.blocked) notes.push("Blocked in: " + region.blocked.join(", ") + ".");
  notes.push("Confirm this channel is the official rights holder before approving.");

  const movie: Movie = {
    id: "yt-" + video.id,
    slug: slugify(title) || "film-" + video.id.toLowerCase().replace(/[^a-z0-9]/g, ""),
    title,
    description,
    industry,
    languages: [languageFor(industry)],
    genres: guessGenres(rawTitle + " " + description),
    sourcePageUrl: "https://www.youtube.com/watch?v=" + video.id,
    playbackType: "youtube",
    playbackId: video.id,
    rightsBasis: "platform_embed",
    licenseUrl: null,
    rightsNotes: notes.join(" "),
    attribution: "Official upload by " + channel + " on YouTube",
    territories: [],
    commercialUseAllowed: false,
    rightsStatus: "pending_review",
  };
  if (title !== rawTitle) movie.alternateTitles = [rawTitle];
  const year = /\b(19[3-9]\d|20[0-2]\d)\b/.exec(rawTitle);
  if (year) movie.releaseYear = Number(year[1]);
  const minutes = Math.round(parseDuration(details.duration));
  if (minutes > 0) movie.runtimeMinutes = minutes;
  const thumb = bestThumb(snippet.thumbnails);
  if (thumb) movie.thumbnailUrl = thumb;
  const views = viewsOf(video);
  if (views > 0) movie.popularity = views;
  return movie;
}

async function listPlaylistVideoIds(key: string, playlistId: string, scan: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const params: Record<string, string | number> = { part: "contentDetails", playlistId, maxResults: 50 };
    if (pageToken) params.pageToken = pageToken;
    const page = await ytApi<YtList<YtPlaylistItem>>(key, "playlistItems", params);
    for (const item of page.items ?? []) {
      const vid = item.contentDetails?.videoId;
      if (vid) ids.push(vid);
    }
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < scan);
  return ids.slice(0, scan);
}

async function fetchVideos(key: string, ids: string[]): Promise<YtVideo[]> {
  const out: YtVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const data = await ytApi<YtList<YtVideo>>(key, "videos", {
      part: "snippet,contentDetails,status,statistics",
      id: ids.slice(i, i + 50).join(","),
    });
    out.push(...(data.items ?? []));
  }
  return out;
}

async function buildShow(key: string, playlistId: string, industry: Industry, minMinutes: number, scan: number): Promise<Movie> {
  const info = await ytApi<YtList<YtPlaylist>>(key, "playlists", { part: "snippet", id: playlistId });
  const playlist = info.items?.[0];
  if (!playlist) throw new Error("Playlist not found: " + playlistId);
  const ps: YtSnippet = playlist.snippet ?? {};
  const ids = await listPlaylistVideoIds(key, playlistId, scan);
  const videos = await fetchVideos(key, ids);
  const byId = new Map(videos.map((v) => [v.id, v]));
  const ordered = ids.map((id) => byId.get(id)).filter((v): v is YtVideo => v !== undefined && usable(v, minMinutes));
  if (ordered.length === 0) throw new Error("No public, embeddable episodes of at least " + minMinutes + " minutes in that playlist.");

  const episodes: Episode[] = ordered.map((video, i) => {
    const rawTitle = video.snippet?.title || video.id;
    const numbers = episodeNumbers(rawTitle, i + 1);
    const episode: Episode = {
      id: "e-" + video.id,
      title: cleanTitle(rawTitle),
      season: numbers.season,
      episode: numbers.episode,
      playbackType: "youtube",
      playbackId: video.id,
    };
    const minutes = Math.round(parseDuration(video.contentDetails?.duration));
    if (minutes > 0) episode.runtimeMinutes = minutes;
    const thumb = bestThumb(video.snippet?.thumbnails);
    if (thumb) episode.thumbnailUrl = thumb;
    return episode;
  });

  const channel = ps.channelTitle || "the channel";
  const title = cleanTitle(ps.title || "Untitled show");
  const description = truncate(cleanDescription(ps.description), 400) || title;
  const show: Movie = {
    id: "ytpl-" + playlistId,
    slug: slugify(title) || "show-" + playlistId.toLowerCase().replace(/[^a-z0-9]/g, ""),
    title,
    description,
    industry,
    contentType: "show",
    languages: [languageFor(industry)],
    genres: guessGenres(title + " " + description),
    sourcePageUrl: "https://www.youtube.com/playlist?list=" + playlistId,
    playbackType: "youtube",
    playbackId: episodes[0].playbackId,
    episodes,
    popularity: ordered.reduce((sum, v) => sum + viewsOf(v), 0),
    rightsBasis: "platform_embed",
    licenseUrl: null,
    rightsNotes: "Imported from the YouTube playlist of \"" + channel + "\" on " + todayIso() + ". Confirm this channel is the official rights holder before approving.",
    attribution: "Official upload by " + channel + " on YouTube",
    territories: [],
    commercialUseAllowed: false,
    rightsStatus: "pending_review",
  };
  const thumb = bestThumb(ps.thumbnails) ?? episodes[0].thumbnailUrl ?? undefined;
  if (thumb) show.thumbnailUrl = thumb;
  return show;
}

export interface YouTubeImportOptions {
  key: string;
  industry: Industry;
  type: ContentType;
  target: string;
  minMinutes?: number;
  max?: number;
  scan?: number;
}

/** Films from a channel/playlist (existing ones are included so their view counts refresh), or one show from a playlist. */
export async function fetchYouTubeCandidates(opts: YouTubeImportOptions, existingIds: Set<string>): Promise<Movie[]> {
  const target = parseYouTubeTarget(opts.target);
  if (target.video) throw new Error("That is a single video — use Quick add for single videos.");
  const minMinutes = opts.minMinutes ?? (opts.type === "show" ? 5 : 70);
  const scan = opts.scan ?? 300;

  if (opts.type === "show") {
    if (!target.playlist) throw new Error("Shows are imported from a playlist. Paste the playlist link or ID (PL…).");
    return [await buildShow(opts.key, target.playlist, opts.industry, minMinutes, scan)];
  }

  let playlistId = target.playlist;
  let channelTitle = "";
  if (!playlistId && target.channel) playlistId = "UU" + target.channel.slice(2);
  if (!playlistId && target.handle) {
    const res = await ytApi<YtList<YtChannel>>(opts.key, "channels", { part: "contentDetails,snippet", forHandle: target.handle });
    const item = res.items?.[0];
    const uploads = item?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) throw new Error("No YouTube channel found for " + target.handle);
    playlistId = uploads;
    channelTitle = item?.snippet?.title ?? "";
  }
  if (!playlistId) throw new Error("Enter a channel @handle, channel ID (UC…), playlist ID (PL…) or a channel / playlist link.");

  const ids = await listPlaylistVideoIds(opts.key, playlistId, scan);
  const videos = await fetchVideos(opts.key, ids);
  const byId = new Map(videos.map((v) => [v.id, v]));
  const today = todayIso();
  const max = opts.max ?? 50;
  const out: Movie[] = [];
  let fresh = 0;
  for (const id of ids) {
    const video = byId.get(id);
    if (!video) continue;
    if (existingIds.has("yt-" + video.id)) {
      out.push(videoToMovie(video, opts.industry, channelTitle, today));
      continue;
    }
    if (fresh >= max || !usable(video, minMinutes)) continue;
    out.push(videoToMovie(video, opts.industry, channelTitle, today));
    fresh++;
  }
  return out;
}

// ---------- Quick add from a link ----------

export async function fetchSingleFromUrl(input: string, industry: Industry, type: ContentType): Promise<Movie[]> {
  const url = input.trim();
  const key = process.env.YOUTUBE_API_KEY;
  const today = todayIso();
  const isYouTube = /(^|\.)(youtube\.com|youtu\.be)$/i.test(safeHost(url)) || YOUTUBE_ID.test(url);

  if (isYouTube) {
    const target = parseYouTubeTarget(url);
    if (target.playlist) {
      if (!key) throw new Error("Importing a playlist needs YOUTUBE_API_KEY in .env.local.");
      return fetchYouTubeCandidates({ key, industry, type, target: target.playlist, max: 50 }, new Set());
    }
    const id = extractYouTubeId(url);
    if (!YOUTUBE_ID.test(id)) throw new Error("Couldn't find a YouTube video in that link.");
    if (key) {
      const videos = await fetchVideos(key, [id]);
      const video = videos[0];
      if (!video) throw new Error("That YouTube video wasn't found or isn't public.");
      if (video.status?.embeddable !== true) throw new Error("The uploader doesn't allow this video to be embedded on other sites.");
      return [videoToMovie(video, industry, "", today)];
    }
    // No API key: use YouTube's public oEmbed endpoint (title, channel, thumbnail).
    const res = await fetch("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + id), { cache: "no-store" });
    if (res.status === 401 || res.status === 403) throw new Error("The uploader doesn't allow this video to be embedded on other sites.");
    if (!res.ok) throw new Error("Couldn't read that YouTube video (HTTP " + res.status + "). Is it public?");
    const data = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
    const rawTitle = data.title || id;
    const title = cleanTitle(rawTitle);
    const channel = data.author_name || "the channel";
    const movie: Movie = {
      id: "yt-" + id,
      slug: slugify(title) || "film-" + id.toLowerCase().replace(/[^a-z0-9]/g, ""),
      title,
      description: title,
      industry,
      languages: [languageFor(industry)],
      genres: guessGenres(rawTitle),
      sourcePageUrl: "https://www.youtube.com/watch?v=" + id,
      playbackType: "youtube",
      playbackId: id,
      rightsBasis: "platform_embed",
      licenseUrl: null,
      rightsNotes: "Added from a link on " + today + " (uploaded by \"" + channel + "\"). Confirm this is the official rights holder before approving.",
      attribution: "Official upload by " + channel + " on YouTube",
      territories: [],
      commercialUseAllowed: false,
      rightsStatus: "pending_review",
    };
    if (data.thumbnail_url) movie.thumbnailUrl = data.thumbnail_url.replace(/^http:/, "https:");
    return [movie];
  }

  if (/(^|\.)archive\.org$/i.test(safeHost(url)) || (ARCHIVE_ID.test(url) && !url.includes("/"))) {
    const id = extractArchiveId(url);
    if (!ARCHIVE_ID.test(id)) throw new Error("Couldn't find an Internet Archive item in that link.");
    const res = await fetch("https://archive.org/metadata/" + encodeURIComponent(id), { cache: "no-store" });
    if (!res.ok) throw new Error("Internet Archive returned HTTP " + res.status + ".");
    const data = (await res.json()) as { metadata?: Record<string, unknown> };
    if (!data.metadata) throw new Error("Internet Archive item not found: " + id);
    const movie = archiveDocToMovie({ ...data.metadata, identifier: id }, industry, today);
    if (!movie) throw new Error("That Internet Archive item can't be used.");
    return [movie];
  }

  if (/^https:\/\/\S+\.(mp4|m4v|webm)(\?\S*)?$/i.test(url)) {
    if (!isAllowedDirectUrl(url)) throw new Error("That file's host isn't allowed yet. Add it to allowedVideoHosts in src/lib/config.ts.");
    const fileName = decodeURIComponent(new URL(url).pathname.split("/").pop() || "Untitled");
    const title = fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[._-]+/g, " ").trim() || "Untitled";
    return [
      {
        id: "direct-" + Date.now().toString(36),
        slug: slugify(title) || "film-" + Date.now().toString(36),
        title,
        description: title,
        industry,
        languages: [languageFor(industry)],
        genres: [],
        sourcePageUrl: url,
        playbackType: "direct_video",
        playbackUrl: url,
        rightsBasis: "written_permission",
        licenseUrl: null,
        rightsNotes: "Added from a direct link on " + today + ". Record your permission details before approving.",
        attribution: title,
        territories: [],
        commercialUseAllowed: false,
        rightsStatus: "pending_review",
      },
    ];
  }

  throw new Error("Paste a YouTube video or playlist link, an archive.org item link, or an https link to an .mp4/.webm file.");
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// ---------- Popularity ----------

export interface PopularityMaps {
  archive: Map<string, number>;
  youtube: Map<string, number>;
}

function playbackRefs(record: RawRecord): { type: string; id: string }[] {
  const refs: { type: string; id: string }[] = [];
  const add = (item: unknown) => {
    if (typeof item !== "object" || item === null) return;
    const r = item as Record<string, unknown>;
    if (typeof r.playbackType === "string" && typeof r.playbackId === "string" && r.playbackId) refs.push({ type: r.playbackType, id: r.playbackId });
  };
  const isShow = record.contentType === "show" && Array.isArray(record.episodes) && record.episodes.length > 0;
  if (isShow) (record.episodes as unknown[]).forEach(add);
  else add(record);
  return refs;
}

export async function fetchPopularity(records: RawRecord[], key?: string): Promise<PopularityMaps> {
  const archiveIds = new Set<string>();
  const youtubeIds = new Set<string>();
  for (const record of records) {
    for (const ref of playbackRefs(record)) {
      if (ref.type === "archive") archiveIds.add(ref.id);
      if (ref.type === "youtube") youtubeIds.add(ref.id);
    }
  }

  const archive = new Map<string, number>();
  const ids = Array.from(archiveIds);
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const params = new URLSearchParams();
    params.set("q", "identifier:(" + batch.map((id) => '"' + id + '"').join(" OR ") + ")");
    params.append("fl[]", "identifier");
    params.append("fl[]", "downloads");
    params.set("rows", String(batch.length));
    params.set("output", "json");
    const res = await fetch("https://archive.org/advancedsearch.php?" + params.toString(), { cache: "no-store" });
    if (!res.ok) throw new Error("Internet Archive returned HTTP " + res.status + ".");
    const data = (await res.json()) as { response?: { docs?: ArchiveDoc[] } };
    for (const doc of data.response?.docs ?? []) archive.set(asText(doc.identifier), Number(doc.downloads) || 0);
  }

  const youtube = new Map<string, number>();
  if (key && youtubeIds.size > 0) {
    const videos = await fetchVideos(key, Array.from(youtubeIds));
    for (const video of videos) youtube.set(video.id, viewsOf(video));
  }
  return { archive, youtube };
}

export function applyPopularity(records: RawRecord[], maps: PopularityMaps): number {
  let updated = 0;
  for (const record of records) {
    let total = 0;
    let found = false;
    for (const ref of playbackRefs(record)) {
      const map = ref.type === "archive" ? maps.archive : ref.type === "youtube" ? maps.youtube : null;
      if (map && map.has(ref.id)) {
        total += map.get(ref.id) ?? 0;
        found = true;
      }
    }
    if (found) {
      record.popularity = total;
      updated++;
    }
  }
  return updated;
}

// ---------- Merging into the catalog ----------

export interface ApproveOptions {
  reviewer: string;
  territories: string[];
}

export interface MergeResult {
  added: number;
  approved: number;
  updated: number;
  skipped: number;
  addedIds: string[];
}

function uniqueSlug(base: string, taken: Set<string>): string {
  const clean = base || "title";
  let slug = clean;
  let n = 2;
  while (taken.has(slug)) slug = clean + "-" + n++;
  taken.add(slug);
  return slug;
}

/**
 * Adds new titles and refreshes existing ones (popularity, show episodes).
 * Never changes an existing title's rights fields, and never adds an invalid record.
 */
export function mergeIntoCatalog(records: RawRecord[], candidates: Movie[], options: { approve?: ApproveOptions } = {}): MergeResult {
  const result: MergeResult = { added: 0, approved: 0, updated: 0, skipped: 0, addedIds: [] };
  const byId = new Map<string, RawRecord>();
  records.forEach((r) => byId.set(String(r.id), r));
  const slugs = new Set(records.map((r) => String(r.slug)));
  const playback = new Set(
    records.filter((r) => typeof r.playbackId === "string" && r.contentType !== "show").map((r) => String(r.playbackType) + ":" + String(r.playbackId)),
  );
  const today = todayIso();

  for (const candidate of candidates) {
    const existing = byId.get(candidate.id);
    if (existing) {
      let changed = false;
      if (candidate.contentType === "show" && candidate.episodes) {
        existing.episodes = candidate.episodes;
        existing.playbackId = candidate.playbackId;
        changed = true;
      }
      if (typeof candidate.popularity === "number" && candidate.popularity !== existing.popularity) {
        existing.popularity = candidate.popularity;
        changed = true;
      }
      if (changed) result.updated++;
      else result.skipped++;
      continue;
    }
    if (candidate.contentType !== "show" && candidate.playbackId && playback.has(candidate.playbackType + ":" + candidate.playbackId)) {
      result.skipped++;
      continue;
    }

    const record = JSON.parse(JSON.stringify({ ...candidate, slug: uniqueSlug(candidate.slug, slugs) })) as RawRecord;
    if (options.approve) {
      record.rightsStatus = "approved";
      record.rightsReviewedAt = today;
      record.rightsReviewer = options.approve.reviewer;
      if (!Array.isArray(record.territories) || record.territories.length === 0) record.territories = options.approve.territories;
    }
    let errors = validateRecord(record);
    if (errors.length > 0 && record.rightsStatus === "approved") {
      record.rightsStatus = "pending_review";
      record.rightsNotes = String(record.rightsNotes ?? "") + " Not auto-published: " + errors.join("; ") + ".";
      errors = validateRecord(record);
    }
    if (errors.length > 0) {
      slugs.delete(String(record.slug));
      result.skipped++;
      continue;
    }
    records.push(record);
    byId.set(String(record.id), record);
    if (typeof record.playbackId === "string") playback.add(String(record.playbackType) + ":" + record.playbackId);
    result.added++;
    result.addedIds.push(String(record.id));
    if (record.rightsStatus === "approved") result.approved++;
  }
  return result;
}

export function describeMerge(result: MergeResult): string {
  const parts = ["Added " + result.added + " new title" + (result.added === 1 ? "" : "s")];
  if (result.approved > 0) parts.push(result.approved + " published automatically");
  if (result.updated > 0) parts.push("refreshed " + result.updated);
  if (result.skipped > 0) parts.push("skipped " + result.skipped + " (already listed or incomplete)");
  return parts.join(", ") + ".";
}
