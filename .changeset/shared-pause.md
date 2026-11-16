---
'@skysa/client': minor
---

A pause is the device's: every tab of the app that shows the source pauses with it, a tab opened meanwhile is paused too, and Sync now or a re-scan in any tab ends it in all. `SchedulerEnvironment` takes an optional `tabs`, which `browserEnvironment` gives over a `BroadcastChannel` where there is one, so an app that makes its scheduler with the browser's environment needs no change. Until now each tab paused alone, and another tab went on sending the changes the paused one said it kept (#20, item 2).
