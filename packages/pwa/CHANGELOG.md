# @skysa/pwa

## 1.1.0

### Patch Changes

- f7700ec: A brand's description reaches the page as written. It was escaped twice, once by the kit and once by Vite as it writes the tag, so a description with `&`, `<`, `>` or `"` showed its escapes in search results and share cards (`Notes &amp; to-dos`). The title was right, and an app has nothing to change.
- b4604cd: The brand's Vite plugin is named `@skysa/pwa:brand` rather than one app's name. The name is what Vite prints before anything the plugin throws; the package never offered it as a way to find the plugin, so an app has nothing to change.

## 1.0.0

### Major Changes

- bf5f712: The kit's first stable version, made once skysa-notes ran on it in production (its 3.0.0, 2026-11-12). Nothing changed from 0.2.0, so an app on 0.2.0 moves to 1.0.0 without changing anything.
  
  What changes is what the number promises. From 1.0, a minor is a feature an app can take as it is, and only a major asks anything of an app, so a range of `^1.0.0` takes every version an app can take unchanged. Before 1.0, a minor could ask an app to act.

## 0.2.0

No changes in this release.

## 0.1.0

### Minor Changes

- e9c06c2: The first release: the layers skysa-notes is built on, moved here with their history, as seven packages at one version.
