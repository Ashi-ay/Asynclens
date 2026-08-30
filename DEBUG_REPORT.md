# AsyncLens — Debug Report

## The actual bug (this was the main one)

**`extension/manifest.json` never declared a background service worker**, but
`extension/background.js` existed and was supposed to own the WebSocket
connection. Without a `"background": { "service_worker": "background.js" }`
entry, Chrome never loads `background.js` at all — it's dead code.

That means `panel.js`'s `chrome.runtime.sendMessage({ type: "NETWORK_REQUEST", ... })`
call had **no listener on the other end**. It failed silently (Chrome sets
`chrome.runtime.lastError`, but that call had no callback checking it), so
network events were being dropped before they ever reached the dashboard.

I could have just added the missing manifest field, but that would only trade
one bug for another: Manifest V3 service workers are killed by Chrome after
~30s of inactivity and restarted on the next event. Every restart re-runs
`background.js` from scratch, calling `connectWebSocket()` again — while any
older socket may still be lingering. That produces exactly what you
described: bursts of duplicate events arriving close together, each carrying
its own freshly-generated random ID (since the ID is generated once in
`panel.js`), so the dashboard sees what look like several new, distinct nodes
for what is really one real request. The graph's physics simulation gets a
sudden burst of new nodes/links in one tick and visibly destabilizes.

**Fix:** `panel.js` now owns the WebSocket directly. The DevTools panel
document lives for as long as the panel is open — it is not a service worker
and Chrome does not evict it — so there is one connection, with one clear
lifetime, and nothing else can restart it out from under you.
`extension/background.js` was removed since nothing needs it anymore.

## Everything else that was fixed

| File | Problem | Fix |
|---|---|---|
| `extension/manifest.json` | Declared `"permissions": ["network"]`, which isn't a real Chrome permission | Removed. `host_permissions: <all_urls>` is kept for a future phase (see below) |
| `extension/panel.js` | Relayed through the dead background worker | Owns the socket directly; added reconnect backoff and a small queue so events captured during a brief disconnect aren't lost |
| `extension/background.js` | Dead code, never loaded | Removed |
| `dashboard/server.js` | Broadcast a message back to its own sender | Restored the `client !== ws` check |
| `dashboard/package.json` | Had an unused `@wordpress/scripts` dependency | Removed |
| `dashboard/index.html` | Two leftover comments (`// REPLACE WITH THIS:`, `// Find this inside renderStream():`) were pasted literally into the shipped code from a prior edit | Removed |
| `dashboard/index.html` | No duplicate-id protection — a repeated event would silently draw a second node | Added `nodeIds` Set + `addNodeSafe()`; any event whose ID has already been seen is skipped and logged instead of drawn |
| `dashboard/index.html` | A link could theoretically be pushed pointing at a node that doesn't exist yet, which the 3D force-graph library throws on | Added `addLinkSafe()`, which verifies both endpoints exist first |
| `dashboard/index.html` | No recovery if a single malformed event corrupted graph state | Wrapped the per-event handling in try/catch; on failure, `rollbackNode()` removes anything that event had just added (and any links touching it), so a broken node never persists — it can flash in but is torn back out immediately |

## New: Activity Log (right sidebar)

Added a second tab next to "Live Requests" called **Activity Log**. It's a
capped (300-entry), in-memory, temporary feed — cleared on "Purge Data" or
page reload, never persisted — showing every:
- node/edge created (`NODE` / `EDGE`)
- duplicate event skipped (`DUPE`)
- malformed event dropped (`BAD`)
- event rejected + rolled back (`FAIL`)
- connect/disconnect (`CONN`)

This is exactly the "log nodes and relationships temporarily, and have the
node disappear if it breaks" behavior you asked for.

## How to verify it yourself

1. `cd dashboard && npm install && npm start` → serves at `http://localhost:3000`
2. Load `extension/` as an unpacked extension in `chrome://extensions` (Developer
   Mode on)
3. Open `test-site/index.html` in a tab, open DevTools on that tab, go to the
   **AsyncLens** panel — status should read "Connected to Dashboard"
4. Open `http://localhost:3000` in another tab
5. Click **"Make 5 Requests"** on the test site — you should see exactly
   **one** new domain hub and **five** request nodes appear, no duplicates,
   no glitch. Check the Activity Log tab to see the five `NODE`/`EDGE` lines.
