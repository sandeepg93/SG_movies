"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Icon from "@/components/Icons";
import type { CaptionTrack, VideoSource } from "@/types/playback";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const QUALITY_KEY = "openreel:quality";
const SHORTCUTS: [string, string][] = [
  ["Space / K", "Play / pause"],
  ["← / →", "Back / forward 5 seconds"],
  ["J / L", "Back / forward 10 seconds"],
  ["↑ / ↓", "Volume up / down"],
  ["M", "Mute / unmute"],
  ["F", "Fullscreen"],
  ["C", "Subtitles on / off"],
  ["< / >", "Slower / faster"],
  ["0 – 9", "Jump to 0% – 90%"],
  ["?", "Show this help"],
];

type Menu = "main" | "quality" | "speed" | "captions";
type QualityState = { index: number; mode: "auto" | "manual" };
type WebkitVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };
type NetworkInfo = { effectiveType?: string; saveData?: boolean };

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const ss = s < 10 ? "0" + s : String(s);
  if (h > 0) return h + ":" + (m < 10 ? "0" + m : String(m)) + ":" + ss;
  return m + ":" + ss;
}

function rankHeight(source: VideoSource): number {
  if (source.height) return source.height;
  if (source.bitrate) return source.bitrate >= 2000 ? 720 : source.bitrate >= 900 ? 480 : 360;
  return 480;
}

/** Picks a quality that suits the screen size and network connection. */
function pickAutoIndex(sources: VideoSource[]): number {
  if (sources.length <= 1) return 0;
  let target = 720;
  try {
    const px = window.innerWidth * (window.devicePixelRatio || 1);
    target = px >= 1800 ? 1080 : px >= 1000 ? 720 : 480;
    const connection = (navigator as Navigator & { connection?: NetworkInfo }).connection;
    if (connection && (connection.saveData || connection.effectiveType === "2g" || connection.effectiveType === "slow-2g")) {
      target = 240;
    } else if (connection && connection.effectiveType === "3g") {
      target = Math.min(target, 480);
    }
  } catch {
    // keep default target
  }
  const index = sources.findIndex((s) => rankHeight(s) <= target);
  return index === -1 ? sources.length - 1 : index;
}

function initialQuality(sources: VideoSource[]): QualityState {
  try {
    const saved = window.localStorage.getItem(QUALITY_KEY);
    if (saved) {
      const index = sources.findIndex((s) => s.label === saved);
      if (index >= 0) return { index, mode: "manual" };
    }
  } catch {
    // storage unavailable
  }
  return { index: pickAutoIndex(sources), mode: "auto" };
}

function speedLabel(value: number): string {
  return value === 1 ? "Normal" : value + "×";
}

function bitrateLabel(kbps: number): string {
  return kbps >= 1000 ? (kbps / 1000).toFixed(1) + " Mbps" : kbps + " kbps";
}

interface Props {
  sources: VideoSource[];
  captions: CaptionTrack[];
  poster: string | null;
  title: string;
  autoPlay?: boolean;
  storageKey: string;
  onEnded?: () => void;
}

