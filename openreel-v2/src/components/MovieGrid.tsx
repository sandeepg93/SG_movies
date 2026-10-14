import type { Movie } from "@/types/movie";
import MovieCard from "@/components/MovieCard";

export default function MovieGrid({ movies, onPlay }: { movies: Movie[]; onPlay?: (movie: Movie) => void }) {
  return (
    <ul className="movie-grid">
      {movies.map((movie) => (
        <MovieCard key={movie.id} movie={movie} onPlay={onPlay} />
      ))}
    </ul>
  );
}
