---
'@skysa/client': patch
---

The change relay's link stops for the session where the relay cannot be reached from the page: at once where the browser will not open a socket at all, and after six sockets in a row lost before the relay said anything, where it has never been heard in the session (`RELAY_GIVE_UP`). A browser from before CSP Level 3, which refuses a same-origin `wss:` socket under `connect-src 'self'`, or a proxy that takes the upgrade and passes no frames, had the link asking for a ticket every minute for as long as the app was in view. A link that has heard the relay in the session never gives up on a failed socket. Polling goes on as it is.
