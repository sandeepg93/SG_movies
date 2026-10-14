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
