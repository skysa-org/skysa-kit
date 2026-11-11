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

**Publishing is the workflow's.**
Nothing is published from anyone's machine.
Once the release workflow has cut a version's tag and GitHub release, it starts a run of itself from that tag, which publishes each package npm does not yet have at that version, with provenance, dependencies first.
It publishes from the tag's own run because npm's provenance names the commit a run is of, so it names exactly the source that was published.
That run checks the tag is a release first: on `main`, at the version it names, with a GitHub release that is not a draft.
Then two jobs do the work: `pack` builds every package and runs the pack check again, keeping the tarballs it passed, and `publish` sends exactly those with npm (`scripts/publish.mjs`).
Only `publish` holds the credential to publish, and it runs nothing but npm and that script.
It runs in the repository's `npm` environment, whose deployment rule admits only `v*` tags, so a run from a branch, with its own copy of the workflow, can publish nothing.
The environment is made, with that rule, before publishing is switched on, since GitHub would otherwise make it on first use with no rule at all.
The rule's "Ref type" is **Tag**, which the dialog does not start on: the same `v*` as a branch rule refuses every run from a tag, and admits any branch named `v…`, which is how the first publish was refused.
None of this runs unless the repository variable `NPM_PUBLISH` is `true`, and the repository is public, which npm's provenance needs.

The tag check runs from the tag's own copy of the workflow, so it stops a tag pushed by mistake, not someone who can push and changes the check at that tag as well.
What stops them is a required reviewer on the `npm` environment, which makes every publish wait for a maintainer's approval: worth having as soon as anyone who is not an approver can push.

npm takes a package from the workflow in one of two ways, and the kit uses each in turn.

1. **A package's first version comes with a token**, since trusted publishing can only be set up for a package npm already has.
   The token is a granular one, short-lived, that can read and write the `@skysa` scope's packages and bypass two-factor authentication, held as the `npm` environment's secret `NPM_TOKEN` — never as a repository secret, which a run from any branch could read.
   Once the release is on npm, the secret is deleted and the token revoked.
2. **Every later version comes through trusted publishing**, where GitHub vouches for the run and nothing secret is stored ([npm's documentation](https://docs.npmjs.com/trusted-publishers)).
   A maintainer sets it up for each package with `npm trust github @skysa/<name> --file release.yml --repo skysa-org/skysa-kit --env npm --allow-publish`.
   That needs npm 11.15.0 or later, two-factor authentication on their account, and signing in as themselves, not with the token ([`npm trust`](https://docs.npmjs.com/cli/v11/commands/npm-trust)).
   A trust that has not published within two days of being made expires, so it is made for the next release, in the two days before it is merged, not straight after the first.
   One that expired is removed (`npm trust list`, `npm trust revoke`) and made again.

A version npm refused, for want of a token or a trust, or because npm itself failed, is not lost: its tag and GitHub release stand, and "Run workflow" from the tag, once npm will take it, publishes it.
That holds until a later version is on npm: npm will not put an earlier one under `latest` unasked, and the later one supersedes it anyway.
A run from a tag uses that tag's own copy of the workflow and of `scripts/publish.mjs`, though, so a publish that failed because of either one fails again from that tag: the fix is merged, and goes out with the next version.
A package added to the kit later needs its first version the same way, by token, and from January 2027 npm takes no version published directly with one: a token can then only stage a version for a maintainer to approve ([access tokens](https://docs.npmjs.com/about-access-tokens)), which this workflow does not do.
Adding a package after that starts with finding how npm then takes a new package's first version.

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
- **major** — 1.0 itself, which is when skysa-notes runs on the kit in production ([skysa-notes' record 0018](https://github.com/skysa-org/skysa-notes/blob/main/docs/decisions/0018-the-shared-kit.md), step 3), not the size of a change.

From 1.0, the usual: a fix is a patch, a feature is a minor, and anything an app must act on is a major.

No bump is license to strand what people already have.
A user's library and a deployment's database written by any earlier release keep working after an update: the marker, conflict and file names, and the D1 schema are user data, and a migration is never edited once released ([`CLAUDE.md`](../CLAUDE.md)).
Where a change cannot read them as they are, it ships with the upgrade path that carries them forward, in the same release and tested against data in the old shape.

The summary is read by the developers of those apps, deciding whether to update.
Write it for them: what changed for an app and what it has to do, not which function was renamed inside.
