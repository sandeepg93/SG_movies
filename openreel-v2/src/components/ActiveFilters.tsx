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
