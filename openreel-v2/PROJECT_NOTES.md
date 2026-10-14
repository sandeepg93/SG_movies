# OpenReel — Project Documentation & Chat Log

> Free, legal movie streaming website (Hollywood · Bollywood · Marathi · Tollywood)
> Built with Next.js 16 + React 19 + TypeScript. Documentation compiled 13 Oct 2026.

---

## 1. Project summary

OpenReel is a website for discovering and watching full-length films and shows that are **legally available to stream**: public-domain classics and official uploads by rights holders. Every title plays inside the site through the official player of its source (YouTube or the Internet Archive) or through OpenReel's own video player for directly hosted files.

**Core rule (from the original guide):** a video being online does not mean it may be redistributed. Every title needs a documented rights basis before it is published. Nothing goes live without an explicit "approved" status.

---

## 2. Conversation timeline

| # | Request | Result |
|---|---------|--------|
| 1 | Build the MVP from the "Free, Legal Movie Streaming Website" guide | Phase-1 Next.js app: catalog JSON, rights gate, search and filters, detail pages, rights/privacy/about pages |
| 2 | Provide a zip; better categorisation, year-wise and month-wise browsing, search, filters | `create-openreel.mjs` generator script (with `--zip`); category chips, grouping by year/month/decade, sort, grid/list view, URL-shareable filters |
| 3 | "Provide zip / each file downloadable" | Explained that this chat can't attach files; the generator script creates all files and the zip locally |
| 4 | Hollywood, Bollywood, Marathi, Tollywood with thumbnails; play on the same page with full controls; best UI | **v2** (`openreel-v2`): industry tabs, thumbnail cards, in-page player popup, custom player, hero, industry rows, YouTube and Archive import scripts |
| 5 | Errors: scripts not found, cross-origin warning | User was in the old `openreel` folder → use `openreel-v2`; added `allowedDevOrigins` |
| 6 | YouTube "API key not valid" | Placeholder key was used → steps to create a real key, `.env.local`, `--env-file` |
| 7 | "Other movies not showing", newest first, all categories | `update-sorting.mjs`: newest-first default, Latest row, category rows, "Other" category, Show all |
| 8 | Video quality selection, better player, hero with Trending / Latest / Shows / Movies | `update-v3.mjs`: quality menu (Auto + versions), subtitles, speed, shows with episodes, animated hero carousel, trending popularity |
| 9 | Admin side to manage and auto-fetch titles | `update-admin.mjs`: password-protected `/admin`, dashboard, editor, import tools, saved sources, trusted auto-publish, cron sync |
| 10 | Markdown file of the whole chat | This document |

---

## 3. Tech stack

- **Framework:** Next.js 16 (App Router, Turbopack), React 19, TypeScript 5
- **Styling:** plain CSS (`globals.css`, `enhancements.css`, `admin.css`); no UI library
- **Data:** JSON files on disk (`src/data/movies.json`, `src/data/sources.json`), read live by the server
- **Video sources:** YouTube embed (privacy-enhanced), Internet Archive files and embed, direct MP4/WebM
- **External APIs:** Internet Archive Advanced Search and Metadata API (no key); YouTube Data API v3 (free key)
- **Runtime:** Node.js 20.9+ (the user has Node 20.20 on Ubuntu)

---

## 4. Setting up from scratch (in order)

All scripts are saved in or run from `~/Documents/Project/`.

```bash
# 1. Create the base project (v2)
node create-openreel.mjs --zip
cd openreel-v2
npm install

# 2. Apply the updates (save each script inside openreel-v2 first)
node update-sorting.mjs     # newest-first + category rows
node update-v3.mjs          # quality player, shows, hero carousel, trending
node update-admin.mjs       # admin panel

# 3. Configure .env.local (see section 6), then run
npm run dev                 # http://localhost:3000  and  http://localhost:3000/admin
```

Production on your own server:

```bash
npm run build
npm start
```

---

## 5. Folder structure (final)

