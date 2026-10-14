// update-sgmovies-2.mjs — run inside openreel-v2 AFTER update-sgmovies-1.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

if (!existsSync("src/lib/admin/webpage.ts") || !existsSync("src/components/ReelsViewer.tsx")) {
  console.error("Run update-sgmovies-1.mjs first.");
  process.exit(1);
}

const files = {};

files["src/components/admin/MovieForm.tsx"] = String.raw`
"use client";

import { useActionState, useState, type ReactNode } from "react";
import { saveMovieAction } from "@/app/admin/actions";
import type { ActionState } from "@/types/admin";
import type { PlaybackFields } from "@/types/movie";
import { INDUSTRIES } from "@/lib/industries";
import { looksLikeUrl, playbackFromLink } from "@/lib/admin/parse";

interface Props {
  initial: Record<string, string>;
  originalId: string;
  mode: "create" | "edit";
}

function readForm(form: HTMLFormElement): Record<string, string> {
  const out: Record<string, string> = {};
  new FormData(form).forEach((value, key) => {
    if (typeof value === "string") out[key] = value;
  });
  return out;
}

function previewFrom(values: Record<string, string>): { thumb: string | null; playback: string } {
  const raw = (values.playbackId || "").trim();
  let thumb: string | null = values.thumbnailUrl && values.thumbnailUrl.startsWith("https://") ? values.thumbnailUrl : null;
  let playback = "No video set yet";
  let detected: PlaybackFields | null = null;
  if (raw) {
    if (looksLikeUrl(raw)) detected = playbackFromLink(raw, true);
    else if (values.playbackType === "archive") detected = { playbackType: "archive", playbackId: raw };
    else detected = { playbackType: "youtube", playbackId: raw };
  } else if (values.playbackUrl) {
    detected = playbackFromLink(values.playbackUrl, true);
  }
  if (detected) {
    if (detected.playbackType === "youtube" && detected.playbackId) {
      thumb = thumb ?? "https://i.ytimg.com/vi/" + detected.playbackId + "/hqdefault.jpg";
      playback = "YouTube video " + detected.playbackId;
    } else if (detected.playbackType === "archive" && detected.playbackId) {
      thumb = thumb ?? "https://archive.org/services/img/" + detected.playbackId;
      playback = "Internet Archive item " + detected.playbackId;
    } else if (detected.playbackType === "direct_video") {
      playback = "Direct video file";
    } else if (detected.playbackUrl) {
      try {
        playback = "Embedded player from " + new URL(detected.playbackUrl).hostname;
      } catch {
        playback = "Embedded player";
      }
    }
  }
  const versions = (values.languageVersions || "").split("\n").filter((l) => l.includes("|")).length;
  if (versions > 0) playback += " · +" + versions + " more language" + (versions === 1 ? "" : "s");
  return { thumb, playback };
}

function Field({ label, hint, wide, hidden, children }: { label: string; hint?: string; wide?: boolean; hidden?: boolean; children: ReactNode }) {
  return (
    <label className={"admin-field" + (wide ? " wide" : "")} hidden={hidden}>
      <span className="admin-label">{label}</span>
      {children}
      {hint && <span className="admin-hint">{hint}</span>}
    </label>
  );
}

export default function MovieForm({ initial, originalId, mode }: Props) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(saveMovieAction, { version: 0 });
  const values = state.values ?? initial;
  const [preview, setPreview] = useState(() => previewFrom(values));
  const [playbackType, setPlaybackType] = useState(values.playbackType || "youtube");
  const [contentType, setContentType] = useState(values.contentType || "movie");
  const v = (name: string) => values[name] ?? "";
  const usesFileUrl = playbackType === "direct_video" || playbackType === "embed";

  return (
    <form
      key={state.version ?? 0}
      action={formAction}
      className="admin-form"
      onChange={(event) => {
        const data = readForm(event.currentTarget);
        setPreview(previewFrom(data));
        setPlaybackType(data.playbackType || "youtube");
        setContentType(data.contentType || "movie");
      }}
    >
      <input type="hidden" name="originalId" value={originalId} />

      {state.errors && state.errors.length > 0 && (
        <div className="admin-errors" role="alert">
          <strong>Please fix these and save again:</strong>
          <ul>
            {state.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      <fieldset>
        <legend>Basics</legend>
        <Field label="Title *">
          <input name="title" defaultValue={v("title")} required />
        </Field>
        <Field label="URL slug" hint="Leave empty to create it from the title.">
          <input name="slug" defaultValue={v("slug")} placeholder="e.g. my-film-1975" />
        </Field>
        <Field label="Industry">
          <select name="industry" defaultValue={v("industry")}>
            {INDUSTRIES.map((i) => (
              <option key={i.value} value={i.value}>{i.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Section">
          <select name="contentType" defaultValue={v("contentType") || "movie"}>
            <option value="movie">Movie</option>
            <option value="show">Show / series</option>
            <option value="video">Video (song, clip, trailer)</option>
            <option value="reel">Reel (short vertical clip)</option>
          </select>
        </Field>
        <Field label="Description" wide>
          <textarea name="description" defaultValue={v("description")} rows={4} />
        </Field>
        <Field label="Categories" hint="Comma separated, e.g. Comedy, Family">
          <input name="genres" defaultValue={v("genres")} />
        </Field>
        <Field label="Main language(s)" hint="Language of the main video. Empty = the industry's language.">
          <input name="languages" defaultValue={v("languages")} />
        </Field>
        <Field label="Director">
          <input name="director" defaultValue={v("director")} />
        </Field>
        <Field label="Cast" hint="Comma separated">
          <input name="cast" defaultValue={v("cast")} />
        </Field>
      </fieldset>

      <fieldset>
        <legend>Release</legend>
        <Field label="Release" hint="1975, 1975-08 or 1975-08-15 (month enables month-wise browsing)">
          <input name="release" defaultValue={v("release")} placeholder="1975-08" />
        </Field>
        <Field label="Runtime (minutes)">
          <input name="runtimeMinutes" inputMode="numeric" defaultValue={v("runtimeMinutes")} />
        </Field>
        <Field label="Popularity" hint="Filled by Refresh trending; you can also set it.">
          <input name="popularity" inputMode="numeric" defaultValue={v("popularity")} />
        </Field>
      </fieldset>

      <fieldset>
        <legend>Video</legend>
        <div className="admin-preview">
          <div className="admin-thumb admin-thumb-lg">
            {preview.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.thumb} alt="" referrerPolicy="no-referrer" />
            ) : null}
          </div>
          <p className="admin-note">{preview.playback}</p>
        </div>
        <Field label="Video link" hint="Paste any link: YouTube, archive.org, Vimeo, Dailymotion or an allowed player. The type is detected automatically." wide>
          <input name="playbackId" defaultValue={v("playbackId")} placeholder="https://www.youtube.com/watch?v=…" />
        </Field>
        <Field label="How it plays">
          <select name="playbackType" defaultValue={v("playbackType") || "youtube"}>
            <option value="youtube">YouTube (official upload)</option>
            <option value="archive">Internet Archive</option>
            <option value="direct_video">Direct video file(s)</option>
            <option value="embed">Official player of another website</option>
          </select>
        </Field>
        <Field label="Video file / player URL" hint="https link to an .mp4/.webm file or an allowed player page" hidden={!usesFileUrl}>
          <input name="playbackUrl" defaultValue={v("playbackUrl")} />
        </Field>
        <Field label="Quality versions (optional)" hint="One per line:  720p | https://…/film-720.mp4 | 720" wide hidden={playbackType !== "direct_video"}>
          <textarea name="videoSources" className="code" defaultValue={v("videoSources")} rows={4} />
        </Field>
        <Field
          label="Other languages"
          hint='One per line: "Hindi | https://www.youtube.com/watch?v=…". Viewers pick the language above the player.'
          wide
        >
          <textarea name="languageVersions" className="code" defaultValue={v("languageVersions")} rows={3} placeholder={"Hindi | https://www.youtube.com/watch?v=…\nMarathi | https://www.youtube.com/watch?v=…"} />
        </Field>
        <Field label="Thumbnail URL" hint="Empty = automatic. Broken images are replaced automatically.">
          <input name="thumbnailUrl" defaultValue={v("thumbnailUrl")} />
        </Field>
        <Field label="Source page URL" hint="Empty = created automatically">
          <input name="sourcePageUrl" defaultValue={v("sourcePageUrl")} />
        </Field>
        <Field
          label="Episodes (JSON)"
          hint='For shows. Easiest: import a playlist as a show. Format: [{"id":"e1","title":"Episode 1","season":1,"episode":1,"playbackType":"youtube","playbackId":"…"}]'
          wide
          hidden={contentType !== "show" && !v("episodes")}
        >
          <textarea name="episodes" className="code" defaultValue={v("episodes")} rows={6} />
        </Field>
        <Field label="Alternate titles" hint="One per line" wide>
          <textarea name="alternateTitles" defaultValue={v("alternateTitles")} rows={2} />
        </Field>
      </fieldset>

      <fieldset>
        <legend>Publishing &amp; rights</legend>
        <Field label="Status" hint="Only Live titles appear on the site.">
          <select name="rightsStatus" defaultValue={v("rightsStatus") || "pending_review"}>
            <option value="pending_review">Pending review (hidden)</option>
            <option value="approved">Live (approved)</option>
            <option value="rejected">Rejected (hidden)</option>
          </select>
        </Field>
        <Field label="Territories" hint="Countries you checked, e.g. IN, US. Empty = default when published.">
          <input name="territories" defaultValue={v("territories")} />
        </Field>
        <Field label="Rights basis">
          <select name="rightsBasis" defaultValue={v("rightsBasis") || "platform_embed"}>
            <option value="platform_embed">Official upload, embedded player</option>
            <option value="public_domain">Public domain</option>
            <option value="creative_commons">Creative Commons license</option>
            <option value="written_permission">Written permission</option>
            <option value="license_agreement">License agreement</option>
          </select>
        </Field>
        <Field label="License URL" hint="Required for Creative Commons">
          <input name="licenseUrl" defaultValue={v("licenseUrl")} />
        </Field>
        <Field label="Credit / attribution" hint="Empty = created automatically">
          <input name="attribution" defaultValue={v("attribution")} />
        </Field>
        <Field label="Reviewed by">
          <input name="rightsReviewer" defaultValue={v("rightsReviewer")} placeholder="admin" />
        </Field>
        <Field label="Review date">
          <input type="date" name="rightsReviewedAt" defaultValue={v("rightsReviewedAt")} />
        </Field>
        <Field label="Rights notes" wide>
          <textarea name="rightsNotes" defaultValue={v("rightsNotes")} rows={3} />
        </Field>
        <div className="admin-checks wide">
          <label className="admin-check">
            <input type="checkbox" name="featured" defaultChecked={v("featured") === "on"} /> ★ Featured in the home banner
          </label>
          <label className="admin-check">
            <input type="checkbox" name="trending" defaultChecked={v("trending") === "on"} /> 🔥 Pin to Trending
          </label>
          <label className="admin-check">
            <input type="checkbox" name="commercialUseAllowed" defaultChecked={v("commercialUseAllowed") === "on"} /> Commercial use allowed
          </label>
        </div>
      </fieldset>

      <div className="admin-form-footer sticky">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? "Create title" : "Save changes"}
        </button>
        <span className="admin-note">Saved changes appear on the site immediately.</span>
      </div>
    </form>
  );
}
`;

