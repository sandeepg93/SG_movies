// update-sgmovies.mjs — run inside openreel-v2:  node update-sgmovies.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

if (!existsSync("src/app/admin/actions.ts") || !existsSync("src/lib/admin/auth.ts") || !existsSync("src/types/playback.ts")) {
  console.error("Run this inside openreel-v2 after update-v3.mjs, update-admin.mjs and update-login.mjs.");
  process.exit(1);
}
const auth = readFileSync("src/lib/admin/auth.ts", "utf8");
if (!auth.includes("checkCredentials")) {
  console.error("Please run update-login.mjs first (admin / admin login), then run this again.");
  process.exit(1);
}

const files = {};

files["src/types/movie.ts"] = String.raw`
export type RightsStatus = "pending_review" | "approved" | "rejected";
export type PlaybackType = "youtube" | "archive" | "direct_video" | "embed";
export type Industry = "hollywood" | "bollywood" | "marathi" | "tollywood";
export type ContentType = "movie" | "show" | "video" | "reel";
export type RightsBasis =
  | "public_domain"
  | "creative_commons"
  | "written_permission"
  | "license_agreement"
  | "platform_embed";

/** One quality version of a directly hosted video. */
export interface VideoSourceInput {
  label: string;
  url: string;
  height?: number;
}

export interface PlaybackFields {
  playbackType: PlaybackType;
  /** YouTube video ID or Internet Archive identifier. */
  playbackId?: string;
  /** direct_video: the video file. embed: the official player (iframe) URL of an allowed website. */
  playbackUrl?: string;
  /** direct_video only: the same video in several qualities. */
  videoSources?: VideoSourceInput[];
  thumbnailUrl?: string | null;
}

/** The same title in another language (usually a separate official upload). */
export interface LanguageVersion extends PlaybackFields {
  language: string;
}

export interface Episode extends PlaybackFields {
  id: string;
  title: string;
  season?: number;
  episode?: number;
  runtimeMinutes?: number;
  description?: string;
}

export interface Movie extends PlaybackFields {
  id: string;
  slug: string;
  title: string;
  alternateTitles?: string[];
  description: string;
  director?: string;
  cast?: string[];
  industry: Industry;
  /** movie (default) · show (episodes) · video (clips, songs, trailers) · reel (short vertical clips). */
  contentType?: ContentType;
  episodes?: Episode[];
  languageVersions?: LanguageVersion[];
  releaseYear?: number;
  /** "YYYY-MM" or "YYYY-MM-DD"; enables month-wise browsing. */
  releaseDate?: string;
  /** Date added to SGMovies (YYYY-MM-DD). Drives "Recently added". */
  addedAt?: string;
  /** Upload date on the source platform (YYYY-MM-DD). */
  publishedAt?: string;
  languages: string[];
  genres: string[];
  runtimeMinutes?: number;
  sourcePageUrl: string;
  popularity?: number;
  trending?: boolean;
  rightsBasis: RightsBasis;
  licenseUrl?: string | null;
  rightsNotes?: string;
  attribution: string;
  territories: string[];
  commercialUseAllowed: boolean;
  rightsStatus: RightsStatus;
  rightsReviewedAt?: string;
  rightsReviewer?: string;
  featured?: boolean;
}
`;

files["src/types/admin.ts"] = String.raw`
import type { ContentType, Industry } from "@/types/movie";

/** A catalog entry as stored on disk (may be incomplete or invalid). */
export type RawRecord = Record<string, unknown>;

export type SourceKind = "youtube" | "archive";

/** "auto" sorts videos by length into movies, videos and reels. */
export type ImportType = ContentType | "auto";

export interface ImportSource {
  id: string;
  label: string;
  kind: SourceKind;
  industry: Industry;
  contentType: ImportType;
  /** YouTube: @handle, channel ID (UC…), playlist ID (PL…) or URL. Archive: search query. */
  target: string;
  /** New titles from a trusted source are published automatically. */
  trusted: boolean;
  territories: string[];
  minMinutes?: number;
  maxPerSync?: number;
  lastSyncAt?: string;
  lastResult?: string;
}

export interface ActionState {
  ok?: boolean;
  message?: string;
  errors?: string[];
  values?: Record<string, string>;
  version?: number;
}
`;

files["src/lib/config.ts"] = String.raw`
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");

function extraHosts(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

export const siteConfig = {
  name: "SGMovies",
  tagline: "Movies, shows, videos and reels from Hollywood, Bollywood, Marathi and Tollywood, streamed legally from official sources.",
  url: siteUrl,
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL || "rights@example.com",
  /** Hosts allowed for direct video files (subdomains included). Add more with NEXT_PUBLIC_EXTRA_VIDEO_HOSTS. */
  allowedVideoHosts: ["archive.org", ...extraHosts(process.env.NEXT_PUBLIC_EXTRA_VIDEO_HOSTS)] as readonly string[],
  /**
   * Official players that may be embedded (iframe). Add a website's player host with
   * NEXT_PUBLIC_EXTRA_EMBED_HOSTS only if that website is the rights holder or has permission.
   */
  allowedEmbedHosts: [
    "player.vimeo.com",
    "www.dailymotion.com",
    "geo.dailymotion.com",
    "archive.org",
    ...extraHosts(process.env.NEXT_PUBLIC_EXTRA_EMBED_HOSTS),
  ] as readonly string[],
};
`;

files["src/lib/media.ts"] = String.raw`
import type { Movie, PlaybackFields } from "@/types/movie";
import { siteConfig } from "@/lib/config";

export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
export const ARCHIVE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function hostAllowed(value: string, hosts: readonly string[]): boolean {
  if (!isHttpsUrl(value)) return false;
  const host = new URL(value).hostname.toLowerCase();
  return hosts.some((allowed) => host === allowed || host.endsWith("." + allowed));
}

export function isAllowedDirectUrl(value: string): boolean {
  return hostAllowed(value, siteConfig.allowedVideoHosts);
}

export function isAllowedEmbedUrl(value: string): boolean {
  return hostAllowed(value, siteConfig.allowedEmbedHosts);
}

export function isPlayable(source: PlaybackFields): boolean {
  if (source.playbackType === "youtube") return typeof source.playbackId === "string" && YOUTUBE_ID.test(source.playbackId);
  if (source.playbackType === "archive") return typeof source.playbackId === "string" && ARCHIVE_ID.test(source.playbackId);
  if (source.playbackType === "embed") return typeof source.playbackUrl === "string" && isAllowedEmbedUrl(source.playbackUrl);
  if (source.playbackType === "direct_video") {
    if (Array.isArray(source.videoSources) && source.videoSources.length > 0) {
      return source.videoSources.every((s) => typeof s.url === "string" && isAllowedDirectUrl(s.url));
    }
    return typeof source.playbackUrl === "string" && isAllowedDirectUrl(source.playbackUrl);
  }
  return false;
}

/** A title is playable itself, through one of its language versions, or (shows) through an episode. */
export function hasPlayableContent(movie: Movie): boolean {
  if (isPlayable(movie)) return true;
  if ((movie.languageVersions ?? []).some((version) => isPlayable(version))) return true;
  return (movie.episodes ?? []).some((episode) => isPlayable(episode));
}

export function embedUrlFor(source: PlaybackFields, autoplay: boolean): string | null {
  if (!isPlayable(source)) return null;
  if (source.playbackType === "youtube" && source.playbackId) {
    const params = new URLSearchParams({ rel: "0", playsinline: "1", autoplay: autoplay ? "1" : "0" });
    return "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(source.playbackId) + "?" + params.toString();
  }
  if (source.playbackType === "archive" && source.playbackId) {
    return "https://archive.org/embed/" + encodeURIComponent(source.playbackId) + (autoplay ? "?autoplay=1" : "");
  }
  if (source.playbackType === "embed" && source.playbackUrl) {
    if (!autoplay) return source.playbackUrl;
    const url = new URL(source.playbackUrl);
    if (!url.searchParams.has("autoplay")) url.searchParams.set("autoplay", "1");
    return url.toString();
  }
  return null;
}

/** Direct thumbnail URL (used by the admin preview). The site uses thumbSrc() instead. */
export function thumbnailFor(source: PlaybackFields): string | null {
  return thumbnailCandidates(source, "small")[0] ?? null;
}

/** Possible thumbnail images, best first. The /api/thumb route tries them in order. */
export function thumbnailCandidates(source: PlaybackFields, size: "small" | "large" = "large"): string[] {
  const out: string[] = [];
  const own = source.thumbnailUrl && isHttpsUrl(source.thumbnailUrl) ? source.thumbnailUrl : null;
  if (source.playbackType === "youtube" && source.playbackId && YOUTUBE_ID.test(source.playbackId)) {
    const base = "https://i.ytimg.com/vi/" + source.playbackId + "/";
    const files = size === "small" ? ["hqdefault.jpg", "mqdefault.jpg", "sddefault.jpg"] : ["maxresdefault.jpg", "sddefault.jpg", "hqdefault.jpg"];
    if (own && size === "large") out.push(own);
    for (const file of files) out.push(base + file);
    if (own && size === "small") out.push(own);
  } else {
    if (own) out.push(own);
    if (source.playbackType === "archive" && source.playbackId && ARCHIVE_ID.test(source.playbackId)) {
      out.push("https://archive.org/services/img/" + encodeURIComponent(source.playbackId));
    }
  }
  return Array.from(new Set(out));
}

export function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Always-working thumbnail served by /api/thumb: tries the best image, falls back, never shows a broken image. */
export function thumbSrc(
  movie: Movie,
  options: { episode?: number; size?: "small" | "large"; shape?: "wide" | "tall" } = {},
): string {
  const params = new URLSearchParams();
  if (options.episode !== undefined) params.set("episode", String(options.episode));
  if (options.size === "small") params.set("size", "small");
  if (options.shape === "tall") params.set("shape", "tall");
  const episode = options.episode !== undefined ? movie.episodes?.[options.episode] : undefined;
  const source: PlaybackFields = episode ?? movie;
  params.set("v", hashText(String(source.thumbnailUrl ?? "") + "|" + String(source.playbackId ?? source.playbackUrl ?? "") + "|" + movie.title));
  return "/api/thumb/" + encodeURIComponent(movie.id) + "?" + params.toString();
}
`;

files["src/lib/net.ts"] = String.raw`
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface SafeResponse {
  ok: boolean;
  status: number;
  url: string;
  contentType: string;
  body: ArrayBuffer;
}

function isPrivateAddress(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) return true;
    const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n))) return true;
  const [a, b] = parts;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Links to local or internal addresses aren't allowed.");
  }
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("That link points to a private network address and isn't allowed.");
  }
}

async function readLimited(res: Response, maxBytes: number): Promise<ArrayBuffer> {
  if (!res.body) return new ArrayBuffer(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("The response from that website is too large.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer as ArrayBuffer;
}

/** Fetches a public URL with SSRF protection, a timeout, a size limit and checked redirects. */
export async function safeFetch(
  input: string,
  options: { maxBytes?: number; timeoutMs?: number; accept?: string } = {},
): Promise<SafeResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
  try {
    let url = new URL(input);
    for (let redirects = 0; redirects <= 4; redirects++) {
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http and https links are supported.");
      await assertPublicHost(url.hostname);
      const res = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        cache: "no-store",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; SGMoviesFetcher/1.0)",
          Accept: options.accept ?? "*/*",
        },
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        url = new URL(location, url);
        continue;
      }
      const body = await readLimited(res, options.maxBytes ?? 3000000);
      return {
        ok: res.ok,
        status: res.status,
        url: url.toString(),
        contentType: (res.headers.get("content-type") || "").toLowerCase(),
        body,
      };
    }
    throw new Error("That link redirects too many times.");
  } catch (error) {
    if (controller.signal.aborted) throw new Error("The website took too long to respond.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
`;

files["src/lib/admin/parse.ts"] = String.raw`
import type { PlaybackFields } from "@/types/movie";
import { ARCHIVE_ID, YOUTUBE_ID, isAllowedEmbedUrl } from "@/lib/media";

export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export function looksLikeUrl(value: string): boolean {
  return /^(https?:)?\/\//i.test(value.trim());
}

/** Accepts a YouTube ID or any YouTube video link and returns the 11-character ID. */
export function extractYouTubeId(input: string): string {
  const s = input.trim();
  if (YOUTUBE_ID.test(s)) return s;
  try {
    const url = new URL(s);
    if (url.hostname === "youtu.be") return url.pathname.slice(1, 12);
    const v = url.searchParams.get("v");
    if (v) return v;
    const m = /\/(embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/.exec(url.pathname);
    if (m) return m[2];
  } catch {
    // not a URL
  }
  return s;
}

/** Accepts an Internet Archive identifier or any archive.org item link. */
export function extractArchiveId(input: string): string {
  const s = input.trim();
  try {
    const url = new URL(s);
    const m = /\/(details|embed|download)\/([^/?#]+)/.exec(url.pathname);
    if (m) return decodeURIComponent(m[2]);
  } catch {
    // not a URL
  }
  return s;
}

/**
 * Recognises a video link and says how to play it: YouTube, Internet Archive, Vimeo, Dailymotion,
 * a direct .mp4/.webm file, or an allowed embed host. Other https players are returned only when allowUnknown is true.
 */
export function playbackFromLink(input: string, allowUnknown = false): PlaybackFields | null {
  const raw = input.trim();
  if (YOUTUBE_ID.test(raw)) return { playbackType: "youtube", playbackId: raw };
  let url: URL;
  try {
    url = new URL(raw.startsWith("//") ? "https:" + raw : raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");

  if (host === "youtu.be" || host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    const id = extractYouTubeId(url.toString());
    return YOUTUBE_ID.test(id) ? { playbackType: "youtube", playbackId: id } : null;
  }
  if (host === "archive.org" || host.endsWith(".archive.org")) {
    const m = /\/(details|embed|download)\/([^/?#]+)/.exec(url.pathname);
    if (m) {
      const id = decodeURIComponent(m[2]);
      if (ARCHIVE_ID.test(id)) return { playbackType: "archive", playbackId: id };
    }
    return null;
  }
  if (host === "vimeo.com" || host.endsWith(".vimeo.com")) {
    const m = /\/(\d{5,})(?:[/?#]|$)/.exec(url.pathname);
    return m ? { playbackType: "embed", playbackUrl: "https://player.vimeo.com/video/" + m[1] } : null;
  }
  if (host === "dai.ly" || host.endsWith("dailymotion.com")) {
    const m = host === "dai.ly" ? /^\/([a-z0-9]+)/i.exec(url.pathname) : /\/(?:embed\/)?video\/([a-z0-9]+)/i.exec(url.pathname);
    const id = m ? m[1] : url.searchParams.get("video");
    return id && /^[a-z0-9]+$/i.test(id) ? { playbackType: "embed", playbackUrl: "https://www.dailymotion.com/embed/video/" + id } : null;
  }
  const https = url.toString().replace(/^http:/, "https:");
  if (/\.(mp4|m4v|webm)$/i.test(url.pathname)) return { playbackType: "direct_video", playbackUrl: https };
  if (isAllowedEmbedUrl(https)) return { playbackType: "embed", playbackUrl: https };
  return allowUnknown ? { playbackType: "embed", playbackUrl: https } : null;
}

export interface YouTubeTarget {
  handle?: string;
  channel?: string;
  playlist?: string;
  video?: string;
}

/** Understands @handles, channel IDs, playlist IDs and channel / playlist / video links. */
export function parseYouTubeTarget(input: string): YouTubeTarget {
  const s = input.trim();
  if (!s) return {};
  if (s.startsWith("@")) return { handle: s };
  if (/^UC[A-Za-z0-9_-]{22}$/.test(s)) return { channel: s };
  if (/^(PL|UU|OL|FL)[A-Za-z0-9_-]{10,}$/.test(s)) return { playlist: s };
  try {
    const url = new URL(s);
    const list = url.searchParams.get("list");
    if (list) return { playlist: list };
    const handle = /^\/(@[^/]+)/.exec(url.pathname);
    if (handle) return { handle: decodeURIComponent(handle[1]) };
    const channel = /^\/channel\/(UC[A-Za-z0-9_-]{22})/.exec(url.pathname);
    if (channel) return { channel: channel[1] };
    const video = extractYouTubeId(s);
    if (YOUTUBE_ID.test(video)) return { video };
    return {};
  } catch {
    return /^[A-Za-z0-9._-]+$/.test(s) ? { handle: "@" + s } : {};
  }
}
`;

