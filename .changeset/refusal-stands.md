---
'@skysa/client': minor
---

A refusal stands until something answers it. The scheduler's status keeps `refusal` and `denial` from the server's refusal until a token is had again, whatever the phase: a run that asks again, going offline, a backoff, a pause and another source shown in between no longer clear it, and a token had mid-run clears it at once. An app that shows `refusal` without asking the phase now shows it through those, which is what it is for. A refusal answered, in a run or by a file read outside one, is followed by a run, which a backoff under way is left to. A connection let go is asked afresh once connected again. Where the provider refuses even a fresh token, the status now says `reauthorize_required`, until a run's pull gets through, where it said only the error `authorization required`.

`needsReconnect(status)` is exported: true for `credential_required`, `credential_revoked` and `reauthorize_required`, whatever the phase. It can replace an app's copy, which asked it of `attention` alone; a copy kept goes on working as before.

A run that follows one superseded part-way (the connection re-bound mid-sync) no longer starts with the old run's `progress`.

A status with nothing refused now leaves `refusal` and `denial` out, where some had them as `undefined`. A test of an app's own that expects `{ refusal: undefined }` with `toMatchObject` reads the field instead; the shared suites already do.