files["src/app/admin/(protected)/layout.tsx"] = String.raw`
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { requireAdmin, usingDefaultCredentials } from "@/lib/admin/auth";
import { logoutAction } from "@/app/admin/actions";
import "../admin.css";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return (
    <div className="admin">
      {usingDefaultCredentials() && (
        <p className="admin-msg err" role="alert">
          You&apos;re using the default login <strong>admin / admin</strong>. Before putting the site online, set ADMIN_USERNAME and
          ADMIN_PASSWORD in .env.local and restart the server.
        </p>
      )}
      <nav className="admin-nav" aria-label="Admin">
        <strong>SGMovies admin</strong>
        <Link href="/admin">Titles</Link>
        <Link href="/admin/movies/new">Add title</Link>
        <Link href="/admin/import">Import &amp; sources</Link>
        <Link href="/" target="_blank">View site ↗</Link>
        <form action={logoutAction}>
          <button type="submit" className="link-button">Log out</button>
        </form>
      </nav>
      {children}
    </div>
  );
}
`;

files["src/app/admin/(protected)/page.tsx"] = String.raw`
import Link from "next/link";
import type { Movie } from "@/types/movie";
import { loadCatalog } from "@/lib/store";
import { rowAction } from "@/app/admin/actions";
import { INDUSTRIES, industryLabel } from "@/lib/industries";
import ConfirmButton from "@/components/admin/ConfirmButton";
import SelectAll from "@/components/admin/SelectAll";

type SearchParams = Record<string, string | string[] | undefined>;

const PAGE_SIZE = 50;
const STATUS_LABELS: Record<string, string> = { approved: "Live", pending_review: "Pending", rejected: "Rejected" };
const TYPE_NAMES: Record<string, string> = { movie: "Movie", show: "Show", video: "Video", reel: "Reel" };

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const status = one(sp.status);
  const industry = one(sp.industry);
  const type = one(sp.type);
  const msg = one(sp.msg);
  const page = Math.max(1, Number(one(sp.page)) || 1);

  const { raw, problems } = loadCatalog();
  const invalidIds = new Set(problems.map((p) => p.id));
  const movies = raw.map((r) => r as unknown as Partial<Movie>);
  const countStatus = (s: string) => movies.filter((m) => m.rightsStatus === s).length;

  const needle = q.toLowerCase();
  const filtered = movies.filter((m) => {
    if (status === "invalid") {
      if (!invalidIds.has(String(m.id ?? ""))) return false;
    } else if (status && m.rightsStatus !== status) {
      return false;
    }
    if (industry && m.industry !== industry) return false;
    if (type && (m.contentType ?? "movie") !== type) return false;
    if (needle) {
      const hay = [m.title, m.id, m.slug, m.director, m.playbackId, m.playbackUrl, ...(m.genres ?? [])].join(" ").toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  // Newest additions first.
  filtered.sort((a, b) => String(b.addedAt ?? "").localeCompare(String(a.addedAt ?? "")));

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function href(overrides: Record<string, string>): string {
    const values: Record<string, string> = { q, status, industry, type, page: String(currentPage), ...overrides };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
      if (value && !(key === "page" && value === "1")) params.set(key, value);
    }
    const text = params.toString();
    return "/admin" + (text ? "?" + text : "");
  }
  const returnTo = href({});

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>Titles</h1>
          <p className="admin-crumb">Newest first. Publish titles to show them on the site — changes appear immediately.</p>
        </div>
        <div className="admin-head-actions">
          <Link className="btn" href="/admin/import">Import / add from link</Link>
          <Link className="btn btn-primary" href="/admin/movies/new">+ Add title</Link>
        </div>
      </div>

      {msg && <p className="admin-msg info" role="status">{msg}</p>}

      <div className="admin-stats">
        {[
          ["", movies.length, "All titles"],
          ["approved", countStatus("approved"), "Live on site"],
          ["pending_review", countStatus("pending_review"), "Pending review"],
          ["rejected", countStatus("rejected"), "Rejected"],
          ["invalid", problems.length, "Hidden (need fixing)"],
        ].map(([key, count, label]) => (
          <Link key={String(key) || "all"} className={"admin-stat" + (status === key ? " is-active" : "")} href={href({ status: String(key), page: "1" })}>
            <b>{count}</b>
            <span>{label}</span>
          </Link>
        ))}
      </div>

      {problems.length > 0 && (
        <div className="admin-errors">
          <strong>{problems.length} title(s) are hidden from the site because of errors:</strong>
          <ul className="admin-problems">
            {problems.slice(0, 8).map((p) => (
              <li key={p.index}>
                {p.id ? <Link href={"/admin/movies/" + encodeURIComponent(p.id)}>{p.title}</Link> : p.title} — {p.errors.join("; ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      <form className="admin-filters" action="/admin" method="get">
        <input type="search" name="q" defaultValue={q} placeholder="Search title, ID, director, category, link…" />
        <select name="status" defaultValue={status}>
          <option value="">Any status</option>
          <option value="approved">Live</option>
          <option value="pending_review">Pending</option>
          <option value="rejected">Rejected</option>
          <option value="invalid">Hidden (errors)</option>
        </select>
        <select name="type" defaultValue={type}>
          <option value="">All sections</option>
          <option value="movie">Movies</option>
          <option value="show">Shows</option>
          <option value="video">Videos</option>
          <option value="reel">Reels</option>
        </select>
        <select name="industry" defaultValue={industry}>
          <option value="">All industries</option>
          {INDUSTRIES.map((i) => (
            <option key={i.value} value={i.value}>{i.label}</option>
          ))}
        </select>
        <button type="submit" className="btn">Filter</button>
        {(q || status || industry || type) && <Link href="/admin" className="link-button">Reset</Link>}
      </form>

      <form action={rowAction}>
        <input type="hidden" name="returnTo" value={returnTo} />
        <div className="admin-bulk">
          <span className="admin-note">{filtered.length} title(s). With ticked:</span>
          <button type="submit" className="btn btn-xs btn-ok" name="target" value="bulk-approve">Publish</button>
          <button type="submit" className="btn btn-xs" name="target" value="bulk-pending">Set pending</button>
          <button type="submit" className="btn btn-xs" name="target" value="bulk-reject">Reject</button>
          <ConfirmButton className="btn btn-xs btn-danger" name="target" value="bulk-delete" message="Delete all ticked titles permanently?">
            Delete
          </ConfirmButton>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th><SelectAll /></th>
                <th><span className="sr-only">Thumbnail</span></th>
                <th>Title</th>
                <th>Section</th>
                <th>Industry</th>
                <th>Added</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.length === 0 && (
                <tr>
                  <td colSpan={8} className="admin-note">No titles match. Try another filter, or add some titles.</td>
                </tr>
              )}
              {pageItems.map((m, index) => {
                const id = String(m.id ?? "");
                const title = String(m.title || "(untitled)");
                const invalid = invalidIds.has(id);
                const year = m.releaseDate ? m.releaseDate.slice(0, 4) : m.releaseYear ? String(m.releaseYear) : "";
                const languages = 1 + (m.languageVersions?.length ?? 0);
                return (
                  <tr key={id || "row-" + index}>
                    <td>{id && <input type="checkbox" name="ids" value={id} aria-label={"Select " + title} />}</td>
                    <td>
                      <div className={"admin-thumb" + (m.contentType === "reel" ? " admin-thumb-tall" : "")}>
                        {id ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={"/api/thumb/" + encodeURIComponent(id) + "?size=small"} alt="" loading="lazy" />
                        ) : null}
                      </div>
                    </td>
                    <td className="admin-title-cell">
                      {id ? <Link href={"/admin/movies/" + encodeURIComponent(id)}>{title}</Link> : title}
                      <span className="admin-sub">
                        {[year, (m.genres ?? []).join(", "), m.playbackType, languages > 1 ? languages + " languages" : "", m.contentType === "show" ? (m.episodes?.length ?? 0) + " episodes" : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </td>
                    <td>{TYPE_NAMES[String(m.contentType ?? "movie")] ?? "Movie"}</td>
                    <td>{m.industry ? industryLabel(m.industry) : "—"}</td>
                    <td className="admin-sub">{m.addedAt ?? "—"}</td>
                    <td>
                      {invalid ? (
                        <span className="status status-invalid">Needs fixing</span>
                      ) : (
                        <span className={"status status-" + String(m.rightsStatus)}>{STATUS_LABELS[String(m.rightsStatus)] ?? String(m.rightsStatus)}</span>
                      )}
                    </td>
                    <td>
                      {id && (
                        <div className="row-actions">
                          {m.rightsStatus !== "approved" && (
                            <button type="submit" className="btn btn-xs btn-ok" name="target" value={"approve|" + id}>Publish</button>
                          )}
                          {m.rightsStatus !== "pending_review" && (
                            <button type="submit" className="btn btn-xs" name="target" value={"pending|" + id}>Pending</button>
                          )}
                          {m.rightsStatus !== "rejected" && (
                            <button type="submit" className="btn btn-xs" name="target" value={"reject|" + id}>Reject</button>
                          )}
                          <button type="submit" className={"btn btn-xs" + (m.featured ? " is-on" : "")} name="target" value={"feature|" + id} title="Featured in the home banner">★</button>
                          <button type="submit" className={"btn btn-xs" + (m.trending ? " is-on" : "")} name="target" value={"trending|" + id} title="Pin to Trending">🔥</button>
                          <Link className="btn btn-xs" href={"/admin/movies/" + encodeURIComponent(id)}>Edit</Link>
                          <ConfirmButton className="btn btn-xs btn-danger" name="target" value={"delete|" + id} message={"Delete \"" + title + "\" permanently?"}>
                            Delete
                          </ConfirmButton>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </form>

      {totalPages > 1 && (
        <nav className="admin-pager" aria-label="Pages">
          {currentPage > 1 && <Link className="btn btn-xs" href={href({ page: String(currentPage - 1) })}>← Previous</Link>}
          <span className="admin-note">Page {currentPage} of {totalPages}</span>
          {currentPage < totalPages && <Link className="btn btn-xs" href={href({ page: String(currentPage + 1) })}>Next →</Link>}
        </nav>
      )}
    </div>
  );
}
`;