files["src/lib/admin/webpage.ts"] = String.raw`
import { safeFetch } from "@/lib/net";

export interface PageInfo {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  videoLinks: string[];
  uploadDate?: string;
  releaseDate?: string;
  durationMinutes?: number;
  language?: string;
  genres: string[];
  director?: string;
  cast: string[];
  schemaType?: string;
}

type Json = Record<string, unknown>;

const LANGUAGE_CODES: Record<string, string> = {
  en: "English", hi: "Hindi", mr: "Marathi", te: "Telugu", ta: "Tamil", bn: "Bengali",
  kn: "Kannada", ml: "Malayalam", gu: "Gujarati", pa: "Punjabi", ur: "Urdu",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, code: string) => {
    const c = code.toLowerCase();
    if (c === "amp") return "&";
    if (c === "lt") return "<";
    if (c === "gt") return ">";
    if (c === "quot") return '"';
    if (c === "apos") return "'";
    if (c === "nbsp") return " ";
    try {
      return String.fromCodePoint(c.startsWith("#x") ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10));
    } catch {
      return match;
    }
  });
}

function attr(tag: string, name: string): string | undefined {
  const re = new RegExp("[\\s<]" + name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i");
  const m = re.exec(tag);
  if (!m) return undefined;
  return decodeEntities(m[2] ?? m[3] ?? m[4] ?? "").trim();
}

function absolute(value: string | undefined, base: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value.startsWith("//") ? "https:" + value : value, base).toString();
  } catch {
    return undefined;
  }
}

function collect(value: unknown, out: Json[]) {
  if (Array.isArray(value)) {
    value.forEach((v) => collect(v, out));
  } else if (value && typeof value === "object") {
    const o = value as Json;
    out.push(o);
    if (o["@graph"]) collect(o["@graph"], out);
    if (o.video) collect(o.video, out);
    if (o.trailer) collect(o.trailer, out);
  }
}

function ldText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    for (const v of value) {
      const t = ldText(v);
      if (t) return t;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    const o = value as Json;
    return ldText(o.url) ?? ldText(o.contentUrl) ?? ldText(o.name);
  }
  return undefined;
}

function ldNames(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list
    .map((v) => (typeof v === "string" ? v.trim() : v && typeof v === "object" ? ldText((v as Json).name) : undefined))
    .filter((v): v is string => Boolean(v))
    .slice(0, 10);
}

function ldTypes(o: Json): string[] {
  const t = o["@type"];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string");
}

function isoMinutes(iso: string | undefined): number | undefined {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?$/.exec(iso || "");
  if (!m) return undefined;
  const minutes = Number(m[1] || 0) * 1440 + Number(m[2] || 0) * 60 + Number(m[3] || 0) + Number(m[4] || 0) / 60;
  return minutes > 0 ? minutes : undefined;
}

function languageName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  const code = v.toLowerCase().split(/[-_]/)[0];
  if (LANGUAGE_CODES[code]) return LANGUAGE_CODES[code];
  return v.length > 3 ? v.charAt(0).toUpperCase() + v.slice(1) : undefined;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
}

function day(value: string | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined;
}

/** Reads a public web page and extracts title, description, thumbnail, dates, language and video player links. */
export async function readWebPage(input: string): Promise<PageInfo> {
  const res = await safeFetch(input, { maxBytes: 3000000, timeoutMs: 12000, accept: "text/html,application/xhtml+xml" });
  if (!res.ok) throw new Error("That website answered with HTTP " + res.status + " (it may block automatic reading).");
  if (!res.contentType.includes("html")) throw new Error("That link isn't a web page (" + (res.contentType || "unknown type") + ").");
  const html = new TextDecoder("utf-8").decode(res.body);
  const base = res.url;

  const meta = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, "property") ?? attr(tag, "name") ?? attr(tag, "itemprop") ?? "").toLowerCase();
    const content = attr(tag, "content");
    if (key && content && !meta.has(key)) meta.set(key, content);
  }

  const ld: Json[] = [];
  const ldPattern = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = ldPattern.exec(html))) {
    try {
      collect(JSON.parse(match[1].trim()), ld);
    } catch {
      // ignore broken JSON-LD
    }
  }
  let primary: Json | undefined;
  for (const type of ["VideoObject", "Movie", "TVEpisode", "Episode", "TVSeries", "Clip"]) {
    primary = ld.find((o) => ldTypes(o).includes(type));
    if (primary) break;
  }
  const movieNode = ld.find((o) => ldTypes(o).some((t) => t === "Movie" || t === "TVSeries"));
  const videoNodes = ld.filter((o) => ldTypes(o).includes("VideoObject"));

  const siteName = meta.get("og:site_name") || new URL(base).hostname.replace(/^www\./, "");
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  let title =
    ldText(movieNode?.name) ?? ldText(primary?.name) ?? meta.get("og:title") ?? meta.get("twitter:title") ??
    (titleTag ? decodeEntities(titleTag[1]).replace(/\s+/g, " ").trim() : undefined);
  if (title && siteName) title = title.replace(new RegExp("\\s*[|\\-–—:]\\s*" + escapeRegExp(siteName) + "\\s*$", "i"), "").trim();

  const description =
    ldText(movieNode?.description) ?? ldText(primary?.description) ?? meta.get("og:description") ??
    meta.get("twitter:description") ?? meta.get("description");
  const image = absolute(
    ldText(movieNode?.image) ?? ldText(primary?.thumbnailUrl) ?? ldText(primary?.image) ?? meta.get("og:image:secure_url") ??
      meta.get("og:image") ?? meta.get("twitter:image"),
    base,
  );

  const links: string[] = [];
  const add = (value: string | undefined) => {
    const url = absolute(value, base);
    if (url && !links.includes(url)) links.push(url);
  };
  for (const node of [primary, ...videoNodes]) {
    if (!node) continue;
    add(ldText(node.embedUrl));
    add(ldText(node.contentUrl));
  }

  const oembedTag = (html.match(/<link\b[^>]*>/gi) ?? []).find((tag) => /json\+oembed/i.test(attr(tag, "type") ?? ""));
  const oembedHref = oembedTag ? absolute(attr(oembedTag, "href"), base) : undefined;
  if (oembedHref) {
    try {
      const o = await safeFetch(oembedHref, { maxBytes: 300000, timeoutMs: 8000, accept: "application/json" });
      if (o.ok) {
        const data = JSON.parse(new TextDecoder().decode(o.body)) as { html?: string };
        const iframe = data.html ? /<iframe\b[^>]*>/i.exec(data.html) : null;
        if (iframe) add(attr(iframe[0], "src"));
      }
    } catch {
      // oEmbed is optional
    }
  }

  for (const key of ["og:video:secure_url", "og:video:url", "og:video", "twitter:player", "twitter:player:stream"]) add(meta.get(key));
  for (const tag of html.match(/<iframe\b[^>]*>/gi) ?? []) add(attr(tag, "src") ?? attr(tag, "data-src"));
  for (const tag of html.match(/<(?:video|source)\b[^>]*>/gi) ?? []) add(attr(tag, "src"));

  const durationSeconds = Number(meta.get("video:duration") ?? meta.get("og:video:duration") ?? "");
  const durationMinutes =
    isoMinutes(ldText(primary?.duration)) ?? (Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds / 60 : undefined);

  const htmlLang = /<html\b[^>]*\blang\s*=\s*["']?([a-zA-Z_-]+)/i.exec(html);
  const language = languageName(ldText(primary?.inLanguage) ?? ldText(movieNode?.inLanguage) ?? (htmlLang ? htmlLang[1] : undefined));

  return {
    url: base,
    title,
    description: description ? description.replace(/\s+/g, " ").trim() : undefined,
    image,
    siteName,
    videoLinks: links,
    uploadDate: day(ldText(primary?.uploadDate) ?? meta.get("video:release_date") ?? meta.get("article:published_time")),
    releaseDate: day(ldText(movieNode?.datePublished) ?? ldText(movieNode?.dateCreated)) ?? (ldText(movieNode?.datePublished) || undefined),
    durationMinutes,
    language,
    genres: ldNames(movieNode?.genre ?? primary?.genre),
    director: ldNames(movieNode?.director)[0],
    cast: ldNames(movieNode?.actor),
    schemaType: primary ? ldTypes(primary)[0] : undefined,
  };
}
`;

files["src/lib/validation.ts"] = String.raw`
import type { Movie } from "@/types/movie";
import { INDUSTRY_VALUES } from "@/lib/industries";
import { ARCHIVE_ID, YOUTUBE_ID, hasPlayableContent, isHttpsUrl } from "@/lib/media";

const RIGHTS_STATUSES = ["pending_review", "approved", "rejected"];
const PLAYBACK_TYPES = ["youtube", "archive", "direct_video", "embed"];
const RIGHTS_BASES = ["public_domain", "creative_commons", "written_permission", "license_agreement", "platform_embed"];
const CONTENT_TYPES = ["movie", "show", "video", "reel"];
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RELEASE_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isPositiveInt(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) > 0;
}

function validatePlayback(m: Record<string, unknown>, fail: (msg: string) => void) {
  if (!PLAYBACK_TYPES.includes(String(m.playbackType))) fail('"playbackType" must be one of: ' + PLAYBACK_TYPES.join(", "));
  if (m.playbackId !== undefined && typeof m.playbackId !== "string") {
    fail('"playbackId" must be text');
  } else if (typeof m.playbackId === "string" && m.playbackId !== "") {
    if (m.playbackType === "youtube" && !YOUTUBE_ID.test(m.playbackId)) fail("the YouTube video ID is not valid (it should be 11 characters)");
    if (m.playbackType === "archive" && !ARCHIVE_ID.test(m.playbackId)) fail("the Internet Archive identifier is not valid");
  }
  if (m.playbackUrl !== undefined && m.playbackUrl !== "" && !isHttpsUrl(m.playbackUrl)) fail("the video file / player URL must start with https://");
  if (m.thumbnailUrl !== undefined && m.thumbnailUrl !== null && !isHttpsUrl(m.thumbnailUrl)) fail("the thumbnail must be an https URL");
  if (m.videoSources !== undefined) {
    if (!Array.isArray(m.videoSources)) {
      fail('"videoSources" must be a list');
    } else {
      m.videoSources.forEach((raw, i) => {
        const where = "quality version " + (i + 1);
        if (typeof raw !== "object" || raw === null) {
          fail(where + " is not valid");
          return;
        }
        const s = raw as Record<string, unknown>;
        if (!isNonEmptyString(s.label)) fail(where + ' needs a label such as "720p"');
        if (!isHttpsUrl(s.url)) fail(where + " needs an https URL");
        if (s.height !== undefined && !isPositiveInt(s.height)) fail(where + ": height must be a whole number");
      });
    }
  }
}

function validateList(value: unknown, label: string, fail: (msg: string) => void, check: (item: Record<string, unknown>, fail: (msg: string) => void) => void) {
  if (!Array.isArray(value)) {
    fail('"' + label + '" must be a list');
    return;
  }
  value.forEach((raw, i) => {
    const where = label + " " + (i + 1);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      fail(where + " must be an object");
      return;
    }
    check(raw as Record<string, unknown>, (msg) => fail(where + ": " + msg));
  });
}

/** Problems with a single record (empty list = valid). Duplicates are checked by checkCatalog. */
export function validateRecord(raw: unknown): string[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return ["must be an object"];
  const m = raw as Record<string, unknown>;
  const errors: string[] = [];
  const fail = (msg: string) => errors.push(msg);

  for (const field of ["id", "slug", "title", "description", "attribution"]) {
    if (!isNonEmptyString(m[field])) fail('"' + field + '" is required');
  }
  for (const field of ["languages", "genres", "territories"]) {
    if (!isStringArray(m[field])) fail('"' + field + '" must be a list of words');
  }
  if (m.alternateTitles !== undefined && !isStringArray(m.alternateTitles)) fail('"alternateTitles" must be a list');
  if (m.cast !== undefined && !isStringArray(m.cast)) fail('"cast" must be a list');
  if (m.director !== undefined && !isNonEmptyString(m.director)) fail('"director" must not be empty');
  if (m.rightsNotes !== undefined && typeof m.rightsNotes !== "string") fail('"rightsNotes" must be text');
  if (isNonEmptyString(m.slug) && !SLUG_PATTERN.test(m.slug)) fail("the URL slug may only use lowercase letters, numbers and hyphens");
  if (!INDUSTRY_VALUES.includes(String(m.industry))) fail('"industry" must be one of: ' + INDUSTRY_VALUES.join(", "));
  if (m.contentType !== undefined && !CONTENT_TYPES.includes(String(m.contentType))) fail('"contentType" must be movie, show, video or reel');
  if (!RIGHTS_STATUSES.includes(String(m.rightsStatus))) fail('"rightsStatus" must be one of: ' + RIGHTS_STATUSES.join(", "));
  if (!RIGHTS_BASES.includes(String(m.rightsBasis))) fail('"rightsBasis" must be one of: ' + RIGHTS_BASES.join(", "));
  if (typeof m.commercialUseAllowed !== "boolean") fail('"commercialUseAllowed" must be true or false');
  if (m.featured !== undefined && typeof m.featured !== "boolean") fail('"featured" must be true or false');
  if (m.trending !== undefined && typeof m.trending !== "boolean") fail('"trending" must be true or false');
  if (m.popularity !== undefined && !(typeof m.popularity === "number" && Number.isFinite(m.popularity) && m.popularity >= 0)) {
    fail('"popularity" must be 0 or more');
  }
  for (const field of ["addedAt", "publishedAt"]) {
    if (m[field] !== undefined && !(isNonEmptyString(m[field]) && DAY_PATTERN.test(m[field] as string))) fail('"' + field + '" must look like 2026-10-14');
  }
  if (m.releaseYear !== undefined && !(Number.isInteger(m.releaseYear) && (m.releaseYear as number) > 1870)) fail("the release year is not valid");
  if (m.releaseDate !== undefined) {
    if (!isNonEmptyString(m.releaseDate) || !RELEASE_DATE_PATTERN.test(m.releaseDate)) {
      fail("the release date must look like 1968-10 or 1968-10-01");
    } else if (typeof m.releaseYear === "number" && Number(m.releaseDate.slice(0, 4)) !== m.releaseYear) {
      fail("release year and release date disagree");
    }
  }
  if (m.runtimeMinutes !== undefined && !isPositiveInt(m.runtimeMinutes)) fail("runtime must be a whole number of minutes");
  if (!isHttpsUrl(m.sourcePageUrl)) fail("the source page must be an https URL");
  if (m.licenseUrl !== undefined && m.licenseUrl !== null && !isHttpsUrl(m.licenseUrl)) fail("the license URL must be https");
  validatePlayback(m, fail);

  if (m.episodes !== undefined) {
    const ids = new Set<string>();
    validateList(m.episodes, "episode", fail, (e, efail) => {
      if (!isNonEmptyString(e.id)) efail('"id" is required');
      else {
        if (ids.has(e.id)) efail("duplicate episode id");
        ids.add(e.id);
      }
      if (!isNonEmptyString(e.title)) efail('"title" is required');
      for (const field of ["season", "episode", "runtimeMinutes"]) {
        if (e[field] !== undefined && !isPositiveInt(e[field])) efail('"' + field + '" must be a positive whole number');
      }
      validatePlayback(e, efail);
    });
  }
  if (m.languageVersions !== undefined) {
    validateList(m.languageVersions, "language version", fail, (v, vfail) => {
      if (!isNonEmptyString(v.language)) vfail('"language" is required');
      validatePlayback(v, vfail);
    });
  }

  if (m.rightsStatus === "approved") {
    if (!hasPlayableContent(m as unknown as Movie)) fail("a live title needs a working video (check the video link and that its website is allowed)");
    if (!isNonEmptyString(m.rightsReviewedAt) || !DAY_PATTERN.test(m.rightsReviewedAt)) fail("a live title needs a review date (YYYY-MM-DD)");
    if (!isNonEmptyString(m.rightsReviewer)) fail("a live title needs a reviewer name");
    if (isStringArray(m.territories) && m.territories.length === 0) fail('a live title needs at least one territory, e.g. "IN"');
    if (m.rightsBasis === "creative_commons" && !isHttpsUrl(m.licenseUrl)) fail("a Creative Commons title needs a license URL");
  }
  return errors;
}

export interface RecordProblem {
  index: number;
  id: string;
  title: string;
  errors: string[];
}

/** Splits a raw catalog into valid titles and problems (invalid or duplicate records). */
export function checkCatalog(list: unknown[]): { valid: Movie[]; problems: RecordProblem[] } {
  const valid: Movie[] = [];
  const problems: RecordProblem[] = [];
  const ids = new Set<string>();
  const slugs = new Set<string>();
  list.forEach((raw, index) => {
    const errors = validateRecord(raw);
    const m = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const id = typeof m.id === "string" ? m.id : "";
    const slug = typeof m.slug === "string" ? m.slug : "";
    if (id && ids.has(id)) errors.push('duplicate id "' + id + '"');
    if (slug && slugs.has(slug)) errors.push('duplicate URL slug "' + slug + '"');
    if (errors.length > 0) {
      problems.push({ index, id, title: typeof m.title === "string" && m.title ? m.title : "(untitled)", errors });
      return;
    }
    ids.add(id);
    slugs.add(slug);
    valid.push(raw as Movie);
  });
  return { valid, problems };
}

/** Strict check (throws on any problem). Handy for scripts and CI. */
export function validateCatalog(input: unknown): Movie[] {
  if (!Array.isArray(input)) throw new Error("Catalog validation failed: the catalog must be a JSON array.");
  const { valid, problems } = checkCatalog(input);
  if (problems.length > 0) {
    throw new Error("Catalog validation failed:\n  - " + problems.map((p) => (p.id || "#" + p.index) + ": " + p.errors.join("; ")).join("\n  - "));
  }
  return valid;
}
`;

