# skysa-kit — Architecture and decisions

The layers of a local-first app that do not care what its files hold: the storage adapters, the sync engine, the server that connects storage and mints tokens, the client's side of sync, and the PWA build.
An app built on them keeps its documents as files in an app-owned folder on the user's own cloud storage (Google Drive, OneDrive, Dropbox), and works offline against a store on the device.

They were written for [skysa-notes](https://github.com/skysa-org/skysa-notes), and moved here, with their history, so that its sister apps stop forking them ([its record 0018](https://github.com/skysa-org/skysa-notes/blob/main/docs/decisions/0018-the-shared-kit.md)).
This document is the source of truth for their architecture, and with the records in [`decisions/`](decisions/README.md), for the decisions behind it.
Update it when a decision changes.
It is not a to-do list: open work lives in GitHub issues.

**How to read it.**
The sections are skysa-notes' own, for the layers that moved, and they keep the numbers and anchors they have there: a citation in the code (`docs/ARCHITECTURE.md §7, "Merge before the copy"`) leads to the same text in both repositories, and a test checks that each one leads somewhere.
They speak of notes, notebooks and markdown, because that is the app they were written about.
For any app, a **note** is a document in the format the app hands in (`DocumentFormat`, §3), a **notebook** is a folder, and **the app** is whichever app is built on the kit.
Where a passage is about skysa-notes alone — its note format, its editors, its screens — it says so, or it cites skysa-notes' own document (`skysa-notes §7, "The scratchpad"`), which is where those sections stay.
A phase ("Phase 7") is a stage of skysa-notes' build, and an issue (`skysa-notes#118`) is one of its issues; [its history](https://github.com/skysa-org/skysa-notes/blob/main/docs/history.md) says what each phase was.

Every heading has an anchor that does not change with its number or its wording, such as `ARCHITECTURE.md#sync-loop-per-connection`, and a numbered one has its number as well (`#s7`, `#s5-1`).

---

<a id="core-decisions-settled"></a><a id="s1"></a>
## 1. Core decisions (settled)

| Decision | Choice | Why |
|---|---|---|
| Storage model | App creates and owns a dedicated root folder on each provider; never touches anything outside it | Keeps every provider on user-consent-only scopes; avoids Google restricted-scope (CASA) review |
| The app's own | The app hands the kit what is its own: its folder (`AppFolderSpec`, §3), what its documents are (`DocumentFormat`), which of its hidden paths sync, how two edits merge, its PWA routes and share target, its brand, and its device store, through ports | One kit for every app, with nothing in it naming one |
| Identity | Documents identified locally by UUID; remote identity is provider file id (Drive/Graph/Dropbox) or path (WebDAV) | Ids survive renames on id-based providers; WebDAV has nothing else |
| Backend | Hono + TypeScript on Cloudflare Workers, D1 via Drizzle | Tiny, streams bodies natively (WebDAV proxy), Workers-native |
| Packages | `@skysa/protocol`, `storage`, `sync`, `server`, `client`, `pwa` and `eslint-config`, at one version, released together (§11) | An app takes the layers it needs, and the layers cannot drift apart |
| Accounts | A device may hold several connected sources at once, each its own silo — its own documents, its own queue, its own credential — and shows one at a time | Nothing aggregates them, on the server or off it |
| Sign-in | There is none, and there will not be one. Identity *is* the storage connection: a connection is reached by the credential the device that made it holds, and nothing on the server knows that two connections belong to one person | Decided 2026-09-18 (§6, "No sign-in separate from storage"). Auth and data are coupled on purpose; a separate account layer would put a subject on the server that every privacy claim here then has to be re-argued around |
| Spelling | American English in comments and documents; identifiers, strings, and the legal texts (the CLAs, `NOTICE`, `LICENSE`) as they are | Decided 2026-11-10 for the kit. skysa-notes keeps its own spelling until it takes the kit (its record 0018, step 3), so a change brought across from it before then is respelled on the way; the docs test says where one was not |
| Distribution | Public packages on npm, from a public repo. No operator-specific configuration or credentials in the tree | Every app built on the kit, and every deployment of one, starts from the same code |
| License | AGPL-3.0 — version 3 only, SPDX `AGPL-3.0-only` — with the same CLA as skysa-notes | The server is where the network clause matters ([skysa-notes' record 0018](https://github.com/skysa-org/skysa-notes/blob/main/docs/decisions/0018-the-shared-kit.md)) |
| Provider enablement | `ENABLED_PROVIDERS` env selects which of `gdrive,onedrive,dropbox,webdav` an instance offers | Operators who disable WebDAV remove the only path where content transits the server and the only SSRF surface |
| Document content | The server never stores document content, only tokens and connection metadata. For OAuth providers content never transits the server at all; WebDAV content streams through the proxy and is never persisted | Core privacy promise |
| Token flow | Backend does Authorization Code + PKCE with every OAuth provider, stores refresh tokens encrypted, mints short-lived provider access tokens for the client; **client talks directly to provider APIs for file content** | Uniform auth across providers, no client secrets in bundle, no file bytes through our server (except WebDAV) |
| Offline | Full read/write offline against the device's store; the sync queue drains when online | It's a PWA; sync is a background concern |
| Conflicts | Never lose data. On conflict, keep the remote version at the original path and write local as `<name> (conflict <YYYY-MM-DDTHH-mm>).<ext>` | Simple, predictable, recoverable |

Rows above that mention WebDAV describe the deferred design (§5.4); nothing in the repo implements it.

---

<a id="architecture-overview"></a><a id="s2"></a>
## 2. Architecture overview

```
┌──────────────────────────── Browser (PWA) ────────────────────────────┐
│  The app's UI                                                          │
│   └─ The app's store (behind ClientStore) ── Sync engine ── Provider adapter │
│                                              │                         │
│  Service worker (Workbox via vite-plugin-pwa): app-shell cache, bg sync │
└──────────┬───────────────────────────────────┼─────────────────────────┘
           │ sk1_ credential (bearer)          │ provider access token (bearer)
           ▼                                   ▼
┌── Backend (Hono on CF Workers) ──────┐   ┌── Provider APIs ──────────────┐
│  /api/auth/*      OAuth start/callback│   │  Google Drive v3 (CORS ok)    │
│  /api/connection  one silo's state   │   │  Microsoft Graph (CORS ok)    │
│  /api/token       mint access token  │   │  Dropbox v2 (CORS ok)         │
│  /api/webdav/*    proxy (CORS shim)  │──▶│  WebDAV server (via proxy)    │
│  D1: storage_connections, grants     │   └───────────────────────────────┘
└──────────────────────────────────────┘
```

The kit is everything here but the app's UI and its store: the adapters (`@skysa/storage`), the engine (`@skysa/sync`), the client that schedules it and holds the device's credential and tokens (`@skysa/client`), the Worker as a library (`@skysa/server`), and the service worker's and manifest's build (`@skysa/pwa`).
The app writes its own Worker entry, which hands `createApp` its configuration.

Key property: the backend is only required for (a) connecting/refreshing an account and (b) WebDAV, which is deferred (§5.4).
Where an operator turns it on, it also (c) relays a content-free "something changed" between a connection's devices (§6, "Change relay"); without it, or with it down, devices find each other's changes by polling, as they always have.
Once a client holds a valid access token it syncs peer-to-provider.
If the backend is down, the app still works offline and can sync to OAuth providers until the access token expires.

---

<a id="note-format-and-directory-layout"></a><a id="s3"></a>
## 3. The app folder

What a document *is* — its format, how it is read and written — is the app's ([skysa-notes §3](https://github.com/skysa-org/skysa-notes/blob/main/docs/ARCHITECTURE.md#s3) for notes).
What the kit relies on is below.

**The folder is the app's, and handed in.**
One folder per connection, made by the app at the top of the user's storage, or given to it by the provider (OneDrive's and Dropbox's app folders, §5).
Its name, its marker file's name, the app name the marker records, its schema version, and the tag Google Drive finds it by are an `AppFolderSpec` (`packages/storage/src/folderSpec.ts`), which the app hands the adapters rather than their importing it.
Each value is user data once a library is connected — a library is found by them — so an app pins them with a test and never changes them.

**The marker**, written by `ensureRoot()` on first connect and never modified by the sync engine afterward (a new device does not overwrite it):

```json
{
  "schemaVersion": 1,
  "app": "skysa-notes",
  "createdAt": "2026-09-14T13:02:11Z",
  "createdBy": {
    "appVersion": "0.1.0",
    "provider": "dropbox",
    "clientId": "018f3c4e-...",       // random UUID per browser install, stored in the device's store
    "userAgent": "Mozilla/5.0 ..."
  }
}
```

`createdBy` exists only for debugging (which install created this folder, with what version).
It contains no account identifiers.
`schemaVersion` gates future layout migrations; if a client sees a higher version than it understands, it opens read-only.

**A document is a file in the app's format** (`DocumentFormat`, `packages/storage/src/documentFormat.ts`): its extension, its media type, and how to read and write the id it carries.
A file the app wrote carries its `id` (skysa-notes keeps it in frontmatter), and adopting it is what makes two devices agree about which document a file is (§7, "An id in a file is adopted only if nothing else holds it").
An id the app cannot use is declined and left exactly as written.
Every other file in the folder is a **file beside a document**, mirrored and never read as one (§7).

**Hidden paths.**
Anything starting with `.` is hidden: the marker, and whatever the app keeps for itself.
The engine syncs a hidden path only where the app's `syncsHidden` says it does, and reports the ones the app watches (`watch`, §7).

**Files beside documents** (2026-10-03, skysa-notes#187).
An app that puts a file beside a document names it by its content: `<slug of its name>-<first 8 hex of its SHA-256>.<ext>`, with 16 hex where the 8 are already taken by a file of another size (`names/`).
So the same file added twice under one name, here or on another device, is one name and one file, and an upload that finds its own name taken can tell its own earlier upload from someone else's file by the size (§4, `createFile`).
The stem is cut to leave a conflict suffix room inside the 255 bytes a name may have, and the extension is never the documents' own: a file by that name is a document to every device.
Each adapter sends such a file in one request, up to sizes past anything an app sends (§5).

---

<a id="provider-adapter-interface"></a><a id="s4"></a>
## 4. Provider adapter interface

Every provider implements this.
The sync engine only talks to this interface.

```ts
export interface RemoteEntry {
  remoteId: string;        // provider file id; the path itself on WebDAV
  path: string;            // relative to app root, POSIX separators, normalized
  kind: 'file' | 'folder';
  version: string;         // etag / rev / cTag / headRevisionId — opaque, compare for equality only
  modifiedAt: string;      // ISO
  size?: number;           // bytes; on every file entry, a ConflictError's remote too; absent for folders
}

/** What read/move/delete need, which is all the local store keeps. */
export type EntryRef = Pick<RemoteEntry, 'remoteId' | 'path'>;

/** A path, an id, or both: Dropbox's DeletedMetadata has no id, and an id feed may know no path. */
export type DeletedEntry =
  | { path: string; deleted: true; remoteId?: string }
  | { path?: undefined; deleted: true; remoteId: string };

export type ChangeEntry = (RemoteEntry & { deleted?: false }) | DeletedEntry;

export interface ChangeSet {
  entries: readonly ChangeEntry[];
  cursor: string;          // opaque; persist per connection
  more: boolean;
}

export interface WriteOptions {
  /** Omitted means "create": a file already there is a ConflictError. */
  expectedVersion?: string;
}

export interface CreateFileOptions {
  /** Recorded where the provider keeps one (Drive's `mimeType`); decides nothing here. */
  contentType?: string;
}

export interface StorageProvider {
  readonly kind: ProviderKind;
  /** Whether `list` reports everything a folder holds. False on Drive (§5.1). */
  readonly listsEverything: boolean;
  /** Where that is false, marks a folder emptied here instead of deleting it (§5.1). */
  readonly leaveFolder?: (entry: EntryRef) => Promise<void>;
  readonly ensureRoot: () => Promise<{ rootId: string }>;
  readonly list: (folderPath: string) => Promise<RemoteEntry[]>;
  readonly read: (entry: EntryRef) => Promise<{ content: string; version: string }>;
  readonly write: (path: string, content: string, opts: WriteOptions) => Promise<RemoteEntry>;
  readonly readBytes: (entry: EntryRef) => Promise<{ bytes: Uint8Array; version: string }>;
  readonly createFile: (path: string, bytes: Uint8Array, opts?: CreateFileOptions) => Promise<RemoteEntry>;
  readonly createFolder: (path: string) => Promise<RemoteEntry>;
  readonly move: (entry: EntryRef, newPath: string) => Promise<RemoteEntry>;
  readonly delete: (entry: EntryRef) => Promise<void>;
  readonly changes: (cursor?: string) => Promise<ChangeSet>;
}

export class ConflictError extends Error { constructor(readonly remote: RemoteEntry) { … } }
export class AuthError extends Error {}          // engine asks the backend for a fresh token
export class NotFoundError extends Error {}      // entry gone, or expectedVersion for an absent path
export class CursorResetError extends Error {}   // cursor unusable; discard it and full-scan
export class UnreadableError extends Error {}    // the file is there and is not UTF-8 text; carries the path asked with
```

Three shapes differ from the sketch this section used to carry.
Members are property signatures rather than methods, which is both the house style (`EntitlementProvider`) and what `functional/prefer-property-signatures` requires.
`kind` reuses `ProviderKind` from `providerKinds.ts` so `PROVIDER_KINDS` stays single-sourced with the marker schema.
And `read`/`move`/`delete` take an `EntryRef`, not a whole `RemoteEntry`: a note record persists only `remoteId`, `remoteVersion` and `path`, so passing the full entry would have every caller inventing a `kind` and a `modifiedAt` — and let an adapter come to depend on the invented value.

`NotFoundError` and `CursorResetError` are additions.
A cursor can go stale on every provider (Dropbox answers `reset`, Graph `410 resyncRequired`, WebDAV invalidates its sync-token) and without a type for it the engine cannot tell a dead cursor from a transient failure, so it retries forever.
`NotFoundError` is what lets `ConflictError.remote` stay non-optional.

Each error carries a `code` alongside its class, and ships with an `isXError` guard.
`instanceof` is the ergonomic check and is correct today, since `@skysa/storage` resolves to one module per bundle; the code keeps the guards honest when a consumer ends up holding two copies of it either side of a sync boundary, which a published package makes possible.

Semantics the signatures do not carry:

- `listsEverything` is what the engine asks before removing a folder because a listing showed it empty (§7).
  It is false on Google Drive alone: `drive.file` shows the app only the files it created, so a folder that lists empty may hold a file the user put there, and deleting it would take that file.
  Every other capability question is answered by behavior rather than a flag; this one cannot be, because the wrong answer is silent and costs a file.
- `write` is create-or-update, never a blind overwrite.
  No `expectedVersion` means "I expect nothing here" — literally WebDAV's `If-None-Match: *` — so a file already at that path is a `ConflictError`.
  That is what makes §7's rule of re-creating on push a dirty note deleted remotely safe: if the file came back in the meantime the write conflicts instead of clobbering it.
  An `expectedVersion` for a path with no file is a `NotFoundError`.
- `createFolder` and `delete` are idempotent, so a queued op is always safe to replay.
- `move` may or may not change `version` — Dropbox's `rev` survives it, OneDrive's `eTag` does not — so the caller stores the returned entry rather than assuming either way.
  `remoteId` survives a move on every id-based provider; on WebDAV it *is* the path and so cannot, which is why renames there are re-linked through frontmatter `id`.
- A deletion is identified by its id when it has one and by its **path** when it has not.
  Dropbox's `DeletedMetadata` carries a name and a path and nothing else — no id, no rev, no timestamp — so `ChangeEntry` is a union rather than an entry with a flag.
  Anything richer would have adapters fabricating fields and the engine trusting them.
  And the path may be missing where the id is not: an id feed asked about a file its tree never placed — one this device pushed after its cursor, deleted by another device before this one pulled again — has no path to give, and dropping the deletion leaves the note on this device forever.
- `list` is one level.
  `changes` covers the whole tree at every depth.
  Neither filters hidden paths: the marker has to reach the engine, and an app's screens filter for themselves (skysa-notes' `isPassedOver`).
- `rootId` is opaque, non-empty and stable.
  A provider whose root has no id of its own — a Dropbox app folder, where the root simply *is* `/` — returns a synthetic constant.
- Content is UTF-8 text, and `read` says when it is not.
  The body is taken as bytes and decoded strictly (`providers/text.ts`); bytes that are not UTF-8 are an `UnreadableError` carrying the path, never text with U+FFFD where the bytes were.
  A lossy decode looks like a note, and the first push then writes the damage over the original.
  Text holding a U+0000 is refused the same way: UTF-16 without a BOM, and most binaries, are valid UTF-8 to a decoder with a NUL for every other byte, and markdown never carries one.
  A UTF-8 BOM is stripped, as `response.text()` always did, so hashes do not move; it is still lost on the first push, as it always was.
  A probe that only asks whether a file exists takes `UnreadableError` for yes (§7).
  That is `read`, and `read` is for notes.
  Every other file — an attachment beside the note that links it (skysa-notes#187) — goes through `readBytes`, which hands the bytes over exactly as stored, a BOM included, and never raises `UnreadableError` (2026-10-03).
  Each adapter's `read` is its `readBytes` decoded, so the two agree on what is there and on every other error.
- `createFile` is create-only, and there is no update to go with it: the app never writes into a file that is not a note, and a name stamped with the file's content (skysa-notes#187) is never asked to hold other bytes.
  A file **or a folder** already at the path is a `ConflictError` whose `remote` carries its `kind` and, for a file, its `size` — what lets an upload that finds its own name taken tell its own earlier upload (the same size, under a name made from a hash of the bytes) from someone else's file.
  A missing parent may be `NotFoundError` or may be made, as for `write`.
  `contentType` is recorded where the provider keeps one and decides nothing; the extension is what the app reads.
  Every adapter sends the bytes in one request: a provider takes at least 150 MiB in one everywhere but Drive, which over 5 MB wants a resumable session, also sent in one `PUT` (§5.1).
- No `AbortSignal` in the adapter interface: operations are short and the engine discards results it no longer wants.
  **But the `fetch` an adapter is given is canceled with its session (2026-09-23).**
  The web app's `timedFetch` (`packages/client/src/sync/providers.ts`) combines each request's own 60 s timeout with the scheduler session's signal, so ending a session — Cancel on an import, a disconnect, a switch of source — stops a download in flight instead of leaving it to run out its timeout.
  The contract is unchanged; an adapter sees an aborted `fetch` as the network error it is.
  **The timeout grows with the bytes (2026-10-03, skysa-notes#187).**
  A minute is a note's upload or a page of changes on a slow connection, and a 25 MB attachment at the 50 KB/s the app still means to work on takes over eight.
  So a request gets 1 ms per 50 bytes it sends or receives on top of the minute: what it sends from the start, and what its answer holds from when the answer begins — the bytes its `Content-Length` says, at once, or, where it gives none (Dropbox does not promise one), each chunk as it arrives, so a download that keeps coming is never cut off for want of a header and one that stalls still is.
  The answer adds to what is left rather than replacing it, so a large upload answered late keeps the time it earned, and a download keeps the rest of its minute as slack.
  A note or a page of changes keeps the minute, give or take a millisecond.
  What the bytes earn is credit spent when the timer comes due, so the deadline only moves later and no clock is read: a wall clock that jumps cannot bring it on early.
- A provider asking us to slow down is `RateLimitError`, with the `retryAfterMs` it gave: Dropbox and Graph answer 429, Graph also 509 for the bandwidth cap, and Drive a 403 whose reason names the quota (`rateLimitExceeded`, `userRateLimitExceeded`, `dailyLimitExceeded`, `sharingRateLimitExceeded`).
  **A 503 is not a rate limit, `Retry-After` or not.**
  Graph's throttling guidance names one status — "use the HTTP error code 429 to detect throttling" — and its error table calls 503 "temporarily unavailable for maintenance or is overloaded" whose delay is "the length of which can be specified in a `Retry-After` header".
  So the header does not tell an outage from throttling: both carry one.
  Since a rate limit is not counted against the op (§7), a 503 read as one would retry forever — never blocked, never surfaced, with every op behind it waiting — so it stays the counted failure any other 5xx is.
  Drive's newer error bodies put the condition in `error.status`, and `RESOURCE_EXHAUSTED` there is read as a quota **only where Drive gave no `errors[]` reason at all**: the reason is the more specific answer and some are deliberately left out, `storageQuotaExceeded` above all, which is a full Drive that no wait fixes and which `google.rpc.Code` gives the same `RESOURCE_EXHAUSTED` as a per-user quota.
  (Drive's errors page documents no `status` field; whether it ever sends one is on the Phase 4 live-check list.)
  `Retry-After` is read as seconds or as an HTTP date: seconds is what Graph documents and a date is legal (RFC 9110 §10.2.3) and is what some fronts send, so both are read, and of a value `Headers.get` has joined from a header sent twice ("7, 30") the *longer* wait is taken — coming back early is refused again, coming back late costs only the wait.
  Dropbox's `retry_after` comes out of the JSON body instead; an unreadable value says nothing rather than zero, and the caller falls back to its own backoff.
  It is a type of its own for two reasons: it says nothing about the request, so the engine does not count it against the op's attempts (§7), and the provider's own answer for how long to wait beats any backoff we could guess.
  Other transport failures (5xx, a dropped connection) stay plain errors on the engine's per-op backoff.

Adapter contract tests: the scenario suite is `describeProviderContract(name, harnessFactory, { stableIds })` in `packages/storage/tests/providers/contract.ts` — a helper rather than a test file, so Vitest's `tests/**/*.test.ts` glob does not collect it on its own.
`tests/providers/contract.test.ts` is the registry every adapter is added to: the in-memory fake in CI, and live accounts via `PROVIDER_LIVE_TESTS=1` locally.
Each HTTP adapter is one row of a table there, which registers it over its wire stub at one entry per page and at full pages, and against a live account when its token is given.
The stubs share how they answer and record a request (`tests/providers/harness.ts`).
`stableIds: false` exempts path-based providers from the move-preserves-id scenarios.

Scenarios: idempotent `ensureRoot` including write-the-marker-only-if-absent, path normalization at the adapter edge, byte fidelity on read-back, the four `write` cases above, one-level `list` including hidden entries, idempotent `createFolder`, the root (a note or file written at it, or a move onto it, is a `NotFoundError`, and `createFolder('')` answers it as a folder already there — Dropbox had no guard, and its stub now refuses a write path `files.stone` does not allow, as Dropbox does), move (file, into a folder, whole folder rebasing its descendants, onto an occupied path), idempotent recursive `delete`, and a `changes` feed that scans current state on a cold start rather than replaying history, reflects each step, survives being persisted, and is drained through its `more` loop.
And a file that is not UTF-8 text: `read` is an `UnreadableError`, while `list`, `changes`, `move` and `delete` treat it as any other file and leave its bytes as they were.
No adapter can rewrite a file with such bytes, so the harness may offer a way in underneath (`plant`, `bytesAt`) — the fake's `plantBytes` — and a live registration, which has none, skips these.
And a file that is not a note, through the port alone so that a live account runs it too (2026-10-03): every byte value, an empty file and a 6 MB one (over Drive's multipart limit) come back byte for byte, at the version `createFile` reported; `readBytes` keeps a BOM; `read` of one is an `UnreadableError`; `createFile` over a file, a note or a folder is a `ConflictError` whose `remote` says what is there — its kind and, for a file, its size — and leaves it as it was; it is listed and in the feed with its size in bytes; and it moves with its bytes, and once deleted is `NotFoundError` to `readBytes`.
The wire stubs read every request body as bytes (`tests/providers/wireBody.ts`) and refuse one they cannot read: they used to take anything but a string as empty, so an upload of bytes would have arrived as an empty file with every test passing.

The in-memory fake in `src/providers/fake.ts` — reached by tests as `@skysa/storage/testing`, with the three provider stubs (the store contract is `@skysa/sync/testing`'s), and never by anything that ships — is deliberately the strictest provider in the repo: where this section leaves a case open it takes the least forgiving reading, because a lenient fake lets the engine grow assumptions that only fail against a real account.
It never creates a missing parent, re-versions even a byte-identical write, and never reuses an id.
It holds every file as bytes, whichever method wrote it, so a stub can hand any upload to it; its `createFile` is as strict as `write`'s create, and `plantBytes` — another tool saving over whatever is there, with no version check — is for tests alone.
Its `pageSize`, `folderChanges` and `setFault` options are what let the engine's drain loop, folder rebasing, and auth-retry paths be tested at all.

---

<a id="provider-specifics"></a><a id="s5"></a>
## 5. Provider specifics

<a id="google-drive"></a><a id="s5-1"></a>
### 5.1 Google Drive
- Scope: `https://www.googleapis.com/auth/drive.file` plus `openid email` for identity.
  Non-restricted; standard OAuth verification only.
- Root: a folder `APP_FOLDER_NAME` (mimeType `application/vnd.google-apps.folder`) at the top of My Drive, tagged `appProperties: { notesapp: "root" }` and found by that tag, never by name, so a user who renames or moves it keeps their notes, whatever it is called.
  The key is the app's (`AppFolderSpec`'s `driveTag`, §3), and skysa-notes' is `notesapp`.
  **Only `ensureRoot` and a round from nothing make one**: a pull on a stored cursor, and every read and write, only look (a search that misses the folder for a moment is an error to retry, never a second folder).
  Where one is made, the search is asked again, and every tagged folder but the earliest is folded into it — what is inside moved across (the marker trashed instead where the earliest has one), and a folder put in the trash only when a fold finds it already empty, since a device whose last pull was against it may still be writing into it; that device's next pull resets and folds again.
  That settles two devices connecting at once, and a folder restored from the trash beside the one made while it was gone, with nothing written to either left unread; names that meet in the move are separated by the scan that follows.
  A pull on a stored cursor is reset (`CursorResetError`) when an earlier tagged folder exists, when the folder is trashed or gone (asked of the folder itself when the search does not list it), or when the feed says so — read from `removed` and `trashed` as Drive sent them, not from the tree, which takes a name no path can hold as gone.
- Names are not unique on Drive: a folder may hold two `a.md`.
  A path is resolved by walking names from the app folder (`name = '…' and '<parent>' in parents and trashed = false`, with `'` and `\` escaped, compared exactly afterwards), and where a name matches more than once the **canonical** item — earliest `createdTime`, then lowest id — is what the path means, on every device.
  No id cache: one would send a write into the wrong folder after a remote rename, and notes sit a few levels deep.
- Nothing on Drive is conditional: v3 has no `If-Match` and nothing like create-if-absent.
  - Create: look up the name (taken → `ConflictError`, parent missing → `NotFoundError`), upload with `POST /upload/drive/v3/files?uploadType=multipart` (`text/markdown`, the media type of `NOTE_FORMAT`, the document format the adapter is handed; bytes exactly as given), then **search again**: if another device's file of that name was made earlier, ours goes to the trash (a third device may already have written into it) and `ConflictError` names theirs, so the engine makes its conflict copy.
    A folder is made the same way, and one that exists already is returned.
  - A file that is not a note (`createFile`, 2026-10-03, skysa-notes#187): the same look, create and look again, with the bytes as the multipart body's second part and the given type as its `mimeType` (`application/octet-stream` if none).
    Over 5 MB, where Drive's guide stops recommending multipart, it is a resumable upload instead — for a note that size too, which goes the same way: `POST …?uploadType=resumable` with the metadata, then every byte in one `PUT` to the `Location` that answers it (https://developers.google.com/workspace/drive/api/guides/manage-uploads).
    That `Location` is used only on `www.googleapis.com` — the host the token is for, and the one `connect-src` allows — and refused anywhere else rather than sent the token.
    The `PUT`'s answer is not relied on to carry the fields the session asked for, so a file with no `headRevisionId` in it is asked for by id.
    **Two things to check against a live account** before attachments are built on this: that Drive exposes `Location` to a page on another origin (CORS hides a header it was not told to expose, which reads as `null`, and the upload then fails with nothing sent), and that `?alt=media` for a file of several megabytes is still served from `www.googleapis.com` rather than redirected (below).
  - Update: by id, never by path — a file deleted since the caller saw it is `NotFoundError`, never made again.
    `headRevisionId` is compared with the expected version (`ConflictError` if it moved), then `PATCH /upload/drive/v3/files/{id}?uploadType=media`.
    A write landing between the two is overwritten; the next `changes` pass reports the result.
    Nothing written on this device is lost, and what the other device wrote in that moment may be — inherent to v3.
  - Move: `PATCH files/{id}` with `{ name }`, and `addParents`/`removeParents` only when the folder changes.
    The destination is looked up first, so a replayed move returns without a `PATCH`.
  - Delete: `PATCH { trashed: true }` — to the trash, not gone for good, so the user can restore a note from Drive as from OneDrive's recycle bin.
    A 404 is success.
- Reading: `GET files/{id}` for `headRevisionId`, **then** `?alt=media`, both on `www.googleapis.com` with the token.
  In that order the version reported is never newer than the bytes; Drive can download a past revision only if it was kept forever, so the two cannot be pinned together.
- Version: `headRevisionId`, which changes with content and not with a rename or a move (like Dropbox's `rev`).
  Folders have none.
  A file with none (a Google Docs file, which this app never makes) is left out of `list` and `changes`.
- Changes: the cursor is JSON `{ v, phase, token, start, root, nodes, pending, walked? }`, the tree kept in `packages/storage/src/providers/idTree.ts` as for OneDrive (§5.2).
  A round from nothing asks `changes.getStartPageToken` **first**, then scans `files.list q=trashed = false` — every file the app can see, which under `drive.file` is every file it made — and follows `changes.list` (`includeRemoved`, `newStartPageToken` ends a round) from that token after.
  A `removed` change (deletion or loss of access) or a file with `trashed` (set too when a folder above it is trashed) is gone.
  On a stored cursor, a 404, a 410, or a 400 whose error names the page token (in `location`, reason or message) is `CursorResetError`; any other 400 is a failure to retry, not a rescan.
  What Drive actually answers for a dead token is undocumented.
- **A long feed becomes a scan (2026-10-14).**
  Reported from a phone: "Checking for changes…" took a long time and found little, and pausing it for a full re-scan was quicker.
  Measured on that Pixel against the live account: after a day away, with the account busy elsewhere, the round read **60 empty pages** of `changes.list` before the 16 holding the notes another device had imported.
  That was about 45 s with nothing found.
  A check straight after a sync was one page, 0.7 s.
  `drive.file` hides every change the app cannot see, but Drive still pages through them, so a feed round grows with the whole account's activity since the last look, while a scan lists only the app's own files, a page per thousand.
  Two changes.
  First, the app folder is looked for **once a round**, at its first page, not before every page: that search was half of each page's cost (about 0.34 s of 0.7 s).
  Mid-round the feed itself reports the folder going to the trash (`rootGone`).
  A cursor stored mid-round and read by another session, which has not looked this round, looks again.
  Second, a feed round that has read **twice the pages a scan would take, plus two** (`feedLimit`: the tree's size, a thousand a page), and has not ended, throws `CursorResetError`, and the engine's answer to that is the scan.
  Nothing read is half kept: a feed round is read whole before any of it is applied (§7), so the reset meets nothing committed, and the stored cursor stays as it was for a scan that is interrupted.
  The count travels as `walked`, on cursors written mid-round only.
  One written before it was added is a round's start, so no cursor resets for it.
  A round with real changes on many pages scans too.
  That is the same answer by the shorter road, since a scan is the truth a re-scan already relies on.
  Empty pages are not saved as they are read, and are not shown as progress: with the limit, there are at most a few of them.
  Making scans common in the two-device model found a mistake only a scan could make.
  A note deleted on one device was given the other device's file that had taken its name, and its delete removed that file.
  It is fixed in the same change (§7, "A path can be reused").
- Drive lists no parents of a changed item, so a round's end means only that every ancestor of what it listed is in the tree or was listed: a folder that becomes placed without having been (moved in from outside the app folder, or rescued from one deleted) has its contents **listed recursively into the same page** (`arrivals`), since the feed will not name them.
  A folder made on another device since the last look arrives the same way, so after notebooks are moved there every folder of them is listed.
  That was one request at a time, a wait per folder before the round could say anything.
  Since 2026-10-13 they are asked a level at a time, four folders at once (`LISTS_AT_ONCE`, as many as writes; a list is 100 of the 325,000 quota units a user has a minute).
  The answers go into the page in the order one at a time put them, so nothing the page makes of its order moves.
  The query is the same single-parent `'<id>' in parents` the live suite checked; one asking for several parents with `or` would be fewer requests, but has not been run against Drive.
  An item a round ends without placing has left the app folder — moved elsewhere in Drive, or into a folder the user made in the Drive UI, which `drive.file` cannot see — and is reported deleted where it was.
- **Two items at one path never reach the engine**, which holds one note per path: with two, it would move one note aside locally on every pull, alternately, and an edit to the one moved aside would be written to a path with no file behind it forever.
  When a page places two items with one folder and name, the adapter asks Drive whether both are still there — the search, and then each one the search leaves out, by id, since the feed can announce a file before the index lists it and a clash passed over is not asked about again until one of them changes; if so the canonical one keeps the name and each other is renamed beside it with `PATCH { name }` to `conflictFilename`/`conflictFolderName` (§7's rule applied to two remote files), and reported there.
  A file that is not a note is renamed with `conflictNameKeepingExtension` instead, which puts the stamp before its own extension (`photo (conflict 2026-09-15T14-32).png`): `conflictFilename` would have made it `photo.png (conflict …).md`, which is a note to the engine and no longer a picture to anything else.
  And one whose `md5Checksum` and `size` equal the canonical item's is not renamed at all: it is a copy, so it goes to the trash and is reported deleted (2026-10-03, for attachments, skysa-notes#187).
  Drive has no conditional trash, so the copy is asked for by id once more just before, and one moved, trashed or rewritten since it was listed is left to the feed or renamed instead; that narrows the race to one request rather than closing it, and a file lost in it is in Drive's trash, not gone.
  Two devices uploading the same picture while offline will be the ordinary way to get there, since an attachment's name is to be stamped with its content (skysa-notes#187), and renaming the second would leave a file no note links to beside the one they all do.
  Never a note: two notes with the same bytes are two rows on whichever devices hold them, and one sent to the trash would be a remote delete to each, so notes are renamed as they always were.
  A tree that still holds a file under a name it has since left is not a duplicate, so the tree alone never triggers a rename.
  Two devices separating the same pair at once each rename the same file; the last `PATCH` wins, and the next pull reports the name that stuck.
  So a pull can write to Drive, which no other adapter's does.
- **A folder the app has left (2026-10-13).**
  Reported from a phone: notebooks moved into an Archive notebook on a desktop, and the phone showed every old one still there, empty — and again after a re-scan, because the directories were still on Drive.
  A notebook moved, renamed or deleted goes up as its notes moving or going and then an `rmdir` for each directory it left (§7, "Folder renames/moves"), and on Drive that `rmdir` never deleted anything: `drive.file` hides what the user put in a folder, and trashing it would trash that too.
  It now *leaves* the folder instead (`StorageProvider.leaveFolder`).
  Past the same gates as a delete, one `PATCH` sets a private `appProperties` key on it — `notesappLeft`, a key of its own, so nothing can touch the app folder's `notesapp` — and nothing in it is touched.
  The adapter keeps a left folder in its tree, since what is inside one is placed through it, but does not report it while it holds nothing the app can see: no file, and no folder that is not left too, at any depth (`hideLeftFolders` in `providers/idTree.ts`).
  It has to be the adapter that decides and not the engine: told a folder is deleted, the engine takes the clean notes under it off the device, so "nothing is in it" has to be judged against the whole remote tree, which only the cursor holds — and judged again whenever what is in it changes, not only when the folder itself does.
  So a feed page compares the tree before it with the tree after: a folder hidden now and not before is reported deleted, after everything else the page says, so what the page moved out of it is out first; one hidden before and not now — a note written into it, or the mark taken off — is reported as a folder again; one hidden throughout is not mentioned.
  A scan holds every left folder back until its last page and then reports the ones something keeps, so a hidden one is never mentioned and `reconcile` takes it off a device that still has it; what is inside a kept one can arrive first, and the notebook made to hold it takes the folder's id when the folder's entry comes.
  `createFolder` takes the mark off the folder it finds at the name, and off another device's that wins the race to make it, so a notebook made again where one was left is a notebook on every device; a folder never left costs no extra request.
  `list` still lists a left folder: it is there, with whatever the user put in it.
  The mark travels in the cursor as a fifth element on a left folder's tree row and on no other, so a cursor stored before it reads as it did, and OneDrive's is byte for byte what it was.
  What the user put in a left folder stays on Drive untouched, and invisible here as it always was.
  Folders left behind before this have no mark, and stay notebooks until they are removed again from a device.
  **Not yet measured against a live account:** that Drive's change feed reports a change to `appProperties` alone — the reference says only that a change's `file` is "the updated state of the file".
  The stub reports it; the first live check is on staging.
  If the feed does not, another device learns that a folder was left only when it next scans.
- Known gaps.
  The engine commits page by page, where the feed means a round — the gap §5.2 describes, and Phase 6's item answers for both.
  A folder emptied here is not removed from Drive, since no listing can show that it is empty; it is left instead, and hidden while it holds nothing the app can see (above, and §7, "A folder is removed only where a listing can prove it empty").
  A search that misses the existing app folder at a reset still makes a second one — unless it is the folder this page last made, found or confirmed, which is asked for by id and counted unless it is in the trash or out of reach (so a first connect, where `ensureRoot` and the first pull's reset come seconds apart, makes one) — and the scan under it deletes this device's clean notes until a later round finds the earlier folder, resets back to it, and folds the second into it (the files are untouched remotely).
  A pull on a stored cursor costs one tag search before its page.
  Files the user adds through the Drive UI are invisible under `drive.file`.
  skysa-notes' storage panel says so (`UNSEEN_AT_PROVIDER` in its `apps/web/src/sync/account.ts`, 2026-10-05) — from "About Google Drive" in its gear, or in a compact window in the source's `⋯`, over everything (2026-10-06; a compact window had it as a fold-out under the source's name) — since nothing else does: a user who emptied the app folder on the Drive website and copied a folder of old notes into it saw the deletions arrive and then an empty library, with no word of why.
  The way in for such notes is an import (skysa-notes §7, "Getting a library in"), which makes them the app's files, and the panel's line says so.
- Measured against a live account, 2026-09-21, since none of it is on Drive's reference pages.
  **The change feed lags**: a new file took 1.4–2.8s to appear in `changes.list` on an idle account, and longer under the load of a suite run.
  **It also repeats itself**: one file creation was reported *twice*, about two seconds apart, with the same `version` and nothing having happened in between — so a cursor taken after the first echo still has the second coming, and anything reading the feed has to be idempotent on a repeat it has already applied (the engine is: it compares versions).
  **Name lookup does not lag**: a file was findable by name in 0.3–0.4s, which is what `verify-after-create`, every path walk and finding the app folder at a reset all depend on, and was the worry that made this worth measuring.
  **Deletion lags the other way**: the search index keeps listing a deleted file for a moment, so a scan run straight after a mass deletion finds files whose parent is already gone, cannot place them, and reports them as deletions by id — reachable by a test harness emptying a shared folder between scenarios, not by a user.
  Both lags reached users through the change relay (§6), whose notice comes the moment a write is answered: the round it starts asked the feed before the write was in it, and a clipboard listing taken just after the feed reported a trashing could still name the file.
  So a device looks again after a notice, and lists the clipboard twice (2026-10-06).
- A page token Drive will not take answers **400**, with `message: "Invalid Value"` and `reason: "invalid"` — neither of which says anything about a token.
  Only `location: "pageToken"` does, so the `locations` check in `isDeadToken` is the one doing the work and the message regex beside it is a fallback that would not fire here.
  Confirmed 2026-09-21; `CursorResetError` follows, as §7 needs.
- Trashing and renaming a folder are reported differently, also measured 2026-09-21.
  **Trashing lists what is inside it**: the folder and every descendant arrive, each with `trashed: true`.
  **Renaming lists the folder alone**, with no descendant reported — checked with the feed drained quiet first, because a child created moments earlier echoes into the round and looks like the rename listing it.
  Deleting a folder in the same round as moving a subfolder of notes out of it leaves the notes where the remote has them (§7, "A round is one batch"): the subfolder arrives at its new parent, the old parent arrives removed, and the note under the subfolder survives untrashed.
- `?alt=media` was served **200 from `www.googleapis.com` itself**, with no `Location` header and so no redirect to `*.googleusercontent.com` — which the CSP blocks and which cannot be allowed narrowly, since the wildcard would take in Apps Script web apps (§9).
  Measured once, for a small file; a large one may yet be served differently.
- A first connect leaves **one** app folder, where `ensureRoot` and the first pull's reset both go looking for it seconds apart.
  Confirmed after a real connect: one `skysa-notes` folder, not two.
- Tokens: backend exchanges the auth code with `access_type=offline&prompt=consent` to get a refresh token.
  Access tokens last 1h; client requests a new one from `/api/token` on `AuthError` or proactively at 55m.

<a id="onedrive-microsoft-graph"></a><a id="s5-2"></a>
### 5.2 OneDrive (Microsoft Graph)
- Scopes: `Files.ReadWrite.AppFolder offline_access openid email`.
  User consent only.
- Root: `GET /me/drive/special/approot` — Microsoft creates `/Apps/<AppName>` automatically, where `<AppName>` is the Entra app registration display name.
  Register it as `skysa-notes` to match `APP_FOLDER_NAME`; no ensureRoot creation logic beyond writing `.notesapp.json`.
- Files, create: `PUT /me/drive/special/approot:/{path}:/content?@microsoft.graph.conflictBehavior=fail` (simple upload, fine for markdown; add a resumable session only if a file ever exceeds 250 MB).
  Graph's default for an upload is to **replace**, so the `fail` is what keeps a create from being a blind overwrite; a name in use answers `409`.
  The adapter looks the path up before raising `ConflictError`; Graph does not say what an upload into a missing folder does (it may make the folders), so a refusal with nothing at the path and no parent folder is `NotFoundError` for the parent.
  A file that is not a note goes up the same way, its bytes as the body and its type as `content-type` (`application/octet-stream` if none) (2026-10-03, skysa-notes#187): a simple upload takes up to 250 MB (https://learn.microsoft.com/en-us/graph/api/driveitem-put-content), ten times the app's cap, so there is still no session.
- Files, update: `PUT /me/drive/items/{id}/content` with `If-Match: <eTag>` → `412` when stale.
  **By id, never by path**: an upload by path creates a file that is not there, and a file deleted since the caller last saw it is exactly what an expected version is meant to catch.
  The adapter looks the path up first for the id (and answers a stale or missing file without uploading); `If-Match` covers the moment between.
- Neither the `conflictBehavior=fail` → `409` nor the `If-Match` → `412` behavior of an upload is in Graph's reference pages — they come from the OneDrive docs' issue tracker and Microsoft Q&A — and the move page documents only `if-match`, not `conflictBehavior`.
  All three wait on the live run in Phase 3.
- Folders, create: `POST /me/drive/items/{parentId}/children` with `{ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }`.
  **The parent goes in by id, never by path** — the same rule the update above follows, and for a blunter reason: Graph answers a `POST .../children` whose parent is addressed by path with a bare `400 invalidRequest`, at every depth, whatever the name and `conflictBehavior` say.
  Measured against a live personal account 2026-09-21: `POST special/approot/children` 400, `POST approot:/{parent}:/children` 400, `POST /me/drive/items/{parentId}/children` 201.
  `GET .../children` by path is fine, and so is `PUT approot:/{path}:/content`, which is why an app folder could hold its marker and refuse the first notebook beside it.
  The root's id is cached, so only a nested folder costs the lookup.
  The wire stub accepted the path form and so could not catch this: it now refuses it as Graph does.
- Move: `PATCH /me/drive/items/{id}?@microsoft.graph.conflictBehavior=fail` with `{ name, parentReference: { id } }`.
  The parent is named by its real id (Graph refuses `root` there), so a move costs a lookup of the destination and its parent.
  The destination is looked up *first*: a queued move the entry has already made returns without a request, and a rename that changes only the case of a name is still sent.
- Reading: `/content` answers with a `302`, which a cross-origin request carrying an Authorization header may not follow.
  The adapter reads the item for its eTag and `@microsoft.graph.downloadUrl`, then fetches that URL **without** the token: it is pre-authenticated, needs no preflight, and is not on Graph — `*.files.1drv.com`, `my.microsoftpersonalcontent.com`, or `*.sharepoint.com` for work accounts.
  Those are the hosts §9's `connect-src` needs besides `graph.microsoft.com`.
- Version: `eTag`.
  It changes on a move, where Dropbox's `rev` does not — which §7's `syncedHash` answers for a note renamed while it holds unpushed edits.
  `cTag` changes only with content, but delta on OneDrive for Business omits it, so it cannot be the version.
- Changes: `GET /me/drive/special/approot/delta`, following `@odata.nextLink`; the `@odata.deltaLink` is the next start.
  `410` — and, on a link we stored, a `400` (a token Graph cannot read) or a `404` (the app folder it was for is gone) — is `CursorResetError`; the same on the very first request is an ordinary failure, since starting again would ask the same thing.
  Deleted items carry a `deleted` facet and **no `name` at all** — not on Business and not on a personal account either, which the note here used to imply.
  Verified against a live personal account 2026-09-21: a deletion arrives as its id, its `parentReference`, the `deleted` facet and a `file`/`folder` facet, and nothing else.
  The adapter never asks for one (it resolves a deletion by id through the tree), so nothing depended on it, but the wire stub was sending a name no caller could really have and no longer does.
- Paths: **delta never includes `parentReference.path`**, and a renamed folder's descendants are not reported.
  The adapter therefore keeps the tree — id → parent id, name, kind — **in the cursor** (`packages/storage/src/providers/idTree.ts`, which Google Drive's adapter shares; what is Graph's own — the link, dead-link rules, the anchoring refusal — stays in `onedrive.ts`), and resolves every path from it once the whole page is applied, so an edit inside a folder renamed in the same page gets the new path.
  Consequences: a folder rename is reported as the folder alone (the engine's folder-only path, as for Drive); a deletion is reported at the path the item had before the page, and one the tree never placed by its id alone (the engine finds nothing for an id it does not hold); an item whose parent has not arrived yet is carried in the cursor, with the path it had, until the round ends.
  Graph lists every parent of a changed item unless asked not to (`deltaExcludeParent`), so an item the round ends without placing has left the app folder — the user can move things out of it — and is reported deleted where it was.
  A deletion's old path is walked up the tree as it was, through any held item by the path *it* had, so a note deleted inside a folder still waiting on its new parent is reported where it was.
  Every deletion Graph lists is reported, even inside a folder also reported deleted: the engine matches it by id, and a filter by path cannot tell two folders that held the same old path within one round apart.
  At the end of a round anything else the tree can no longer place (what was inside a folder that was deleted or moved away) is dropped from it without being reported — something above it that was placed before moved or went, and that is reported.
  A file delta lists with no eTag is left out rather than thrown over, since one would stop every pull.
  A first scan that has items but none naming the app folder as parent is refused rather than reported as an empty folder, which would delete every clean note; the app folder's id is read afresh at the start of every scan.
  The cursor grows by a few hundred bytes per item in `syncState`, and every link read back from it must be on `graph.microsoft.com` before a token is sent to it.
  Outside delta, the path an item was asked for plus the name Graph returns gives its path.
- Graph lists the app folder itself in its delta; the adapter drops it (§7 guards the same in the engine).
- What a round reports, measured against a live personal account 2026-09-21, with a cursor held across each: **deleting a folder of notes** lists the folder and every note in it, each as a nameless tombstone.
  **Moving a subfolder of notes out of a folder and deleting that folder in one round** lists the moved subfolder at its new parent and the old parent as deleted — and says nothing about the notes inside the subfolder, which is the case the id tree exists for: their paths rebase from their parent's move, not from an entry of their own.
  **Renaming a folder while moving a note into it, in one round** lists the folder under its new name and the note under that folder, and the note ends up inside it.
  All three match what §7's "A round is one batch" assumes.
- Graph says to apply a round's changes after its last page, and the engine does (§7, "A round is one batch").
  Within a page every path is where the item is once the page is in, so the adapter lists the page's folders first, outermost first, and everything else after in the order it happened: a file listed ahead of the rename of the folder it lands in would otherwise be carried off by that rename.
- The two resync codes are told apart.
  Graph answers a dead token with `410` and one of them, and they disagree about whose copy may have lost something: `resyncChangesApplyDifferences` says "Replace any local items with the server's version (including deletes)", which is what a scan does anyway, while `resyncChangesUploadDifferences` says "Upload any local items that the service didn't return" — a server-side restore.
  So `CursorResetError` carries `uploadDifferences`, and the rescan it starts deletes nothing (§7, "A rescan that uploads").
  The code is read from `code`, from `innerError` and `innererror` alike, and from the `details` list, since the page says only "an error response containing one of the error codes below" and missing it is the direction that costs notes; anything unrecognized, `resyncRequired` included, falls back to today's reset and never to uploading.
  A folder moved *into* the app folder from elsewhere is reported alone; whether Graph lists what is inside it is one of the live checks.
- OAuth (`packages/server/src/oauth/onedrive.ts`): Authorization Code + PKCE against `login.microsoftonline.com/{MICROSOFT_TENANT}/oauth2/v2.0/{authorize,token}` as a confidential Web client, `response_mode=query`, `prompt=select_account` — without it Microsoft silently uses whatever account the browser is signed in to, which on a shared machine may be someone else's, and in storage-first that account then signs in as the user it is connected to.
- Account id: the ID token's **`sub`**, read from the token endpoint's response without a signature check (OIDC Core §3.1.3.7 allows it for a token received directly over TLS), and refused unless its `aud` is this client.
  Not `oid`, which needs the `profile` scope and is the same across every app a user signs in to; `sub` is pairwise — derived from the app, the user and the tenant they signed in through — which is all a connection needs, though an operator who changes `MICROSOFT_TENANT` to a tenant where their users are guests makes every returning user look new.
  Display name: the `email` claim, else "OneDrive"; it is unverified and a tenant admin can set it to anything, so it is stored with `email_verified = false` and must never link accounts (§6).
  So no Graph call is needed to name the connection.
  Claims are read at the code exchange only: the ID token a refresh returns is one Microsoft says not to rely on.
- Tokens: refresh tokens issued to the backend and **rotated on every refresh** — `/api/token` stores the new one; access tokens ~1h.
  Microsoft has no per-app revoke, so disconnecting deletes the row and answers `revoked: false` (§9).

<a id="dropbox"></a><a id="s5-3"></a>
### 5.3 Dropbox
- App type: **App folder** access.
  Scopes: `files.metadata.read files.metadata.write files.content.read files.content.write account_info.read`.
- Root: with App folder access, the API root *is* `/Apps/<AppName>`, where `<AppName>` is the app name set in the Dropbox App Console (immutable after creation — create it as `skysa-notes`).
  All paths are relative to it. ensureRoot just writes `.notesapp.json` at `/`.
- Files: `POST content.dropboxapi.com/2/files/upload` with `mode: { ".tag": "update", update: rev }` for conflict-safe overwrite (Dropbox returns a conflict error rather than auto-renaming when `autorename: false`).
  `mode: add` for create.
  **`strict_conflict: true` is required**: without it an `update` whose rev no longer matches still succeeds when the file has since been deleted, which is exactly the case the expected version exists to catch.
  A file that is not a note is the same `add`, its bytes as the body (2026-10-03, skysa-notes#187); one request carries up to 150 MiB (the `upload` route in Dropbox's API spec, `files.stone`), past which Dropbox wants an upload session the app's cap never needs.
- `Dropbox-API-Arg` is an HTTP header, so it must be ASCII: every character above printable ASCII has to be `\uXXXX`-escaped or a notebook named in a non-Latin script fails at the transport with an unhelpful 400.
- Errors: only a **409** carries an endpoint-specific `error_summary`; any other status may carry plaintext or an intermediary's HTML, so a tag is only ever read out of a 409, and by whole `/`-separated segment rather than substring.
  Otherwise a 503 whose body happens to say `conflict` would have the conflict rule copy the user's note aside over an outage.
  Match by segment, not equality — Dropbox says the tail carries detail that can change.
  A conflict does not include the current entry, so the adapter fetches it with `files/get_metadata` before raising `ConflictError`; that extra round trip happens only on the conflict path.
- `strict_conflict` also means Dropbox answers `conflict` for an `update` whose file has been **deleted**, where §4 calls for `NotFoundError`.
  The adapter tells them apart by looking the path up after a conflict: no entry plus an expected version is the deleted case.
  The engine's re-create-on-push path depends on it.
- `path_display` is nullable in Dropbox's spec.
  Defaulting a missing one to the empty string would produce an entry pointing at the app-folder **root**, which a later `delete` would act on, so the adapter refuses such metadata loudly instead.
- A cursor Dropbox cannot parse comes back as a plain **400**, not as `reset`.
  Both mean discard and re-scan; only one is typed, so the adapter maps a 400 from `list_folder/continue` to `CursorResetError` too.
  Without it a truncated cursor is retried forever.
- Folders have no `rev` and no `server_modified`.
  The adapter reports both as empty rather than inventing them, and nothing compares either for a folder.
- `create_folder_v2` answers with a `CreateFolderResult` whose `metadata` is declared as `FolderMetadata`, not as the `Metadata` union — so alone among the endpoints the adapter reads entries from, **it carries no `.tag`**, and a shared mapper that reads one calls every folder the app creates a file.
  `list_folder`, `get_metadata`, `move_v2` and `delete_v2` all tag what they return.
  Verified against a live account 2026-09-21, after the wire stub had tagged it anyway and hidden exactly that bug; `toFolderEntry` sets the kind from the endpoint rather than from the payload.
- `create_folder_v2` **creates missing parents itself**, in the one call (verified 2026-09-21: `a/missing/deep/child` under an empty `a` succeeded).
  So a `mkdir` whose parent another device removed does not fail, and the engine's `ensureRemoteFolder` retry is unreachable on Dropbox.
  Note the corollary: it silently re-creates a folder the user deleted elsewhere, rather than refusing.
- A `rev` is lowercase hex of at least 9 characters, and Dropbox validates that **shape before it compares the value**: a malformed one is a plain 400, not a conflict and not a missing file.
  Nothing in the engine can send one, since every rev it holds came from Dropbox, but a test that makes one up never reaches the behavior it means to check — which is why the contract suite takes a per-provider `staleVersion`.
- Worse for a test than the shape rule, and the reason the suite now seeds and deletes a real file rather than inventing a version: an `update` **whose rev Dropbox has never issued** finds nothing to conflict against, so where the path is absent it simply **creates the file**, `strict_conflict: true` or not.
  Measured 2026-09-21: absent path + unknown rev → created; deleted path + unknown rev → created; deleted path + that file's real former rev → `conflict`, which is the case above and the only one the engine can produce; present path + non-matching rev → `conflict`.
- Version: `rev`.
- Changes: `files/list_folder` with `recursive: true` on first sync (returns cursor), then `files/list_folder/continue`.
  Optional later: `files/list_folder/longpoll` for near-instant sync while the tab is open.
- A round's entries are to be processed in order, each `DeletedMetadata` taking whatever is at its path then, and children included; a renamed folder comes back as its old path deleted and the new folder with everything in it listed again.
  Neither is on the API reference page; both are Dropbox staff answers ([processing order](https://www.dropboxforum.com/discussions/101000014/why-should-i-remove-the-entry-and-all-its-children-for-each-deletedmetadata-when/535415), [renamed folders](https://www.dropboxforum.com/t5/Dropbox-API-Support-Feedback/Handling-renamed-folders-in-list-folder-list-folder-continue/td-p/225665)).
  The wire stub replays what happened in order but reports a move as the new place alone, with no deletion of the old path; `randomRemote.test.ts` also runs the fake's feed told as Dropbox tells it — the old path deleted by path alone, then the new place, with and without the children listed again.
  An id-less deletion under a folder the round renames cannot be told apart from the rename's old path, so the engine asks the provider (§7).
  **Both confirmed against a live account 2026-09-21**: renaming `Work` to `Renamed` reported `Work/a.md` deleted, `Work/b.md` deleted, `Work` deleted, then `Renamed` and both its children — children before their parent on the way out, parent before its children on the way in.
- Paths: use `path_display`; Dropbox also gives an `id` (`id:...`) — store both, prefer id for identity.
- Tokens: `token_access_type=offline` → refresh token.
  Access tokens ~4h.
- Note: production apps need Dropbox "production" approval once past the dev user cap; App-folder apps have a light review.

<a id="webdav"></a><a id="s5-4"></a>
### 5.4 WebDAV
*Deferred indefinitely (2026-09-17).*
WebDAV is not being built.
What follows is the design as planned, kept so it need not be worked out again if that changes; nothing in this repo implements it.

- Auth: URL + username + password (app password recommended).
  Stored encrypted on the backend; the client never sees them.
- Transport: **all WebDAV traffic goes through `/api/webdav/*`** because most servers don't emit CORS headers.
  The proxy forwards method/headers/body verbatim, injects Basic auth, restricts to the configured base URL, and streams bodies.
  Supported methods: `PROPFIND`, `GET`, `PUT`, `MKCOL`, `MOVE`, `DELETE`, `REPORT`.
- Root: the user supplies a base URL that *is* the app folder (e.g. `https://cloud.example.com/remote.php/dav/files/david/Notes/`).
  ensureRoot does `PROPFIND depth 0`, `MKCOL` if 404, then writes `.notesapp.json`.
- Files: `PUT` with `If-Match: <etag>` for updates, `If-None-Match: *` for creates.
  Version = `ETag` (strip weak prefix `W/` and normalize quotes).
- Changes: no universal delta.
  Strategy in order of preference:
  1. RFC 6578 `sync-collection` REPORT if the server advertises it (Nextcloud/ownCloud/SabreDAV do) — cursor is the `sync-token`.
  2. Fallback: full recursive `PROPFIND depth infinity` (or depth 1 walk if infinity is refused) diffed against the last snapshot.
     Cap frequency (e.g. on app open + every 5 min while active).
- Identity: path-based.
  After a `changes()` pass, re-link renamed files by reading frontmatter `id` of any "new" file whose size/etag suggests it might be a moved note.
  Accept that renames done outside the app look like delete+create in the worst case.

---
- The adapter takes a `fetch`-like function, so it can point at the proxy in the browser and at the server directly in tests; a Nextcloud container was the planned test target.

<a id="backend"></a><a id="s6"></a>
## 6. Backend

Hono app in `@skysa/server` (`packages/server`), which an app deploys to Cloudflare Workers with `wrangler`, from a Worker entry of its own.
Keep it boring.

- Runtime: Workers only.
  Use Web Crypto (`crypto.subtle`) for AES-GCM, `fetch` for provider calls, no Node built-ins.
  `wrangler dev` locally (Miniflare) with a local D1.
- Database: D1 via `drizzle-orm/d1`, migrations with `drizzle-kit generate` + `wrangler d1 migrations apply`.
  Same SQLite dialect locally and in prod.
- Secrets: provider client ids/secrets and `SECRETS_KEY` via `wrangler secret put`; never in `wrangler.toml`.
- Static SPA served from the same Worker via `[assets]` in `wrangler.toml` (SPA fallback to `index.html`), so `/api/*` and the app share an origin and cookies are first-party.
- **Composition root:** `@skysa/server` exports `createApp({ entitlements, rateLimiter, relay, fetch, providerTimeoutMs, config })` as a library; an app's Worker entry calls it (skysa-notes' `apps/api/src/worker.ts`, with the defaults).
  An operator who needs different behavior writes their own Worker entry that imports `createApp` and passes their own implementations, instead of forking.
  While the configuration is wrong, an entry answers every request with `misconfigured`, also exported: a generic `server_misconfigured`, with what is wrong in the log.
  Nothing in `@skysa/server` reads env: the app's Worker entry reads it, through `parseEnv`, and hands it over.
- Cookies with `hono/cookie` — two, the short-lived OAuth flow cookie and the callback's answer to it (see "Storage OAuth, as built"); there are no sessions (see "Per-connection credentials").
  Request validation with `zod`.
  (`@hono/zod-validator` was declared up front and never used — the routes validate with `zod` directly — so it was removed.
  Re-add it when a route actually wants the middleware; the removal is not a decision against it.)
- **Entitlement seam:** every route that mints a token or proxies WebDAV calls `entitlements.check({ connectionId, provider, accountId, displayName })` from an `EntitlementProvider` interface in `@skysa/protocol`.
  The repo ships `AlwaysAllowed`.
  Operators of a shared instance can substitute their own (an allowlist of accounts, for example) through `createApp`; no such policy logic lives in the repo.
  *Revised in Phase 7:* it took a `userId` until connections stopped aggregating under a user, and an account is what an operator's rule can actually be written about.
  **The OAuth callback asks as well**, once it knows which account it is and before it stores anything: asked only at `/token`, a refused account still left its refresh token sealed in D1, unusable and unreachable, and its owner learned of the refusal when sync failed.
  `connectionId` is absent from the subject when the account has no row yet.
  A refusal stores nothing — no connection, and no grant, whose hash would otherwise be spent — withdraws the consent just given where the provider has a revoke call, and sends the user back with `?connect=refused`; the operator's `reason` is not carried, since free text in a URL is text anyone can put in a link (its `code` is, below).
  An account that already has a connection keeps it as it was, and `/token` goes on refusing it — and for that account nothing is revoked, because Google's revoke takes every token the user has granted the app, the one sealed in its row included, and a refusal can be a lapse the operator lifts later.
  A seam that throws has not said yes: `?connect=failed`, nothing stored.
  `/token` still asks, because what is allowed today can lapse.
- **Refusal codes and the connect gate (2026-09-24, skysa-notes#131).**
  A refusal met only after the provider's consent screen, worded the same whatever the reason and offering nothing to do next, was the whole of what a restricted instance could say.
  Two additions change that, and both come through the entitlement seam.
  - **Codes.**
    `EntitlementDecision` gains an optional `code` from a fixed list, `ENTITLEMENT_CODES` in `@skysa/protocol`: `not_allowed`, `lapsed` and `limit_reached`.
    The callback carries it as `?connect=refused&code=…`, and `/token` returns it beside `reason`.
    A code outside the list is dropped on the way out (`knownCode`), and the refusal then reads as one with no code.
    A value from a closed set says nothing a link-maker can choose, which is what kept `reason` out of the URL.
    The app words the refused toast and the storage panel's `not_entitled` line by the code, and puts the operator's `reason` under the panel's line.
  - **The gate.**
    `EntitlementProvider` gains an optional `gate`: a plain-text message and one `https:` link.
    `/api/config` serves it as `connectGate`, and the app shows it where the provider buttons are.
    It lives on the seam and not in env, because a gate means nothing without a policy of the operator's, and that policy already needs its own Worker entry.
    A gate on an instance that lets everyone in would turn people away from an open door.
    `createApp` checks it with zod when the app is built and throws on anything else, so a bad gate is a boot failure (`server_misconfigured`), as a bad env is, rather than a broken link.
    The client checks it again and drops a gate that does not parse, keeping the rest of the config.
    Its URL becomes a link on the page, and only `https:` is followed, which is the check skysa-notes#89 asks for on the connect flow's URL.
    Both sides serve the URL normalized: with a custom protocol rule zod accepts `https:example.com`, which an `href` would resolve into a path inside the app, and normalized it is `https://example.com/`.
    The refused toast waits for the config to answer or fail before it appears, so its link is part of the alert from the start and not added a moment later.
  - **Who sees the gate.**
    A device holding a live connection on the instance sees the provider buttons, with the gate as a line above them: its account was let in at least once.
    Any other device, including one holding only a detached source, sees the gate plus "Already have access?
    Connect storage", which shows the buttons.
    Showing them grants nothing, because the policy still decides at the callback.
    A gate whose code is `required` is the exception to both: every device sees its code field until a code is accepted ("Connect codes", below).
  - **The issue's two open questions.**
    The live-connection rule above answers the first.
    For the second, the gate is a `createApp` option and not env, and it is static: a gate that varies per request, for example by locale, would be a later change to a function-valued field.
    Reconnecting an account the device already holds is not gated.
- **Connect codes (2026-09-28, skysa-notes#139).**
  Issue skysa-notes#131 left one thing out: passing anything from the gate back into the connect flow, "such as a claim code", was to be its own issue if anyone needed it.
  An operator whose policy turns on something other than the storage account needs it: a code their own page sends to someone who has paid, or an invite.
  Before a connect the server knows nothing about who is connecting, and after it the server knows only the account.
  - **The seam.**
    `ConnectGate` gains an optional `connectCode: { label, required? }`, checked with the rest of the gate (a label of 1 to 40 characters).
    Whatever is typed goes with `/start` as `connectCode`: trimmed, at most `MAX_CONNECT_CODE` (64, in `@skysa/protocol`; 256 since the held value below) characters, and printable.
    A blank one counts as none, and anything else is `invalid_request`.
    The code rides to the callback in the signed flow cookie beside the verifier, and the policy is handed it as a second argument: `check(subject, { connectCode })`.
  - **Checked as it is used (2026-09-29, skysa-notes#146).**
    Until then the code was checked only at the callback.
    "Use code" asked the server nothing, so any code at all looked accepted until the provider sent the person back past a consent screen.
    A gate that asks for a code now needs `EntitlementProvider.checkCode(code)`, which `createApp` insists on, and the app asks it through `POST /api/connect-code` as the code is used.
    The answer is `{ accepted: true, expiresIn }`, the seconds the app should keep the code (at most a day, `MAX_CODE_HOLD_SECONDS`; a year since the held value below), or `{ accepted: false, reason? }`, plain text of at most `MAX_CODE_REASON` (200) characters, shown under the field.
    Seconds from now rather than a time, so a device whose clock is wrong keeps it as long as was meant.
    The server holds the answer to that shape: a reason that is not plain text is dropped and the refusal kept, a hold longer than the most is cut to it, and anything else, or a throw, is a 500 that passes nothing on.
    It is advice, not the decision: the callback still asks `check` with the code, so a code that runs out between the two is refused there.
    An answer to "is this a code" is worth guessing at, so the route is same-origin like `/start` and goes through the rate limiter (`connect-code:<ip>`) before the policy is asked.
    How many guesses that leaves is the operator's to size against how many codes it has live and for how long.
  - **Two steps.**
    The gate and the buttons are two steps, one open at a time.
    An accepted code opens the buttons and folds the gate to a line naming the code (or, for a value held in its place, saying it was accepted; below) and when it stops being good, and its "Change" opens the gate again and closes the buttons, so only the next thing to do is on screen.
    When the hold ends, with the menu open or while the app was closed, the gate asks again with the field empty.
    With `required`, a code is the only way to the buttons, for every device, one already syncing here included.
    Without it, "Already have access?" shows them to someone the policy knows already, and a device with an account syncing here starts on the buttons, with "Have a code?
    Enter it" as the line, since it may be adding an account the operator has not seen.
    A blank code cannot be used.
  - **Decided only at the callback.**
    `/token` and the WebDAV proxy ask with no second argument.
    A policy that accepts a code decides as the account connects and remembers the answer itself, keyed on the account, which remains the only subject there is.
    The code is not a credential.
    The device sends it only to be checked and with a connect, never with `/token`, and the server keeps it only for the life of the flow cookie.
    That is why it does not reopen "No sign-in separate from storage" below: it is said to connect, and after that the storage account is the identity, as before.
  - **Kept for as long as the policy says.**
    The app holds an accepted code in `localStorage` beside the time the policy said it stops being good, so it survives the round trip through the consent screen and a closed tab or installed app, and one code can connect several accounts.
    A read after that time finds nothing and clears it.
    It was `sessionStorage` until the policy could say how long: a code kept for later visits would have outlived what it meant, and the end the policy gives is what keeps that from happening now.
    It is none of the three kinds of secret: the operator issued it to the person typing it, and it is worth only what their policy decides.
    Where storage is refused, the app holds it in memory, which is enough for the connect it was accepted for.
  - **A value held in place of the code (2026-10-05, skysa-notes#218).**
    A code good for minutes, typed once per sitting, made an operator who sells access email a new one each time anyone connected anything: a second provider a week later, a new browser, the same account again after the last device let it go.
    The operator wanted a code to prove the address once per device, and then not again.
    So an accepted answer may carry `hold`, a value the app keeps and sends in place of what was typed — with the connect, and to `checkCode` — for `expiresIn`, which may now run to a year.
    What it is, and what it proves, is the policy's: a pass it sealed for this device, say, good while a subscription lasts.
    The server holds `hold` to what a code is, since it travels as one: trimmed, printable, at most `MAX_CONNECT_CODE`, which went from 64 to 256 characters to make room for something sealed (the flow cookie is about 2.1 KB at worst, measured with the longest return path, against the 4 KB a browser keeps).
    One that is not fails the answer with a 500, rather than being dropped, since dropping it would keep the typed code the policy chose not to have kept.
    The gate never shows a held value: its folded line says the code was accepted on this device and until when, and "Change" opens an empty field.
    And the app asks about a held value again as it loads, where the gate asks for a code: the answer replaces what is held, which is how a policy that answers with a fresh `hold` keeps a pass alive for as long as the device is used; a refusal lets it go, so a pass the policy stopped taking — the subscription ended — closes the gate before any consent screen rather than after one; no answer, or a limit reached, keeps it, and the callback decides as it always did.
    It asks at most once an hour since the policy last answered, because each asking spends one of the guesses `connect-code:<ip>` allows, which everyone behind one carrier's or office's address shares, and someone typing a fresh code must not find them spent; and it does not ask about a typed code at all, which is good for minutes and gains nothing from it.
    A refused connect does not drop a held value, as it drops a typed code: nothing was typed, and the no may be about the account.
    The app asks about it at once instead, and lets it go only if the policy says so.
    A fresh `hold` must not end the one it replaces, since two tabs loading together, or an answer lost on the way, can leave the earlier one held.
    An app still on a version before this one refuses any answer that keeps a code longer than a day, so an operator should give long holds only once its app has been updated.
    A held value is a bearer to the operator's policy: whoever copies it out of the browser can connect what the policy would let this device connect, until the policy stops taking it.
    It is still none of the three kinds of secret, since it reaches no storage and no credential, but it shares the third kind's exposure in `localStorage`, and what keeps it is the same `script-src 'self'`.
    It is still said only to connect, and never with `/token`, so it does not reopen "No sign-in separate from storage" any more than the code did.
  - **The gate's link opens in this window, and the way back is `?enter=code` (2026-10-02).**
    It opened a new tab, so the app would still be there to come back to.
    In an app installed on a phone a new tab is a second window, and the only way back from it to the code field was to close the app and open it again.
    All three places the link appears — the `+` menu's gate, the storage panel's not-entitled line and the refused toast — now open it in the same window, as the provider buttons go to the provider.
    The operator's page links back to the app with `?enter=code`, which opens the way to connect at the gate's code field: the `+` menu in a wide window, or the sources dropdown and its `+` in a compact one, with focus in the field, even with a code already held.
    It is read once and removed, as `connect` is (skysa-notes' `routes/search.ts`), and waits for the config to say there is anything to offer.
    An operator's page that does not link back loses nothing that was there: Back returns to the app, and the code is typed into the `+` menu as before.
  - **A refused code.**
    A plain no (`not_allowed`, or no code) to a connect made while a code was held reads "The code you entered was not accepted or has expired", and the code is dropped, so the gate is back on an empty field.
    `lapsed` and `limit_reached` are about the account or the instance, not the code, and are worded as before, with the code kept.
  - **A yes is not a stored connection.**
    The callback can still fail after the policy says yes, and then nothing is stored.
    A policy that records something on a yes, such as linking the account to the code, must let the same account connect again and be asked again.
- **Rate-limit seam:** `createApp({ rateLimiter })`, defaulting to `neverLimited`, consulted by `POST /api/auth/connect/:provider/start`, the callback, and `POST /api/token` — the three endpoints that spend an outbound provider call — and by `POST /api/connect-code`, which spends none but answers a question worth guessing at.
  Also by the change relay's ticket and upgrade (`relay-ticket:<connectionId>`, `relay:<connectionId>`), which spend none either but would otherwise let one device open sockets without limit.
  A seam and not a Cloudflare binding, for the same reason as the entitlement one: a binding would be deployment-specific code in a repo that forbids it.
- **Provider enablement** (`ENABLED_PROVIDERS` env, default `dropbox` — only what is implemented; each OAuth provider listed must have its credentials or the app refuses to boot).
  Which settings those are is said once, in `OAUTH_ENV` in `packages/server/src/env.ts`, keyed by the flows in `oauth/providers.ts`, so a provider added to one and not the other does not compile; the schema, the boot check and the credentials `createApp` is handed all read it (skysa-notes#450).
  `webdav` is accepted and needs no credentials, but WebDAV is deferred (§5.4): nothing is mounted for it, `/api/config` does not offer it, and the Worker logs a warning at boot while it is listed.
  `WEBDAV_ALLOW_PRIVATE` is likewise read, does nothing, and warns.
  Refusing either would break a deployment that has it set, so both stay until skysa-notes#118's breaking change (decided 2026-10-25, skysa-notes#450).
  If it is ever built, its routes and proxy are mounted only when `webdav` is listed.
- **No sign-in separate from storage.**
  Decided 2026-09-18, and it closes what used to be two modes behind an `AUTH_MODE` env.
  Identity and data are coupled: a connection is reached by the credential the device that made it holds, and nothing anywhere aggregates connections under a subject.
  A person with Dropbox and Google Drive connected has two silos, and the server cannot tell they are one person — which is the property, not a limitation to be fixed later.

  What this closes, so it is not re-opened by accident: no `identities` table, no `IdentityProvider` adapters, no Google/Microsoft sign-in, no merge-by-verified-email, no account linking, no magic link, and no `arctic` dependency — whose deprecation (July 2026) had been an open question since 2026-09-14 and is now moot rather than decided.
  skysa-notes §14 keeps the reasoning and what it would have cost.

  The gain is that a whole class of question stops needing an answer here: which of two identities a grant belongs to, what a verified email is worth, what happens when a linked provider is unlinked, and who may see a connection someone else made.
  A shared instance is still possible — that is what the entitlement seam is for — it just gates on the storage account rather than on a user the server invented.

  **What it left standing is gone** (skysa-notes#118).
  The server no longer reads `AUTH_MODE`: a deployment that still sets it boots and is told at boot to remove it, and `account-first` is still refused, below.
  Migration `0007` drops the `users` and `identities` tables, which nothing ever read.
  `/api/config` still sends `authMode: 'storage-first'`, a fixed value, because an app from before this change requires it and a phone runs its cached copy until it updates; the client no longer reads it, and `AUTH_MODES` has left `@skysa/protocol`.

- **One OAuth flow per provider, and it is for storage.**
  `/auth/connect/:provider` requests storage scopes only.
  There is no `/auth/login/:provider` and none is coming.
  *From Phase 4:* the storage request does **not** pass `include_granted_scopes` (see "Storage OAuth, as built").
  One consequence of Google's model is worth keeping written down even now that only one flow exists: Google revokes every grant to a project at once, so disconnecting storage revokes the whole project's access for that user — there is simply nothing else left for it to take down.
- WebDAV proxy: stream request/response bodies straight through (`c.req.raw.body` → upstream `fetch` → return `Response`); enforce a 30 s upstream timeout with `AbortSignal.timeout` and a 20 MB cap regardless of Cloudflare plan limits.

<a id="storage-oauth-as-built"></a>
### Storage OAuth, as built (Phase 2)

Dropbox is the first storage flow and the shape the others follow.

- **Hand-rolled.**
  The storage flows are Authorization Code + PKCE and about forty lines each, so they install no OAuth dependency at all.
  (`arctic` was once planned for sign-in, was deprecated by its author in July 2026, and is moot now that there is no sign-in — see "No sign-in separate from storage".)
- **The PKCE verifier and `state` ride in a short-lived signed cookie** (`skysa_flow`, 10 minutes, `httpOnly`, `sameSite=lax`), not a table.
  §9 wants `state` bound to the browser that started the flow, which is what a cookie *is*; a table would need a sweep job and a KV binding neither of which exists.
  The payload is signed because an attacker who could rewrite it could otherwise substitute their own `state` and complete a flow the user never began.
- **A callback asked for again is answered the same way (2026-09-30, skysa-notes#149).**
  The callback can be answered only once: reading it clears the flow cookie, and the provider's authorization code is spent.
  But a browser can ask for it twice.
  Chrome's Safe Browsing check runs beside the request, not before it, so its warning page can cover a callback the server has already answered, and going on past the warning asks again; so do a reload and the back button.
  The second asking found no flow and was told `flow_expired` in raw JSON, over a connection the first had stored.
  Found on the hosted service, where Chrome put its warning over a OneDrive callback.
  Now every answer the callback gives after checking `state` is also written to a second signed cookie, `skysa_flow_answer` (five minutes, `httpOnly`, `sameSite=lax`): the flow's `state` and the path it sent the browser to, `?connect=` outcome and all.
  A callback carrying that `state` is sent to the same path, exchanges nothing and touches no cookie, so a third asking is answered too and a flow started since is left to finish.
  Nothing in it is secret; it is signed because a redirect read from a cookie anyone could write would be an open one, and only a path in this app is taken from it.
  There is one answer at a time, as there is one flow.
- **A callback with no flow goes back to the app.**
  No flow cookie, a `state` that does not match, a flow older than its ten minutes, or an answer older than its five: the server cannot tell these from a forged link, and exchanges nothing.
  It is still a page a browser is on, so it redirects to `/?connect=expired`, and the app says that connecting did not finish and to connect again if the storage is not connected.
  It does not guess which: the storage tabs show what is connected.
- **No failure on the callback answers in JSON (2026-10-26, skysa-notes#451).**
  Three still did, to a browser that was navigating: a provider the deployment does not offer, or has turned off since the flow started (`unsupported_provider`, `provider_not_configured`); a callback carrying neither a `code` nor an `error`; and the callback's rate limit.
  Each now redirects to the flow's `returnTo` with `?connect=failed`, and is logged, as a failed exchange is, since to the user it looks like any failure.
  All are checked after the `state` check, so a callback with no flow is still `expired`, nothing reaches the log without a flow this browser started, and asking again is told the same.
  `/start` is a fetch from the app and still answers these in JSON.
- **`sameSite=lax`, not `strict`**, on both cookies: the callback is a top-level navigation arriving from the provider, and `strict` would drop the cookie exactly when it is needed.
  `secure` is derived from `APP_ORIGIN` so plain-HTTP local development still works.
- **The HMAC key is derived from `SECRETS_KEY` through HKDF**, not imported from the same bytes that do AES-GCM.
  One key, two algorithms, is how key-separation bugs start.
- **`token_access_type=offline`**, and a grant that comes back without a refresh token is a 502 rather than a stored connection that would stop working in four hours with no way to recover.
- **A unique index on `connections(user_id, provider)`** (migration `0001_connection_per_provider`) turns reconnecting into an `ON CONFLICT DO UPDATE` instead of a read-then-write race between two tabs.
  It also makes skysa-notes §12.3 a constraint rather than a UI convention.
  Reconnecting clears `root_id`: a new grant can point at a different account.
- **`SECRETS_KEY` must decode to exactly 32 bytes**, checked at boot.
  It was `.min(1)`, which meant an operator mistake surfaced the first time somebody tried to connect an account.
  (The existing test fixture turned out to decode to 30 bytes.)
- **`returnTo` is confined to this app.**
  Anything not starting with a single `/` becomes `/`.
- **`/api/token` decrypts the refresh token and returns only the access token.**
  It is the first `entitlements.check(…)` call site (§6, "Entitlement seam"), and it re-seals a rotated refresh token so the connection survives a rotation Dropbox is allowed to do.
- **Disconnecting revokes best-effort and deletes regardless.**
  A user who asked to disconnect must not be left connected because the provider was down.
  `revoked: false` says only that the grant may still be live — the revoke failed, or the provider (Microsoft) has none.
- **One provider per user (skysa-notes §12.3), enforced once a second provider exists (Phase 3).**
  A signed-in user whose storage is connected at one provider is sent back with `connect=occupied` when they start or finish connecting another, and has to disconnect first.
  In storage-first any connected account signs in as its user, so a Dropbox and a OneDrive connection side by side would make whoever holds the OneDrive account able to mint the Dropbox tokens.
  Reconnecting at the same provider replaces, as before.
  Two consent flows for the same user that overlap — in two tabs, or on two devices, one of which stays signed in after the other disconnected the last connection — can both pass the check; Phase 7's multiple connections have to answer that properly (a unique index, or connections that do not sign anyone in).
- **Only a refused grant asks the user to reconnect.**
  `invalid_grant` and `interaction_required` from a token endpoint are `reauthorize_required`; anything else — `invalid_client` once a client secret expires, `temporarily_unavailable`, a 5xx, a timeout — is logged by its code alone (`packages/server/src/log.ts`) and answered `502 provider_unavailable`, which the client retries.
  Told to reconnect over an expired secret, every user would go through a flow that fails the same way, and nothing would tell the operator.
  A failed code exchange is logged the same way.
- **Google (Phase 4, `packages/server/src/oauth/gdrive.ts`)** follows the Microsoft shape, with Google's differences:
  - The request carries `access_type=offline` (no refresh token otherwise) and `prompt=consent select_account`.
    Consent is asked for again because a reconnect gets no refresh token without it; `select_account` is there for the shared-machine reason §5.2 gives.
    There is no `include_granted_scopes`, so the consent screen lists exactly the storage scopes.
    Revocation is per project either way (§6's two-flows bullet).
  - **Granular consent:** Google lets the user untick Drive and still completes the grant.
    The exchange checks the response's `scope` for `drive.file`.
    If it is missing, nothing is stored and the user is sent back with `connect=partial` (a `ScopeNotGrantedError`, which no token endpoint's error code can imitate), which the web app answers with "leave that permission ticked".
    This is not logged, since it is the user's choice.
    Nothing is revoked either: Google revokes per project, so a revoke here would also end the same user's working connection on another device.
  - The account id is the ID token's `sub`, read and `aud`-checked as for Microsoft.
    Unlike Microsoft's, Google's `sub` is the same for every app the account signs in to.
    The display name is `email`, else "Google Drive", and is stored unverified whatever `email_verified` says (§6).
  - A refresh returns no refresh token, so `/api/token` keeps the stored one.
  - Disconnecting revokes: `POST oauth2.googleapis.com/revoke` with the freshly refreshed access token.
    That revokes every grant the user gave the Cloud project, which is why [skysa-notes' `docs/google-oauth.md`](https://github.com/skysa-org/skysa-notes/blob/main/docs/google-oauth.md) asks for a project per deployment.
  - A Workspace admin restricting Drive answers `admin_policy_enforced`, which is `provider_unavailable`, not `reauthorize_required`: reconnecting would be refused the same way.
  - While the Cloud project is in Testing, refresh tokens expire after 7 days.
    That arrives as `invalid_grant` → `reauthorize_required`, so users reconnect weekly.
    skysa-notes' `docs/google-oauth.md` walks an operator through the project, the client and leaving Testing.

**Test harness.**
`@cloudflare/vitest-pool-workers` — which would give the tests Miniflare's real D1 — still peers on `vitest ^4.1.0` against this workspace's 5, so it cannot be installed.
The fallback is a ~120-line D1 shim over Node 22's built-in `node:sqlite` (`packages/server/tests/d1.ts`), which keeps the real `drizzle-orm/d1` driver, the real schema and the real migration files; only the process hosting SQLite differs.
No new dependency.
Swap it for the pool once that supports Vitest 5.

**Deliberately not done:** AES-GCM is used without additional authenticated data.
Binding the connection id as AAD would stop a ciphertext copied between rows from decrypting, but an attacker who can write to `connections` has already lost the user the game.
Recorded here rather than done, because the seal/open signature is cheaper to change now than after WebDAV credentials use it too.

<a id="per-connection-credentials"></a>
### Per-connection credentials (Phase 7)

Until Phase 7 a user held **at most one connection**, because in `storage-first` any connected account signed you in as that user: two connections under one user would cross-authorize, and whoever held the OneDrive account would get tokens for the Dropbox one.
Phase 7 removes the premise rather than the guard.
**There is no shared user.**
Each connected storage account is its own silo — auth and data coupled — and the device switches between the ones it holds.

What proves a device's right to a connection is a credential it generated, not a session cookie:

1. The PWA generates 32 random bytes, **awaits** an IndexedDB write of them, and sends `SHA-256` of `sk1_<bytes>` to `POST /api/auth/connect/:provider/start` with `returnTo`.
   The hash rides in the existing signed `__Host-skysa_flow` cookie beside `state` and the PKCE verifier.
2. The callback commits the connection **and** its grant in one `db.batch`, then redirects as before.
   The batch being one transaction is load-bearing for the racing-callback recovery, and that in turn assumes D1 enforces foreign keys within it — documented, but proven here only against the `node:sqlite` shim.
   If it did not, the loser of a race would commit a grant pointing at an id that does not exist, the user would see `connect=ok`, and the device would be 401 forever with its hash spent.
   The *security* property does not depend on it: a grant pointing at a dead id reads as claimed and authorizes nothing.
3. The PWA presents `Authorization: Bearer sk1_…` from then on.

The plaintext credential never enters a URL, a fragment, history, a `Set-Cookie`, a response body, a Worker log, or the database.
"The API never holds the plaintext" is literally true rather than true-except-in-transit — which is what deleted the exchange endpoint, the pending-code table, its TTL and sweep, the double-claim race, and the window where a connection was committed but its credential was never collected.

Each decision, with the reason it would otherwise be got wrong later:

- **`/start` is a same-origin `POST`.**
  The hash is caller-supplied, so a `GET` would be a session-fixation hole: a link carrying the attacker's hash, consented to by the victim, hands the attacker a live credential to the victim's storage.
  `hono/csrf` does not cover JSON bodies (it matches only form and text content types, leaning on CORS preflight), so the route checks `Origin === appOrigin || Sec-Fetch-Site: same-origin` itself and keeps `csrf()` as defense in depth.
- **Lookup is by hash, not `<id>.<secret>`.**
  An id-then-compare needs a constant-time comparison, and `crypto.subtle.timingSafeEqual` is a Workers extension **Node's webcrypto lacks** — and the suite runs on Node against a `node:sqlite` D1 shim.
  A unique index on the hash sidesteps a hand-rolled comparison tested under the wrong crypto.
  Idle expiry is part of the same query, so an expired grant is indistinguishable from an unknown one.
- **A hash is claimable once, ever, and `grants` rows are therefore never deleted.**
  Revoking a device, disconnecting the account (the foreign key is `on delete set null`) and the cap's prune all null `connection_id` and leave the row; `grantHolder` treats a null as revoked.
  The row that stays is a tombstone, and the unique index over `secret_hash` is what it holds.
  "Once, ever" means once per continuous life of the database, which is not quite unconditional: D1's Time Travel restores a point in time, and the credentials themselves live in each device's IndexedDB and are not rolled back with it.
  A restore therefore un-spends every hash issued since the restore point while the devices holding those credentials still hold them.
  Nothing in code can see that; it belongs with the operator, alongside the fact that a deployment reset invalidates every credential at once.
  Review caught this as a live hole rather than a precaution.
  An earlier draft used a plain insert and reasoned that a repeated hash would fail — true only while the row exists.
  A hash leaked from a database dump mints nothing on its own, but once its grant is gone it is claimable again, and the attacker needs nothing of the user's: they start a flow with the victim's hash, consent with storage of *their own*, and the row is re-pointed.
  The victim's device — offline throughout, holding the plaintext, told nothing — comes back, is answered 200, and syncs the user's notes into a stranger's Drive.
  All three ways a grant used to disappear reached it, and the prune is not even user-initiated.
  Tested as the attack, once per path (`connect.test.ts`, "a hash is spent once, however its grant stopped being live").
- **A connection no live device reaches is deleted, not kept.**
  Left behind it is a sealed, live refresh token that nothing can use and nothing can revoke — disconnecting takes a credential.
  So revoking the last live grant (only a device signing itself out can, since a caller revoking another is itself live) disconnects.
  The grant is nulled and the row deleted in one batch, which D1 runs as one transaction (`revokeGrant` in `packages/server/src/db/connections.ts`), by a statement that asks and deletes together (`DELETE … WHERE NOT EXISTS` a live grant), and only then is the grant withdrawn at the provider, best-effort, from the row as it was read: asked first and deleted after the provider's calls, a device whose callback committed in between had the row taken from under it, and a request cut off during those calls left exactly the orphan this removes.
  *Revised 2026-10-28:* the nulling and the delete were two statements until then, and a request cut off between them left that orphan too.
  *Revised 2026-10-02:* this is now what the panel's Disconnect does.
  It used to call `DELETE /api/connection`, which took the account from every device holding it: disconnecting on a phone stopped the laptop syncing too, though nothing on the laptop had been asked.
  Disconnect now signs out the device it is pressed on and no other (`signOut` in `packages/client/src/api/client.ts`: `GET /api/connection` for this device's `grantId`, then `DELETE` that grant), so only the last device out disconnects the account and withdraws its access at the provider.
  The question says which this will be before it is answered, from the device list's own count (live grants other than this one; `stillSignedIn`): "The other device connected to it stays connected and keeps syncing", or "This is the only device connected to it, so the account is disconnected too", or both where the server could not be asked.
  Where to withdraw OneDrive's access by hand is said only when the account may be going.
  Canceling a first import signs out the same way, since the account being imported may be one another device was already syncing.
  A device the user believes is stolen is signed out from the device list (Remove), which never takes the last.
  A grant idle past its expiry cannot authenticate and does not count as live.
  Connecting the account again makes a new row, and the device knows its notes by the account's id, not the row's.
  And the device retires what it replaces: "Connect again" mints a new credential, so once that is kept the device signs out the one it held for the same connection (`claimConnection`), rather than leaving it in the device list as a live key for 180 days.
  Best effort — a credential already revoked has nothing to retire.
  What is still not covered, and these are the orphans that do happen: a device that clears its site data while it is the only one, and an account whose every device idles out.
  The grants expire, but the row stays; there is no sweep, because a Worker has nowhere to run one without a cron trigger every self-hoster would then carry.
- **A device reconnecting with the credential it already holds succeeds.**
  The same draft refused every repeated hash, which wedged the ordinary case: nothing tells a device to mint a fresh credential before connecting again, and the duplicate rolled back the whole batch — new refresh token included — identically on the retry.
  A hash whose row already points at *this* connection is that device; only a hash bound elsewhere, or spent, fails the connect.
- **`GET /connections` is gone, replaced by singular `GET /api/connection`.**
  A one-element array invites the aggregation model straight back, and the client that unbinds on an empty list would keep "working" with the wrong meaning. 404 (or 401 for a revoked credential) means *this connection is gone*; a 5xx or a network failure means nothing.
- **`connections.account_id` is `NOT NULL`** so `(provider, account_id)` can be the upsert target: SQLite NULLs do not conflict, and a nullable target would insert a duplicate on every reconnect forever.
- **A grant cap per connection** (20, pruned inside the same batch), because every live grant is a key to the same storage.
  Eviction is by `last_used_at`, not `created_at`: pruning by age logs out the device someone actually relies on and keeps the ones they have stopped using, and going by use also means a grant already past its idle expiry is evicted before a live one instead of holding a slot it can no longer use.
- **Migrations `0004`/`0005` are hand-written.**
  `drizzle-kit`'s SQLite table rebuild emits `PRAGMA foreign_keys=OFF`, which D1 rejects and the test shim silently tolerates — green in tests, wedged on `wrangler d1 migrations apply`.
  A rebuild written by hand avoids the pragma but not the `DROP TABLE` + `RENAME` pair in the middle, whose partial state no re-run can recover from; so the new shape gets a new table name (`storage_connections`), `0004` never drops the table it reads, and dropping the old one is `0005`'s single statement.
  Every device reconnects after this: sessions carried that right before, and a grant can only be created by the OAuth callback.
- **`sessions` goes; `users` and `identities` stayed**, annotated at the time as the account-first mode's only callers.
  That mode was dropped on 2026-09-18, which left the two tables with no caller at all, and `0007` drops them (skysa-notes#118).
- This retires `holdsAnotherProvider`, `session_mismatch`, `claimedBy`, the compensating delete, and the `conflict`/`signin`/`occupied` outcomes — not by relocating them but by removing what made them necessary.

**The device half.**
A device holds a credential for each connection it has made, and tokens for each, in the app's store through `@skysa/client`'s ports (`CredentialStore`, `TokenStates`), and every call the client makes presents the credential of the connection it is about.
Which source a device shows, how a source's first import is held, and what letting one go does with what it has not sent are the app's: they are its store and its screens (skysa-notes §6, "Per-connection credentials", from "The device half").
Two of its rules bind any app, because nothing on the server can tell their breach from an attack:

- **The credential is written down before the binding.**
  A binding the device holds no credential for is one it can never use.
- **A disconnect names the source it is for.**
  The answer that lets a source go can arrive after the user has switched to another, so letting go of "the one showing" would take a source the user never touched and leave the one the server dropped live on the device.

**The security trade, stated rather than buried.**
CSRF disappears as a class (a bearer is never sent ambiently) and the blast radius of a theft drops from *every* connection to one.
But `httpOnly` was real protection against exfiltration and IndexedDB is not: an XSS today can mint tokens only while the page lives; tomorrow it can post the credential anywhere and use it until someone revokes the device.
What holds the line is `script-src 'self'` with nothing inline (an app's `_headers`: skysa-notes' is `apps/web/public/_headers`, pinned by its `tests/csp.test.ts`), which stops being a good policy and becomes a hard requirement, plus HSTS on the shell, a device list that makes theft visible and revocable, and lazy idle expiry (180 days).
The `sk1_` prefix reserves a non-extractable-ECDSA proof-of-possession variant that buys the property back; this ships the bearer and keeps the seam.
It is written into CLAUDE.md in words, because a hard-rules list implying IndexedDB is safe for a long-lived bearer is exactly the kind of rule that quietly stops being honest.

**Deliberately not done:** no server-side revocation list, no per-device names, and no proof of possession.
*Partly revised 2026-10-02:* each grant now keeps a label for its device, "Safari on iPhone", worked out from the User-Agent of the app's own request to start connecting (`packages/server/src/device.ts`), carried to the callback in the signed flow cookie, and refreshed when the device reconnects.
*Revised the same day:* it was first taken from the callback, the browser's navigation back from the provider, and a Chrome on a Mac arrived there saying it was Safari on an iPhone; whatever rewrites a User-Agent for the provider's pages (an extension, a site setting) reaches the callback, and the start is the app asking.
It needs nothing that says who is asking — it is what the device is, not whose — and it is the label only: never the header, which says which build of which system, and no address or place.
A row that said only "a device, last used 9:48 AM" could not be told from the phone in the user's pocket, which is the one comparison the list exists for.
Names the user gives a device are still not done.
A grant from before `0006`, or from a browser the label does not know, has none and says "A device".
The device list plus `DELETE` is enough to act on a theft the user knows about; anything more would need something that can say *who* is asking, and after 2026-09-18 there is deliberately no such thing: the credential names a connection, not a person.
A revocation list is the one of the three that could still be built on what exists.

<a id="data-model-drizzle-d1"></a>
### Data model (Drizzle, D1)
```
storage_connections id, provider, account_id, display_name, root_id,
                    secret_ciphertext, secret_iv, secret_key_id, created_at, last_used_at
                    -- unique on (provider, account_id); no user
                    -- secret = { refresh_token } for OAuth, { url, username, password } for WebDAV
grants              id, connection_id (null once revoked), secret_hash, created_at, last_used_at, device
                    -- secret_hash = base64url SHA-256 of the device's `sk1_…` credential, unique
```
Secrets encrypted with AES-256-GCM using `SECRETS_KEY` from env (rotate by re-encrypting; key id stored alongside ciphertext).
Never log secrets.
Never return them to the client.
The credential behind `secret_hash` is never stored at all.

<a id="endpoints"></a>
### Endpoints
| Route | Purpose |
|---|---|
| `POST /api/auth/connect/:provider/start` | `{ credentialHash, returnTo? }` → `{ authorizeUrl }`. Storage scopes; PKCE + state + the hash in the flow cookie. Same-origin only |
| `POST /api/connect-code` | `{ code }` → `{ accepted: true, expiresIn }` or `{ accepted: false, reason? }`, from the policy's `checkCode`. 404 where the gate asks for no code. Same-origin only, rate-limited |
| `GET  /api/auth/connect/:provider/callback` | Exchange code, upsert connection with encrypted refresh token **and** its grant in one batch, redirect to app. Asked again within five minutes, the same redirect; with no flow, `/?connect=expired`; any other failure, `?connect=failed`, never JSON |
| `POST /api/connections/webdav` | *(deferred, §5.4)* Validate by `PROPFIND` against the URL, store encrypted creds |
| `GET  /api/connection` | The one connection this credential reaches (no secrets), and this device's `grantId` |
| `GET  /api/connection/grants` | The devices holding this connection, which one is asking, which have gone idle, and what each is (`device`, where known). No hashes |
| `DELETE /api/connection/grants/:id` | Revoke one device, this one included ("sign out"). The grant's row stays, nulled. The connection survives while any other live device reaches it; with the last one it goes as `DELETE /api/connection` takes it, and the answer says so (`disconnected`, `revoked`) |
| `DELETE /api/connection` | Revoke at provider where supported, delete row; every grant is nulled, not deleted. Every device at once; the web app's Disconnect signs out one (`/connection/grants/:id`) since 2026-10-02 |
| `POST /api/token` | No body → `{ accessToken, expiresAt }` using stored refresh token |
| `POST /api/connection/relay/ticket` | No body → `{ ticket, expiresIn }`, for opening the relay socket below. 404 `relay_disabled` where the deployment runs no relay. Rate-limited |
| `GET  /api/relay?ticket=…` | WebSocket upgrade to the change relay ("Change relay", below). Same-origin; the ticket's grant must still be live. Outside `/api/connection*` because a browser cannot send `Authorization` on a WebSocket |
| `ALL  /api/webdav/:connectionId/*` | *(deferred)* Authenticated proxy (see 5.4) |

Everything under `/api/connection*` and `POST /api/token` requires `Authorization: Bearer sk1_…`.
Two refusals, and the difference is actionable: `credential_required` (401) means the device never had one and should connect; `credential_revoked` (401) means the one it holds is not known here anymore and should be thrown away first.

There are no sign-in routes, here or anywhere: identity is the storage connection (§6).
`AUTH_MODE=account-first` still refuses to boot, though the server no longer reads the variable (skysa-notes#118): it describes something this project has decided not to build, and booting with it would let an operator believe connections were gated behind a sign-in.
Any other value boots, with a warning to remove it.

<a id="change-relay"></a>
### Change relay (optional, 2026-10-05)

Where the operator turns it on, a device that has pushed tells the API and the API tells the connection's other devices, which then pull; it carries that something changed, and nothing else.
The decision record is [`decisions/0003-change-relay.md`](decisions/0003-change-relay.md).


---

<a id="local-store-and-sync-engine-client"></a><a id="s7"></a>
## 7. Local store and sync engine (client)

The device's store is the app's.
skysa-notes keeps it in IndexedDB through Dexie ([skysa-notes §7, "IndexedDB schema (Dexie)"](https://github.com/skysa-org/skysa-notes/blob/main/docs/ARCHITECTURE.md#indexeddb-schema-dexie)), and the kit reaches it only through ports: the engine through `SyncStore` (`packages/sync/src/store.ts`), the scheduler through `ClientStore` (`packages/client/src/sync/scheduler.ts`), the token source through `TokenStates`, and the credentials through `CredentialStore`.
The kit's own store for each, in memory (`createMemoryStore`, and the client's `memoryDevice` in its tests), passes the same contracts an app's store must (`describeSyncStoreContract`, `describeClientStore`).
What follows is the engine's part of skysa-notes' §7, and the scheduler's.

<a id="files-beside-documents"></a>
### Files beside documents

**Pushing files (2026-10-03, skysa-notes#187).**
Three ops, each in `packages/sync/src/push/files.ts`:
- **`upload`** sends a pending row's bytes to where the row is now.
  The bytes are those held here; for a copy made when a note moved and its file could not go with it, they are the bytes of the file it copies (`copyOf`), read from the remote.
  The provider is told a content type by extension (`contentTypeOf`), which it records and nothing here reads.
  A missing parent is made, a level at a time, as for a write.
  Something already at the name is handled in one of two ways:
  - **The same file** — a file the size of the bytes being sent, that no other row holds and no queued `delete-file` is to take — is adopted.
    It is this device's own upload whose answer never came back, or the same picture added on another device; names carry the bytes' hash, so a name and a size that both match are almost always that.
  - **Anything else** keeps the path, and the upload goes beside it as `<stem> (conflict <stamp>).<ext>`.
    The note that links the file is not rewritten.
    The conflict name is chosen from one listing of the folder and the rows here, not found by trying names: Dropbox and OneDrive take the whole body before they say a name is taken, and a row not yet sent holds its name as surely as a file there.
    A second clash is a race with another device; eight, and the op fails and is tried again.

  With no bytes here and nothing left at `copyOf`, the row goes (`lost-file`).
  Only a not-found says that: any other failure to read the original fails the op, and the copy is tried again.
- **`move-file`** moves by id, from where the op says the file is (the store keeps that current as pulls move it) to the row's path.
  A not-found is asked of the origin folder's listing, never of the file, since reading the file would download it: gone, the op is done; still there, the target folder is made and the move tried again.
  The same file at the target is adopted, and the one moved from is left where it was, because another note may link it there.
  That includes a note on another device, which copied the file rather than moving it.
  Until a full scan this device does not see that file again: a known gap, and nothing is lost.
  The row keeps no bytes it had cached, which were the other file's.
  Anything else at the target and the file goes beside it, as an upload does.
- **`delete-file`** deletes by the id the queue recorded.
  Not found is what was wanted.

`rmdir`'s third gate counts file rows, so a notebook holding a file not yet sent is the user's still.

**Uploads do not hold up the queue.**
This is the second exception to the ordered queue, after `rmdir`.
An upload that fails is counted against its attempts and stepped over, and one out of attempts is stepped over and kept.
It is never completed: it is the only copy of the file.
A note that links the file goes without it, and other devices show the file as not there until it lands, which heals itself.
- **Order.**
  An upload's first try keeps its place, so a file lands ahead of the note that links it, and the edits behind it wait for that one try.
  Once it has failed, each push sends it after everything else, so the edits queued since do not wait out its further tries on the connection that failed it.
  A copy (`copyOf`) keeps its place, for the reason in the last bullet.
- **Status.**
  The outcome carries `waitingUploads`.
  Its status is `retry` when an upload failed this run, and `blocked` when one is out of attempts; the scheduler gives a blocked queue its attempts back in time, as for any stuck op.
  A conflict resolved, or a failure met, behind a stepped-over upload keeps that count.
- **What it costs.**
  A `retry` arms the scheduler's backoff for the whole connection, so an edit made after an upload failed waits for the backoff (5 s, doubling to 5 min), as it would after any failed run.
  Kept so on purpose for a run that failed only on uploads (2026-10-03, skysa-notes#187): an upload that fails is a provider or a connection failing a request, which the next note's write would most likely meet too, and a backoff that spared upload-only runs would send the 25 MB again on every trigger while the connection is down.
  The edits queued behind it are not lost, only later, and the user's Sync now skips the wait.
  The queue is read once, when a run begins, so an edit typed while an upload is on its way waits for that run to end as well — up to the nearly ten minutes a 25 MB upload is given at 50 KB/s (§4) — and goes in the next.
- **Naming what is stuck.**
  `stuckOp` in `packages/client/src/sync/scheduler.ts` names the first op out of attempts that is *not* an upload, which is the one that stopped the drain, and an upload only when nothing else is given up on: the queue is ordered, but an upload stepped over holds nothing up.
- A rate limit or a refused token still stops the drain, since neither is the upload's fault.
- **What waits.**
  One op behind a stepped-over upload does wait for it: a `delete-file` of the file the upload copies.
  Sent first, it would leave the copy nothing to read, since a deleted file cannot be read back by its id — trashed on Drive, gone on OneDrive and Dropbox.
  What that held delete is still in the way of waits with it: an `rmdir` over it, which would find the file and leave the folder standing for good; and an upload or a `move-file` to its name, which would meet the file on its way out and go beside it, away from the name the note links.
  An upload held so counts as waiting, and a copy among them holds back the delete of what it copies.

**Pulling files (2026-10-03, skysa-notes#187).**
Every listed file that is not a note and not hidden becomes a row, or brings its row up to date.
Nothing is downloaded: bytes are fetched when the file is shown.
No file decision calls the network, because a wrong bound row costs at most a picture that does not show until the next scan.
The rules, in `packages/sync/src/engine.ts` (`decideAttachment` and the functions around it):
- **Matching.**
  An entry is matched to a row by `remoteId` first.
  A row whose remote path, version and size are unchanged is passed over.
  Failing that, a pending row at the entry's path with the entry's size is adopted: an upload whose answer never came back, or the same picture added on two devices.
  Otherwise the entry is a new row.
- **The remote keeps the path.**
  A row in the way that has no file at that path, either never sent or moved there by the user, steps aside to a conflict name that keeps its extension (`displace-file`), and its upload or move goes there instead.
  A bound row in the way is let go of, unless the batch says later where its file went.
- **The user's word.**
  An entry for a file with a `delete-file` queued is passed over.
  A row with a `move-file` queued stays where the user put it, and the move's origin follows the remote.
- **Deletions** are matched by id, or, on Dropbox, by path against where the file is on the remote.
  A bound row goes.
  A row the user moved here is theirs, as an edit is: it is pending again where the user put it, and sent from the bytes held here (`reupload-file`).
  Where none are held it is pending all the same, and goes when its upload finds nothing to send (`lost-file`).
  The engine cannot see the bytes without reading up to 25 MB, and a row the store dropped while the engine still placed it got a later change in the batch refused, and with it the batch, on every pull for good (skysa-notes#194).
  The same holds when the folder its file was in is deleted there, which the cascade alone would not reach, because the row is no longer under it; and when another file is listed at the row's old path with no word of where its own went, as Dropbox reports a file replaced in place, where the move would find nothing to move (`originsTaken`).
- **Folders.**
  A remote folder's deletion takes the bound rows under it, and keeps pending rows and the rows the user moved into it, whose files are still elsewhere there.
  The notebooks they need are made again, as they are for a note a cascade keeps.
  It also spares (`keepFiles`) a file the rest of the round lists again, so that its own entry puts it where it now is as the same row, with its bytes; taken by the cascade, it would come back as a new row with none.
  This is the files' answer to the subfolders a deletion rescues.
  A folder's move carries its rows.
- **Across kinds.**
  A note's file renamed to a name that is not a note's lets the note go, as a deletion would.
  A file renamed into `.md` loses its row and is imported as a note.
- **Hidden paths.**
  An entry at a hidden path is passed over, so it says nothing of where a file went.
  A file moved into `.trash` is gone, as a deletion would say, and no rule reads the trash as its next place (`Batch.listed`, skysa-notes#194).
- **Scans.**
  A bound row that a full scan did not return goes, as a deletion would take it, so one the user moved is sent again.
  On an upload-differences reset every such row is sent again, and one with no bytes held is pending until the push that follows lets it go.
- **A known gap.**
  A row the user moved into a notebook, with the notebook and the file both deleted there and no bytes held, has the notebook made again for it, as for a note a cascade keeps.
  When the row goes at the push, the notebook stays, empty and local.
  Rare: the app moves a file only with the note that links it, or with its notebook.
- **A backstop**, `settleFileClashes`, settles two rows left at one path at the end of a batch.

Within a batch, the decisions are replayed over the file rows exactly as the store will apply them (`placedFiles`), memoized per batch.
Exactly, because a row the replay and the store disagree about has a later change about it refused, and the batch with it, on every pull.
The single-device soak (`randomRemote.test.ts`) checks after every pull, on every stub and page size, that the rows are the remote's files that are not notes.
The two-device suite (`overProviders.test.ts`) does the same at rest, and checks that a file added on either device reaches the remote with its bytes unless its notebook was deleted.

<a id="sync-loop-per-connection"></a>
### Sync loop (per connection)
1. **Pull**: `changes(cursor)` → for each remote entry:
   - new/updated remote, local clean → fetch content, upsert local, update `remoteVersion`.
   - new/updated remote, local dirty → **conflict** → apply rule from §1.
   - remote deleted, local clean → delete local.
   - remote deleted, local dirty → keep local, mark `remoteId = null` (will be re-created on push).
   - Persist cursor only after the batch commits to IndexedDB.
   - Cold start on a new device is a full scan (`changes(undefined)`); no remote index file.
     Revisit only if cold start exceeds ~10 s at ~2k notes.
   - A full scan reports how far it has got (`SyncEngineOptions.onProgress`, 2026-09-23).
     **It lists every page before it reads a note**, where it used to read each page as it was listed: no provider gives a total up front, and listing first is what gives one before the first download rather than after the last.
     Nothing is lost by it — a scan's pages carry no cursor, so an interrupted scan starts from the top either way — and pages are still decided and applied one at a time, so notes still appear as they arrive.
     While listing it says how many notes it has found so far; after, `done` of `found`, counting a note already held at its version as done without reading it (so a resumed import does not claim to download everything again), with the `path` of each file read.
     The push after it reports `done` of `total` ops and the path about to be sent.
     A round from a stored cursor reports too (2026-10-05): it reads every page before it decides any ("A round is one batch", below), so it knows how many notes it names before it reads the first, and says `done` of `total` as each is decided — read, or already held at its version, as this device's own push reported back is.
     It was thought short and reported nothing; but another device's import of a thousand notes is one round, nothing of which shows until all of it is read, and on Google Drive that is two requests a note one after another — minutes in which the other device showed its notebooks and nothing in them, with nothing to say why.
     The round is still applied whole; only the count is new.
     **It says so while it reads its pages, too (2026-10-13).**
     Reported on a phone: after a lot of notebooks were moved on the desktop, "Syncing…" for minutes with nothing else, and then a count.
     A notebook moved is not one folder moved on the remote — `moveFolder` sends a `mkdir` for each new folder and a move for each note and file in it — so the other device's next round names every note moved, and its pages were read with nothing said: on Google Drive each page also lists, one request a folder, every folder new in the round (four at once since a later change the same day, §5.1).
     A round now reports `receiving` with `listing` before its first page, and after each page that names more notes, how many it has named so far (`total`, `done` 0), then `listing: false` with the whole count — even when that is none, so the words never outlive the reading.
     A scan reports before its first page as well.
     The line says "Checking…" (a scan, "Looking for notes…") from the first, and the count with a bar that does not know of how many once it has found twenty; on Drive a round of up to a thousand changes is one page, whose folder listing is still read before there is any count to give, so there it says the words alone.
     The storage panel shows the count (`syncCount` in skysa-notes' `components/account/statusWords.ts`, which reads it as a run's details and a first import's dialog do, with `runCount` and `runBar` in `sync/progress.ts`, and `runSentence` beside it): in a wide window, in a few words in the status line at the sidebar's foot ("120 of 1,000 sent"), with the sentence and the file it is on in the line's tooltip and a bar in the panel's padding under it; in a compact window, as the panel's sentence over the bar.
     A round or a push of a few notes is not shown as a count: the panel says how many only from twenty up (`PROGRESS_FROM`), so an edit's sync does not flash a bar.
   - **A pull keeps what it has read until its batch commits (2026-10-05).**
     A batch is all or nothing — a round always, and a scan a page at a time, which on Google Drive is a thousand notes (`PAGE_SIZE` in `providers/gdrive/wire.ts`) — so a pull that failed at the last note threw away every note it had read, and the retry read them all again.
     On a phone that is every time the screen goes off mid-import: the network goes with it.
     The engine now keeps each note it reads (`held` in `packages/sync/src/engine.ts`), by remote id and the version the read reported, and answers a later read of that file at that same listed version from it; a committed batch's entries are let go of, entry by entry rather than all at once, since a retried scan commits its earlier pages again before it reaches the one that failed, and all of it once a pull reaches the end, when what is left is a file the listing no longer names.
     Only the pull's own read of a note goes through it — never a read that asks whether a file is still there, which is about now, nor the push's.
     It is in memory, so it lasts as long as the engine, which is one session of one connection (`follow` in `sync/scheduler.ts`): a reload, a switch of source, or another tab taking the sync lock starts empty.
     Not capped: the strings are the ones the batch's own changes hold while it runs, one version per file.
     Committing a scan in smaller pieces instead was looked at and set aside: the engine decides each entry with the whole batch in view (`noteForEntry`'s look at `batch.live`, `movesOn`, `claimed`), and a rescan split part-way can give a note's identity to the file that took its name.
     That is already true across a provider's own page boundaries on a rescan, and is its own issue.
   - **Syncing says when it waits on this device (2026-10-10).**
     Reported on a phone: "Google Drive · Syncing…" for minutes and nothing else, while the run sat behind reads another tab of the app had left open (skysa-notes §7, "A frozen tab lets go of the database").
     To the user that looked like a slow network.
     IndexedDB does not say a transaction is being kept waiting, nor on what, so the tab follows its own (skysa-notes' `store/heldUp.ts`, a Dexie middleware the app's database gets in `watchTab`, with the tab's other watchers; a database made for a test, or beside the app's, gets none of them, so as not to leave a `freeze` listener on `document` for each one): when each is made, when its first answer comes, and when it ends.
     A transaction runs once no transaction made before it on a table it shares is still going, and its first answer then comes in milliseconds.
     So the oldest of the tab's transactions still going, while it has had no answer, can be waiting only on another connection's, since nothing of the tab's own is ahead of it.
     A younger one may be waiting behind the tab's own work, such as an import or a sync's batch, and is not counted, so that work is never taken for another tab.
     An answer counts only where IndexedDB gave it.
     The middleware sits under Dexie's own (level -10), so that the cache answering a live query from memory is not taken for one, and neither is an empty write or a read of no keys, which Dexie answers without asking.
     Either would have a waiting transaction counted as running and every wait behind it go unseen (found in review).
     Listeners are told in a task of their own, outside every transaction and live query.
     **Every transaction is followed, not only the run's.**
     The first cut handed over the store's calls and the run's first read, and missed the phone's case: a frozen tab's reads hold up no read, only the next write to what they read, and after an empty pull that is the write that ends a first import (`finishImport`), which nothing handed over.
     While a run is under way (`watchWaits` in the scheduler, to the end of what it writes after), a wait that lasts 5 s (`SYNC_WAIT_MS`) with the run getting no further makes the status say `waiting`.
     Progress starts the time again, since a count going up under "Waiting for a tab" would be saying two things at once.
     It is set in `syncing` only, and dropped with the run, as `progress` is.
     Any of the tab's waits counts, because the run is the next to need what is held.
     The status line then says "Waiting for a tab" in place of its count.
     The tooltip, the compact panel and a first import's dialog give the whole sentence, and the bar stays where it had got to.
     The one thing counted that is not waiting is a first request whose own work is long, a read of an entire, very large library on a slow device.
     The "Sync now" press frees blocked ops before the run starts, and a wait there is not said: it happens while the line still shows the last sync time, not "Syncing…".
     **Behind another tab's sync, too (2026-10-13).**
     A run takes its connection's sync lock (`skysa-notes:sync:<id>`, a Web Lock) before it reaches the engine, and the line said "Syncing…" for as long as another tab of the app held it, since a lock is not IndexedDB and `heldUp` does not see it.
     A run that has waited 5 s for the lock now says `waiting` as well (`waitForLock`), until the lock comes, whatever the database says meanwhile.
     A lock this tab's own work holds is not another tab's: a run a pause let go of, still putting its batch away, or a re-scan clearing the cursor.
     The tab knows which locks it holds (`underSyncLock`), and behind one of its own it asks again 5 s later instead.
   - **A sync can be paused (2026-10-13).**
     Asked for on a phone, after minutes of "Syncing…" with nothing to say what it was doing and no way to stop it; how an app shows the run and offers the pause is its own (skysa-notes §7, "A sync can be looked into, and paused").
     Pausing (`pause` in the scheduler) ends the session as a cancel does (`halt`), which aborts every request the run has out, and makes the next one paused: it publishes `paused` and runs nothing, and every trigger — the minute, an edit, focus, the network back, another device's notice — goes through `run`, which refuses while paused; going offline does not say `offline` over it.
     The session is a whole one, so a file beside a document is still read when it is opened.
     A batch the run was already writing is written whole with its cursor, so nothing is half-applied, and an op whose request was aborted is given back the attempt that counted against it once the run lets go.
     It lasts until the user asks again — a sync now, or a re-scan — or the source is shown again after another, or the app is opened again: in memory only, so a reload never leaves a device unsyncing without its user there to see it.
2. **Push**: drain `opQueue` in order — except that where the provider takes more than one at a time (`StorageProvider.writesAtOnce`, 2026-10-05), the writes of notes at its front go that many at once (`together` in the engine).
   That is four on Google Drive, where a new note is three or four requests end to end and, one at a time, an import of a thousand took most of half an hour; four is well inside its limits (a user has 325,000 quota units a minute, a note costs a few hundred: https://developers.google.com/workspace/drive/api/guides/limits).
   Dropbox stays at one: it locks the namespace for each write, and enough at once are answered `429 too_many_write_operations` (https://docs.dropboxapi.com/dropbox-api/docs/performance), a rate limit that backs the whole sync off.
   OneDrive stays at one until it has been measured.
   Only notes' writes go together, each at its own path, and not the write of a note with a rename queued: that write takes the rename with it, and another note's write can be waiting on the name it gives up — renamed b→c and a→b, both edited, and sent together, the second met b.md still taken and was put beside it as a conflict.
   A notebook made or removed, a move, a delete and a file each go alone in their turn, since those are what later ops depend on.
   A notebook missing under writes sent together — deleted on another device while they had edits — is made once between them: each making it, Drive made one apiece, since its `createFolder` asks first whether the folder is there and none was yet.
   The requests per note on Drive were left as they are: dropping the search before a create would save one in four, but it makes a duplicate on Drive that the search after must trash on every name already taken, which the stub cannot hold and no live run here has checked; and a folder-id cache is still refused (§5.1), the more so now — a notebook another device deletes in the middle of an import is what a device shown it empty does, and a cached id would send the rest of the import into the trash.
   `write` passes `expectedVersion = remoteVersion`; on `ConflictError` → run conflict rule, re-queue.
   On `AuthError` → request token from backend, retry once, else pause connection and surface in UI.
   Exponential backoff per op; give up after N attempts and surface.
3. Triggers: app open, tab regains focus, `online` event, 60s interval while visible, Background Sync API when available (best effort), immediately after a local edit (debounced 2s), and — where the deployment runs the change relay (§6) — a notice that another device of the connection has pushed, and 3 and 10 s after the last such notice.
   The relay is one more trigger, never a replacement for the others: it hears nothing of edits made in the folder by other tools.
   **When a push goes** (`packages/client/src/sync/scheduler.ts`, skysa-notes' record 0018):
   - An edit's ops go 2 s after the last one queued (`debounceMs`), and every op skysa-notes queues is an edit's.
   - Hiding the page sends whatever is waiting, at once (`sendWaiting`).
     A phone may not run the page again for hours, and the next device opened should find the edit.
     Until 2026-11-09 an edit made in the 2 s before the app went out of sight waited out its 2 s, in a page the phone could have frozen by then.
   - An app whose changes come every few seconds queues their writes lazily (`queueWrite`'s `timing`) and passes `lazyMs`: memoriam, which records a pass of practice every few.
     A lazy write goes with the next sync — the poll while the page is in sight, or as it is hidden — and `lazyMs` after the first at the latest; a later one joins that wait rather than putting it off.
     An edit that finds only a lazy write queued for its note replaces it, at the back of the queue, and a write that lands after another lazy change is owed again as lazily as it was queued.
     skysa-notes passes no `lazyMs` and queues nothing lazily, and without `lazyMs` the scheduler does not read the queue to tell.

<a id="folder-renames-moves"></a>
### Folder renames/moves
A remote folder rename or move is applied locally unconditionally, including when notes inside it are dirty: the move is metadata-only and does not conflict with content edits.
Dirty notes keep their pending content ops and simply get their `path` rewritten; queued ops that reference old paths are rewritten before push.

A folder renamed, moved or deleted *here* is not one op either: its notes and the files beside them (skysa-notes#187) go up as moves or deletes, and an `rmdir` follows them for **each** directory they left, outermost first.
The bullets below say when an `rmdir` removes anything — which is only when the folder is still the one the queue meant and holds no file at all.

One op per directory and not one for the outermost, though the outermost really does take its subdirectories with it on every provider, so each of the others sends nothing.
The op is not only how the directory is removed: it is also how the *pull* knows the directory is spoken for.
A sync pulls before it pushes, so between the move and the push the old directories are still on the remote, and the rows that named them have been re-pathed and stripped of their ids — which is what stops a full scan reading the id at the old path as a remote rename and undoing the move.
To that pull they are directories nobody owns.
`decideFolder` already refuses to make a notebook of one whose `rmdir` is queued, but it matches the op by id **and** path, which is what keeps it from dropping a folder another device has moved since; a subdirectory with no op of its own matched nothing.
So the whole subtree came back — the notebook at its old path, ancestors conjured to hold it — and the outermost `rmdir` was then refused, because the device held a row under it again.
The duplicate was permanent and on the remote as well as in the sidebar.
Found by re-parenting a notebook that had been dragged into place a round earlier (2026-09-22): a directory this device made in the round before is exactly what its own next pull reports, which is why it needed a drag, a sync, and another drag to show up at all.


<a id="conflict-rule-concrete"></a>
### Conflict rule (concrete)
Remote wins the original path.
Local content is saved as a new note at `<path minus .md> (conflict <YYYY-MM-DDTHH-mm>).md` with the same frontmatter except a fresh `id`.
Both appear in the UI; a small banner links to the pair.

The stamp is UTC and minute-resolution, with the `:` replaced — a colon is illegal in a filename on Windows and rejected outright by several provider APIs, and a copy the provider refuses to store is the lost edit this rule exists to prevent.
UTC so two devices in different zones name the same conflict the same way rather than producing two copies that look hours apart and unrelated.
A minute is not unique enough on its own, so a second conflict on the same note inside one minute gets `-2`, `-3`, and so on; the comparison is case-insensitive, because Drive, Dropbox and macOS all are.
The name is deliberately **not** slugified: the copy has to be recognizable as the note it came from and sort next to it.

The names are `packages/storage/src/names/conflicts.ts`; the copy's contents, with its own `id`, are the app's (`DocumentFormat`'s `conflictContent`).
The engine asks for them through the document format it is handed, skysa-notes' `NOTE_FORMAT` ([record 0018](https://github.com/skysa-org/skysa-notes/blob/main/docs/decisions/0018-the-shared-kit.md)), and reads no markdown for itself.

<a id="merge-before-the-copy"></a>
### Merge before the copy
An app may make the two sides one before the conflict rule applies, through the engine's `merge` option ([record 0018](https://github.com/skysa-org/skysa-notes/blob/main/docs/decisions/0018-the-shared-kit.md)).
skysa-notes passes none, so for it the rule above is the whole of it; memoriam's merges a passage practiced on two devices.
- **The option.** `merge({ path, local, remote })` returns the merged text, or `undefined` where the two cannot be one.
  A merge that throws counts as none: a merge that cannot be made is a conflict copy, never a sync that stops.
- **Where it is asked.** At both places the conflict rule is:
  - a pull that finds a dirty note whose remote bytes changed (`decideKnown` in `packages/sync/src/pull/notes.ts`);
  - a write the remote refused (`pushMerged` in `packages/sync/src/push/conflicts.ts`), which sends the merge against the version it read.
- **The `merge-note` change** carries the merge to the store, which applies it only while the note still holds the text the merge was made from (`base`).
  Otherwise the whole pull is refused, and the next one merges again from the note as it is.
  - A merge that equals the remote's bytes leaves the note clean, and drops its queued writes.
  - Any other merge leaves it dirty, with a write queued, so the merge is sent.
  - A rename queued here is kept: the note stays at the name the user gave it.


<a id="what-the-loop-above-left-open-and-how-the-engine-answers-it"></a>
### What the loop above left open, and how the engine answers it

The branch table is the specification; these are the cases it does not mention, each decided in the direction that cannot lose an edit.
They live in `packages/sync/src/engine.ts` and, for the push, in `packages/sync/src/push/`.

- **A file that is not a note is mirrored, and never read as one** ("Pulling files", above); anything at a hidden path is ignored.
  The app owns the folder but not everything in it: a PDF the user dropped beside their notes would be corrupted by being read as markdown and written back, and `.notesapp.json` is our own bookkeeping.
  Two separate checks, because the marker happens to satisfy both and would otherwise hide the loss of either.
- **Same bytes, new version → adopt the version, do not conflict.**
  This is our own write coming back, or two devices that saved the same thing.
  Keeping the old version would make the next push send an `expectedVersion` the remote has moved past, manufacturing a conflict over a file that already agrees with us.
- **A move reported as a deletion plus an entry** — which is what Dropbox and Graph do — must not act on the deletion.
  Applied after the move it deletes the note outright, and which order they arrive in is the provider's business.
  A remote id the batch says is somewhere *else* has been moved, not deleted.
- **A deletion is settled by a write-back only if the write pointed the note at a *different* file.**
  A note is written back by an entry about the very file a deletion names all the time — our own push echo arriving beside the other device's delete, which is what a rename here plus a delete there looks like.
  Reading "this batch mentioned the note" as settled drops the deletion forever and leaves the row pointing at a file that no longer exists; the next queued move for it can then never succeed, and the ordered queue strands every op behind it.
  Asked of the *file*, the two cases separate cleanly.
  A deletion carrying no id names no file, so there it stays a question about the note, and the provider is asked whether the file the note now points at is there: a rename queued here adopts the version without reading a byte, so the write-back says nothing about whether the file outlived the deletion behind it, and a note kept on suspicion points at nothing forever.
  Only "not found" lets go of it; any other failure fails the pull.
- **Alive elsewhere, not alive anywhere.**
  A batch routinely carries the state of a path before it was removed: our own write coming back, and then the other device's deletion of that same file.
  Reading the earlier entry as evidence the file survived drops the deletion — and a deletion dropped here is dropped forever, leaving a row that points at a file nobody will ever mention again.
  The rule that entries are deduplicated to the last one about a thing applies here too: only an entry at a different path, or a later one at this path, says the file is still there — and an entry elsewhere counts only if it came after the thing was last listed at this path, since a round read whole carries a history (moved to `A`, back to `C`, deleted at `C`).
  Where the batch has already carried the note or folder to the path the deletion names (edited at `B/c.md`, `B` renamed to `C`, `C/c.md` deleted), only an entry after the deletion does.
- **A move may or may not change the version**, so the path is followed on both routes through the decision.
  Dropbox's `rev` survives a move; OneDrive's `eTag` does not.
  **And followed from where the batch has the note, not where the store last saw it.**
  `A` renamed to `B`, a new `A` made, and `B/x.md` moved back to `A/x.md`, all in one round: the folder's rename carries the note to `B/x.md`, and the file's entry names the very path the row still shows.
  Compared with the row, that reads as nothing having happened, so the pull reports `ok`, the cursor moves, and the note sits under the folder's new name over a file that is not there.
  Its next write then finds nothing at the path, finds the file by id, finds no rename of its own to follow, and blocks the ordered queue.
  The same holds for a file gone by the time it is read: whether the entry "would have moved" the note is asked of the batch too.
- **The version a move hands back is not the note's until its bytes are known.**
  A move changes no bytes, so it is tempting to keep the version it returns — but that is the version of the file as the move *found* it, and the engine has read nothing.
  Another device can have edited the file since this one's pull.
  Held as the note's own, the new version says "in step" about text this device has never seen: the pull skips the file as the version it already has, and the note shows old text until the file next changes; and a write checked against it is checked against the other device's edit, passes, and overwrites it with no conflict anywhere.
  Every provider had this, the ones whose version survives a move included — there the version handed back *is* the other device's edit.
  So after a move (`runMove`, and the move `followTheRename` makes ahead of a write) the engine keeps the returned version only if it is the one the note already held (Dropbox's `rev` and Drive's `headRevisionId` survive a move, so an unchanged file costs no read), or if the file, read by id, hashes to the note's `syncedHash` — and then it keeps the *read's* version, the one those bytes were seen under.
  A row with no `syncedHash` uses its own text if it is clean.
  Otherwise the note goes on holding the version it had, which is always safe: the next pull meets a version it does not know and reads the file.
  `followTheRename` fails the write instead of sending it; the file has been moved, the retry finds it at the note's path under a version the note does not hold, and `resolvePushConflict` reads it.
  If it did change, that is an ordinary conflict, which keeps both.
  If it holds the bytes the note last synced, nobody edited it — the version moved because the file did, and the read that would have said so failed — and the write goes again under the version those bytes were read under, rather than demoting the user's edit to a copy beside a file with no other editor.
  A read that fails in `followTheRename` fails the op as itself, so a rate limit is waited out and not counted; in `runMove` the rename has landed, and it is "cannot say".
  A dirty row with no `syncedHash` at all (databases from before v0.1.0) cannot be told either way, and gets the conflict copy: a copy nobody needed, where the other guess is an edit nobody can get back.
  The cost is one download per rename on OneDrive, whose `eTag` a move renews — no more than the pull would have spent on a version it did not hold.
  Graph's PATCH takes `If-Match`, so a `move` with an expected version would make the check atomic and drop the read; not done.
  The two-browser soak found both halves (seeds 578 and 461), where they turned on timing; `packages/sync/tests/overProviders.test.ts` puts the other device's edit exactly where it has to land, over every remote.
- **A deletion that names the file is believed.**
  The rule above it — that a folder alive elsewhere in the batch means its children are not deleted — exists for a deletion carrying nothing but a path, and must not be applied to one carrying an id: the provider knew the file well enough to identify it, and "some folder above it is also in this batch" is not evidence against that.
  A deletion dropped here is dropped forever, because the cursor moves on and nothing mentions it again.
- **A folder move is addressed by where the folder is now.**
  Renaming `A` and then dragging `A/sub` out of it lands as two entries in one window, and the second decision is reached after the first has already rebased everything under `A`.
  Naming the folder's pre-batch path moves nothing at all and says nothing about having failed, so the notebook keeps a position the remote abandoned until the next cursor reset — and a write into it then fails forever.
  Same rule as for notes, applied to the one decision-maker that was still asking the store alone.
- **A folder move gets the folder in its way out of the way first.**
  Two folders cannot share a path — the store keeps one row per path — so a move onto an occupied one overwrites that row and merges both notebooks' notes into whichever name survives.
  Which of the two the engine does depends on what the rest of the batch says.
  If the batch also reports the occupant deleted (the user deleted `Archive` and renamed `Archive 2024` onto its name), it is deleted first, which is the order the remote did it in and lets the store cascade its subfolders.
  If nothing says it is gone, it is on its way somewhere else — two drags in one window — and it is moved aside under a conflict name, exactly as a note in the same position is, for the entry that says where it went to move it on from there.
  Deleting it on suspicion would take notes nobody asked to lose.
- **Which folder is in the way is a question about the batch too.**
  By the second claim on a path, the folder standing there may be one an earlier decision moved in.
  Reading the occupant off the store answers with the one that used to be there — and if *that* one is the one the batch deletes, the delete takes the newcomer's notes instead.
- **A folder created and deleted inside one window is forgotten.**
  Both halves arrive in the same batch, and the store — asked as it was before any of it — has never heard of the folder.
  Without counting what the batch itself has just made, the notebook sits in the sidebar with nothing behind it.
- **A remote folder delete keeps the dirty notes inside it**, detaching them so the next push re-creates them, and takes the clean ones and every subfolder with it.
  Which of the two a note gets is decided against the batch as well: a conflict earlier in the same batch hands the local edit to a copy and leaves the note clean, so it goes with the folder rather than surviving it.
  The folder is the user's remote layout; the note is their writing, and losing the second to a change in the first is not a trade worth making.
  The store does the cascade in one transaction, because a provider that reports only the folder gives the engine nothing else to send.
- **Decisions are reached against the store as it was, and applied in order**, so a later decision can be about a note an earlier one has already taken away.
  A provider that reports a folder deletion recursively produces exactly that — the folder, and then each file that was inside it.
  The engine tracks what the batch has already removed and says nothing twice; a note that turns up again afterwards (moved out of the folder in the same batch, or a file deleted and re-created at one path) is written back under the id it already had, so the user keeps one note rather than watching one vanish and another appear.
  Belt and braces: `delete-note` and `detach-note` for an id the store does not hold are defined as no-ops, because a batch that rejects is a batch that is retried forever — the cursor moves only with it, so a single unanticipated ordering would leave the user with a sync that never recovers on its own.
- **One note per path, and one `remoteId` per note, once the batch has been applied.**
  A note of ours can be sitting exactly where a remote one is about to land — two devices both writing an `Untitled.md` offline is the ordinary way to get there.
  Left alone, the two share a path: the sidebar shows one row twice, the queued write for ours eventually lands on the other one's file, and both rows end up carrying one remote id — after which `noteByRemoteId` only ever hands back one of them and the other is stale forever.
  So ours moves aside first, under the name a conflict copy would get, because that is what it is.
  That applies whether or not it has been pushed: a pushed note has no claim to the path either, since the remote has something else there, and it keeps its `remoteId` so the entry saying where its file went puts it back.
  Duplicates are therefore possible *during* a batch, which is why the store must not put a unique index on the path, and must not make room by deleting what is there.
- **Whether a path is occupied is a question about the batch, not the store.**
  By the time a change runs, an earlier one may have moved the occupant out, deleted it, conflicted it onto the remote's path, or carried it off with a folder — and one the store says is nowhere near may be about to be carried *in* by a folder move, which re-lists no children, so nothing else in the batch mentions it.
  Asking the store alone either moves a note that has already gone — which fails the batch, and a failed batch is retried forever — or leaves two notes on one path.
  So does asking it what names are free: the same folder move can bring in the exact name a conflict copy was about to take.
  More than one note can be in the way of a single file, and each gets a name of its own.
- **A displacement carries the note's queued ops with it**, exactly as a folder move does.
  A queued `move` is the user's rename and its target is the very path the remote has just taken: left pointing there it conflicts on every push and can never succeed, and since the queue is ordered and a dead op stops the drain, every later op for every other note is stranded behind it.
- **A file can be gone by the time we read it.**
  `changes` and `read` are separate round trips on every provider, so a file the feed named can be deleted in between — the other device editing a note and then deleting it inside one cursor window is enough.
  The entry is skipped rather than thrown on: unwinding the pull leaves the cursor where it was, so the next attempt fetches the same batch and dies the same way, and push never runs either because `sync` stops on a pull that is not `ok`.
  Nothing is imported and nothing of ours is moved aside; the deletion arrives as an entry of its own.
  Except for a note held by that very file which the entry would have moved: the deletion, in this batch or a later one, is at the new path, where the note never got to, and one with no id has nothing else to find it by — so the note whose file is gone is let go of there and then.
  At its own path the deletion finds the note, and nothing is decided on the read alone.
  Only "it is not there" is survivable — a refused or broken read is a batch nobody has decided, and moving the cursor past it would skip the changes for good.
- **A file that is not UTF-8 is left alone.**
  Latin-1, UTF-16, a binary named `.md`: decoded anyway it arrives as a note with U+FFFD for every byte that would not read, and the next push, even the app adding an `id`, replaces the user's bytes with that.
  So `read` refuses it (§4), nothing is imported, and **no row holds the id of a file the engine could not read**, so no write or rename from here can land on it once a pull has seen it.
  A clean note whose file became unreadable goes from this device and nothing is queued against the remote — a note the user had deleted included, whose delete is dropped *when the pull sees the file first*: it was of text they had seen, not of these bytes.
  A delete pushed before any pull has seen the re-save still removes the file — `runDelete` asks nothing of it, and a download before every delete is not worth what it would close — which is the window an edit made on another device has always had.
  The dropped delete stays queued until the next push finds no note for it, and a delete names its note by id alone; so a file arriving meanwhile that carries that id — another device's edit to the same note, set aside — is given a fresh one rather than the id a delete is queued for, or the delete would be re-aimed at it.
  A dirty one is cut loose and moved to a conflict name, and its write creates a new file beside the one it could not read; one the user has renamed meanwhile is cut loose and left where they put it, since nothing is in its way there.
  A note never pushed that has the same name moves aside, as for any arriving file.
  A push that meets such a file — in the way of a note with no file of its own, or as the note's own — does the same and finishes in that drain, with no attempt spent and the op counted as pushed, since it reached the remote as a new file.
  Where the conflict name is taken on the remote by a file this device has not pulled (another device setting its own edit aside in the same minute), the create says so and the next name is tried, bounded as a rename's is; the store is moved first and the remote second at each step, so a process that dies between them leaves an unbound dirty note whose write is still queued, never a file no row knows of.
  A note with a readable file of its own elsewhere steps aside still bound to it, as it does for any file that is not its own.
  A probe that only asks whether a file exists takes unreadable as yes, so a rename of such a file is carried out (it changes no bytes) and the pull that next reads it lets go of the note.
  None of it throws, since a pull that throws never moves its cursor and these bytes read the same way every time.
  With no row, every entry for such a file is read again, so the file is picked up as a note on the first pull after it is saved as UTF-8.
  **The rule never turns on the app's own notes, because the app never writes a U+0000**, and that rests on there being two things a push can send and no way for either to hold one.
  A file the app serializes is stripped where it is made (`noteFileContents`), whatever part of the note the NUL was in.
  A `source` kept verbatim came through one of two doors: a pull, where a file holding a NUL is refused before it is a row, or `importNoteFile`, which drops it on the way in.
  In front of both, neither of skysa-notes' editors ever holds one (its `editor/shared/noNul.ts`): it is dropped in the transaction that brought it, so that what the editor reports is what the store keeps.
  Stripped only in the store, the save comes back as a body the editor never wrote, is taken for a change from outside, and what was typed meanwhile is saved as a conflict copy of the user's own note.
  `saveNoteBody` and `createNote` strip as well, as the backstop.
  **And it is said.**
  Each such file is kept per connection with the cursor — `syncState.unreadable`, its `remoteId` and the path it was last read at — and the storage panel lists them by path under the sync status, with what to do about it: save it as UTF-8, or delete it.
  Without that a clean note goes from the device with nothing said.
  A record is a `PullChange` (`unreadable`, `forget-unreadable`), so it commits with its batch and cursor or not at all, and only a change to the list is one: a file listed already at the same path is read again and nothing is emitted, so `pulled` counts a file when it is first listed, when it is renamed and when it is let go of, and not every time the feed names it.
  A note moved aside because such a file has its name rides on the record (`movedAside`) and is said in that notice — "a note of yours had that name; it is now at …" — and not as a conflict, which it is not: nothing was edited twice and no copy was made, and the conflicts line is gone by the time the user wonders about the new name.
  Every note the file has moved aside is kept, not the last of them, and the list keeps saying so when the file is later renamed, since nothing else ever explains the name.
  A file stops being listed when it reads — by its id, or by its path, which covers a tool that saves by writing a new file over the old name — or when a note this device already holds is renamed onto its path; when the same id turns up as something that is not a note, or is hidden; when its own entry finds it gone; when a deletion names its id, or, naming only a path (Dropbox), names its path; and when a rescan does not return its id — except a rescan that may be missing things (`uploadDifferences`), which proves nothing gone.
  Nothing clears the list when a rescan *starts*: an interrupted one would leave the notice blank.
  A rename is the same id recorded at the new path.
  A folder's move carries the paths under it along and a folder's deletion drops them, in the store, because a feed that reports a folder alone says nothing of what was in it; a deletion of a folder this device holds no row for drops them in the engine, whether or not it also carries an id, so long as it names a path.
  A path-only folder deletion is **not** taken at its word for what is under it until the engine has ruled out the other half of a move, or a rename told as `old path deleted, folder listed` would forget files nothing in the round lists again; where it is a move, a deletion naming a file at its old path is read against where the folder went, so the file is forgotten only when nothing in the round says it moved too.
  A deletion naming a folder by **id alone** (Graph, for a folder it can no longer place) says nothing at all about what was inside it, so where this device holds no row for that folder its files stay listed until a re-scan does not return them — a notice left standing for a path that is gone, which is the cost of not guessing at a deletion's reach.
  With a row, the `delete-folder` takes them as it takes the notes.
  A push that meets such a file lists it too where the conflict names the file and its path; where the file is known only by the note's id (`runWrite`, `followTheRename`, a note's own file behind another's name) it is left to the next pull, which reads it and lists it where it is.
  **The list is a notice and nothing else.**
  No decision reads it: with no row, every entry for such a file is read again, so a list that is stale, or lost, costs the user a line of text and never a file.
  A file already imported lossily before this rule is not looked for.
- **A batch sees the notes it has itself created.**
  A file created, deleted and re-created at one path inside one cursor window arrives as three entries, and each of the last two has to know what the ones before it did: the deletion is about a note only this batch has made, and the second file lands on a path only this batch has filled.
  The store can say nothing about either — none of it has been applied — so the decisions already taken are read back as rows.
- **A path can be reused.**
  A note is identified by `remoteId`; the path is a fallback, and it is what lets a note created here be recognized when its own first push comes back.
  The one note the fallback must not claim is one whose own remote copy is alive elsewhere in the batch: that note has been moved and the path merely reused, and claiming it would hand two notes each other's contents.
  Nor, found by a model of two devices syncing at random over every provider (`packages/sync/tests/overProviders.test.ts`), four more, each of which hands one device's file to a note that is not its note:
  - *a note the user has renamed onto the path*, not pushed yet — its file is still at the old name, and claimed it forgets that file, which the feed has no reason ever to mention again;
  - *a note whose own file is still there* — unmentioned because unchanged, so this is a different file that took the name.
    The batch usually says when the note's file went (and a full scan, which never says what was removed, is taken on trust); when it says nothing, since a provider need not report the deletion of a file replaced at its path, the provider is asked by id;
  - *a note the user has deleted here*, wherever it stands — written back under its id, the new file is still a deleted note, and the queued delete takes it from the remote.
    Until 2026-10-14 this held only once the batch had removed the note, which a feed does first by reporting the old file gone.
    A full scan never says what was removed, so the note was still at the path and was claimed as a file replaced while the cursor was dead: the other device's note went from the remote.
    Found by the same model over Drive once a long feed became a scan (§5.1, seed 36).
    It was reachable before by a rescan or any cursor reset, only rarely;
  - *a note never pushed, deleted here or clean, whose bytes and frontmatter `id` are not the file's* — the store reports a deleted note clean, and claimed, its queued delete has a file to aim at.
    It moves aside instead.

  A deletion is matched the other way about — by id when it has one, and by path only when it has not, since a deletion whose id we have never seen is about a file that is not ours.
  By path, it is not about a note the user has renamed *onto* the path (often this is this device's own delete of the note that had the name, coming back) but about one renamed *from* it, whose file was there when the rename was queued — ahead of a note at the path that has never had a file, but behind one that has.
  Another device may have moved that file on since, and the queue still names the old path, so the note found this way is let go of only if the provider says its file is gone.
- **A note moved aside does not take the old name of a rename queued here.**
  The file is still there until the rename runs, and the rename may be queued behind the moved note's own write, which then conflicts with it on every push.
- **An id in a file is adopted only if nothing else holds it.**
  The `id` in frontmatter is what makes two devices agree which note a file is, so it is adopted by default.
  But duplicating a file is an ordinary thing to do in a folder the user can see, and the copy carries the original's id: adopting it blindly writes the copy over the note it came from, unpushed edits included, and leaves the two files fighting over one row on every sync afterwards.
  The second file to arrive is a new note.
- **An id names a note within its connection.**
  The id in a file is whatever the remote says.
  A folder copied from one account into another, or an account connected a second time after its notes were copied elsewhere, brings files that name notes a different connection holds.
  While `notes` was keyed by `id` alone that was one key space for every connected source: adopted, the store had to refuse the write (taking the row would take the other account's unpushed edits), identically on every retry, so the cursor never moved; and the workaround — asking the port whether the id was held elsewhere and naming the file's note afresh — had two connections each writing their own id into a shared file, turn about.
  So the key is `[connectionId + id]` (schema versions 4 and 5), as `folders` was always keyed, and the question is not asked: another connection's note of the same id is another row, neither shown to a store nor in its way.
  IndexedDB cannot change a store's key, so the rows go out to a second store in one version and back in the next, inside the single `versionchange` transaction an open gets; a failure leaves version 3 untouched, and a tab still running the old build is stopped by the stale-tab gate rather than reopening against it.
  Every lookup by id says which source: the store functions take a connection and default to the one showing, the editor names the note's own, and the push queue's per-note lookups filter by connection.
  State the UI holds across renders — autosave's held edits, the deleted-note notice, "this note needs raw mode" — is keyed the same way (`noteRef`).
  An edit or an undo that arrives after its note's source was let go finds the row where it was if the remote had not been sent it (a detach keeps those in place), follows it if a reconnect has since taken it home under a new connection id (skysa-notes' `store/movedRows.ts` remembers this tab's moves, new id included; a move made from another tab is followed by id), is kept as an unsent note under the source made again if the row was removed with its source (the remote has the *note*, not the edit — `detachConnection` marks nothing in `store/deletedHere.ts`, whose marks are only the user's own deletes, and only under the binding they were made under: `SyncStateRecord.boundAt`), and is **never** looked for under the source showing, nor by id under any other connection than its own — only a note of the device's own pile is, since the pile's rows move once, into the first source bound, and a bind from another tab is not in `movedRows`, which with two sources connected is another account: found there, the text would be uploaded into storage it has nothing to do with.
  A note that has to be made again goes to its own source, brought back detached if it has gone (`ensureDetached`), and never to the device's own pile.
  Rows change connection only in a bind, which is a delete and an add; two notes of one id can meet there (a detached source's rows going home to a connection that has already pulled the same file), and the one arriving is given a fresh id, its queued ops with it, and is otherwise the row it was.
- **One entry per file, keeping the last.**
  Dropbox documents that a path may appear more than once in a batch and that the last entry is the current state.
  Decided twice against the same pre-batch store, one edited note produces two conflict copies wanting the same path — which the store cannot tell apart, and the push then writes one over the other and gives them one remote id.
  Deletions and live entries are keyed apart, both by id, because a file deleted and another created at that path in one batch is two things happening, not one thing said twice.
  Only files: a feed that tells a round in order (`B` renamed to `A`, a file moved into `A`, `A` renamed to `C`) needs the first rename for the file to land anywhere real, and a folder decided twice is a move from wherever the first decision put it.
  A deletion with only a path is kept each time too — `C` deleted, `A` renamed onto `C`, `C` deleted again is two folders — and the second one is about whatever the batch has put at the path since, not the folder the first took.
- **A rename need not re-list what is inside it.**
  The children's bytes did not change, so a provider may report a renamed folder as the folder at its new path plus the old child paths as deleted, with nothing at all about where the children went.
  An id-less deletion of a folder the batch has alive elsewhere is that rename (unless the batch has since put a different folder at the path, which the deletion is then about).
  One *under* such a folder is ambiguous: a file deleted before its folder was renamed reads exactly the same.
  Dropped, the note is carried along and held over a file nobody has; taken, a file the provider never listed again is lost here.
  So the provider is asked — a note's file by its id, a folder by listing where the rename puts it — and only "not found" lets go.
  The provider answers for now, not for where the round ended, so neither a missing parent nor a listing without the folder is taken as proof: the folder goes only when none of the notes under it is found by its id, and those not found are let go of.
- **A round is one batch.**
  From a stored cursor every page is read before anything is decided, and the round is decided once and applied with its cursor.
  Graph asks for exactly that, and page boundaries fall anywhere: between a folder's deletion and the move of a subfolder out of it, whose cascade would take the subfolder's clean notes; between a folder's two renames.
  The decisions already reason about a batch as a whole, so a round over many pages gets the answers one page would.
  The cost: a failure on any page redoes the round from the stored cursor (as a failure before the first page always did), and one round's decisions, note contents included, are held in memory until it is applied — rounds are normally a few changes, and an import of thousands on another device is one round too.
  Deciding stays near the round's size squared rather than cubed: what the store said is kept with the decision that asked, and a note's place is replayed from its own changes and the folders' rather than from every decision.
  Two thousand new notes in one round decide in about a second in the tests, and a test holds the store reads to a few per note.
  A path already in normal form is not split again to be compared, which was most of the cost of a renamed notebook re-listed note by note.
  A scan keeps applying page by page with no cursor until its last, since it reports no deletions until `reconcile` and a first sync of many notes shows as it arrives.
- **A folder's deletion waits for what the round moves out of it.**
  `C` deleted, and later in the round `C/A` moved to `B` (or up to `C` itself): the subfolder's last entry is decided first, then `C` goes from wherever that left it.
  Outermost first, and each entry is decided again in its own turn, which replays the round's history from where the rescue put the folder.
  Folders only — a note moved out has an entry of its own that finds the note by id, and a note with unpushed edits decided twice would be copied aside twice.
  A folder moving up to take its parent's name is moved out of a parent displaced aside, never deleted with it.
  The same holds when the deletion is reached early, clearing the way for a folder made at or moved onto the doomed folder's path.
  A subfolder whose own entry is the decision that reached the deletion — two folders deleted, each one's subfolder moved to the other's name — cannot be decided again, and is moved out beside the folder for that decision to move on.
- **A folder arriving where another is leaving.**
  A new folder at a path whose folder the round goes on to move or delete gets that folder out of the way first, as a folder move does; merged into one row, the move that follows would carry the newcomer off with the other's notes.
  Where the one in the way is the folder the arrival is moving out of (`Z/X` moved up to `B` while `B` is renamed to `Z`), the arrival is asked where it is again after the displacement.
  A folder that is not mentioned again stays merged, as before.
- **Two notes meeting at a path neither ends up at.**
  A folder rename can land a note on a path another note has just arrived at, when the round goes on to rename the landing note elsewhere.
  Displacing either leaves a conflict copy of a note that never conflicted, so the landing note is left to its later entry.
- **A conflict copy is named against the folder the note ends up in**, not the one it came from, and avoids every name the batch is bringing in, every name already in the store, and every name the batch has already chosen — one entry can need both a displacement and a conflict copy, and both are named from the same path.
  Two devices syncing on the same interval conflict inside the same minute, so the copy one of them made arrives in the very batch that decides to make the other; landing on the same name overwrites the edit the copy exists to save.
  Naming it against the old folder is the same bug in a different direction — the old folder may be one this batch is deleting.
- **A full scan reconciles, folders included — and only once it is all in.**
  A scan says what exists, never what was removed, so after a `CursorResetError` every note deleted while the cursor was dead would come back, and a notebook deleted then would sit in the sidebar forever with nothing behind it.
  Notes and folders carrying a `remoteId` the scan did not mention are treated as remotely deleted; anything never pushed is left alone.
  Two things make this the most destructive rule in the file.
  It runs on the last page only, because no page before it has seen everything and reconciling against one would delete nearly the whole store — and the pages after would put a note back at each path, so the app would look right and every note would be a different note.
  And it exempts whatever the same batch has just re-established: a file replaced at one path while the cursor was dead leaves the row carrying the *old* `remoteId`, which a scan that only saw the new one never mentions.
- **A scan sweeps up only what the batch has not already settled.**
  Reconciling names the notes a scan never mentioned, and a `delete-folder` in the same batch names none of the notes it cascades over — so without asking where each note stands once the batch has run, the sweep deletes them a second time.
- **The app folder is never a folder row, and never a folder change.**
  Several providers report the root as an entry of its own — Graph's `delta` returns the root item.
  There is nothing above it to hold a row, and a row for it would be reconciled away after the next cursor reset as a folder the scan did not mention.
  Since every path is within the root, that one `delete-folder` is every note on the device.
  Guarded where the row would be made and again where it would be deleted.
- **A deletion of the app folder itself is ignored.**
  An adapter that reported the root by mistake would otherwise wipe every note on the device in one batch, and if the folder really is gone it is the connection that needs attention, not the notes.
- **A note that changed while it was being pushed stays dirty.**
  The outcome handed to the store carries the exact bytes that were sent, and the store clears the flag only if the note still holds them.
  Otherwise the last thing the user typed is marked as saved and never sent.
- **A failed push stops the queue rather than stepping over it.**
  The queue is ordered because later ops depend on earlier ones — a write into a folder whose `mkdir` failed would land nowhere, or resurrect a folder on a provider that creates missing parents.
  An op that has failed five times is surfaced rather than retried.
  Writes sent together are met in queue order once all of them have answered: those that landed are done, and the first that did not is handled as if it had gone alone, with the others that did not behind it — so a rate limit or a failure stops the drain where it would have, and what landed beside it is a write, which nothing behind it waits on.
  A rate limit among them is the one handled, wherever it came: handled behind a conflict, which lets the drain go on, it sent the rest straight back through the wait the provider asked for.
- **A queued row that fits no kind is read as `malformed`, kept, and failed (2026-10-26, skysa-notes#447).**
  `SyncOp` is a union by `op`, each kind with the fields it cannot be sent without (`noteId` for a note's ops, `targetPath` for a move, `fileId` for a file's, `remoteId` for a `delete-file`), and the web store reads each row through a schema of those (`toSyncOp`); the rows themselves are as they were, and every release since 1.0 has queued each kind with its fields.
  A row that fits none — a move that lost its target, a kind a later version queued — used to reach the engine as whatever it said it was: a move with no target threw, and a kind this version does not know ran as a note's write.
  It is read now as `malformed`, never thrown on, so the rest of the queue still reads, and never dropped: the engine fails it like any op that cannot be sent, and at five failures it stops the push and says why, as the ordered-queue rule has any op do.
- **Same bytes, new version is not a conflict on the push side either.**
  An interrupted push looks exactly like one: the write reached the remote and the store could not be told before the tab closed, so the op is still queued carrying a version the remote has moved past.
  Conflicting would hand the user a copy of the note they already have.
- **The op that hit a conflict is finished, not re-queued.**
  Its content is preserved in the copy; replaying it would overwrite the remote with the very bytes the user has just been handed a copy of.
  Only a `write` is answered this way: a `move` that finds its target occupied and a `mkdir` that finds a file in the way carry no two versions of anything, and resolving them would point the note at somebody else's file.
  They fail, and stop the queue like any other failure.
- **A push that finds nothing at the path asks whether the file merely moved.**
  `write` is addressed by path, so a file renamed remotely reports exactly what a deleted one reports, and §7's answer to a deleted file — re-create it — would leave the user with two notes where they had one.
  The engine reads by `remoteId` first; if the file is gone it re-creates, and if it is still there it asks *who* renamed it.
  A remote rename is left for the next pull to rebase.
  A local one — the user edited and then renamed, so the queue is a write and then a move — can never resolve itself: no pull will move a note over a rename the remote has not heard of, and the ordered queue cannot reach the `move` while the `write` in front of it is failing.
  The queue is what tells the two apart, so it is asked, and the rename is performed there and then.
- **A move whose file is gone is finished, not retried.**
  Nothing will make it succeed, and failing it blocks the ordered queue forever over a rename — the least of what the user has waiting behind it.
  The note keeps its contents, and the pull that reports the deletion cuts it loose or takes it away.
- **A transient failure is a status, not a rejection.**
  Offline, a 500, a store that could not commit: the batch rolled back and the cursor did not move, so `pull` answers `retry` exactly as `push` does.
  That covers every store call, not just the batch — reading the cursor and reading the queue are store calls too.
  Rejecting instead would make every caller wrap `sync()` in a `try` to discover something `status` exists to tell them, and one that forgot would take the app down on a flight.
- **A locally deleted note keeps its row until the remote copy is gone, and every read sees it.**
  The queued `delete` carries a note id and nothing else; the `remoteId` it needs lives on the row, so the row *is* the tombstone.
  A store with a `deleted` flag and filtered indexes is a natural reading of "every live note", and it loses a note the first time one is deleted here and edited on another device: the pull cannot see the row, mints a second note at that path, and the queued delete then removes the file that was just imported.
  Where both happen in one window the delete wins — the row is written back by the pull and purged by the op behind it.
  That is a decision, not an accident: the delete is something the user did, and the remote change may be their own from the other device.
- **A push is addressed by where the note is now.**
  A pull between queueing an op and running it rebases the note and leaves the op's own `path` behind.
  Invisible where `remoteId` identifies the file, and the whole address where it does not (WebDAV, deferred).
- **A move with no target fails rather than being marked done.**
  It is a store that lost the column, not a move with nothing to do, and completing it would discard the user's rename with nothing said anywhere.
- **Nothing is reported that did not happen to the user.**
  A deletion that matches no note, file or folder we hold — a file at a hidden path, a file never imported — is not news, and counting it puts a number in front of someone for an event that was never about them.
- **A folder move clears the notes in its way, not just the folder.**
  A cascade keeps a dirty note and merely cuts it loose, so a deleted folder can leave notes behind at their paths with no folder row above them.
  Moving another folder onto that path then drops its notes on top of theirs: two rows at one path, which the sidebar shows twice and which the next push has overwrite each other forever.
  The local note is displaced to a conflict copy — the remote keeps the path — at whatever depth under the destination it sits.
- **A folder deletion says which folder, not which path.**
  Two drags in one cursor window name one path and mean two folders: delete `A`, rename `B` onto `A`, delete `A`.
  Matched by `remoteId` where the provider gives one and by the row that was at the path where it does not, and answered with the position that folder ends up at once the decisions in front of it have been applied.
  A deletion dropped here is dropped forever, because the cursor moves on and nothing says it again.
- **Two files deleted at one path are two deletions.**
  Keyed by `remoteId` rather than path, so a file replaced and then removed inside one window does not fold into a single event that lets go of only the second.
- **An entry is not matched by path to a note the batch has already moved.**
  A folder rename carries every note under it and the feed says one word about the whole subtree, so the store still shows the note at its old path.
  A different file arriving there would otherwise be written into it, while its own file goes on existing under the new name.
  A note the batch merely *removed* is still matched: it has nothing of its own left and becomes the arriving file, which is what keeps one note rather than two when a path is reused.
- **A `move` that reports not found asks which end was missing.**
  A provider answers the same way for a file that is gone and for a destination folder that was never created, and a note dragged into a notebook made on this device hits the second every time — nothing queues a `mkdir` for a folder that has only ever been moved into.
  The folder chain is created and the move retried; only a genuinely missing source finishes the op.
- **A conflict discards the losing edit's queued write.**
  That op carries the content the copy now holds, and the note itself holds the remote's bytes.
  Replaying it puts the remote's own content back under a new version, which every other device pulls as a change that changed nothing — and which can lose a race against a real edit made in between.
  The user's rename is left queued: the conflict rule is about content.
- **A rescan names the outermost vanished folder only.**
  `delete-folder` cascades, so naming a nested one as well is a second delete of a row the first has already taken.
- **A rescan names a vanished folder by where its row ends up.**
  A scan is one batch like any other, and a `move-folder` decided in front of it has already rebased the row; naming the pre-batch path deletes nothing and leaves the notebook the remote no longer has in the sidebar under its new name.
- **A note the rescan only moved aside is still a note the rescan did not find.**
  Moving ours out of the way for a file arriving at its name says nothing about the file our row holds — a scan can do that without ever mentioning it.
  Exempted from the reconcile on the strength of the displacement, a clean note whose file is gone keeps its row and a dead `remoteId` until the next scan, and what the user is left with meanwhile is a conflict copy of a note that never conflicted — a scan being the only thing that can put it right, and one that need not come for weeks.
  So the exemption covers what the batch wrote back or took away, and a note it merely displaced is asked after like any other: its own file among what the scan returned is what keeps it, and nothing else.
  A dirty one is cut loose and keeps its edit, as everywhere else.
  **Not on a rescan that uploads**, and not because absence proves less there — that rescan acts on absence all the time, by sending the note back up.
  It is sending a *displaced* note back up that is wrong: `reupload-note` strips the row and queues a create-only write at the note's path, which by then is the fresh conflict name the displacement gave it, so the create cannot fail the way it would at the note's own path, where a file that was there all along conflicts and puts itself right.
  It simply lands, and the user has two files where they had one.
- **Every batch-aware question about notes includes the ones the batch has moved by name.**
  A folder is not the only thing that carries a note somewhere: a `move-note` brings one in from anywhere at all, and its row is still at the old path in the store.
  Missing it means nothing is displaced when a second file lands on the same name — two rows at one path, which the sidebar shows twice and the next push has overwrite each other.
- **A write that finds nothing makes the folder before re-creating the file.**
  A provider answers not found for a missing file and a missing parent alike, and the second is the ordinary case of a notebook deleted on another device while a note inside it had unsaved work: the pull keeps that note and cuts it loose, leaving nothing on the remote above it.
  Without this the write fails identically on every attempt and the ordered queue strands every op behind it, for every note.
- **A cascade leaves the notes it keeps a notebook to be in.**
  `delete-folder` takes the folder rows on the way down but not the dirty notes, so the rows a surviving note needs are re-established — at the end of the batch, because whether a note is still there is not known until the batch is over.
- **A rename the user has queued is not undone by our own echo of it.**
  The feed cannot say whose rename an entry describes; the queue can.
  Moving the row back undoes what the user just did in front of them and frees the path they renamed *to*, so a file arriving there in the same batch is imported rather than displaced and the queued move then conflicts on that path forever.
  The version is still adopted; only the path is left alone.
  `followTheRename` asks the same question from the push side, and only about a queued move whose target is where the note now is.
- **A push conflict over a file another note already holds is not that note's conflict.**
  The path is simply taken, by a file whose own row is elsewhere because its rename has not been pulled yet.
  Adopting it would give two rows one `remoteId` — `noteByRemoteId` hands back one of them and the other is stale forever.
  The note moves aside instead and its write is retried where it now is — unless it has no file of its own left to stay bound to, in which case its edit goes up as a new file at the new name in this drain, as it does for a file that cannot be read.
  **Either way the name is asked of the remote, not of the store alone**, which has never heard of the file another device set *its* edit aside to in the same minute.
  Where the note's edit is being written, the write is the asking and a refusal moves on to the next name.
  Where the note stays bound to a file of its own there is nothing to write — the path belongs to somebody else's file and ours may be perfectly good — so each candidate is read for instead, at a request apiece on a name that is almost always free at the first ask.
  Without it the retry meets that file, steps the note aside again from a name that already carries a suffix (nothing strips one back off), and leaves `x (conflict …) (conflict …).md` behind having spent a second of the op's five attempts with the ordered queue stopped.
  A read by path is no more proof than a listing is on a provider that hides what the app did not make (§5.1); what it settles is the case it is for, since the file in question is one another device of this app wrote.
- **A queued rename onto a path the remote will not give up lands beside it.**
  A `move` is not a `write`, so the conflict rule has no second version to reconcile, and nothing will ever free that name: left queued it fails on every attempt and strands every op behind it over a rename.
  The remote keeps the path and the rename takes a conflict name, where the user can see what became of it.
- **A directory the user's notebook left is removed by an op of its own, and only when five things agree.**
  The notes' moves and deletes go up first; the `rmdir` behind them carries the folder's `remoteId` as the queue recorded it.
  It finishes without deleting anything unless all five hold: the provider's listings are the whole truth about a folder (`listsEverything` — see the bullet below; where they are not, the other four stand before the folder is *left* instead); it has that id at all — without one the folder it is about cannot be told from whatever holds the name now; the store has no folder row at the path and no live note at or under it — the user made the notebook again, or a pull brought it back, and it is a folder to keep; the parent's listing has a *folder* at that path whose id is the one recorded — a folder renamed or replaced elsewhere is not ours to remove, and only the id says which it is, since the name alone is the same either way; and a walk of the folder finds no file anywhere beneath it, hidden files and files this device has never pulled included.
  The walk goes one subfolder at a time and stops at the first file: it is the only walk in the engine whose depth the user chooses, and in parallel a deep notebook would put an unbounded number of listings at the provider at once.
  Not found at any step is finished rather than retried: the folder is already gone.
  - The row check is exact where the note check is "at or under" because every path that makes a folder row makes its ancestors too (`ensureFolderChain`, and the memory store's `putFolder`), so a row under the path cannot exist without one at it.
  - **Known gap:** a file written into the folder between the walk and the delete goes with it.
    That lands in the provider's trash or recycle bin on all three, and on Dropbox in deleted files, so it is recoverable — but this device will not report it.
  - **Known gap:** a notebook deleted while its own `mkdir` is at the network leaves the directory behind.
    The answer arrives to a store with no row at that path, so the id has nowhere to go and no `rmdir` can name it.
    It shows up as an empty notebook after a re-scan.
- **A folder is removed only where a listing can prove it empty.**
  Deleting a folder takes everything under it, seen or not, so the `rmdir` above never deletes on a provider whose `list` is not authoritative: `StorageProvider.listsEverything` is false on Google Drive, where `drive.file` shows the app only the files it made and a PDF the user dropped into the notebook through drive.google.com is invisible (§5.1).
  There the directory stays.
  Until 2026-10-13 so did the notebook — on every other device at once, and on this one after a re-scan — as the cost of not trashing a file the app cannot see.
  Now the op *leaves* the directory instead (`leaveFolder`), past the same gates: it is marked, nothing in it is touched, and the adapter does not report it while it holds nothing the app can see (§5.1, "A folder the app has left").
  True on Dropbox and OneDrive, which give the app its own folder and everything in it, and delete.
- **A dead `rmdir` is given up on rather than surfaced.**
  Every other op that runs out of attempts stops the queue and asks for help (the ordered-queue rule below), because what is behind it depends on it.
  Nothing depends on an `rmdir`: it tidies an empty directory away, and an empty notebook nobody asked for costs the user nothing next to every note they write from then on waiting behind it.
  So at the limit it is completed, and the directory stays.
- **A folder this device is removing is not made again by our own echo.**
  A sync pulls before it pushes, so the round after a notebook's deletion routinely carries the `mkdir` this device's own push landed, reported as a folder that exists — which re-creates the row, and the `rmdir` behind it then finds the store holding the notebook and finishes without removing anything.
  A folder change is dropped when a queued `rmdir` holds its `remoteId` *and* names the path the entry is at.
  Scoped to the path, because the same folder renamed by another device meanwhile is a notebook to keep at its new name, and a folder that device made fresh at the name we are removing is not the one the queue is about.
- **A folder deletion with no id is not about a notebook the remote has never heard of.**
  Dropbox reports a deletion as a path and nothing else, this device's own included — so the round after an `rmdir` lands carries the deletion of a name the user may well have made a notebook at since, which is the ordinary sequence of deleting a notebook and making another with the same name.
  Matched by the path alone it deletes the row the user has just made and cascades over what they have put in it, while the `mkdir` queued behind it makes the directory again, and the two fight every round.
  A row with no `remoteId` is one no `mkdir` of ours has landed on, so no deletion of ours can be about it — strictly, a row `ensureFolderChain` made for a directory the remote does have is id-less too, and is now beyond the reach of a path-only deletion until a pull reports the directory and gives the row its id; the alternative, deleting by name, is the notebook-the-user-just-made case above — and nothing else at that path can be either: whatever the batch has put there arrived after the deletion was recorded.
- **A notebook the remote no longer has does not take the notes whose files were never in it.**
  A note is in a notebook here as soon as the user moves it there; its file moves when the queued `move` runs, which may be days later if the device is offline.
  Another device removing that directory meanwhile is reporting something true — the directory is gone — but it says nothing about a file that was never inside it.
  Cascaded over, the note's row goes with the notebook while its file stays on the remote with nothing here naming it, and since the cursor has moved past that file nothing mentions it again: the note is gone from this device until a re-scan.
  So a `delete-folder` carries the notes the cascade must leave alone (`keep`), read from the queue — the same place that says which renames are the user's — and a rename left in the queue makes the directory again at the far end when it runs, as every push does.
  A note whose file *is* inside the directory is taken as before.
  Found by the two-device soak, at seeds 378, 427 and 591 of 600.
- **A notebook gone before its `mkdir` was sent withdraws it.**
  Queued and sent, that `mkdir` makes a directory on the remote that this device can never ask to have removed: the row it would read the id onto is gone, so no `rmdir` can name it, and the next pull that reports the directory makes the notebook again, empty — the very thing the `rmdir` exists to prevent.
  So a delete or a rename withdraws every queued `mkdir` at or under the path it is leaving, and a notebook renamed twice before a sync sends one `mkdir`, for the name it ended at.
  The notes' own ops stay: a note in there may have been moved out rather than deleted, and a write that finds no parent makes it.

- **A rate limit is not an attempt.**
  An op stops being tried after five failures, and a provider refusing every request while a quota resets would spend all five in half a minute on an op there is nothing wrong with — the user's note, blocked, with every op behind it waiting.
  A `RateLimitError` says nothing about the request, so the engine reports it as a retry without counting it, on the pull side as well as the push side.
  Everything else is counted, including a 5xx: it may be the request.
  The same goes for a rate limit met while *resolving* a push conflict — reading the remote entry the conflict rule needs is a request like any other — so the resolution's own error, not the conflict that led to it, decides which branch the failure takes.
- **Known gap: a rate limit that never ends is never *named*.**
  Nothing counts an uncounted retry, so a provider that answers 429 forever leaves the op retrying forever — every five minutes at the least, since the wait is the longer of the backoff (capped at five) and the provider's own answer (capped at fifteen) — and the status says `retrying` with the provider's message rather than naming the op that is stuck behind it.
  Retrying forever is the *right* answer while the limit is real: the op is fine and the provider will serve us again.
  What is wrong is only that it is never named, which matters most for the cases that do last — Drive's daily quota, or a full Drive answering `RESOURCE_EXHAUSTED` with no reason we can read.
  An attempts-ceiling (after N rate limits in a row, count the next one) is **not** the answer and is deliberately not built: it would block a note over a quota that was about to reset, which is the worse failure.
  The answer that fits is the one `blocked` already uses — a "throttled since" clock beside `blockedSince` that, after some minutes of consecutive rate limits, publishes `attention` with the op named, without ever touching `attempts`.
  That closes the visible half and leaves "a rate limit is not an attempt" intact.
  It is not built yet because nothing in the phase needs it and the threshold wants a real quota to calibrate against; it goes on the live-check list.
- **The provider's own answer for how long to wait wins, but never shortens the wait.**
  A `Retry-After` is the only informed answer to when the remote will serve us again, so the scheduler waits for it — but takes the longer of it and its own backoff, since a one-second `Retry-After` on the fifth failure in a row is not an invitation to come straight back.
  Capped at fifteen minutes: Drive's daily quota says a day, and a device asleep past any horizon the user can make sense of looks broken.
  Coming back sooner costs one request refused the same way, and the wait starts again from what it says then.
  The cap is also the ceiling on what a *misread* header can ask for, which is the half of its job that is easy to lose: `parseRetryAfter` (`@skysa/storage`) takes the longer of two values `Headers.get` has joined, and `Date.parse` will make a date out of most things, so a malformed `Retry-After` can cost fifteen minutes and never more.
  Anyone weighing raising the cap, or dropping it, is weighing both.
- **A tombstone owes the remote its delete and nothing else.**
  `queueWrite` refuses to queue one for a deleted note, and `queueDelete` withdraws the writes already queued for it.
  Both halves matter, and the second was missing: a note made and deleted before either op was sent still had its write run, so the file was created and then removed.
  That is only waste while the path is this device's own — but a path is not.
  Another device that made a note of the same name meanwhile finds a file there when its own write runs, binds its note to that file rather than making one, and loses it when the delete behind it lands.
  Nobody deleted that note, and it is gone from every device.
  A queued **move** is not withdrawn: the file is still at the name it had, and while every provider the app syncs to deletes by id, the queue is not the thing that should be deciding that.
  A write already at the network loses its queue row only, which is what `completeOp`, `failOp` and now `resolveConflict` all tolerate: the file it creates is still recorded on the row, so the delete has the `remoteId` it needs.
- **A stuck op is named, with the path the user gave it.**
  "Some changes could not be sent" leaves the user with nothing to act on, and the queue is ordered, so the first op out of attempts is also why everything behind it is waiting.
  The status carries that op — what it was doing, the path (a rename's destination, which is the name the user is looking for), how many attempts, and what the provider said — and the panel offers to open the note it is about, where the note is still there.
  There is no "discard": dropping a queued write leaves a dirty note that never syncs.
- **A rescan that uploads.**
  A scan says what exists and never what was removed, so reconciling treats a note it did not return as deleted.
  That is right when the provider's copy is the authority — but a provider can say it is not.
  Graph's `resyncChangesUploadDifferences` means "Upload any local items that the service didn't return", which is what a server-side restore answers, and there the scan looks exactly like a user who deleted everything: trusted, it deletes every clean note on every device that syncs after it, quietly, and the words are gone.
  So a `CursorResetError` carrying `uploadDifferences` starts a rescan that **infers no deletion from absence**.
  Each note the scan did not return forgets its `remoteId`, `remoteVersion` and `syncedHash`, is marked dirty and is owed a `write`; each notebook the store had bound to a remote folder forgets its `remoteId` and is owed a `mkdir`, outermost first and ahead of the writes this rescan queues.
  Not ahead of every write: a *dirty* note's write was queued when the user typed, so it has a lower `seq` than anything here and still makes its own parent through `runWrite`'s not-found recovery, which this does not make unreachable.
  This is the one place a pull marks a note dirty, against the rule that only a user's edit does ([`CLAUDE.md`](../CLAUDE.md)): the row genuinely is ahead of the remote now, and the unsynced dot the sidebar paints on it is true until the push drains.
  A deletion the scan *proves* still stands — a file it listed that is gone by the time the engine reads it is a positive answer, not an absence, and is still forgotten.
  A note the user deleted here is left alone entirely: its tombstone is reported clean, so the scan names it for reupload, and the store declines — it owes the remote its delete and nothing else, and forgetting the `remoteId` would leave that delete addressed at nothing and the file back on the next pull.
  A notebook the store holds with **no** `remoteId` is not named either: the reconcile asks only about folders bound to a remote one.
  An empty local-only notebook therefore stays local-only, as it was before the rescan; one with notes in it is made by the writes of the notes inside.
  Forgetting all three matters: a write against a `remoteVersion` for a file that is not there is refused, and a kept `syncedHash` says these bytes are already up, so nothing would ever send them.
  No folder cascades, since the notes inside are named one by one — the cascade exists to stop notes floating at a path with no folder, and here neither is going anywhere.
  A note the scan *did* return with different bytes needs no special case: a clean note's bytes are what it last synced, so the remote's are the newer ones, and a dirty note takes the conflict rule as always.
  The flag survives an interruption for free — the stored cursor is left in place, so the next pull meets the same refusal and is told the same thing.
- **Reading everything again is offered, with what it costs said first.**
  A cursor the provider has lost, or a store that disagrees with the remote about what is there, is otherwise a dead end the user cannot get out of.
  "Re-scan from scratch" drops the cursor and gives every op its attempts back, in one transaction so a scan cannot start against a half-reset queue, and keeps `rootId` — it is the same folder.
  The confirm says what a scan means: notes the provider no longer has are removed here too, unless they hold edits that have not been sent.

**Renames of notes holding unpushed edits, on providers with file ids.**
A note renamed remotely *while it holds unpushed edits* arrives under a new path, and — on OneDrive, whose `eTag` changes on a move — a new version too, which on its own reads exactly like a remote edit.
So every note records `syncedHash`, the `contentHash` of the bytes it and its remote file last agreed on: set by every pull that writes a note (`upsert-note`, and a conflict's remote side) and every push that lands (`pushed`, whether or not the user typed meanwhile — the remote holds what was sent), passed on `adopt-version` and `move-note` (read afresh when the version moved, carried over when it did not), and dropped with the remote (`detach-note`, a deleted folder's dirty notes, a copy into another account, a note brought back from a pull's delete, a note restored while its delete was in flight).
A dirty note whose remote file's bytes hash to it — read at the version the feed named, since a read that answers with another version proves nothing about that one — was not edited over there: the engine follows the rename (`move-note`) or takes the version (`adopt-version`), the edit stays dirty and goes out against the new version, and no conflict copy is made.
A note with no hash — rows from before it existed — cannot say, and takes the conflict as it always did, so nothing is migrated.
WebDAV is not helped: its `remoteId` is the path, so a rename arrives as a deletion and a new file, the dirty note is detached and re-created on push, and the renamed file becomes a second note — nothing is lost, but the user sees two.
The engine computes every hash and the store only writes it, since an IndexedDB transaction cannot wait on `crypto.subtle`.

---

<a id="pwa-specifics"></a><a id="s8"></a>
## 8. PWA specifics

`@skysa/pwa` builds an app's manifest and service worker from what the app hands it (`PwaApp`: its routes and its share target) and from a brand file; `@skysa/client` holds what the page does around them.
What follows is the kit's part of skysa-notes' §8; the rest — its fill window, keeping the store, files on demand, the share sheet's page, the install banner — is skysa-notes' own ([skysa-notes §8](https://github.com/skysa-org/skysa-notes/blob/main/docs/ARCHITECTURE.md#s8)).
- `vite-plugin-pwa` in `generateSW` mode to start (switch to `injectManifest` only if a custom worker becomes necessary): precache app shell (the answer to a navigation to the app's own route, and no other; below), `NetworkOnly` for `/api/*` (never a cached answer: binding follows what `/api/connection` says, see Phase 2), `NetworkOnly` for provider API origins, `registerType: 'prompt'` with an in-app "update available" toast.
- Manifest generated by the plugin: standalone display, icons, and a `share_target` where the app hands one in (skysa-notes' feeds its clipboard: skysa-notes §8, "Shared to the app").
- **The screen kept on through a long sync (2026-10-05).**
  A phone whose screen times out mid-import suspends the network, and the run fails part-way; what it had read is kept (§7, "A pull keeps what it has read"), but nothing moves until the phone is unlocked.
  While a run long enough to count is under way (`isLongRun` in `sync/progress.ts`, the panel's own threshold of 20) and the page is visible, `sync/wakeLock.ts` holds a screen wake lock (https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API), lets go of it when the run ends or fails, and asks again when the page is shown, since the browser lets go of it as the page is hidden.
  A refusal — battery saver — is taken as the answer until the page is shown again or another run starts.
  A browser without the API syncs as before.
  Pressing the power button still stops the run; the next one picks up from what was kept.
- Tokens: keep provider access tokens in memory with a copy in the app's IndexedDB (`TokenStates`, §7) so a reload doesn't force a backend round-trip.
  Never in localStorage.
- Installability is a checklist the browser applies silently — a missing 192px icon or a bad `start_url` and the install option simply never appears, with nothing in the build to say why.
  The manifest and Workbox options live in `packages/pwa/src/pwa.ts` rather than inline in an app's `vite.config.ts` so that checklist can be a test (`packages/pwa/tests/pwa.test.ts`), down to reading each icon's real dimensions out of its PNG header.
  What is the app's own is handed in (`PwaApp`): the routes its shell answers, and its share target.
  skysa-notes makes its own in `apps/web/pwaApp.ts`, and checks it in `tests/pwa.app.test.ts`.
- With `registerType: 'prompt'` the worker does not claim the first page load, by design: the page that registered it keeps running the build it was served, and the next navigation is the first one the worker controls.
  So "works offline" means from the second visit onwards, which is the only thing it could mean — the first visit is the one that downloads the app.
- **Reload stops the app's requests first (2026-10-13).**
  The prompt's Reload asks the waiting worker to take over (`skipWaiting`), and the page reloads once it has.
  Chromium lets it take over only once the worker it replaces has no event in flight, and every request a page it controls makes is a fetch event there, a sync's to the provider most of all.
  A request that starts while the take-over waits holds it, and after that a quiet moment no longer lets it through: it waits out Chromium's five-minute limit on an outgoing worker, through Reload pressed again and the page reloaded by hand, with the prompt still up.
  Measured on Chromium 153 with two builds of the app and a page making four requests at a time: asked while they went on, the take-over came 300 s later, not when they stopped; asked once they had stopped, at once; a request already out when it was asked did no harm.
  A sync goes on most of the time the app is open, so Reload looked dead.
  Leaving provider and `/api/*` requests unrouted in the worker (no `NetworkOnly`) did not help: a request the worker does not answer is still a fetch event.
  So Reload pauses this tab's sync, as the user's pause does, and asks every other tab to pause too over a `BroadcastChannel` (`skysa-update`).
  It gives them 250 ms, then asks (`packages/client/src/sync/beforeUpdate.ts`).
  With a second tab making requests until told, the take-over and both reloads came in about 1.5 s.
  A pause lasts only until the app is opened again, so syncing starts again after the reload by itself.
  The prompt says it is updating meanwhile, and after ten seconds, what else will do it.
  A request nothing here makes, such as a picture opened at that moment or a tab still on a build from before this, still holds the take-over to the five minutes.
  The update *to* this build is one of those: the old page handles the click.
- **The shell answers only the app's own route (2026-09-29, skysa-notes#143).**
  The navigation fallback answered every path outside `/api/*` with the shell.
  So a page someone else serves on the same origin, most likely the operator's page a gate's action links to (§6, "Refusal codes and the connect gate"), opened as the app's "Not found" in any browser that had run the app once, while a browser that never had got the page.
  The fallback now has an allowlist, `/` with or without a search, because the app has one route and what it opens is in the hash, which no request carries, and the query (skysa-notes §7, "Where the user is, in the URL").
  Every other path goes to the network, and offline it gets the browser's own error rather than the app's "Not found".
  An app checks every route its router has against the allowlist (skysa-notes' `tests/pwa.app.test.ts`), so a route it adds cannot be left out of it.
  A worker already installed keeps the old rule until its update is accepted (`registerType: 'prompt'`, above).

- **Brand (2026-10-01).**
  What the app is called and how it looks is a build input, the path to a `brand.json` (skysa-notes reads it from `NOTES_BRAND`) that names the app (`name`, and a `shortName` of at most 12 characters for under a home-screen icon), describes it, gives the brand color, the text on it and the title-bar color for each of the light and dark themes plus the splash background, points at a folder of the six icons, and optionally gives woff2 files for a sans and a mono family.
  Without it the build uses the app's own default, which the app hands to `loadBrand`.
  skysa-notes' is `apps/web/brand/brand.json` (`DEFAULT_BRAND` in its `pwaApp.ts`): "Notes", in gray (`#4B5563` light, `#9CA3AF` dark), the curled-page icons on that gray, and the system fonts, so its default build carries no deployment's name, color or mark.
  The brand file's JSON Schema is the kit's (`packages/pwa/brand.schema.json`, exported as `@skysa/pwa/brand.schema.json`).
  `packages/pwa/src/brand.ts` reads and checks it and stops the build on anything wrong — a missing field, a color that is not `#RRGGBB`, a long `shortName`, an icon missing or at the wrong size (read from its PNG header, as `tests/pwa.test.ts` always did), a font file missing or not woff2 — since a build that went ahead would only install without an icon, or not offer to install, and say nothing.
  The installed app's navigation bar on Android is one color for both themes, since a manifest has one value and no dark variant (Chrome's dark fields are an experiment it no longer reads), and which color it is depends on the phone.
  On Android 14 and older Chrome paints it with `theme_color`, which is the light theme's `brand` (2026-10-11).
  From Android 15 an app cannot paint the bar: it is transparent over the app's window, which Chrome fills with `background_color`, the brand's `background`, the splash's color.
  That was measured on a Pixel on Android 17 (2026-10-11): `theme_color` in the installed app and nowhere on screen, the bar exactly `background_color`, the page laid out between the system bars with no inset to fill.
  So neither leaving out `theme_color` (2026-10-10) nor setting it to the brand fixed a pale bar under the app in dark mode; the brand's `background` decides it, and skysa-notes' `self-hosting.md` says so to whoever picks it.
  A deployment that gives `background` the light `brand`'s value has one bar on every phone.
  The page's `theme-color` tags still color the status bar once it is open.
  It is read at build time and not served by `/api/config` because everything it covers is settled before the app could ask: the manifest and the iOS home-screen title and icon are read by the platform at install, the precache is revisioned when the app is built, and the first paint comes from IndexedDB with no network.
  A Vite plugin in `brand.ts` writes the title, the description, a `theme-color` per theme and the icon links into the page, with no script (§9); writes a stylesheet of `@font-face` rules and the custom properties `styles/` reads (`--brand`, `--on-brand`, `--font-sans`, `--font-mono`, the colors again under `prefers-color-scheme: dark`) as a file on this origin, so the Content-Security-Policy needs nothing new; and writes the icons at their fixed names and the stylesheet and fonts under `/brand/`, named by their content, beside the app, where the precache glob takes them in.
  `pwa.ts` builds the manifest from it.
  **The brand is never data identity.**
  The app folder's name, its marker file and the app name the marker validates, the IndexedDB name, and the lock and cookie names stay as they are whatever the brand says: renaming any of them would leave every library already connected unfound.
  A deployment's brand is the second thing it may bring besides the `createApp` seams and `ENABLED_PROVIDERS`, and it reaches the build the same way they reach the Worker, from outside the repo.

---

<a id="security-checklist"></a><a id="s9"></a>
## 9. Security checklist

The kit's part of skysa-notes' §9: the server's, and what an app's page must hold for the client's credential.
What an app shows and opens is its own ([skysa-notes §9](https://github.com/skysa-org/skysa-notes/blob/main/docs/ARCHITECTURE.md#s9)).
- PKCE + `state` on every OAuth flow; `state` bound to the browser that started it by the signed `__Host-skysa_flow` cookie, which also carries the device's credential hash (§6, "Per-connection credentials").
  `/start` is a same-origin POST, so neither the hash nor `state` can be planted by a link.
- The callback's answer (`__Host-skysa_flow_answer`) is signed like the flow cookie, and only a path in this app is ever taken from it, so it cannot be made into an open redirect.
  It holds no verifier, and a callback answered from it exchanges nothing (§6, "Storage OAuth, as built").
- `POST /api/connect-code` tells whoever asks whether a code is live, so it is same-origin and goes through the rate limiter before the policy is asked, and the code is never logged (§6, "Connect codes").
- `SECRETS_KEY` only in server env; secrets table encrypted at rest.
  A device's credential is never stored at all — only its SHA-256.
- Authorization is a per-connection bearer, never a cookie, so nothing is sent ambiently and CSRF stops being a class of bug here.
  The cost is that IndexedDB has no `httpOnly`: a stolen credential works until the device is revoked.
  `script-src 'self'` is therefore a hard requirement rather than a good default, HSTS is set on the shell, `GET /api/connection/grants` makes a theft visible, `DELETE` makes it revocable, and a grant unused for 180 days expires on the next read.
  Revoking nulls the grant rather than deleting it, so the hash stays spent: a deleted row would free its hash for whoever holds the credential behind it — the thief being revoked — to claim against storage of their own (§6).
- HSTS on the static shell: `max-age=63072000`, with neither `includeSubDomains` nor `preload` — each is a commitment for whoever self-hosts (from an apex domain the first takes in every subdomain they own, for two years), and theirs to make; skysa-notes' `docs/self-hosting.md` says how.
  The credentials are origin-bound in IndexedDB and the flow cookie is `__Host-`, so subdomains were adding little.
  Held in skysa-notes by its `tests/csp.test.ts`.
- A rate-limit seam (`createApp({ rateLimiter })`, no-op by default) on the two connect routes and `/api/token`, which are the endpoints that spend an outbound provider call per attempt.
- The change relay, where it is turned on (§6, "Change relay"), carries no content and no path.
  Its ticket rides in a URL, so it is sealed, opaque and good for 30 seconds, and is never the credential or anything derived from it.
  The upgrade is same-origin and re-tests the grant; sockets close on revocation and after an hour; nothing per message is logged.
  The server does learn when each connection is edited, which the self-hosting guide says before an operator turns it on.
- *(Only if WebDAV is built, §5.4.)*
  WebDAV proxy: allowlist methods, reject paths that escape the configured base URL after normalization, strip hop-by-hop headers, 30s timeout, 20 MB body cap.
- *(Only if WebDAV is built, §5.4.)*
  WebDAV proxy SSRF hardening (on by default; protects operators who expose their instance to the internet): HTTPS only; resolve the host and reject private/loopback/link-local/cloud-metadata ranges (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, fc00::/7, ::1); reject IP-literal hosts; re-validate on redirect (or disable redirects); per-user rate limit and daily byte budget.
  Self-hosters could relax the private-range rule for a LAN Nextcloud.
  The `WEBDAV_ALLOW_PRIVATE` flag reserved for that does nothing today and is deprecated (§6, provider enablement); a built WebDAV would bring its own.
- CSP: `connect-src` limited to self + `www.googleapis.com` + `*.dropboxapi.com` + OneDrive's `graph.microsoft.com` and its download hosts (`*.files.1drv.com`, `my.microsoftpersonalcontent.com`, `*.sharepoint.com`, §5.2) — each provider's hosts added with its adapter, never ahead of it (WebDAV goes through the proxy, so it adds none).
  skysa-notes sets it for every static response in `apps/web/public/_headers` (Cloudflare applies it to the shell, the assets and `sw.js`, and a response the service worker replays keeps it; `/api/*` is the Worker's and is not a page); its `tests/csp.test.ts` holds it, including that every host the adapters request is allowed.
  `script-src 'self'` with nothing inline or eval'd: zod's `new Function` probe is turned off (skysa-notes' `src/jitless.ts`, imported first), since it reports a violation even when refused.
  skysa-notes' `style-src` allows `'unsafe-inline'` because its editors set style attributes and CodeMirror inserts `<style>` elements; `img-src` allows any `https:` image a note links; `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`.
- Disconnect revokes at the provider (Google `revoke`, Dropbox `auth/token/revoke`; Graph has no per-app revoke, so the disconnect confirmation links to where the user removes it: `LEFT_AT_PROVIDER` in skysa-notes' `apps/web/src/sync/account.ts`).
  Google's revoke reaches every grant the user gave the Cloud project, which is why each deployment wants a project of its own (skysa-notes' `docs/google-oauth.md`).
  Disconnecting does not yet tell the user when a revoke that should have worked failed (`revoked: false` from Dropbox or Google) — skysa-notes#124.

---

<a id="repo-layout"></a><a id="s11"></a>
## 11. Repo layout

A pnpm workspace of seven packages, one version among them.
Each package's tests are beside its source, and a package with test doubles for others to use exports them as `/testing`.

```
packages/
  protocol/                # @skysa/protocol: what the server, the client and a deployment all speak
    src/                   # the API's error codes, the entitlement, gate and rate-limit seams, the relay's frames, PROVIDER_KINDS
  storage/                 # @skysa/storage: the provider adapters and what every layer above uses
    src/
      providers/           # the StorageProvider port (§4), the adapters (§5), the in-memory fake
      names/               # names: folding, conflict copies, extensions, byte limits
      files/               # media types
    tests/                 # the adapter contract (§4), wire stubs; /testing
  sync/                    # @skysa/sync: the sync engine (§7) and its store port
    src/
      engine.ts            # the pull, the push, and the rescan
      pull/ push/          # what a round decides, and how a queued op is sent
    tests/                 # the in-memory store, the store contract, the soaks; /testing
  server/                  # @skysa/server: the Worker as a library (§6)
    src/
      oauth/               # one connect flow per provider
      routes/              # /api/auth, /api/connection, /api/token, /api/relay
      relay/               # the change relay and its Durable Object (/relay)
      db/                  # the Drizzle schema and queries
    migrations/            # D1's, generated from src/db/schema.ts
  client/                  # @skysa/client: the client's side of sync
    src/
      api/                 # the API client, the instance config
      sync/                # the token source, the provider factory, the scheduler, the relay client, the wake lock
      store/               # the credentials, the connect code, the emitter a screen listens to
    tests/                 # the shared client suites over a device's ports; /testing
  pwa/                     # @skysa/pwa: the manifest, the service worker, the brand (§8)
    src/
    scripts/               # the bundle-size check (/budget)
  eslint-config/           # @skysa/eslint-config: the shared lint, tsconfig.base.json, Prettier's settings
docs/
  ARCHITECTURE.md          # this document
  decisions/               # the records behind it
.changeset/                # the changesets waiting for a release, and how one is cut
scripts/                   # the pack check, a release's notes, and which pull requests need no changeset
tests/                     # what is no one package's: that every citation of these documents leads somewhere, and the scripts
```

Every package but `eslint-config` is built by `tsc -b` (`pnpm build`) into its `dist/`: `tsconfig.build.json` for its `src`, and `tsconfig.testing.json` for what `/testing` exports.
In the workspace a package's exports lead to its TypeScript source, so nothing needs building to test it; `publishConfig` points the published package's exports at `dist/`.
The build is where the code that runs in a browser or a Worker is held to it: `protocol`, `storage`, `sync` and `client` compile their `src` with no ambient types at all, and `server` with only the Workers runtime's.
`@skysa/server`'s declarations name the runtime's types (`D1Database`, `DurableObjectNamespace`), which an app's Worker has from `wrangler types` or `@cloudflare/workers-types`.
`pnpm pack:check` packs every package as npm would receive it and loads each entry it exports in plain Node, with only what that package declares beside it, and with `cloudflare:workers`, which only a Worker has, stood in for.

Everything else about skysa-notes — its history, its resolved questions, what is not planned, its GitHub setup — is in sections 10, 12, 14 and 15 of [its own document](https://github.com/skysa-org/skysa-notes/blob/main/docs/ARCHITECTURE.md).

<a id="distribution-and-licensing"></a><a id="s13"></a>
## 13. Distribution and licensing

The kit is AGPL-3.0, version 3 only (SPDX `AGPL-3.0-only`), as skysa-notes is: `NOTICE` carries the grant, and every package's `package.json` says the same.
The server is where the network clause matters, and the kit has it ([skysa-notes' record 0018](https://github.com/skysa-org/skysa-notes/blob/main/docs/decisions/0018-the-shared-kit.md)).
A contribution needs the same CLA as skysa-notes', signed once here and checked by `.github/workflows/cla.yml`: a license grant, not an assignment, with the project's promise that every contribution stays available under AGPL-3.0 ([`CLA-individual.md`](../CLA-individual.md), and [`CLA-entity.md`](../CLA-entity.md) for an employer).
Both are drafts that have not been reviewed by counsel; why they are shaped as they are is [skysa-notes §13](https://github.com/skysa-org/skysa-notes/blob/main/docs/ARCHITECTURE.md#s13).
The packages are to be public on npm, from a public repository, with no operator's configuration or credentials in either (§1).
They are released together at one version, tagged `vX.Y.Z`, from a version pull request reviewed like any other ([`.changeset/README.md`](../.changeset/README.md)).
Only `.github/workflows/release.yml` publishes them, with provenance, and only once the repository is public and publishing is switched on; until then a release is a tag and a GitHub release.