files["src/app/admin/(protected)/movies/[id]/page.tsx"] = String.raw`
import Link from "next/link";
import { notFound } from "next/navigation";
import MovieForm from "@/components/admin/MovieForm";
import ConfirmButton from "@/components/admin/ConfirmButton";
import { deleteMovieAction } from "@/app/admin/actions";
import { loadCatalog } from "@/lib/store";
import { toFormValues } from "@/lib/admin/form";
import { validateRecord } from "@/lib/validation";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default async function EditMoviePage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const wanted = safeDecode(id);
  const record = loadCatalog().raw.find((r) => r.id === wanted || r.id === id);
  if (!record) notFound();

  const recordId = String(record.id);
  const title = String(record.title || "(untitled)");
  const slug = typeof record.slug === "string" ? record.slug : "";
  const problems = validateRecord(record);
  const isLive = record.rightsStatus === "approved" && problems.length === 0;
  const isReel = record.contentType === "reel";
  const note = typeof sp.note === "string" ? sp.note : "";
  const viewHref = isReel ? "/reels?r=" + encodeURIComponent(slug) : "/movies/" + slug;

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <p className="admin-crumb"><Link href="/admin">Titles</Link> / Edit</p>
          <h1>{title}</h1>
        </div>
        <div className="admin-head-actions">
          {slug && (
            <Link className="btn" href={viewHref} target="_blank">
              {isLive ? "View on site ↗" : "Preview ↗"}
            </Link>
          )}
          <form action={deleteMovieAction}>
            <input type="hidden" name="id" value={recordId} />
            <ConfirmButton className="btn btn-danger" message={"Delete \"" + title + "\" permanently?"}>Delete</ConfirmButton>
          </form>
        </div>
      </div>

      {sp.saved && <p className="admin-msg ok" role="status">Saved. {isLive ? "It's live on the site now." : "It's not public until its status is Live."}</p>}
      {sp.added && <p className="admin-msg info" role="status">Added as Pending. Check the details and rights, then set Status to Live and save.</p>}
      {note && <p className="admin-msg err" role="status">{note}</p>}
      {problems.length > 0 && (
        <div className="admin-errors">
          <strong>This title is hidden from the site until these are fixed:</strong>
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <MovieForm initial={toFormValues(record)} originalId={recordId} mode="edit" />
    </div>
  );
}
`;

