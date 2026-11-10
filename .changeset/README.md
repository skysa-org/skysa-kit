# Changesets

A changeset is a note, written with the change and merged with it, saying what moved and how much.
`pnpm run changeset` asks which packages moved, how big the change is and for a summary, then writes one here.

```
pnpm run changeset            # write one
pnpm run changeset:status     # what is pending, and what it would release
pnpm run changeset:version    # consume them: bump versions, write CHANGELOGs
```

## What is unusual here, and why

**One version, not seven.**
The seven packages are `fixed` together (`@skysa/*` in `config.json`), so they always carry the same number, and the `vX.Y.Z` tag names it.
An app takes the layers it needs, and the layers cannot drift apart: `@skysa/sync` at one version beside `@skysa/client` at another is a pair nobody has tested ([`docs/ARCHITECTURE.md` §1](../docs/ARCHITECTURE.md#s1), "Packages").
A package with nothing of its own in a release still moves with the others, and the release notes leave it out (`scripts/releaseNotes.mjs`).

**Versioning is a local step, not a bot.**
`pnpm run changeset:version` is run by hand, reviewed as a pull request like anything else, and merged.
Pushing it to `main` is what makes `.github/workflows/release.yml` cut the tag and the GitHub release.
The Changesets "Version Packages" bot is deliberately not used: a pull request opened with `GITHUB_TOKEN` starts no workflows, so its own CI would never run, and once `verify` is a required check such a pull request could never merge.

That pull request needs no changeset of its own, and could not have one: `changeset version` **deletes** every changeset it consumes, so its diff is seven bumped packages and nothing explaining them — the exact shape the CI check rejects.
CI recognizes it by that shape and does not ask: nothing changed in a package but its `CHANGELOG.md` and, in its `package.json`, the version and the dependency ranges (`scripts/changesetExempt.mjs`).
A source file alongside them is not a release, and neither is a change to what a manifest ships — its exports, its files, its `publishConfig` — so each is asked like anything else.

**Publishing is the workflow's, and it is off.**
Nothing is published from anyone's machine.
The release workflow's `publish` job publishes each package npm does not yet have at the released version, with provenance, from the commit the version's tag names, after building it and running the pack check again (`pnpm pack:check`).
It runs only once three things are true, in this order: the repository is public, which npm's provenance needs; the `@skysa` scope is claimed on npm, with a token that can publish to it in the repository secret `NPM_TOKEN`; and the repository variable `NPM_PUBLISH` is `true`.
After that, "Run workflow" on `main` publishes a version that was released before publishing was switched on.
Until then a release is a tag and a GitHub release, and none of the packages is on npm.

## When to write one

Whenever a pull request changes anything under `packages/`.
CI asks for it and will fail the pull request without one.
Two shapes are exempt, because neither can answer: the release pull request above, and a dependency bump — Dependabot cannot write a changeset, and a rule that turns every dependency pull request red is one people learn to ignore.
Where a bump is worth a line in the changelog, write one anyway.

When the change genuinely does not move the version — a test, a comment, a refactor nobody outside the repository can observe — say that rather than inventing a bump:

```
pnpm run changeset --empty
```

That writes a changeset with no packages in it, which is a real answer and leaves a record that the question was asked.

## Which bump

The number makes one promise, to the developer of an app built on the kit: whether updating asks anything of the app.

Before 1.0, read as npm reads a `0.x` range (`^0.2.0` takes `0.2.5` and not `0.3.0`):

- **patch** — a fix, a feature, anything an app can take without changing.
- **minor** — anything an app must act on: an export removed or renamed, a port with a new member the app has to supply, an option that changes meaning or a new one with no default.
- **major** — 1.0 itself, which is a decision of its own rather than the size of a change.

From 1.0, the usual: a fix is a patch, a feature is a minor, and anything an app must act on is a major.

No bump is license to strand what people already have.
A user's library and a deployment's database written by any earlier release keep working after an update: the marker, conflict and file names, and the D1 schema are user data, and a migration is never edited once released ([`CLAUDE.md`](../CLAUDE.md)).
Where a change cannot read them as they are, it ships with the upgrade path that carries them forward, in the same release and tested against data in the old shape.

The summary is read by the developers of those apps, deciding whether to update.
Write it for them: what changed for an app and what it has to do, not which function was renamed inside.
