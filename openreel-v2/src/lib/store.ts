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