files["src/lib/filter.ts"] = String.raw`
import type { ContentType, Movie } from "@/types/movie";
import { MONTH_NAMES, getReleaseMonth, getReleaseYear } from "@/lib/dates";
import { INDUSTRIES, INDUSTRY_VALUES, industryLabel } from "@/lib/industries";

export type SortKey = "recent" | "newest" | "popular" | "oldest" | "title" | "shortest" | "longest";
export type GroupKey = "none" | "industry" | "category" | "decade" | "year" | "month";
export type ViewKey = "grid" | "list";

export const NO_CATEGORY = "Other";
export const CONTENT_TYPES: readonly ContentType[] = ["movie", "show", "video", "reel"];
export const TYPE_LABELS: Record<ContentType, string> = { movie: "Movies", show: "Shows", video: "Videos", reel: "Reels" };

const SORT_KEYS: readonly SortKey[] = ["recent", "newest", "popular", "oldest", "title", "shortest", "longest"];
const GROUP_KEYS: readonly GroupKey[] = ["none", "industry", "category", "decade", "year", "month"];
const VIEW_KEYS: readonly ViewKey[] = ["grid", "list"];
const DEFAULT_SORT: SortKey = "recent";

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "recent", label: "Recently added" },
  { value: "newest", label: "Latest releases" },
  { value: "popular", label: "Trending" },
  { value: "oldest", label: "Oldest first" },
  { value: "title", label: "Title (A–Z)" },
  { value: "shortest", label: "Shortest first" },
  { value: "longest", label: "Longest first" },
];

export const GROUP_OPTIONS: { value: GroupKey; label: string }[] = [
  { value: "none", label: "All" },
  { value: "industry", label: "Industry" },
  { value: "category", label: "Category" },
  { value: "year", label: "Year" },
  { value: "month", label: "Month" },
  { value: "decade", label: "Decade" },
];

export const RUNTIME_OPTIONS: { value: string; label: string }[] = [
  { value: "60", label: "Under 1 hour" },
  { value: "90", label: "Up to 90 min" },
  { value: "120", label: "Up to 2 hours" },
  { value: "150", label: "Up to 2.5 hours" },
];

export interface BrowseState {
  query: string;
  type: string;
  industry: string;
  genre: string;
  language: string;
  decade: string;
  year: string;
  month: string;
  maxRuntime: string;
  sort: SortKey;
  group: GroupKey;
  view: ViewKey;
}

export const DEFAULT_STATE: BrowseState = {
  query: "",
  type: "",
  industry: "",
  genre: "",
  language: "",
  decade: "",
  year: "",
  month: "",
  maxRuntime: "",
  sort: DEFAULT_SORT,
  group: "none",
  view: "grid",
};

export function contentTypeOf(movie: Movie): ContentType {
  return movie.contentType && CONTENT_TYPES.includes(movie.contentType) ? movie.contentType : "movie";
}

export function clearFilters(state: BrowseState): BrowseState {
  return { ...state, query: "", type: "", industry: "", genre: "", language: "", decade: "", year: "", month: "", maxRuntime: "" };
}

export function hasActiveFilters(state: BrowseState): boolean {
  return (
    state.query !== "" || state.type !== "" || state.industry !== "" || state.genre !== "" || state.language !== "" ||
    state.decade !== "" || state.year !== "" || state.month !== "" || state.maxRuntime !== ""
  );
}

export function decadeOf(year: number): number {
  return Math.floor(year / 10) * 10;
}

export function movieCategories(movie: Movie): string[] {
  return movie.genres.length > 0 ? movie.genres : [NO_CATEGORY];
}

export function trendingScore(movie: Movie): number {
  const year = getReleaseYear(movie);
  const thisYear = new Date().getFullYear();
  let score = Math.log10(1 + Math.max(0, movie.popularity ?? 0));
  if (movie.trending) score += 100;
  if (year !== undefined && year >= thisYear - 3) score += 1;
  return score;
}

const TYPE_WORDS: Record<ContentType, string> = { movie: "movie film", show: "show series", video: "video clip", reel: "reel short" };

export function filterMovies(movies: Movie[], state: BrowseState): Movie[] {
  const query = state.query.trim().toLowerCase();
  const terms = query ? query.split(/\s+/) : [];

  return movies.filter((movie) => {
    const year = getReleaseYear(movie);
    const month = getReleaseMonth(movie);
    const type = contentTypeOf(movie);

    if (terms.length > 0) {
      const haystack = [
        movie.title,
        ...(movie.alternateTitles ?? []),
        movie.description,
        movie.director ?? "",
        ...(movie.cast ?? []),
        ...(movie.episodes ?? []).map((e) => e.title),
        ...(movie.languageVersions ?? []).map((v) => v.language),
        industryLabel(movie.industry),
        TYPE_WORDS[type],
        ...movieCategories(movie),
        ...movie.languages,
        year !== undefined ? String(year) : "",
        month !== undefined ? MONTH_NAMES[month - 1] : "",
      ]
        .join(" ")
        .toLowerCase();
      if (!terms.every((term) => haystack.includes(term))) return false;
    }
    if (state.type && type !== state.type) return false;
    if (state.industry && movie.industry !== state.industry) return false;
    if (state.genre && !movieCategories(movie).includes(state.genre)) return false;
    if (state.language && !movie.languages.includes(state.language) && !(movie.languageVersions ?? []).some((v) => v.language === state.language)) return false;
    if (state.decade && (year === undefined || String(decadeOf(year)) !== state.decade)) return false;
    if (state.year && (year === undefined || String(year) !== state.year)) return false;
    if (state.month && (month === undefined || String(month) !== state.month)) return false;
    if (state.maxRuntime) {
      const max = Number(state.maxRuntime);
      if (movie.runtimeMinutes === undefined || movie.runtimeMinutes > max) return false;
    }
    return true;
  });
}

function releaseKey(movie: Movie): number | undefined {
  const year = getReleaseYear(movie);
  if (year === undefined) return undefined;
  return year * 100 + (getReleaseMonth(movie) ?? 0);
}

function dateNumber(value: string | undefined): number | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return undefined;
  return Number(value.slice(0, 4) + value.slice(5, 7) + value.slice(8, 10));
}

function recentKey(movie: Movie): number | undefined {
  return dateNumber(movie.addedAt) ?? dateNumber(movie.publishedAt);
}

/** Missing values always sort last. */
function compareOptional(a: number | undefined, b: number | undefined, direction: 1 | -1): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return (a - b) * direction;
}

export function sortMovies(movies: Movie[], sort: SortKey): Movie[] {
  const copy = movies.slice();
  copy.sort((a, b) => {
    let result = 0;
    if (sort === "recent") {
      result = compareOptional(recentKey(a), recentKey(b), -1);
      if (result === 0) result = compareOptional(dateNumber(a.publishedAt), dateNumber(b.publishedAt), -1);
      if (result === 0) result = compareOptional(releaseKey(a), releaseKey(b), -1);
    } else if (sort === "popular") {
      result = trendingScore(b) - trendingScore(a);
      if (result === 0) result = compareOptional(releaseKey(a), releaseKey(b), -1);
    } else if (sort === "newest") result = compareOptional(releaseKey(a), releaseKey(b), -1);
    else if (sort === "oldest") result = compareOptional(releaseKey(a), releaseKey(b), 1);
    else if (sort === "shortest") result = compareOptional(a.runtimeMinutes, b.runtimeMinutes, 1);
    else if (sort === "longest") result = compareOptional(a.runtimeMinutes, b.runtimeMinutes, -1);
    return result !== 0 ? result : a.title.localeCompare(b.title);
  });
  return copy;
}

function compareCategories(a: string, b: string): number {
  if (a === b) return 0;
  if (a === NO_CATEGORY) return 1;
  if (b === NO_CATEGORY) return -1;
  return a.localeCompare(b);
}

export interface MovieGroup {
  key: string;
  label: string;
  movies: Movie[];
}

export function groupMovies(movies: Movie[], group: GroupKey, sort: SortKey): MovieGroup[] {
  if (group === "none") return [{ key: "all", label: "All titles", movies }];

  const map = new Map<string, MovieGroup & { order: number }>();
  const add = (key: string, label: string, order: number, movie: Movie) => {
    let entry = map.get(key);
    if (!entry) {
      entry = { key, label, order, movies: [] };
      map.set(key, entry);
    }
    entry.movies.push(movie);
  };

  for (const movie of movies) {
    const year = getReleaseYear(movie);
    const month = getReleaseMonth(movie);
    if (group === "industry") {
      const order = INDUSTRIES.findIndex((i) => i.value === movie.industry);
      add("i-" + movie.industry, industryLabel(movie.industry), order, movie);
    } else if (group === "category") {
      for (const category of movieCategories(movie)) add("c-" + category, category, 0, movie);
    } else if (group === "decade") {
      if (year === undefined) add("unknown", "Unknown decade", -1, movie);
      else add("d-" + decadeOf(year), decadeOf(year) + "s", decadeOf(year), movie);
    } else if (group === "year") {
      if (year === undefined) add("unknown", "Unknown year", -1, movie);
      else add("y-" + year, String(year), year, movie);
    } else {
      if (year === undefined || month === undefined) add("unknown", "Unknown month", -1, movie);
      else add("m-" + year + "-" + month, MONTH_NAMES[month - 1] + " " + year, year * 100 + month, movie);
    }
  }

  const descending = sort !== "oldest";
  const groups = Array.from(map.values());
  groups.sort((a, b) => {
    if (group === "category") return compareCategories(a.label, b.label);
    if (group === "industry") return a.order - b.order;
    if (a.order === -1) return 1;
    if (b.order === -1) return -1;
    return descending ? b.order - a.order : a.order - b.order;
  });
  return groups.map((g) => ({ key: g.key, label: g.label, movies: g.movies }));
}

export function groupId(key: string): string {
  return "group-" + key.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export interface Facet {
  value: string;
  label: string;
  count: number;
}

export interface Facets {
  genres: Facet[];
  languages: Facet[];
  decades: Facet[];
  years: Facet[];
  months: Facet[];
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function toFacets(map: Map<string, number>, compare: (a: string, b: string) => number, label: (value: string) => string): Facet[] {
  return Array.from(map.keys())
    .sort(compare)
    .map((value) => ({ value, label: label(value), count: map.get(value) ?? 0 }));
}

export function buildFacets(movies: Movie[]): Facets {
  const genres = new Map<string, number>();
  const languages = new Map<string, number>();
  const decades = new Map<string, number>();
  const years = new Map<string, number>();
  const months = new Map<string, number>();

  for (const movie of movies) {
    movieCategories(movie).forEach((g) => increment(genres, g));
    const langs = new Set([...movie.languages, ...(movie.languageVersions ?? []).map((v) => v.language)]);
    langs.forEach((l) => increment(languages, l));
    const year = getReleaseYear(movie);
    if (year !== undefined) {
      increment(years, String(year));
      increment(decades, String(decadeOf(year)));
    }
    const month = getReleaseMonth(movie);
    if (month !== undefined) increment(months, String(month));
  }

  const byText = (a: string, b: string) => a.localeCompare(b);
  const byNumber = (a: string, b: string) => Number(a) - Number(b);
  const byNumberDesc = (a: string, b: string) => Number(b) - Number(a);

  return {
    genres: toFacets(genres, compareCategories, (v) => v),
    languages: toFacets(languages, byText, (v) => v),
    decades: toFacets(decades, byNumberDesc, (v) => v + "s"),
    years: toFacets(years, byNumberDesc, (v) => v),
    months: toFacets(months, byNumber, (v) => MONTH_NAMES[Number(v) - 1]),
  };
}

export function buildIndustryCounts(movies: Movie[]): Facet[] {
  return INDUSTRIES.map((info) => ({
    value: info.value,
    label: info.label,
    count: movies.filter((m) => m.industry === info.value).length,
  }));
}

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function stateFromSearch(search: string): BrowseState {
  const p = new URLSearchParams(search);
  const industry = p.get("industry") ?? "";
  const type = p.get("type") ?? "";
  return {
    query: p.get("q") ?? "",
    type: (CONTENT_TYPES as readonly string[]).includes(type) ? type : "",
    industry: INDUSTRY_VALUES.includes(industry) ? industry : "",
    genre: p.get("category") ?? "",
    language: p.get("lang") ?? "",
    decade: p.get("decade") ?? "",
    year: p.get("year") ?? "",
    month: p.get("month") ?? "",
    maxRuntime: p.get("runtime") ?? "",
    sort: pick(p.get("sort"), SORT_KEYS, DEFAULT_SORT),
    group: pick(p.get("group"), GROUP_KEYS, "none"),
    view: pick(p.get("view"), VIEW_KEYS, "grid"),
  };
}

export function stateToSearch(state: BrowseState): string {
  const p = new URLSearchParams();
  const entries: [string, string, string][] = [
    ["q", state.query, ""],
    ["type", state.type, ""],
    ["industry", state.industry, ""],
    ["category", state.genre, ""],
    ["lang", state.language, ""],
    ["decade", state.decade, ""],
    ["year", state.year, ""],
    ["month", state.month, ""],
    ["runtime", state.maxRuntime, ""],
    ["sort", state.sort, DEFAULT_SORT],
    ["group", state.group, "none"],
    ["view", state.view, "grid"],
  ];
  for (const [name, value, fallback] of entries) {
    if (value !== fallback) p.set(name, value);
  }
  const text = p.toString();
  return text ? "?" + text : "";
}
`;

files["src/lib/playback-item.ts"] = String.raw`
import type { Movie, PlaybackFields } from "@/types/movie";

/** The title itself, one of its language versions (?version=N) or one of its episodes (?episode=N). */
export function pickPlaybackItem(movie: Movie, episode: string | null, version: string | null = null): PlaybackFields | null {
  if (version !== null && version !== "") {
    const index = Number(version);
    const list = movie.languageVersions ?? [];
    return Number.isInteger(index) && index >= 0 && index < list.length ? list[index] : null;
  }
  if (episode === null || episode === "") return movie;
  const index = Number(episode);
  if (!Number.isInteger(index) || index < 0) return null;
  const list = movie.episodes ?? [];
  return index < list.length ? list[index] : null;
}
`;

files["src/lib/archive.ts"] = String.raw`
import type { CaptionTrack, VideoSource } from "@/types/playback";

export interface ArchiveFile {
  name?: string;
  format?: string;
  size?: string;
  height?: string;
  width?: string;
  length?: string;
  source?: string;
}

export async function getArchiveFiles(identifier: string): Promise<ArchiveFile[]> {
  try {
    const res = await fetch("https://archive.org/metadata/" + encodeURIComponent(identifier), { next: { revalidate: 86400 } });
    if (!res.ok) return [];
    const data = (await res.json()) as { files?: unknown };
    return Array.isArray(data.files) ? (data.files as ArchiveFile[]) : [];
  } catch {
    return [];
  }
}

export function archiveDownloadUrl(identifier: string, name: string): string {
  return "https://archive.org/download/" + encodeURIComponent(identifier) + "/" + name.split("/").map(encodeURIComponent).join("/");
}

function parseLength(value?: string): number {
  if (!value) return 0;
  if (value.includes(":")) return value.split(":").reduce((total, part) => total * 60 + (Number(part) || 0), 0);
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function estimateHeight(bitrateKbps: number): number {
  if (bitrateKbps >= 4000) return 1080;
  if (bitrateKbps >= 2000) return 720;
  if (bitrateKbps >= 900) return 480;
  return 360;
}

export function archiveVideoSources(identifier: string, files: ArchiveFile[]): VideoSource[] {
  const candidates = files
    .filter((f): f is ArchiveFile & { name: string } => typeof f.name === "string" && /\.(mp4|m4v|webm)$/i.test(f.name) && !/thumb/i.test(f.name))
    .map((f) => {
      const length = parseLength(f.length);
      const size = Number(f.size) || 0;
      const bitrate = length > 0 && size > 0 ? Math.round((size * 8) / length / 1000) : 0;
      const realHeight = Number(f.height) || 0;
      const height = realHeight > 0 ? realHeight : bitrate > 0 ? estimateHeight(bitrate) : 0;
      const label = height > 0 ? height + "p" : /512kb/i.test(f.name) ? "Low" : "Standard";
      const source: VideoSource = { label, url: archiveDownloadUrl(identifier, f.name), type: /\.webm$/i.test(f.name) ? "video/webm" : "video/mp4" };
      if (height > 0) source.height = height;
      if (bitrate > 0) source.bitrate = bitrate;
      return source;
    });
  candidates.sort((a, b) => {
    const byHeight = (b.height ?? 0) - (a.height ?? 0);
    if (byHeight !== 0) return byHeight;
    if (a.type !== b.type) return a.type === "video/mp4" ? -1 : 1;
    return (b.bitrate ?? 0) - (a.bitrate ?? 0);
  });
  const seen = new Set<string>();
  const out: VideoSource[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.label)) continue;
    seen.add(candidate.label);
    out.push(candidate);
    if (out.length >= 6) break;
  }
  return out;
}

const LANGUAGE_HINTS: [RegExp, string, string][] = [
  [/(^|[._\-\s])(en|eng|english)([._\-\s]|$)/i, "en", "English"],
  [/hindi|(^|[._\-\s])(hi|hin)([._\-\s]|$)/i, "hi", "Hindi"],
  [/marathi|(^|[._\-\s])(mr|mar)([._\-\s]|$)/i, "mr", "Marathi"],
  [/telugu|(^|[._\-\s])(te|tel)([._\-\s]|$)/i, "te", "Telugu"],
  [/spanish|espanol|(^|[._\-\s])(es|spa)([._\-\s]|$)/i, "es", "Spanish"],
  [/french|francais|(^|[._\-\s])(fr|fre|fra)([._\-\s]|$)/i, "fr", "French"],
  [/german|deutsch|(^|[._\-\s])(de|ger|deu)([._\-\s]|$)/i, "de", "German"],
];

/** Subtitle tracks of an Archive item, served through /api/subtitles. "extra" carries ?episode / ?version. */
export function archiveCaptionTracks(files: ArchiveFile[], slug: string, extra: Record<string, string>): CaptionTrack[] {
  return files
    .filter((f): f is ArchiveFile & { name: string } => typeof f.name === "string" && /\.(srt|vtt)$/i.test(f.name))
    .slice(0, 8)
    .map((f, i) => {
      const hint = LANGUAGE_HINTS.find(([pattern]) => pattern.test(f.name));
      const params = new URLSearchParams({ file: f.name, ...extra });
      return {
        label: hint ? hint[2] : "Subtitles " + (i + 1),
        lang: hint ? hint[1] : "und",
        src: "/api/subtitles/" + encodeURIComponent(slug) + "?" + params.toString(),
      };
    });
}

export function toWebVtt(text: string): string {
  const body = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (body.trimStart().startsWith("WEBVTT")) return body;
  return "WEBVTT\n\n" + body.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
}
`;

files["src/app/api/sources/[slug]/route.ts"] = String.raw`
import { NextResponse } from "next/server";
import { getMovieBySlug } from "@/lib/catalog";
import { pickPlaybackItem } from "@/lib/playback-item";
import { archiveCaptionTracks, archiveVideoSources, getArchiveFiles } from "@/lib/archive";
import { isAllowedDirectUrl, isPlayable } from "@/lib/media";
import type { SourcesResponse, VideoSource } from "@/types/playback";

type Context = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: Context) {
  const { slug } = await context.params;
  const query = new URL(request.url).searchParams;
  const episode = query.get("episode");
  const version = query.get("version");
  const movie = getMovieBySlug(slug);
  const item = movie ? pickPlaybackItem(movie, episode, version) : null;
  if (!movie || !item || !isPlayable(item)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const extra: Record<string, string> = {};
  if (episode) extra.episode = episode;
  if (version) extra.version = version;

  let body: SourcesResponse = { sources: [], captions: [] };
  if (item.playbackType === "archive" && item.playbackId) {
    const files = await getArchiveFiles(item.playbackId);
    body = { sources: archiveVideoSources(item.playbackId, files), captions: archiveCaptionTracks(files, slug, extra) };
  } else if (item.playbackType === "direct_video") {
    let sources: VideoSource[] = [];
    if (item.videoSources && item.videoSources.length > 0) {
      sources = item.videoSources
        .filter((s) => isAllowedDirectUrl(s.url))
        .map((s) => {
          const source: VideoSource = { label: s.label, url: s.url, type: /\.webm(\?|$)/i.test(s.url) ? "video/webm" : "video/mp4" };
          if (s.height) source.height = s.height;
          return source;
        });
      sources.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
    } else if (item.playbackUrl) {
      sources = [{ label: "Default", url: item.playbackUrl }];
    }
    body = { sources, captions: [] };
  }
  return NextResponse.json(body, { headers: { "Cache-Control": "public, max-age=600, s-maxage=3600" } });
}
`;

files["src/app/api/subtitles/[slug]/route.ts"] = String.raw`
import { getMovieBySlug } from "@/lib/catalog";
import { pickPlaybackItem } from "@/lib/playback-item";
import { archiveDownloadUrl, getArchiveFiles, toWebVtt } from "@/lib/archive";

type Context = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: Context) {
  const { slug } = await context.params;
  const query = new URL(request.url).searchParams;
  const file = query.get("file") ?? "";
  const movie = getMovieBySlug(slug);
  const item = movie ? pickPlaybackItem(movie, query.get("episode"), query.get("version")) : null;
  if (!movie || !item || item.playbackType !== "archive" || !item.playbackId || !/\.(srt|vtt)$/i.test(file)) {
    return new Response("Not found", { status: 404 });
  }
  const files = await getArchiveFiles(item.playbackId);
  if (!files.some((f) => f.name === file)) return new Response("Not found", { status: 404 });
  const res = await fetch(archiveDownloadUrl(item.playbackId, file), { next: { revalidate: 86400 } });
  if (!res.ok) return new Response("Subtitles unavailable", { status: 502 });
  const text = await res.text();
  if (text.length > 3000000) return new Response("Subtitles too large", { status: 413 });
  return new Response(toWebVtt(text), {
    headers: { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  });
}
`;

