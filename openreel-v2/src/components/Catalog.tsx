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
