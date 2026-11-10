// The one version the packages are at, which the release workflow tags,
// releases and publishes.
//
// The seven are `fixed` in .changeset/config.json, so any of them answers — but
// only while that holds, and a hand-edited `package.json` is exactly how it
// would stop holding without anyone noticing. So every manifest is read, and
// packages that disagree are an error rather than a version.
//
//   node scripts/version.mjs     # prints it, as `0.2.0`
//
// Plain Node, no dependencies.

import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = join(import.meta.dirname, '..');

/**
 * The version every manifest names.
 * @param {{ path: string, version: unknown }[]} manifests
 * @returns {string}
 */
export const versionOf = (manifests) => {
	const [first] = manifests;
	if (first === undefined) throw new Error('There are no packages to read a version from.');
	const unversioned = manifests.find(({ version }) => typeof version !== 'string');
	if (unversioned !== undefined) throw new Error(`${unversioned.path} names no version.`);
	const other = manifests.find(({ version }) => version !== first.version);
	if (other !== undefined) {
		throw new Error(
			`${other.path} is ${other.version} but ${first.path} is ${first.version}. ` +
				'The packages are fixed to one version; nothing is released until they agree.'
		);
	}
	return /** @type {string} */ (first.version);
};

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const manifests = readdirSync(join(ROOT, 'packages'))
		.map((dir) => join('packages', dir, 'package.json'))
		.filter((path) => existsSync(join(ROOT, path)))
		.map((path) => ({
			path,
			version: JSON.parse(readFileSync(join(ROOT, path), 'utf8')).version,
		}));
	try {
		process.stdout.write(`${versionOf(manifests)}\n`);
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
		process.exitCode = 1;
	}
}
