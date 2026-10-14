import type { Movie, PlaybackFields } from "@/types/movie";

/** Returns the film itself, or one of its episodes when ?episode=N is given. */
export function pickPlaybackItem(movie: Movie, episode: string | null): PlaybackFields | null {
  if (episode === null || episode === "") return movie;
  const index = Number(episode);
  if (!Number.isInteger(index) || index < 0) return null;
  const list = movie.episodes ?? [];
  return index < list.length ? list[index] : null;
}
