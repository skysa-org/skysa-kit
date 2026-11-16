---
'@skysa/client': minor
---

The connect gate's rules, which every app had copied, are the client's, with the words left to each app:

- `askAboutConnectCode(client, code)` asks the operator's policy about a typed code and holds what it takes, answering with a `ConnectCodeOutcome`: `accepted`, `refused` (with the policy's reason), `tooMany` or `unchecked`.
- `askHeldCodeAgain(client, { asksForCode, refused, now })` asks again about a value the policy gave to hold, at most every `ASK_AGAIN_MS` and after a refused connect where the policy has not answered in the last minute. It calls `asksForCode` only once a value is held and due, joins an asking under way, and asks nothing where the value changed meanwhile.
- `codeWasRefused({ refused, code })` says whether a refused connect is about the typed code.
- `useConnectCodeHeldUntil(onLapse?)` follows the held code, wakes a gate as its hold ends (capped at the longest timer a browser counts), and tells `onLapse` which code ran out.

Reading the held code no longer lets go of one that has run out during the read, and so no longer tells every watcher in the middle of a render: what has run out reads as nothing, and is let go of just after, in a microtask.
