---
'@skysa/client': minor
---

A refusal stands until something answers it. The scheduler's status keeps `refusal` and `denial` from the server's refusal until a token is had again, whatever the phase: a run that asks again, going offline, a backoff and a pause no longer clear it, and a token had mid-run clears it at once. Where the provider refuses even a fresh token, the status now says `reauthorize_required`, until a run gets through, where it said only the error `authorization required`.

`needsReconnect(status)` is exported: true for `credential_required`, `credential_revoked` and `reauthorize_required`, whatever the phase. It replaces each app's copy, which asked it of `attention` alone; an app that keeps its copy goes on working as before.

A run that follows one superseded part-way (the connection re-bound mid-sync) no longer starts with the old run's `progress`.

`refusal` and `denial` are now left out of a status that has none, where some statuses had them as `undefined`: a test that expects `{ refusal: undefined }` with `toMatchObject` should read the field instead.
