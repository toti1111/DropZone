# Community regression checks

These tools live under `tests/` and add no runtime dependency to the static site.
Use Node.js 22+ and Java 21+ for the Firestore emulator. Run from this directory:

```sh
npm ci
npm run test:ui
npm run test:offline
npm run test:rules
```

The test-only `.npmrc` preserves the application's exact Leaflet 1.9.4 /
markercluster 1.4.1 pair despite markercluster's old peer declaration. Dependencies
are pinned in `package-lock.json`. Chromium at `/usr/bin/chromium` is used when
available. Otherwise run `npx playwright install chromium`, or set `CHROMIUM_PATH`
to an existing Chromium executable.

## UI checks

`test:ui` compiles the site's Tailwind utilities and runs real headless Chromium,
Leaflet, markercluster and Font Awesome. Every browser request is intercepted.
Firebase is an in-memory mock, all map images are fixtures, and no production
Firebase request, authentication or write occurs. This validates browser behavior;
it does **not** validate deployed Firestore permissions or concurrent transactions.

The checks cover anonymous access controls, posts and selected existing spots,
plain-text XSS handling, likes/unlikes and notification deduplication, comments,
live counts, switching users, inbox unread/read state, notification navigation,
own-post removal, feed/comment pagination, new-post indicators, failed-publication
draft retention, pinned old-post updates, moving comment-query boundaries,
listener cleanup, zero uncaught page errors, and layouts from 320 to 1440 pixels.
Screenshots are saved to ignored `artifacts/community-{desktop,mobile}.png`.

## Composer and rules dialog

`community-composer.test.cjs` exercises the rules prompt before publishing, cancellation,
keyboard focus/shortcut, per-account remembered choices across reload, resetting that
choice, blocked browser storage, drafts restored in the same tab, clearing drafts on
account changes, double-click protection, reduced motion and compact mobile layouts.
Older regression fixtures represent users who have already accepted; these dedicated
cases start with no accepted preference and verify that no write happens before consent.

## Firestore rules checks

`test:rules` uses the local demo project `demo-dropzone` on `127.0.0.1:8085` and
loads the complete merged `../firestore.rules`. It does not deploy rules or target the live
project. The 18 community cases, 14 legacy spot/profile cases and 16 discovery/poll cases exercise authorized atomic writes and reject forged authors,
missing inbox events, fabricated counters, invalid rate records, repeated rapid
actions, private-inbox/profile reads, unauthorized deletion, and cross-user notification
spoofing. Legacy browser checks additionally verify spot favorites/comments and owner
notifications share one transaction without reading the owner’s profile, signed-in
fallback behavior, safely bound legacy reply/delete controls, and report-photo URLs. Tests also check self
interactions, like notification deduplication, and atomic comment boundaries.

The UI checks passed in the cloud workspace. The rules test source passed
`node --check`, but the rules suite **has not executed**: the network proxy denied
the official Firestore emulator download from `storage.googleapis.com` (CONNECT
403). Allow that domain in environment network settings or run the suite on a
machine with access, then inspect the actual results before deploying rules.
Package signatures, TLS, and artifact checks were not disabled.

For cloud machines with a restricted home directory, put CLI state under writable
paths without changing credential variables:

```sh
FIREBASE_EMULATORS_PATH="$PWD/.cache/emulators" \
XDG_CONFIG_HOME="$PWD/.cache/config" \
npm run test:rules
```

## Seven-feature integration checks

`new-features.browser.test.cjs` covers ten groups: physical filtering and old records,
pre-write duplicate confirmation, multi-stop route ordering/account-scoped storage,
private journal CRUD and explicit draft sharing, Turkish text/hashtag search, timed
polls and atomic voting/deletion redaction, local spot packs, compact mobile tools,
account switching during a pending private-share confirmation, and empty live-data
restoration after a downloaded package. These use the Firebase fixture and do not
prove deployed authorization.

`test:offline` separately runs five real service-worker groups on localhost. It
uses a fixture origin for public CDN assets, then turns the browser offline and
blocks all network before a cold new-page launch. It verifies missing dependencies
stay unready, recursive SDK asset caching, no private/auth/tile response caching,
restored IndexedDB public spots, and failure after clearing the shell cache.
It never uses production Firestore or downloads actual map tiles.

## Map tools and popularity regressions

`map-tools.browser.test.cjs` checks preview return without losing stops, numbered
map markers after reordering, actual Leaflet marker selection with duplicate and
10-stop limits, undo, journal draft preservation and account cleanup, more than
100 spot choices, mobile map controls, reduced motion, globally queried popularity
ordering, unique pagination and live ranking changes while reading. The mock uses
immutable snapshots and lexicographic multi-field cursors so mutable-like ranking
cannot pass by sorting the wrong key or silently updating old cursor snapshots.
Firestore index definitions must still be deployed separately; browser fixtures
do not prove that production indexes exist.