files["src/app/admin/(protected)/import/page.tsx"] = String.raw`
import {
  importArchiveAction,
  importYouTubeAction,
  quickAddAction,
  refreshPopularityAction,
  saveSourceAction,
  sourceRowAction,
  syncAllAction,
} from "@/app/admin/actions";
import ActionForm from "@/components/admin/ActionForm";
import ConfirmButton from "@/components/admin/ConfirmButton";
import { loadSources } from "@/lib/store";
import { INDUSTRIES, industryLabel } from "@/lib/industries";
import { siteConfig } from "@/lib/config";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const TYPE_TEXT: Record<string, string> = { auto: "auto-sorted", movie: "movies", show: "show", video: "videos", reel: "reels" };

function IndustrySelect({ defaultValue = "bollywood" }: { defaultValue?: string }) {
  return (
    <label className="admin-field">
      <span className="admin-label">Industry</span>
      <select name="industry" defaultValue={defaultValue}>
        {INDUSTRIES.map((i) => (
          <option key={i.value} value={i.value}>{i.label}</option>
        ))}
      </select>
    </label>
  );
}

function TypeSelect({ defaultValue = "auto" }: { defaultValue?: string }) {
  return (
    <label className="admin-field">
      <span className="admin-label">Section</span>
      <select name="contentType" defaultValue={defaultValue}>
        <option value="auto">Auto: sort by length into Movies / Videos / Reels</option>
        <option value="movie">Movies</option>
        <option value="show">Show (a playlist = one series)</option>
        <option value="video">Videos</option>
        <option value="reel">Reels / Shorts</option>
      </select>
    </label>
  );
}

export default async function ImportPage({ searchParams }: Props) {
  const sp = await searchParams;
  const msg = typeof sp.msg === "string" ? sp.msg : "";
  const sources = loadSources();
  const hasYouTubeKey = Boolean(process.env.YOUTUBE_API_KEY);
  const hasCronSecret = (process.env.CRON_SECRET || "").length >= 16;

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>Import &amp; sources</h1>
          <p className="admin-crumb">
            YouTube key: {hasYouTubeKey ? <span className="env-ok">set</span> : <span className="env-missing">missing</span>} · Scheduled sync:{" "}
            {hasCronSecret ? <span className="env-ok">enabled</span> : <span className="env-missing">set CRON_SECRET to enable</span>}
          </p>
        </div>
      </div>

      {msg && <p className="admin-msg info" role="status">{msg}</p>}

      <section className="admin-card">
        <h2>Add from any link</h2>
        <p>
          Paste a link from YouTube, archive.org, Vimeo, Dailymotion, a direct .mp4 file, or any other website. The title, description,
          thumbnail, dates and language are read automatically, and the website&apos;s official player is used when it can be embedded.
          Every title starts as Pending.
        </p>
        <ActionForm action={quickAddAction} submitLabel="Fetch and add" pendingLabel="Reading the page…">
          <label className="admin-field">
            <span className="admin-label">Link</span>
            <input name="url" required placeholder="https://…" />
          </label>
          <div className="admin-row">
            <IndustrySelect />
            <TypeSelect />
          </div>
        </ActionForm>
      </section>

      <div className="admin-grid two">
        <section className="admin-card">
          <h2>Import from YouTube</h2>
          <p>Only from the rights holder&apos;s official channel. Newest uploads are fetched first; only public, embeddable videos are added.</p>
          {!hasYouTubeKey && <p className="admin-msg err">Add YOUTUBE_API_KEY to .env.local and restart to use this.</p>}
          <ActionForm action={importYouTubeAction} submitLabel="Import from YouTube" pendingLabel="Importing…">
            <label className="admin-field">
              <span className="admin-label">Channel or playlist</span>
              <input name="target" required placeholder="@OfficialChannel, channel link, or playlist link" />
            </label>
            <div className="admin-row">
              <IndustrySelect />
              <TypeSelect />
              <label className="admin-field">
                <span className="admin-label">Min. length for movies (min)</span>
                <input name="minMinutes" inputMode="numeric" placeholder="70" />
              </label>
              <label className="admin-field">
                <span className="admin-label">Max new titles</span>
                <input name="max" inputMode="numeric" defaultValue="50" />
              </label>
            </div>
          </ActionForm>
        </section>

        <section className="admin-card">
          <h2>Import from the Internet Archive</h2>
          <p>Public-domain candidates. No key needed. Short items are sorted into Videos and Reels automatically.</p>
          <ActionForm action={importArchiveAction} submitLabel="Import from Archive" pendingLabel="Importing…">
            <div className="admin-row">
              <IndustrySelect defaultValue="hollywood" />
              <label className="admin-field">
                <span className="admin-label">Order</span>
                <select name="sort" defaultValue="newest">
                  <option value="newest">Newest uploads first</option>
                  <option value="popular">Most popular first</option>
                </select>
              </label>
              <label className="admin-field">
                <span className="admin-label">How many</span>
                <input name="rows" inputMode="numeric" defaultValue="30" />
              </label>
              <label className="admin-field">
                <span className="admin-label">Page</span>
                <input name="page" inputMode="numeric" defaultValue="1" />
              </label>
            </div>
            <label className="admin-field">
              <span className="admin-label">Custom search (optional)</span>
              <input name="query" placeholder="e.g. collection:(feature_films) AND year:[1930 TO 1950]" />
            </label>
          </ActionForm>
        </section>

        <section className="admin-card">
          <h2>Refresh trending</h2>
          <p>Updates popularity from Internet Archive downloads{hasYouTubeKey ? " and YouTube views" : ""}.</p>
          <ActionForm action={refreshPopularityAction} submitLabel="Refresh now" pendingLabel="Refreshing…" />
        </section>

        <section className="admin-card">
          <h2>Allowed players</h2>
          <p>Videos from other websites play only through these official players:</p>
          <code className="admin-code">{siteConfig.allowedEmbedHosts.join("\n")}</code>
          <p className="admin-note">
            To allow another website&apos;s player (only if it is the rights holder or has permission), add its host to
            NEXT_PUBLIC_EXTRA_EMBED_HOSTS in .env.local, comma separated, and restart.
          </p>
        </section>
      </div>

      <section className="admin-card">
        <h2>Saved sources (automatic fetching of the latest titles)</h2>
        <p>
          Save channels, playlists or searches; each sync fetches their newest titles. New titles stay Pending unless the source is
          <strong> Trusted</strong>, which publishes automatically. Only trust channels you have confirmed belong to the official rights holder.
        </p>

        {sources.length > 0 ? (
          <form action={sourceRowAction}>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Industry</th>
                    <th>Auto-publish</th>
                    <th>Last sync</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <tr key={s.id}>
                      <td className="admin-title-cell">
                        <strong>{s.label}</strong>
                        <span className="admin-sub">
                          {(s.kind === "youtube" ? "YouTube" : "Internet Archive") + " · " + (TYPE_TEXT[s.contentType] ?? s.contentType) + " · " + s.target}
                        </span>
                      </td>
                      <td>{industryLabel(s.industry)}</td>
                      <td>{s.trusted ? <span className="status status-approved">Trusted</span> : <span className="status status-pending_review">Review first</span>}</td>
                      <td className="admin-sub">
                        {s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString("en-IN") : "Never"}
                        {s.lastResult ? " — " + s.lastResult : ""}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button type="submit" className="btn btn-xs btn-ok" name="target" value={"sync|" + s.id}>Sync now</button>
                          <button type="submit" className="btn btn-xs" name="target" value={"trust|" + s.id}>{s.trusted ? "Stop auto-publish" : "Trust"}</button>
                          <ConfirmButton className="btn btn-xs btn-danger" name="target" value={"delete|" + s.id} message={"Remove source \"" + s.label + "\"? Its titles stay."}>
                            Remove
                          </ConfirmButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </form>
        ) : (
          <p className="admin-note">No saved sources yet.</p>
        )}

        <div className="admin-grid two">
          <div>
            <h3>Add a source</h3>
            <ActionForm action={saveSourceAction} submitLabel="Save source">
              <div className="admin-row">
                <label className="admin-field">
                  <span className="admin-label">Name</span>
                  <input name="label" placeholder="e.g. Official Marathi films" />
                </label>
                <label className="admin-field">
                  <span className="admin-label">Kind</span>
                  <select name="kind" defaultValue="youtube">
                    <option value="youtube">YouTube channel / playlist</option>
                    <option value="archive">Internet Archive search</option>
                  </select>
                </label>
              </div>
              <label className="admin-field">
                <span className="admin-label">Channel / playlist / search query</span>
                <input name="target" required placeholder="@OfficialChannel  or  playlist link  or  Archive query" />
              </label>
              <div className="admin-row">
                <IndustrySelect />
                <TypeSelect />
                <label className="admin-field">
                  <span className="admin-label">Territories</span>
                  <input name="territories" placeholder="IN" />
                </label>
                <label className="admin-field">
                  <span className="admin-label">Max per sync</span>
                  <input name="maxPerSync" inputMode="numeric" defaultValue="30" />
                </label>
              </div>
              <label className="admin-check">
                <input type="checkbox" name="trusted" /> Trusted: publish new titles automatically (official rights holder only)
              </label>
            </ActionForm>
          </div>
          <div>
            <h3>Sync everything</h3>
            <ActionForm action={syncAllAction} submitLabel="Sync all sources now" pendingLabel="Syncing…" />
            <h3>Schedule it</h3>
            <p className="admin-note">With CRON_SECRET set, a scheduler can call this URL (example: every 6 hours):</p>
            <code className="admin-code">
              {"0 */6 * * * curl -fsS -H \"Authorization: Bearer YOUR_CRON_SECRET\" " + siteConfig.url + "/api/admin/sync > /dev/null"}
            </code>
          </div>
        </div>
      </section>
    </div>
  );
}
`;

