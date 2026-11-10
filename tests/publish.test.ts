import { describe, expect, it } from 'vitest';

import { inOrder, onNpm, publishAll, tagOf } from '../scripts/publish.mjs';

interface Tarball {
	file: string;
	manifest: {
		name: string;
		version: string;
		dependencies?: Record<string, string>;
		peerDependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
	};
}

const tarball = (
	name: string,
	version: string,
	deps: Partial<Omit<Tarball['manifest'], 'name' | 'version'>> = {}
): Tarball => ({
	file: `/t/${name.replace('@skysa/', 'skysa-')}-${version}.tgz`,
	manifest: { name, version, ...deps },
});

// The kit's shape, listed as a directory would list its tarballs: by name, so
// that what depends on the others comes before them.
const kit = (version: string) => [
	tarball('@skysa/client', version, {
		dependencies: { '@skysa/sync': version },
		devDependencies: { '@skysa/eslint-config': version },
	}),
	tarball('@skysa/eslint-config', version),
	tarball('@skysa/protocol', version, { devDependencies: { '@skysa/eslint-config': version } }),
	tarball('@skysa/storage', version, { dependencies: { '@skysa/protocol': version } }),
	tarball('@skysa/sync', version, {
		dependencies: { '@skysa/storage': version },
		peerDependencies: { vitest: '^5.0.3' },
	}),
];

const E404 = JSON.stringify({ error: { code: 'E404', summary: 'Not Found' } });

// npm as the registry answers it: what it has, and what each publish does.
const registry = (
	has: string[],
	{ failing = [], viewing = {} }: { failing?: string[]; viewing?: Record<string, string> } = {}
) => {
	const calls: string[][] = [];
	const npm = (args: string[]) => {
		calls.push(args);
		const [command = '', spec = ''] = args;
		if (command === 'view') {
			const failure = viewing[spec];
			if (failure !== undefined) return { status: 1, stdout: '', stderr: failure };
			const version = spec.slice(spec.lastIndexOf('@') + 1);
			return has.includes(spec)
				? { status: 0, stdout: JSON.stringify(version), stderr: '' }
				: { status: 1, stdout: E404, stderr: 'npm error code E404' };
		}
		const failed = failing.some((name) => spec.includes(name));
		return { status: failed ? 1 : 0, stdout: '', stderr: '' };
	};
	const published = () =>
		calls.filter(([command]) => command === 'publish').map(([, file]) => file);
	return { npm, calls, published };
};

const run = (tarballs: Tarball[], version: string, npm: ReturnType<typeof registry>['npm']) => {
	const lines: string[] = [];
	publishAll({ tarballs, version, npm, log: (line) => lines.push(line) });
	return lines;
};

describe('tagOf', () => {
	it('leaves a release to npm, and puts every prerelease under next', () => {
		expect(tagOf('0.2.0')).toBeNull();
		expect(tagOf('1.0.0+build.5')).toBeNull();
		expect(tagOf('0.3.0-next.0')).toBe('next');
		expect(tagOf('1.0.0-rc.2')).toBe('next');
		expect(tagOf('1.0.0-latest.0')).toBe('next');
		expect(tagOf('1.0.0-x')).toBe('next');
		expect(tagOf('1.0.0-0')).toBe('next');
	});
});

describe('inOrder', () => {
	it('puts each package after what it depends on, and by name otherwise', () => {
		expect(inOrder(kit('0.2.0')).map(({ manifest }) => manifest.name)).toEqual([
			'@skysa/eslint-config',
			'@skysa/protocol',
			'@skysa/storage',
			'@skysa/sync',
			'@skysa/client',
		]);
	});

	it('refuses packages that depend on each other', () => {
		expect(() =>
			inOrder([
				tarball('@skysa/a', '1.0.0', { dependencies: { '@skysa/b': '1.0.0' } }),
				tarball('@skysa/b', '1.0.0', { peerDependencies: { '@skysa/a': '1.0.0' } }),
			])
		).toThrow('These depend on each other, so none can go first: @skysa/a, @skysa/b.');
	});
});

