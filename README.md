# skysa-kit

The layers of a local-first app that do not care what its files hold.
An app built on them keeps its documents as files in a folder of its own on the user's own cloud storage — Google Drive, OneDrive or Dropbox — works offline against a store on the device, and syncs straight from the browser to the provider.
Its server connects storage accounts and mints short-lived tokens, and never sees a document.

They were written for [skysa-notes](https://github.com/skysa-org/skysa-notes) and moved here, with their history, so that it and its sister apps share one copy ([its record 0018](https://github.com/skysa-org/skysa-notes/blob/main/docs/decisions/0018-the-shared-kit.md)).

## The packages

| Package | What it is |
|---|---|
| `@skysa/protocol` | What the server, the client and a deployment all speak: the API's error codes, the entitlement, gate and rate-limit seams, the relay's frames, and the provider kinds. |
| `@skysa/storage` | The storage adapter interface and its errors, one adapter per provider, and below them names, paths, the marker and hashing. |
| `@skysa/sync` | The sync engine and its store port, over a document format the app supplies. |
| `@skysa/server` | The server as a library for Cloudflare Workers (Hono, D1), one connect flow per provider, and the D1 migrations. |
| `@skysa/client` | The client's side of sync: the API client, the token source, the provider factory, the scheduler, the relay client, and the credential a device holds. |
| `@skysa/pwa` | The brand's Vite plugin, the web app manifest and the service worker's options, and the bundle budget. |
| `@skysa/eslint-config` | The lint rules the Skysa apps share, their base tsconfig, and Prettier's settings. |

They share one version and are released together.
None is on npm yet; [`.changeset/README.md`](.changeset/README.md) says how a release is cut, and what switches publishing on.

## What an app hands in

Nothing here names an app.
An app hands the kit what is its own: its folder and the marker in it (`AppFolderSpec`), what its documents are (`DocumentFormat`), which of its hidden paths sync, how two edits merge, its device store (through `@skysa/client`'s ports), its PWA routes and share target, and its brand.
Its own Worker entry reads the deployment's configuration and hands it to `createApp`.

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) is the design, and the decisions behind it are in [`docs/decisions/`](docs/decisions/README.md).

## License

AGPL-3.0-only ([LICENSE](LICENSE)).
A contribution needs the [CLA](CLA-individual.md) signed once; [CONTRIBUTING.md](CONTRIBUTING.md) says how.
Security reports go privately, as [SECURITY.md](SECURITY.md) says.
