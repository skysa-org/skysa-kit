---
'@skysa/protocol': minor
'@skysa/server': minor
'@skysa/client': minor
---

`AUTH_MODE` is gone, with the `users` and `identities` tables (skysa-notes#118): every connected account is its own silo, and there was never another way to run.

- **The server** no longer reads `AUTH_MODE`. A deployment that still sets it boots and logs a line asking for it to be removed (`envWarnings`), except for `account-first`, which is still refused at boot. `AppConfig` has no `authMode`.
- **Migration `0007_drop_sign_in_tables`** drops `identities` and then `users`, which nothing ever read. Apply it as any other: `wrangler d1 migrations apply`, with `migrations_dir` at this package's `migrations/`.
- **`/api/config`** still sends `authMode: 'storage-first'`, a fixed value, so an app from before this change, which requires it, keeps working.
- **The client** no longer reads `authMode`: `InstanceConfig` has no such field.
- **`@skysa/protocol`** no longer exports `AUTH_MODES` or `AuthMode`.
