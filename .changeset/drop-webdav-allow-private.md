---
'@skysa/server': minor
---

`WEBDAV_ALLOW_PRIVATE` is no longer read, and `AppConfig` loses `webdavAllowPrivate`, which nothing read: it was for a WebDAV proxy that is not built. A deployment that still sets it boots, and is told at boot to remove it. `webdav` in `ENABLED_PROVIDERS` is still accepted and still warns, since WebDAV is deferred rather than dropped.
