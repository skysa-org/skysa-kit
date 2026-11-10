import { describe, expect, it } from 'vitest';

import { releaseNotes } from '../scripts/releaseNotes.mjs';

// Changelogs as `changeset version` writes them for packages fixed to one
// version: copied from a run over this repository, not written by hand.
const CLIENT = `# @skysa/client

## 1.0.0

### Major Changes

- 26d4400: A change an app must act on.

  Its second paragraph, with a list:

  - one
  - two

### Patch Changes

- Updated dependencies [26d4400]
  - @skysa/storage@1.0.0
  - @skysa/sync@1.0.0
  - @skysa/protocol@1.0.0

## 0.1.1

### Patch Changes

- Updated dependencies
  - @skysa/sync@0.1.1
  - @skysa/protocol@0.1.1
  - @skysa/storage@0.1.1

## 0.1.0

### Minor Changes

- 2024160: The first release.

### Patch Changes

- Updated dependencies [2024160]
- Updated dependencies
  - @skysa/protocol@0.1.0
`;

const STORAGE = `# @skysa/storage

## 1.0.0

### Minor Changes

- 26d4400: A change an app must act on.

  Its second paragraph, with a list:

  - one
  - two

### Patch Changes

- @skysa/protocol@1.0.0

## 0.1.1

### Patch Changes

- @skysa/protocol@0.1.1

## 0.1.0

### Minor Changes

- 2024160: The first release.

### Patch Changes

- Updated dependencies [2024160]
  - @skysa/protocol@0.1.0
`;

const SYNC = `# @skysa/sync

## 1.0.0

### Patch Changes

- Updated dependencies [26d4400]
  - @skysa/storage@1.0.0

## 0.1.1

### Patch Changes

- 5e6f7a8: A fix in the engine alone.
- @skysa/storage@0.1.1

## 0.1.0

### Minor Changes

- 2024160: The first release.

### Patch Changes

- Updated dependencies [2024160]
  - @skysa/storage@0.1.0
`;

const PROTOCOL = `# @skysa/protocol

## 1.0.0

No changes in this release.

## 0.1.1

No changes in this release.

## 0.1.0

### Minor Changes

- 2024160: The first release.
`;

const ESLINT = `# @skysa/eslint-config

## 1.0.0

No changes in this release.

## 0.1.1

No changes in this release.

## 0.1.0

### Minor Changes

- 2024160: The first release.

### Patch Changes

- @skysa/protocol@0.1.0
`;

const ALL = [
	{ name: '@skysa/client', text: CLIENT },
	{ name: '@skysa/eslint-config', text: ESLINT },
	{ name: '@skysa/protocol', text: PROTOCOL },
	{ name: '@skysa/storage', text: STORAGE },
	{ name: '@skysa/sync', text: SYNC },
];

describe('releaseNotes', () => {
	it('says a change written for every package once, under one heading', () => {
		expect(releaseNotes('0.1.0', ALL)).toBe(
			'## Every package\n\n### Minor Changes\n\n- 2024160: The first release.\n'
		);
	});

	it('leaves out the packages that only moved because the others did', () => {
		expect(releaseNotes('0.1.1', ALL)).toBe(
			'## @skysa/sync\n\n### Patch Changes\n\n- 5e6f7a8: A fix in the engine alone.\n'
		);
	});

	it('keeps a summary whole, its paragraphs and its own list included', () => {
		const entry = [
			'- 26d4400: A change an app must act on.',
			'',
			'  Its second paragraph, with a list:',
			'',
			'  - one',
			'  - two',
		].join('\n');
		expect(releaseNotes('1.0.0', ALL)).toBe(
			`## @skysa/client\n\n### Major Changes\n\n${entry}\n\n## @skysa/storage\n\n### Minor Changes\n\n${entry}\n`
		);
	});

	it('names the packages that share entries, when they are not all of them', () => {
		const shared = ALL.map(({ name, text }) => ({
			name,
			text:
				name === '@skysa/sync'
					? text.replace('- 2024160: The first release.', '- 2024160: Not quite.')
					: text,
		}));
		expect(releaseNotes('0.1.0', shared)).toBe(
			[
				'## @skysa/client, @skysa/eslint-config, @skysa/protocol, @skysa/storage',
				'',
				'### Minor Changes',
				'',
				'- 2024160: The first release.',
				'',
				'## @skysa/sync',
				'',
				'### Minor Changes',
				'',
				'- 2024160: Not quite.',
				'',
			].join('\n')
		);
	});

	it('reads only the version asked for, not one it is the start of', () => {
		const later = `# @skysa/sync\n\n## 0.1.10\n\n### Patch Changes\n\n- A later fix.\n\n${SYNC.split('\n').slice(2).join('\n')}`;
		expect(releaseNotes('0.1.1', [{ name: '@skysa/sync', text: later }])).toBe(
			'## Every package\n\n### Patch Changes\n\n- 5e6f7a8: A fix in the engine alone.\n'
		);
		expect(releaseNotes('0.1.10', [{ name: '@skysa/sync', text: later }])).toContain(
			'- A later fix.'
		);
	});

	it('takes a version heading only where Changesets writes one, not indented in a summary', () => {
		const quoting = SYNC.replace(
			'- 5e6f7a8: A fix in the engine alone.',
			'- 5e6f7a8: A fix in the engine alone.\n\n  ## 0.1.0\n\n  - a line of the summary'
		);
		expect(releaseNotes('0.1.0', [{ name: '@skysa/sync', text: quoting }])).toBe(
			'## Every package\n\n### Minor Changes\n\n- 2024160: The first release.\n'
		);
		expect(releaseNotes('0.1.1', [{ name: '@skysa/sync', text: quoting }])).toContain(
			'  - a line of the summary'
		);
	});

	it('says so when there is nothing to say', () => {
		expect(releaseNotes('9.9.9', ALL)).toBe('No changelog entries for this version.\n');
		expect(releaseNotes('0.1.0', [{ name: '@skysa/sync', text: '' }])).toBe(
			'No changelog entries for this version.\n'
		);
	});
});