```
openreel-v2/
├── next.config.ts                 # security headers, allowedDevOrigins
├── .env.development               # PREVIEW_PENDING=true (dev only)
├── .env.local                     # your secrets (not committed)
├── scripts/
│   ├── import-archive.mjs         # CLI: import Internet Archive candidates
│   ├── import-youtube.mjs         # CLI: import official YouTube films / shows
│   └── refresh-popularity.mjs     # CLI: update trending numbers
└── src/
    ├── app/
    │   ├── layout.tsx, page.tsx, globals.css, enhancements.css
    │   ├── movies/[slug]/page.tsx       # film/show page (always live)
    │   ├── about/ rights/ privacy/      # info pages
    │   ├── api/sources/[slug]/          # quality list for Archive/direct videos
    │   ├── api/subtitles/[slug]/        # SRT→VTT subtitle proxy
    │   ├── api/admin/sync/              # cron endpoint (Bearer CRON_SECRET)
    │   └── admin/
    │       ├── actions.ts               # all admin server actions
    │       ├── admin.css
    │       ├── login/page.tsx
    │       └── (protected)/             # layout checks login
    │           ├── page.tsx             # dashboard
    │           ├── movies/new/page.tsx
    │           ├── movies/[id]/page.tsx
    │           └── import/page.tsx
    ├── components/
    │   ├── Catalog.tsx, Hero.tsx, RowCarousel.tsx, MovieCard.tsx, MovieGrid.tsx, MovieList.tsx
    │   ├── FilterPanel.tsx, ActiveFilters.tsx, PlayerModal.tsx
    │   ├── VideoPlayer.tsx, CustomVideoPlayer.tsx, Thumb.tsx, Icons.tsx, RightsNotice.tsx
    │   └── admin/ (ActionForm, MovieForm, LoginForm, ConfirmButton, SelectAll)
    ├── data/
    │   ├── movies.json            # the catalog (+ movies.json.bak backup)
    │   └── sources.json           # saved import sources
    ├── lib/
    │   ├── store.ts               # live file reading, safe atomic writes
    │   ├── catalog.ts             # public gate (approved only)
    │   ├── validation.ts          # record checks
    │   ├── filter.ts              # search, filters, sort, grouping, trending score
    │   ├── media.ts, archive.ts, dates.ts, format.ts, industries.ts, config.ts, contact.ts
    │   └── admin/ (auth.ts, form.ts, importers.ts, parse.ts, sync.ts)
    └── types/ (movie.ts, playback.ts, admin.ts)
```

---

## 6. Environment variables (`.env.local`)

| Variable | Required | Purpose |
|----------|----------|---------|
| `NEXT_PUBLIC_SITE_URL` | Yes in production | Public URL, e.g. `https://example.com` (also controls the secure cookie) |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Yes | Where rights and broken-video reports go |
| `ADMIN_PASSWORD` | For admin | 8+ characters |
| `ADMIN_SECRET` | For admin | Random string (`openssl rand -hex 32`) used to sign sessions |
| `CRON_SECRET` | Optional | 16+ characters; enables `/api/admin/sync` for scheduled syncing |
| `YOUTUBE_API_KEY` | Optional | YouTube Data API v3 key (imports, view counts) |
| `ADMIN_DEFAULT_TERRITORIES` | Optional | Default territories when publishing, e.g. `IN` |

`.env.development` contains `PREVIEW_PENDING=true`, so pending titles are visible locally with a banner. Production never shows them.

**Getting a YouTube key:** Google Cloud Console → create a project → enable *YouTube Data API v3* → Credentials → Create API key → restrict it to YouTube Data API v3.

---

## 7. Data model (one catalog record)

| Field | Notes |
|-------|-------|
| `id`, `slug`, `title`, `description` | Required; slug = lowercase letters, numbers, hyphens |
| `industry` | `hollywood` · `bollywood` · `marathi` · `tollywood` (Tollywood = Telugu) |
| `contentType` | `movie` (default) or `show`; shows use `episodes` |
| `releaseYear` / `releaseDate` | `1968` or `1968-10` or `1968-10-01` (month enables month-wise browsing) |
| `languages`, `genres`, `cast`, `director`, `runtimeMinutes` | Metadata; `genres` drive categories (empty → "Other") |
| `playbackType` | `youtube` · `archive` · `direct_video` |
| `playbackId` | YouTube ID (11 chars) or Archive identifier |
| `playbackUrl` / `videoSources[]` | Direct files; `videoSources` = several qualities `{label, url, height}` |
| `thumbnailUrl` | Optional; derived automatically for YouTube and Archive |
| `episodes[]` | For shows: `{id, title, season, episode, playbackType, playbackId, …}` |
| `popularity`, `trending`, `featured` | Trending score, pin to trending, home banner |
| `rightsStatus` | `pending_review` · `approved` (live) · `rejected` |
| `rightsBasis` | `public_domain` · `creative_commons` · `written_permission` · `license_agreement` · `platform_embed` |
| `territories`, `rightsReviewedAt`, `rightsReviewer`, `attribution`, `licenseUrl`, `rightsNotes`, `commercialUseAllowed` | Rights ledger fields; approved titles need a reviewer, a date and territories |

---

## 8. Features

### Public site
- Sticky header with industry links and site-wide search
- **Hero carousel** with tabs **Trending · Latest · Movies · Shows**: cross-fades with a slow zoom, staggered text, progress bar, thumbnail rail, swipe, arrow keys, pause on hover, dots on mobile
- Home rows: Trending now, Latest releases, Shows & series, one per industry, one per category (plus "Other")
- Browse section:
  - industry tabs; All / Movies / Shows switch; category chips with counts
  - search across title, cast, director, category, year and month
  - filters for language, decade, year, month and runtime; removable filter chips
  - group by industry, category, year, month or decade, with a "Jump to" bar
  - sort by Latest, Trending, Oldest, A–Z or length; grid or list view; 48 per page with Show more / Show all
  - the URL keeps the full state, so views can be shared
- Thumbnail cards with industry, duration, series and pending badges; clicking plays in a popup on the same page
- Film pages with clickable category, year, month, language, director and cast links, plus "More like this"
- Rights, privacy and about pages; reporting links for rights concerns and broken videos

