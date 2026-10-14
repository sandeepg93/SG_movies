"use client";

import { useRef } from "react";
import type { Movie } from "@/types/movie";
import MovieCard from "@/components/MovieCard";
import Icon from "@/components/Icons";

interface Props {
  title: string;
  subtitle?: string;
  movies: Movie[];
  onPlay?: (movie: Movie) => void;
  onSeeAll?: () => void;
}

export default function RowCarousel({ title, subtitle, movies, onPlay, onSeeAll }: Props) {
  const listRef = useRef<HTMLUListElement>(null);

  function scroll(direction: 1 | -1) {
    const el = listRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: "smooth" });
  }

  return (
    <section className="row" aria-label={title}>
      <div className="row-head">
        <div>
          <h2 className="row-title">{title}</h2>
          {subtitle && <p className="row-subtitle">{subtitle}</p>}
        </div>
        <div className="row-actions">
          {onSeeAll && (
            <button type="button" className="link-button" onClick={onSeeAll}>See all</button>
          )}
          <button type="button" className="icon-btn" aria-label={"Scroll " + title + " left"} onClick={() => scroll(-1)}>
            <Icon name="chevronLeft" size={20} />
          </button>
          <button type="button" className="icon-btn" aria-label={"Scroll " + title + " right"} onClick={() => scroll(1)}>
            <Icon name="chevronRight" size={20} />
          </button>
        </div>
      </div>
      <ul ref={listRef} className="row-list">
        {movies.map((movie) => (
          <MovieCard key={movie.id} movie={movie} onPlay={onPlay} />
        ))}
      </ul>
    </section>
  );
}
