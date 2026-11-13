# @skysa/server

## 1.1.0

### Patch Changes

- Updated dependencies [fb46ba0]
  - @skysa/storage@1.1.0
  - @skysa/protocol@1.1.0

## 1.0.0

### Major Changes

- bf5f712: The kit's first stable version, made once skysa-notes ran on it in production (its 3.0.0, 2026-11-12). Nothing changed from 0.2.0, so an app on 0.2.0 moves to 1.0.0 without changing anything.
  
  What changes is what the number promises. From 1.0, a minor is a feature an app can take as it is, and only a major asks anything of an app, so a range of `^1.0.0` takes every version an app can take unchanged. Before 1.0, a minor could ask an app to act.

### Patch Changes

- Updated dependencies [bf5f712]
  - @skysa/protocol@1.0.0
  - @skysa/storage@1.0.0

## 0.2.0

### Minor Changes

- 7986603: `AUTH_MODE` is gone, with the `users` and `identities` tables (skysa-notes#118): every connected account is its own silo, and there was never another way to run.
  
  - **The server** no longer reads `AUTH_MODE`. A deployment that still sets it boots and logs a line asking for it to be removed (`envWarnings`), except for `account-first`, which is still refused at boot. `AppConfig` has no `authMode`.
  - **Migration `0007_drop_sign_in_tables`** drops `identities` and then `users`, which nothing ever read. Apply it as any other: `wrangler d1 migrations apply`, with `migrations_dir` at this package's `migrations/`.
  - **`/api/config`** still sends `authMode: 'storage-first'`, a fixed value, so an app from before this change, which requires it, keeps working.
  - **The client** no longer reads `authMode`: `InstanceConfig` has no such field.
  - **`@skysa/protocol`** no longer exports `AUTH_MODES` or `AuthMode`.
- b57df86: `WEBDAV_ALLOW_PRIVATE` is no longer read, and `AppConfig` loses `webdavAllowPrivate`, which nothing read: it was for a WebDAV proxy that is not built. A deployment that still sets it boots, and is told at boot to remove it. `webdav` in `ENABLED_PROVIDERS` is still accepted and still warns, since WebDAV is deferred rather than dropped.

### Patch Changes

- Updated dependencies [7986603]
  - @skysa/protocol@0.2.0
  - @skysa/storage@0.2.0

## 0.1.0

### Minor Changes

- e9c06c2: The first release: the layers skysa-notes is built on, moved here with their history, as seven packages at one version.

### Patch Changes

- Updated dependencies [e9c06c2]
  - @skysa/protocol@0.1.0
  - @skysa/storage@0.1.0
