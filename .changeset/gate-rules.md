---
'@skysa/client': minor
---

The connect gate's rules, which every app had copied, are the client's, with the words left to each app:

- `askAboutConnectCode(client, code)` asks the operator's policy about a typed code and holds what it takes, answering with a `ConnectCodeOutcome`: `accepted`, `refused` (with the policy's reason), `tooMany` or `unchecked`.
- `askHeldCodeAgain(client, { asksForCode, refused, now })` asks again about a value the policy gave to hold: at most once an hour, counted from the policy's last word or this device's last asking, answered or not, and at once after a refused connect about a value nothing has happened to in that load; a clock set back counts as due once. It calls `asksForCode` only once a value is held and due, asks nothing where the value changed meanwhile, and asks under a Web Lock so that two tabs opening together ask once, waiting for it after a refused connect. A pass the policy takes again is renewed, never shown. The held code's record keeps when it was last asked about again (`tried`); one stored before reads as never.
- `codeWasRefused({ refused, code })` says whether a refused connect is about the typed code.
- `useConnectCodeHeldUntil(onLapse?)` follows the held code as stored, lets it go by a timer as its hold ends (capped at the longest timer a browser counts), at once where it finds one already ended, and tells `onLapse` which typed code it showed ran out.

Reading the held code no longer lets go of one that has run out during the read, and so no longer tells every watcher in the middle of a render: what has run out reads as nothing, and is let go of just after, in a microtask, where it has run out by the device's clock.
