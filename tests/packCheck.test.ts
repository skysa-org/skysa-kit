import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { keep, problemsOf, readyToKeep, targetsOf } from '../scripts/packCheck.mjs';

interface Manifest {
	name: string;
	version: string;
	private?: boolean;
	license: string;
	repository: { type: string; url: string; directory: string };
	type: string;
	exports: Record<string, { types?: string; default: string }>;
	publishConfig?: { access: string; provenance: boolean };
	dependencies: Record<string, string>;
	peerDependencies: Record<string, string>;
	devDependencies: Record<string, string>;
}

interface Packed {
	manifest: Manifest;
	dir: string;
	files: string[];
}

// A package as `pnpm pack` hands it over: the manifest with `publishConfig`'s
// exports applied and the workspace's ranges replaced, and the tarball's files.
const manifest = (): Manifest => ({
	name: '@skysa/sync',
	version: '0.2.0',
	license: 'AGPL-3.0-only',
	repository: {
		type: 'git',
		url: 'https://github.com/skysa-org/skysa-kit.git',
		directory: 'packages/sync',
	},
	type: 'module',
	exports: {
		'.': { types: './dist/src/index.d.ts', default: './dist/src/index.js' },
		'./testing': { types: './dist/tests/testing.d.ts', default: './dist/tests/testing.js' },
	},
	publishConfig: { access: 'public', provenance: true },
	dependencies: { '@skysa/storage': '0.2.0' },
	peerDependencies: { vitest: '^5.0.3' },
	devDependencies: { '@skysa/eslint-config': '0.2.0', vitest: '^5.0.3' },
});
const FILES = [
	'LICENSE',
	'package.json',
	'dist/src/index.js',
	'dist/src/index.d.ts',
	'dist/tests/testing.js',
	'dist/tests/testing.d.ts',
	'src/index.ts',
];
const ready: Packed = { manifest: manifest(), dir: 'sync', files: FILES };

const problems = (change: (packed: Packed) => void) => {
	const packed: Packed = { manifest: manifest(), dir: 'sync', files: [...FILES] };
	change(packed);
	return problemsOf(packed);
};

describe('targetsOf', () => {
	it('finds every file an exports map leads to, by subpath and condition', () => {
		expect(
			targetsOf({
				'.': { types: './a.d.ts', default: './a.js' },
				'./budget': './budget.mjs',
			})
		).toEqual([
			{ subpath: '.', condition: 'types', target: './a.d.ts' },
			{ subpath: '.', condition: 'default', target: './a.js' },
			{ subpath: './budget', condition: 'default', target: './budget.mjs' },
		]);
		expect(targetsOf('./index.js')).toEqual([
			{ subpath: '.', condition: 'default', target: './index.js' },
		]);
		expect(targetsOf(undefined)).toEqual([]);
	});
});

