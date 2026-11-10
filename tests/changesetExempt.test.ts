import { describe, expect, it } from 'vitest';

import { exemption } from '../scripts/changesetExempt.mjs';

const EXEMPT = 'Only versions, changelogs and dependency ranges changed. No changeset needed.';

interface Manifest {
	name: string;
	version: string;
	files: string[];
	exports: Record<string, string>;
	publishConfig: { access: string; provenance: boolean };
	dependencies: Record<string, string>;
	peerDependencies: Record<string, string>;
	peerDependenciesMeta: Record<string, { optional: boolean }>;
}

const manifest = (change: (m: Manifest) => void = () => undefined) => {
	const m: Manifest = {
		name: '@skysa/sync',
		version: '0.1.0',
		files: ['dist', 'src'],
		exports: { '.': './src/index.ts' },
		publishConfig: { access: 'public', provenance: true },
		dependencies: { '@skysa/storage': 'workspace:*', zod: 'catalog:' },
		peerDependencies: { vitest: 'catalog:' },
		peerDependenciesMeta: { vitest: { optional: true } },
	};
	change(m);
	return `${JSON.stringify(m, null, '\t')}\n`;
};

const changed = (change: (m: Manifest) => void) => ({
	path: 'packages/sync/package.json',
	before: manifest(),
	after: manifest(change),
});

describe('exemption', () => {
	it('lets the release pull request through: versions and changelogs', () => {
		expect(
			exemption([
				changed((m) => (m.version = '0.2.0')),
				{ path: 'packages/sync/CHANGELOG.md', before: null, after: '# @skysa/sync\n' },
			])
		).toBe(EXEMPT);
	});

	it('lets a dependency bump through, a peer range included', () => {
		expect(exemption([changed((m) => (m.dependencies.zod = '^4.8.0'))])).toBe(EXEMPT);
		expect(exemption([changed((m) => (m.peerDependencies.vitest = '^6.0.0'))])).toBe(EXEMPT);
	});

	it('asks for a changeset when a manifest changes what ships', () => {
		expect(
			exemption([changed((m) => (m.exports['./testing'] = './tests/testing.ts'))])
		).toBeNull();
		expect(exemption([changed((m) => (m.files = ['dist']))])).toBeNull();
		expect(exemption([changed((m) => (m.publishConfig.provenance = false))])).toBeNull();
		expect(
			exemption([changed((m) => (m.peerDependenciesMeta = { vitest: { optional: false } }))])
		).toBeNull();
	});

	it('asks for one when anything else in a package changes, or a package comes or goes', () => {
		expect(
			exemption([
				changed((m) => (m.version = '0.2.0')),
				{ path: 'packages/sync/src/engine.ts', before: 'a', after: 'b' },
			])
		).toBeNull();
		expect(
			exemption([{ path: 'packages/new/package.json', before: null, after: manifest() }])
		).toBeNull();
		expect(
			exemption([{ path: 'packages/sync/package.json', before: manifest(), after: null }])
		).toBeNull();
	});

	it('leaves a pull request that changes no package to `changeset status`', () => {
		expect(exemption([])).toBeNull();
	});
});
