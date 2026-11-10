// Sends npm the tarballs `packCheck.mjs --keep` checked and kept: each package
// npm does not have at the released version yet, dependencies before what
// depends on them.
//
//   node scripts/publish.mjs <dir> <version>
//
// The release workflow's `publish` job runs it, in a job that holds the
// credential to publish and runs nothing else: not pnpm, and none of the
// workspace's dependencies, which the `pack` job installed and built with.
// npm signs in through trusted publishing where a package has it, and with
// the token in `NODE_AUTH_TOKEN` otherwise.
//
// It asks npm about every package before it publishes any, and stops at the
// first one it cannot publish, so a package is never on npm before what it
// depends on. Running it again finishes the job: what npm has is skipped.
//
// Plain Node, no dependencies.

import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** @typedef {{ name: string, version: string, dependencies?: Record<string, string>, peerDependencies?: Record<string, string>, optionalDependencies?: Record<string, string> }} Manifest */
/** @typedef {{ file: string, manifest: Manifest }} Tarball */
/** @typedef {(args: string[], options?: { show?: boolean }) => { status: number | null, stdout: string, stderr: string }} Npm */

/**
 * The dist-tag a version goes out under, when it is not npm's own `latest`:
 * `next`, for any prerelease, which npm will not put under `latest` unasked.
 * One name rather than the prerelease's own (`beta` in `1.0.0-beta.2`), which
 * could be `latest` itself or a name npm refuses as a version range (`x`).
 * A release gets none, so npm refuses one lower than a version it already has
 * rather than moving `latest` back to it.
 * @param {string} version
 * @returns {string | null}
 */
export const tagOf = (version) => (/^\d+\.\d+\.\d+-/u.test(version) ? 'next' : null);

const dependenciesOf = (/** @type {Manifest} */ manifest) =>
	Object.keys({
		...manifest.dependencies,
		...manifest.peerDependencies,
		...manifest.optionalDependencies,
	});

/**
 * The tarballs in an order npm can take them: each after every other one it
 * names among its dependencies or peers, and by name where nothing decides.
 * @param {Tarball[]} tarballs
 * @returns {Tarball[]}
 */
export const inOrder = (tarballs) => {
	const names = new Set(tarballs.map(({ manifest }) => manifest.name));
	const needs = ({ manifest }) =>
		dependenciesOf(manifest).filter((dep) => names.has(dep) && dep !== manifest.name);
	const left = [...tarballs].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
	const sent = new Set();
	const ordered = [];
	while (left.length > 0) {
		const next = left.findIndex((tarball) => needs(tarball).every((dep) => sent.has(dep)));
		if (next === -1) {
			const stuck = left.map(({ manifest }) => manifest.name).join(', ');
			throw new Error(`These depend on each other, so none can go first: ${stuck}.`);
		}
		const [tarball] = left.splice(next, 1);
		sent.add(tarball.manifest.name);
		ordered.push(tarball);
	}
	return ordered;
};

/**
 * Whether npm has this version. Only npm's own "not found" is a no: anything
 * else it says, the network failing included, is an error, since a wrong yes
 * leaves a version unpublished and a wrong no publishes over one, which npm
 * refuses.
 * @param {Npm} npm
 * @param {string} name
 * @param {string} version
 */
export const onNpm = (npm, name, version) => {
	const { status, stdout, stderr } = npm(['view', `${name}@${version}`, 'version', '--json']);
	let answer;
	try {
		answer = JSON.parse(stdout);
	} catch {
		answer = undefined;
	}
	if (status === 0 && answer === version) return true;
	if (status !== 0 && answer?.error?.code === 'E404') return false;
	throw new Error(
		`Could not tell whether npm has ${name}@${version}:\n${(stderr || stdout).trim()}`
	);
};

/**
 * Publishes every tarball npm does not have yet, in `inOrder`'s order. It
 * refuses tarballs at another version than the release's, and any set that
 * leaves out a package of the same scope that one of them depends on: the kit
 * is released whole, so that one would be published without what it needs.
 * @param {{ tarballs: Tarball[], version: string, npm: Npm, log: (line: string) => void }} run
 *   the tarballs, the version they were released at, how npm is run, and
 *   where each step is told
 */
export const publishAll = ({ tarballs, version, npm, log }) => {
	if (tarballs.length === 0) throw new Error('There is nothing to publish.');
	const astray = tarballs.filter(({ manifest }) => manifest.version !== version);
	if (astray.length > 0) {
		const which = astray.map(({ manifest }) => `${manifest.name}@${manifest.version}`);
		throw new Error(`Released at ${version}, but these are not: ${which.join(', ')}.`);
	}
	const names = new Set(tarballs.map(({ manifest }) => manifest.name));
	const missing = tarballs.flatMap(({ manifest }) => {
		const scope = manifest.name.startsWith('@') ? `${manifest.name.split('/')[0]}/` : null;
		return dependenciesOf(manifest)
			.filter((dep) => scope !== null && dep.startsWith(scope) && !names.has(dep))
			.map((dep) => `${manifest.name} depends on ${dep}`);
	});
	if (missing.length > 0) {
		throw new Error(`Not among the tarballs: ${missing.join(', ')}.`);
	}
	const tag = tagOf(version);
	const ordered = inOrder(tarballs).map((tarball) => ({
		...tarball,
		has: onNpm(npm, tarball.manifest.name, version),
	}));
	for (const { file, manifest, has } of ordered) {
		const { name } = manifest;
		if (has) {
			log(`${name}@${version} is on npm already.`);
			continue;
		}
		const { status, stderr } = npm(
			[
				'publish',
				file,
				'--access',
				'public',
				'--provenance',
				...(tag === null ? [] : ['--tag', tag]),
			],
			{ show: true }
		);
		if (status !== 0) {
			throw new Error(
				`npm did not publish ${name}@${version}; what it said is above.${stderr ? `\n${stderr.trim()}` : ''}`
			);
		}
		log(`${name}@${version} is published.`);
	}
};

// npm, with what it printed; or, if it could not be run at all, why not, as
// what it printed to stderr, so that the failure says so.
/** @type {Npm} */
const npm = (args, { show = false } = {}) => {
	const { status, stdout, stderr, error } = spawnSync('npm', args, {
		encoding: 'utf8',
		stdio: show ? 'inherit' : 'pipe',
	});
	return {
		status,
		stdout: stdout ?? '',
		stderr: `${stderr ?? ''}${error ? `npm could not be run: ${error.message}\n` : ''}`,
	};
};

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [dir, version] = process.argv.slice(2);
	if (!dir || !version) throw new Error('Usage: node scripts/publish.mjs <dir> <version>');
	const tarballs = readdirSync(dir)
		.filter((file) => file.endsWith('.tgz'))
		.map((file) => ({
			file: join(dir, file),
			manifest: JSON.parse(
				execFileSync('tar', ['xzOf', join(dir, file), 'package/package.json'], {
					encoding: 'utf8',
				})
			),
		}));
	try {
		publishAll({ tarballs, version, npm, log: (line) => process.stdout.write(`${line}\n`) });
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
		process.exitCode = 1;
	}
}
