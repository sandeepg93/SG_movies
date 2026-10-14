# OpenReel v2

Hollywood, Bollywood, Marathi and Tollywood films that are legally available to stream. Films play inside the site using the official players.

## Run

~~~bash
npm install
npm run dev
~~~

## Import films (as pending_review)

Hollywood classics from the Internet Archive (no key needed):

~~~bash
node scripts/import-archive.mjs --industry hollywood --rows 40
~~~

Official full-movie uploads from a rights holder's YouTube channel (free API key needed):

~~~bash
node scripts/import-youtube.mjs --key YOUR_KEY --industry bollywood --handle @OfficialChannel
node scripts/import-youtube.mjs --key YOUR_KEY --industry marathi --handle @OfficialChannel
node scripts/import-youtube.mjs --key YOUR_KEY --industry tollywood --handle @OfficialChannel
~~~

## Approve a film

In src/data/movies.json, set "rightsStatus" to "approved", fill in "rightsReviewedAt" (YYYY-MM-DD), "rightsReviewer" and "territories" (for example ["IN"]), and optionally set "featured": true. Then run "npm run build". If anything is missing, the build stops and tells you what to fix.
