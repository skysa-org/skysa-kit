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
// It stops at the first package it cannot publish, or cannot tell whether npm
// has, so a package is never on npm before what it depends on. Running it
// again finishes the job: what npm has is skipped.
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
 * a prerelease's first identifier (`next` for `0.3.0-next.0`), which npm will
 * not put under `latest` unasked. A release gets none, so npm refuses one lower
 * than a version it already has rather than moving `latest` back to it.
 * @param {string} version
 * @returns {string | null}
 */
export const tagOf = (version) => {
	const pre = /^\d+\.\d+\.\d+-([0-9A-Za-z-]+)/u.exec(version)?.[1];
	if (pre === undefined) return null;
	return /^\d+$/u.test(pre) ? 'next' : pre;
};

/**
 * The tarballs in an order npm can take them: each after every other one it
 * names among its dependencies or peers, and by name where nothing decides.
 * @param {Tarball[]} tarballs
 * @returns {Tarball[]}
 */
export const inOrder = (tarballs) => {
	const names = new Set(tarballs.map(({ manifest }) => manifest.name));
	const needs = ({ manifest }) =>
		Object.keys({
			...manifest.dependencies,
			...manifest.peerDependencies,
			...manifest.optionalDependencies,
		}).filter((dep) => names.has(dep) && dep !== manifest.name);
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
 * Publishes every tarball npm does not have yet, in `inOrder`'s order.
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
	const tag = tagOf(version);
	for (const { file, manifest } of inOrder(tarballs)) {
		const { name } = manifest;
		if (onNpm(npm, name, version)) {
			log(`${name}@${version} is on npm already.`);
			continue;
		}
		const { status } = npm(
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
			throw new Error(`npm did not publish ${name}@${version}; what it said is above.`);
		}
		log(`${name}@${version} is published.`);
	}
};

/** @type {Npm} */
const npm = (args, { show = false } = {}) => {
	const { status, stdout, stderr } = spawnSync('npm', args, {
		encoding: 'utf8',
		stdio: show ? 'inherit' : 'pipe',
	});
	return { status, stdout: stdout ?? '', stderr: stderr ?? '' };
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
