# @skysa/server

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