files["src/app/api/thumb/[id]/route.ts"] = String.raw`
import type { PlaybackFields } from "@/types/movie";
import { loadCatalog } from "@/lib/store";
import { thumbnailCandidates } from "@/lib/media";
import { safeFetch } from "@/lib/net";

type Context = { params: Promise<{ id: string }> };

const cache = new Map<string, { type: string; body: ArrayBuffer; expires: number }>();
const MAX_CACHE = 400;
const DAY_MS = 86400000;
const XML_ESCAPES: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" };

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => XML_ESCAPES[c] ?? c);
}

function wrapWords(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if ((line + " " + word).trim().length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = (line + " " + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : ["SGMovies"];
}

/** A clean title card used when no picture exists — so a thumbnail is never broken. */
function fallbackSvg(title: string, tall: boolean): string {
  const width = tall ? 540 : 960;
  const height = tall ? 960 : 540;
  const lines = wrapWords(title || "SGMovies", tall ? 14 : 26).slice(0, 3);
  const fontSize = tall ? 46 : 52;
  const lineHeight = Math.round(fontSize * 1.2);
  const startY = Math.round(height / 2 - ((lines.length - 1) * lineHeight) / 2);
  const text = lines
    .map((line, i) =>
      '<text x="50%" y="' + (startY + i * lineHeight) + '" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, Segoe UI, Roboto, sans-serif" font-size="' +
      fontSize + '" font-weight="700" fill="#f2f4f8">' + escapeXml(line) + "</text>",
    )
    .join("");
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + " " + height + '">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b2f45"/><stop offset="1" stop-color="#12141c"/></linearGradient></defs>' +
    '<rect width="100%" height="100%" fill="url(#g)"/>' +
    '<circle cx="' + Math.round(width * 0.85) + '" cy="' + Math.round(height * 0.15) + '" r="' + Math.round(height * 0.35) + '" fill="#ffb547" opacity="0.10"/>' +
    text +
    '<text x="50%" y="' + (height - 40) + '" text-anchor="middle" font-family="system-ui, sans-serif" font-size="22" font-weight="800" fill="#ffb547" opacity="0.8">SGMovies</text>' +
    "</svg>"
  );
}

function imageResponse(type: string, body: ArrayBuffer): Response {
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function svgResponse(svg: string, maxAge: number): Response {
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=" + maxAge,
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  const query = new URL(request.url).searchParams;
  const size = query.get("size") === "small" ? "small" : "large";
  const tall = query.get("shape") === "tall";
  const record = loadCatalog().raw.find((r) => r.id === id);
  if (!record) return svgResponse(fallbackSvg("SGMovies", tall), 300);

  const title = typeof record.title === "string" ? record.title : "SGMovies";
  const sources: PlaybackFields[] = [];
  const episode = query.get("episode");
  if (episode !== null && Array.isArray(record.episodes)) {
    const item = record.episodes[Number(episode)];
    if (item && typeof item === "object") sources.push(item as PlaybackFields);
  }
  sources.push(record as unknown as PlaybackFields);
  const candidates = Array.from(new Set(sources.flatMap((s) => thumbnailCandidates(s, size))));

  const cacheKey = size + "|" + candidates.join("|");
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return imageResponse(hit.type, hit.body);

  for (const candidate of candidates) {
    try {
      const res = await safeFetch(candidate, { maxBytes: 6000000, timeoutMs: 8000, accept: "image/avif,image/webp,image/*" });
      // Skip errors, non-images, third-party SVGs (unsafe) and tiny placeholders.
      if (!res.ok || !res.contentType.startsWith("image/") || res.contentType.includes("svg") || res.body.byteLength < 1200) continue;
      if (cache.size >= MAX_CACHE) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(cacheKey, { type: res.contentType, body: res.body, expires: Date.now() + DAY_MS });
      return imageResponse(res.contentType, res.body);
    } catch {
      // try the next candidate
    }
  }
  return svgResponse(fallbackSvg(title, tall), 3600);
}
`;

files["src/lib/admin/form.ts"] = String.raw`
import type { PlaybackFields } from "@/types/movie";
import type { RawRecord } from "@/types/admin";
import { INDUSTRIES, INDUSTRY_VALUES } from "@/lib/industries";
import { YOUTUBE_ID } from "@/lib/media";
import { looksLikeUrl, playbackFromLink, slugify } from "@/lib/admin/parse";

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function defaultTerritories(): string[] {
  const list = (process.env.ADMIN_DEFAULT_TERRITORIES || "IN").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  return list.length > 0 ? list : ["IN"];
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function list(value: string, separator: RegExp = /[,\n]/): string[] {
  return Array.from(new Set(value.split(separator).map((s) => s.trim()).filter(Boolean)));
}

function setOrDelete(record: RawRecord, key: string, value: unknown) {
  const empty = value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
  if (empty) delete record[key];
  else record[key] = value;
}

function linkFor(item: Record<string, unknown>): string {
  if (item.playbackType === "youtube" && typeof item.playbackId === "string") return "https://www.youtube.com/watch?v=" + item.playbackId;
  if (item.playbackType === "archive" && typeof item.playbackId === "string") return "https://archive.org/details/" + item.playbackId;
  return typeof item.playbackUrl === "string" ? item.playbackUrl : "";
}

/** Turns the admin form into a catalog record. Fields the form doesn't manage are kept from "base". */
export function buildRecordFromForm(form: FormData, base: RawRecord | null): { record: RawRecord; errors: string[] } {
  const errors: string[] = [];
  const record: RawRecord = base ? { ...base } : {};

  const title = text(form, "title");
  if (!title) errors.push("Title is required.");
  record.title = title;
  record.slug = slugify(text(form, "slug") || title) || "title-" + Date.now().toString(36);
  if (!base || typeof base.id !== "string" || !base.id) record.id = "custom-" + Date.now().toString(36);
  if (!record.addedAt) record.addedAt = todayIso();

  const industry = text(form, "industry");
  record.industry = INDUSTRY_VALUES.includes(industry) ? industry : "hollywood";
  const contentType = text(form, "contentType");
  setOrDelete(record, "contentType", ["show", "video", "reel"].includes(contentType) ? contentType : undefined);
  record.description = text(form, "description") || title;
  setOrDelete(record, "director", text(form, "director"));
  setOrDelete(record, "cast", list(text(form, "cast")));
  setOrDelete(record, "alternateTitles", list(text(form, "alternateTitles"), /\n/));

  const release = text(form, "release");
  delete record.releaseYear;
  delete record.releaseDate;
  if (release) {
    if (/^\d{4}$/.test(release)) record.releaseYear = Number(release);
    else if (/^\d{4}-\d{2}(-\d{2})?$/.test(release)) record.releaseDate = release;
    else errors.push("Release must look like 1968, 1968-10 or 1968-10-01.");
  }

  const info = INDUSTRIES.find((i) => i.value === record.industry);
  const languages = list(text(form, "languages"));
  record.languages = languages.length > 0 ? languages : [info ? info.language : "English"];
  record.genres = list(text(form, "genres"));

  const runtime = text(form, "runtimeMinutes");
  if (runtime && !/^\d+$/.test(runtime)) errors.push("Runtime must be a whole number of minutes.");
  setOrDelete(record, "runtimeMinutes", runtime && /^\d+$/.test(runtime) && Number(runtime) > 0 ? Number(runtime) : undefined);
  setOrDelete(record, "thumbnailUrl", text(form, "thumbnailUrl"));

  // ---- main video ----
  const selected = text(form, "playbackType");
  let playbackType = ["youtube", "archive", "direct_video", "embed"].includes(selected) ? selected : "youtube";
  const linkInput = text(form, "playbackId");
  const urlInput = text(form, "playbackUrl");
  delete record.playbackId;
  delete record.playbackUrl;
  if (linkInput) {
    if (looksLikeUrl(linkInput)) {
      const detected = playbackFromLink(linkInput, true);
      if (!detected) errors.push("Couldn't recognise the video link.");
      else {
        playbackType = detected.playbackType;
        if (detected.playbackId) record.playbackId = detected.playbackId;
        if (detected.playbackUrl) record.playbackUrl = detected.playbackUrl;
      }
    } else if (playbackType === "youtube" || playbackType === "archive") {
      record.playbackId = linkInput;
    } else {
      errors.push('Put the full https link of the file or player in "Video file / player URL".');
    }
  }
  if ((playbackType === "direct_video" || playbackType === "embed") && urlInput) {
    record.playbackUrl = urlInput;
    delete record.playbackId;
  }
  record.playbackType = playbackType;

  const sourceLines = text(form, "videoSources").split("\n").map((l) => l.trim()).filter(Boolean);
  const videoSources: Record<string, unknown>[] = [];
  sourceLines.forEach((line, i) => {
    const [label, url, height] = line.split("|").map((p) => p.trim());
    if (!label || !url) {
      errors.push("Quality line " + (i + 1) + ' must look like "720p | https://… | 720".');
      return;
    }
    const source: Record<string, unknown> = { label, url };
    if (height) {
      if (/^\d+$/.test(height)) source.height = Number(height);
      else errors.push("Quality line " + (i + 1) + ": height must be a number such as 720.");
    }
    videoSources.push(source);
  });
  setOrDelete(record, "videoSources", playbackType === "direct_video" ? videoSources : []);

  // ---- other language versions ----
  const versions: Record<string, unknown>[] = [];
  text(form, "languageVersions")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line, i) => {
      const sep = line.indexOf("|");
      const language = sep === -1 ? "" : line.slice(0, sep).trim();
      const link = sep === -1 ? "" : line.slice(sep + 1).trim();
      if (!language || !link) {
        errors.push("Language line " + (i + 1) + ' must look like "Hindi | https://…".');
        return;
      }
      let detected: PlaybackFields | null = null;
      if (looksLikeUrl(link)) detected = playbackFromLink(link, true);
      else if (YOUTUBE_ID.test(link)) detected = { playbackType: "youtube", playbackId: link };
      if (!detected) {
        errors.push("Language line " + (i + 1) + ": couldn't recognise the video link.");
        return;
      }
      versions.push({ language, ...detected });
    });
  setOrDelete(record, "languageVersions", versions);

  const episodesText = text(form, "episodes");
  if (episodesText) {
    try {
      const parsed: unknown = JSON.parse(episodesText);
      if (Array.isArray(parsed)) record.episodes = parsed;
      else errors.push("Episodes must be a JSON list: [ ... ].");
    } catch {
      errors.push("Episodes is not valid JSON.");
    }
  } else {
    delete record.episodes;
  }

  let sourcePageUrl = text(form, "sourcePageUrl");
  if (!sourcePageUrl) sourcePageUrl = linkFor(record) || urlInput || (videoSources[0] ? String(videoSources[0].url) : "");
  record.sourcePageUrl = sourcePageUrl;

  record.rightsBasis = text(form, "rightsBasis") || (playbackType === "youtube" ? "platform_embed" : "public_domain");
  setOrDelete(record, "licenseUrl", text(form, "licenseUrl"));
  setOrDelete(record, "rightsNotes", text(form, "rightsNotes"));
  record.attribution =
    text(form, "attribution") ||
    title + (playbackType === "youtube" ? " — official upload on YouTube" : playbackType === "archive" ? " via Internet Archive" : "");

  const status = text(form, "rightsStatus");
  record.rightsStatus = ["pending_review", "approved", "rejected"].includes(status) ? status : "pending_review";
  const territories = list(text(form, "territories")).map((t) => t.toUpperCase());
  record.territories = territories.length > 0 ? territories : record.rightsStatus === "approved" ? defaultTerritories() : [];
  record.commercialUseAllowed = form.get("commercialUseAllowed") === "on";

  const reviewer = text(form, "rightsReviewer");
  const reviewedAt = text(form, "rightsReviewedAt");
  if (record.rightsStatus === "approved") {
    record.rightsReviewer = reviewer || "admin";
    record.rightsReviewedAt = reviewedAt || todayIso();
  } else {
    setOrDelete(record, "rightsReviewer", reviewer);
    setOrDelete(record, "rightsReviewedAt", reviewedAt);
  }

  setOrDelete(record, "featured", form.get("featured") === "on" ? true : undefined);
  setOrDelete(record, "trending", form.get("trending") === "on" ? true : undefined);
  const popularity = text(form, "popularity");
  if (popularity && !/^\d+$/.test(popularity)) errors.push("Popularity must be a whole number.");
  setOrDelete(record, "popularity", popularity && /^\d+$/.test(popularity) ? Number(popularity) : undefined);

  return { record, errors };
}

/** Turns a catalog record into the admin form's text values. */
export function toFormValues(record: RawRecord | null): Record<string, string> {
  if (!record) {
    return { industry: "bollywood", contentType: "movie", playbackType: "youtube", rightsStatus: "pending_review", rightsBasis: "platform_embed" };
  }
  const s = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v) : "");
  const join = (v: unknown, sep = ", "): string => (Array.isArray(v) ? v.map((x) => String(x)).join(sep) : "");
  const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {});
  const isLinkType = record.playbackType === "youtube" || record.playbackType === "archive";
  const out: Record<string, string> = {
    title: s(record.title),
    slug: s(record.slug),
    description: s(record.description),
    industry: s(record.industry) || "hollywood",
    contentType: s(record.contentType) || "movie",
    director: s(record.director),
    cast: join(record.cast),
    alternateTitles: join(record.alternateTitles, "\n"),
    release: s(record.releaseDate) || s(record.releaseYear),
    languages: join(record.languages),
    genres: join(record.genres),
    runtimeMinutes: s(record.runtimeMinutes),
    thumbnailUrl: s(record.thumbnailUrl),
    playbackType: s(record.playbackType) || "youtube",
    playbackId: isLinkType ? linkFor(record) : "",
    playbackUrl: s(record.playbackUrl),
    videoSources: Array.isArray(record.videoSources)
      ? record.videoSources.map((v) => { const o = obj(v); return [s(o.label), s(o.url), s(o.height)].filter(Boolean).join(" | "); }).join("\n")
      : "",
    languageVersions: Array.isArray(record.languageVersions)
      ? record.languageVersions.map((v) => { const o = obj(v); return s(o.language) + " | " + linkFor(o); }).join("\n")
      : "",
    episodes: Array.isArray(record.episodes) ? JSON.stringify(record.episodes, null, 2) : "",
    sourcePageUrl: s(record.sourcePageUrl),
    rightsBasis: s(record.rightsBasis),
    licenseUrl: s(record.licenseUrl),
    rightsNotes: s(record.rightsNotes),
    attribution: s(record.attribution),
    territories: join(record.territories),
    rightsStatus: s(record.rightsStatus) || "pending_review",
    rightsReviewer: s(record.rightsReviewer),
    rightsReviewedAt: s(record.rightsReviewedAt),
    popularity: s(record.popularity),
  };
  if (record.commercialUseAllowed === true) out.commercialUseAllowed = "on";
  if (record.featured === true) out.featured = "on";
  if (record.trending === true) out.trending = "on";
  return out;
}
`;

