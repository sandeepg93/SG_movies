import type { Movie } from "@/types/movie";

export const MONTH_NAMES: readonly string[] = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const MONTH_SHORT: readonly string[] = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function getReleaseYear(movie: Movie): number | undefined {
  if (typeof movie.releaseYear === "number") return movie.releaseYear;
  if (movie.releaseDate) return Number(movie.releaseDate.slice(0, 4));
  return undefined;
}

/** Returns 1-12, or undefined when the month is unknown. */
export function getReleaseMonth(movie: Movie): number | undefined {
  if (!movie.releaseDate || movie.releaseDate.length < 7) return undefined;
  const month = Number(movie.releaseDate.slice(5, 7));
  return month >= 1 && month <= 12 ? month : undefined;
}

export function formatReleaseDate(movie: Movie): string {
  const year = getReleaseYear(movie);
  const month = getReleaseMonth(movie);
  if (year === undefined) return "";
  if (month === undefined) return String(year);
  if (movie.releaseDate && movie.releaseDate.length === 10) {
    return Number(movie.releaseDate.slice(8, 10)) + " " + MONTH_NAMES[month - 1] + " " + year;
  }
  return MONTH_NAMES[month - 1] + " " + year;
}

export function formatShortRelease(movie: Movie): string {
  const year = getReleaseYear(movie);
  const month = getReleaseMonth(movie);
  if (year === undefined) return "";
  return month === undefined ? String(year) : MONTH_SHORT[month - 1] + " " + year;
}