describe('onNpm', () => {
	it('says yes only when npm names the version, and no only on its "not found"', () => {
		const { npm } = registry(['@skysa/sync@0.1.0']);
		expect(onNpm(npm, '@skysa/sync', '0.1.0')).toBe(true);
		expect(onNpm(npm, '@skysa/sync', '0.2.0')).toBe(false);
	});

	it('fails on anything else, rather than guessing', () => {
		const { npm } = registry([], {
			viewing: { '@skysa/sync@0.2.0': 'npm error code ECONNRESET' },
		});
		expect(() => onNpm(npm, '@skysa/sync', '0.2.0')).toThrow(
			'Could not tell whether npm has @skysa/sync@0.2.0:\nnpm error code ECONNRESET'
		);
		const empty = () => ({ status: 0, stdout: '', stderr: '' });
		expect(() => onNpm(empty, '@skysa/sync', '0.2.0')).toThrow('Could not tell');
	});
});

describe('publishAll', () => {
	it('publishes every package, dependencies first, with provenance and public access', () => {
		const { npm, calls, published } = registry([]);
		const lines = run(kit('0.2.0'), '0.2.0', npm);
		expect(published()).toEqual([
			'/t/skysa-eslint-config-0.2.0.tgz',
			'/t/skysa-protocol-0.2.0.tgz',
			'/t/skysa-storage-0.2.0.tgz',
			'/t/skysa-sync-0.2.0.tgz',
			'/t/skysa-client-0.2.0.tgz',
		]);
		expect(calls.find(([command]) => command === 'publish')).toEqual([
			'publish',
			'/t/skysa-eslint-config-0.2.0.tgz',
			'--access',
			'public',
			'--provenance',
		]);
		expect(lines.at(-1)).toBe('@skysa/client@0.2.0 is published.');
	});

	it('skips what npm has, so a second run finishes what a first one began', () => {
		const { npm, published } = registry([
			'@skysa/eslint-config@0.2.0',
			'@skysa/protocol@0.2.0',
		]);
		const lines = run(kit('0.2.0'), '0.2.0', npm);
		expect(published()).toEqual([
			'/t/skysa-storage-0.2.0.tgz',
			'/t/skysa-sync-0.2.0.tgz',
			'/t/skysa-client-0.2.0.tgz',
		]);
		expect(lines.slice(0, 2)).toEqual([
			'@skysa/eslint-config@0.2.0 is on npm already.',
			'@skysa/protocol@0.2.0 is on npm already.',
		]);
	});

	it('stops at a failed publish, before anything that depends on it', () => {
		const { npm, published } = registry([], { failing: ['skysa-storage'] });
		expect(() => run(kit('0.2.0'), '0.2.0', npm)).toThrow(
			'npm did not publish @skysa/storage@0.2.0; what it said is above.'
		);
		expect(published()).toEqual([
			'/t/skysa-eslint-config-0.2.0.tgz',
			'/t/skysa-protocol-0.2.0.tgz',
			'/t/skysa-storage-0.2.0.tgz',
		]);
	});

	it('publishes nothing when it cannot tell whether npm has one of them', () => {
		const { npm, published } = registry([], {
			viewing: { '@skysa/client@0.2.0': 'npm error code E503' },
		});
		expect(() => run(kit('0.2.0'), '0.2.0', npm)).toThrow('Could not tell');
		expect(published()).toEqual([]);
	});

	it('puts a prerelease under its tag', () => {
		const { npm, calls } = registry([]);
		run([tarball('@skysa/protocol', '0.3.0-next.1')], '0.3.0-next.1', npm);
		expect(calls.at(-1)).toEqual([
			'publish',
			'/t/skysa-protocol-0.3.0-next.1.tgz',
			'--access',
			'public',
			'--provenance',
			'--tag',
			'next',
		]);
	});

	it('refuses a set that leaves out a package of its scope that one depends on', () => {
		const { npm, calls } = registry([]);
		const withoutStorage = kit('0.2.0').filter(
			({ manifest }) => manifest.name !== '@skysa/storage'
		);
		expect(() => run(withoutStorage, '0.2.0', npm)).toThrow(
			'Not among the tarballs: @skysa/sync depends on @skysa/storage.'
		);
		expect(calls).toEqual([]);
	});

	it('refuses tarballs at another version, or none at all, before asking npm anything', () => {
		const { npm, calls } = registry([]);
		expect(() =>
			run([...kit('0.2.0'), tarball('@skysa/server', '0.1.0')], '0.2.0', npm)
		).toThrow('Released at 0.2.0, but these are not: @skysa/server@0.1.0.');
		expect(() => run([], '0.2.0', npm)).toThrow('There is nothing to publish.');
		expect(calls).toEqual([]);
	});
});
