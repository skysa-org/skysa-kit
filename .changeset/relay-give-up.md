---
'@skysa/client': patch
---

The change relay's link stops for the session where the browser will not let a socket through: at once on a `SecurityError` from opening one, and after six sockets in a row that closed before opening, where none has opened in the session (`RELAY_GIVE_UP`). A browser from before CSP Level 3 refuses a same-origin `wss:` socket under `connect-src 'self'`, and had the link asking for a ticket every minute for as long as the app was in view. A link one of whose sockets has opened never gives up. Polling goes on as it is.