files["src/lib/admin/importers.ts"] = String.raw`
import type { ContentType, Episode, Industry, Movie, PlaybackFields } from "@/types/movie";
import type { ImportType, RawRecord } from "@/types/admin";
import { INDUSTRIES } from "@/lib/industries";
import { validateRecord } from "@/lib/validation";
import { ARCHIVE_ID, YOUTUBE_ID, hashText, isAllowedDirectUrl } from "@/lib/media";
import { extractArchiveId, extractYouTubeId, parseYouTubeTarget, playbackFromLink, slugify } from "@/lib/admin/parse";
import { readWebPage } from "@/lib/admin/webpage";
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
  ["Musical", ["musical", "song", "songs"]],
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
  return asText(value).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
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
  const names = raw.map((v) => String(v).trim()).filter(Boolean).map((v) => LANGUAGE_NAMES[v.toLowerCase()] || v.charAt(0).toUpperCase() + v.slice(1));
  const unique = Array.from(new Set(names));
  return unique.length > 0 ? unique : [fallback];
}

function parseRuntimeText(value: unknown): number | undefined {
  const text = asText(value).trim();
  let minutes = 0;
  let m = /^(\d+):(\d{2}):(\d{2})$/.exec(text);
  if (m) minutes = Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 60;
  else if ((m = /^(\d+):(\d{2})$/.exec(text))) minutes = Number(m[1]) + Number(m[2]) / 60;
  else if ((m = /(\d+)\s*min/i.exec(text))) minutes = Number(m[1]);
  else if ((m = /^(\d+)$/.exec(text))) minutes = Number(m[1]);
  return minutes > 0 ? minutes : undefined;
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

function dayOf(value: unknown): string | undefined {
  const text = asText(first(value));
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : undefined;
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

/** By length: up to 3 minutes = reel, under 40 minutes = video, otherwise movie. */
export function classifyMinutes(minutes: number): ContentType {
  if (minutes <= 3.05) return "reel";
  if (minutes < 40) return "video";
  return "movie";
}

function typeFor(requested: ImportType, minutes: number | undefined, fallback: ContentType): ContentType {
  if (requested !== "auto") return requested;
  return minutes !== undefined && minutes > 0 ? classifyMinutes(minutes) : fallback;
}

function matchesType(requested: ImportType, minutes: number, minMinutes: number): boolean {
  if (requested === "auto") return true;
  if (requested === "movie") return minutes >= minMinutes;
  if (requested === "video") return minutes > 3.05 && minutes < 40;
  if (requested === "reel") return minutes > 0 && minutes <= 3.05;
  return true;
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
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
  if (runtime) {
    movie.runtimeMinutes = Math.max(1, Math.round(runtime));
    const type = classifyMinutes(runtime);
    if (type !== "movie") movie.contentType = type;
  }
  const published = dayOf(doc.addeddate) ?? dayOf(doc.publicdate);
  if (published) movie.publishedAt = published;
  const downloads = Number(first(doc.downloads));
  if (downloads > 0) movie.popularity = downloads;
  return movie;
}

export async function fetchArchiveCandidates(opts: {
  industry: Industry;
  query?: string;
  rows?: number;
  page?: number;
  sort?: "newest" | "popular";
}): Promise<Movie[]> {
  const params = new URLSearchParams();
  params.set("q", opts.query || ARCHIVE_DEFAULT_QUERY[opts.industry]);
  for (const field of ["identifier", "title", "description", "date", "year", "language", "subject", "licenseurl", "runtime", "downloads", "addeddate", "publicdate"]) {
    params.append("fl[]", field);
  }
  params.append("sort[]", opts.sort === "popular" ? "downloads desc" : "addeddate desc");
  params.set("rows", String(opts.rows ?? 30));
  params.set("page", String(opts.page ?? 1));
  params.set("output", "json");
  const res = await fetch("https://archive.org/advancedsearch.php?" + params.toString(), {
    headers: { "User-Agent": "SGMovies admin importer" },
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
  publishedAt?: string;
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

function embeddable(video: YtVideo): boolean {
  return video.status?.embeddable === true && video.status?.privacyStatus === "public" && (video.snippet?.liveBroadcastContent ?? "none") === "none";
}

function videoToMovie(video: YtVideo, industry: Industry, channelFallback: string, today: string, contentType: ContentType): Movie {
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
    slug: slugify(title) || "video-" + video.id.toLowerCase().replace(/[^a-z0-9]/g, ""),
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
  if (contentType !== "movie") movie.contentType = contentType;
  if (title !== rawTitle) movie.alternateTitles = [rawTitle];
  const year = /\b(19[3-9]\d|20[0-2]\d)\b/.exec(rawTitle);
  if (year) movie.releaseYear = Number(year[1]);
  const minutes = Math.round(parseDuration(details.duration));
  if (minutes > 0) movie.runtimeMinutes = minutes;
  const thumb = bestThumb(snippet.thumbnails);
  if (thumb) movie.thumbnailUrl = thumb;
  const published = dayOf(snippet.publishedAt);
  if (published) movie.publishedAt = published;
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
    const data = await ytApi<YtList<YtVideo>>(key, "videos", { part: "snippet,contentDetails,status,statistics", id: ids.slice(i, i + 50).join(",") });
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
  const ordered = ids
    .map((id) => byId.get(id))
    .filter((v): v is YtVideo => v !== undefined && embeddable(v) && parseDuration(v.contentDetails?.duration) >= minMinutes);
  if (ordered.length === 0) throw new Error("No public, embeddable episodes of at least " + minMinutes + " minutes in that playlist.");

  const episodes: Episode[] = ordered.map((video, i) => {
    const rawTitle = video.snippet?.title || video.id;
    const numbers = episodeNumbers(rawTitle, i + 1);
    const episode: Episode = { id: "e-" + video.id, title: cleanTitle(rawTitle), season: numbers.season, episode: numbers.episode, playbackType: "youtube", playbackId: video.id };
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
  const latest = dayOf(ordered[ordered.length - 1]?.snippet?.publishedAt);
  if (latest) show.publishedAt = latest;
  return show;
}

export interface YouTubeImportOptions {
  key: string;
  industry: Industry;
  type: ImportType;
  target: string;
  minMinutes?: number;
  max?: number;
  scan?: number;
}

/** Newest uploads first (YouTube's uploads playlist is already newest-first). Existing titles are refreshed. */
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
    const minutes = parseDuration(video.contentDetails?.duration);
    const type = typeFor(opts.type, minutes, "movie");
    if (existingIds.has("yt-" + video.id)) {
      out.push(videoToMovie(video, opts.industry, channelTitle, today, type));
      continue;
    }
    if (fresh >= max || !embeddable(video) || !matchesType(opts.type, minutes, minMinutes)) continue;
    out.push(videoToMovie(video, opts.industry, channelTitle, today, type));
    fresh++;
  }
  return out;
}

// ---------- Quick add from any link ----------

export interface LinkImportResult {
  movies: Movie[];
  note?: string;
}

async function fromOEmbed(endpoint: string, pageUrl: string, playback: PlaybackFields, industry: Industry, type: ImportType, today: string): Promise<Movie> {
  const res = await fetch(endpoint + encodeURIComponent(pageUrl), { cache: "no-store" });
  if (!res.ok) throw new Error("That video couldn't be read (HTTP " + res.status + "). Is it public and embeddable?");
  const data = (await res.json()) as { title?: string; description?: string; thumbnail_url?: string; author_name?: string; duration?: number; upload_date?: string };
  const title = (data.title || "Untitled").trim();
  const minutes = data.duration ? data.duration / 60 : undefined;
  const host = safeHost(pageUrl);
  const movie: Movie = {
    id: "web-" + hashText(playback.playbackUrl || pageUrl),
    slug: slugify(title) || "video-" + Date.now().toString(36),
    title,
    description: truncate(cleanText(data.description) || title, 400),
    industry,
    languages: [languageFor(industry)],
    genres: guessGenres(title + " " + (data.description ?? "")),
    sourcePageUrl: pageUrl.replace(/^http:/, "https:"),
    ...playback,
    rightsBasis: "platform_embed",
    licenseUrl: null,
    rightsNotes: "Added from " + host + " on " + today + " (uploaded by \"" + (data.author_name || "unknown") + "\"). Confirm the uploader is the official rights holder before approving.",
    attribution: title + " — by " + (data.author_name || host) + " on " + host,
    territories: [],
    commercialUseAllowed: false,
    rightsStatus: "pending_review",
  };
  const contentType = typeFor(type, minutes, "video");
  if (contentType !== "movie") movie.contentType = contentType;
  if (minutes) movie.runtimeMinutes = Math.max(1, Math.round(minutes));
  if (data.thumbnail_url && /^https?:\/\//.test(data.thumbnail_url)) movie.thumbnailUrl = data.thumbnail_url.replace(/^http:/, "https:");
  const published = dayOf(data.upload_date);
  if (published) movie.publishedAt = published;
  return movie;
}

async function fromWebPage(url: string, industry: Industry, type: ImportType, today: string): Promise<LinkImportResult> {
  const page = await readWebPage(url);
  let playback: PlaybackFields | null = null;
  let unknownPlayer = "";
  for (const link of page.videoLinks) {
    const found = playbackFromLink(link);
    if (found) {
      playback = found;
      break;
    }
    if (!unknownPlayer && /^https?:\/\//i.test(link) && !/\.(m3u8|mpd)(\?|$)/i.test(link)) unknownPlayer = link;
  }

  let note: string | undefined;
  if (!playback && unknownPlayer) {
    const host = new URL(unknownPlayer).hostname;
    playback = { playbackType: "embed", playbackUrl: unknownPlayer.replace(/^http:/, "https:") };
    note =
      "Found a video player on " + host + ", which isn't on the allowed list yet. Only if that website is the official rights holder " +
      "(or has permission), add " + host + " to NEXT_PUBLIC_EXTRA_EMBED_HOSTS in .env.local and restart. Until then this title can't be published.";
  }
  if (!playback) {
    playback = { playbackType: "embed" };
    note =
      "No playable video was found on that page (streaming services protect their videos). The title, description and thumbnail were saved — " +
      "add an official video link (YouTube, Vimeo, Dailymotion, archive.org or a permitted .mp4) before publishing.";
  }

  const host = safeHost(page.url);
  const title = (page.title || host || "Untitled").slice(0, 200);
  const language =
    page.language && !(page.language === "English" && industry !== "hollywood") ? page.language : languageFor(industry);
  const fallbackType: ContentType = page.schemaType === "Movie" ? "movie" : page.schemaType === "TVSeries" ? "show" : "video";
  const movie: Movie = {
    id: "web-" + hashText(page.url.replace(/#.*$/, "")),
    slug: slugify(title) || "title-" + Date.now().toString(36),
    title,
    description: truncate(page.description || title, 400),
    industry,
    languages: [language],
    genres: page.genres.length > 0 ? page.genres.slice(0, 3) : guessGenres(title + " " + (page.description ?? "")),
    sourcePageUrl: page.url.replace(/^http:/, "https:"),
    ...playback,
    rightsBasis: playback.playbackType === "youtube" ? "platform_embed" : "written_permission",
    licenseUrl: null,
    rightsNotes:
      "Imported from " + host + " on " + today + ". Confirm that this website (or the uploader) is the official rights holder " +
      "or has permission before approving.",
    attribution: title + " — via " + (page.siteName || host),
    territories: [],
    commercialUseAllowed: false,
    rightsStatus: "pending_review",
  };
  const contentType = typeFor(type, page.durationMinutes, fallbackType);
  if (contentType !== "movie") movie.contentType = contentType;
  if (page.image) {
    const image = page.image.replace(/^http:/, "https:");
    if (/^https:\/\//.test(image)) movie.thumbnailUrl = image;
  }
  if (page.durationMinutes && page.durationMinutes > 0) movie.runtimeMinutes = Math.max(1, Math.round(page.durationMinutes));
  if (page.director) movie.director = page.director;
  if (page.cast.length > 0) movie.cast = page.cast;
  if (page.uploadDate) movie.publishedAt = page.uploadDate;
  if (page.releaseDate) {
    const d = /^(\d{4})-(0[1-9]|1[0-2])/.exec(page.releaseDate);
    const y = /^(\d{4})/.exec(page.releaseDate);
    if (d && Number(d[1]) > 1870) movie.releaseDate = d[1] + "-" + d[2];
    else if (y && Number(y[1]) > 1870) movie.releaseYear = Number(y[1]);
  }
  return { movies: [movie], note };
}

/** Adds a title from any link: YouTube, Internet Archive, Vimeo, Dailymotion, a direct file, or any web page. */
export async function fetchSingleFromUrl(input: string, industry: Industry, type: ImportType): Promise<LinkImportResult> {
  const url = input.trim();
  const key = process.env.YOUTUBE_API_KEY;
  const today = todayIso();
  const host = safeHost(url);

  if (/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(host) || YOUTUBE_ID.test(url)) {
    const target = parseYouTubeTarget(url);
    if (target.playlist) {
      if (!key) throw new Error("Importing a playlist needs YOUTUBE_API_KEY in .env.local.");
      return { movies: await fetchYouTubeCandidates({ key, industry, type, target: target.playlist, max: 50 }, new Set()) };
    }
    const id = extractYouTubeId(url);
    if (!YOUTUBE_ID.test(id)) throw new Error("Couldn't find a YouTube video in that link.");
    if (key) {
      const video = (await fetchVideos(key, [id]))[0];
      if (!video) throw new Error("That YouTube video wasn't found or isn't public.");
      if (video.status?.embeddable !== true) throw new Error("The uploader doesn't allow this video to be embedded on other sites.");
      const minutes = parseDuration(video.contentDetails?.duration);
      return { movies: [videoToMovie(video, industry, "", today, typeFor(type, minutes, "movie"))] };
    }
    const res = await fetch("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + id), { cache: "no-store" });
    if (res.status === 401 || res.status === 403) throw new Error("The uploader doesn't allow this video to be embedded on other sites.");
    if (!res.ok) throw new Error("Couldn't read that YouTube video (HTTP " + res.status + "). Is it public?");
    const data = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
    const rawTitle = data.title || id;
    const title = cleanTitle(rawTitle);
    const channel = data.author_name || "the channel";
    const movie: Movie = {
      id: "yt-" + id,
      slug: slugify(title) || "video-" + id.toLowerCase().replace(/[^a-z0-9]/g, ""),
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
    const contentType = type !== "auto" ? type : /\/shorts\//i.test(url) ? "reel" : "movie";
    if (contentType !== "movie") movie.contentType = contentType;
    if (data.thumbnail_url) movie.thumbnailUrl = data.thumbnail_url.replace(/^http:/, "https:");
    return { movies: [movie] };
  }

  if (host === "archive.org" || host.endsWith(".archive.org")) {
    const id = extractArchiveId(url);
    if (!ARCHIVE_ID.test(id)) throw new Error("Couldn't find an Internet Archive item in that link.");
    const res = await fetch("https://archive.org/metadata/" + encodeURIComponent(id), { cache: "no-store" });
    if (!res.ok) throw new Error("Internet Archive returned HTTP " + res.status + ".");
    const data = (await res.json()) as { metadata?: Record<string, unknown> };
    if (!data.metadata) throw new Error("Internet Archive item not found: " + id);
    const movie = archiveDocToMovie({ ...data.metadata, identifier: id }, industry, today);
    if (!movie) throw new Error("That Internet Archive item can't be used.");
    if (type !== "auto") {
      if (type === "movie") delete movie.contentType;
      else movie.contentType = type;
    }
    return { movies: [movie] };
  }

  const known = playbackFromLink(url);
  if (known && known.playbackType === "embed" && known.playbackUrl) {
    if (known.playbackUrl.includes("player.vimeo.com")) {
      return { movies: [await fromOEmbed("https://vimeo.com/api/oembed.json?url=", url, known, industry, type, today)] };
    }
    if (known.playbackUrl.includes("dailymotion.com")) {
      return { movies: [await fromOEmbed("https://www.dailymotion.com/services/oembed?url=", url, known, industry, type, today)] };
    }
  }

  if (/^https:\/\/\S+\.(mp4|m4v|webm)(\?\S*)?$/i.test(url)) {
    if (!isAllowedDirectUrl(url)) {
      throw new Error("That file's host isn't allowed yet. Add " + host + " to NEXT_PUBLIC_EXTRA_VIDEO_HOSTS in .env.local (only if you have permission) and restart.");
    }
    const fileName = decodeURIComponent(new URL(url).pathname.split("/").pop() || "Untitled");
    const title = fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[._-]+/g, " ").trim() || "Untitled";
    const movie: Movie = {
      id: "direct-" + hashText(url),
      slug: slugify(title) || "video-" + Date.now().toString(36),
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
    };
    if (type !== "auto" && type !== "movie") movie.contentType = type;
    return { movies: [movie] };
  }

  if (!/^https?:\/\//i.test(url)) throw new Error("Paste a full link starting with https://");
  return fromWebPage(url, industry, type, today);
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

function playbackKey(r: Record<string, unknown>): string | null {
  const id = typeof r.playbackId === "string" ? r.playbackId : typeof r.playbackUrl === "string" ? r.playbackUrl : "";
  return id ? String(r.playbackType) + ":" + id : null;
}

/** Adds new titles (stamped with today's date) and refreshes existing ones. Never adds an invalid record. */
export function mergeIntoCatalog(records: RawRecord[], candidates: Movie[], options: { approve?: ApproveOptions } = {}): MergeResult {
  const result: MergeResult = { added: 0, approved: 0, updated: 0, skipped: 0, addedIds: [] };
  const byId = new Map<string, RawRecord>();
  records.forEach((r) => byId.set(String(r.id), r));
  const slugs = new Set(records.map((r) => String(r.slug)));
  const playback = new Set(
    records.filter((r) => r.contentType !== "show").map((r) => playbackKey(r)).filter((k): k is string => k !== null),
  );
  const today = todayIso();

  for (const candidate of candidates) {
    const existing = byId.get(candidate.id);
    if (existing) {
      let changed = false;
      if (candidate.contentType === "show" && candidate.episodes) {
        existing.episodes = candidate.episodes;
        existing.playbackId = candidate.playbackId;
        if (candidate.publishedAt) existing.publishedAt = candidate.publishedAt;
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
    const key = candidate.contentType !== "show" ? playbackKey(candidate as unknown as Record<string, unknown>) : null;
    if (key && playback.has(key)) {
      result.skipped++;
      continue;
    }

    const record = JSON.parse(JSON.stringify({ ...candidate, slug: uniqueSlug(candidate.slug, slugs) })) as RawRecord;
    if (!record.addedAt) record.addedAt = today;
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
    if (key) playback.add(key);
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
`;

files["src/lib/admin/sync.ts"] = String.raw`
import type { ImportSource } from "@/types/admin";
import { loadCatalog, loadSources, mutateCatalog, mutateSources } from "@/lib/store";
import { describeMerge, fetchArchiveCandidates, fetchYouTubeCandidates, mergeIntoCatalog } from "@/lib/admin/importers";
import { defaultTerritories } from "@/lib/admin/form";

export function requireYouTubeKey(): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY is not set in .env.local (restart the server after adding it).");
  return key;
}

/** Fetches the newest titles for one saved source and merges them. Trusted sources publish automatically. */
export async function syncSource(source: ImportSource): Promise<string> {
  let message: string;
  try {
    const existingIds = new Set(loadCatalog().raw.map((r) => String(r.id)));
    const candidates =
      source.kind === "archive"
        ? await fetchArchiveCandidates({ industry: source.industry, query: source.target, rows: source.maxPerSync ?? 30, sort: "newest" })
        : await fetchYouTubeCandidates(
            {
              key: requireYouTubeKey(),
              industry: source.industry,
              type: source.contentType,
              target: source.target,
              minMinutes: source.minMinutes,
              max: source.maxPerSync ?? 50,
            },
            existingIds,
          );
    const approve = source.trusted
      ? { reviewer: "auto (trusted source: " + source.label + ")", territories: source.territories.length > 0 ? source.territories : defaultTerritories() }
      : undefined;
    const result = await mutateCatalog((records) => mergeIntoCatalog(records, candidates, { approve }));
    message = describeMerge(result);
  } catch (error) {
    message = "Failed: " + (error instanceof Error ? error.message : String(error));
  }
  await mutateSources((list) => {
    const saved = list.find((s) => s.id === source.id);
    if (saved) {
      saved.lastSyncAt = new Date().toISOString();
      saved.lastResult = message;
    }
  });
  return source.label + ": " + message;
}

export async function syncAllSources(): Promise<string[]> {
  const results: string[] = [];
  for (const source of loadSources()) results.push(await syncSource(source));
  return results;
}
`;

