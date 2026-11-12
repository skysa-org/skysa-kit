---
'@skysa/client': minor
---

`ClientDevice` (`@skysa/client/testing`) takes an optional `written(body, id?)`: a document's file as another device of the app writes one holding a body, claiming the id where one is given, as an edit elsewhere of a document this device holds does. The suites that put a document on the remote themselves write it through it, and refuse, naming `written`, a file the app's format would not read as a document (`DocumentFormat.isDocumentText`).

Without it the body goes on the remote as it is, so an app whose plain text is a document runs the suites as before. One whose documents claim their id in the file, as a header does, should pass `written` too, so that the suites' edits from elsewhere claim it as its own devices' do.

`describeFailures` and `describeConnection` are the suites that write the remote's documents. The merge test now hands the scheduler a merge whose answer is one fixed document when it is given this device's text and the remote's, and checks that both sides hold that answer afterward. The old test put the synced file and a line more on the remote and merged by lines, which could only be written for plain text. The first-import test now checks that what it imported is held as a document.
