---
'@skysa/client': minor
---

`ClientDevice` (`@skysa/client/testing`) takes an optional `written(body, id?)`: a document's file as another device of the app writes one holding a body, claiming the id where one is given, as an edit elsewhere of a document this device holds does. The suites that put a document on the remote themselves write it through it. Without it the body goes as it is, as before. An app whose plain text is no document hands its own, so that the suites' remote documents are documents to it.

`describeFailures` and `describeConnection` write the remote's documents through it. The merge test now hands the scheduler a merge that answers one fixed document. It checks that the merge is given this device's text and the remote's, and that its answer is what both sides hold afterward. The old line-by-line merge could only be written for plain text.
