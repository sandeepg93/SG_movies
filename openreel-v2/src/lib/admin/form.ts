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