describe('problemsOf', () => {
	it('passes a package that is ready', () => {
		expect(problemsOf(ready)).toEqual([]);
	});

	it('refuses a manifest that is not ready to publish', () => {
		expect(problems(({ manifest }) => (manifest.private = true))).toEqual([
			'is private, so it cannot be published',
		]);
		expect(
			problems(
				({ manifest }) =>
					(manifest.publishConfig = { access: 'restricted', provenance: true })
			)
		).toEqual(['needs publishConfig.access "public"']);
		expect(
			problems(({ manifest }) => {
				delete manifest.publishConfig;
			})
		).toEqual(['needs publishConfig.access "public"', 'needs publishConfig.provenance']);
	});

	it('holds the repository to the one provenance will check', () => {
		const wanted =
			'needs repository https://github.com/skysa-org/skysa-kit.git, directory packages/sync: provenance checks it';
		expect(
			problems(({ manifest }) => (manifest.repository.directory = 'packages/store'))
		).toEqual([wanted]);
		expect(
			problems(({ manifest }) => (manifest.repository.url = 'https://github.com/a/fork.git'))
		).toEqual([wanted]);
	});

	it('refuses a range pnpm left unreplaced, or another kit version', () => {
		expect(
			problems(({ manifest }) => (manifest.dependencies['@skysa/storage'] = 'workspace:*'))
		).toEqual([
			'@skysa/storage is still "workspace:*" in the tarball',
			'@skysa/storage is workspace:*, but the kit is released at one version, 0.2.0',
		]);
		expect(problems(({ manifest }) => (manifest.peerDependencies.vitest = 'catalog:'))).toEqual(
			['vitest is still "catalog:" in the tarball']
		);
		expect(
			problems(({ manifest }) => (manifest.dependencies['@skysa/storage'] = '^0.2.0'))
		).toEqual(['@skysa/storage is ^0.2.0, but the kit is released at one version, 0.2.0']);
	});

	it('refuses what should not be published, and wants what must be', () => {
		expect(
			problems(({ files }) =>
				files.push(
					'dist/tsconfig.build.tsbuildinfo',
					'tests/engine.test.ts',
					'tests/kit/world.ts'
				)
			)
		).toEqual([
			'should not publish dist/tsconfig.build.tsbuildinfo',
			'should not publish tests/engine.test.ts',
			'should not publish tests/kit/world.ts',
		]);
		expect(problems(({ files }) => files.splice(files.indexOf('LICENSE'), 1))).toEqual([
			'has no LICENSE',
		]);
		expect(
			problemsOf({ ...ready, byPath: ['migrations/0000_init.sql'] }).map((p) => p)
		).toEqual(['does not ship migrations/0000_init.sql, which an app reads by its path']);
		expect(
			problemsOf({
				...ready,
				files: [...FILES, 'migrations/0000_init.sql'],
				byPath: ['migrations/0000_init.sql'],
			})
		).toEqual([]);
	});

	it('follows every export to a built file in the tarball, with its types', () => {
		expect(
			problems(({ files }) => files.splice(files.indexOf('dist/tests/testing.js'), 1))
		).toEqual([
			'exports ./testing (default) leads to ./dist/tests/testing.js, which is not in the tarball',
		]);
		expect(
			problems(({ manifest }) => (manifest.exports['.'] = { default: './dist/src/index.js' }))
		).toEqual(['exports . has no types']);
		expect(
			problems(
				({ manifest }) =>
					(manifest.exports['.'] = { types: './src/index.ts', default: './src/index.ts' })
			)
		).toEqual([
			'exports . (types) leads to ./src/index.ts, TypeScript source: publishConfig.exports leads to dist/',
			'exports . (default) leads to ./src/index.ts, TypeScript source: publishConfig.exports leads to dist/',
		]);
	});

	it('leaves a plain JavaScript or JSON export without types alone', () => {
		expect(
			problemsOf({
				...ready,
				manifest: {
					...manifest(),
					exports: { '.': './index.js', './budget': './scripts/budget.mjs' },
				},
				files: ['LICENSE', 'package.json', 'index.js', 'scripts/budget.mjs'],
			})
		).toEqual([]);
	});
});

describe('keeping the tarballs', () => {
	const scratch = () => mkdtempSync(join(tmpdir(), 'skysa-keep-'));

	it('keeps every tarball when the check found nothing', () => {
		const [from, to] = [scratch(), join(scratch(), 'kept')];
		writeFileSync(join(from, 'skysa-sync-0.2.0.tgz'), 'sync');
		writeFileSync(join(from, 'skysa-storage-0.2.0.tgz'), 'storage');
		readyToKeep(to);
		expect(keep({ from, to, problems: [] })).toBe(true);
		expect(readdirSync(to).sort()).toEqual(['skysa-storage-0.2.0.tgz', 'skysa-sync-0.2.0.tgz']);
		expect(readFileSync(join(to, 'skysa-sync-0.2.0.tgz'), 'utf8')).toBe('sync');
	});

	it('keeps none of them when it found anything', () => {
		const [from, to] = [scratch(), scratch()];
		writeFileSync(join(from, 'skysa-sync-0.2.0.tgz'), 'sync');
		expect(keep({ from, to, problems: ['@skysa/sync: has no LICENSE'] })).toBe(false);
		expect(readdirSync(to)).toEqual([]);
	});

	it('refuses a directory that already holds something', () => {
		const to = scratch();
		writeFileSync(join(to, 'skysa-sync-0.1.0.tgz'), 'stale');
		expect(() => readyToKeep(to)).toThrow(`${to} already holds files`);
	});
});
