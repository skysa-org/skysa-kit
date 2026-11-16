---
'@skysa/sync': minor
'@skysa/client': patch
---

An op whose request was aborted counts no attempt. `createSyncEngine` takes a `signal`: once it is aborted, a failed op keeps its attempts and the push starts no further op. The scheduler gives each session's engine its own signal, and `pause` no longer gives every op its attempts back once the run lets go. That release wiped an op given up on for a reason of its own, and could wipe what a run resumed meanwhile had counted (#20, item 3).
