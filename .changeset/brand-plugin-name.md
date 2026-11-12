---
'@skysa/pwa': patch
---

The brand's Vite plugin is named `@skysa/pwa:brand` rather than `notes-brand`, one app's name. Vite puts it before anything the plugin throws. An app has nothing to change unless it finds the plugin by its name, which neither skysa-notes nor skysa-draw does.
