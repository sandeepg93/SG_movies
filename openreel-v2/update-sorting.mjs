// update-sorting.mjs — run inside the openreel-v2 folder:  node update-sorting.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";

if (!existsSync("src/lib/filter.ts") || !existsSync("src/components/Catalog.tsx")) {
  console.error("Run this inside the openreel-v2 folder (the one that contains src/ and scripts/).");
  process.exit(1);
}

const files = {};

files["src/lib/filter.ts"] = String.raw`
import type { Movie } from "@/types/movie";
import { MONTH_NAMES, getReleaseMonth, getReleaseYear } from "@/lib/dates";
import { INDUSTRIES, INDUSTRY_VALUES, industryLabel } from "@/lib/industries";

export type SortKey = "newest" | "oldest" | "title" | "shortest" | "longest";
export type GroupKey = "none" | "industry" | "category" | "decade" | "year" | "month";
export type ViewKey = "grid" | "list";

/** Category used for films that have no genres yet. */
export const NO_CATEGORY = "Other";

const SORT_KEYS: readonly SortKey[] = ["newest", "oldest", "title", "shortest", "longest"];
const GROUP_KEYS: readonly GroupKey[] = ["none", "industry", "category", "decade", "year", "month"];
const VIEW_KEYS: readonly ViewKey[] = ["grid", "list"];
const DEFAULT_SORT: SortKey = "newest";

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "newest", label: "Latest first" },
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

export function clearFilters(state: BrowseState): BrowseState {
  return { ...state, query: "", industry: "", genre: "", language: "", decade: "", year: "", month: "", maxRuntime: "" };
}

export function hasActiveFilters(state: BrowseState): boolean {
  return (
    state.query !== "" || state.industry !== "" || state.genre !== "" || state.language !== "" ||
    state.decade !== "" || state.year !== "" || state.month !== "" || state.maxRuntime !== ""
  );
}

export function decadeOf(year: number): number {
  return Math.floor(year / 10) * 10;
}

export function movieCategories(movie: Movie): string[] {
  return movie.genres.length > 0 ? movie.genres : [NO_CATEGORY];
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
        industryLabel(movie.industry),
        ...movieCategories(movie),
        ...movie.languages,
        year !== undefined ? String(year) : "",
        month !== undefined ? MONTH_NAMES[month - 1] : "",
      ]
        .join(" ")
        .toLowerCase();
      if (!terms.every((term) => haystack.includes(term))) return false;
    }
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
    if (sort === "newest") result = compareOptional(releaseKey(a), releaseKey(b), -1);
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
  if (group === "none") return [{ key: "all", label: "All films", movies }];

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
  return {
    query: p.get("q") ?? "",
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

files["src/components/Catalog.tsx"] = String.raw`
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Movie } from "@/types/movie";
import Hero from "@/components/Hero";
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

function countLabel(count: number): string {
  return count + (count === 1 ? " film" : " films");
}

