# skysa-kit — instructions for Claude Code

The layers of a local-first app that do not care what its files hold, published as `@skysa/*` packages: storage adapters for Google Drive, OneDrive and Dropbox (WebDAV is deferred indefinitely, `docs/ARCHITECTURE.md` §5.4), the sync engine, the server that connects storage and mints tokens, the client's side of sync, and the PWA build.
They came from [skysa-notes](https://github.com/skysa-org/skysa-notes), which is built on them, as are its sister apps.
Read `docs/ARCHITECTURE.md` before any non-trivial task; it is the source of truth for the architecture, and it links the decision behind each feature in `docs/decisions/`.
Open work is in GitHub issues.
If a task requires deviating from it, say so and propose the edit to it, or to the decision record, in the same PR.

## Stack (do not substitute)
- pnpm workspace, one package per layer under `packages/`: `protocol`, `storage`, `sync`, `server`, `client`, `pwa` and `eslint-config` (`docs/ARCHITECTURE.md` §11).
- TypeScript throughout, ESM.
  Server: Hono on Cloudflare Workers, D1 via Drizzle.
  Client: a React peer for the one hook it has.
  PWA build: Vite and vite-plugin-pwa.
  Validation: zod.
  Tests: Vitest.
- Identity: there is none, and that is the design, not a gap — each connected storage account is its own silo, reached by a credential the device holds (`docs/ARCHITECTURE.md` §6, "Per-connection credentials").
  Do not add an identity layer, a `users` subject, or a second OAuth flow; if a task seems to need one, say so rather than building it.
  Storage OAuth is hand-rolled over Web Crypto and installs no dependency.

## Hard rules
- **Nothing in the kit names an app.**
  What is an app's own is handed in: its folder (`AppFolderSpec`), what its documents are (`DocumentFormat`), which hidden paths sync and which it watches, how two edits merge, its PWA routes and share target, its brand, and its device store, through the client's ports.
  A default that is one app's value is a bug.
- **Where each package runs.**
  `protocol`, `storage` and `sync` have no framework, DOM-only, or Node-only dependencies, and run in the browser, Node and Workers.
  A package imports another only through its entry, and only one its manifest lists; the `kit/edges` lint rule holds both.
- **The server reads no environment.**
  Everything in `@skysa/server` receives its configuration through `createApp(options)`; reading `process.env` or a Worker's env is the app's Worker entry's job, never the kit's.
- **A document's text is the only source of truth for it.**
  The engine moves it whole and asks the app's `DocumentFormat` only what that says.
  A document becomes dirty only on a user's edit, never on load or re-serialization.
- **Never lose user data.**
  On sync conflict, remote keeps the path; local is written as `<name> (conflict <timestamp>).<ext>`.
- **No document content is ever sent to or stored by the server.**
  Only tokens and connection metadata.
  (A WebDAV proxy would stream; it would not persist.)
- **Three kinds of secret, three homes, and one of them is a knowing compromise.**
  1. *Provider access tokens* — memory and the app's IndexedDB (`TokenStates`), never localStorage.
     Short-lived and re-mintable.
  2. *Refresh tokens and WebDAV credentials* — only ever encrypted in D1, decrypted only in `POST /api/token`, never returned to the client.
  3. *The per-connection credential* (`sk1_…`, `docs/ARCHITECTURE.md` §6) — generated in the browser, held in IndexedDB (`CredentialStore`), and sent to the server **only as its SHA-256**.
     The server never holds the plaintext: not in D1, not in a log, not in a `Location`, a `Set-Cookie` or a body.
     `packages/server/tests/connect.test.ts` proves it ("never says a credential or its hash back, anywhere in the flow") by generating a known secret and grepping every response in the flow; do not delete it.

  This third one replaced an `httpOnly` session cookie, and that is a real loss, stated plainly so nobody later reads this list as saying IndexedDB is safe.
  It is not.
  What keeps the trade honest is each app's `script-src 'self'` with nothing inline or eval'd, which is a hard requirement there; so nothing the kit puts in a page — the PWA build's tags, the service worker, any client code — may need an inline script, `eval`, or `new Function`.
  The `sk1_` prefix is the seam for a later proof-of-possession credential that would buy the property back.
- **No operator-specific or deployment-specific code.**
  Anything one deployment needs enters only through the `EntitlementProvider` and `RateLimiter` seams passed to `createApp`, the `ENABLED_PROVIDERS` and `RELAY` flags the app's Worker entry reads, the `RelayHub` seam, and the brand file the app's build reads.
- **What a user's library or a deployment's database already holds keeps working.**
  The marker's shape, conflict and file names, and the D1 schema are user data: a change to one comes with the way old data keeps working, and a migration is never edited once released.
- **Never commit secrets.**
- **Every provider adapter must pass `packages/storage/tests/providers/contract.test.ts`.**

## Working style
- Work one issue at a time, and check the change against `docs/ARCHITECTURE.md` before starting.
  Start in plan mode for anything touching more than one package.
- Prefer small PRs against `main`.
  Each PR: tests for new behavior, and an amendment to `docs/ARCHITECTURE.md` or the record in `docs/decisions/` if a recorded decision changes.
- Before pushing: `pnpm verify` (`format:check`, `lint`, `typecheck`, `knip`, `test`).
  CI runs the same, and checks the migrations against the schema.
- Docs are one sentence per line.
- When unsure about a provider API detail (scopes, endpoints, conflict semantics), check the current vendor docs rather than assuming; note the URL in a code comment.
- Do not add dependencies without stating why in the PR description.
  Check license: MIT, Apache-2.0 or ISC for anything that ships.
