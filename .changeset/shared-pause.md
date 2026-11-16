---
'@skysa/client': minor
---

A pause is the device's: every tab of the app that shows the source pauses with it, a tab opened meanwhile finds it paused, and Sync now or a re-scan in any tab ends it in all. It is a Web Lock each paused tab holds a part in (`SharedPause`), which `browserEnvironment` gives as `SchedulerEnvironment.sharedPause` wherever there are Web Locks, so an app that makes its scheduler with the browser's environment needs no change. `pause` takes `{ thisTab: true }` for a pause of this tab alone, which making way for an update now uses. A session's companions are told it started again after Sync now or a re-scan ends a pause; they were not before. Until now each tab paused alone, and another tab went on sending the changes the paused one said it kept (#20, item 2).
