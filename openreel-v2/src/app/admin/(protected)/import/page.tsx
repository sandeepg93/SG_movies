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

function TypeSelect() {
  return (
    <label className="admin-field">
      <span className="admin-label">Type</span>
      <select name="contentType" defaultValue="movie">
        <option value="movie">Movies</option>
        <option value="show">Show (playlist = one series)</option>
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

      <div className="admin-grid two">
        <section className="admin-card">
          <h2>Quick add from a link</h2>
          <p>Paste a YouTube video or playlist, an archive.org item, or a direct .mp4 link. It's added as Pending, then you review it.</p>
          <ActionForm action={quickAddAction} submitLabel="Add" pendingLabel="Fetching…">
            <label className="admin-field">
              <span className="admin-label">Link</span>
              <input name="url" required placeholder="https://www.youtube.com/watch?v=…" />
            </label>
            <div className="admin-row">
              <IndustrySelect />
              <TypeSelect />
            </div>
          </ActionForm>
        </section>

        <section className="admin-card">
          <h2>Refresh trending</h2>
          <p>Updates popularity from Internet Archive downloads{hasYouTubeKey ? " and YouTube views" : ""}. Trending rows and the hero use it.</p>
          <ActionForm action={refreshPopularityAction} submitLabel="Refresh now" pendingLabel="Refreshing…" />
        </section>

        <section className="admin-card">
          <h2>Import from YouTube</h2>
          <p>Only from the rights holder&apos;s official channel. Only public, embeddable, long videos are added.</p>
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
                <span className="admin-label">Min. length (min)</span>
                <input name="minMinutes" inputMode="numeric" placeholder="70 (5 for shows)" />
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
          <p>Public-domain candidates, most popular first. No key needed.</p>
          <ActionForm action={importArchiveAction} submitLabel="Import from Archive" pendingLabel="Importing…">
            <div className="admin-row">
              <IndustrySelect defaultValue="hollywood" />
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
      </div>

      <section className="admin-card">
        <h2>Saved sources (automatic fetching)</h2>
        <p>
          Save channels, playlists or searches and fetch new titles with one click, or on a schedule. New titles stay Pending unless the source is
          <strong> Trusted</strong>; trusted sources publish automatically. Only trust channels you have confirmed belong to the official rights holder.
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
                          {(s.kind === "youtube" ? "YouTube" : "Internet Archive") + " · " + (s.contentType === "show" ? "show" : "movies") + " · " + s.target}
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
                          <button type="submit" className="btn btn-xs" name="target" value={"trust|" + s.id}>
                            {s.trusted ? "Stop auto-publish" : "Trust"}
                          </button>
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
            <p className="admin-note">
              With CRON_SECRET set, a scheduler can call this URL. Example (Linux crontab, every 6 hours):
            </p>
            <code className="admin-code">
              {"0 */6 * * * curl -fsS -H \"Authorization: Bearer YOUR_CRON_SECRET\" " + siteConfig.url + "/api/admin/sync > /dev/null"}
            </code>
          </div>
        </div>
      </section>
    </div>
  );
}
