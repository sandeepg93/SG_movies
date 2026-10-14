// update-v3.mjs — run inside openreel-v2:  node update-v3.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

if (!existsSync("src/lib/filter.ts") || !existsSync("scripts")) {
  console.error("Run this inside the openreel-v2 folder (the one that contains src/ and scripts/).");
  process.exit(1);
}

const files = {};

files["src/types/movie.ts"] = String.raw`
export type RightsStatus = "pending_review" | "approved" | "rejected";
export type PlaybackType = "youtube" | "archive" | "direct_video";
export type Industry = "hollywood" | "bollywood" | "marathi" | "tollywood";
export type ContentType = "movie" | "show";
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
  /** Direct video file URL (direct_video only). */
  playbackUrl?: string;
  /** direct_video only: the same video in several qualities. */
  videoSources?: VideoSourceInput[];
  thumbnailUrl?: string | null;
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
  /** "movie" (default) or "show" (uses episodes). */
  contentType?: ContentType;
  episodes?: Episode[];
  releaseYear?: number;
  /** "YYYY-MM" or "YYYY-MM-DD"; enables month-wise browsing. */
  releaseDate?: string;
  languages: string[];
  genres: string[];
  runtimeMinutes?: number;
  sourcePageUrl: string;
  /** Views / downloads, filled by scripts/refresh-popularity.mjs. Drives "Trending". */
  popularity?: number;
  /** Pin to the top of Trending. */
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

files["src/types/playback.ts"] = String.raw`
export interface VideoSource {
  label: string;
  url: string;
  height?: number;
  /** Approximate bitrate in kbps. */
  bitrate?: number;
  type?: string;
}

export interface CaptionTrack {
  label: string;
  lang: string;
  src: string;
}

export interface SourcesResponse {
  sources: VideoSource[];
  captions: CaptionTrack[];
}
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

export function isAllowedDirectUrl(value: string): boolean {
  if (!isHttpsUrl(value)) return false;
  const host = new URL(value).hostname;
  return siteConfig.allowedVideoHosts.some((allowed) => host === allowed || host.endsWith("." + allowed));
}

export function isPlayable(source: PlaybackFields): boolean {
  if (source.playbackType === "youtube") return typeof source.playbackId === "string" && YOUTUBE_ID.test(source.playbackId);
  if (source.playbackType === "archive") return typeof source.playbackId === "string" && ARCHIVE_ID.test(source.playbackId);
  if (source.playbackType === "direct_video") {
    if (Array.isArray(source.videoSources) && source.videoSources.length > 0) {
      return source.videoSources.every((s) => typeof s.url === "string" && isAllowedDirectUrl(s.url));
    }
    return typeof source.playbackUrl === "string" && isAllowedDirectUrl(source.playbackUrl);
  }
  return false;
}

/** A film is playable itself; a show is playable if at least one episode is. */
export function hasPlayableContent(movie: Movie): boolean {
  if (isPlayable(movie)) return true;
  return (movie.episodes ?? []).some((episode) => isPlayable(episode));
}

export function embedUrlFor(source: PlaybackFields, autoplay: boolean): string | null {
  if (!isPlayable(source) || !source.playbackId) return null;
  if (source.playbackType === "youtube") {
    const params = new URLSearchParams({ rel: "0", playsinline: "1", autoplay: autoplay ? "1" : "0" });
    return "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(source.playbackId) + "?" + params.toString();
  }
  if (source.playbackType === "archive") {
    return "https://archive.org/embed/" + encodeURIComponent(source.playbackId) + (autoplay ? "?autoplay=1" : "");
  }
  return null;
}

export function thumbnailFor(source: PlaybackFields): string | null {
  if (source.thumbnailUrl && isHttpsUrl(source.thumbnailUrl)) return source.thumbnailUrl;
  if (source.playbackType === "youtube" && source.playbackId && YOUTUBE_ID.test(source.playbackId)) {
    return "https://i.ytimg.com/vi/" + source.playbackId + "/hqdefault.jpg";
  }
  if (source.playbackType === "archive" && source.playbackId && ARCHIVE_ID.test(source.playbackId)) {
    return "https://archive.org/services/img/" + encodeURIComponent(source.playbackId);
  }
  return null;
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
    if (m.playbackType === "youtube" && !YOUTUBE_ID.test(m.playbackId)) fail('"playbackId" is not a valid YouTube video ID (11 characters)');
    if (m.playbackType === "archive" && !ARCHIVE_ID.test(m.playbackId)) fail('"playbackId" is not a valid Internet Archive identifier');
  }
  if (m.playbackUrl !== undefined && m.playbackUrl !== "" && !isHttpsUrl(m.playbackUrl)) fail('"playbackUrl" must be an https URL');
  if (m.thumbnailUrl !== undefined && m.thumbnailUrl !== null && !isHttpsUrl(m.thumbnailUrl)) fail('"thumbnailUrl" must be an https URL or null');
  if (m.videoSources !== undefined) {
    if (!Array.isArray(m.videoSources)) {
      fail('"videoSources" must be an array');
    } else {
      m.videoSources.forEach((raw, i) => {
        const where = "videoSources[" + i + "]";
        if (typeof raw !== "object" || raw === null) {
          fail(where + " must be an object");
          return;
        }
        const s = raw as Record<string, unknown>;
        if (!isNonEmptyString(s.label)) fail(where + ': "label" is required (e.g. "720p")');
        if (!isHttpsUrl(s.url)) fail(where + ': "url" must be an https URL');
        if (s.height !== undefined && !isPositiveInt(s.height)) fail(where + ': "height" must be a positive whole number');
      });
    }
  }
}

function validateEpisodes(value: unknown, fail: (msg: string) => void) {
  if (!Array.isArray(value)) {
    fail('"episodes" must be an array');
    return;
  }
  const ids = new Set<string>();
  value.forEach((raw, i) => {
    const where = "episodes[" + i + "]";
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
    if (e.description !== undefined && typeof e.description !== "string") efail('"description" must be a string');
    validatePlayback(e, efail);
  });
}

/** Validates the whole catalog. Throws (failing the build) on any problem. */
export function validateCatalog(input: unknown): Movie[] {
  if (!Array.isArray(input)) {
    throw new Error("Catalog validation failed: movies.json must contain a JSON array.");
  }

  const errors: string[] = [];
  const ids = new Set<string>();
  const slugs = new Set<string>();

  input.forEach((raw, index) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      errors.push("record #" + index + ": must be an object");
      return;
    }
    const m = raw as Record<string, unknown>;
    const label = isNonEmptyString(m.id) ? '"' + m.id + '"' : "record #" + index;
    const fail = (msg: string) => errors.push(label + ": " + msg);

    for (const field of ["id", "slug", "title", "description", "attribution"]) {
      if (!isNonEmptyString(m[field])) fail('"' + field + '" is required');
    }
    for (const field of ["languages", "genres", "territories"]) {
      if (!isStringArray(m[field])) fail('"' + field + '" must be an array of non-empty strings');
    }
    if (m.alternateTitles !== undefined && !isStringArray(m.alternateTitles)) fail('"alternateTitles" must be an array of strings');
    if (m.cast !== undefined && !isStringArray(m.cast)) fail('"cast" must be an array of strings');
    if (m.director !== undefined && !isNonEmptyString(m.director)) fail('"director" must be a non-empty string');
    if (m.rightsNotes !== undefined && typeof m.rightsNotes !== "string") fail('"rightsNotes" must be a string');
    if (isNonEmptyString(m.slug) && !SLUG_PATTERN.test(m.slug)) fail('"slug" must be lowercase letters, numbers and hyphens');
    if (!INDUSTRY_VALUES.includes(String(m.industry))) fail('"industry" must be one of: ' + INDUSTRY_VALUES.join(", "));
    if (m.contentType !== undefined && !CONTENT_TYPES.includes(String(m.contentType))) fail('"contentType" must be "movie" or "show"');
    if (!RIGHTS_STATUSES.includes(String(m.rightsStatus))) fail('"rightsStatus" must be one of: ' + RIGHTS_STATUSES.join(", "));
    if (!RIGHTS_BASES.includes(String(m.rightsBasis))) fail('"rightsBasis" must be one of: ' + RIGHTS_BASES.join(", "));
    if (typeof m.commercialUseAllowed !== "boolean") fail('"commercialUseAllowed" must be true or false');
    if (m.featured !== undefined && typeof m.featured !== "boolean") fail('"featured" must be true or false');
    if (m.trending !== undefined && typeof m.trending !== "boolean") fail('"trending" must be true or false');
    if (m.popularity !== undefined && !(typeof m.popularity === "number" && Number.isFinite(m.popularity) && m.popularity >= 0)) {
      fail('"popularity" must be a number of 0 or more');
    }

    if (m.releaseYear !== undefined && !(Number.isInteger(m.releaseYear) && (m.releaseYear as number) > 1870)) {
      fail('"releaseYear" must be a year (omit the field if unknown)');
    }
    if (m.releaseDate !== undefined) {
      if (!isNonEmptyString(m.releaseDate) || !RELEASE_DATE_PATTERN.test(m.releaseDate)) {
        fail('"releaseDate" must look like YYYY-MM or YYYY-MM-DD');
      } else if (typeof m.releaseYear === "number" && Number(m.releaseDate.slice(0, 4)) !== m.releaseYear) {
        fail('"releaseYear" and "releaseDate" disagree');
      }
    }
    if (m.runtimeMinutes !== undefined && !isPositiveInt(m.runtimeMinutes)) {
      fail('"runtimeMinutes" must be a positive whole number (omit if unknown)');
    }

    if (!isHttpsUrl(m.sourcePageUrl)) fail('"sourcePageUrl" must be an https URL');
    if (m.licenseUrl !== undefined && m.licenseUrl !== null && !isHttpsUrl(m.licenseUrl)) fail('"licenseUrl" must be an https URL or null');
    validatePlayback(m, fail);
    if (m.episodes !== undefined) validateEpisodes(m.episodes, fail);

    // Stricter rules for anything that becomes public.
    if (m.rightsStatus === "approved") {
      if (!hasPlayableContent(m as unknown as Movie)) {
        fail("approved title has no valid playback (check playbackType, playbackId / playbackUrl / videoSources, episodes and allowedVideoHosts)");
      }
      if (!isNonEmptyString(m.rightsReviewedAt) || !DAY_PATTERN.test(m.rightsReviewedAt)) {
        fail('approved title needs "rightsReviewedAt" as YYYY-MM-DD');
      }
      if (!isNonEmptyString(m.rightsReviewer)) fail('approved title needs "rightsReviewer"');
      if (isStringArray(m.territories) && m.territories.length === 0) fail('approved title needs at least one territory, e.g. ["IN"]');
      if (m.rightsBasis === "creative_commons" && !isHttpsUrl(m.licenseUrl)) fail('Creative Commons title needs "licenseUrl"');
    }

    if (isNonEmptyString(m.id)) {
      if (ids.has(m.id)) fail("duplicate id");
      ids.add(m.id);
    }
    if (isNonEmptyString(m.slug)) {
      if (slugs.has(m.slug)) fail('duplicate slug "' + m.slug + '"');
      slugs.add(m.slug);
    }
  });

  if (errors.length > 0) {
    throw new Error("Catalog validation failed:\n  - " + errors.join("\n  - "));
  }
  return input as Movie[];
}
`;

files["src/lib/filter.ts"] = String.raw`
import type { Movie } from "@/types/movie";
import { MONTH_NAMES, getReleaseMonth, getReleaseYear } from "@/lib/dates";
import { INDUSTRIES, INDUSTRY_VALUES, industryLabel } from "@/lib/industries";