files["src/app/admin/actions.ts"] = String.raw`
"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { ActionState, ImportSource, ImportType, RawRecord } from "@/types/admin";
import type { Industry } from "@/types/movie";
import { INDUSTRY_VALUES } from "@/lib/industries";
import { validateRecord } from "@/lib/validation";
import { loadCatalog, loadSources, mutateCatalog, mutateSources } from "@/lib/store";
import { adminConfigured, checkCredentials, endSession, requireAdmin, startSession } from "@/lib/admin/auth";
import { buildRecordFromForm, defaultTerritories, todayIso } from "@/lib/admin/form";
import { parseYouTubeTarget } from "@/lib/admin/parse";
import {
  applyPopularity,
  describeMerge,
  fetchArchiveCandidates,
  fetchPopularity,
  fetchSingleFromUrl,
  fetchYouTubeCandidates,
  mergeIntoCatalog,
} from "@/lib/admin/importers";
import { requireYouTubeKey, syncAllSources, syncSource } from "@/lib/admin/sync";

class FormErrors extends Error {
  errors: string[];
  constructor(errors: string[]) {
    super(errors.join(" "));
    this.errors = errors;
  }
}

const IMPORT_TYPES = ["auto", "movie", "show", "video", "reel"];
const loginAttempts = new Map<string, { count: number; until: number }>();

function refreshSite() {
  revalidatePath("/", "layout");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function str(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function intIn(form: FormData, name: string, min: number, max: number, fallback: number): number {
  const n = Number(str(form, name));
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

function industryOf(form: FormData): Industry {
  const value = str(form, "industry");
  return (INDUSTRY_VALUES.includes(value) ? value : "hollywood") as Industry;
}

function importTypeOf(form: FormData, fallback: ImportType = "auto"): ImportType {
  const value = str(form, "contentType");
  return (IMPORT_TYPES.includes(value) ? value : fallback) as ImportType;
}

function formValues(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  form.forEach((value, key) => {
    if (typeof value === "string") out[key] = value;
  });
  return out;
}

function withMessage(path: string, message: string): string {
  const url = new URL(path.startsWith("/admin") ? path : "/admin", "http://localhost");
  url.searchParams.set("msg", message);
  return url.pathname + url.search;
}

function splitTarget(target: string): [string, string] {
  const index = target.indexOf("|");
  return index === -1 ? [target, ""] : [target.slice(0, index), target.slice(index + 1)];
}

// ---------- session ----------

export async function loginAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  if (!adminConfigured()) {
    return { ok: false, message: "The default admin / admin login is disabled on a live server. Set ADMIN_USERNAME and ADMIN_PASSWORD in .env.local and restart." };
  }
  const h = await headers();
  const ip = (h.get("x-forwarded-for") || h.get("x-real-ip") || "local").split(",")[0].trim();
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (entry && entry.until > now) return { ok: false, message: "Too many attempts. Please wait a few minutes and try again." };

  if (!checkCredentials(str(form, "username"), str(form, "password"))) {
    const count = (entry ? entry.count : 0) + 1;
    loginAttempts.set(ip, { count, until: count >= 5 ? now + 10 * 60 * 1000 : 0 });
    return { ok: false, message: "Wrong username or password." };
  }
  loginAttempts.delete(ip);
  await startSession();
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/admin/login");
}

// ---------- titles ----------

export async function saveMovieAction(prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const originalId = str(form, "originalId");
  const values = formValues(form);
  const version = (prev.version ?? 0) + 1;
  let savedId = "";
  try {
    savedId = await mutateCatalog((records) => {
      const index = originalId ? records.findIndex((r) => r.id === originalId) : -1;
      if (originalId && index === -1) throw new FormErrors(["This title no longer exists. It may have been deleted."]);
      const { record, errors } = buildRecordFromForm(form, index === -1 ? null : records[index]);
      if (errors.length > 0) throw new FormErrors(errors);
      if (records.some((r, i) => i !== index && r.id === record.id)) throw new FormErrors(['Another title already uses the id "' + String(record.id) + '".']);
      if (records.some((r, i) => i !== index && r.slug === record.slug)) {
        throw new FormErrors(['Another title already uses the URL slug "' + String(record.slug) + '". Choose a different slug.']);
      }
      const problems = validateRecord(record);
      if (problems.length > 0) throw new FormErrors(problems.map((p) => p.charAt(0).toUpperCase() + p.slice(1) + "."));
      if (index === -1) records.unshift(record);
      else records[index] = record;
      return String(record.id);
    });
  } catch (error) {
    return { ok: false, errors: error instanceof FormErrors ? error.errors : [errorText(error)], values, version };
  }
  refreshSite();
  redirect("/admin/movies/" + encodeURIComponent(savedId) + "?saved=1");
}

export async function deleteMovieAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = str(form, "id");
  let message = "Nothing deleted.";
  try {
    message = await mutateCatalog((records) => {
      const index = records.findIndex((r) => r.id === id);
      if (index === -1) return "That title was already deleted.";
      const [removed] = records.splice(index, 1);
      return "Deleted \"" + String(removed.title ?? id) + "\".";
    });
    refreshSite();
  } catch (error) {
    message = "Error: " + errorText(error);
  }
  redirect(withMessage("/admin", message));
}

const OPERATION_LABELS: Record<string, string> = {
  approve: "Published",
  pending: "Moved to pending",
  reject: "Rejected",
  feature: "Toggled featured on",
  trending: "Toggled trending on",
};

function applyRowOperation(records: RawRecord[], op: string, ids: string[]): string {
  const wanted = new Set(ids);
  const targets = records.filter((r) => wanted.has(String(r.id)));
  if (targets.length === 0) return "Nothing to update.";
  if (op === "delete") {
    for (let i = records.length - 1; i >= 0; i--) {
      if (wanted.has(String(records[i].id))) records.splice(i, 1);
    }
    return "Deleted " + targets.length + " title(s).";
  }
  if (!OPERATION_LABELS[op]) return "Unknown action.";

  const failures: string[] = [];
  for (const record of targets) {
    const before = { ...record };
    const wasValid = validateRecord(before).length === 0;
    if (op === "approve") {
      record.rightsStatus = "approved";
      if (!record.rightsReviewedAt) record.rightsReviewedAt = todayIso();
      if (!record.rightsReviewer) record.rightsReviewer = "admin";
      if (!Array.isArray(record.territories) || record.territories.length === 0) record.territories = defaultTerritories();
    } else if (op === "pending") {
      record.rightsStatus = "pending_review";
    } else if (op === "reject") {
      record.rightsStatus = "rejected";
    } else if (op === "feature") {
      if (record.featured === true) delete record.featured;
      else record.featured = true;
    } else if (op === "trending") {
      if (record.trending === true) delete record.trending;
      else record.trending = true;
    }
    const errors = validateRecord(record);
    if (errors.length > 0 && (wasValid || op === "approve")) {
      for (const key of Object.keys(record)) delete record[key];
      Object.assign(record, before);
      failures.push("\"" + String(record.title ?? record.id) + "\": " + errors[0]);
    }
  }
  const done = targets.length - failures.length;
  let message = OPERATION_LABELS[op] + " " + done + " title(s).";
  if (failures.length > 0) message += " Couldn't update " + failures.length + " — " + failures.slice(0, 3).join(" · ") + ". Open them with Edit to fix.";
  return message;
}

export async function rowAction(form: FormData): Promise<void> {
  await requireAdmin();
  const returnTo = str(form, "returnTo") || "/admin";
  const [rawOp, id] = splitTarget(str(form, "target"));
  const bulk = rawOp.startsWith("bulk-");
  const op = bulk ? rawOp.slice(5) : rawOp;
  const ids = bulk ? form.getAll("ids").map((v) => String(v)) : id ? [id] : [];
  let message: string;
  if (ids.length === 0) {
    message = "Tick at least one title first.";
  } else {
    try {
      message = await mutateCatalog((records) => applyRowOperation(records, op, ids));
      refreshSite();
    } catch (error) {
      message = "Error: " + errorText(error);
    }
  }
  redirect(withMessage(returnTo, message));
}

// ---------- importing ----------

export async function quickAddAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const url = str(form, "url");
  if (!url) return { ok: false, message: "Paste a link first." };
  let newId = "";
  let note = "";
  try {
    const { movies, note: importNote } = await fetchSingleFromUrl(url, industryOf(form), importTypeOf(form));
    note = importNote ?? "";
    const result = await mutateCatalog((records) => mergeIntoCatalog(records, movies));
    if (result.addedIds.length === 0) {
      return { ok: false, message: result.updated > 0 ? "That title is already in the catalog — its details were refreshed." : "That title is already in the catalog." };
    }
    if (result.addedIds.length > 1) {
      refreshSite();
      return { ok: true, message: describeMerge(result) + " Review them on the Titles page." };
    }
    newId = result.addedIds[0];
  } catch (error) {
    return { ok: false, message: errorText(error) };
  }
  refreshSite();
  redirect("/admin/movies/" + encodeURIComponent(newId) + "?added=1" + (note ? "&note=" + encodeURIComponent(note) : ""));
}

export async function importArchiveAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const candidates = await fetchArchiveCandidates({
      industry: industryOf(form),
      query: str(form, "query") || undefined,
      rows: intIn(form, "rows", 1, 200, 30),
      page: intIn(form, "page", 1, 1000, 1),
      sort: str(form, "sort") === "popular" ? "popular" : "newest",
    });
    const result = await mutateCatalog((records) => mergeIntoCatalog(records, candidates));
    refreshSite();
    return { ok: true, message: "Found " + candidates.length + " on the Internet Archive. " + describeMerge(result) + " New titles are pending review." };
  } catch (error) {
    return { ok: false, message: errorText(error) };
  }
}

export async function importYouTubeAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const target = str(form, "target");
  if (!target) return { ok: false, message: "Enter a channel @handle, channel link or playlist link." };
  const type = importTypeOf(form);
  try {
    const existingIds = new Set(loadCatalog().raw.map((r) => String(r.id)));
    const candidates = await fetchYouTubeCandidates(
      {
        key: requireYouTubeKey(),
        industry: industryOf(form),
        type,
        target,
        minMinutes: intIn(form, "minMinutes", 1, 600, type === "show" ? 5 : 70),
        max: intIn(form, "max", 1, 500, 50),
      },
      existingIds,
    );
    const result = await mutateCatalog((records) => mergeIntoCatalog(records, candidates));
    refreshSite();
    return { ok: true, message: describeMerge(result) + " New titles are pending review." };
  } catch (error) {
    return { ok: false, message: errorText(error) };
  }
}

export async function refreshPopularityAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const maps = await fetchPopularity(loadCatalog().raw, process.env.YOUTUBE_API_KEY);
    const updated = await mutateCatalog((records) => applyPopularity(records, maps));
    refreshSite();
    return {
      ok: true,
      message: "Updated popularity for " + updated + " title(s)." + (process.env.YOUTUBE_API_KEY ? "" : " (YouTube titles skipped — add YOUTUBE_API_KEY to include them.)"),
    };
  } catch (error) {
    return { ok: false, message: errorText(error) };
  }
}

// ---------- saved sources ----------

export async function saveSourceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const kind = str(form, "kind") === "archive" ? "archive" : "youtube";
  const target = str(form, "target");
  const contentType: ImportType = kind === "archive" ? "auto" : importTypeOf(form);
  if (!target) return { ok: false, message: kind === "archive" ? "Enter an Internet Archive search query." : "Enter a channel @handle, channel link or playlist link." };
  if (kind === "youtube") {
    const parsed = parseYouTubeTarget(target);
    if (parsed.video) return { ok: false, message: "That's a single video. Saved sources must be a channel or playlist." };
    if (!parsed.handle && !parsed.channel && !parsed.playlist) return { ok: false, message: "That doesn't look like a YouTube channel or playlist." };
    if (contentType === "show" && !parsed.playlist) return { ok: false, message: "A show source must be a playlist (PL…)." };
  }
  const source: ImportSource = {
    id: "src-" + Date.now().toString(36),
    label: str(form, "label") || target,
    kind,
    industry: industryOf(form),
    contentType,
    target,
    trusted: form.get("trusted") === "on",
    territories: str(form, "territories").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean),
    minMinutes: intIn(form, "minMinutes", 1, 600, contentType === "show" ? 5 : 70),
    maxPerSync: intIn(form, "maxPerSync", 1, 200, 30),
  };
  await mutateSources((list) => {
    list.push(source);
  });
  revalidatePath("/admin/import");
  return { ok: true, message: "Saved \"" + source.label + "\". Use Sync now to fetch its newest titles." };
}

export async function sourceRowAction(form: FormData): Promise<void> {
  await requireAdmin();
  const [op, id] = splitTarget(str(form, "target"));
  const source = loadSources().find((s) => s.id === id);
  let message = "Source not found.";
  if (source) {
    if (op === "sync") {
      message = await syncSource(source);
      refreshSite();
    } else if (op === "trust") {
      await mutateSources((list) => {
        const s = list.find((x) => x.id === id);
        if (s) s.trusted = !s.trusted;
      });
      message = (source.trusted ? "Auto-publish turned off for " : "Auto-publish turned on for ") + "\"" + source.label + "\".";
    } else if (op === "delete") {
      await mutateSources((list) => {
        const index = list.findIndex((x) => x.id === id);
        if (index !== -1) list.splice(index, 1);
      });
      message = "Removed source \"" + source.label + "\". Its titles stay in the catalog.";
    }
  }
  revalidatePath("/admin/import");
  redirect(withMessage("/admin/import", message));
}

export async function syncAllAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const results = await syncAllSources();
    refreshSite();
    return { ok: true, message: results.length > 0 ? results.join("\n") : "No saved sources yet — add one below." };
  } catch (error) {
    return { ok: false, message: errorText(error) };
  }
}
`;

files["src/components/Thumb.tsx"] = String.raw`
"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  src: string | null;
  alt: string;
  eager?: boolean;
}

/** Image with a title-card fallback, so a thumbnail never appears broken. */
export default function Thumb({ src, alt, eager = false }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  // Catches images that failed before React attached its handlers.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, [src]);

  if (!src || failed) {
    return (
      <div className="thumb thumb-fallback" aria-hidden="true">
        <span>{alt}</span>
      </div>
    );
  }
  return (
    <img
      ref={imgRef}
      className="thumb"
      src={src}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onLoad={(e) => {
        if (e.currentTarget.naturalWidth <= 2) setFailed(true);
      }}
      onError={() => setFailed(true)}
    />
  );
}
`;

files["src/components/MovieCard.tsx"] = String.raw`
"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import type { Movie } from "@/types/movie";
import Thumb from "@/components/Thumb";
import Icon from "@/components/Icons";
import { thumbSrc } from "@/lib/media";
import { industryLabel } from "@/lib/industries";
import { formatRuntime } from "@/lib/format";
import { formatShortRelease } from "@/lib/dates";

interface Props {
  movie: Movie;
  onPlay?: (movie: Movie) => void;
}

const TYPE_BADGES: Record<string, string> = { video: "Video", reel: "Reel" };

export default function MovieCard({ movie, onPlay }: Props) {
  const type = movie.contentType ?? "movie";
  const isReel = type === "reel";

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!onPlay || isReel) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onPlay(movie);
  }

  const href = isReel ? "/reels?r=" + encodeURIComponent(movie.slug) : "/movies/" + movie.slug;
  const meta = [formatShortRelease(movie), movie.languages[0] ?? ""].filter(Boolean).join(" · ");
  const languageCount = 1 + (movie.languageVersions?.length ?? 0);

  return (
    <li className={"card" + (isReel ? " card-reel" : "")}>
      <Link href={href} className="card-link" onClick={handleClick} aria-label={(onPlay && !isReel ? "Play " : "Open ") + movie.title}>
        <div className="card-media">
          <Thumb src={thumbSrc(movie, { size: "small", shape: isReel ? "tall" : "wide" })} alt={movie.title} />
          <span className="badge badge-industry">{industryLabel(movie.industry)}</span>
          {type === "show" && <span className="badge badge-show">{"Series · " + (movie.episodes?.length ?? 0) + " ep"}</span>}
          {TYPE_BADGES[type] && <span className="badge badge-type">{TYPE_BADGES[type]}</span>}
          {type !== "show" && movie.runtimeMinutes !== undefined && <span className="badge badge-duration">{formatRuntime(movie.runtimeMinutes)}</span>}
          {movie.rightsStatus !== "approved" && <span className="badge badge-pending">Pending</span>}
          <span className="card-play" aria-hidden="true">
            <Icon name="play" />
          </span>
        </div>
        <div className="card-body">
          <h3 className="card-title">{movie.title}</h3>
          {(meta || languageCount > 1) && (
            <p className="card-meta">
              {meta}
              {languageCount > 1 ? (meta ? " · " : "") + languageCount + " languages" : ""}
            </p>
          )}
        </div>
      </Link>
    </li>
  );
}
`;

files["src/components/MovieList.tsx"] = String.raw`
"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import type { Movie } from "@/types/movie";
import Thumb from "@/components/Thumb";
import { formatReleaseDate } from "@/lib/dates";
import { formatRuntime } from "@/lib/format";
import { thumbSrc } from "@/lib/media";
import { industryLabel } from "@/lib/industries";
import { TYPE_LABELS, contentTypeOf } from "@/lib/filter";

interface Props {
  movies: Movie[];
  onPlay?: (movie: Movie) => void;
}

export default function MovieList({ movies, onPlay }: Props) {
  function hrefFor(movie: Movie): string {
    return contentTypeOf(movie) === "reel" ? "/reels?r=" + encodeURIComponent(movie.slug) : "/movies/" + movie.slug;
  }
  function handleClick(event: MouseEvent<HTMLAnchorElement>, movie: Movie) {
    if (!onPlay || contentTypeOf(movie) === "reel") return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onPlay(movie);
  }

  return (
    <div className="table-wrap">
      <table className="movie-table">
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">Thumbnail</span></th>
            <th scope="col">Title</th>
            <th scope="col">Type</th>
            <th scope="col">Industry</th>
            <th scope="col">Released</th>
            <th scope="col">Category</th>
            <th scope="col">Language</th>
            <th scope="col">Runtime</th>
          </tr>
        </thead>
        <tbody>
          {movies.map((movie) => (
            <tr key={movie.id}>
              <td>
                <Link href={hrefFor(movie)} className="table-thumb" tabIndex={-1} aria-hidden="true" onClick={(e) => handleClick(e, movie)}>
                  <Thumb src={thumbSrc(movie, { size: "small" })} alt={movie.title} />
                </Link>
              </td>
              <th scope="row">
                <Link href={hrefFor(movie)} onClick={(e) => handleClick(e, movie)}>{movie.title}</Link>
                {movie.rightsStatus !== "approved" && <span className="pending-tag">Pending</span>}
              </th>
              <td>{TYPE_LABELS[contentTypeOf(movie)].replace(/s$/, "")}</td>
              <td>{industryLabel(movie.industry)}</td>
              <td>{formatReleaseDate(movie) || "—"}</td>
              <td>{movie.genres.join(", ") || "—"}</td>
              <td>{[...movie.languages, ...(movie.languageVersions ?? []).map((v) => v.language)].join(", ") || "—"}</td>
              <td>{formatRuntime(movie.runtimeMinutes) || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
`;