files["src/app/layout.tsx"] = String.raw`
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";
import "./enhancements.css";
import "./sgmovies.css";
import { siteConfig } from "@/lib/config";
import { isPreviewMode } from "@/lib/catalog";
import { INDUSTRIES } from "@/lib/industries";

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: { default: siteConfig.name, template: "%s · " + siteConfig.name },
  description: siteConfig.tagline,
  applicationName: siteConfig.name,
};

export const viewport: Viewport = {
  themeColor: "#0b0d12",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        {isPreviewMode() && (
          <div className="preview-banner" role="note">
            Local preview: titles pending review are visible. They are never shown in production.
          </div>
        )}
        <header className="site-header">
          <div className="container header-inner">
            <Link href="/" className="logo" aria-label={siteConfig.name + " home"}>
              <span className="logo-mark" aria-hidden="true">SG</span>
              <span className="logo-text">Movies</span>
            </Link>
            <nav className="industry-nav" aria-label="Browse">
              <Link href="/?type=movie">Movies</Link>
              <Link href="/?type=show">Shows</Link>
              <Link href="/?type=video">Videos</Link>
              <Link href="/reels">Reels</Link>
              <span className="nav-sep" aria-hidden="true" />
              {INDUSTRIES.map((industry) => (
                <Link key={industry.value} href={"/?industry=" + industry.value}>{industry.label}</Link>
              ))}
            </nav>
            <form className="header-search" action="/" method="get" role="search">
              <label htmlFor="site-search" className="sr-only">Search</label>
              <input id="site-search" type="search" name="q" placeholder="Search movies, shows, videos…" />
            </form>
          </div>
        </header>
        <main id="main" className="container">{children}</main>
        <footer className="site-footer">
          <div className="container footer-inner">
            <nav className="footer-nav" aria-label="Footer">
              <Link href="/about">About</Link>
              <Link href="/rights">Rights &amp; takedowns</Link>
              <Link href="/privacy">Privacy</Link>
              <a href={"mailto:" + siteConfig.contactEmail}>Contact</a>
            </nav>
            <p className="muted small">
              © {new Date().getFullYear()} {siteConfig.name}. All titles are credited to and streamed from their rights holders.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
`;

