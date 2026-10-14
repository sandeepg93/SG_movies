"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { ActionState, ImportSource, RawRecord } from "@/types/admin";
import type { ContentType, Industry } from "@/types/movie";
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