export default function Catalog({ movies, initialSearch }: Props) {
  const [state, setState] = useState<BrowseState>(() => stateFromSearch(initialSearch));
  const [playingSlug, setPlayingSlug] = useState<string | null>(() => new URLSearchParams(initialSearch).get("play"));
  const [limit, setLimit] = useState(PAGE_SIZE);
  const browseRef = useRef<HTMLElement>(null);

  // Keep the address bar in sync so any view (and the open film) can be bookmarked or shared.
  useEffect(() => {
    const params = new URLSearchParams(stateToSearch(state));
    if (playingSlug) params.set("play", playingSlug);
    const query = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (query ? "?" + query : ""));
  }, [state, playingSlug]);

  const newestFirst = useMemo(() => sortMovies(movies, "newest"), [movies]);
  const industryCounts = useMemo(() => buildIndustryCounts(movies), [movies]);
  const scoped = useMemo(
    () => (state.industry ? movies.filter((m) => m.industry === state.industry) : movies),
    [movies, state.industry],
  );
  const facets = useMemo(() => buildFacets(scoped), [scoped]);
  const results = useMemo(() => sortMovies(filterMovies(movies, state), state.sort), [movies, state]);
  const groups = useMemo(() => groupMovies(results, state.group, state.sort), [results, state.group, state.sort]);

  const featured = useMemo(() => {
    const picks = newestFirst.filter((m) => m.featured);
    return (picks.length > 0 ? picks : newestFirst).slice(0, 5);
  }, [newestFirst]);

  const homeRows = useMemo<HomeRow[]>(() => {
    const rows: HomeRow[] = [];

    rows.push({
      key: "latest",
      title: "Latest releases",
      subtitle: "Newest films first, across every industry",
      list: newestFirst.slice(0, ROW_LIMIT),
      seeAll: {},
    });

    for (const info of INDUSTRIES) {
      const list = newestFirst.filter((m) => m.industry === info.value);
      if (list.length === 0) continue;
      rows.push({
        key: "industry-" + info.value,
        title: info.label,
        subtitle: info.tagline + " · " + countLabel(list.length),
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
        title: category === NO_CATEGORY ? "Other films" : category,
        subtitle: countLabel(list.length),
        list: list.slice(0, ROW_LIMIT),
        seeAll: { genre: category },
      });
    }
    return rows;
  }, [movies, newestFirst]);

  const playing = playingSlug ? movies.find((m) => m.slug === playingSlug) ?? null : null;
  const related = useMemo(
    () => (playing ? newestFirst.filter((m) => m.id !== playing.id && m.industry === playing.industry).slice(0, 12) : []),
    [newestFirst, playing],
  );

  const filtersActive = hasActiveFilters(state);
  const showcase = !filtersActive;
  const industryEmpty = state.industry !== "" && scoped.length === 0;

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
    change({ ...patch, sort: "newest", group: "none" });
    window.setTimeout(() => browseRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function renderMovies(list: Movie[]) {
    return state.view === "list" ? (
      <MovieList movies={list} onPlay={openPlayer} />
    ) : (
      <MovieGrid movies={list} onPlay={openPlayer} />
    );
  }

  return (
    <>
      {showcase && <Hero movies={featured} onPlay={openPlayer} />}
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
        <h2 id="browse-heading" className="browse-title">
          {state.industry ? industryLabel(state.industry) + " films" : "Browse all films"}
        </h2>

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
            <strong>{results.length}</strong> {results.length === 1 ? "film" : "films"}
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
            <p>
              {industryEmpty
                ? "No " + industryLabel(state.industry) + " films have been added yet."
                : "No films match. Try fewer words or remove a filter."}
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

for (const [path, content] of Object.entries(files)) {
  writeFileSync(path, content.replace(/^\r?\n/, ""), "utf8");
  console.log("Updated " + path);
}

// ---- Catalog summary, to explain what will appear on the site ----
const catalog = JSON.parse(readFileSync("src/data/movies.json", "utf8"));
const byIndustry = {};
let approved = 0;
let pending = 0;
let noYear = 0;
let noCategory = 0;
for (const m of catalog) {
  byIndustry[m.industry] = (byIndustry[m.industry] || 0) + 1;
  if (m.rightsStatus === "approved") approved++;
  if (m.rightsStatus === "pending_review") pending++;
  if (!m.releaseYear && !m.releaseDate) noYear++;
  if (!Array.isArray(m.genres) || m.genres.length === 0) noCategory++;
}
console.log("\nCatalog: " + catalog.length + " films (" + approved + " approved, " + pending + " pending review)");
for (const name of ["hollywood", "bollywood", "marathi", "tollywood"]) {
  console.log("  " + name.padEnd(10) + (byIndustry[name] || 0));
}
console.log("  Films without a release year (shown last): " + noYear);
console.log("  Films without a category (shown under Other): " + noCategory);
console.log("\nNote: in development, pending films are shown. In production only approved films appear.");
console.log("Restart the dev server (Ctrl+C, then npm run dev) and hard-refresh the browser.");
