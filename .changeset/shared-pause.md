---
'@skysa/client': minor
---

A pause is the device's: every tab of the app that shows the source pauses with it, a tab opened meanwhile finds it paused, and Sync now or a re-scan in any tab ends it in all. It is a Web Lock each paused tab holds a part in (`SharedPause`), which `browserEnvironment` gives as `SchedulerEnvironment.sharedPause` wherever there are Web Locks, so an app that makes its scheduler with the browser's environment needs no change. `pause` takes `{ thisTab: true }` for a pause of this tab alone, which asking again in another tab does not end, and which making way for an update now uses. A session's companions are told it started again as a pause ends, which they were not after Sync now, and are told a session ended only once they were told it started. Until now each tab paused alone, and another tab went on sending the changes the paused one said it kept (#20, item 2).