files["src/app/sgmovies.css"] = String.raw`
/* ===== Brand ===== */
.logo { gap: .15rem; }
.logo-mark { width: auto; min-width: 30px; padding: 0 .35rem; font-size: .8rem; font-weight: 900; letter-spacing: -.02em; }
.logo-text { font-weight: 800; }
.nav-sep { align-self: stretch; width: 1px; margin: .35rem .3rem; background: var(--border); flex-shrink: 0; }

/* ===== Thumbnails: shimmer while loading, clean title card when missing ===== */
.card-media, .table-thumb, .rail-item, .episode-thumb, .admin-thumb, .reel-frame {
  background: linear-gradient(110deg, #1b1f2a 30%, #272c3a 50%, #1b1f2a 70%);
  background-size: 200% 100%;
  animation: sg-shimmer 1.4s linear infinite;
}
@keyframes sg-shimmer { to { background-position: -200% 0; } }
img.thumb { background: transparent; }
.thumb-fallback {
  display: grid; place-items: center; width: 100%; height: 100%; padding: .75rem; text-align: center;
  background: linear-gradient(135deg, #2b2f45, #14161f); color: #e8ebf2; font-size: .95rem; font-weight: 700; line-height: 1.25;
}
.thumb-fallback span { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.rail-item .thumb-fallback, .table-thumb .thumb-fallback, .episode-thumb .thumb-fallback { font-size: .62rem; padding: .25rem; }
.admin-thumb-tall { width: 54px; aspect-ratio: 9 / 16; }

/* ===== Section badges and reel cards ===== */
.badge-type { bottom: .5rem; left: .5rem; background: rgba(98, 70, 220, .92); }
.card-reel .card-media { aspect-ratio: 9 / 16; }
.row-list-tall { grid-auto-columns: clamp(140px, 15vw, 200px); }

/* ===== Language switch above the player ===== */
.lang-switch { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; margin-bottom: .6rem; }
.lang-switch-label { margin-right: .25rem; font-size: .82rem; color: var(--muted); }
.lang-switch button { padding: .3rem .85rem; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--text); font-size: .85rem; font-weight: 600; cursor: pointer; transition: background .2s, border-color .2s; }
.lang-switch button:hover { border-color: var(--accent); }
.lang-switch button[aria-pressed="true"] { background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #111; border-color: transparent; }
.modal-inner .lang-switch { padding: .5rem 1rem 0; }

/* ===== Reels page ===== */
.reels-page { position: relative; }
.reels { height: calc(100dvh - 120px); min-height: 480px; overflow-y: auto; scroll-snap-type: y mandatory; scrollbar-width: none; border-radius: 18px; background: #000; outline: none; }
.reels::-webkit-scrollbar { display: none; }
.reel { position: relative; height: 100%; display: flex; align-items: center; justify-content: center; gap: 1.5rem; padding: 1rem; scroll-snap-align: start; scroll-snap-stop: always; }
.reel-frame { position: relative; height: 100%; aspect-ratio: 9 / 16; max-width: 100%; flex-shrink: 0; border-radius: 16px; overflow: hidden; }
.reel-frame .thumb, .reel-frame iframe, .reel-frame video { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; object-fit: cover; }
.reel-frame video { object-fit: contain; background: #000; }
.reel-info { max-width: 320px; color: #fff; }
.reel-info h2 { margin: .5rem 0 .4rem; font-size: 1.3rem; }
.reel-info p { margin: 0 0 .4rem; color: #c9cfdb; font-size: .9rem; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.reel-info .reel-credit { font-size: .75rem; color: var(--muted); }
.reel-mute { position: absolute; top: .75rem; right: .75rem; z-index: 2; background: rgba(0, 0, 0, .5); }
.reel-unavailable { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); }
.reels-nav { position: absolute; top: 50%; right: 1rem; z-index: 3; display: flex; flex-direction: column; align-items: center; gap: .5rem; transform: translateY(-50%); color: var(--muted); font-size: .8rem; }
.reels-nav .icon-btn { background: rgba(0, 0, 0, .5); }
.reels-nav .icon-btn:disabled { opacity: .35; cursor: default; }
@media (max-width: 760px) {
  .reels { height: calc(100dvh - 150px); border-radius: 12px; }
  .reel { padding: 0; }
  .reel-frame { width: 100%; height: 100%; aspect-ratio: auto; border-radius: 0; }
  .reel-info { position: absolute; left: 0; right: 0; bottom: 0; z-index: 1; max-width: none; padding: 3rem 1rem 1rem; background: linear-gradient(to top, rgba(0, 0, 0, .85), transparent); pointer-events: none; }
  .reel-info .link-button { pointer-events: auto; }
  .reels-nav { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .card-media, .table-thumb, .rail-item, .episode-thumb, .admin-thumb, .reel-frame { animation: none; }
}
`;

for (const [path, content] of Object.entries(files)) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content.replace(/^\r?\n/, ""), "utf8");
  console.log("Wrote " + path);
}

// Rename the npm package (cosmetic).
try {
  const pkg = readFileSync("package.json", "utf8");
  if (pkg.includes('"name": "openreel"')) {
    writeFileSync("package.json", pkg.replace('"name": "openreel"', '"name": "sgmovies"'), "utf8");
    console.log("Renamed package to sgmovies");
  }
} catch {
  // not critical
}

console.log("\nSGMovies update complete. Restart with: npm run dev");
