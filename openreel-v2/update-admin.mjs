// update-admin.mjs — run inside openreel-v2:  node update-admin.mjs
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

if (!existsSync("src/lib/filter.ts") || !existsSync("src/types/playback.ts")) {
  console.error("Run this inside openreel-v2, after update-v3.mjs (src/types/playback.ts must exist).");
  process.exit(1);
}

const files = {};

files["src/types/admin.ts"] = String.raw`
import type { ContentType, Industry } from "@/types/movie";

/** A catalog entry as stored on disk (may be incomplete or invalid). */
export type RawRecord = Record<string, unknown>;

export type SourceKind = "youtube" | "archive";

export interface ImportSource {
  id: string;
  label: string;
  kind: SourceKind;
  industry: Industry;
  contentType: ContentType;
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

files["src/lib/validation.ts"] = String.raw`
import type { Movie } from "@/types/movie";
import { INDUSTRY_VALUES } from "@/lib/industries";
import { ARCHIVE_ID, YOUTUBE_ID, hasPlayableContent, isHttpsUrl } from "@/lib/media";

const RIGHTS_STATUSES = ["pending_review", "approved", "rejected"];
const PLAYBACK_TYPES = ["youtube", "archive", "direct_video"];
const RIGHTS_BASES = ["public_domain", "creative_commons", "written_permission", "license_agreement", "platform_embed"];
const CONTENT_TYPES = ["movie", "show"];
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
    fail('"playbackId" must be a string');
  } else if (typeof m.playbackId === "string" && m.playbackId !== "") {
    if (m.playbackType === "youtube" && !YOUTUBE_ID.test(m.playbackId)) fail("the YouTube video ID is not valid (it should be 11 characters)");
    if (m.playbackType === "archive" && !ARCHIVE_ID.test(m.playbackId)) fail("the Internet Archive identifier is not valid");
  }
  if (m.playbackUrl !== undefined && m.playbackUrl !== "" && !isHttpsUrl(m.playbackUrl)) fail('"playbackUrl" must be an https URL');
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

