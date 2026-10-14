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
