"use client";

import { useActionState, useState, type ReactNode } from "react";
import { saveMovieAction } from "@/app/admin/actions";
import type { ActionState } from "@/types/admin";
import { INDUSTRIES } from "@/lib/industries";
import { extractArchiveId, extractYouTubeId } from "@/lib/admin/parse";
import { ARCHIVE_ID, YOUTUBE_ID } from "@/lib/media";

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
  const type = values.playbackType || "youtube";
  const raw = (values.playbackId || "").trim();
  let thumb: string | null = values.thumbnailUrl && values.thumbnailUrl.startsWith("https://") ? values.thumbnailUrl : null;
  let playback = "No video set yet";
  if (type === "youtube" && raw) {
    const id = extractYouTubeId(raw);
    if (YOUTUBE_ID.test(id)) {
      thumb = thumb ?? "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg";
      playback = "YouTube video " + id;
    } else {
      playback = "Not a valid YouTube link or ID yet";
    }
  } else if (type === "archive" && raw) {
    const id = extractArchiveId(raw);
    if (ARCHIVE_ID.test(id)) {
      thumb = thumb ?? "https://archive.org/services/img/" + id;
      playback = "Internet Archive item " + id;
    } else {
      playback = "Not a valid archive.org link or identifier yet";
    }
  } else if (type === "direct_video" && (values.playbackUrl || values.videoSources)) {
    playback = "Direct video file(s)";
  }
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
        <Field label="Type">
          <select name="contentType" defaultValue={v("contentType") || "movie"}>
            <option value="movie">Movie</option>
            <option value="show">Show / series</option>
          </select>
        </Field>
        <Field label="Description" wide>
          <textarea name="description" defaultValue={v("description")} rows={4} />
        </Field>
        <Field label="Categories" hint="Comma separated, e.g. Comedy, Family">
          <input name="genres" defaultValue={v("genres")} />
        </Field>
        <Field label="Languages" hint="Comma separated. Empty = the industry's language.">
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
        <Field label="Video source">
          <select name="playbackType" defaultValue={v("playbackType") || "youtube"}>
            <option value="youtube">YouTube (official upload)</option>
            <option value="archive">Internet Archive</option>
            <option value="direct_video">Direct video file(s)</option>
          </select>
        </Field>
        <Field
          label={playbackType === "archive" ? "archive.org link or identifier" : "YouTube link or video ID"}
          hint="Paste the full link — the ID is extracted automatically."
          hidden={playbackType === "direct_video"}
        >
          <input name="playbackId" defaultValue={v("playbackId")} placeholder={playbackType === "archive" ? "https://archive.org/details/…" : "https://www.youtube.com/watch?v=…"} />
        </Field>
        <Field label="Video file URL" hint="https link to an .mp4/.webm on an allowed host" hidden={playbackType !== "direct_video"}>
          <input name="playbackUrl" defaultValue={v("playbackUrl")} />
        </Field>
        <Field label="Quality versions (optional)" hint="One per line:  720p | https://…/film-720.mp4 | 720" wide hidden={playbackType !== "direct_video"}>
          <textarea name="videoSources" className="code" defaultValue={v("videoSources")} rows={4} />
        </Field>
        <Field label="Thumbnail URL" hint="Empty = automatic from YouTube / Internet Archive">
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