files["src/components/RowCarousel.tsx"] = String.raw`
"use client";

import { useRef } from "react";
import type { Movie } from "@/types/movie";
import MovieCard from "@/components/MovieCard";
import Icon from "@/components/Icons";

interface Props {
  title: string;
  subtitle?: string;
  movies: Movie[];
  variant?: "wide" | "tall";
  onPlay?: (movie: Movie) => void;
  onSeeAll?: () => void;
}

export default function RowCarousel({ title, subtitle, movies, variant = "wide", onPlay, onSeeAll }: Props) {
  const listRef = useRef<HTMLUListElement>(null);

  function scroll(direction: 1 | -1) {
    const el = listRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: "smooth" });
  }

  return (
    <section className="row" aria-label={title}>
      <div className="row-head">
        <div>
          <h2 className="row-title">{title}</h2>
          {subtitle && <p className="row-subtitle">{subtitle}</p>}
        </div>
        <div className="row-actions">
          {onSeeAll && (
            <button type="button" className="link-button" onClick={onSeeAll}>See all</button>
          )}
          <button type="button" className="icon-btn" aria-label={"Scroll " + title + " left"} onClick={() => scroll(-1)}>
            <Icon name="chevronLeft" size={20} />
          </button>
          <button type="button" className="icon-btn" aria-label={"Scroll " + title + " right"} onClick={() => scroll(1)}>
            <Icon name="chevronRight" size={20} />
          </button>
        </div>
      </div>
      <ul ref={listRef} className={"row-list" + (variant === "tall" ? " row-list-tall" : "")}>
        {movies.map((movie) => (
          <MovieCard key={movie.id} movie={movie} onPlay={onPlay} />
        ))}
      </ul>
    </section>
  );
}
`;

files["src/components/Hero.tsx"] = String.raw`
"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Link from "next/link";
import type { Movie } from "@/types/movie";
import Icon from "@/components/Icons";
import Thumb from "@/components/Thumb";
import { thumbSrc } from "@/lib/media";
import { industryLabel } from "@/lib/industries";
import { movieMetaLine } from "@/lib/format";

export interface HeroCollection {
  key: string;
  label: string;
  items: Movie[];
}

const SLIDE_MS = 7000;

export default function Hero({ collections, onPlay }: { collections: HeroCollection[]; onPlay: (movie: Movie) => void }) {
  const available = collections.filter((c) => c.items.length > 0);
  const [tabIndex, setTabIndex] = useState(0);
  const [slide, setSlide] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [paused, setPaused] = useState(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  const tab = available.length > 0 ? available[Math.min(tabIndex, available.length - 1)] : null;
  const items = tab ? tab.items : [];
  const count = items.length;
  const active = count > 0 ? slide % count : 0;

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const el = rail.children[active] as HTMLElement | undefined;
    if (el) rail.scrollTo({ left: el.offsetLeft - rail.clientWidth / 2 + el.clientWidth / 2, behavior: "smooth" });
  }, [active, tabIndex]);

  if (!tab || count === 0) return null;
  const movie = items[active];
  const isShow = movie.contentType === "show";

  function go(target: number, dir: 1 | -1) {
    setDirection(dir);
    setSlide(((target % count) + count) % count);
  }
  function next() {
    go(active + 1, 1);
  }
  function prev() {
    go(active - 1, -1);
  }
  function selectTab(index: number) {
    setTabIndex(index);
    setSlide(0);
    setDirection(1);
  }
  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      next();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      prev();
    }
  }
  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    pointerStart.current = { x: event.clientX, y: event.clientY };
  }
  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) next();
      else prev();
    }
  }

  return (
    <section
      className="showcase"
      aria-roledescription="carousel"
      aria-label="Featured"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") setPaused(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setPaused(false);
      }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      style={{ "--slide-ms": SLIDE_MS + "ms" } as CSSProperties}
    >
      <div className="showcase-slides" aria-hidden="true">
        {items.map((m, i) => {
          const near = Math.abs(i - active) <= 1 || (active === 0 && i === count - 1) || (active === count - 1 && i === 0);
          return (
            <div key={tab.key + "-" + m.id} className={"showcase-slide" + (i === active ? " is-active" : "")}>
              {near ? <img src={thumbSrc(m, { size: "large" })} alt="" decoding="async" /> : null}
            </div>
          );
        })}
      </div>
      <div className="showcase-shade" />

      <div className="showcase-tabs" role="tablist" aria-label="Collections">
        {available.map((c, i) => (
          <button key={c.key} type="button" role="tab" aria-selected={c.key === tab.key} className="showcase-tab" onClick={() => selectTab(i)}>
            {c.key === "trending" && <Icon name="fire" size={16} />}
            {c.label}
          </button>
        ))}
      </div>

      {count > 1 && (
        <div className="showcase-arrows">
          <button type="button" className="icon-btn" aria-label="Previous" onClick={prev}>
            <Icon name="chevronLeft" size={20} />
          </button>
          <button type="button" className="icon-btn" aria-label="Next" onClick={next}>
            <Icon name="chevronRight" size={20} />
          </button>
        </div>
      )}

      <div key={tab.key + "-" + movie.id} className={"showcase-content" + (direction === -1 ? " from-left" : "")}>
        <div className="showcase-badges">
          {tab.key === "trending" && (
            <span className="pill pill-accent">
              <Icon name="fire" size={14} /> {"#" + (active + 1) + " Trending"}
            </span>
          )}
          {tab.key === "latest" && <span className="pill pill-accent">New</span>}
          <span className="pill">{industryLabel(movie.industry)}</span>
          {isShow && <span className="pill">{"Series · " + (movie.episodes?.length ?? 0) + " episodes"}</span>}
          {(movie.languageVersions?.length ?? 0) > 0 && <span className="pill">{1 + (movie.languageVersions?.length ?? 0) + " languages"}</span>}
        </div>
        <h2 className="showcase-title">{movie.title}</h2>
        <p className="showcase-meta">{movieMetaLine(movie)}</p>
        <p className="showcase-desc">{movie.description}</p>
        <div className="showcase-actions">
          <button type="button" className="btn btn-primary btn-lg" onClick={() => onPlay(movie)}>
            <Icon name="play" /> {isShow ? "Play episode 1" : "Play"}
          </button>
          <Link href={"/movies/" + movie.slug} className="btn btn-lg btn-glass">
            <Icon name="info" /> More info
          </Link>
        </div>
      </div>

      {count > 1 && (
        <div className="showcase-rail" ref={railRef} role="tablist" aria-label="Choose a title">
          {items.map((m, i) => (
            <button
              key={tab.key + "-rail-" + m.id}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={m.title}
              className={"rail-item" + (i === active ? " is-active" : "")}
              onClick={() => go(i, i >= active ? 1 : -1)}
            >
              <Thumb src={thumbSrc(m, { size: "small" })} alt={m.title} />
            </button>
          ))}
        </div>
      )}

      {count > 1 && (
        <div className="showcase-dots">
          {items.map((m, i) => (
            <button
              key={tab.key + "-dot-" + m.id}
              type="button"
              aria-label={"Show " + m.title}
              className={"showcase-dot" + (i === active ? " is-active" : "")}
              onClick={() => go(i, i >= active ? 1 : -1)}
            />
          ))}
        </div>
      )}

      {count > 1 && (
        <span key={tab.key + "-progress-" + active} className={"showcase-progress" + (paused ? " is-paused" : "")} onAnimationEnd={next} aria-hidden="true" />
      )}
    </section>
  );
}
`;

files["src/components/VideoPlayer.tsx"] = String.raw`
"use client";

import { useEffect, useMemo, useState } from "react";
import type { Episode, Movie, PlaybackFields } from "@/types/movie";
import type { SourcesResponse } from "@/types/playback";
import Thumb from "@/components/Thumb";
import Icon from "@/components/Icons";
import CustomVideoPlayer from "@/components/CustomVideoPlayer";
import { embedUrlFor, isPlayable, thumbSrc } from "@/lib/media";
import { formatRuntime } from "@/lib/format";
import { reportMailto } from "@/lib/contact";

const LANGUAGE_KEY = "sgmovies:language";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: SourcesResponse }
  | { status: "failed" };

function Unavailable({ movie }: { movie: Movie }) {
  return (
    <div className="unavailable" role="status">
      <p><strong>This title isn&apos;t ready to play yet.</strong></p>
      <p className="muted small">
        Its video source hasn&apos;t been added yet. <a href={reportMailto("broken_playback", movie)}>Report a problem</a>
      </p>
    </div>
  );
}

function EmbedFrame({ src, title, movie, note }: { src: string; title: string; movie: Movie; note: string }) {
  return (
    <div>
      <div className="player-frame">
        <iframe
          src={src}
          title={"Player: " + title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      <p className="player-help">
        {note} Not playing? <a href={reportMailto("broken_playback", movie)}>Report it</a>.
      </p>
    </div>
  );
}

interface SourcePlayerProps {
  movie: Movie;
  item: PlaybackFields;
  query: string;
  storageKey: string;
  title: string;
  poster: string;
  autoPlay: boolean;
  onEnded?: () => void;
}

function SourcePlayer({ movie, item, query, storageKey, title, poster, autoPlay, onEnded }: SourcePlayerProps) {
  const [started, setStarted] = useState(autoPlay);
  const [load, setLoad] = useState<LoadState>({ status: "idle" });
  const playable = isPlayable(item);
  const needsSources = playable && (item.playbackType === "archive" || item.playbackType === "direct_video");

  useEffect(() => {
    if (!started || !needsSources) return;
    const controller = new AbortController();
    setLoad({ status: "loading" });
    fetch("/api/sources/" + encodeURIComponent(movie.slug) + (query ? "?" + query : ""), { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json() as Promise<SourcesResponse>;
      })
      .then((data) => setLoad({ status: "ready", data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn("Could not load video sources", error);
        setLoad({ status: "failed" });
      });
    return () => controller.abort();
  }, [started, needsSources, movie.slug, query]);

  if (!playable) return <Unavailable movie={movie} />;

  if (!started) {
    return (
      <button type="button" className="player-frame player-facade" onClick={() => setStarted(true)} aria-label={"Play " + title}>
        <Thumb src={poster} alt={title} eager />
        <span className="facade-play" aria-hidden="true">
          <Icon name="play" size={40} />
        </span>
      </button>
    );
  }

  if (item.playbackType === "youtube" || item.playbackType === "embed") {
    const src = embedUrlFor(item, true);
    if (!src) return <Unavailable movie={movie} />;
    return (
      <EmbedFrame
        src={src}
        title={title}
        movie={movie}
        note={item.playbackType === "youtube" ? "Quality, subtitles and speed are in the ⚙ menu inside the player." : "Playing with the official player of the source website."}
      />
    );
  }

  if (load.status === "ready" && load.data.sources.length > 0) {
    return (
      <CustomVideoPlayer
        sources={load.data.sources}
        captions={load.data.captions}
        poster={poster}
        title={title}
        autoPlay
        storageKey={storageKey}
        onEnded={onEnded}
      />
    );
  }

  if (load.status === "ready" || load.status === "failed") {
    if (item.playbackType === "archive") {
      const src = embedUrlFor(item, true);
      if (src) return <EmbedFrame src={src} title={title} movie={movie} note="Using the Internet Archive's own player." />;
    }
    return <Unavailable movie={movie} />;
  }

  return (
    <div className="player-frame player-loading" role="status" aria-label="Loading video">
      <Thumb src={poster} alt={title} eager />
      <span className="cvp-spinner" aria-hidden="true" />
    </div>
  );
}

function EpisodeList({ movie, episodes, activeIndex, onSelect }: { movie: Movie; episodes: Episode[]; activeIndex: number; onSelect: (index: number) => void }) {
  const seasons = useMemo(() => Array.from(new Set(episodes.map((ep) => ep.season ?? 1))).sort((a, b) => a - b), [episodes]);
  const [season, setSeason] = useState<number>(episodes[activeIndex]?.season ?? seasons[0] ?? 1);
  const visible = episodes.map((ep, index) => ({ ep, index })).filter(({ ep }) => (ep.season ?? 1) === season);

  return (
    <section className="episodes" aria-label="Episodes">
      <div className="episodes-head">
        <h3>
          Episodes <span className="muted small">({episodes.length})</span>
        </h3>
        {seasons.length > 1 && (
          <label>
            <span className="sr-only">Season</span>
            <select value={season} onChange={(event) => setSeason(Number(event.target.value))}>
              {seasons.map((s) => (
                <option key={s} value={s}>{"Season " + s}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <ol className="episode-list">
        {visible.map(({ ep, index }) => (
          <li key={ep.id}>
            <button
              type="button"
              className={"episode" + (index === activeIndex ? " is-active" : "")}
              onClick={() => onSelect(index)}
              aria-current={index === activeIndex ? "true" : undefined}
            >
              <span className="episode-thumb">
                <Thumb src={thumbSrc(movie, { episode: index, size: "small" })} alt={ep.title} />
                {index === activeIndex && <span className="now-playing">Now playing</span>}
              </span>
              <span className="episode-text">
                <span className="episode-num">{"S" + (ep.season ?? 1) + " · E" + (ep.episode ?? index + 1)}</span>
                <span className="episode-title">{ep.title}</span>
                {ep.runtimeMinutes !== undefined && <span className="episode-meta">{formatRuntime(ep.runtimeMinutes)}</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

interface LanguageOption {
  key: string;
  label: string;
  item: PlaybackFields;
  query: string;
}

export default function VideoPlayer({ movie, autoPlay = false }: { movie: Movie; autoPlay?: boolean }) {
  const episodes = movie.episodes ?? [];
  const isShow = movie.contentType === "show" && episodes.length > 0;

  const languageOptions = useMemo<LanguageOption[]>(() => {
    if (isShow || !movie.languageVersions || movie.languageVersions.length === 0) return [];
    const options: LanguageOption[] = [
      { key: "main", label: movie.languages[0] ?? "Original", item: movie, query: "" },
      ...movie.languageVersions.map((version, i) => ({ key: "v" + i, label: version.language, item: version as PlaybackFields, query: "version=" + i })),
    ];
    return options.filter((option) => isPlayable(option.item));
  }, [movie, isShow]);

  const [episodeIndex, setEpisodeIndex] = useState(0);
  const [languageIndex, setLanguageIndex] = useState(0);
  const [startPlaying, setStartPlaying] = useState(autoPlay);

  // Start in the viewer's preferred language when this title has it.
  useEffect(() => {
    if (languageOptions.length < 2) return;
    try {
      const preferred = window.localStorage.getItem(LANGUAGE_KEY);
      const index = preferred ? languageOptions.findIndex((o) => o.label.toLowerCase() === preferred.toLowerCase()) : -1;
      if (index > 0) setLanguageIndex(index);
    } catch {
      // storage unavailable
    }
  }, [languageOptions]);

  function chooseLanguage(index: number) {
    setLanguageIndex(index);
    setStartPlaying(true);
    try {
      window.localStorage.setItem(LANGUAGE_KEY, languageOptions[index].label);
    } catch {
      // storage unavailable
    }
  }

  function playEpisode(index: number) {
    setEpisodeIndex(index);
    setStartPlaying(true);
  }

  const safeEpisode = Math.min(episodeIndex, Math.max(episodes.length - 1, 0));
  const safeLanguage = Math.min(languageIndex, Math.max(languageOptions.length - 1, 0));
  let item: PlaybackFields = movie;
  let query = "";
  let keySuffix = "main";
  let title = movie.title;
  if (isShow) {
    item = episodes[safeEpisode];
    query = "episode=" + safeEpisode;
    keySuffix = "e" + safeEpisode;
    title = movie.title + " · " + episodes[safeEpisode].title;
  } else if (languageOptions.length > 0) {
    const option = languageOptions[safeLanguage];
    item = option.item;
    query = option.query;
    keySuffix = option.key;
    title = movie.title + " (" + option.label + ")";
  }
  const hasNext = isShow && safeEpisode < episodes.length - 1;

  return (
    <div className="video-player">
      {languageOptions.length > 1 && (
        <div className="lang-switch" role="group" aria-label="Choose language">
          <span className="lang-switch-label">Language</span>
          {languageOptions.map((option, index) => (
            <button key={option.key} type="button" aria-pressed={index === safeLanguage} onClick={() => chooseLanguage(index)}>
              {option.label}
            </button>
          ))}
        </div>
      )}
      <SourcePlayer
        key={keySuffix}
        movie={movie}
        item={item}
        query={query}
        storageKey={"sgmovies:position:" + movie.id + ":" + keySuffix}
        title={title}
        poster={thumbSrc(movie, { episode: isShow ? safeEpisode : undefined })}
        autoPlay={startPlaying}
        onEnded={hasNext ? () => playEpisode(safeEpisode + 1) : undefined}
      />
      {isShow && <EpisodeList movie={movie} episodes={episodes} activeIndex={safeEpisode} onSelect={playEpisode} />}
    </div>
  );
}
`;

files["src/components/ReelsViewer.tsx"] = String.raw`
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Movie } from "@/types/movie";
import Thumb from "@/components/Thumb";
import Icon from "@/components/Icons";
import { embedUrlFor, isPlayable, thumbSrc } from "@/lib/media";
import { industryLabel } from "@/lib/industries";

function reelEmbed(movie: Movie): string | null {
  if (movie.playbackType === "youtube" && movie.playbackId) {
    const params = new URLSearchParams({ autoplay: "1", mute: "1", loop: "1", playlist: movie.playbackId, playsinline: "1", rel: "0", controls: "1" });
    return "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(movie.playbackId) + "?" + params.toString();
  }
  return embedUrlFor(movie, true);
}

function ReelMedia({ movie }: { movie: Movie }) {
  const [muted, setMuted] = useState(true);
  if (!isPlayable(movie)) return <div className="reel-unavailable">Not available yet</div>;
  if (movie.playbackType === "direct_video") {
    const src = movie.videoSources?.[0]?.url ?? movie.playbackUrl;
    return (
      <>
        <video
          className="reel-video"
          src={src}
          poster={thumbSrc(movie, { shape: "tall" })}
          autoPlay
          muted={muted}
          loop
          playsInline
          onClick={(e) => {
            const video = e.currentTarget;
            if (video.paused) video.play().catch(() => undefined);
            else video.pause();
          }}
        />
        <button type="button" className="icon-btn reel-mute" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute" : "Mute"}>
          <Icon name={muted ? "mute" : "volume"} size={20} />
        </button>
      </>
    );
  }
  const src = reelEmbed(movie);
  return src ? (
    <iframe
      className="reel-iframe"
      src={src}
      title={"Reel: " + movie.title}
      allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
    />
  ) : (
    <div className="reel-unavailable">Not available yet</div>
  );
}

export default function ReelsViewer({ reels, startSlug }: { reels: Movie[]; startSlug: string }) {
  const startIndex = Math.max(0, reels.findIndex((r) => r.slug === startSlug));
  const [active, setActive] = useState(startIndex);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    itemRefs.current[startIndex]?.scrollIntoView({ block: "start" });
  }, [startIndex]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            const index = Number((entry.target as HTMLElement).dataset.index);
            if (Number.isInteger(index)) setActive(index);
          }
        }
      },
      { root, threshold: [0.6] },
    );
    itemRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [reels.length]);

  useEffect(() => {
    const reel = reels[active];
    if (reel) window.history.replaceState(null, "", "/reels?r=" + encodeURIComponent(reel.slug));
  }, [active, reels]);

  function go(delta: number) {
    const next = Math.min(reels.length - 1, Math.max(0, active + delta));
    itemRefs.current[next]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="reels-page">
      <div
        className="reels"
        ref={containerRef}
        tabIndex={0}
        aria-label="Reels — use the arrow keys to move between reels"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "j") {
            e.preventDefault();
            go(1);
          } else if (e.key === "ArrowUp" || e.key === "k") {
            e.preventDefault();
            go(-1);
          }
        }}
      >
        {reels.map((reel, i) => (
          <section
            key={reel.id}
            className="reel"
            data-index={i}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            aria-label={reel.title}
          >
            <div className="reel-frame">
              {i === active ? <ReelMedia movie={reel} /> : <Thumb src={thumbSrc(reel, { size: "small", shape: "tall" })} alt={reel.title} />}
            </div>
            <div className="reel-info">
              <span className="pill">{industryLabel(reel.industry)}</span>
              <h2>{reel.title}</h2>
              {reel.description !== reel.title && <p>{reel.description}</p>}
              <p className="reel-credit">{reel.attribution}</p>
              <Link className="link-button" href={"/movies/" + reel.slug}>Details</Link>
            </div>
          </section>
        ))}
      </div>
      <div className="reels-nav">
        <button type="button" className="icon-btn" onClick={() => go(-1)} disabled={active === 0} aria-label="Previous reel">↑</button>
        <span>{active + 1 + " / " + reels.length}</span>
        <button type="button" className="icon-btn" onClick={() => go(1)} disabled={active === reels.length - 1} aria-label="Next reel">↓</button>
      </div>
    </div>
  );
}
`;