export default function CustomVideoPlayer({ sources, captions, poster, title, autoPlay = false, storageKey, onEnded }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const toastTimer = useRef<number | undefined>(undefined);
  const tapTimer = useRef<number | undefined>(undefined);
  const lastTap = useRef(0);
  const pointerType = useRef("mouse");
  const lastSaved = useRef(0);
  const resumeAt = useRef<number | null>(null);
  const resumePlaying = useRef(false);
  const firstLoadDone = useRef(false);
  const seeking = useRef(false);
  const stalls = useRef<number[]>([]);

  const [quality, setQuality] = useState<QualityState>(() => initialQuality(sources));
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [waiting, setWaiting] = useState(true);
  const [error, setError] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [captionIndex, setCaptionIndex] = useState(-1);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [hover, setHover] = useState<{ left: number; time: number } | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [showRemaining, setShowRemaining] = useState(false);

  const sourceIndex = Math.min(Math.max(quality.index, 0), sources.length - 1);
  const source = sources[sourceIndex];

  useEffect(() => {
    setPipSupported("pictureInPictureEnabled" in document && document.pictureInPictureEnabled);
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.clearTimeout(hideTimer.current);
      window.clearTimeout(toastTimer.current);
      window.clearTimeout(tapTimer.current);
    };
  }, []);

  // Close the settings menu when clicking anywhere else.
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menu]);

  // Show the selected subtitle track and hide the others.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    for (let i = 0; i < v.textTracks.length; i++) {
      v.textTracks[i].mode = i === captionIndex ? "showing" : "disabled";
    }
  }, [captionIndex, sourceIndex, captions.length]);

  function showToast(text: string) {
    setToast({ id: Date.now(), text });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1000);
  }

  function revealControls() {
    setControlsVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setControlsVisible(false);
    }, 2800);
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) v.play().catch(() => setPlaying(false));
    else v.pause();
  }

  function seekTo(time: number) {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration)) return;
    v.currentTime = Math.min(Math.max(time, 0), v.duration);
  }

  function seekBy(delta: number) {
    const v = videoRef.current;
    if (v) seekTo(v.currentTime + delta);
  }

  function changeVolume(value: number) {
    const v = videoRef.current;
    if (!v) return;
    v.volume = Math.min(1, Math.max(0, value));
    v.muted = v.volume === 0;
  }

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    if (v.muted && v.volume === 0) v.volume = 0.5;
    v.muted = !v.muted;
    showToast(v.muted ? "Muted" : "Sound on");
  }

  function changeSpeed(value: number) {
    const v = videoRef.current;
    if (v) v.playbackRate = value;
    setSpeed(value);
    showToast("Speed: " + speedLabel(value));
  }

  function stepSpeed(direction: 1 | -1) {
    const index = SPEEDS.indexOf(speed);
    const nextIndex = Math.min(SPEEDS.length - 1, Math.max(0, (index === -1 ? 3 : index) + direction));
    changeSpeed(SPEEDS[nextIndex]);
  }

  function toggleFullscreen() {
    const wrap = wrapRef.current;
    const v = videoRef.current as WebkitVideo | null;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (wrap && typeof wrap.requestFullscreen === "function") {
      wrap.requestFullscreen().catch(() => undefined);
      return;
    }
    if (v && typeof v.webkitEnterFullscreen === "function") v.webkitEnterFullscreen();
  }

  function togglePip() {
    const v = videoRef.current;
    if (!v) return;
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => undefined);
    else v.requestPictureInPicture().catch(() => undefined);
  }

  function switchSource(index: number, mode: "auto" | "manual") {
    const v = videoRef.current;
    if (v && index !== sourceIndex) {
      resumeAt.current = v.currentTime;
      resumePlaying.current = !v.paused;
      setWaiting(true);
    }
    setQuality({ index, mode });
  }

  function chooseQuality(choice: number | "auto") {
    if (choice === "auto") {
      try {
        window.localStorage.removeItem(QUALITY_KEY);
      } catch {
        // storage unavailable
      }
      const index = pickAutoIndex(sources);
      switchSource(index, "auto");
      showToast("Quality: Auto (" + sources[index].label + ")");
    } else {
      try {
        window.localStorage.setItem(QUALITY_KEY, sources[choice].label);
      } catch {
        // storage unavailable
      }
      switchSource(choice, "manual");
      showToast("Quality: " + sources[choice].label);
    }
    setMenu(null);
  }

  function chooseCaption(index: number) {
    setCaptionIndex(index);
    setMenu(null);
    showToast(index === -1 ? "Subtitles off" : "Subtitles: " + captions[index].label);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "SELECT") return;
    if (target.tagName === "BUTTON" && (event.key === " " || event.key === "Enter")) return;
    const v = videoRef.current;
    if (!v) return;
    let handled = true;
    switch (event.key) {
      case " ":
      case "k":
      case "K":
        togglePlay();
        break;
      case "ArrowLeft":
        seekBy(-5);
        showToast("−5s");
        break;
      case "ArrowRight":
        seekBy(5);
        showToast("+5s");
        break;
      case "j":
      case "J":
        seekBy(-10);
        showToast("−10s");
        break;
      case "l":
      case "L":
        seekBy(10);
        showToast("+10s");
        break;
      case "ArrowUp":
        changeVolume(v.volume + 0.1);
        showToast("Volume " + Math.round(Math.min(1, v.volume) * 100) + "%");
        break;
      case "ArrowDown":
        changeVolume(v.volume - 0.1);
        showToast("Volume " + Math.round(Math.max(0, v.volume) * 100) + "%");
        break;
      case "m":
      case "M":
        toggleMute();
        break;
      case "f":
      case "F":
        toggleFullscreen();
        break;
      case "c":
      case "C":
        if (captions.length > 0) chooseCaption(captionIndex === -1 ? 0 : -1);
        else handled = false;
        break;
      case "<":
        stepSpeed(-1);
        break;
      case ">":
        stepSpeed(1);
        break;
      case "?":
        setHelpOpen((open) => !open);
        break;
      case "Escape":
        if (menu || helpOpen) {
          setMenu(null);
          setHelpOpen(false);
        } else {
          handled = false;
        }
        break;
      case "Home":
        seekTo(0);
        break;
      case "End":
        seekTo(v.duration);
        break;
      default:
        if (/^[0-9]$/.test(event.key) && Number.isFinite(v.duration)) seekTo((v.duration * Number(event.key)) / 10);
        else handled = false;
    }
    if (handled) {
      event.preventDefault();
      revealControls();
    }
  }

  function handleVideoClick() {
    if (pointerType.current !== "mouse") return;
    if (menu) {
      setMenu(null);
      return;
    }
    togglePlay();
  }

  // Touch: single tap shows/hides controls; double tap left/right skips 10 s; double tap centre plays/pauses.
  function handleVideoPointerUp(event: ReactPointerEvent<HTMLVideoElement>) {
    if (event.pointerType === "mouse") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const now = Date.now();
    if (now - lastTap.current < 300) {
      window.clearTimeout(tapTimer.current);
      lastTap.current = 0;
      if (x < 0.4) {
        seekBy(-10);
        showToast("−10s");
      } else if (x > 0.6) {
        seekBy(10);
        showToast("+10s");
      } else {
        togglePlay();
      }
      return;
    }
    lastTap.current = now;
    tapTimer.current = window.setTimeout(() => {
      lastTap.current = 0;
      setControlsVisible((visible) => !visible);
    }, 300);
  }

  function handleSeekHover(event: ReactMouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHover({ left: ratio * 100, time: ratio * duration });
  }

  const progress = duration > 0 ? (current / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;
  const shownVolume = muted ? 0 : volume;
  const showControls = controlsVisible || !playing || menu !== null;
  const qualitySummary = quality.mode === "auto" ? "Auto (" + source.label + ")" : source.label;

  return (
    <div
      ref={wrapRef}
      className={"cvp" + (showControls ? " cvp-show" : "") + (fullscreen ? " cvp-fullscreen" : "")}
      tabIndex={0}
      role="region"
      aria-label={"Video player: " + title}
      onKeyDown={handleKeyDown}
      onMouseMove={revealControls}
      onMouseLeave={() => {
        if (playing && !menu) setControlsVisible(false);
      }}
    >
      <video
        ref={videoRef}
        src={source.url}
        poster={poster ?? undefined}
        playsInline
        preload="metadata"
        onPointerDown={(e) => {
          pointerType.current = e.pointerType;
        }}
        onPointerUp={handleVideoPointerUp}
        onClick={handleVideoClick}
        onDoubleClick={() => {
          if (pointerType.current === "mouse") toggleFullscreen();
        }}
        onPlay={() => {
          setPlaying(true);
          revealControls();
        }}
        onPause={() => {
          setPlaying(false);
          setControlsVisible(true);
        }}
        onWaiting={() => {
          setWaiting(true);
          const v = videoRef.current;
          if (!v || seeking.current || v.currentTime < 2 || quality.mode !== "auto") return;
          const now = Date.now();
          stalls.current = stalls.current.filter((t) => now - t < 30000).concat(now);
          if (stalls.current.length >= 3 && sourceIndex < sources.length - 1) {
            stalls.current = [];
            switchSource(sourceIndex + 1, "auto");
            showToast("Switched to " + sources[sourceIndex + 1].label + " for smoother playback");
          }
        }}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onSeeking={() => {
          seeking.current = true;
        }}
        onSeeked={() => {
          seeking.current = false;
        }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          setCurrent(v.currentTime);
          if (Math.abs(v.currentTime - lastSaved.current) > 5) {
            lastSaved.current = v.currentTime;
            try {
              window.localStorage.setItem(storageKey, String(Math.floor(v.currentTime)));
            } catch {
              // storage unavailable
            }
          }
        }}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          setDuration(Number.isFinite(v.duration) ? v.duration : 0);
          setWaiting(false);
          v.playbackRate = speed;
          if (resumeAt.current !== null) {
            v.currentTime = resumeAt.current;
            const shouldPlay = resumePlaying.current;
            resumeAt.current = null;
            if (shouldPlay) v.play().catch(() => setPlaying(false));
            return;
          }
          if (!firstLoadDone.current) {
            firstLoadDone.current = true;
            try {
              const saved = Number(window.localStorage.getItem(storageKey));
              if (saved > 30 && Number.isFinite(v.duration) && saved < v.duration - 60) {
                v.currentTime = saved;
                showToast("Resumed from " + formatTime(saved));
              }
            } catch {
              // storage unavailable
            }
            if (autoPlay) v.play().catch(() => setPlaying(false));
          }
        }}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          setDuration(Number.isFinite(d) ? d : 0);
        }}
        onProgress={(e) => {
          const v = e.currentTarget;
          if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1));
        }}
        onVolumeChange={(e) => {
          setVolume(e.currentTarget.volume);
          setMuted(e.currentTarget.muted);
        }}
        onRateChange={(e) => setSpeed(e.currentTarget.playbackRate)}
        onEnded={() => {
          try {
            window.localStorage.removeItem(storageKey);
          } catch {
            // storage unavailable
          }
          if (onEnded) {
            showToast("Playing next episode…");
            window.setTimeout(onEnded, 900);
          }
        }}
        onError={() => {
          if (sourceIndex < sources.length - 1) {
            switchSource(sourceIndex + 1, quality.mode);
            showToast("Trying " + sources[sourceIndex + 1].label + "…");
          } else {
            setWaiting(false);
            setError(true);
          }
        }}
      >
        {captions.map((track) => (
          <track key={track.src} kind="subtitles" src={track.src} srcLang={track.lang} label={track.label} />
        ))}
      </video>

      {waiting && !error && <span className="cvp-spinner" aria-hidden="true" />}

      {!playing && !waiting && !error && (
        <button type="button" className="cvp-big-play" aria-label="Play" onClick={togglePlay}>
          <Icon name="play" size={40} />
        </button>
      )}

      {toast && (
        <div key={toast.id} className="cvp-toast" role="status">{toast.text}</div>
      )}

      {error && (
        <div className="cvp-error" role="alert">This video couldn&apos;t be loaded. Please try again later.</div>
      )}

      {helpOpen && (
        <div className="cvp-help" role="dialog" aria-label="Keyboard shortcuts" onClick={() => setHelpOpen(false)}>
          <div className="cvp-help-card" onClick={(e) => e.stopPropagation()}>
            <h3>Keyboard shortcuts</h3>
            <dl>
              {SHORTCUTS.map(([keys, action]) => (
                <div key={keys} className="cvp-help-row">
                  <dt><kbd>{keys}</kbd></dt>
                  <dd>{action}</dd>
                </div>
              ))}
            </dl>
            <button type="button" className="btn" onClick={() => setHelpOpen(false)}>Close</button>
          </div>
        </div>
      )}

      <div className="cvp-controls">
        <div className="cvp-seek-wrap" onMouseMove={handleSeekHover} onMouseLeave={() => setHover(null)}>
          {hover && duration > 0 && (
            <span className="cvp-tooltip" style={{ left: hover.left + "%" }}>{formatTime(hover.time)}</span>
          )}
          <input
            type="range"
            className="cvp-range cvp-seek"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(current, duration || 0)}
            onChange={(e) => seekTo(Number(e.target.value))}
            aria-label="Seek"
            aria-valuetext={formatTime(current) + " of " + formatTime(duration)}
            style={{ "--progress": progress + "%", "--buffered": bufferedPct + "%" } as CSSProperties}
          />
        </div>

        <div className="cvp-bar">
          <div className="cvp-group">
            <button type="button" className="cvp-btn" onClick={togglePlay} aria-label={playing ? "Pause (k)" : "Play (k)"}>
              <Icon name={playing ? "pause" : "play"} />
            </button>
            <button type="button" className="cvp-btn" onClick={() => seekBy(-10)} aria-label="Back 10 seconds (j)">
              <Icon name="rewind" />
            </button>
            <button type="button" className="cvp-btn" onClick={() => seekBy(10)} aria-label="Forward 10 seconds (l)">
              <Icon name="forward" />
            </button>
            <div className="cvp-volume">
              <button type="button" className="cvp-btn" onClick={toggleMute} aria-label={muted ? "Unmute (m)" : "Mute (m)"}>
                <Icon name={shownVolume === 0 ? "mute" : "volume"} />
              </button>
              <input
                type="range"
                className="cvp-range cvp-volume-range"
                min={0}
                max={1}
                step={0.05}
                value={shownVolume}
                onChange={(e) => changeVolume(Number(e.target.value))}
                aria-label="Volume"
                style={{ "--progress": shownVolume * 100 + "%" } as CSSProperties}
              />
            </div>
            <button
              type="button"
              className="cvp-time"
              onClick={() => setShowRemaining((r) => !r)}
              aria-label="Toggle elapsed or remaining time"
            >
              {(showRemaining ? "−" + formatTime(duration - current) : formatTime(current)) + " / " + formatTime(duration)}
            </button>
          </div>

          <div className="cvp-group">
            {captions.length > 0 && (
              <button
                type="button"
                className={"cvp-btn" + (captionIndex >= 0 ? " is-on" : "")}
                onClick={() => chooseCaption(captionIndex >= 0 ? -1 : 0)}
                aria-label="Subtitles (c)"
                aria-pressed={captionIndex >= 0}
              >
                <Icon name="captions" />
              </button>
            )}

            <div className="cvp-settings" ref={settingsRef}>
              <button
                type="button"
                className="cvp-btn"
                aria-label="Settings: quality, speed, subtitles"
                aria-haspopup="menu"
                aria-expanded={menu !== null}
                onClick={() => setMenu((m) => (m ? null : "main"))}
              >
                <Icon name="settings" className={"cvp-gear" + (menu ? " is-rotated" : "")} />
                {source.height !== undefined && source.height >= 720 && <span className="cvp-quality-badge">HD</span>}
              </button>

              {menu && (
                <div className="cvp-menu" role="menu" key={menu}>
                  {menu === "main" && (
                    <>
                      <button type="button" role="menuitem" className="cvp-menu-item" onClick={() => setMenu("quality")}>
                        <span>Quality</span>
                        <span className="cvp-menu-value">{qualitySummary}</span>
                        <Icon name="chevronRight" size={18} />
                      </button>
                      <button type="button" role="menuitem" className="cvp-menu-item" onClick={() => setMenu("speed")}>
                        <span>Playback speed</span>
                        <span className="cvp-menu-value">{speedLabel(speed)}</span>
                        <Icon name="chevronRight" size={18} />
                      </button>
                      {captions.length > 0 && (
                        <button type="button" role="menuitem" className="cvp-menu-item" onClick={() => setMenu("captions")}>
                          <span>Subtitles</span>
                          <span className="cvp-menu-value">{captionIndex >= 0 ? captions[captionIndex].label : "Off"}</span>
                          <Icon name="chevronRight" size={18} />
                        </button>
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        className="cvp-menu-item"
                        onClick={() => {
                          setMenu(null);
                          setHelpOpen(true);
                        }}
                      >
                        <span>Keyboard shortcuts</span>
                        <span className="cvp-menu-value">?</span>
                      </button>
                    </>
                  )}

                  {menu === "quality" && (
                    <>
                      <button type="button" className="cvp-menu-back" onClick={() => setMenu("main")}>
                        <Icon name="chevronLeft" size={18} /> Quality
                      </button>
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={quality.mode === "auto"}
                        className="cvp-menu-item"
                        onClick={() => chooseQuality("auto")}
                      >
                        <span className="cvp-check">{quality.mode === "auto" && <Icon name="check" size={16} />}</span>
                        <span>Auto</span>
                        {quality.mode === "auto" && <span className="cvp-menu-value">{source.label}</span>}
                      </button>
                      {sources.map((s, i) => (
                        <button
                          key={s.url}
                          type="button"
                          role="menuitemradio"
                          aria-checked={quality.mode === "manual" && i === sourceIndex}
                          className="cvp-menu-item"
                          onClick={() => chooseQuality(i)}
                        >
                          <span className="cvp-check">
                            {quality.mode === "manual" && i === sourceIndex && <Icon name="check" size={16} />}
                          </span>
                          <span>{s.label}</span>
                          {s.height !== undefined && s.height >= 720 && <span className="hd-badge">HD</span>}
                          {s.bitrate !== undefined && <span className="cvp-menu-value">{bitrateLabel(s.bitrate)}</span>}
                        </button>
                      ))}
                    </>
                  )}

                  {menu === "speed" && (
                    <>
                      <button type="button" className="cvp-menu-back" onClick={() => setMenu("main")}>
                        <Icon name="chevronLeft" size={18} /> Playback speed
                      </button>
                      {SPEEDS.map((s) => (
                        <button
                          key={s}
                          type="button"
                          role="menuitemradio"
                          aria-checked={s === speed}
                          className="cvp-menu-item"
                          onClick={() => {
                            changeSpeed(s);
                            setMenu(null);
                          }}
                        >
                          <span className="cvp-check">{s === speed && <Icon name="check" size={16} />}</span>
                          <span>{speedLabel(s)}</span>
                        </button>
                      ))}
                    </>
                  )}

                  {menu === "captions" && (
                    <>
                      <button type="button" className="cvp-menu-back" onClick={() => setMenu("main")}>
                        <Icon name="chevronLeft" size={18} /> Subtitles
                      </button>
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={captionIndex === -1}
                        className="cvp-menu-item"
                        onClick={() => chooseCaption(-1)}
                      >
                        <span className="cvp-check">{captionIndex === -1 && <Icon name="check" size={16} />}</span>
                        <span>Off</span>
                      </button>
                      {captions.map((track, i) => (
                        <button
                          key={track.src}
                          type="button"
                          role="menuitemradio"
                          aria-checked={captionIndex === i}
                          className="cvp-menu-item"
                          onClick={() => chooseCaption(i)}
                        >
                          <span className="cvp-check">{captionIndex === i && <Icon name="check" size={16} />}</span>
                          <span>{track.label}</span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>

            {pipSupported && (
              <button type="button" className="cvp-btn" onClick={togglePip} aria-label="Picture in picture">
                <Icon name="pip" />
              </button>
            )}
            <button
              type="button"
              className="cvp-btn"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? "Exit fullscreen (f)" : "Fullscreen (f)"}
            >
              <Icon name={fullscreen ? "fullscreenExit" : "fullscreen"} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
