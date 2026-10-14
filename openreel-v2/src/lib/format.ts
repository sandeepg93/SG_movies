import type { Movie } from "@/types/movie";
import { formatShortRelease } from "@/lib/dates";

export function formatRuntime(minutes?: number): string {
  if (!minutes) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? h + "h " + m + "m" : m + "m";
}

const RIGHTS_BASIS_LABELS: Record<string, string> = {
  public_domain: "Public domain",
  creative_commons: "Creative Commons license",
  written_permission: "Written permission from the rights holder",
  license_agreement: "License agreement",
  platform_embed: "Official upload by the rights holder, shown with the platform's embedded player",
};

export function rightsBasisLabel(basis: string): string {
  return RIGHTS_BASIS_LABELS[basis] ?? basis;
}

export function movieMetaLine(movie: Movie): string {
  return [formatShortRelease(movie), formatRuntime(movie.runtimeMinutes), movie.languages.join(", ")]
    .filter(Boolean)
    .join(" · ");
}