6. Click **"Trigger Failed Request (404)"** and **"Fetch with Secret
   Header"** — confirm the Authorization/Cookie headers show as
   `[REDACTED]` in the inspector.

## What I could not test in this sandbox

This sandbox has no network access, so I couldn't `npm install` and run
`server.js` live, and can't load an unpacked extension into a real Chrome
instance here. I did:
- Syntax-check every JS file (`node --check`)
- Extract and syntax-check the dashboard's inline `<script>` block
- Re-implement the exact dedupe/validation/rollback logic in an isolated
  Node script and run it against 5 test scenarios (single request, exact
  duplicate ID, malformed/no-URL event, a 5-request burst to one domain, and
  a forced broken-link case) — all passed as expected

You should still do the manual walkthrough above once, since that's the only
way to confirm the actual Chrome extension lifecycle behaves as expected.

## Follow-up fix: `Cannot set properties of null (setting 'onclick')`

This was a **separate, pre-existing bug** in your original file (not something
introduced by the first round of fixes). The CSS for `.graph-controls`
(the zoom +/−/reset buttons, bottom-left of the graph) was fully defined, but
the actual `<button id="zoom-in">` / `zoom-out` / `zoom-reset` markup was
never added to the page body. The script assumed they existed and threw the
moment it tried to attach a click handler to `null`.

Because that throw happened in the middle of the top-level inline script, it
silently killed **everything scheduled after it** too — the window `resize`
listener and the final `refreshGraph()` call never ran.

Fixed by:
1. Adding the missing button markup next to the graph.
2. Wrapping every `getElementById(...).onX = ...` assignment in a small
   `on(id, event, handler)` helper that checks the element exists first and
   just logs a console warning and moves on if it doesn't — so a single
   missing/renamed element can never again take down the rest of the script.


