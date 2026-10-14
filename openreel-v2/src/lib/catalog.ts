import type { Movie } from "@/types/movie";
import { loadCatalog } from "@/lib/store";

const previewPending =
  process.env.NODE_ENV !== "production" && process.env.PREVIEW_PENDING === "true";

export function isPreviewMode(): boolean {
  return previewPending;
}

/** The single gate to the public site: only valid, approved titles (plus pending ones in local preview). */
export function getPublicMovies(): Movie[] {
  return loadCatalog()
    .valid.filter(
      (movie) =>
        movie.rightsStatus === "approved" ||
        (previewPending && movie.rightsStatus === "pending_review"),
    )
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function getMovieBySlug(slug: string): Movie | undefined {
  return getPublicMovies().find((movie) => movie.slug === slug);
}

export function getFeaturedMovies(limit = 6): Movie[] {
  return getPublicMovies().filter((movie) => movie.featured).slice(0, limit);
}

export function getRelatedMovies(movie: Movie, limit = 12): Movie[] {
  return getPublicMovies()
    .filter((other) => other.id !== movie.id)
    .map((other) => ({
      other,
      score: (other.industry === movie.industry ? 2 : 0) + other.genres.filter((g) => movie.genres.includes(g)).length,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.other);
}
