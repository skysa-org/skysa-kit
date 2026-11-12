---
'@skysa/client': minor
---

`ClientDevice` (`@skysa/client/testing`) takes an optional `written`: a document's file as another device writes one holding a body, for the suites that put a document on the remote themselves. Without it the body goes as it is, as before. An app whose plain text is no document hands its own, so that the suites' remote documents are documents to it.

`describeFailures` and `describeConnection` write the remote's documents through it. The merge test now hands the scheduler a merge that answers one fixed document. It checks that the merge is given this device's text and the remote's, and that its answer is what both sides hold afterward. The old line-by-line merge could only be written for plain text.
