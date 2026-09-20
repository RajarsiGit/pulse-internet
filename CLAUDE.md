# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repository.

## What this project is

Pulse is a static, client-only React app that checks internet reachability and estimates connection speed using real HTTP transfers to Cloudflare's public speed-test endpoints (`speed.cloudflare.com`). There is no backend, no database, no auth, and no build-time secrets. See `README.md` for the full user-facing explanation, including a Mermaid diagram of the test flow.

## Commands

```bash
npm ci             # install exact dependency versions
npm run dev        # Vite dev server on port 4173
npm run build      # production build to dist/
npm run preview    # serve the production build locally
npm test           # Node's built-in test runner against tests/*.test.js
```

Node.js 20.19+ is required (see `engines` in `package.json`).

## Architecture

```
src/App.jsx          All UI: React state, layout, connection polling, WebMCP tool registration
src/network.js        All measurement logic: probing, latency/jitter stats, transfer workers, error mapping
src/main.jsx          React entry point (mounts <App/>)
src/styles.css        Tailwind import + theme tokens + component styles
tests/network.test.js Unit tests for src/network.js using isolated HTTP fixtures
public/favicon.svg    App icon
vite.config.js        React + Tailwind Vite plugins
```

This is intentionally a two-file architecture: `network.js` has zero React/DOM dependencies and is fully unit-testable in isolation; `App.jsx` owns all rendering and wires UI state to `network.js`'s async generators of progress updates. Keep that separation — measurement logic changes should not need to touch `App.jsx`, and UI changes should not need to touch `network.js`.

## Working in `src/network.js`

- Every network operation must be abortable via the `signal` parameter it's given, and must respect an already-aborted signal by throwing immediately (`checkAbort`).
- `TEST_LIMITS` caps total payload (64 MB download, 32 MB upload, 8s per phase). Don't raise these without a reason — they bound how much bandwidth a single test consumes.
- Upload bytes only count once the server acknowledges the request (`completed++` after `await response.arrayBuffer()`); don't change this to count optimistically, since that's what keeps the upload estimate conservative on unstable links.
- `validate()` is the only place that decides whether an HTTP response is usable (checks `ok`, redirects, and HTML content-type as a captive-portal signal). Route new failure detection through it rather than adding ad hoc checks elsewhere.
- Errors thrown from this module should be human-readable; `friendlyError()` in `App.jsx`'s call path is the last line of defense but individual `Error` messages here are shown directly to users, so write them for a non-technical reader.

## Global reach feature

`GLOBAL_LOCATIONS` and `checkGlobalLatency`/`pingLocation` in `src/network.js` measure round-trip latency to fixed servers (AWS S3 regional endpoints) in eight world regions, rendered by the `GlobalReach` component in `App.jsx`. Notes:

- Requests use `mode: 'no-cors'` deliberately — these endpoints don't grant CORS, and the goal is only to time the round trip via `performance.now()`, not to read the response body or status.
- Per-location failures (timeout, network error) resolve to `latency: null` rather than throwing, so one unreachable region never blocks the others. Only cancelling the overall `signal` should throw.
- If you add or change a location, keep the endpoint a real, fixed-geography server — this feature exists to show genuine measured latency by region, not decorative or simulated numbers (same "no silent success" principle as the main speed test).

## Working in `src/App.jsx`

- `runSpeedTest` reports progress via an `onUpdate` callback, not a return value — the UI is driven by these incremental updates (gauge, phase rail, throughput chart), not just the final result. Preserve this streaming behavior; don't refactor it into a single awaited result.
- A single `AbortController` (`controller.current`) represents "a test is running." Stopping, going offline, and starting a new test all funnel through aborting/replacing this controller. Don't introduce a second independent cancellation path.
- The WebMCP tool registration (`document.modelContext.registerTool`) is optional and defensive by design — it must never throw if the browser doesn't support it, and its two tools (`read_connection_test`, `run_connection_speed_test`) must keep accepting only `{}` as input.
- Reachability polling (`useConnection`) intentionally pauses while a speed test is busy, to avoid competing traffic skewing the speed measurement. Keep that coupling if you touch either.

## Testing expectations

- `tests/network.test.js` uses local HTTP fixtures (not the real Cloudflare endpoints) to exercise unit conversion, latency statistics, download/upload budgets, cancellation, timeouts, and full phase sequencing. Any change to `src/network.js` should keep or extend this fixture-based coverage — never point tests at the live Cloudflare endpoints.
- The shipped app always talks to the real endpoints; fixtures exist only under `tests/`.
- There is no separate lint or typecheck script configured; `npm test` and `npm run build` are the available verification commands.

## Conventions

- Plain JavaScript (`.js` / `.jsx`), no TypeScript.
- Tailwind CSS v4 via its official Vite plugin (`@tailwindcss/vite`), configured in `vite.config.js` and imported once in `src/styles.css`.
- Icons come from `lucide-react`; keep new icon usage consistent with that library rather than adding another one.
- Code in this repo favors dense, single-line component bodies over one-statement-per-line formatting — match the existing style in `App.jsx`/`network.js` rather than reformatting it wholesale.

## Things not to do

- Don't add a backend, proxy, or serverless function in front of the Cloudflare endpoints — that changes the network path being measured, which is the whole point of the app (see README "Design decisions worth knowing").
- Don't add analytics, cookies, local storage, or persistence of results — the app is explicitly stateless/privacy-minimal by design.
- Don't substitute estimated or interpolated values when a real measurement fails; surface an explicit error instead (see README "No silent success").