files["src/app/reels/page.tsx"] = String.raw`
import type { Metadata } from "next";
import Link from "next/link";
import ReelsViewer from "@/components/ReelsViewer";
import { getPublicMovies } from "@/lib/catalog";
import { sortMovies } from "@/lib/filter";

export const metadata: Metadata = { title: "Reels" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ReelsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const start = typeof sp.r === "string" ? sp.r : "";
  const reels = sortMovies(getPublicMovies().filter((m) => m.contentType === "reel"), "recent");
  if (reels.length === 0) {
    return (
      <div className="empty-state">
        <h1>No reels yet</h1>
        <p>Short clips appear here once they&apos;re added. <Link href="/">Browse everything</Link></p>
      </div>
    );
  }
  return <ReelsViewer key={start} reels={reels} startSlug={start} />;
}
`;

files["src/components/Catalog.tsx"] = String.raw`
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Movie } from "@/types/movie";
import Hero, { type HeroCollection } from "@/components/Hero";
import RowCarousel from "@/components/RowCarousel";
import MovieGrid from "@/components/MovieGrid";
import MovieList from "@/components/MovieList";
import FilterPanel from "@/components/FilterPanel";
import ActiveFilters from "@/components/ActiveFilters";
import PlayerModal from "@/components/PlayerModal";
import { INDUSTRIES, industryLabel } from "@/lib/industries";
import {
  CONTENT_TYPES,
  GROUP_OPTIONS,
  NO_CATEGORY,
  SORT_OPTIONS,
  TYPE_LABELS,
  buildFacets,
  buildIndustryCounts,
  clearFilters,
  contentTypeOf,
  filterMovies,
  groupId,
  groupMovies,
  hasActiveFilters,
  movieCategories,
  sortMovies,
  stateFromSearch,
  stateToSearch,
  type BrowseState,
  type SortKey,
} from "@/lib/filter";

const PAGE_SIZE = 48;
const ROW_LIMIT = 30;
const HERO_LIMIT = 8;

interface HomeRow {
  key: string;
  title: string;
  subtitle: string;
  list: Movie[];
  variant?: "wide" | "tall";
  seeAll: Partial<BrowseState> | "reels";
}

interface Props {
  movies: Movie[];
  initialSearch: string;
}

function countLabel(count: number, noun: string): string {
  return count + " " + noun + (count === 1 ? "" : "s");
}

export default function Catalog({ movies, initialSearch }: Props) {
  const router = useRouter();
  const [state, setState] = useState<BrowseState>(() => stateFromSearch(initialSearch));
  const [playingSlug, setPlayingSlug] = useState<string | null>(() => new URLSearchParams(initialSearch).get("play"));
  const [limit, setLimit] = useState(PAGE_SIZE);
  const browseRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(stateToSearch(state));
    if (playingSlug) params.set("play", playingSlug);
    const query = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (query ? "?" + query : ""));
  }, [state, playingSlug]);

  const recentFirst = useMemo(() => sortMovies(movies, "recent"), [movies]);
  const popularFirst = useMemo(() => sortMovies(movies, "popular"), [movies]);
  const isLongForm = (m: Movie) => {
    const t = contentTypeOf(m);
    return t === "movie" || t === "show";
  };
  const industryCounts = useMemo(() => buildIndustryCounts(movies), [movies]);
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { movie: 0, show: 0, video: 0, reel: 0 };
    for (const m of movies) counts[contentTypeOf(m)]++;
    return counts;
  }, [movies]);
  const scoped = useMemo(
    () => movies.filter((m) => (!state.industry || m.industry === state.industry) && (!state.type || contentTypeOf(m) === state.type)),
    [movies, state.industry, state.type],
  );
  const facets = useMemo(() => buildFacets(scoped), [scoped]);
  const results = useMemo(() => sortMovies(filterMovies(movies, state), state.sort), [movies, state]);
  const groups = useMemo(() => groupMovies(results, state.group, state.sort), [results, state.group, state.sort]);

  const heroCollections = useMemo<HeroCollection[]>(() => {
    const longPopular = popularFirst.filter(isLongForm);
    const featured = longPopular.filter((m) => m.featured);
    return [
      { key: "trending", label: "Trending", items: [...featured, ...longPopular.filter((m) => !m.featured)].slice(0, HERO_LIMIT) },
      { key: "latest", label: "Latest", items: recentFirst.filter(isLongForm).slice(0, HERO_LIMIT) },
      { key: "movies", label: "Movies", items: longPopular.filter((m) => contentTypeOf(m) === "movie").slice(0, HERO_LIMIT) },
      { key: "shows", label: "Shows", items: longPopular.filter((m) => contentTypeOf(m) === "show").slice(0, HERO_LIMIT) },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentFirst, popularFirst]);

  const homeRows = useMemo<HomeRow[]>(() => {
    const notReel = (m: Movie) => contentTypeOf(m) !== "reel";
    const rows: HomeRow[] = [
      { key: "trending", title: "Trending now", subtitle: "Most watched and featured", list: popularFirst.filter(notReel).slice(0, ROW_LIMIT), seeAll: { sort: "popular" } },
      { key: "recent", title: "Recently added", subtitle: "The newest titles on SGMovies", list: recentFirst.filter(notReel).slice(0, ROW_LIMIT), seeAll: { sort: "recent" } },
    ];
    const reels = recentFirst.filter((m) => contentTypeOf(m) === "reel");
    if (reels.length > 0) rows.push({ key: "reels", title: "Reels", subtitle: "Short clips · tap to watch", list: reels.slice(0, ROW_LIMIT), variant: "tall", seeAll: "reels" });
    const videos = recentFirst.filter((m) => contentTypeOf(m) === "video");
    if (videos.length > 0) rows.push({ key: "videos", title: "Videos", subtitle: "Songs, clips and trailers · " + countLabel(videos.length, "video"), list: videos.slice(0, ROW_LIMIT), seeAll: { type: "video" } });
    const shows = recentFirst.filter((m) => contentTypeOf(m) === "show");
    if (shows.length > 0) rows.push({ key: "shows", title: "Shows & series", subtitle: countLabel(shows.length, "show"), list: shows.slice(0, ROW_LIMIT), seeAll: { type: "show" } });
    const films = recentFirst.filter((m) => contentTypeOf(m) === "movie");
    if (films.length > 0) rows.push({ key: "movies", title: "Movies", subtitle: countLabel(films.length, "movie"), list: films.slice(0, ROW_LIMIT), seeAll: { type: "movie" } });

    const longForm = recentFirst.filter(isLongForm);
    for (const info of INDUSTRIES) {
      const list = longForm.filter((m) => m.industry === info.value);
      if (list.length === 0) continue;
      rows.push({ key: "industry-" + info.value, title: info.label, subtitle: info.tagline + " · " + countLabel(list.length, "title"), list: list.slice(0, ROW_LIMIT), seeAll: { industry: info.value } });
    }
    const counts = new Map<string, number>();
    for (const movie of longForm) for (const category of movieCategories(movie)) counts.set(category, (counts.get(category) ?? 0) + 1);
    const categories = Array.from(counts.keys()).sort((a, b) => {
      if (a === NO_CATEGORY) return 1;
      if (b === NO_CATEGORY) return -1;
      return (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b);
    });
    for (const category of categories) {
      const list = longForm.filter((m) => movieCategories(m).includes(category));
      rows.push({ key: "category-" + category, title: category === NO_CATEGORY ? "Other titles" : category, subtitle: countLabel(list.length, "title"), list: list.slice(0, ROW_LIMIT), seeAll: { genre: category } });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentFirst, popularFirst]);

  const playing = playingSlug ? movies.find((m) => m.slug === playingSlug) ?? null : null;
  const related = useMemo(
    () => (playing ? recentFirst.filter((m) => m.id !== playing.id && m.industry === playing.industry && contentTypeOf(m) !== "reel").slice(0, 12) : []),
    [recentFirst, playing],
  );

  const filtersActive = hasActiveFilters(state);
  const showcase = !filtersActive;
  const scopeEmpty = (state.industry !== "" || state.type !== "") && scoped.length === 0;

  function change(patch: Partial<BrowseState>) {
    setState((prev) => ({ ...prev, ...patch }));
    setLimit(PAGE_SIZE);
  }

  function clearAll() {
    setState((prev) => clearFilters(prev));
    setLimit(PAGE_SIZE);
  }

  function openPlayer(movie: Movie) {
    if (contentTypeOf(movie) === "reel") {
      router.push("/reels?r=" + encodeURIComponent(movie.slug));
      return;
    }
    setPlayingSlug(movie.slug);
  }

  function openSeeAll(target: Partial<BrowseState> | "reels") {
    if (target === "reels") {
      router.push("/reels");
      return;
    }
    change({ sort: "recent", group: "none", ...target });
    window.setTimeout(() => browseRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function renderMovies(list: Movie[]) {
    return state.view === "list" ? <MovieList movies={list} onPlay={openPlayer} /> : <MovieGrid movies={list} onPlay={openPlayer} />;
  }

  const typeLabel = state.type ? TYPE_LABELS[state.type as keyof typeof TYPE_LABELS] : "";
  const heading = state.industry ? industryLabel(state.industry) + " " + (typeLabel ? typeLabel.toLowerCase() : "titles") : typeLabel || "Browse everything";

  return (
    <>
      {showcase && <Hero collections={heroCollections} onPlay={openPlayer} />}
      {showcase &&
        homeRows.map((row) => (
          <RowCarousel
            key={row.key}
            title={row.title}
            subtitle={row.subtitle}
            movies={row.list}
            variant={row.variant}
            onPlay={openPlayer}
            onSeeAll={() => openSeeAll(row.seeAll)}
          />
        ))}

      <section ref={browseRef} className="browse" aria-labelledby="browse-heading">
        <h2 id="browse-heading" className="browse-title">{heading}</h2>

        <div className="industry-tabs" role="group" aria-label="Section">
          <button type="button" aria-pressed={state.type === ""} onClick={() => change({ type: "" })}>
            Everything <span className="chip-count">{movies.length}</span>
          </button>
          {CONTENT_TYPES.map((type) => (
            <button key={type} type="button" aria-pressed={state.type === type} onClick={() => change({ type })}>
              {TYPE_LABELS[type]} <span className="chip-count">{typeCounts[type]}</span>
            </button>
          ))}
        </div>

        <div className="chips" role="group" aria-label="Film industry">
          <button type="button" className="chip" aria-pressed={state.industry === ""} onClick={() => change({ industry: "" })}>
            All industries
          </button>
          {industryCounts.map((f) => (
            <button key={f.value} type="button" className="chip" aria-pressed={state.industry === f.value} onClick={() => change({ industry: state.industry === f.value ? "" : f.value })}>
              {f.label} <span className="chip-count">{f.count}</span>
            </button>
          ))}
        </div>

        {facets.genres.length > 0 && (
          <div className="chips" role="group" aria-label="Categories">
            <button type="button" className="chip" aria-pressed={state.genre === ""} onClick={() => change({ genre: "" })}>
              All categories
            </button>
            {facets.genres.map((f) => (
              <button key={f.value} type="button" className="chip" aria-pressed={state.genre === f.value} onClick={() => change({ genre: state.genre === f.value ? "" : f.value })}>
                {f.label} <span className="chip-count">{f.count}</span>
              </button>
            ))}
          </div>
        )}

        <FilterPanel state={state} facets={facets} onChange={change} />
        <ActiveFilters state={state} onChange={change} onClear={clearAll} />

        <div className="toolbar">
          <p className="result-count" aria-live="polite">
            <strong>{results.length}</strong> {results.length === 1 ? "title" : "titles"}
            {filtersActive ? " found" : " in the catalog"}
          </p>
          <div className="toolbar-controls">
            <div className="segmented" role="group" aria-label="Browse by">
              <span className="segmented-label">Browse by</span>
              {GROUP_OPTIONS.map((o) => (
                <button key={o.value} type="button" aria-pressed={state.group === o.value} onClick={() => change({ group: o.value })}>
                  {o.label}
                </button>
              ))}
            </div>
            <label className="inline-field">
              Sort
              <select value={state.sort} onChange={(e) => change({ sort: e.target.value as SortKey })}>
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <div className="segmented" role="group" aria-label="Layout">
              <button type="button" aria-pressed={state.view === "grid"} onClick={() => change({ view: "grid" })}>Grid</button>
              <button type="button" aria-pressed={state.view === "list"} onClick={() => change({ view: "list" })}>List</button>
            </div>
          </div>
        </div>

        {results.length === 0 ? (
          <div className="empty-state">
            <p>{scopeEmpty ? "Nothing has been added here yet." : "Nothing matches. Try fewer words or remove a filter."}</p>
            {filtersActive && (
              <button type="button" className="btn" onClick={clearAll}>Clear all filters</button>
            )}
          </div>
        ) : state.group === "none" ? (
          <>
            {renderMovies(results.slice(0, limit))}
            {results.length > limit && (
              <div className="show-more">
                <button type="button" className="btn" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
                  {"Show more (" + (results.length - limit) + " remaining)"}
                </button>{" "}
                <button type="button" className="btn" onClick={() => setLimit(results.length)}>Show all</button>
              </div>
            )}
          </>
        ) : (
          <>
            <nav className="jump-nav" aria-label="Jump to section">
              <span className="muted">Jump to:</span>
              {groups.map((g) => (
                <a key={g.key} href={"#" + groupId(g.key)}>{g.label}</a>
              ))}
            </nav>
            {groups.map((g) => (
              <section key={g.key} id={groupId(g.key)} className="group-section" aria-labelledby={groupId(g.key) + "-title"}>
                <h3 id={groupId(g.key) + "-title"} className="group-title">
                  {g.label} <span className="group-count">{g.movies.length}</span>
                </h3>
                {renderMovies(g.movies)}
              </section>
            ))}
          </>
        )}
      </section>

      <PlayerModal movie={playing} related={related} onClose={() => setPlayingSlug(null)} onPlay={openPlayer} />
    </>
  );
}
`;

files["src/components/admin/MovieForm.tsx"] = String.raw`
"use client";

import { useActionState, useState, type ReactNode } from "react";
import { saveMovieAction } from "@/app/admin/actions";
import type { ActionState } from "@/types/admin";
import { INDUSTRIES } from "@/lib/industries";
import { looksLikeUrl, playbackFromLink } from "@/lib/admin/parse";

interface Props {
  initial: Record<string, string>;
  originalId: string;
  mode: "create" | "edit";
}

function readForm(form: HTMLFormElement): Record<string, string> {
  const out: Record<string, string> = {};
  new FormData(form).forEach((value, key) => {
    if (typeof value === "string") out[key] = value;
  });
  return out;
}

function previewFrom(values: Record<string, string>): { thumb: string | null; playback: string } {
  const raw = (values.playbackId || "").trim();
  let thumb: string | null = values.thumbnailUrl && values.thumbnailUrl.startsWith("https://") ? values.thumbnailUrl : null;
  let playback = "No video set yet";
  const detected = raw
    ? looksLikeUrl(raw)
      ? playbackFromLink(raw, true)
      : values.playbackType === "archive"
        ? { playbackType: "archive" as const, playbackId: raw }
        : { playbackType: "youtube" as const, playbackId: raw }
    : values.playbackUrl
      ? playbackFromLink(values.playbackUrl, true)
      : null;
  if (detected) {
    if (detected.playbackType === "youtube" && detected.playbackId) {
      thumb = thumb ?? "https://i.ytimg.com/vi/" + detected.playbackId + "/hqdefault.jpg";
      playback = "YouTube video " + detected.playbackId;
    } else if (detected.playbackType === "archive" && detected.playbackId) {
      thumb = thumb ?? "https://archive.org/services/img/" + detected.playbackId;
      playback = "Internet Archive item " + detected.playbackId;
    } else if (detected.playbackType === "direct_video") {
      playback = "Direct video file";
    } else if (detected.playbackUrl) {
      playback = "Embedded player: " + new URL(detected.playbackUrl).hostname;
    }
  }
  const versions = (values.languageVersions || "").split("\n").filter((l) => l.includes("|")).length;
  if (versions > 0) playback += " · +" + versions + " more language" + (versions === 1 ? "" : "s");
  return { thumb, playback };
}

function Field({ label, hint, wide, hidden, children }: { label: string; hint?: string; wide?: boolean; hidden?: boolean; children: ReactNode }) {
  return (
    <label className={"admin-field" + (wide ? " wide" : "")} hidden={hidden}>
      <span className="admin-label">{label}</span>
      {children}
      {hint && <span className="admin-hint">{hint}</span>}
    </label>
  );
}

export default function MovieForm({ initial, originalId, mode }: Props) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(saveMovieAction, { version: 0 });
  const values = state.values ?? initial;
  const [preview, setPreview] = useState(() => previewFrom(values));
  const [playbackType, setPlaybackType] = useState(values.playbackType || "youtube");
  const [contentType, setContentType] = useState(values.contentType || "movie");
  const v = (name: string) => values[name] ?? "";
  const usesFileUrl = playbackType === "direct_video" || playbackType === "embed";

  return (
    <form
      key={state.version ?? 0}
      action={formAction}
      className="admin-form
