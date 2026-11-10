import { describe, expect, it } from 'vitest';

import { versionOf } from '../scripts/version.mjs';

const at = (version: unknown, dir = 'sync') => ({
	path: `packages/${dir}/package.json`,
	version,
});

describe('versionOf', () => {
	it('is the version every manifest names', () => {
		expect(versionOf([at('0.2.0', 'protocol'), at('0.2.0', 'sync')])).toBe('0.2.0');
	});

	it('refuses packages that disagree, naming both', () => {
		expect(() => versionOf([at('0.2.0', 'protocol'), at('0.3.0', 'sync')])).toThrow(
			'packages/sync/package.json is 0.3.0 but packages/protocol/package.json is 0.2.0.'
		);
	});

	it('refuses a manifest with no version, and no manifests at all', () => {
		expect(() => versionOf([at('0.2.0', 'protocol'), at(undefined, 'sync')])).toThrow(
			'packages/sync/package.json names no version.'
		);
		expect(() => versionOf([])).toThrow('There are no packages to read a version from.');
	});
});
