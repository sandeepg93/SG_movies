"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Link from "next/link";
import type { Movie } from "@/types/movie";
import Icon from "@/components/Icons";
import Thumb from "@/components/Thumb";
import { thumbnailFor } from "@/lib/media";
import { industryLabel } from "@/lib/industries";
import { movieMetaLine } from "@/lib/format";

export interface HeroCollection {
  key: string;
  label: string;
  items: Movie[];
}

const SLIDE_MS = 7000;

export default function Hero({ collections, onPlay }: { collections: HeroCollection[]; onPlay: (movie: Movie) => void }) {
  const available = collections.filter((c) => c.items.length > 0);
  const [tabIndex, setTabIndex] = useState(0);
  const [slide, setSlide] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [paused, setPaused] = useState(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  const tab = available.length > 0 ? available[Math.min(tabIndex, available.length - 1)] : null;
  const items = tab ? tab.items : [];
  const count = items.length;
  const active = count > 0 ? slide % count : 0;

  // Keep the active thumbnail centred in the rail.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const el = rail.children[active] as HTMLElement | undefined;
    if (el) rail.scrollTo({ left: el.offsetLeft - rail.clientWidth / 2 + el.clientWidth / 2, behavior: "smooth" });
  }, [active, tabIndex]);

  if (!tab || count === 0) return null;
  const movie = items[active];
  const isShow = movie.contentType === "show";

  function go(target: number, dir: 1 | -1) {
    setDirection(dir);
    setSlide(((target % count) + count) % count);
  }
  function next() {
    go(active + 1, 1);
  }
  function prev() {
    go(active - 1, -1);
  }
  function selectTab(index: number) {
    setTabIndex(index);
    setSlide(0);
    setDirection(1);
  }
  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      next();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      prev();
    }
  }
  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    pointerStart.current = { x: event.clientX, y: event.clientY };
  }
  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) next();
      else prev();
    }
  }

  return (
    <section
      className="showcase"
      aria-roledescription="carousel"
      aria-label="Featured films and shows"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") setPaused(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setPaused(false);
      }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      style={{ "--slide-ms": SLIDE_MS + "ms" } as CSSProperties}
    >
      <div className="showcase-slides" aria-hidden="true">
        {items.map((m, i) => {
          const src = thumbnailFor(m);
          const near = Math.abs(i - active) <= 1 || (active === 0 && i === count - 1) || (active === count - 1 && i === 0);
          return (
            <div key={tab.key + "-" + m.id} className={"showcase-slide" + (i === active ? " is-active" : "")}>
              {src && near ? <img src={src} alt="" referrerPolicy="no-referrer" decoding="async" /> : null}
            </div>
          );
        })}
      </div>
      <div className="showcase-shade" />

      <div className="showcase-tabs" role="tablist" aria-label="Collections">
        {available.map((c, i) => (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={c.key === tab.key}
            className="showcase-tab"
            onClick={() => selectTab(i)}
          >
            {c.key === "trending" && <Icon name="fire" size={16} />}
            {c.label}
          </button>
        ))}
      </div>

      {count > 1 && (
        <div className="showcase-arrows">
          <button type="button" className="icon-btn" aria-label="Previous" onClick={prev}>
            <Icon name="chevronLeft" size={20} />
          </button>
          <button type="button" className="icon-btn" aria-label="Next" onClick={next}>
            <Icon name="chevronRight" size={20} />
          </button>
        </div>
      )}

      <div key={tab.key + "-" + movie.id} className={"showcase-content" + (direction === -1 ? " from-left" : "")}>
        <div className="showcase-badges">
          {tab.key === "trending" && (
            <span className="pill pill-accent">
              <Icon name="fire" size={14} /> {"#" + (active + 1) + " Trending"}
            </span>
          )}
          {tab.key === "latest" && <span className="pill pill-accent">New</span>}
          <span className="pill">{industryLabel(movie.industry)}</span>
          {isShow && <span className="pill">{"Series · " + (movie.episodes?.length ?? 0) + " episodes"}</span>}
        </div>
        <h2 className="showcase-title">{movie.title}</h2>
        <p className="showcase-meta">{movieMetaLine(movie)}</p>
        <p className="showcase-desc">{movie.description}</p>
        <div className="showcase-actions">
          <button type="button" className="btn btn-primary btn-lg" onClick={() => onPlay(movie)}>
            <Icon name="play" /> {isShow ? "Play episode 1" : "Play"}
          </button>
          <Link href={"/movies/" + movie.slug} className="btn btn-lg btn-glass">
            <Icon name="info" /> More info
          </Link>
        </div>
      </div>

      {count > 1 && (
        <div className="showcase-rail" ref={railRef} role="tablist" aria-label="Choose a title">
          {items.map((m, i) => (
            <button
              key={tab.key + "-rail-" + m.id}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={m.title}
              className={"rail-item" + (i === active ? " is-active" : "")}
              onClick={() => go(i, i >= active ? 1 : -1)}
            >
              <Thumb src={thumbnailFor(m)} alt={m.title} />
            </button>
          ))}
        </div>
      )}

      {count > 1 && (
        <div className="showcase-dots">
          {items.map((m, i) => (
            <button
              key={tab.key + "-dot-" + m.id}
              type="button"
              aria-label={"Show " + m.title}
              className={"showcase-dot" + (i === active ? " is-active" : "")}
              onClick={() => go(i, i >= active ? 1 : -1)}
            />
          ))}
        </div>
      )}

      {count > 1 && (
        <span
          key={tab.key + "-progress-" + active}
          className={"showcase-progress" + (paused ? " is-paused" : "")}
          onAnimationEnd={next}
          aria-hidden="true"
        />
      )}
    </section>
  );
}
