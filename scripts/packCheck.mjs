// What `pnpm publish` would send, checked without sending it. Every package is
// packed as npm would receive it; its manifest is read back out of the
// tarball; and every entry it exports is loaded by plain Node from the
// unpacked copies, side by side in a node_modules of their own, the way an app
// would install them. Nothing here talks to a registry.
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
//   - a build's leftovers or a test in the tarball
//   - an entry plain Node cannot load, other than those `NOT_IN_NODE` names
//
// `pnpm verify` runs it, after `pnpm build`; packing builds again, through each
// package's `prepack`, which finds nothing to do.
//
// Plain Node, no dependencies.

import { execFileSync } from 'node:child_process';
import {
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

const ROOT = join(import.meta.dirname, '..');
const REPOSITORY = 'https://github.com/skysa-org/skysa-kit.git';
const DEPENDENCY_FIELDS = [
	'dependencies',
	'peerDependencies',
	'optionalDependencies',
	'devDependencies',
];

// Entries plain Node cannot load, and why. Each is still checked for its files;
// one that starts loading is reported, so this cannot go stale.
const NOT_IN_NODE = new Map([
	[
		'@skysa/server/relay',
		'its Durable Object extends `cloudflare:workers`, which only a Worker has',
	],
]);

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const filesUnder = (dir) =>
	readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => relative(dir, join(entry.parentPath, entry.name)));

// Every file an `exports` map leads to, with the subpath and condition that
// names it.
const targetsOf = (exports, subpath = '.', condition = 'default') =>
	typeof exports === 'string'
		? [{ subpath, condition, target: exports }]
		: Object.entries(exports).flatMap(([key, value]) =>
				key.startsWith('.') ? targetsOf(value, key) : targetsOf(value, subpath, key)
			);

const workspace = readdirSync(join(ROOT, 'packages'))
	.filter((dir) => existsSync(join(ROOT, 'packages', dir, 'package.json')))
	.map((dir) => ({ dir, manifest: readJson(join(ROOT, 'packages', dir, 'package.json')) }));

const scratch = mkdtempSync(join(tmpdir(), 'skysa-pack-'));
const problems = [];
const problem = (name, text) => problems.push(`${name}: ${text}`);

