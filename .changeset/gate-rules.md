---
'@skysa/client': minor
---

The connect gate's rules, which every app had copied, are the client's, with the words left to each app:

- `askAboutConnectCode(client, code)` asks the operator's policy about a typed code and holds what it takes, answering with a `ConnectCodeOutcome`: `accepted`, `refused` (with the policy's reason), `tooMany` or `unchecked`.
- `askHeldCodeAgain(client, { asksForCode, refused, now })` asks again about a value the policy gave to hold, at most every `ASK_AGAIN_MS` and at once after a refused connect, but never within a minute of this device asking about it again, answered or not, in any tab. It calls `asksForCode` only once a value is held and due, and asks nothing where the value changed meanwhile. The held code's record keeps when it was last asked about again (`tried`); one stored before reads as never.
- `codeWasRefused({ refused, code })` says whether a refused connect is about the typed code.
- `useConnectCodeHeldUntil(onLapse?)` follows the held code, wakes a gate as its hold ends (capped at the longest timer a browser counts), and tells `onLapse` which typed code ran out.

Reading the held code no longer lets go of one that has run out during the read, and so no longer tells every watcher in the middle of a render: what has run out reads as nothing, and is let go of just after, in a microtask, where it has run out by the device's clock.
