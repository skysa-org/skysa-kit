# Security policy

## Reporting a vulnerability

**Do not open a public issue.**

Use GitHub's **private vulnerability reporting** on this repository: [Security → Report a vulnerability](https://github.com/skysa-org/skysa-kit/security/advisories/new).
It creates a private advisory only the maintainers can see.

If that page says reporting is not enabled, it has not been switched on yet — it is a repository setting, and turning it on is on the maintainer's list.
In that case please open an issue saying only *"I have a security report and private reporting is off"*, with no detail of the problem in it, and you will be given somewhere private to send it.

Please include, as far as you can:

- what an attacker gets, in one sentence
- the steps to reproduce it, or a proof of concept
- which version or commit you tested, and which app built on the kit, if you found it through one
- whether it needs a device to hold a connection, and whose

You will get an acknowledgment as soon as the maintainer sees it, usually within a week.
This is a small project with one maintainer and no paging, so that is an expectation rather than a promise, and it is about answering rather than fixing; the advisory thread is where a timeline gets agreed.

You are welcome to disclose publicly once a fix has shipped, or after 90 days, whichever is sooner.
Say so in the report if you want to coordinate on a date.

## Supported versions

Fixes land on `main` and go out in the next release; the latest release and `main` are supported, and nothing older is.
Until the first release, that is `main` alone.
An app built on the kit is running whichever version it depends on, and a deployment of an app is running some commit of it, so **the security of an instance is the security of what it deployed**, and updating is on whoever deployed it.

## What is in scope

This repository's packages: `@skysa/protocol`, `storage`, `sync`, `server`, `client`, `pwa` and `eslint-config`.
A problem in an app's own code — its screens, its store, its headers — is that app's to fix, and goes to its own security policy ([skysa-notes'](https://github.com/skysa-org/skysa-notes/blob/main/SECURITY.md)); if you are not sure which it is, report it here and it will be passed on.

Things that are especially worth looking at, because they are where the interesting properties live:

- **Credentials.**
  A device proves its right to a connection with a credential it generated; the server stores only its SHA-256.
  Anything that gets a credential's plaintext out of the browser, or lets a credential for one connection act on another, is a serious finding.
  [`docs/ARCHITECTURE.md` §6, "Per-connection credentials"](docs/ARCHITECTURE.md#per-connection-credentials) sets out the model.
- **What the kit puts in a page.**
  An app's `script-src 'self'` with nothing inline is load-bearing, not a nicety: it is what stops an XSS from exfiltrating a credential that `httpOnly` cannot protect.
  Anything the kit adds to a page — the PWA build's tags, the service worker, the client — that needs an inline script or `eval`, or opens a way around that policy, is a finding even without a script injection to go with it.
- **Refresh tokens.**
  They exist only encrypted in D1 and never leave the server.
  Anything that returns one, logs one, or decrypts one without the right credential is a serious finding.
- **Document content reaching the server.**
  By design it never does.
  If you find a path where it does, that is a bug regardless of whether it is exploitable.
- **The OAuth flow**: `state`, the PKCE verifier, the flow cookie, the `returnTo` redirect, and the same-origin check on `/start`.

## What is out of scope

- **Self-inflicted deployment problems**: a missing `SECRETS_KEY`, an `APP_ORIGIN` that does not match, secrets committed to a fork, provider app registrations with over-broad scopes.
  An app's own deployment guide covers the setup ([skysa-notes'](https://github.com/skysa-org/skysa-notes/blob/main/docs/self-hosting.md)); a misconfiguration is not a vulnerability in the code.
- **Anything requiring an attacker to already have the user's device unlocked**, or their storage provider account.
  A device's documents, tokens and credentials are in IndexedDB by design, because the apps work offline; that is the product, not a bug.
- **Denial of service by volume** against an instance.
  Rate limiting is a seam an operator fills (`createApp({ rateLimiter })`), deliberately, so that no one deployment's policy is baked into the kit.
- **Missing headers with no exploit path**, automated scanner output pasted without a scenario, and reports about dependencies that do not reach anything a package ships.

## A note on the threat model

The server is deliberately not trusted with document content and never sees it.
It *is* trusted with refresh tokens, which are the keys to a user's app folder.
A compromise of a deployment's `SECRETS_KEY` plus its D1 database is total for every connected account on that instance — that is understood and stated rather than mitigated away, and it is why operators are told to treat both as secrets of the same weight.