export type SortKey = "newest" | "popular" | "oldest" | "title" | "shortest" | "longest";
export type GroupKey = "none" | "industry" | "category" | "decade" | "year" | "month";
export type ViewKey = "grid" | "list";

/** Category used for titles that have no genres yet. */
export const NO_CATEGORY = "Other";

const SORT_KEYS: readonly SortKey[] = ["newest", "popular", "oldest", "title", "shortest", "longest"];
const GROUP_KEYS: readonly GroupKey[] = ["none", "industry", "category", "decade", "year", "month"];
const VIEW_KEYS: readonly ViewKey[] = ["grid", "list"];
const DEFAULT_SORT: SortKey = "newest";

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "newest", label: "Latest first" },
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

export function contentTypeOf(movie: Movie): "movie" | "show" {
  return movie.contentType === "show" ? "show" : "movie";
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

/** Higher = more "trending": pinned titles, then popularity (log scale), with a boost for recent releases. */
export function trendingScore(movie: Movie): number {
  const year = getReleaseYear(movie);
  const thisYear = new Date().getFullYear();
  let score = Math.log10(1 + Math.max(0, movie.popularity ?? 0));
  if (movie.trending) score += 100;
  if (year !== undefined && year >= thisYear - 3) score += 1;
  return score;
}

export function filterMovies(movies: Movie[], state: BrowseState): Movie[] {
  const query = state.query.trim().toLowerCase();
  const terms = query ? query.split(/\s+/) : [];

  return movies.filter((movie) => {
    const year = getReleaseYear(movie);
    const month = getReleaseMonth(movie);

    if (terms.length > 0) {
      const haystack = [
        movie.title,
        ...(movie.alternateTitles ?? []),
        movie.description,
        movie.director ?? "",
        ...(movie.cast ?? []),
        ...(movie.episodes ?? []).map((e) => e.title),
        industryLabel(movie.industry),
        contentTypeOf(movie) === "show" ? "show series" : "movie film",
        ...movieCategories(movie),
        ...movie.languages,
        year !== undefined ? String(year) : "",
        month !== undefined ? MONTH_NAMES[month - 1] : "",
      ]
        .join(" ")
        .toLowerCase();
      if (!terms.every((term) => haystack.includes(term))) return false;
    }
    if (state.type && contentTypeOf(movie) !== state.type) return false;
    if (state.industry && movie.industry !== state.industry) return false;
    if (state.genre && !movieCategories(movie).includes(state.genre)) return false;
    if (state.language && !movie.languages.includes(state.language)) return false;
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
    if (sort === "popular") {
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

function toFacets(
  map: Map<string, number>,
  compare: (a: string, b: string) => number,
  label: (value: string) => string,
): Facet[] {
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
    movie.languages.forEach((l) => increment(languages, l));
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
    type: type === "movie" || type === "show" ? type : "",
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

/** Returns the film itself, or one of its episodes when ?episode=N is given. */
export function pickPlaybackItem(movie: Movie, episode: string | null): PlaybackFields | null {
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

/** File list of an Internet Archive item (cached for a day). */
export async function getArchiveFiles(identifier: string): Promise<ArchiveFile[]> {
  try {
    const res = await fetch("https://archive.org/metadata/" + encodeURIComponent(identifier), {
      next: { revalidate: 86400 },
    });
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
  if (value.includes(":")) {
    return value.split(":").reduce((total, part) => total * 60 + (Number(part) || 0), 0);
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function estimateHeight(bitrateKbps: number): number {
  if (bitrateKbps >= 4000) return 1080;
  if (bitrateKbps >= 2000) return 720;
  if (bitrateKbps >= 900) return 480;
  return 360;
}

/** Every browser-playable quality version of an Archive item, best first. */
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
      const type = /\.webm$/i.test(f.name) ? "video/webm" : "video/mp4";
      const source: VideoSource = { label, url: archiveDownloadUrl(identifier, f.name), type };
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

export function archiveCaptionTracks(files: ArchiveFile[], slug: string, episode: string | null): CaptionTrack[] {
  return files
    .filter((f): f is ArchiveFile & { name: string } => typeof f.name === "string" && /\.(srt|vtt)$/i.test(f.name))
    .slice(0, 8)
    .map((f, i) => {
      const hint = LANGUAGE_HINTS.find(([pattern]) => pattern.test(f.name));
      const params = new URLSearchParams({ file: f.name });
      if (episode !== null && episode !== "") params.set("episode", episode);
      return {
        label: hint ? hint[2] : "Subtitles " + (i + 1),
        lang: hint ? hint[1] : "und",
        src: "/api/subtitles/" + encodeURIComponent(slug) + "?" + params.toString(),
      };
    });
}

/** Converts SRT to WebVTT (WebVTT input is returned unchanged). */
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
  const episode = new URL(request.url).searchParams.get("episode");
  const movie = getMovieBySlug(slug);
  const item = movie ? pickPlaybackItem(movie, episode) : null;
  if (!movie || !item || !isPlayable(item)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: SourcesResponse = { sources: [], captions: [] };

  if (item.playbackType === "archive" && item.playbackId) {
    const files = await getArchiveFiles(item.playbackId);
    body = {
      sources: archiveVideoSources(item.playbackId, files),
      captions: archiveCaptionTracks(files, slug, episode),
    };
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

  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, max-age=600, s-maxage=3600" },
  });
}
`;

files["src/app/api/subtitles/[slug]/route.ts"] = String.raw`
import { getMovieBySlug } from "@/lib/catalog";
import { pickPlaybackItem } from "@/lib/playback-item";
import { archiveDownloadUrl, getArchiveFiles, toWebVtt } from "@/lib/archive";

type Context = { params: Promise<{ slug: string }> };

const MAX_BYTES = 3000000;

export async function GET(request: Request, context: Context) {
  const { slug } = await context.params;
  const url = new URL(request.url);
  const file = url.searchParams.get("file") ?? "";
  const episode = url.searchParams.get("episode");
  const movie = getMovieBySlug(slug);
  const item = movie ? pickPlaybackItem(movie, episode) : null;

  if (!movie || !item || item.playbackType !== "archive" || !item.playbackId || !/\.(srt|vtt)$/i.test(file)) {
    return new Response("Not found", { status: 404 });
  }

  // Only serve subtitle files that really belong to this item.
  const files = await getArchiveFiles(item.playbackId);
  if (!files.some((f) => f.name === file)) return new Response("Not found", { status: 404 });

  const res = await fetch(archiveDownloadUrl(item.playbackId, file), { next: { revalidate: 86400 } });
  if (!res.ok) return new Response("Subtitles unavailable", { status: 502 });
  const text = await res.text();
  if (text.length > MAX_BYTES) return new Response("Subtitles too large", { status: 413 });

  return new Response(toWebVtt(text), {
    headers: {
      "Content-Type": "text/vtt; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
`;

files["src/components/Icons.tsx"] = String.raw`
const PATHS = {
  play: "M8 5v14l11-7z",
  pause: "M6 5h4v14H6zm8 0h4v14h-4z",
  rewind: "M11 18V6l-8.5 6 8.5 6zm.5-6 8.5 6V6l-8.5 6z",
  forward: "M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z",
  volume: "M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23z",
  mute: "M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12a9 9 0 0 0-7-8.77v2.06A7 7 0 0 1 19 12zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a9 9 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z",
  fullscreen: "M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z",
  fullscreenExit: "M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z",
  pip: "M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z",
  close: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  chevronLeft: "M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z",
  chevronRight: "M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z",
  info: "M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z",
  settings: "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z",
  check: "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  captions: "M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1z",
  fire: "M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z",
} as const;

export type IconName = keyof typeof PATHS;

export default function Icon({ name, size = 24, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" className={className}>
      <path d={PATHS[name]} />
    </svg>
  );
}
`;

files["src/components/CustomVideoPlayer.tsx"] = String.raw`
"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Icon from "@/components/Icons";
import type { CaptionTrack, VideoSource } from "@/types/playback";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const QUALITY_KEY = "openreel:quality";
const SHORTCUTS: [string, string][] = [
  ["Space / K", "Play / pause"],
  ["← / →", "Back / forward 5 seconds"],
  ["J / L", "Back / forward 10 seconds"],
  ["↑ / ↓", "Volume up / down"],
  ["M", "Mute / unmute"],
  ["F", "Fullscreen"],
  ["C", "Subtitles on / off"],
  ["< / >", "Slower / faster"],
  ["0 – 9", "Jump to 0% – 90%"],
  ["?", "Show this help"],
];

type Menu = "main" | "quality" | "speed" | "captions";
type QualityState = { index: number; mode: "auto" | "manual" };
type WebkitVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };
type NetworkInfo = { effectiveType?: string; saveData?: boolean };

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const ss = s < 10 ? "0" + s : String(s);
  if (h > 0) return h + ":" + (m < 10 ? "0" + m : String(m)) + ":" + ss;
  return m + ":" + ss;
}

function rankHeight(source: VideoSource): number {
  if (source.height) return source.height;
  if (source.bitrate) return source.bitrate >= 2000 ? 720 : source.bitrate >= 900 ? 480 : 360;
  return 480;
}

/** Picks a quality that suits the screen size and network connection. */
function pickAutoIndex(sources: VideoSource[]): number {
  if (sources.length <= 1) return 0;
  let target = 720;
  try {
    const px = window.innerWidth * (window.devicePixelRatio || 1);
    target = px >= 1800 ? 1080 : px >= 1000 ? 720 : 480;
    const connection = (navigator as Navigator & { connection?: NetworkInfo }).connection;
    if (connection && (connection.saveData || connection.effectiveType === "2g" || connection.effectiveType === "slow-2g")) {
      target = 240;
    } else if (connection && connection.effectiveType === "3g") {
      target = Math.min(target, 480);
    }
  } catch {
    // keep default target
  }
  const index = sources.findIndex((s) => rankHeight(s) <= target);
  return index === -1 ? sources.length - 1 : index;
}

function initialQuality(sources: VideoSource[]): QualityState {
  try {
    const saved = window.localStorage.getItem(QUALITY_KEY);
    if (saved) {
      const index = sources.findIndex((s) => s.label === saved);
      if (index >= 0) return { index, mode: "manual" };
    }
  } catch {
    // storage unavailable
  }
  return { index: pickAutoIndex(sources), mode: "auto" };
}

function speedLabel(value: number): string {
  return value === 1 ? "Normal" : value + "×";
}

function bitrateLabel(kbps: number): string {
  return kbps >= 1000 ? (kbps / 1000).toFixed(1) + " Mbps" : kbps + " kbps";
}

interface Props {
  sources: VideoSource[];
  captions: CaptionTrack[];
  poster: string | null;
  title: string;
  autoPlay?: boolean;
  storageKey: string;
  onEnded?: () => void;
}

export default function CustomVideoPlayer({ sources, captions, poster, title, autoPlay = false, storageKey, onEnded }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const toastTimer = useRef<number | undefined>(undefined);
  const tapTimer = useRef<number | undefined>(undefined);
  const lastTap = useRef(0);
  const pointerType = useRef("mouse");
  const lastSaved = useRef(0);
  const resumeAt = useRef<number | null>(null);
  const resumePlaying = useRef(false);
  const firstLoadDone = useRef(false);
  const seeking = useRef(false);
  const stalls = useRef<number[]>([]);

  const [quality, setQuality] = useState<QualityState>(() => initialQuality(sources));
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [waiting, setWaiting] = useState(true);
  const [error, setError] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [captionIndex, setCaptionIndex] = useState(-1);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [hover, setHover] = useState<{ left: number; time: number } | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [showRemaining, setShowRemaining] = useState(false);

  const sourceIndex = Math.min(Math.max(quality.index, 0), sources.length - 1);
  const source = sources[sourceIndex];

  useEffect(() => {
    setPipSupported("pictureInPictureEnabled" in document && document.pictureInPictureEnabled);
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.clearTimeout(hideTimer.current);
      window.clearTimeout(toastTimer.current);
      window.clearTimeout(tapTimer.current);
    };
  }, []);

  // Close the settings menu when clicking anywhere else.
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menu]);

  // Show the selected subtitle track and hide the others.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    for (let i = 0; i < v.textTracks.length; i++) {
      v.textTracks[i].mode = i === captionIndex ? "showing" : "disabled";
    }
  }, [captionIndex, sourceIndex, captions.length]);

  function showToast(text: string) {
    setToast({ id: Date.now(), text });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1000);
  }

  function revealControls() {
    setControlsVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setControlsVisible(false);
    }, 2800);
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) v.play().catch(() => setPlaying(false));
    else v.pause();
  }

  function seekTo(time: number) {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration)) return;
    v.currentTime = Math.min(Math.max(time, 0), v.duration);
  }

  function seekBy(delta: number) {
    const v = videoRef.current;
    if (v) seekTo(v.currentTime + delta);
  }

  function changeVolume(value: number) {
    const v = videoRef.current;
    if (!v) return;
    v.volume = Math.min(1, Math.max(0, value));
    v.muted = v.volume === 0;
  }

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    if (v.muted && v.volume === 0) v.volume = 0.5;
    v.muted = !v.muted;
    showToast(v.muted ? "Muted" : "Sound on");
  }

  function changeSpeed(value: number) {
    const v = videoRef.current;
    if (v) v.playbackRate = value;
    setSpeed(value);
    showToast("Speed: " + speedLabel(value));
  }

  function stepSpeed(direction: 1 | -1) {
    const index = SPEEDS.indexOf(speed);
    const nextIndex = Math.min(SPEEDS.length - 1, Math.max(0, (index === -1 ? 3 : index) + direction));
    changeSpeed(SPEEDS[nextIndex]);
  }

  function toggleFullscreen() {
    const wrap = wrapRef.current;
    const v = videoRef.current as WebkitVideo | null;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (wrap && typeof wrap.requestFullscreen === "function") {
      wrap.requestFullscreen().catch(() => undefined);
      return;
    }
    if (v && typeof v.webkitEnterFullscreen === "function") v.webkitEnterFullscreen();
  }

  function togglePip() {
    const v = videoRef.current;
    if (!v) return;
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => undefined);
    else v.requestPictureInPicture().catch(() => undefined);
  }

  function switchSource(index: number, mode: "auto" | "manual") {
    const v = videoRef.current;
    if (v && index !== sourceIndex) {
      resumeAt.current = v.currentTime;
      resumePlaying.current = !v.paused;
      setWaiting(true);
    }
    setQuality({ index, mode });
  }

  function chooseQuality(choice: number | "auto") {
    if (choice === "auto") {
      try {
        window.localStorage.removeItem(QUALITY_KEY);
      } catch {
        // storage unavailable
      }
      const index = pickAutoIndex(sources);
      switchSource(index, "auto");
      showToast("Quality: Auto (" + sources[index].label + ")");
    } else {
      try {
        window.localStorage.setItem(QUALITY_KEY, sources[choice].label);
      } catch {
        // storage unavailable
      }
      switchSource(choice, "manual");
      showToast("Quality: " + sources[choice].label);
    }
    setMenu(null);
  }

  function chooseCaption(index: number) {
    setCaptionIndex(index);
    setMenu(null);
    showToast(index === -1 ? "Subtitles off" : "Subtitles: " + captions[index].label);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "SELECT") return;
    if (target.tagName === "BUTTON" && (event.key === " " || event.key === "Enter")) return;
    const v = videoRef.current;
    if (!v) return;
    let handled = true;
    switch (event.key) {
      case " ":
      case "k":
      case "K":
        togglePlay();
        break;
      case "ArrowLeft":
        seekBy(-5);
        showToast("−5s");
        break;
      case "ArrowRight":
        seekBy(5);
        showToast("+5s");
        break;
      case "j":
      case "J":
        seekBy(-10);
        showToast("−10s");
        break;
      case "l":
      case "L":
        seekBy(10);
        showToast("+10s");
        break;
      case "ArrowUp":
        changeVolume(v.volume + 0.1);
        showToast("Volume " + Math.round(Math.min(1, v.volume) * 100) + "%");
        break;
      case "ArrowDown":
        changeVolume(v.volume - 0.1);
        showToast("Volume " + Math.round(Math.max(0, v.volume) * 100) + "%");
        break;
      case "m":
      case "M":
        toggleMute();
        break;
      case "f":
      case "F":
        toggleFullscreen();
        break;
      case "c":
      case "C":
        if (captions.length > 0) chooseCaption(captionIndex === -1 ? 0 : -1);
        else handled = false;
        break;
      case "<":
        stepSpeed(-1);
        break;
      case ">":
        stepSpeed(1);
        break;
      case "?":
        setHelpOpen((open) => !open);
        break;
      case "Escape":
        if (menu || helpOpen) {
          setMenu(null);
          setHelpOpen(false);
        } else {
          handled = false;
        }
        break;
      case "Home":
        seekTo(0);
        break;
      case "End":
        seekTo(v.duration);
        break;
      default:
        if (/^[0-9]$/.test(event.key) && Number.isFinite(v.duration)) seekTo((v.duration * Number(event.key)) / 10);
        else handled = false;
    }
    if (handled) {
      event.preventDefault();
      revealControls();
    }
  }

  function handleVideoClick() {
    if (pointerType.current !== "mouse") return;
    if (menu) {
      setMenu(null);
      return;
    }
    togglePlay();
  }

  // Touch: single tap shows/hides controls; double tap left/right skips 10 s; double tap centre plays/pauses.
  function handleVideoPointerUp(event: ReactPointerEvent<HTMLVideoElement>) {
    if (event.pointerType === "mouse") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const now = Date.now();
    if (now - lastTap.current < 300) {
      window.clearTimeout(tapTimer.current);
      lastTap.current = 0;
      if (x < 0.4) {
        seekBy(-10);
        showToast("−10s");
      } else if (x > 0.6) {
        seekBy(10);
        showToast("+10s");
      } else {
        togglePlay();
      }
      return;
    }
    lastTap.current = now;
    tapTimer.current = window.setTimeout(() => {
      lastTap.current = 0;
      setControlsVisible((visible) => !visible);
    }, 300);
  }

  function handleSeekHover(event: ReactMouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHover({ left: ratio * 100, time: ratio * duration });
  }

  const progress = duration > 0 ? (current / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;
  const shownVolume = muted ? 0 : volume;
  const showControls = controlsVisible || !playing || menu !== null;
  const qualitySummary = quality.mode === "auto" ? "Auto (" + source.label + ")" : source.label;

  return (
    <div
      ref={wrapRef}
      className={"cvp" + (showControls ? " cvp-show" : "") + (fullscreen ? " cvp-fullscreen" : "")}
      tabIndex={0}
      role="region"
      aria-label={"Video player: " + title}
      onKeyDown={handleKeyDown}
      onMouseMove={revealControls}
      onMouseLeave={() => {
        if (playing && !menu) setControlsVisible(false);
      }}
    >
      <video
        ref={videoRef}
        src={source.url}
        poster={poster ?? undefined}
        playsInline
        preload="metadata"
        onPointerDown={(e) => {
          pointerType.current = e.pointerType;
        }}
        onPointerUp={handleVideoPointerUp}
        onClick={handleVideoClick}
        onDoubleClick={() => {
          if (pointerType.current === "mouse") toggleFullscreen();
        }}
        onPlay={() => {
          setPlaying(true);
          revealControls();
        }}
        onPause={() => {
          setPlaying(false);
          setControlsVisible(true);
        }}
        onWaiting={() => {
          setWaiting(true);
          const v = videoRef.current;
          if (!v || seeking.current || v.currentTime < 2 || quality.mode !== "auto") return;
          const now = Date.now();
          stalls.current = stalls.current.filter((t) => now - t < 30000).concat(now);
          if (stalls.current.length >= 3 && sourceIndex < sources.length - 1) {
            stalls.current = [];
            switchSource(sourceIndex + 1, "auto");
            showToast("Switched to " + sources[sourceIndex + 1].label + " for smoother playback");
          }
        }}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onSeeking={() => {
          seeking.current = true;
        }}
        onSeeked={() => {
          seeking.current = false;
        }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          setCurrent(v.currentTime);
          if (Math.abs(v.currentTime - lastSaved.current) > 5) {
            lastSaved.current = v.currentTime;
            try {
              window.localStorage.setItem(storageKey, String(Math.floor(v.currentTime)));
            } catch {
              // storage unavailable
            }
          }
        }}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          setDuration(Number.isFinite(v.duration) ? v.duration : 0);
          setWaiting(false);
          v.playbackRate = speed;
          if (resumeAt.current !== null) {
            v.currentTime = resumeAt.current;
            const shouldPlay = resumePlaying.current;
            resumeAt.current = null;
            if (shouldPlay) v.play().catch(() => setPlaying(false));
            return;
          }
          if (!firstLoadDone.current) {
            firstLoadDone.current = true;
            try {
              const saved = Number(window.localStorage.getItem(storageKey));
              if (saved > 30 && Number.isFinite(v.duration) && saved < v.duration - 60) {
                v.currentTime = saved;
                showToast("Resumed from " + formatTime(saved));
              }
            } catch {
              // storage unavailable
            }
            if (autoPlay) v.play().catch(() => setPlaying(false));
          }
        }}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          setDuration(Number.isFinite(d) ? d : 0);
        }}
        onProgress={(e) => {
          const v = e.currentTarget;
          if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1));
        }}
        onVolumeChange={(e) => {
          setVolume(e.currentTarget.volume);
          setMuted(e.currentTarget.muted);
        }}
        onRateChange={(e) => setSpeed(e.currentTarget.playbackRate)}
        onEnded={() => {
          try {
            window.localStorage.removeItem(storageKey);
          } catch {
            // storage unavailable
          }
          if (onEnded) {
            showToast("Playing next episode…");
            window.setTimeout(onEnded, 900);
          }
        }}
        onError={() => {
          if (sourceIndex < sources.length - 1) {
            switchSource(sourceIndex + 1, quality.mode);
            showToast("Trying " + sources[sourceIndex + 1].label + "…");
          } else {
            setWaiting(false);
            setError(true);
          }
        }}
      >
        {captions.map((track) => (
          <track key={track.src} kind="subtitles" src={track.src} srcLang={track.lang} label={track.label} />
        ))}
      </video>

      {waiting && !error && <span className="cvp-spinner" aria-hidden="true" />}

      {!playing && !waiting && !error && (
        <button type="button" className="cvp-big-play" aria-label="Play" onClick={togglePlay}>
          <Icon name="play" size={40} />
        </button>
      )}

      {toast && (
        <div key={toast.id} className="cvp-toast" role="status">{toast.text}</div>
      )}

      {error && (
        <div className="cvp-error" role="alert">This video couldn&apos;t be loaded. Please try again later.</div>
      )}

      {helpOpen && (
        <div className="cvp-help" role="dialog" aria-label="Keyboard shortcuts" onClick={() => setHelpOpen(false)}>
          <div className="cvp-help-card" onClick={(e) => e.stopPropagation()}>
            <h3>Keyboard shortcuts</h3>
            <dl>
              {SHORTCUTS.map(([keys, action]) => (
                <div key={keys} className="cvp-help-row">
                  <dt><kbd>{keys}</kbd></dt>
                  <dd>{action}</dd>
                </div>
              ))}
            </dl>
            <button type="button" className="btn" onClick={() => setHelpOpen(false)}>Close</button>
          </div>
        </div>
      )}

      <div className="cvp-controls">
        <div className="cvp-seek-wrap" onMouseMove={handleSeekHover} onMouseLeave={() => setHover(null)}>
          {hover && duration > 0 && (
            <span className="cvp-tooltip" style={{ left: hover.left + "%" }}>{formatTime(hover.time)}</span>
          )}
          <input
            type="range"
            className="cvp-range cvp-seek"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(current, duration || 0)}
            onChange={(e) => seekTo(Number(e.target.value))}
            aria-label="Seek"
            aria-valuetext={formatTime(current) + " of " + formatTime(duration)}
            style={{ "--progress": progress + "%", "--buffered": bufferedPct + "%" } as CSSProperties}
          />
        </div>

        <div className="cvp-bar">
          <div className="cvp-group">
            <button type="button" className="cvp-btn" onClick={togglePlay} aria-label={playing ? "Pause (k)" : "Play (k)"}>
              <Icon name={playing ? "pause" : "play"} />
            </button>
            <button type="button" className="cvp-btn" onClick={() => seekBy(-10)} aria-label="Back 10 seconds (j)">
              <Icon name="rewind" />
            </button>
            <button type="button" className="cvp-btn" onClick={() => seekBy(10)} aria-label="Forward 10 seconds (l)">
              <Icon name="forward" />
            </button>
            <div className="cvp-volume">
              <button type="button" className="cvp-btn" onClick={toggleMute} aria-label={muted ? "Unmute (m)" : "Mute (m)"}>
                <Icon name={shownVolume === 0 ? "mute" : "volume"} />
              </button>
              <input
                type="range"
                className="cvp-range cvp-volume-range"
                min={0}
                max={1}
                step={0.05}
                value={shownVolume}
                onChange={(e) => changeVolume(Number(e.target.value))}
                aria-label="Volume"
                style={{ "--progress": shownVolume * 100 + "%" } as CSSProperties}
              />
            </div>
            <button
              type="button"
              className="cvp-time"
              onClick={() => setShowRemaining((r) => !r)}
              aria-label="Toggle elapsed or remaining time"
            >
              {(showRemaining ? "−" + formatTime(duration - current) : formatTime(current)) + " / " + formatTime(duration)}
            </button>
          </div>

          <div className="cvp-group">
            {captions.length > 0 && (
              <button
                type="button"
                className={"cvp-btn" + (captionIndex >= 0 ? " is-on" : "")}
                onClick={() => chooseCaption(captionIndex >= 0 ? -1 : 0)}
                aria-label="Subtitles (c)"
                aria-pressed={captionIndex >= 0}
              >
                <Icon name="captions" />
              </button>
            )}

            <div className="cvp-settings" ref={settingsRef}>
              <button
                type="button"
                className="cvp-btn"
                aria-label="Settings: quality, speed, subtitles"
                aria-haspopup="menu"
                aria-expanded={menu !== null}
                onClick={() => setMenu((m) => (m ? null : "main"))}
              >
                <Icon name="settings" className={"cvp-gear" + (menu ? " is-rotated" : "")} />
                {source.height !== undefined && source.height >= 720 && <span className="cvp-quality-badge">HD</span>}
              </button>

              {menu && (
                <div className="cvp-menu" role="menu" key={menu}>
                  {menu === "main" && (
                    <>
                      <button type="button" role="menuitem" className="cvp-menu-item" onClick={() => setMenu("quality")}>
                        <span>Quality</span>
                        <span className="cvp-menu-value">{qualitySummary}</span>
                        <Icon name="chevronRight" size={18} />
                      </button>
                      <button type="button" role="menuitem" className="cvp-menu-item" onClick={() => setMenu("speed")}>
                        <span>Playback speed</span>
                        <span className="cvp-menu-value">{speedLabel(speed)}</span>
                        <Icon name="chevronRight" size={18} />
                      </button>
                      {captions.length > 0 && (
                        <button type="button" role="menuitem" className="cvp-menu-item" onClick={() => setMenu("captions")}>
                          <span>Subtitles</span>
                          <span className="cvp-menu-value">{captionIndex >= 0 ? captions[captionIndex].label : "Off"}</span>
                          <Icon name="chevronRight" size={18} />
                        </button>
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        className="cvp-menu-item"
                        onClick={() => {
                          setMenu(null);
                          setHelpOpen(true);
                        }}
                      >
                        <span>Keyboard shortcuts</span>
                        <span className="cvp-menu-value">?</span>
                      </button>
                    </>
                  )}

                  {menu === "quality" && (
                    <>
                      <button type="button" className="cvp-menu-back" onClick={() => setMenu("main")}>
                        <Icon name="chevronLeft" size={18} /> Quality
                      </button>
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={quality.mode === "auto"}
                        className="cvp-menu-item"
                        onClick={() => chooseQuality("auto")}
                      >
                        <span className="cvp-check">{quality.mode === "auto" && <Icon name="check" size={16} />}</span>
                        <span>Auto</span>
                        {quality.mode === "auto" && <span className="cvp-menu-value">{source.label}</span>}
                      </button>
                      {sources.map((s, i) => (
                        <button
                          key={s.url}
                          type="button"
                          role="menuitemradio"
                          aria-checked={quality.mode === "manual" && i === sourceIndex}
                          className="cvp-menu-item"
                          onClick={() => chooseQuality(i)}
                        >
                          <span className="cvp-check">
                            {quality.mode === "manual" && i === sourceIndex && <Icon name="check" size={16} />}
                          </span>
                          <span>{s.label}</span>
                          {s.height !== undefined && s.height >= 720 && <span className="hd-badge">HD</span>}
                          {s.bitrate !== undefined && <span className="cvp-menu-value">{bitrateLabel(s.bitrate)}</span>}
                        </button>
                      ))}
                    </>
                  )}

                  {menu === "speed" && (
                    <>
                      <button type="button" className="cvp-menu-back" onClick={() => setMenu("main")}>
                        <Icon name="chevronLeft" size={18} /> Playback speed
                      </button>
                      {SPEEDS.map((s) => (
                        <button
                          key={s}
                          type="button"
                          role="menuitemradio"
                          aria-checked={s === speed}
                          className="cvp-menu-item"
                          onClick={() => {
                            changeSpeed(s);
                            setMenu(null);
                          }}
                        >
                          <span className="cvp-check">{s === speed && <Icon name="check" size={16} />}</span>
                          <span>{speedLabel(s)}</span>
                        </button>
                      ))}
                    </>
                  )}

                  {menu === "captions" && (
                    <>
                      <button type="button" className="cvp-menu-back" onClick={() => setMenu("main")}>
                        <Icon name="chevronLeft" size={18} /> Subtitles
                      </button>
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={captionIndex === -1}
                        className="cvp-menu-item"
                        onClick={() => chooseCaption(-1)}
                      >
                        <span className="cvp-check">{captionIndex === -1 && <Icon name="check" size={16} />}</span>
                        <span>Off</span>
                      </button>
                      {captions.map((track, i) => (
                        <button
                          key={track.src}
                          type="button"
                          role="menuitemradio"
                          aria-checked={captionIndex === i}
                          className="cvp-menu-item"
                          onClick={() => chooseCaption(i)}
                        >
                          <span className="cvp-check">{captionIndex === i && <Icon name="check" size={16} />}</span>
                          <span>{track.label}</span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>

            {pipSupported && (
              <button type="button" className="cvp-btn" onClick={togglePip} aria-label="Picture in picture">
                <Icon name="pip" />
              </button>
            )}
            <button
              type="button"
              className="cvp-btn"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? "Exit fullscreen (f)" : "Fullscreen (f)"}
            >
              <Icon name={fullscreen ? "fullscreenExit" : "fullscreen"} />
            </button>
          </div>
        </div>
      </div>
    </div>
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
import { embedUrlFor, isPlayable, thumbnailFor } from "@/lib/media";
import { formatRuntime } from "@/lib/format";
import { reportMailto } from "@/lib/contact";

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

function EmbedFrame({ src, title, movie, isYouTube }: { src: string; title: string; movie: Movie; isYouTube: boolean }) {
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
        {isYouTube
          ? "Quality, subtitles and speed are in the ⚙ menu inside the YouTube player. "
          : "Using the source's own player. "}
        Not playing? <a href={reportMailto("broken_playback", movie)}>Report it</a>.
      </p>
    </div>
  );
}

interface SourcePlayerProps {
  movie: Movie;
  item: PlaybackFields;
  episodeIndex: number | null;
  title: string;
  poster: string | null;
  autoPlay: boolean;
  onEnded?: () => void;
}

function SourcePlayer({ movie, item, episodeIndex, title, poster, autoPlay, onEnded }: SourcePlayerProps) {
  const [started, setStarted] = useState(autoPlay);
  const [load, setLoad] = useState<LoadState>({ status: "idle" });
  const playable = isPlayable(item);
  const needsSources = playable && (item.playbackType === "archive" || item.playbackType === "direct_video");

  useEffect(() => {
    if (!started || !needsSources) return;
    const controller = new AbortController();
    setLoad({ status: "loading" });
    const url = "/api/sources/" + encodeURIComponent(movie.slug) + (episodeIndex !== null ? "?episode=" + episodeIndex : "");
    fetch(url, { signal: controller.signal })
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
  }, [started, needsSources, movie.slug, episodeIndex]);

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

  if (item.playbackType === "youtube") {
    const src = embedUrlFor(item, true);
    return src ? <EmbedFrame src={src} title={title} movie={movie} isYouTube /> : <Unavailable movie={movie} />;
  }

  if (load.status === "ready" && load.data.sources.length > 0) {
    return (
      <CustomVideoPlayer
        sources={load.data.sources}
        captions={load.data.captions}
        poster={poster}
        title={title}
        autoPlay
        storageKey={"openreel:position:" + movie.id + (episodeIndex !== null ? ":" + episodeIndex : "")}
        onEnded={onEnded}
      />
    );
  }

  if (load.status === "ready" || load.status === "failed") {
    // No playable files found: fall back to the Archive's own player.
    if (item.playbackType === "archive") {
      const src = embedUrlFor(item, true);
      if (src) return <EmbedFrame src={src} title={title} movie={movie} isYouTube={false} />;
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

function EpisodeList({
  movie,
  episodes,
  activeIndex,
  onSelect,
}: {
  movie: Movie;
  episodes: Episode[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  const seasons = useMemo(
    () => Array.from(new Set(episodes.map((ep) => ep.season ?? 1))).sort((a, b) => a - b),
    [episodes],
  );
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
                <Thumb src={thumbnailFor(ep) ?? thumbnailFor(movie)} alt={ep.title} />
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

export default function VideoPlayer({ movie, autoPlay = false }: { movie: Movie; autoPlay?: boolean }) {
  const episodes = movie.episodes ?? [];
  const isShow = movie.contentType === "show" && episodes.length > 0;
  const [episodeIndex, setEpisodeIndex] = useState(0);
  const [startPlaying, setStartPlaying] = useState(autoPlay);

  const safeIndex = Math.min(episodeIndex, Math.max(episodes.length - 1, 0));
  const item: PlaybackFields = isShow ? episodes[safeIndex] : movie;
  const poster = thumbnailFor(item) ?? thumbnailFor(movie);
  const title = isShow ? movie.title + " · " + episodes[safeIndex].title : movie.title;
  const hasNext = isShow && safeIndex < episodes.length - 1;

  function playEpisode(index: number) {
    setEpisodeIndex(index);
    setStartPlaying(true);
  }

  return (
    <div className="video-player">
      <SourcePlayer
        key={isShow ? "episode-" + safeIndex : "main"}
        movie={movie}
        item={item}
        episodeIndex={isShow ? safeIndex : null}
        title={title}
        poster={poster}
        autoPlay={startPlaying}
        onEnded={hasNext ? () => playEpisode(safeIndex + 1) : undefined}
      />
      {isShow && <EpisodeList movie={movie} episodes={episodes} activeIndex={safeIndex} onSelect={playEpisode} />}
    </div>
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
import { thumbnailFor } from "@/lib/media";
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

  // Keep the active thumbnail centred in the rail.
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
      aria-label="Featured films and shows"
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
          const src = thumbnailFor(m);
          const near = Math.abs(i - active) <= 1 || (active === 0 && i === count - 1) || (active === count - 1 && i === 0);
          return (
            <div key={tab.key + "-" + m.id} className={"showcase-slide" + (i === active ? " is-active" : "")}>
              {src && near ? <img src={src} alt="" referrerPolicy="no-referrer" decoding="async" /> : null}
            </div>
          );
        })}
      </div>
      <div className="showcase-shade" />

      <div className="showcase-tabs" role="tablist" aria-label="Collections">
        {available.map((c, i) => (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={c.key === tab.key}
            className="showcase-tab"
            onClick={() => selectTab(i)}
          >
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
              <Thumb src={thumbnailFor(m)} alt={m.title} />
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
        <span
          key={tab.key + "-progress-" + active}
          className={"showcase-progress" + (paused ? " is-paused" : "")}
          onAnimationEnd={next}
          aria-hidden="true"
        />
      )}
    </section>
  );
}
`;

files["src/components/Catalog.tsx"] = String.raw`
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  GROUP_OPTIONS,
  NO_CATEGORY,
  SORT_OPTIONS,
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
  seeAll: Partial<BrowseState>;
}

interface Props {
  movies: Movie[];
  initialSearch: string;
}

function countLabel(count: number, noun: string): string {
  return count + " " + noun + (count === 1 ? "" : "s");
}

export default function Catalog({ movies, initialSearch }: Props) {
  const [state, setState] = useState<BrowseState>(() => stateFromSearch(initialSearch));
  const [playingSlug, setPlayingSlug] = useState<string | null>(() => new URLSearchParams(initialSearch).get("play"));
  const [limit, setLimit] = useState(PAGE_SIZE);
  const browseRef = useRef<HTMLElement>(null);

  // Keep the address bar in sync so any view (and the open title) can be bookmarked or shared.
  useEffect(() => {
    const params = new URLSearchParams(stateToSearch(state));
    if (playingSlug) params.set("play", playingSlug);
    const query = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (query ? "?" + query : ""));
  }, [state, playingSlug]);

  const newestFirst = useMemo(() => sortMovies(movies, "newest"), [movies]);
  const popularFirst = useMemo(() => sortMovies(movies, "popular"), [movies]);
  const industryCounts = useMemo(() => buildIndustryCounts(movies), [movies]);
  const typeCounts = useMemo(
    () => ({
      movie: movies.filter((m) => contentTypeOf(m) === "movie").length,
      show: movies.filter((m) => contentTypeOf(m) === "show").length,
    }),
    [movies],
  );
  const scoped = useMemo(
    () =>
      movies.filter(
        (m) => (!state.industry || m.industry === state.industry) && (!state.type || contentTypeOf(m) === state.type),
      ),
    [movies, state.industry, state.type],
  );
  const facets = useMemo(() => buildFacets(scoped), [scoped]);
  const results = useMemo(() => sortMovies(filterMovies(movies, state), state.sort), [movies, state]);
  const groups = useMemo(() => groupMovies(results, state.group, state.sort), [results, state.group, state.sort]);

  const heroCollections = useMemo<HeroCollection[]>(() => {
    const featured = popularFirst.filter((m) => m.featured);
    const trending = [...featured, ...popularFirst.filter((m) => !m.featured)].slice(0, HERO_LIMIT);
    return [
      { key: "trending", label: "Trending", items: trending },
      { key: "latest", label: "Latest", items: newestFirst.slice(0, HERO_LIMIT) },
      { key: "movies", label: "Movies", items: popularFirst.filter((m) => contentTypeOf(m) === "movie").slice(0, HERO_LIMIT) },
      { key: "shows", label: "Shows", items: popularFirst.filter((m) => contentTypeOf(m) === "show").slice(0, HERO_LIMIT) },
    ];
  }, [newestFirst, popularFirst]);

  const homeRows = useMemo<HomeRow[]>(() => {
    const rows: HomeRow[] = [
      {
        key: "trending",
        title: "Trending now",
        subtitle: "Most watched and featured",
        list: popularFirst.slice(0, ROW_LIMIT),
        seeAll: { sort: "popular" },
      },
      {
        key: "latest",
        title: "Latest releases",
        subtitle: "Newest first, across every industry",
        list: newestFirst.slice(0, ROW_LIMIT),
        seeAll: { sort: "newest" },
      },
    ];

    const shows = popularFirst.filter((m) => contentTypeOf(m) === "show");
    if (shows.length > 0) {
      rows.push({ key: "shows", title: "Shows & series", subtitle: countLabel(shows.length, "show"), list: shows.slice(0, ROW_LIMIT), seeAll: { type: "show" } });
    }

    for (const info of INDUSTRIES) {
      const list = newestFirst.filter((m) => m.industry === info.value);
      if (list.length === 0) continue;
      rows.push({
        key: "industry-" + info.value,
        title: info.label,
        subtitle: info.tagline + " · " + countLabel(list.length, "title"),
        list: list.slice(0, ROW_LIMIT),
        seeAll: { industry: info.value },
      });
    }

    const counts = new Map<string, number>();
    for (const movie of movies) {
      for (const category of movieCategories(movie)) counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    const categories = Array.from(counts.keys()).sort((a, b) => {
      if (a === NO_CATEGORY) return 1;
      if (b === NO_CATEGORY) return -1;
      return (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b);
    });
    for (const category of categories) {
      const list = newestFirst.filter((m) => movieCategories(m).includes(category));
      rows.push({
        key: "category-" + category,
        title: category === NO_CATEGORY ? "Other titles" : category,
        subtitle: countLabel(list.length, "title"),
        list: list.slice(0, ROW_LIMIT),
        seeAll: { genre: category },
      });
    }
    return rows;
  }, [movies, newestFirst, popularFirst]);

  const playing = playingSlug ? movies.find((m) => m.slug === playingSlug) ?? null : null;
  const related = useMemo(
    () => (playing ? newestFirst.filter((m) => m.id !== playing.id && m.industry === playing.industry).slice(0, 12) : []),
    [newestFirst, playing],
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
    setPlayingSlug(movie.slug);
  }

  function seeAll(patch: Partial<BrowseState>) {
    change({ sort: "newest", group: "none", ...patch });
    window.setTimeout(() => browseRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function renderMovies(list: Movie[]) {
    return state.view === "list" ? (
      <MovieList movies={list} onPlay={openPlayer} />
    ) : (
      <MovieGrid movies={list} onPlay={openPlayer} />
    );
  }

  const heading =
    (state.industry ? industryLabel(state.industry) + " " : "") +
    (state.type === "show" ? "shows" : state.type === "movie" ? "movies" : state.industry ? "titles" : "Browse everything");

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
            onPlay={openPlayer}
            onSeeAll={() => seeAll(row.seeAll)}
          />
        ))}

      <section ref={browseRef} className="browse" aria-labelledby="browse-heading">
        <h2 id="browse-heading" className="browse-title">{heading}</h2>

        <div className="industry-tabs" role="group" aria-label="Film industry">
          <button type="button" aria-pressed={state.industry === ""} onClick={() => change({ industry: "" })}>
            All <span className="chip-count">{movies.length}</span>
          </button>
          {industryCounts.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={state.industry === f.value}
              onClick={() => change({ industry: f.value })}
            >
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
              <button
                key={f.value}
                type="button"
                className="chip"
                aria-pressed={state.genre === f.value}
                onClick={() => change({ genre: state.genre === f.value ? "" : f.value })}
              >
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
            <div className="segmented" role="group" aria-label="Type">
              <button type="button" aria-pressed={state.type === ""} onClick={() => change({ type: "" })}>All</button>
              <button type="button" aria-pressed={state.type === "movie"} onClick={() => change({ type: "movie" })}>
                {"Movies (" + typeCounts.movie + ")"}
              </button>
              <button type="button" aria-pressed={state.type === "show"} onClick={() => change({ type: "show" })}>
                {"Shows (" + typeCounts.show + ")"}
              </button>
            </div>
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
            <p>
              {scopeEmpty
                ? "Nothing has been added here yet."
                : "Nothing matches. Try fewer words or remove a filter."}
            </p>
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
                <button type="button" className="btn" onClick={() => setLimit(results.length)}>
                  Show all
                </button>
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

files["src/components/MovieCard.tsx"] = String.raw`
"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import type { Movie } from "@/types/movie";
import Thumb from "@/components/Thumb";
import Icon from "@/components/Icons";
import { thumbnailFor } from "@/lib/media";
import { industryLabel } from "@/lib/industries";
import { formatRuntime } from "@/lib/format";
import { formatShortRelease } from "@/lib/dates";

interface Props {
  movie: Movie;
  onPlay?: (movie: Movie) => void;
}

export default function MovieCard({ movie, onPlay }: Props) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!onPlay) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onPlay(movie);
  }

  const isShow = movie.contentType === "show";
  const meta = [formatShortRelease(movie), movie.languages[0] ?? ""].filter(Boolean).join(" · ");

  return (
    <li className="card">
      <Link
        href={"/movies/" + movie.slug}
        className="card-link"
        onClick={handleClick}
        aria-label={(onPlay ? "Play " : "Open ") + movie.title}
      >
        <div className="card-media">
          <Thumb src={thumbnailFor(movie)} alt={movie.title} />
          <span className="badge badge-industry">{industryLabel(movie.industry)}</span>
          {isShow && <span className="badge badge-show">{"Series · " + (movie.episodes?.length ?? 0) + " ep"}</span>}
          {!isShow && movie.runtimeMinutes !== undefined && (
            <span className="badge badge-duration">{formatRuntime(movie.runtimeMinutes)}</span>
          )}
          {movie.rightsStatus !== "approved" && <span className="badge badge-pending">Pending</span>}
          <span className="card-play" aria-hidden="true">
            <Icon name="play" />
          </span>
        </div>
        <div className="card-body">
          <h3 className="card-title">{movie.title}</h3>
          {meta && <p className="card-meta">{meta}</p>}
        </div>
      </Link>
    </li>
  );
}
`;

files["src/components/ActiveFilters.tsx"] = String.raw`
"use client";

import type { BrowseState } from "@/lib/filter";
import { RUNTIME_OPTIONS } from "@/lib/filter";
import { MONTH_NAMES } from "@/lib/dates";
import { industryLabel } from "@/lib/industries";

interface Props {
  state: BrowseState;
  onChange: (patch: Partial<BrowseState>) => void;
  onClear: () => void;
}

export default function ActiveFilters({ state, onChange, onClear }: Props) {
  const chips: { label: string; patch: Partial<BrowseState> }[] = [];
  if (state.query) chips.push({ label: "Search: " + state.query, patch: { query: "" } });
  if (state.type) chips.push({ label: "Type: " + (state.type === "show" ? "Shows" : "Movies"), patch: { type: "" } });
  if (state.industry) chips.push({ label: "Industry: " + industryLabel(state.industry), patch: { industry: "" } });
  if (state.genre) chips.push({ label: "Category: " + state.genre, patch: { genre: "" } });
  if (state.language) chips.push({ label: "Language: " + state.language, patch: { language: "" } });
  if (state.decade) chips.push({ label: "Decade: " + state.decade + "s", patch: { decade: "" } });
  if (state.year) chips.push({ label: "Year: " + state.year, patch: { year: "" } });
  if (state.month) {
    const name = MONTH_NAMES[Number(state.month) - 1] ?? state.month;
    chips.push({ label: "Month: " + name, patch: { month: "" } });
  }
  if (state.maxRuntime) {
    const option = RUNTIME_OPTIONS.find((o) => o.value === state.maxRuntime);
    chips.push({ label: "Runtime: " + (option ? option.label : state.maxRuntime + " min"), patch: { maxRuntime: "" } });
  }

  if (chips.length === 0) return null;

  return (
    <div className="active-filters" aria-label="Active filters">
      {chips.map((chip) => (
        <button
          key={chip.label}
          type="button"
          className="chip chip-removable"
          onClick={() => onChange(chip.patch)}
          aria-label={"Remove filter " + chip.label}
        >
          {chip.label} <span aria-hidden="true">×</span>
        </button>
      ))}
      <button type="button" className="link-button" onClick={onClear}>Clear all</button>
    </div>
  );
}
`;

files["src/app/enhancements.css"] = String.raw`
/* ===== Showcase hero carousel ===== */
.showcase { position: relative; overflow: hidden; border-radius: 20px; height: clamp(440px, 72vh, 640px); margin-bottom: 2.5rem; background: #07080c; box-shadow: var(--shadow); isolation: isolate; touch-action: pan-y; }
.showcase:focus-visible { outline-offset: 4px; }
.showcase-slides, .showcase-slide { position: absolute; inset: 0; }
.showcase-slide { opacity: 0; transition: opacity 1.1s cubic-bezier(.4, 0, .2, 1); background: radial-gradient(circle at 70% 30%, #2a2f3d, #0b0d12); }
.showcase-slide.is-active { opacity: 1; z-index: 1; }
.showcase-slide img { width: 100%; height: 100%; object-fit: cover; transform: scale(1.12); will-change: transform; }
.showcase-slide.is-active img { animation: kenburns 12s ease-out forwards; }
@keyframes kenburns { from { transform: scale(1.14) translate3d(0, 0, 0); } to { transform: scale(1.03) translate3d(-1.5%, -1%, 0); } }
.showcase-shade { position: absolute; inset: 0; z-index: 2; pointer-events: none; background: linear-gradient(90deg, rgba(7, 8, 12, .96) 0%, rgba(7, 8, 12, .78) 36%, rgba(7, 8, 12, .2) 72%, rgba(7, 8, 12, .05) 100%), linear-gradient(0deg, rgba(7, 8, 12, .95) 0%, rgba(7, 8, 12, 0) 45%), linear-gradient(180deg, rgba(7, 8, 12, .6) 0%, rgba(7, 8, 12, 0) 25%); }
.showcase-tabs { position: absolute; z-index: 4; top: 1rem; left: clamp(1rem, 4vw, 3rem); display: inline-flex; gap: .25rem; padding: .3rem; border-radius: 999px; background: rgba(255, 255, 255, .08); border: 1px solid rgba(255, 255, 255, .12); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
.showcase-tab { display: inline-flex; align-items: center; gap: .35rem; border: 0; background: transparent; color: rgba(255, 255, 255, .78); padding: .45rem 1rem; border-radius: 999px; font-weight: 700; font-size: .9rem; cursor: pointer; white-space: nowrap; transition: color .25s, background .35s cubic-bezier(.2, .8, .2, 1); }
.showcase-tab:hover { color: #fff; background: rgba(255, 255, 255, .08); }
.showcase-tab[aria-selected="true"] { background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #111; }
.showcase-content { position: absolute; z-index: 3; left: clamp(1rem, 4vw, 3rem); bottom: clamp(6rem, 13vh, 8rem); max-width: min(620px, 88%); }
.showcase-content > * { animation: showcase-in .75s cubic-bezier(.2, .8, .2, 1) both; }
.showcase-content > *:nth-child(2) { animation-delay: .07s; }
.showcase-content > *:nth-child(3) { animation-delay: .14s; }
.showcase-content > *:nth-child(4) { animation-delay: .21s; }
.showcase-content > *:nth-child(5) { animation-delay: .28s; }
.showcase-content.from-left > * { animation-name: showcase-in-left; }
@keyframes showcase-in { from { opacity: 0; transform: translate3d(32px, 0, 0); filter: blur(4px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes showcase-in-left { from { opacity: 0; transform: translate3d(-32px, 0, 0); filter: blur(4px); } to { opacity: 1; transform: none; filter: none; } }
.showcase-badges { display: flex; flex-wrap: wrap; gap: .4rem; margin-bottom: .7rem; }
.pill { display: inline-flex; align-items: center; gap: .3rem; font-size: .75rem; font-weight: 700; padding: .22rem .65rem; border-radius: 999px; background: rgba(255, 255, 255, .14); color: #fff; backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
.pill-accent { background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #111; }
.showcase-title { font-size: clamp(2rem, 5vw, 3.6rem); line-height: 1.05; margin: 0 0 .5rem; letter-spacing: -.03em; text-shadow: 0 4px 24px rgba(0, 0, 0, .5); }
.showcase-meta { color: #c9cfdb; margin: 0 0 .75rem; }
.showcase-desc { color: #dfe3ea; margin: 0 0 1.3rem; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.showcase-actions { display: flex; flex-wrap: wrap; gap: .75rem; }
.btn-glass { background: rgba(255, 255, 255, .12); border-color: rgba(255, 255, 255, .22); color: #fff; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.showcase-arrows { position: absolute; z-index: 4; top: 1rem; right: clamp(1rem, 3vw, 2rem); display: flex; gap: .4rem; }
.showcase-arrows .icon-btn { background: rgba(0, 0, 0, .35); border-color: rgba(255, 255, 255, .2); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); transition: transform .2s, border-color .2s; }
.showcase-arrows .icon-btn:hover { transform: scale(1.08); }
.showcase-rail { position: absolute; z-index: 4; right: clamp(1rem, 3vw, 2rem); bottom: 1.4rem; display: flex; gap: .6rem; max-width: 52%; overflow-x: auto; scrollbar-width: none; padding: .3rem; scroll-behavior: smooth; }
.showcase-rail::-webkit-scrollbar { display: none; }
.rail-item { position: relative; flex: 0 0 auto; width: 136px; aspect-ratio: 16 / 9; padding: 0; border-radius: 10px; overflow: hidden; border: 2px solid transparent; background: var(--surface-2); cursor: pointer; opacity: .55; transform: scale(.93); transition: opacity .4s, transform .45s cubic-bezier(.2, .8, .2, 1), border-color .4s, box-shadow .4s; }
.rail-item:hover { opacity: .9; transform: scale(.98); }
.rail-item.is-active { opacity: 1; transform: scale(1); border-color: var(--accent); box-shadow: 0 8px 24px rgba(0, 0, 0, .5); }
.rail-item .thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
.rail-item .thumb-fallback { font-size: 1.2rem; }
.showcase-progress { position: absolute; z-index: 5; left: 0; bottom: 0; width: 100%; height: 3px; background: linear-gradient(90deg, var(--accent), var(--accent-2)); transform-origin: left center; transform: scaleX(0); animation: showcase-progress var(--slide-ms, 7000ms) linear forwards; }
.showcase-progress.is-paused { animation-play-state: paused; }
@keyframes showcase-progress { to { transform: scaleX(1); } }
.showcase-dots { display: none; }
@media (max-width: 760px) {
  .showcase { height: clamp(470px, 80vh, 580px); border-radius: 16px; }
  .showcase-rail, .showcase-arrows { display: none; }
  .showcase-content { bottom: 3.6rem; }
  .showcase-tabs { left: 50%; transform: translateX(-50%); max-width: calc(100% - 2rem); overflow-x: auto; scrollbar-width: none; }
  .showcase-dots { display: flex; position: absolute; z-index: 4; left: 50%; bottom: 1.3rem; transform: translateX(-50%); gap: .35rem; }
  .showcase-dot { width: 8px; height: 8px; padding: 0; border: 0; border-radius: 50%; background: rgba(255, 255, 255, .35); cursor: pointer; transition: width .35s cubic-bezier(.2, .8, .2, 1), background .35s; }
  .showcase-dot.is-active { width: 24px; border-radius: 4px; background: var(--accent); }
}

/* ===== Cards ===== */
.badge-show { bottom: .5rem; left: .5rem; background: rgba(98, 70, 220, .92); }

/* ===== Player loading ===== */
.player-loading { display: grid; place-items: center; }
.player-loading .thumb { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; filter: brightness(.45) blur(2px); }
.cvp-spinner { position: absolute; left: 50%; top: 50%; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%; border: 4px solid rgba(255, 255, 255, .18); border-top-color: var(--accent); animation: cvp-spin .8s linear infinite; pointer-events: none; z-index: 2; }
@keyframes cvp-spin { to { transform: rotate(360deg); } }

/* ===== Custom player extras ===== */
.cvp-controls { z-index: 4; }
.cvp-toast { position: absolute; left: 50%; top: 16%; z-index: 5; transform: translateX(-50%); background: rgba(0, 0, 0, .75); color: #fff; padding: .45rem 1rem; border-radius: 999px; font-weight: 700; font-size: .9rem; white-space: nowrap; pointer-events: none; animation: cvp-toast 1s ease forwards; }
@keyframes cvp-toast { 0% { opacity: 0; transform: translate(-50%, 6px); } 15% { opacity: 1; transform: translate(-50%, 0); } 75% { opacity: 1; } 100% { opacity: 0; } }
.cvp-seek-wrap { position: relative; }
.cvp-seek-wrap:hover .cvp-seek::-webkit-slider-runnable-track { height: 6px; }
.cvp-tooltip { position: absolute; bottom: 22px; transform: translateX(-50%); background: rgba(0, 0, 0, .88); color: #fff; font-size: .75rem; padding: .15rem .45rem; border-radius: 4px; white-space: nowrap; pointer-events: none; font-variant-numeric: tabular-nums; }
button.cvp-time { background: none; border: 0; cursor: pointer; padding: .3rem .4rem; border-radius: 6px; font-family: inherit; }
button.cvp-time:hover { background: rgba(255, 255, 255, .12); }
.cvp-btn { position: relative; }
.cvp-btn.is-on { color: var(--accent); }
.cvp-gear { transition: transform .35s cubic-bezier(.2, .8, .2, 1); }
.cvp-gear.is-rotated { transform: rotate(60deg); }
.cvp-settings { position: relative; }
.cvp-quality-badge { position: absolute; top: 5px; right: 3px; font-size: .55rem; font-weight: 800; line-height: 1.3; padding: 0 .2rem; border-radius: 3px; background: var(--accent); color: #111; pointer-events: none; }
.cvp-menu { position: absolute; right: 0; bottom: calc(100% + 10px); z-index: 6; min-width: 240px; max-height: min(320px, 60vh); overflow-y: auto; padding: .35rem; border-radius: 12px; background: rgba(18, 20, 28, .97); border: 1px solid rgba(255, 255, 255, .1); box-shadow: 0 12px 30px rgba(0, 0, 0, .5); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); animation: cvp-menu-in .2s cubic-bezier(.2, .8, .2, 1); transform-origin: bottom right; }
@keyframes cvp-menu-in { from { opacity: 0; transform: translateY(6px) scale(.97); } to { opacity: 1; transform: none; } }
.cvp-menu-item, .cvp-menu-back { display: flex; align-items: center; gap: .5rem; width: 100%; padding: .55rem .6rem; border: 0; border-radius: 8px; background: transparent; color: #fff; font-size: .9rem; text-align: left; cursor: pointer; }
.cvp-menu-item:hover, .cvp-menu-back:hover { background: rgba(255, 255, 255, .1); }
.cvp-menu-back { font-weight: 700; margin-bottom: .2rem; border-bottom: 1px solid rgba(255, 255, 255, .08); border-radius: 8px 8px 0 0; }
.cvp-menu-value { margin-left: auto; color: var(--muted); font-size: .82rem; }
.cvp-check { display: inline-grid; place-items: center; width: 18px; color: var(--accent); }
.hd-badge { margin-left: .2rem; padding: 0 .25rem; border-radius: 3px; background: var(--accent); color: #111; font-size: .62rem; font-weight: 800; }
.cvp-help { position: absolute; inset: 0; z-index: 7; display: grid; place-items: center; padding: 1rem; background: rgba(0, 0, 0, .82); animation: cvp-menu-in .2s ease; }
.cvp-help-card { width: 100%; max-width: 440px; max-height: 100%; overflow-y: auto; padding: 1rem 1.25rem; border-radius: 12px; background: var(--surface); }
.cvp-help-card h3 { margin: 0 0 .6rem; }
.cvp-help-card dl { display: grid; grid-template-columns: auto 1fr; gap: .35rem 1rem; margin: 0 0 .9rem; font-size: .9rem; }
.cvp-help-row { display: contents; }
.cvp-help-card dd { margin: 0; color: #d6dae3; }
kbd { display: inline-block; padding: 0 .4rem; border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 4px; background: var(--surface-2); font-family: inherit; font-size: .8rem; white-space: nowrap; }
.cvp video::cue { background: rgba(0, 0, 0, .72); color: #fff; font-size: 1.05em; line-height: 1.4; }

/* ===== Episodes ===== */
.episodes { margin-top: 1.25rem; }
.modal-inner .episodes { padding: 0 1.25rem; }
.episodes-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: .75rem; }
.episodes-head h3 { margin: 0; font-size: 1.15rem; }
.episodes-head select { background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: .35rem .5rem; }
.episode-list { list-style: none; margin: 0; padding: 0 .25rem 0 0; display: grid; gap: .6rem; max-height: 440px; overflow-y: auto; }
.episode { display: grid; grid-template-columns: 160px 1fr; align-items: center; gap: .85rem; width: 100%; padding: .45rem; border-radius: 12px; border: 1px solid transparent; background: var(--surface); color: inherit; text-align: left; cursor: pointer; transition: border-color .2s, background .2s, transform .2s; }
.episode:hover { background: var(--surface-2); border-color: var(--border); transform: translateX(2px); }
.episode.is-active { border-color: var(--accent); }
.episode-thumb { position: relative; display: block; aspect-ratio: 16 / 9; border-radius: 8px; overflow: hidden; }
.episode-thumb .thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
.episode-thumb .thumb-fallback { font-size: 1.2rem; }
.now-playing { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(0, 0, 0, .55); color: var(--accent); font-size: .75rem; font-weight: 800; }
.episode-text { display: block; min-width: 0; }
.episode-num { display: block; font-size: .75rem; font-weight: 700; color: var(--accent); }
.episode-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin: .1rem 0; font-weight: 600; }
.episode-meta { display: block; font-size: .8rem; color: var(--muted); }
@media (max-width: 560px) { .episode { grid-template-columns: 112px 1fr; } }
`;

files["scripts/import-youtube.mjs"] = String.raw`
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
`;

files["scripts/refresh-popularity.mjs"] = String.raw`
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
`;

// ---- write files ----
for (const [path, content] of Object.entries(files)) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content.replace(/^\r?\n/, ""), "utf8");
  console.log("Wrote " + path);
}

// ---- load the new stylesheet from the root layout (only once) ----
const layoutPath = "src/app/layout.tsx";
let layout = readFileSync(layoutPath, "utf8");
if (layout.includes('import "./enhancements.css";')) {
  console.log("Layout already imports enhancements.css");
} else if (layout.includes('import "./globals.css";')) {
  layout = layout.replace('import "./globals.css";', 'import "./globals.css";\nimport "./enhancements.css";');
  writeFileSync(layoutPath, layout, "utf8");
  console.log("Added enhancements.css to " + layoutPath);
} else {
  console.warn('Could not find import "./globals.css" in layout.tsx. Add  import "./enhancements.css";  there manually.');
}

console.log("\nDone. Next:");
console.log("  node scripts/refresh-popularity.mjs     # fills Trending");
console.log("  npm run dev                             # restart the dev server, then hard-refresh (Ctrl+Shift+R)");
