// What npm would be sent, checked without sending it. Every package is
// packed as npm would receive it, its manifest is read back out of the
// tarball, and every entry it exports is loaded by plain Node from the
// unpacked copies, each with a node_modules of its own holding only what it
// declares, as pnpm would install them for an app. Nothing here talks to a
// registry.
//
// It fails on:
//   - a manifest that is not ready to publish: still `private`, without
//     `publishConfig`'s public access and provenance, or with a repository
//     provenance would not match
//   - a `workspace:` or `catalog:` range pnpm left unreplaced, or a kit
//     package depending on another kit version than its own
//   - an export that leads to a file the tarball does not hold, or to
//     TypeScript source, as the workspace's own exports do; or a built one
//     without its `types`
//   - a file an app reads by its path missing, or a build's leftovers or a
//     test in the tarball
//   - an entry plain Node cannot load, or can load only through a dependency
//     its package does not declare
//
// `pnpm verify` runs it, after `pnpm build`; packing builds again, through each
// package's `prepack`, which finds nothing to do. The release workflow runs it
// with `--keep <dir>`, which keeps the tarballs it checked, if they passed,
// in that directory: those bytes, and no others, are what `publish.mjs` sends.
//
// Plain Node, no dependencies.

import { execFileSync } from 'node:child_process';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = join(import.meta.dirname, '..');
const REPOSITORY = 'https://github.com/skysa-org/skysa-kit.git';
const DEPENDENCY_FIELDS = [
	'dependencies',
	'peerDependencies',
	'optionalDependencies',
	'devDependencies',
];

// What only a Worker's runtime has, stood in for so that the rest of an entry
// still loads in Node: the server's relay extends `DurableObject`.
const WORKER_MODULES = { 'cloudflare:workers': 'export class DurableObject {}' };

// Files an app reads from a package by their path rather than through an
// export: the server's D1 migrations, which the app's wrangler.toml names as
// its `migrations_dir`.
const BY_PATH = new Map([['@skysa/server', /^migrations\/[^/]+\.sql$/u]]);

/**
 * Every file an `exports` map leads to, with the subpath and condition that
 * names it.
 * @param {unknown} exports
 * @returns {{ subpath: string, condition: string, target: string }[]}
 */
export const targetsOf = (exports, subpath = '.', condition = 'default') =>
	typeof exports === 'string'
		? [{ subpath, condition, target: exports }]
		: Object.entries(exports ?? {}).flatMap(([key, value]) =>
				key.startsWith('.') ? targetsOf(value, key) : targetsOf(value, subpath, key)
			);

/**
 * What stops one packed package from being published as it is.
 * @param {{ manifest: Record<string, any>, dir: string, files: string[], byPath?: string[] }} packed
 *   its manifest as the tarball holds it, its folder under packages/, the
 *   files in the tarball, and those it must hold that no export names
 * @returns {string[]}
 */