You mentioned earlier wanting promises/callbacks/retries captured, not just
network requests, and a 3D "parent → child → grandchild" hierarchy rather
than the current flat page → domain → request structure. Neither was in
scope for this debugging pass (you asked to verify what you'd built), but
the domain-hub layer already in place is the right foundation for that: a
request that's a *retry* of an earlier one, or a fetch made *inside* a
`.then()` callback, would become a child of that originating node instead of
a child of the domain — same `addNodeSafe`/`addLinkSafe` machinery, just fed
a different parent ID. Capturing promise/callback chains themselves needs a
content script injected into the page (that's what `host_permissions` is
still kept for) to monkey-patch `fetch`/`XHR`/`Promise`, which the DevTools
network API alone can't see.

## v2.0: replaced chrome.devtools with direct page instrumentation

This is exactly the follow-up described above.

**Why the DevTools panel had to go.** `chrome.devtools.network.onRequestFinished`
only reports requests that show up in the browser's own network timeline,
and only while the DevTools panel for that tab is open. It has no idea a
promise or callback exists, can't tell you a request was a retry of an
earlier one, and — worth calling out since you specifically asked about
React — has nothing to do with any framework; if requests weren't showing up
right, the actual culprit was almost certainly the promise/callback/retry
blindness above, not React itself. `extension/devtools.js`, `devtools.html`,
`panel.js`, and `panel.html` are removed; nothing needs them anymore.

**What replaced it.** Two content scripts, declared in `manifest.json`:

- `extension/inject.js` runs in the page's own JS realm (`"world": "MAIN"`),
  so it patches the *actual* `window.fetch`/`XMLHttpRequest`/`Promise` that
  the page's own code uses — including React's, or any bundler's, or
  anything else's, since there's only one `window.fetch` per page and this
  is it. Patching happens at `document_start`, before any of the page's own
  code runs, so it can't be initialized too late to see something.
- `extension/tracker.js` is a normal isolated-world content script that
  listens for what `inject.js` reports (via `window.postMessage`, since
  postMessage isn't blocked by CSP) and owns the actual WebSocket connection
  to the dashboard. This split matters: a script running in the page's own
  realm is subject to that page's Content-Security-Policy, so if it tried to
  open the WebSocket itself, a site with a strict `connect-src` could block
  it. Isolated-world scripts aren't bound by the page's CSP.

**What's now captured, beyond plain network requests:**
- **Causality.** A single mutable "current context" stack, pushed before
  invoking a timer/`.then()` callback and popped after. A fetch made inside
  another request's `.then()` (or inside a `setTimeout`/`setInterval`
  triggered by one) is tagged `parentId: <the ancestor's id>` and drawn as a
  child of it in the graph, instead of a disconnected node under the domain
  hub. Caveat carried over from the other AsyncLens build: this reliably
  covers `.then()`-chained code and synchronous callback re-entry, but plain
  `await nativePromise` chains aren't fully covered — V8 resolves native
  `await` through an internal path that bypasses `.then()`. Full coverage
  needs replacing the global `Promise` constructor (what zone.js does); ask
  if you want that.
- **Retries.** Each `(method, url)` pair's most recent outcome is tracked;
  a new request to the same endpoint within 30s of a failed one is tagged
  `retryOf: <original id>` and drawn as a distinct cyan-linked child of the
  original attempt rather than another loose edge off the domain hub.
- Request/response headers for `fetch` (same redaction policy as before).
  XHR header capture wasn't added — would need patching `setRequestHeader`
  too, which felt like scope creep for this pass; XHR requests still show up
  as nodes with timing/status, just without the Headers tab populated.

**Dashboard changes to match:** events now arrive in two phases
(`phase: "start"` when the call is made, `phase: "end"` once it resolves,
since duration obviously isn't known yet at `start`) rather than one
event per finished request. A node appears grey (pending) between the two.
`nodeColor`/`linkColor` and `handleIncomingEvent` were updated accordingly;
`addNodeSafe`/`addLinkSafe`/`rollbackNode` — the dedupe/validation/rollback
machinery from the first debugging pass — are unchanged and still guard
every new node/link the same way.

**Test site:** added two buttons — "Chained Fetch" (a `.then()` triggering
a second fetch, to see the causal parent/child link) and "Simulate Retry"
(a 404 followed by a real retry 1s later, to see the retry link).

**What I could not test in this sandbox:** same limitation as before — no
network access, no real Chrome instance. I syntax-checked every file
(`node --check`) and re-ran the dedupe/causality/retry decision logic
(`addNodeSafe`/`addLinkSafe`/parent-selection) against 5 scenarios in an
isolated Node harness — all passed. You should still do the manual
walkthrough (reload the unpacked extension, since the manifest changed;
`chrome://extensions` → the reload icon on the AsyncLens card) to confirm
the real page-instrumentation and postMessage relay behave as expected.

## v2.1: fixed "nothing until login" and the "unknown-origin" node

Both reported after testing against a real (frame-heavy, React-ish) portal.

**"unknown-origin" node.** `getDomain()` in the dashboard does
`new URL(url).hostname`, which throws on a *relative* URL
(`fetch('/rest/login')`, very common for an SPA calling its own backend) --
and the dashboard has no way to resolve that, since it runs on
`localhost:3000`, not on the page being inspected. Fixed at the source
instead: `inject.js` now resolves every URL to absolute
(`new URL(url, location.href).href`) before it ever leaves the page, for
both `fetch` and `XMLHttpRequest.open()`.

**Nothing until login.** Two compounding causes:
1. `inject.js` only patches `fetch`/`XHR`. Plain resource loads --
   `<script>`, `<img>`, `<link>` stylesheets -- never go through either, so
   if the pre-login page is mostly static assets with no AJAX, there was
   genuinely nothing to report. Added a `PerformanceObserver`-based pass in
   `tracker.js` that reads the browser's own resource-timing buffer (not
   subject to CSP, doesn't need MAIN-world access) for anything that isn't
   already reported by `inject.js`, restoring the "see everything" coverage
   `chrome.devtools.network` used to have.
2. Content scripts only injected into the top-level frame. Portals like
   this one are frequently frame-heavy (a login shell in the top frame,
   the real dashboard loaded into an iframe after auth) -- anything
   happening inside an iframe was invisible. Added `"all_frames": true` to
   both content script entries in `manifest.json`.

Trade-off worth knowing: `all_frames: true` also instruments any
third-party iframe on the page (ads, embedded widgets, analytics), which
means more noise in the graph, not just more of what you actually want to
see. If that gets in the way in practice, `manifest.json`'s `matches`
pattern can be narrowed to your specific site instead of `<all_urls>`.