function validateEpisodes(value: unknown, fail: (msg: string) => void) {
  if (!Array.isArray(value)) {
    fail('"episodes" must be a list');
    return;
  }
  const ids = new Set<string>();
  value.forEach((raw, i) => {
    const where = "episode " + (i + 1);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      fail(where + " must be an object");
      return;
    }
    const e = raw as Record<string, unknown>;
    const efail = (msg: string) => fail(where + ": " + msg);
    if (!isNonEmptyString(e.id)) {
      efail('"id" is required');
    } else {
      if (ids.has(e.id)) efail("duplicate episode id");
      ids.add(e.id);
    }
    if (!isNonEmptyString(e.title)) efail('"title" is required');
    for (const field of ["season", "episode", "runtimeMinutes"]) {
      if (e[field] !== undefined && !isPositiveInt(e[field])) efail('"' + field + '" must be a positive whole number');
    }
    if (e.description !== undefined && typeof e.description !== "string") efail('"description" must be text');
    validatePlayback(e, efail);
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
  if (m.contentType !== undefined && !CONTENT_TYPES.includes(String(m.contentType))) fail('"contentType" must be movie or show');
  if (!RIGHTS_STATUSES.includes(String(m.rightsStatus))) fail('"rightsStatus" must be one of: ' + RIGHTS_STATUSES.join(", "));
  if (!RIGHTS_BASES.includes(String(m.rightsBasis))) fail('"rightsBasis" must be one of: ' + RIGHTS_BASES.join(", "));
  if (typeof m.commercialUseAllowed !== "boolean") fail('"commercialUseAllowed" must be true or false');
  if (m.featured !== undefined && typeof m.featured !== "boolean") fail('"featured" must be true or false');
  if (m.trending !== undefined && typeof m.trending !== "boolean") fail('"trending" must be true or false');
  if (m.popularity !== undefined && !(typeof m.popularity === "number" && Number.isFinite(m.popularity) && m.popularity >= 0)) {
    fail('"popularity" must be 0 or more');
  }
  if (m.releaseYear !== undefined && !(Number.isInteger(m.releaseYear) && (m.releaseYear as number) > 1870)) {
    fail("the release year is not valid");
  }
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
  if (m.episodes !== undefined) validateEpisodes(m.episodes, fail);

  if (m.rightsStatus === "approved") {
    if (!hasPlayableContent(m as unknown as Movie)) fail("a live title needs a working video (check the playback type and ID/link)");
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
    throw new Error(
      "Catalog validation failed:\n  - " + problems.map((p) => (p.id || "#" + p.index) + ": " + p.errors.join("; ")).join("\n  - "),
    );
  }
  return valid;
}
`;

files["src/lib/store.ts"] = String.raw`
import { readFileSync, statSync } from "node:fs";
import { copyFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Movie } from "@/types/movie";
import type { ImportSource, RawRecord } from "@/types/admin";
import { checkCatalog, type RecordProblem } from "@/lib/validation";

const DATA_DIR = path.join(process.cwd(), "src", "data");
export const CATALOG_PATH = process.env.CATALOG_PATH || path.join(DATA_DIR, "movies.json");
export const SOURCES_PATH = process.env.SOURCES_PATH || path.join(DATA_DIR, "sources.json");

export interface CatalogSnapshot {
  raw: RawRecord[];
  valid: Movie[];
  problems: RecordProblem[];
}

const EMPTY: CatalogSnapshot = { raw: [], valid: [], problems: [] };
let cache: { key: string; snapshot: CatalogSnapshot } | null = null;
let lastWarning = "";

function readJsonArray(file: string): RawRecord[] {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(file + " must contain a JSON array");
  return parsed.filter((r): r is RawRecord => typeof r === "object" && r !== null && !Array.isArray(r));
}

/** The current catalog. Re-read automatically whenever the file changes, so new titles appear without a restart. */
export function loadCatalog(): CatalogSnapshot {
  let key: string;
  try {
    const stat = statSync(CATALOG_PATH);
    key = stat.mtimeMs + ":" + stat.size;
  } catch {
    return EMPTY;
  }
  if (cache && cache.key === key) return cache.snapshot;
  try {
    const raw = readJsonArray(CATALOG_PATH);
    const { valid, problems } = checkCatalog(raw);
    const warning = problems.map((p) => (p.id || "#" + p.index) + ": " + p.errors.join("; ")).join(" | ");
    if (warning && warning !== lastWarning) {
      console.warn("[catalog] " + problems.length + " title(s) hidden from the site until fixed in /admin: " + warning);
    }
    lastWarning = warning;
    const snapshot: CatalogSnapshot = { raw, valid, problems };
    cache = { key, snapshot };
    return snapshot;
  } catch (error) {
    console.error("[catalog] Could not read " + CATALOG_PATH + " (keeping the last good copy):", error);
    return cache ? cache.snapshot : EMPTY;
  }
}

async function writeJsonAtomic(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp-" + process.pid + "-" + Date.now();
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  try {
    await copyFile(file, file + ".bak");
  } catch {
    // first write: nothing to back up
  }
  await rename(tmp, file);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}

let catalogQueue: Promise<unknown> = Promise.resolve();

/**
 * Safely changes the catalog: one change at a time, written atomically with a .bak backup.
 * If "change" throws, nothing is written.
 */
export function mutateCatalog<T>(change: (records: RawRecord[]) => T | Promise<T>): Promise<T> {
  const run = catalogQueue.then(async () => {
    let records: RawRecord[] = [];
    try {
      records = readJsonArray(CATALOG_PATH);
    } catch (error) {
      if (!isMissingFile(error)) throw new Error("The catalog file is unreadable, so nothing was changed: " + (error instanceof Error ? error.message : String(error)));
    }
    const result = await change(records);
    await writeJsonAtomic(CATALOG_PATH, records);
    cache = null;
    return result;
  });
  catalogQueue = run.catch(() => undefined);
  return run;
}

export function loadSources(): ImportSource[] {
  try {
    return readJsonArray(SOURCES_PATH) as unknown as ImportSource[];
  } catch {
    return [];
  }
}

let sourcesQueue: Promise<unknown> = Promise.resolve();

export function mutateSources<T>(change: (sources: ImportSource[]) => T | Promise<T>): Promise<T> {
  const run = sourcesQueue.then(async () => {
    const sources = loadSources();
    const result = await change(sources);
    await writeJsonAtomic(SOURCES_PATH, sources);
    return result;
  });
  sourcesQueue = run.catch(() => undefined);
  return run;
}
`;

files["src/lib/catalog.ts"] = String.raw`
import type { Movie } from "@/types/movie";
import { loadCatalog } from "@/lib/store";

const previewPending =
  process.env.NODE_ENV !== "production" && process.env.PREVIEW_PENDING === "true";

export function isPreviewMode(): boolean {
  return previewPending;
}

/** The single gate to the public site: only valid, approved titles (plus pending ones in local preview). */
export function getPublicMovies(): Movie[] {
  return loadCatalog()
    .valid.filter(
      (movie) =>
        movie.rightsStatus === "approved" ||
        (previewPending && movie.rightsStatus === "pending_review"),
    )
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function getMovieBySlug(slug: string): Movie | undefined {
  return getPublicMovies().find((movie) => movie.slug === slug);
}

export function getFeaturedMovies(limit = 6): Movie[] {
  return getPublicMovies().filter((movie) => movie.featured).slice(0, limit);
}

export function getRelatedMovies(movie: Movie, limit = 12): Movie[] {
  return getPublicMovies()
    .filter((other) => other.id !== movie.id)
    .map((other) => ({
      other,
      score: (other.industry === movie.industry ? 2 : 0) + other.genres.filter((g) => movie.genres.includes(g)).length,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.other);
}
`;

files["src/lib/admin/parse.ts"] = String.raw`
import { YOUTUBE_ID } from "@/lib/media";

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

files["src/lib/admin/form.ts"] = String.raw`
import type { RawRecord } from "@/types/admin";
import { INDUSTRIES, INDUSTRY_VALUES } from "@/lib/industries";
import { extractArchiveId, extractYouTubeId, slugify } from "@/lib/admin/parse";

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function defaultTerritories(): string[] {
  const list = (process.env.ADMIN_DEFAULT_TERRITORIES || "IN")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
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

/** Turns the admin form into a catalog record. Fields the form doesn't manage are kept from "base". */
export function buildRecordFromForm(form: FormData, base: RawRecord | null): { record: RawRecord; errors: string[] } {
  const errors: string[] = [];
  const record: RawRecord = base ? { ...base } : {};

  const title = text(form, "title");
  if (!title) errors.push("Title is required.");
  record.title = title;
  record.slug = slugify(text(form, "slug") || title) || "title-" + Date.now().toString(36);
  if (!base || typeof base.id !== "string" || !base.id) record.id = "custom-" + Date.now().toString(36);

  const industry = text(form, "industry");
  record.industry = INDUSTRY_VALUES.includes(industry) ? industry : "hollywood";
  setOrDelete(record, "contentType", text(form, "contentType") === "show" ? "show" : undefined);
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

  const playbackType = text(form, "playbackType");
  record.playbackType = ["youtube", "archive", "direct_video"].includes(playbackType) ? playbackType : "youtube";
  const rawId = text(form, "playbackId");
  const playbackId =
    record.playbackType === "youtube" ? extractYouTubeId(rawId) : record.playbackType === "archive" ? extractArchiveId(rawId) : "";
  setOrDelete(record, "playbackId", playbackId);
  setOrDelete(record, "playbackUrl", record.playbackType === "direct_video" ? text(form, "playbackUrl") : "");

  const sourceLines = text(form, "videoSources").split("\n").map((l) => l.trim()).filter(Boolean);
  const videoSources = sourceLines.map((line, i) => {
    const [label, url, height] = line.split("|").map((p) => p.trim());
    if (!label || !url) errors.push("Quality line " + (i + 1) + ' must look like "720p | https://… | 720".');
    const source: Record<string, unknown> = { label: label || "", url: url || "" };
    if (height) {
      if (/^\d+$/.test(height)) source.height = Number(height);
      else errors.push("Quality line " + (i + 1) + ": height must be a number such as 720.");
    }
    return source;
  });
  setOrDelete(record, "videoSources", record.playbackType === "direct_video" ? videoSources : []);

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
  if (!sourcePageUrl) {
    if (record.playbackType === "youtube" && playbackId) sourcePageUrl = "https://www.youtube.com/watch?v=" + playbackId;
    else if (record.playbackType === "archive" && playbackId) sourcePageUrl = "https://archive.org/details/" + playbackId;
    else sourcePageUrl = text(form, "playbackUrl") || (videoSources[0] ? String(videoSources[0].url) : "");
  }
  record.sourcePageUrl = sourcePageUrl;

  record.rightsBasis = text(form, "rightsBasis") || (record.playbackType === "youtube" ? "platform_embed" : "public_domain");
  setOrDelete(record, "licenseUrl", text(form, "licenseUrl"));
  setOrDelete(record, "rightsNotes", text(form, "rightsNotes"));
  record.attribution =
    text(form, "attribution") ||
    title + (record.playbackType === "youtube" ? " — official upload on YouTube" : record.playbackType === "archive" ? " via Internet Archive" : "");

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
  const out: Record<string, string> = {
    title: s(record.title),
    slug: s(record.slug),
    description: s(record.description),
    industry: s(record.industry) || "hollywood",
    contentType: record.contentType === "show" ? "show" : "movie",
    director: s(record.director),
    cast: join(record.cast),
    alternateTitles: join(record.alternateTitles, "\n"),
    release: s(record.releaseDate) || s(record.releaseYear),
    languages: join(record.languages),
    genres: join(record.genres),
    runtimeMinutes: s(record.runtimeMinutes),
    thumbnailUrl: s(record.thumbnailUrl),
    playbackType: s(record.playbackType) || "youtube",
    playbackId: s(record.playbackId),
    playbackUrl: s(record.playbackUrl),
    videoSources: Array.isArray(record.videoSources)
      ? record.videoSources
          .map((v) => {
            const o = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
            return [s(o.label), s(o.url), s(o.height)].filter(Boolean).join(" | ");
          })
          .join("\n")
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

/** Fetches new titles for one saved source and merges them. Trusted sources publish automatically. */
export async function syncSource(source: ImportSource): Promise<string> {
  let message: string;
  try {
    const existingIds = new Set(loadCatalog().raw.map((r) => String(r.id)));
    const candidates =
      source.kind === "archive"
        ? await fetchArchiveCandidates({ industry: source.industry, query: source.target, rows: source.maxPerSync ?? 30 })
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
      ? {
          reviewer: "auto (trusted source: " + source.label + ")",
          territories: source.territories.length > 0 ? source.territories : defaultTerritories(),
        }
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
  for (const source of loadSources()) {
    results.push(await syncSource(source));
  }
  return results;
}
`;

files["src/lib/admin/auth.ts"] = String.raw`
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const SESSION_COOKIE = "openreel_admin";
const SESSION_HOURS = 12;

export function adminConfigured(): boolean {
  const password = process.env.ADMIN_PASSWORD || "";
  return password.length >= 8;
}

function secret(): string {
  return process.env.ADMIN_SECRET || "openreel:" + (process.env.ADMIN_PASSWORD || "");
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

/** Constant-time comparison of two strings of any length. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function checkPassword(input: string): boolean {
  return adminConfigured() && safeEqual(input, process.env.ADMIN_PASSWORD || "");
}

function verifyToken(token: string | undefined): boolean {
  if (!token || !adminConfigured()) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  if (!safeEqual(sign(payload), signature)) return false;
  return Number(payload) > Date.now();
}

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  return verifyToken(store.get(SESSION_COOKIE)?.value);
}

/** Use at the top of every admin page and server action. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/login");
}

export async function startSession(): Promise<void> {
  const expires = String(Date.now() + SESSION_HOURS * 3600000);
  const store = await cookies();
  store.set(SESSION_COOKIE, expires + "." + sign(expires), {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.NEXT_PUBLIC_SITE_URL || "").startsWith("https://"),
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
`;

files["src/app/admin/actions.ts"] = String.raw`
"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { ActionState, ImportSource, RawRecord } from "@/types/admin";
import type { ContentType, Industry } from "@/types/movie";
import { INDUSTRY_VALUES } from "@/lib/industries";
import { validateRecord } from "@/lib/validation";
import { loadCatalog, loadSources, mutateCatalog, mutateSources } from "@/lib/store";
import { adminConfigured, checkPassword, endSession, requireAdmin, startSession } from "@/lib/admin/auth";
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

function typeOf(form: FormData): ContentType {
  return str(form, "contentType") === "show" ? "show" : "movie";
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
    return { ok: false, message: "Admin is disabled. Set ADMIN_PASSWORD (8+ characters) in .env.local and restart the server." };
  }
  const h = await headers();
  const ip = (h.get("x-forwarded-for") || h.get("x-real-ip") || "local").split(",")[0].trim();
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (entry && entry.until > now) return { ok: false, message: "Too many attempts. Please wait a few minutes and try again." };

  if (!checkPassword(str(form, "password"))) {
    const count = (entry ? entry.count : 0) + 1;
    loginAttempts.set(ip, { count, until: count >= 5 ? now + 10 * 60 * 1000 : 0 });
    return { ok: false, message: "Wrong password." };
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
      if (records.some((r, i) => i !== index && r.id === record.id)) {
        throw new FormErrors(['Another title already uses the id "' + String(record.id) + '".']);
      }
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

/** Handles every button in the dashboard table (single-row and bulk). */
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
  try {
    const candidates = await fetchSingleFromUrl(url, industryOf(form), typeOf(form));
    const result = await mutateCatalog((records) => mergeIntoCatalog(records, candidates));
    if (result.addedIds.length === 0) {
      return { ok: false, message: result.updated > 0 ? "That title is already in the catalog — its details were refreshed." : "That title is already in the catalog." };
    }
    newId = result.addedIds[0];
    if (result.addedIds.length > 1) {
      refreshSite();
      return { ok: true, message: describeMerge(result) + " Review them on the Titles page." };
    }
  } catch (error) {
    return { ok: false, message: errorText(error) };
  }
  refreshSite();
  redirect("/admin/movies/" + encodeURIComponent(newId) + "?added=1");
}

export async function importArchiveAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const candidates = await fetchArchiveCandidates({
      industry: industryOf(form),
      query: str(form, "query") || undefined,
      rows: intIn(form, "rows", 1, 200, 30),
      page: intIn(form, "page", 1, 1000, 1),
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
  try {
    const existingIds = new Set(loadCatalog().raw.map((r) => String(r.id)));
    const candidates = await fetchYouTubeCandidates(
      {
        key: requireYouTubeKey(),
        industry: industryOf(form),
        type: typeOf(form),
        target,
        minMinutes: intIn(form, "minMinutes", 1, 600, typeOf(form) === "show" ? 5 : 70),
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
      message:
        "Updated popularity for " + updated + " title(s)." +
        (process.env.YOUTUBE_API_KEY ? "" : " (YouTube titles skipped — add YOUTUBE_API_KEY to include them.)"),
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
  const contentType = kind === "archive" ? "movie" : typeOf(form);
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
  return { ok: true, message: "Saved \"" + source.label + "\". Use Sync now to fetch its titles." };
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

files["src/app/api/admin/sync/route.ts"] = String.raw`
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { safeEqual } from "@/lib/admin/auth";
import { syncAllSources } from "@/lib/admin/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** For scheduled syncing: call with  Authorization: Bearer <CRON_SECRET>  (or ?token=<CRON_SECRET>). */
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  if (secret.length < 16) {
    return NextResponse.json({ error: "Set CRON_SECRET (16+ characters) in .env.local to enable scheduled sync." }, { status: 503 });
  }
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : new URL(request.url).searchParams.get("token") || "";
  if (!safeEqual(token, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const results = await syncAllSources();
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true, syncedAt: new Date().toISOString(), results });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
`;

files["src/components/admin/ActionForm.tsx"] = String.raw`
"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionState } from "@/types/admin";

interface Props {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  pendingLabel?: string;
  children?: ReactNode;
}

export default function ActionForm({ action, submitLabel, pendingLabel, children }: Props) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  return (
    <form action={formAction} className="admin-form">
      {children}
      <div className="admin-form-footer">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? pendingLabel || "Working…" : submitLabel}
        </button>
        {pending && <span className="admin-note">This can take a little while for big imports…</span>}
      </div>
      {!pending && state.message && (
        <p className={"admin-msg " + (state.ok ? "ok" : "err")} role="status">{state.message}</p>
      )}
    </form>
  );
}
`;

files["src/components/admin/ConfirmButton.tsx"] = String.raw`
"use client";

import type { ReactNode } from "react";

interface Props {
  message: string;
  children: ReactNode;
  className?: string;
  name?: string;
  value?: string;
}

export default function ConfirmButton({ message, children, className, name, value }: Props) {
  return (
    <button
      type="submit"
      className={className}
      name={name}
      value={value}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
`;

files["src/components/admin/SelectAll.tsx"] = String.raw`
"use client";

export default function SelectAll() {
  return (
    <input
      type="checkbox"
      aria-label="Select all titles on this page"
      onChange={(event) => {
        const checked = event.currentTarget.checked;
        const form = event.currentTarget.form;
        if (!form) return;
        form.querySelectorAll<HTMLInputElement>('input[name="ids"]').forEach((box) => {
          box.checked = checked;
        });
      }}
    />
  );
}
`;

files["src/components/admin/LoginForm.tsx"] = String.raw`
"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/admin/actions";
import type { ActionState } from "@/types/admin";

export default function LoginForm() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(loginAction, {});
  return (
    <form action={formAction} className="admin-form admin-card">
      <h1>Admin login</h1>
      <label className="admin-field">
        <span className="admin-label">Password</span>
        <input type="password" name="password" autoComplete="current-password" required autoFocus />
      </label>
      <div className="admin-form-footer">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Checking…" : "Log in"}
        </button>
      </div>
      {state.message && <p className="admin-msg err" role="alert">{state.message}</p>}
    </form>
  );
}
`;

files["src/components/admin/MovieForm.tsx"] = String.raw`
"use client";

import { useActionState, useState, type ReactNode } from "react";
import { saveMovieAction } from "@/app/admin/actions";
import type { ActionState } from "@/types/admin";
import { INDUSTRIES } from "@/lib/industries";
import { extractArchiveId, extractYouTubeId } from "@/lib/admin/parse";
import { ARCHIVE_ID, YOUTUBE_ID } from "@/lib/media";

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
  const type = values.playbackType || "youtube";
  const raw = (values.playbackId || "").trim();
  let thumb: string | null = values.thumbnailUrl && values.thumbnailUrl.startsWith("https://") ? values.thumbnailUrl : null;
  let playback = "No video set yet";
  if (type === "youtube" && raw) {
    const id = extractYouTubeId(raw);
    if (YOUTUBE_ID.test(id)) {
      thumb = thumb ?? "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg";
      playback = "YouTube video " + id;
    } else {
      playback = "Not a valid YouTube link or ID yet";
    }
  } else if (type === "archive" && raw) {
    const id = extractArchiveId(raw);
    if (ARCHIVE_ID.test(id)) {
      thumb = thumb ?? "https://archive.org/services/img/" + id;
      playback = "Internet Archive item " + id;
    } else {
      playback = "Not a valid archive.org link or identifier yet";
    }
  } else if (type === "direct_video" && (values.playbackUrl || values.videoSources)) {
    playback = "Direct video file(s)";
  }
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

  return (
    <form
      key={state.version ?? 0}
      action={formAction}
      className="admin-form"
      onChange={(event) => {
        const data = readForm(event.currentTarget);
        setPreview(previewFrom(data));
        setPlaybackType(data.playbackType || "youtube");
        setContentType(data.contentType || "movie");
      }}
    >
      <input type="hidden" name="originalId" value={originalId} />

      {state.errors && state.errors.length > 0 && (
        <div className="admin-errors" role="alert">
          <strong>Please fix these and save again:</strong>
          <ul>
            {state.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      <fieldset>
        <legend>Basics</legend>
        <Field label="Title *">
          <input name="title" defaultValue={v("title")} required />
        </Field>
        <Field label="URL slug" hint="Leave empty to create it from the title.">
          <input name="slug" defaultValue={v("slug")} placeholder="e.g. my-film-1975" />
        </Field>
        <Field label="Industry">
          <select name="industry" defaultValue={v("industry")}>
            {INDUSTRIES.map((i) => (
              <option key={i.value} value={i.value}>{i.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Type">
          <select name="contentType" defaultValue={v("contentType") || "movie"}>
            <option value="movie">Movie</option>
            <option value="show">Show / series</option>
          </select>
        </Field>
        <Field label="Description" wide>
          <textarea name="description" defaultValue={v("description")} rows={4} />
        </Field>
        <Field label="Categories" hint="Comma separated, e.g. Comedy, Family">
          <input name="genres" defaultValue={v("genres")} />
        </Field>
        <Field label="Languages" hint="Comma separated. Empty = the industry's language.">
          <input name="languages" defaultValue={v("languages")} />
        </Field>
        <Field label="Director">
          <input name="director" defaultValue={v("director")} />
        </Field>
        <Field label="Cast" hint="Comma separated">
          <input name="cast" defaultValue={v("cast")} />
        </Field>
      </fieldset>

      <fieldset>
        <legend>Release</legend>
        <Field label="Release" hint="1975, 1975-08 or 1975-08-15 (month enables month-wise browsing)">
          <input name="release" defaultValue={v("release")} placeholder="1975-08" />
        </Field>
        <Field label="Runtime (minutes)">
          <input name="runtimeMinutes" inputMode="numeric" defaultValue={v("runtimeMinutes")} />
        </Field>
        <Field label="Popularity" hint="Filled by Refresh trending; you can also set it.">
          <input name="popularity" inputMode="numeric" defaultValue={v("popularity")} />
        </Field>
      </fieldset>

      <fieldset>
        <legend>Video</legend>
        <div className="admin-preview">
          <div className="admin-thumb admin-thumb-lg">
            {preview.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.thumb} alt="" referrerPolicy="no-referrer" />
            ) : null}
          </div>
          <p className="admin-note">{preview.playback}</p>
        </div>
        <Field label="Video source">
          <select name="playbackType" defaultValue={v("playbackType") || "youtube"}>
            <option value="youtube">YouTube (official upload)</option>
            <option value="archive">Internet Archive</option>
            <option value="direct_video">Direct video file(s)</option>
          </select>
        </Field>
        <Field
          label={playbackType === "archive" ? "archive.org link or identifier" : "YouTube link or video ID"}
          hint="Paste the full link — the ID is extracted automatically."
          hidden={playbackType === "direct_video"}
        >
          <input name="playbackId" defaultValue={v("playbackId")} placeholder={playbackType === "archive" ? "https://archive.org/details/…" : "https://www.youtube.com/watch?v=…"} />
        </Field>
        <Field label="Video file URL" hint="https link to an .mp4/.webm on an allowed host" hidden={playbackType !== "direct_video"}>
          <input name="playbackUrl" defaultValue={v("playbackUrl")} />
        </Field>
        <Field label="Quality versions (optional)" hint="One per line:  720p | https://…/film-720.mp4 | 720" wide hidden={playbackType !== "direct_video"}>
          <textarea name="videoSources" className="code" defaultValue={v("videoSources")} rows={4} />
        </Field>
        <Field label="Thumbnail URL" hint="Empty = automatic from YouTube / Internet Archive">
          <input name="thumbnailUrl" defaultValue={v("thumbnailUrl")} />
        </Field>
        <Field label="Source page URL" hint="Empty = created automatically">
          <input name="sourcePageUrl" defaultValue={v("sourcePageUrl")} />
        </Field>
        <Field
          label="Episodes (JSON)"
          hint='For shows. Easiest: import a playlist as a show. Format: [{"id":"e1","title":"Episode 1","season":1,"episode":1,"playbackType":"youtube","playbackId":"…"}]'
          wide
          hidden={contentType !== "show" && !v("episodes")}
        >
          <textarea name="episodes" className="code" defaultValue={v("episodes")} rows={6} />
        </Field>
        <Field label="Alternate titles" hint="One per line" wide>
          <textarea name="alternateTitles" defaultValue={v("alternateTitles")} rows={2} />
        </Field>
      </fieldset>

      <fieldset>
        <legend>Publishing &amp; rights</legend>
        <Field label="Status" hint="Only Live titles appear on the site.">
          <select name="rightsStatus" defaultValue={v("rightsStatus") || "pending_review"}>
            <option value="pending_review">Pending review (hidden)</option>
            <option value="approved">Live (approved)</option>
            <option value="rejected">Rejected (hidden)</option>
          </select>
        </Field>
        <Field label="Territories" hint="Countries you checked, e.g. IN, US. Empty = default when published.">
          <input name="territories" defaultValue={v("territories")} />
        </Field>
        <Field label="Rights basis">
          <select name="rightsBasis" defaultValue={v("rightsBasis") || "platform_embed"}>
            <option value="platform_embed">Official upload, embedded player</option>
            <option value="public_domain">Public domain</option>
            <option value="creative_commons">Creative Commons license</option>
            <option value="written_permission">Written permission</option>
            <option value="license_agreement">License agreement</option>
          </select>
        </Field>
        <Field label="License URL" hint="Required for Creative Commons">
          <input name="licenseUrl" defaultValue={v("licenseUrl")} />
        </Field>
        <Field label="Credit / attribution" hint="Empty = created automatically">
          <input name="attribution" defaultValue={v("attribution")} />
        </Field>
        <Field label="Reviewed by">
          <input name="rightsReviewer" defaultValue={v("rightsReviewer")} placeholder="admin" />
        </Field>
        <Field label="Review date">
          <input type="date" name="rightsReviewedAt" defaultValue={v("rightsReviewedAt")} />
        </Field>
        <Field label="Rights notes" wide>
          <textarea name="rightsNotes" defaultValue={v("rightsNotes")} rows={3} />
        </Field>
        <div className="admin-checks wide">
          <label className="admin-check">
            <input type="checkbox" name="featured" defaultChecked={v("featured") === "on"} /> ★ Featured in the home banner
          </label>
          <label className="admin-check">
            <input type="checkbox" name="trending" defaultChecked={v("trending") === "on"} /> 🔥 Pin to Trending
          </label>
          <label className="admin-check">
            <input type="checkbox" name="commercialUseAllowed" defaultChecked={v("commercialUseAllowed") === "on"} /> Commercial use allowed
          </label>
        </div>
      </fieldset>

      <div className="admin-form-footer sticky">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? "Create title" : "Save changes"}
        </button>
        <span className="admin-note">Saved changes appear on the site immediately.</span>
      </div>
    </form>
  );
}
`;

files["src/app/admin/admin.css"] = String.raw`
.admin { display: grid; gap: 1.5rem; }
.admin-nav { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem 1.25rem; padding: .75rem 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
.admin-nav strong { margin-right: auto; font-size: 1.05rem; }
.admin-nav a { color: var(--muted); text-decoration: none; font-weight: 600; }
.admin-nav a:hover { color: var(--text); }
.admin-nav form { margin: 0; }
.admin-page { display: grid; gap: 1.25rem; }
.admin-page-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 1rem; }
.admin-page-head h1 { margin: 0; font-size: 1.6rem; }
.admin-crumb { margin: 0 0 .2rem; color: var(--muted); font-size: .85rem; }
.admin-crumb a { color: var(--muted); }
.admin-head-actions { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
.admin-head-actions form { margin: 0; }

.admin-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: .75rem; }
.admin-stat { display: block; padding: .9rem 1rem; border-radius: var(--radius); background: var(--surface); border: 1px solid transparent; color: inherit; text-decoration: none; }
.admin-stat:hover, .admin-stat.is-active { border-color: var(--accent); }
.admin-stat b { display: block; font-size: 1.6rem; line-height: 1.2; }
.admin-stat span { color: var(--muted); font-size: .85rem; }

.admin-filters { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; padding: .75rem; border-radius: var(--radius); background: var(--surface); }
.admin-filters input, .admin-filters select,
.admin-field input, .admin-field select, .admin-field textarea { background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: .5rem .6rem; font-size: .95rem; width: 100%; }
.admin-filters input[type="search"] { flex: 1 1 240px; width: auto; }
.admin-filters select { width: auto; }

.admin-bulk { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; padding: .6rem .8rem; background: var(--surface-2); border-radius: var(--radius) var(--radius) 0 0; }
.admin-table-wrap { overflow-x: auto; background: var(--surface); border-radius: 0 0 var(--radius) var(--radius); }
.admin-table { width: 100%; border-collapse: collapse; font-size: .9rem; }
.admin-table th, .admin-table td { padding: .55rem .6rem; border-bottom: 1px solid var(--surface-2); text-align: left; vertical-align: middle; }
.admin-table thead th { color: var(--muted); font-weight: 600; white-space: nowrap; }
.admin-table tbody tr:hover { background: #1b1f29; }
.admin-thumb { width: 96px; aspect-ratio: 16 / 9; border-radius: 6px; overflow: hidden; background: var(--surface-2); flex-shrink: 0; }
.admin-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.admin-thumb-lg { width: 220px; }
.admin-title-cell a { color: var(--text); font-weight: 600; text-decoration: none; }
.admin-title-cell a:hover { text-decoration: underline; }
.admin-sub { display: block; color: var(--muted); font-size: .78rem; }
.status { display: inline-block; padding: .1rem .55rem; border-radius: 999px; font-size: .75rem; font-weight: 700; white-space: nowrap; }
.status-approved { background: rgba(60, 180, 110, .18); color: #7be3a6; }
.status-pending_review { background: rgba(255, 181, 71, .16); color: #ffcf85; }
.status-rejected { background: rgba(255, 90, 90, .16); color: #ff9a9a; }
.status-invalid { background: rgba(255, 90, 90, .28); color: #ffc2c2; }
.row-actions { display: flex; flex-wrap: wrap; gap: .3rem; }
.btn-xs { padding: .25rem .55rem; font-size: .78rem; border-radius: 6px; }
.btn-ok { border-color: rgba(60, 180, 110, .55); }
.btn-ok:hover { background: rgba(60, 180, 110, .2); }
.btn-danger { border-color: rgba(255, 90, 90, .5); color: #ffb3b3; }
.btn-danger:hover { background: rgba(255, 90, 90, .18); border-color: rgba(255, 90, 90, .8); }
.btn.is-on { background: rgba(255, 181, 71, .18); border-color: var(--accent); }
.admin-pager { display: flex; gap: .75rem; align-items: center; justify-content: center; margin-top: 1rem; }

.admin-msg { margin: 0; padding: .65rem .85rem; border-radius: 8px; white-space: pre-line; }
.admin-msg.ok { background: rgba(60, 180, 110, .15); color: #a6ecc2; }
.admin-msg.err { background: rgba(255, 90, 90, .15); color: #ffb3b3; }
.admin-msg.info { background: rgba(255, 181, 71, .12); color: #ffd9a0; }
.admin-errors { padding: .85rem 1rem; border-radius: var(--radius); background: rgba(255, 90, 90, .12); border: 1px solid rgba(255, 90, 90, .35); }
.admin-errors ul { margin: .4rem 0 0; padding-left: 1.2rem; }
.admin-errors li { margin-bottom: .25rem; }

.admin-card { background: var(--surface); border-radius: var(--radius); padding: 1.1rem 1.25rem; border: 1px solid var(--surface-2); }
.admin-card h2 { margin: 0 0 .3rem; font-size: 1.15rem; }
.admin-card > p { margin-top: 0; color: var(--muted); }
.admin-grid { display: grid; gap: 1rem; }
@media (min-width: 980px) { .admin-grid.two { grid-template-columns: 1fr 1fr; } }

.admin-form { display: grid; gap: .9rem; }
.admin-form fieldset { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: .85rem; margin: 0; padding: 1rem; border: 1px solid var(--surface-2); border-radius: var(--radius); background: var(--surface); }
.admin-form legend { padding: 0 .4rem; font-weight: 700; }
.admin-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: .75rem; }
.admin-field { display: flex; flex-direction: column; gap: .3rem; }
.admin-field[hidden] { display: none; }
.admin-field.wide, .admin-checks.wide, .admin-preview { grid-column: 1 / -1; }
.admin-label { font-size: .82rem; font-weight: 600; color: #d6dae3; }
.admin-hint, .admin-note { font-size: .78rem; color: var(--muted); }
.admin-field textarea { resize: vertical; font-family: inherit; }
.admin-field textarea.code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .82rem; }
.admin-checks { display: flex; flex-wrap: wrap; gap: .5rem 1.5rem; }
.admin-check { display: flex; align-items: center; gap: .5rem; font-size: .9rem; }
.admin-check input { width: auto; }
.admin-form-footer { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; }
.admin-form-footer.sticky { position: sticky; bottom: 0; z-index: 5; padding: .75rem; border-top: 1px solid var(--surface-2); background: rgba(11, 13, 18, .94); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.admin-preview { display: flex; align-items: center; gap: 1rem; }
.admin-login { max-width: 420px; margin: 3rem auto; display: grid; gap: 1rem; }
.admin-login h1 { margin: 0; font-size: 1.4rem; }
.admin-code { display: block; padding: .6rem .8rem; border-radius: 8px; background: var(--bg); border: 1px solid var(--surface-2); font-family: ui-monospace, monospace; font-size: .8rem; overflow-x: auto; white-space: pre; }
.admin-problems { margin: .4rem 0 0; padding-left: 1.2rem; }
.admin-problems li { margin-bottom: .35rem; }
.env-ok { color: #7be3a6; font-weight: 700; }
.env-missing { color: #ffb3b3; font-weight: 700; }
`;

files["src/app/admin/login/page.tsx"] = String.raw`
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { adminConfigured, isAdmin } from "@/lib/admin/auth";
import LoginForm from "@/components/admin/LoginForm";
import "../admin.css";

export const metadata: Metadata = { title: "Admin login", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  if (await isAdmin()) redirect("/admin");
  return (
    <div className="admin-login">
      {adminConfigured() ? (
        <LoginForm />
      ) : (
        <div className="admin-card">
          <h1>Set up the admin</h1>
          <p>Add these lines to <code>.env.local</code>, then restart the server:</p>
          <code className="admin-code">{"ADMIN_PASSWORD=choose-a-strong-password\nADMIN_SECRET=output-of-openssl-rand-hex-32"}</code>
        </div>
      )}
    </div>
  );
}
`;

files["src/app/admin/(protected)/layout.tsx"] = String.raw`
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin/auth";
import { logoutAction } from "@/app/admin/actions";
import "../admin.css";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return (
    <div className="admin">
      <nav className="admin-nav" aria-label="Admin">
        <strong>OpenReel admin</strong>
        <Link href="/admin">Titles</Link>
        <Link href="/admin/movies/new">Add title</Link>
        <Link href="/admin/import">Import &amp; sources</Link>
        <Link href="/" target="_blank">View site ↗</Link>
        <form action={logoutAction}>
          <button type="submit" className="link-button">Log out</button>
        </form>
      </nav>
      {children}
    </div>
  );
}
`;

files["src/app/admin/(protected)/page.tsx"] = String.raw`
import Link from "next/link";
import type { Movie } from "@/types/movie";
import { loadCatalog } from "@/lib/store";
import { rowAction } from "@/app/admin/actions";
import { INDUSTRIES, industryLabel } from "@/lib/industries";
import { thumbnailFor } from "@/lib/media";
import ConfirmButton from "@/components/admin/ConfirmButton";
import SelectAll from "@/components/admin/SelectAll";

type SearchParams = Record<string, string | string[] | undefined>;

const PAGE_SIZE = 50;
const STATUS_LABELS: Record<string, string> = {
  approved: "Live",
  pending_review: "Pending",
  rejected: "Rejected",
};

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const status = one(sp.status);
  const industry = one(sp.industry);
  const type = one(sp.type);
  const msg = one(sp.msg);
  const page = Math.max(1, Number(one(sp.page)) || 1);

  const { raw, problems } = loadCatalog();
  const invalidIds = new Set(problems.map((p) => p.id));
  const movies = raw.map((r) => r as unknown as Partial<Movie>);
  const countStatus = (s: string) => movies.filter((m) => m.rightsStatus === s).length;

  const needle = q.toLowerCase();
  const filtered = movies.filter((m) => {
    if (status === "invalid") {
      if (!invalidIds.has(String(m.id ?? ""))) return false;
    } else if (status && m.rightsStatus !== status) {
      return false;
    }
    if (industry && m.industry !== industry) return false;
    if (type && (m.contentType === "show" ? "show" : "movie") !== type) return false;
    if (needle) {
      const hay = [m.title, m.id, m.slug, m.director, m.playbackId, ...(m.genres ?? [])].join(" ").toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function href(overrides: Record<string, string>): string {
    const values: Record<string, string> = { q, status, industry, type, page: String(currentPage), ...overrides };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
      if (value && !(key === "page" && value === "1")) params.set(key, value);
    }
    const text = params.toString();
    return "/admin" + (text ? "?" + text : "");
  }
  const returnTo = href({});

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>Titles</h1>
          <p className="admin-crumb">Approve titles to publish them. Changes appear on the site immediately.</p>
        </div>
        <div className="admin-head-actions">
          <Link className="btn" href="/admin/import">Import</Link>
          <Link className="btn btn-primary" href="/admin/movies/new">+ Add title</Link>
        </div>
      </div>

      {msg && <p className="admin-msg info" role="status">{msg}</p>}

      <div className="admin-stats">
        <Link className={"admin-stat" + (status === "" ? " is-active" : "")} href={href({ status: "", page: "1" })}>
          <b>{movies.length}</b><span>All titles</span>
        </Link>
        <Link className={"admin-stat" + (status === "approved" ? " is-active" : "")} href={href({ status: "approved", page: "1" })}>
          <b>{countStatus("approved")}</b><span>Live on site</span>
        </Link>
        <Link className={"admin-stat" + (status === "pending_review" ? " is-active" : "")} href={href({ status: "pending_review", page: "1" })}>
          <b>{countStatus("pending_review")}</b><span>Pending review</span>
        </Link>
        <Link className={"admin-stat" + (status === "rejected" ? " is-active" : "")} href={href({ status: "rejected", page: "1" })}>
          <b>{countStatus("rejected")}</b><span>Rejected</span>
        </Link>
        <Link className={"admin-stat" + (status === "invalid" ? " is-active" : "")} href={href({ status: "invalid", page: "1" })}>
          <b>{problems.length}</b><span>Hidden (need fixing)</span>
        </Link>
      </div>

      {problems.length > 0 && (
        <div className="admin-errors">
          <strong>{problems.length} title(s) are hidden from the site because of errors:</strong>
          <ul className="admin-problems">
            {problems.slice(0, 8).map((p) => (
              <li key={p.index}>
                {p.id ? <Link href={"/admin/movies/" + encodeURIComponent(p.id)}>{p.title}</Link> : p.title} — {p.errors.join("; ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      <form className="admin-filters" action="/admin" method="get">
        <input type="search" name="q" defaultValue={q} placeholder="Search title, ID, director, category…" />
        <select name="status" defaultValue={status}>
          <option value="">Any status</option>
          <option value="approved">Live</option>
          <option value="pending_review">Pending</option>
          <option value="rejected">Rejected</option>
          <option value="invalid">Hidden (errors)</option>
        </select>
        <select name="industry" defaultValue={industry}>
          <option value="">All industries</option>
          {INDUSTRIES.map((i) => (
            <option key={i.value} value={i.value}>{i.label}</option>
          ))}
        </select>
        <select name="type" defaultValue={type}>
          <option value="">Movies &amp; shows</option>
          <option value="movie">Movies</option>
          <option value="show">Shows</option>
        </select>
        <button type="submit" className="btn">Filter</button>
        {(q || status || industry || type) && <Link href="/admin" className="link-button">Reset</Link>}
      </form>

      <form action={rowAction}>
        <input type="hidden" name="returnTo" value={returnTo} />
        <div className="admin-bulk">
          <span className="admin-note">{filtered.length} title(s). With ticked:</span>
          <button type="submit" className="btn btn-xs btn-ok" name="target" value="bulk-approve">Publish</button>
          <button type="submit" className="btn btn-xs" name="target" value="bulk-pending">Set pending</button>
          <button type="submit" className="btn btn-xs" name="target" value="bulk-reject">Reject</button>
          <ConfirmButton className="btn btn-xs btn-danger" name="target" value="bulk-delete" message="Delete all ticked titles permanently?">
            Delete
          </ConfirmButton>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th><SelectAll /></th>
                <th><span className="sr-only">Thumbnail</span></th>
                <th>Title</th>
                <th>Industry</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.length === 0 && (
                <tr>
                  <td colSpan={6} className="admin-note">No titles match. Try another filter, or import some titles.</td>
                </tr>
              )}
              {pageItems.map((m, index) => {
                const id = String(m.id ?? "");
                const title = String(m.title || "(untitled)");
                const invalid = invalidIds.has(id);
                const thumb = thumbnailFor(m as unknown as Movie);
                const year = m.releaseDate ? m.releaseDate.slice(0, 4) : m.releaseYear ? String(m.releaseYear) : "";
                return (
                  <tr key={id || "row-" + index}>
                    <td>{id && <input type="checkbox" name="ids" value={id} aria-label={"Select " + title} />}</td>
                    <td>
                      <div className="admin-thumb">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />
                        ) : null}
                      </div>
                    </td>
                    <td className="admin-title-cell">
                      {id ? <Link href={"/admin/movies/" + encodeURIComponent(id)}>{title}</Link> : title}
                      <span className="admin-sub">
                        {[m.contentType === "show" ? "Show · " + (m.episodes?.length ?? 0) + " episodes" : "Movie", year, (m.genres ?? []).join(", "), m.playbackType]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </td>
                    <td>{m.industry ? industryLabel(m.industry) : "—"}</td>
                    <td>
                      {invalid ? (
                        <span className="status status-invalid">Needs fixing</span>
                      ) : (
                        <span className={"status status-" + String(m.rightsStatus)}>{STATUS_LABELS[String(m.rightsStatus)] ?? String(m.rightsStatus)}</span>
                      )}
                    </td>
                    <td>
                      {id && (
                        <div className="row-actions">
                          {m.rightsStatus !== "approved" && (
                            <button type="submit" className="btn btn-xs btn-ok" name="target" value={"approve|" + id}>Publish</button>
                          )}
                          {m.rightsStatus !== "pending_review" && (
                            <button type="submit" className="btn btn-xs" name="target" value={"pending|" + id}>Pending</button>
                          )}
                          {m.rightsStatus !== "rejected" && (
                            <button type="submit" className="btn btn-xs" name="target" value={"reject|" + id}>Reject</button>
                          )}
                          <button type="submit" className={"btn btn-xs" + (m.featured ? " is-on" : "")} name="target" value={"feature|" + id} title="Featured in the home banner">★</button>
                          <button type="submit" className={"btn btn-xs" + (m.trending ? " is-on" : "")} name="target" value={"trending|" + id} title="Pin to Trending">🔥</button>
                          <Link className="btn btn-xs" href={"/admin/movies/" + encodeURIComponent(id)}>Edit</Link>
                          <ConfirmButton className="btn btn-xs btn-danger" name="target" value={"delete|" + id} message={"Delete \"" + title + "\" permanently?"}>
                            Delete
                          </ConfirmButton>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </form>

      {totalPages > 1 && (
        <nav className="admin-pager" aria-label="Pages">
          {currentPage > 1 && <Link className="btn btn-xs" href={href({ page: String(currentPage - 1) })}>← Previous</Link>}
          <span className="admin-note">Page {currentPage} of {totalPages}</span>
          {currentPage < totalPages && <Link className="btn btn-xs" href={href({ page: String(currentPage + 1) })}>Next →</Link>}
        </nav>
      )}
    </div>
  );
}
`;

files["src/app/admin/(protected)/movies/new/page.tsx"] = String.raw`
import Link from "next/link";
import MovieForm from "@/components/admin/MovieForm";
import { toFormValues } from "@/lib/admin/form";

export default function NewMoviePage() {
  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <p className="admin-crumb"><Link href="/admin">Titles</Link> / New</p>
          <h1>Add a title</h1>
        </div>
        <div className="admin-head-actions">
          <Link className="btn" href="/admin/import">Quick add from a link instead</Link>
        </div>
      </div>
      <MovieForm initial={toFormValues(null)} originalId="" mode="create" />
    </div>
  );
}
`;

files["src/app/admin/(protected)/movies/[id]/page.tsx"] = String.raw`
import Link from "next/link";
import { notFound } from "next/navigation";
import MovieForm from "@/components/admin/MovieForm";
import ConfirmButton from "@/components/admin/ConfirmButton";
import { deleteMovieAction } from "@/app/admin/actions";
import { loadCatalog } from "@/lib/store";
import { toFormValues } from "@/lib/admin/form";
import { validateRecord } from "@/lib/validation";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default async function EditMoviePage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const wanted = safeDecode(id);
  const record = loadCatalog().raw.find((r) => r.id === wanted || r.id === id);
  if (!record) notFound();

  const recordId = String(record.id);
  const title = String(record.title || "(untitled)");
  const slug = typeof record.slug === "string" ? record.slug : "";
  const problems = validateRecord(record);
  const isLive = record.rightsStatus === "approved" && problems.length === 0;

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <p className="admin-crumb"><Link href="/admin">Titles</Link> / Edit</p>
          <h1>{title}</h1>
        </div>
        <div className="admin-head-actions">
          {slug && (
            <Link className="btn" href={"/movies/" + slug} target="_blank">
              {isLive ? "View on site ↗" : "Preview ↗"}
            </Link>
          )}
          <form action={deleteMovieAction}>
            <input type="hidden" name="id" value={recordId} />
            <ConfirmButton className="btn btn-danger" message={"Delete \"" + title + "\" permanently?"}>Delete</ConfirmButton>
          </form>
        </div>
      </div>

      {sp.saved && <p className="admin-msg ok" role="status">Saved. {isLive ? "It's live on the site now." : "It's not public until its status is Live."}</p>}
      {sp.added && <p className="admin-msg info" role="status">Imported as Pending. Check the details and rights, then set Status to Live and save.</p>}
      {problems.length > 0 && (
        <div className="admin-errors">
          <strong>This title is hidden from the site until these are fixed:</strong>
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <MovieForm initial={toFormValues(record)} originalId={recordId} mode="edit" />
    </div>
  );
}
`;

files["src/app/admin/(protected)/import/page.tsx"] = String.raw`
import {
  importArchiveAction,
  importYouTubeAction,
  quickAddAction,
  refreshPopularityAction,
  saveSourceAction,
  sourceRowAction,
  syncAllAction,
} from "@/app/admin/actions";
import ActionForm from "@/components/admin/ActionForm";
import ConfirmButton from "@/components/admin/ConfirmButton";
import { loadSources } from "@/lib/store";
import { INDUSTRIES, industryLabel } from "@/lib/industries";
import { siteConfig } from "@/lib/config";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function IndustrySelect({ defaultValue = "bollywood" }: { defaultValue?: string }) {
  return (
    <label className="admin-field">
      <span className="admin-label">Industry</span>
      <select name="industry" defaultValue={defaultValue}>
        {INDUSTRIES.map((i) => (
          <option key={i.value} value={i.value}>{i.label}</option>
        ))}
      </select>
    </label>
  );
}

function TypeSelect() {
  return (
    <label className="admin-field">
      <span className="admin-label">Type</span>
      <select name="contentType" defaultValue="movie">
        <option value="movie">Movies</option>
        <option value="show">Show (playlist = one series)</option>
      </select>
    </label>
  );
}

export default async function ImportPage({ searchParams }: Props) {
  const sp = await searchParams;
  const msg = typeof sp.msg === "string" ? sp.msg : "";
  const sources = loadSources();
  const hasYouTubeKey = Boolean(process.env.YOUTUBE_API_KEY);
  const hasCronSecret = (process.env.CRON_SECRET || "").length >= 16;

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>Import &amp; sources</h1>
          <p className="admin-crumb">
            YouTube key: {hasYouTubeKey ? <span className="env-ok">set</span> : <span className="env-missing">missing</span>} · Scheduled sync:{" "}
            {hasCronSecret ? <span className="env-ok">enabled</span> : <span className="env-missing">set CRON_SECRET to enable</span>}
          </p>
        </div>
      </div>

      {msg && <p className="admin-msg info" role="status">{msg}</p>}

      <div className="admin-grid two">
        <section className="admin-card">
          <h2>Quick add from a link</h2>
          <p>Paste a YouTube video or playlist, an archive.org item, or a direct .mp4 link. It's added as Pending, then you review it.</p>
          <ActionForm action={quickAddAction} submitLabel="Add" pendingLabel="Fetching…">
            <label className="admin-field">
              <span className="admin-label">Link</span>
              <input name="url" required placeholder="https://www.youtube.com/watch?v=…" />
            </label>
            <div className="admin-row">
              <IndustrySelect />
              <TypeSelect />
            </div>
          </ActionForm>
        </section>

        <section className="admin-card">
          <h2>Refresh trending</h2>
          <p>Updates popularity from Internet Archive downloads{hasYouTubeKey ? " and YouTube views" : ""}. Trending rows and the hero use it.</p>
          <ActionForm action={refreshPopularityAction} submitLabel="Refresh now" pendingLabel="Refreshing…" />
        </section>

        <section className="admin-card">
          <h2>Import from YouTube</h2>
          <p>Only from the rights holder&apos;s official channel. Only public, embeddable, long videos are added.</p>
          {!hasYouTubeKey && <p className="admin-msg err">Add YOUTUBE_API_KEY to .env.local and restart to use this.</p>}
          <ActionForm action={importYouTubeAction} submitLabel="Import from YouTube" pendingLabel="Importing…">
            <label className="admin-field">
              <span className="admin-label">Channel or playlist</span>
              <input name="target" required placeholder="@OfficialChannel, channel link, or playlist link" />
            </label>
            <div className="admin-row">
              <IndustrySelect />
              <TypeSelect />
              <label className="admin-field">
                <span className="admin-label">Min. length (min)</span>
                <input name="minMinutes" inputMode="numeric" placeholder="70 (5 for shows)" />
              </label>
              <label className="admin-field">
                <span className="admin-label">Max new titles</span>
                <input name="max" inputMode="numeric" defaultValue="50" />
              </label>
            </div>
          </ActionForm>
        </section>

        <section className="admin-card">
          <h2>Import from the Internet Archive</h2>
          <p>Public-domain candidates, most popular first. No key needed.</p>
          <ActionForm action={importArchiveAction} submitLabel="Import from Archive" pendingLabel="Importing…">
            <div className="admin-row">
              <IndustrySelect defaultValue="hollywood" />
              <label className="admin-field">
                <span className="admin-label">How many</span>
                <input name="rows" inputMode="numeric" defaultValue="30" />
              </label>
              <label className="admin-field">
                <span className="admin-label">Page</span>
                <input name="page" inputMode="numeric" defaultValue="1" />
              </label>
            </div>
            <label className="admin-field">
              <span className="admin-label">Custom search (optional)</span>
              <input name="query" placeholder="e.g. collection:(feature_films) AND year:[1930 TO 1950]" />
            </label>
          </ActionForm>
        </section>
      </div>

      <section className="admin-card">
        <h2>Saved sources (automatic fetching)</h2>
        <p>
          Save channels, playlists or searches and fetch new titles with one click, or on a schedule. New titles stay Pending unless the source is
          <strong> Trusted</strong>; trusted sources publish automatically. Only trust channels you have confirmed belong to the official rights holder.
        </p>

        {sources.length > 0 ? (
          <form action={sourceRowAction}>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Industry</th>
                    <th>Auto-publish</th>
                    <th>Last sync</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <tr key={s.id}>
                      <td className="admin-title-cell">
                        <strong>{s.label}</strong>
                        <span className="admin-sub">
                          {(s.kind === "youtube" ? "YouTube" : "Internet Archive") + " · " + (s.contentType === "show" ? "show" : "movies") + " · " + s.target}
                        </span>
                      </td>
                      <td>{industryLabel(s.industry)}</td>
                      <td>{s.trusted ? <span className="status status-approved">Trusted</span> : <span className="status status-pending_review">Review first</span>}</td>
                      <td className="admin-sub">
                        {s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString("en-IN") : "Never"}
                        {s.lastResult ? " — " + s.lastResult : ""}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button type="submit" className="btn btn-xs btn-ok" name="target" value={"sync|" + s.id}>Sync now</button>
                          <button type="submit" className="btn btn-xs" name="target" value={"trust|" + s.id}>
                            {s.trusted ? "Stop auto-publish" : "Trust"}
                          </button>
                          <ConfirmButton className="btn btn-xs btn-danger" name="target" value={"delete|" + s.id} message={"Remove source \"" + s.label + "\"? Its titles stay."}>
                            Remove
                          </ConfirmButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </form>
        ) : (
          <p className="admin-note">No saved sources yet.</p>
        )}

        <div className="admin-grid two">
          <div>
            <h3>Add a source</h3>
            <ActionForm action={saveSourceAction} submitLabel="Save source">
              <div className="admin-row">
                <label className="admin-field">
                  <span className="admin-label">Name</span>
                  <input name="label" placeholder="e.g. Official Marathi films" />
                </label>
                <label className="admin-field">
                  <span className="admin-label">Kind</span>
                  <select name="kind" defaultValue="youtube">
                    <option value="youtube">YouTube channel / playlist</option>
                    <option value="archive">Internet Archive search</option>
                  </select>
                </label>
              </div>
              <label className="admin-field">
                <span className="admin-label">Channel / playlist / search query</span>
                <input name="target" required placeholder="@OfficialChannel  or  playlist link  or  Archive query" />
              </label>
              <div className="admin-row">
                <IndustrySelect />
                <TypeSelect />
                <label className="admin-field">
                  <span className="admin-label">Territories</span>
                  <input name="territories" placeholder="IN" />
                </label>
                <label className="admin-field">
                  <span className="admin-label">Max per sync</span>
                  <input name="maxPerSync" inputMode="numeric" defaultValue="30" />
                </label>
              </div>
              <label className="admin-check">
                <input type="checkbox" name="trusted" /> Trusted: publish new titles automatically (official rights holder only)
              </label>
            </ActionForm>
          </div>
          <div>
            <h3>Sync everything</h3>
            <ActionForm action={syncAllAction} submitLabel="Sync all sources now" pendingLabel="Syncing…" />
            <h3>Schedule it</h3>
            <p className="admin-note">
              With CRON_SECRET set, a scheduler can call this URL. Example (Linux crontab, every 6 hours):
            </p>
            <code className="admin-code">
              {"0 */6 * * * curl -fsS -H \"Authorization: Bearer YOUR_CRON_SECRET\" " + siteConfig.url + "/api/admin/sync > /dev/null"}
            </code>
          </div>
        </div>
      </section>
    </div>
  );
}
`;

files["src/app/movies/[slug]/page.tsx"] = String.raw`
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import VideoPlayer from "@/components/VideoPlayer";
import RightsNotice from "@/components/RightsNotice";
import RowCarousel from "@/components/RowCarousel";
import { getMovieBySlug, getRelatedMovies } from "@/lib/catalog";
import { MONTH_NAMES, getReleaseMonth, getReleaseYear } from "@/lib/dates";
import { formatRuntime, movieMetaLine } from "@/lib/format";
import { industryLabel } from "@/lib/industries";

// Always render from the live catalog so admin changes appear immediately.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const movie = getMovieBySlug(slug);
  if (!movie) return { title: "Not found" };
  return {
    title: movie.title,
    description: movie.description,
    alternates: { canonical: "/movies/" + movie.slug },
  };
}

export default async function MoviePage({ params }: Props) {
  const { slug } = await params;
  const movie = getMovieBySlug(slug);
  if (!movie) notFound();

  const year = getReleaseYear(movie);
  const month = getReleaseMonth(movie);
  const related = getRelatedMovies(movie, 12);

  return (
    <article className="detail">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <span aria-hidden="true"> / </span>
        <Link href={"/?industry=" + movie.industry}>{industryLabel(movie.industry)}</Link>
      </nav>

      {movie.rightsStatus !== "approved" && (
        <p className="preview-banner inline-banner" role="note">
          Pending rights review. This page is visible only in local preview.
        </p>
      )}

      <div className="detail-player">
        <VideoPlayer movie={movie} />
      </div>

      <div className="detail-layout">
        <div>
          <h1 className="detail-title">{movie.title}</h1>
          {movie.alternateTitles && movie.alternateTitles.length > 0 && (
            <p className="muted small">Also known as: {movie.alternateTitles.join(", ")}</p>
          )}
          <p className="detail-meta">
            <span className="badge static badge-industry">{industryLabel(movie.industry)}</span> {movieMetaLine(movie)}
          </p>
          <p className="detail-desc">{movie.description}</p>

          <dl className="facts">
            {movie.director && (
              <>
                <dt>Director</dt>
                <dd><Link href={"/?q=" + encodeURIComponent(movie.director)}>{movie.director}</Link></dd>
              </>
            )}
            {movie.cast && movie.cast.length > 0 && (
              <>
                <dt>Cast</dt>
                <dd>
                  {movie.cast.map((person, i) => (
                    <span key={person}>
                      {i > 0 && ", "}
                      <Link href={"/?q=" + encodeURIComponent(person)}>{person}</Link>
                    </span>
                  ))}
                </dd>
              </>
            )}
            <dt>Released</dt>
            <dd>
              {year === undefined ? (
                "Unknown"
              ) : (
                <>
                  {month !== undefined && (
                    <>
                      <Link href={"/?year=" + year + "&month=" + month}>{MONTH_NAMES[month - 1]}</Link>{" "}
                    </>
                  )}
                  <Link href={"/?year=" + year}>{year}</Link>
                </>
              )}
            </dd>
            {movie.runtimeMinutes !== undefined && (
              <>
                <dt>Runtime</dt>
                <dd>{formatRuntime(movie.runtimeMinutes)}</dd>
              </>
            )}
            <dt>Industry</dt>
            <dd><Link href={"/?industry=" + movie.industry}>{industryLabel(movie.industry)}</Link></dd>
            {movie.genres.length > 0 && (
              <>
                <dt>Categories</dt>
                <dd>
                  <ul className="tags">
                    {movie.genres.map((genre) => (
                      <li key={genre}>
                        <Link className="tag" href={"/?category=" + encodeURIComponent(genre)}>{genre}</Link>
                      </li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
            <dt>Language</dt>
            <dd>
              <ul className="tags">
                {movie.languages.map((language) => (
                  <li key={language}>
                    <Link className="tag" href={"/?lang=" + encodeURIComponent(language)}>{language}</Link>
                  </li>
                ))}
              </ul>
            </dd>
          </dl>
        </div>
        <aside>
          <RightsNotice movie={movie} />
        </aside>
      </div>

      {related.length > 0 && (
        <div className="section">
          <RowCarousel title="More like this" movies={related} />
        </div>
      )}
    </article>
  );
}
`;

// ---- write files ----
for (const [path, content] of Object.entries(files)) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content.replace(/^\r?\n/, ""), "utf8");
  console.log("Wrote " + path);
}

if (!existsSync("src/data/sources.json")) {
  writeFileSync("src/data/sources.json", "[]\n", "utf8");
  console.log("Created src/data/sources.json");
}

console.log("\nDone.");
console.log("1. Make sure .env.local has ADMIN_PASSWORD and ADMIN_SECRET (see instructions).");
console.log("2. Restart:  npm run dev");
console.log("3. Open http://localhost:3000/admin");