### Video player
- **YouTube films:** official embed (quality, subtitles and speed are in YouTube's ⚙ menu; YouTube doesn't let other sites choose quality)
- **Internet Archive and direct files:** custom player with
  - ⚙ menu: **Quality** (Auto + every available version, HD badges, bitrate), **Speed** (0.25×–2×), **Subtitles** (Archive SRT/VTT), shortcuts help
  - Auto quality picked by screen size and connection, stepping down if the video keeps buffering
  - switching quality keeps your position
  - seek preview, buffering spinner, on-screen messages, resume where you left off
  - Picture-in-Picture, fullscreen
  - keyboard: Space/K, J/L, arrows, M, F, C, < >, 0–9, ?
  - double-tap left or right on phones to skip
- **Shows:** episode list with season picker, "Now playing" marker, automatic next episode

### Admin panel (`/admin`)
- Password login (signed http-only cookie, 12 hours, brute-force lockout)
- Dashboard: counts (Live / Pending / Rejected / Hidden), search and filters, thumbnails, one-click Publish / Pending / Reject / ★ / 🔥 / Edit / Delete, bulk actions
- Title editor: every field, automatic ID extraction from pasted links, thumbnail preview, quality versions, episodes, rights fields; validation errors listed before saving
- Import page:
  - Quick add from a link
  - YouTube import (channels and playlists, films or shows)
  - Internet Archive import
  - Refresh trending
- **Saved sources**: Sync now, Sync all, **Trusted** = auto-publish new titles; cron endpoint for scheduled syncing
- Live updates: the site re-reads the catalog whenever it changes; invalid titles are hidden (not crashed) and flagged; atomic writes with a `.bak` backup

---

## 9. Command-line scripts

```bash
# Internet Archive (no key)
node scripts/import-archive.mjs --industry hollywood --rows 40 [--page 2] [--query "..."]

# YouTube (key in .env.local)
node --env-file=.env.local scripts/import-youtube.mjs --industry marathi --handle @OfficialChannel
node --env-file=.env.local scripts/import-youtube.mjs --type show --industry marathi --playlist PLxxxx

# Trending numbers
node scripts/refresh-popularity.mjs
node --env-file=.env.local scripts/refresh-popularity.mjs   # includes YouTube views
```

Scheduled sync (crontab, every 6 hours):

```
0 */6 * * * curl -fsS -H "Authorization: Bearer YOUR_CRON_SECRET" https://your-site/api/admin/sync > /dev/null
```

---

## 10. Content and rights workflow

1. **Find:** import from the Internet Archive, or from an official YouTube channel or playlist (verified badge, owned by the studio or label).
2. **Review:** check the source, licence, uploader authority and territories. Indian films are generally out of copyright 60 years after release (1965 or earlier as of 2026), but songs and music may be protected separately.
3. **Publish:** set the status to Live in the admin (reviewer, date and territories are filled in).
4. **Automate (optional):** mark a verified official source as **Trusted** so future syncs publish automatically.
5. **Take down:** set the title to Reject or Pending; it disappears from the site immediately.

Never approve uploads from unofficial channels. Commercial use (ads) needs separate permission (`commercialUseAllowed`).

---

## 11. Problems hit during the project and their fixes

| Problem | Cause | Fix |
|---------|-------|-----|
| `Cannot find module scripts/import-archive.mjs` | Running in the old v1 `openreel` folder | Use `openreel-v2` (created by the v2 generator) |
| "Blocked cross-origin request … /_next/hmr" | Site opened via LAN IP `192.168.29.127` | `allowedDevOrigins: ["192.168.29.127"]` in `next.config.ts` |
| "YouTube API: API key not valid" | The placeholder `AIzaSy...yourRealKey` was used | Create a real key and put it in `.env.local` |
| Most imported films not visible | Rows capped at 20; browse sorted A–Z, 24 per page | Newest-first everywhere, Latest row, category rows, 48 per page + Show all |
| Bollywood/Marathi/Tollywood empty | No titles imported for those industries | Import from Archive (by language) or official YouTube channels |

---

## 12. Hosting notes and limitations

- The admin saves to `src/data/*.json`, which **needs a persistent disk**: your PC, a VPS, or a host with a volume. Serverless hosts (Vercel/Netlify) don't keep file changes, so switch storage to a database (e.g. Postgres on Neon) before deploying there.
- Vercel's free Hobby plan is for non-commercial use only.
- YouTube quality can't be controlled by other websites; the custom quality menu applies to Archive and direct files.
- The code was written carefully but **could not be compiled inside the chat**. Run `npm run build` after each update and fix anything it reports.

---

## 13. Possible next steps

- Move storage to Postgres (needed for serverless hosting, multiple admins, audit log)
- Add Tamil (Kollywood) or Bengali industries in `src/lib/industries.ts`
- User accounts, watchlists and "Continue watching" across devices
- Sitemap and SEO metadata for every title
- Automated tests (Playwright) for search, playback and the admin flow