try {
	const tarballs = join(scratch, 'tarballs');
	const modules = join(scratch, 'node_modules');
	execFileSync('pnpm', ['-r', 'pack', '--pack-destination', tarballs], {
		cwd: ROOT,
		stdio: 'ignore',
	});

	const packed = readdirSync(tarballs).map((tarball) => {
		const unpacked = join(scratch, 'unpacked', tarball);
		mkdirSync(unpacked, { recursive: true });
		execFileSync('tar', [
			'xzf',
			join(tarballs, tarball),
			'-C',
			unpacked,
			'--strip-components=1',
		]);
		const manifest = readJson(join(unpacked, 'package.json'));
		const home = join(modules, manifest.name);
		mkdirSync(dirname(home), { recursive: true });
		renameSync(unpacked, home);
		return { home, manifest, files: filesUnder(home) };
	});

	workspace
		.filter(({ manifest }) => !packed.some((p) => p.manifest.name === manifest.name))
		.forEach(({ manifest }) => problem(manifest.name, 'was not packed'));

	packed.forEach(({ manifest, files }) => {
		const { name, version } = manifest;
		const { dir } = workspace.find((w) => w.manifest.name === name);
		if (manifest.private) problem(name, 'is private, so it cannot be published');
		if (manifest.publishConfig?.access !== 'public')
			problem(name, 'needs publishConfig.access "public"');
		if (manifest.publishConfig?.provenance !== true)
			problem(name, 'needs publishConfig.provenance');
		if (
			manifest.repository?.url !== REPOSITORY ||
			manifest.repository?.directory !== `packages/${dir}`
		) {
			problem(
				name,
				`needs repository ${REPOSITORY}, directory packages/${dir}: provenance checks it`
			);
		}
		DEPENDENCY_FIELDS.flatMap((field) => Object.entries(manifest[field] ?? {})).forEach(
			([dep, range]) => {
				if (/^(workspace|catalog):/u.test(range))
					problem(name, `${dep} is still "${range}" in the tarball`);
				if (dep.startsWith('@skysa/') && range !== version) {
					problem(
						name,
						`${dep} is ${range}, but the kit is released at one version, ${version}`
					);
				}
			}
		);
		if (!files.includes('LICENSE')) problem(name, 'has no LICENSE');
		files
			.filter(
				(file) =>
					/\.tsbuildinfo$|\.test\.[cm]?[jt]sx?$/u.test(file) || file.startsWith('tests/')
			)
			.forEach((file) => problem(name, `should not publish ${file}`));
		const targets = targetsOf(manifest.exports ?? {});
		targets
			.filter(({ target }) => !files.includes(target.replace(/^\.\//u, '')))
			.forEach(({ subpath, condition, target }) =>
				problem(
					name,
					`exports ${subpath} (${condition}) leads to ${target}, which is not in the tarball`
				)
			);
		targets
			.filter(
				({ condition, target }) => condition === 'default' && target.startsWith('./dist/')
			)
			.filter(
				({ subpath }) =>
					!targets.some((t) => t.subpath === subpath && t.condition === 'types')
			)
			.forEach(({ subpath }) => problem(name, `exports ${subpath} has no types`));
		targets
			.filter(({ target }) => /(?<!\.d)\.tsx?$/u.test(target))
			.forEach(({ subpath, condition, target }) =>
				problem(
					name,
					`exports ${subpath} (${condition}) leads to ${target}, TypeScript source: publishConfig.exports leads to dist/`
				)
			);
	});

	// What the tarballs depend on, from the workspace's own install: the unpacked
	// copies find them as an app's would, by walking up to this node_modules.
	packed.forEach(({ manifest }) => {
		const { dir } = workspace.find((w) => w.manifest.name === manifest.name);
		Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })
			.filter((dep) => !dep.startsWith('@skysa/') && !existsSync(join(modules, dep)))
			.forEach((dep) => {
				const installed = join(ROOT, 'packages', dir, 'node_modules', dep);
				if (!existsSync(installed))
					return problem(manifest.name, `${dep} is not installed in the workspace`);
				mkdirSync(dirname(join(modules, dep)), { recursive: true });
				symlinkSync(realpathSync(installed), join(modules, dep), 'dir');
			});
	});

	const entries = packed.flatMap(({ manifest }) =>
		targetsOf(manifest.exports ?? {})
			.filter(({ condition, target }) => condition === 'default' && /\.m?js$/u.test(target))
			.map(({ subpath }) => manifest.name + subpath.slice(1))
	);
	const loading = `
		const results = [];
		for (const entry of JSON.parse(process.argv[1])) {
			try {
				await import(entry);
				results.push([entry, null]);
			} catch (error) {
				results.push([entry, String(error?.message ?? error).split('\\n')[0]]);
			}
		}
		process.stdout.write(JSON.stringify(results));
	`;
	const results = JSON.parse(
		execFileSync(
			process.execPath,
			['--input-type=module', '-e', loading, JSON.stringify(entries)],
			{
				cwd: scratch,
				encoding: 'utf8',
			}
		)
	);
	results.forEach(([entry, error]) => {
		const why = NOT_IN_NODE.get(entry);
		if (error && !why) problem(entry, `does not load in Node: ${error}`);
		if (!error && why)
			problem(entry, `loads in Node now; take it out of NOT_IN_NODE ("${why}")`);
	});

	packed.forEach(({ manifest, files }) =>
		process.stdout.write(`${manifest.name}@${manifest.version}: ${files.length} files\n`)
	);
	process.stdout.write(
		`${results.length - NOT_IN_NODE.size} entries load in Node; ${NOT_IN_NODE.size} only in a Worker\n`
	);
} finally {
	rmSync(scratch, { recursive: true, force: true });
}

if (problems.length > 0) {
	process.stderr.write(
		`\nNot ready to publish:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`
	);
	process.exitCode = 1;
}
