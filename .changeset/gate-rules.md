---
'@skysa/client': minor
---

The connect gate's rules, which every app had copied, are the client's: `checkConnectCode(client, code)` asks the operator's policy about a typed code and holds what it takes, answering `accepted`, `refused` (with the policy's reason), `tooMany` or `unchecked` for the app to say in its own words; `askHeldCodeAgain(client, { asksForCode, refused, now })` asks again about a value the policy gave to hold, at most every `ASK_AGAIN_MS` and at once after a refused connect, calling `asksForCode` only once a value is held and due; `codeWasRefused(code)` says whether a refused connect is about the typed code; `useConnectCodeHeldUntil(onLapse?)` is the hook that wakes a gate as its hold ends, capped at the longest timer a browser counts.

Reading the held code no longer lets go of one that has run out, and so no longer tells every watcher in the middle of a render: what has run out reads as nothing, and is let go of by the next write, or by `useConnectCodeHeldUntil`'s timer as the hold ends.