export const problemsOf = ({ manifest, dir, files, byPath = [] }) => {
	const { version, publishConfig, repository } = manifest;
	const shipped = new Set(files);
	const targets = targetsOf(manifest.exports);
	const typed = new Set(
		targets.filter(({ condition }) => condition === 'types').map(({ subpath }) => subpath)
	);
	return [
		...(manifest.private ? ['is private, so it cannot be published'] : []),
		...(publishConfig?.access === 'public' ? [] : ['needs publishConfig.access "public"']),
		...(publishConfig?.provenance === true ? [] : ['needs publishConfig.provenance']),
		...(repository?.url === REPOSITORY && repository?.directory === `packages/${dir}`
			? []
			: [`needs repository ${REPOSITORY}, directory packages/${dir}: provenance checks it`]),
		...DEPENDENCY_FIELDS.flatMap((field) => Object.entries(manifest[field] ?? {})).flatMap(
			([dep, range]) => [
				...(/^(?:workspace|catalog):/u.test(range)
					? [`${dep} is still "${range}" in the tarball`]
					: []),
				...(dep.startsWith('@skysa/') && range !== version
					? [`${dep} is ${range}, but the kit is released at one version, ${version}`]
					: []),
			]
		),
		...(shipped.has('LICENSE') ? [] : ['has no LICENSE']),
		...byPath
			.filter((file) => !shipped.has(file))
			.map((file) => `does not ship ${file}, which an app reads by its path`),
		...files
			.filter(
				(file) =>
					/\.tsbuildinfo$|\.test\.[cm]?[jt]sx?$/u.test(file) || file.startsWith('tests/')
			)
			.map((file) => `should not publish ${file}`),
		...targets
			.filter(({ target }) => !shipped.has(target.replace(/^\.\//u, '')))
			.map(
				({ subpath, condition, target }) =>
					`exports ${subpath} (${condition}) leads to ${target}, which is not in the tarball`
			),
		...targets
			.filter(({ target }) => /(?<!\.d)\.tsx?$/u.test(target))
			.map(
				({ subpath, condition, target }) =>
					`exports ${subpath} (${condition}) leads to ${target}, TypeScript source: publishConfig.exports leads to dist/`
			),
		...targets
			.filter(
				({ condition, target }) => condition === 'default' && target.startsWith('./dist/')
			)
			.filter(({ subpath }) => !typed.has(subpath))
			.map(({ subpath }) => `exports ${subpath} has no types`),
	];
};

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const filesUnder = (dir) =>
	readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => relative(dir, join(entry.parentPath, entry.name)));

// A command's output is kept, and shown only if it fails: a `prepack` build's
// type error is the reason a pack fails.
const run = (command, args, options) => {
	try {
		return execFileSync(command, args, { encoding: 'utf8', stdio: 'pipe', ...options });
	} catch (error) {
		process.stderr.write(`${error.stdout ?? ''}${error.stderr ?? ''}`);
		throw error;
	}
};

const link = (target, path) => {
	mkdirSync(dirname(path), { recursive: true });
	symlinkSync(target, path, 'dir');
};

// The hooks a child Node loads first, so that what `WORKER_MODULES` names
// resolves to its stand-in and everything else as Node would resolve it.
const HOOKS = `data:text/javascript,${encodeURIComponent(`
	const STOOD_IN = ${JSON.stringify(WORKER_MODULES)};
	export const resolve = (specifier, context, next) =>
		Object.hasOwn(STOOD_IN, specifier)
			? { url: 'data:text/javascript,' + encodeURIComponent(STOOD_IN[specifier]), shortCircuit: true }
			: next(specifier, context);
`)}`;

// Imports every entry, in a child Node whose working directory is the app's,
// and says for each the first line of what it threw, or null.
const LOADING = `
	import { register } from 'node:module';
	const [entries, hooks] = [JSON.parse(process.argv[1]), process.argv[2]];
	register(hooks);
	const results = [];
	for (const entry of entries) {
		try {
			await import(entry);
			results.push([entry, null]);
		} catch (error) {
			results.push([entry, String(error?.message ?? error).split('\\n')[0] || 'it threw, with no message']);
		}
	}
	process.stdout.write(JSON.stringify(results));
`;

const check = (keep) => {
	const scratch = mkdtempSync(join(tmpdir(), 'skysa-pack-'));
	try {
		const tarballs = join(scratch, 'tarballs');
		// Each package, unpacked where its own node_modules can sit beside it.
		const store = join(scratch, 'store');
		// What an app's node_modules would hold: the kit's packages, and nothing
		// else of theirs.
		const app = join(scratch, 'app');
		run('pnpm', ['-r', 'pack', '--pack-destination', tarballs], { cwd: ROOT });

		const workspace = readdirSync(join(ROOT, 'packages'))
			.filter((dir) => existsSync(join(ROOT, 'packages', dir, 'package.json')))
			.map((dir) => ({
				dir,
				name: readJson(join(ROOT, 'packages', dir, 'package.json')).name,
			}));

		const packed = readdirSync(tarballs).map((tarball) => {
			const unpacked = join(scratch, 'unpacked', tarball);
			mkdirSync(unpacked, { recursive: true });
			run('tar', ['xzf', join(tarballs, tarball), '-C', unpacked, '--strip-components=1']);
			const manifest = readJson(join(unpacked, 'package.json'));
			const home = join(store, manifest.name);
			mkdirSync(dirname(home), { recursive: true });
			renameSync(unpacked, home);
			const { dir } = workspace.find(({ name }) => name === manifest.name);
			const pattern = BY_PATH.get(manifest.name);
			const byPath = pattern
				? filesUnder(join(ROOT, 'packages', dir)).filter((file) => pattern.test(file))
				: [];
			return { home, dir, manifest, files: filesUnder(home), byPath };
		});

		// Each package's dependencies and peers, and only those, linked into its
		// own node_modules: a kit package to its unpacked copy, anything else to
		// what the workspace installed for that package. An optional peer the
		// workspace does not have is left out, as an app without it would.
		const unlinked = packed.flatMap(({ home, dir, manifest }) => {
			const optional = manifest.peerDependenciesMeta ?? {};
			return Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }).flatMap(
				(dep) => {
					const installed = join(ROOT, 'packages', dir, 'node_modules', dep);
					if (dep.startsWith('@skysa/')) {
						link(join(store, dep), join(home, 'node_modules', dep));
						return [];
					}
					if (existsSync(installed)) {
						link(realpathSync(installed), join(home, 'node_modules', dep));
						return [];
					}
					return optional[dep]?.optional
						? []
						: [`${manifest.name}: ${dep} is not installed in the workspace`];
				}
			);
		});
		packed.forEach(({ home, manifest }) =>
			link(home, join(app, 'node_modules', manifest.name))
		);

		const entries = packed.flatMap(({ manifest }) =>
			targetsOf(manifest.exports)
				.filter(
					({ condition, target }) => condition === 'default' && /\.m?js$/u.test(target)
				)
				.map(({ subpath }) => manifest.name + subpath.slice(1))
		);
		/** @type {[string, string | null][]} */
		const results = JSON.parse(
			run(
				process.execPath,
				['--input-type=module', '-e', LOADING, JSON.stringify(entries), HOOKS],
				{ cwd: app }
			)
		);

		packed.forEach(({ manifest, files }) =>
			process.stdout.write(`${manifest.name}@${manifest.version}: ${files.length} files\n`)
		);
		const loaded = results.filter(([, error]) => error === null).length;
		process.stdout.write(`${loaded} of ${results.length} entries loaded in Node\n`);

		const problems = [
			...workspace
				.filter(({ name }) => !packed.some(({ manifest }) => manifest.name === name))
				.map(({ name }) => `${name}: was not packed`),
			...packed.flatMap((one) =>
				problemsOf(one).map((problem) => `${one.manifest.name}: ${problem}`)
			),
			...unlinked,
			...results
				.filter(([, error]) => error !== null)
				.map(([entry, error]) => `${entry}: does not load in Node: ${error}`),
		];
		if (keep !== undefined && problems.length === 0) {
			readdirSync(tarballs).forEach((tarball) =>
				copyFileSync(join(tarballs, tarball), join(keep, tarball))
			);
			process.stdout.write(`Kept in ${keep}\n`);
		}
		return problems;
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
};

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const { keep } = parseArgs({ options: { keep: { type: 'string' } } }).values;
	// Empty, so that nothing but what was checked here is ever sent from it.
	if (keep !== undefined) {
		mkdirSync(keep, { recursive: true });
		if (readdirSync(keep).length > 0) {
			throw new Error(`${keep} already holds files; --keep wants an empty directory.`);
		}
	}
	const problems = check(keep);
	if (problems.length > 0) {
		process.stderr.write(
			`\nNot ready to publish:\n${problems.map((problem) => `  - ${problem}`).join('\n')}\n`
		);
		process.exitCode = 1;
	}
}
