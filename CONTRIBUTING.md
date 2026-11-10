# Contributing to skysa-kit

Thanks for looking.
The kit is the shared layers of the Skysa apps, so a change here reaches every one of them: the most useful contributions are bug reports against real use, and small focused pull requests.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first.
It is the source of truth for the architecture, and with the records in [`docs/decisions/`](docs/decisions/README.md) it explains why a lot of things are the shape they are.
Open work is in the issue tracker; pick an issue or open one before starting anything larger than a fix.
If a change needs to deviate from it, say so and propose the edit to `docs/ARCHITECTURE.md` in the same pull request.
A bug you meet in an app built on the kit may be the app's: [skysa-notes](https://github.com/skysa-org/skysa-notes) has its own tracker.

## Getting it running

Node 22.13 or later and pnpm 10 (`corepack enable`).
The server's tests use `node:sqlite`, which 22.x before 22.13 keeps behind a flag or does not have.

```bash
pnpm install
pnpm verify   # format:check + lint + typecheck + knip + test
```

The kit is libraries, with nothing to start on its own.
Each package's tests run without an account anywhere: the adapters against wire stubs, the engine against an in-memory store and remote, the server against a `node:sqlite` stand-in for D1 and scripted providers.
To see a change in a running app, run one built on the kit against your copy of it; skysa-notes' `CONTRIBUTING.md` says how to run it, and its `docs/self-hosting.md` has the provider registrations a real sync needs.

## Before you open a pull request

Run `pnpm verify`.
CI runs the same thing, a check that the D1 migrations match the schema, the tests again on Node 22.13, and `pnpm audit --prod` for information only.
A pull request that has not run `pnpm verify` will fail, and there is nothing in it that a maintainer can fix for you.

What is expected of a change:

- **Tests for new behavior.**
  Not coverage for its own sake — a test that fails if the thing you fixed comes back.
  A change to an adapter passes the contract every adapter passes (`packages/storage/tests/providers/contract.test.ts`).
- **Amend `docs/ARCHITECTURE.md`**, or the record in `docs/decisions/`, if the change alters a decision recorded there.
- **Say why** for a new dependency, in the pull request description, and check the license.
  Anything a package ships must be MIT, Apache-2.0 or ISC; build- and test-time tools are held to a looser line, but say which it is.
- **A doc comment says what the code promises, in one to five lines.**
  It sits on the declaration it describes.
  History and reasoning go in `docs/ARCHITECTURE.md`, a record in `docs/decisions/` or the pull request, and the comment links them by anchor (`docs/ARCHITECTURE.md#merge-before-the-copy`).
  Older comments run longer; shorten one when you are changing what it describes.
- **Docs are one sentence per line**, so a diff shows the sentence that changed.
  Comments and docs are in American English.
- **No `let`, no loops, no mutation** outside tests; the lint rules say so.
  The few loops kept (a byte scan where recursion would go too deep) sit behind a disable comment that says why.
  Each workaround has one helper: a value that changes is a `cell()` from `@skysa/storage` (`packages/storage/src/cell.ts`), and a set of listeners is `createEmitter` or `createStore` (`packages/client/src/store/emitter.ts`).
- **Check the vendor docs** rather than assuming, for anything about a provider API — scopes, endpoints, conflict semantics — and put the URL in a comment.

The hard rules in [`CLAUDE.md`](CLAUDE.md) apply to everyone, not just to the assistant: nothing in the kit names an app, document content never reaches the server, the server reads its configuration only from `createApp`, and no user data is ever lost on a sync conflict.

## Commits and pull requests

Small pull requests against `main`.
One concern each — a refactor bundled with a fix makes the fix impossible to review and impossible to revert on its own.

Write the commit message for someone reading `git log` in a year: what changed and why, not what the diff already says.

## The CLA

Every contributor signs the [Individual Contributor License Agreement](CLA-individual.md) once — once per person, not once per pull request.
A bot comments on your first pull request with a link and the sentence to post; signatures live in the `cla-signatures` branch of this repository, and hold your GitHub username, your numeric GitHub user id, the id and timestamp of the comment you signed with, and the number of the pull request it was on.
No email address, and no part of your contribution.
That branch holds nothing else and is never merged into `main`.

**It is a license grant, not an assignment.**
You keep ownership of everything you write, and you keep the right to use your own work anywhere else, under any terms you like.
What you grant is permission for the project to use, modify, sublicense and distribute your contribution — which is what lets the project ship it at all, and what lets it stay relicensable if the license ever has to change.

In exchange, the agreement binds the project in the other direction: every contribution stays available under AGPL-3.0, or a license one-way compatible with it, whatever else happens.
The sublicensing right cannot be used to take the project closed.

If you are contributing as part of your job, check whether your employer owns what you write.
If they do, they sign [`CLA-entity.md`](CLA-entity.md) instead — it is prepared but not yet in use, so mention it on the pull request and it will be sorted out there.

Both texts are **drafts that have not been reviewed by counsel**, and say so at the top.
They may change before they are enforced.

## Reporting a security problem

Do not open an issue.
See [`SECURITY.md`](SECURITY.md).

## Conduct

See [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
In short: be decent, assume good faith, and take it as read that the person you are replying to is trying.
