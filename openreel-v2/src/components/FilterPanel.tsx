"use client";

import type { BrowseState, Facets } from "@/lib/filter";
import { RUNTIME_OPTIONS, decadeOf } from "@/lib/filter";

interface Props {
  state: BrowseState;
  facets: Facets;
  onChange: (patch: Partial<BrowseState>) => void;
}

export default function FilterPanel({ state, facets, onChange }: Props) {
  const years = state.decade
    ? facets.years.filter((f) => String(decadeOf(Number(f.value))) === state.decade)
    : facets.years;

  return (
    <form className="filters" role="search" aria-label="Search and filter films" onSubmit={(e) => e.preventDefault()}>
      <label className="field field-search">
        <span>Search</span>
        <input
          type="search"
          value={state.query}
          placeholder="Title, actor, director, category, year or month…"
          onChange={(e) => onChange({ query: e.target.value })}
        />
      </label>

      <label className="field">
        <span>Category</span>
        <select value={state.genre} onChange={(e) => onChange({ genre: e.target.value })}>
          <option value="">All categories</option>
          {facets.genres.map((f) => (
            <option key={f.value} value={f.value}>{f.label + " (" + f.count + ")"}</option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Language</span>
        <select value={state.language} onChange={(e) => onChange({ language: e.target.value })}>
          <option value="">All languages</option>
          {facets.languages.map((f) => (
            <option key={f.value} value={f.value}>{f.label + " (" + f.count + ")"}</option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Decade</span>
        <select value={state.decade} onChange={(e) => onChange({ decade: e.target.value, year: "" })}>
          <option value="">Any decade</option>
          {facets.decades.map((f) => (
            <option key={f.value} value={f.value}>{f.label + " (" + f.count + ")"}</option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Year</span>
        <select value={state.year} onChange={(e) => onChange({ year: e.target.value, decade: "" })}>
          <option value="">Any year</option>
          {years.map((f) => (
            <option key={f.value} value={f.value}>{f.label + " (" + f.count + ")"}</option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Month</span>
        <select value={state.month} onChange={(e) => onChange({ month: e.target.value })}>
          <option value="">Any month</option>
          {facets.months.map((f) => (
            <option key={f.value} value={f.value}>{f.label + " (" + f.count + ")"}</option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Runtime</span>
        <select value={state.maxRuntime} onChange={(e) => onChange({ maxRuntime: e.target.value })}>
          <option value="">Any length</option>
          {RUNTIME_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
    </form>
  );
}
