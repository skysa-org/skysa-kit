---
'@skysa/client': patch
---

The change relay's link stops for the session after six sockets in a row that never opened, where it has never heard the relay (`RELAY_GIVE_UP`). A browser that refuses a same-origin `wss:` socket under `connect-src 'self'`, one from before CSP Level 3, had it asking for a ticket every minute for as long as the app was in view. A link that has heard the relay once in the session never gives up, and a socket that opens starts the count over. Polling goes on as it is.
