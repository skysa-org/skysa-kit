// Whether a pull request may go without the changeset `ci.yml` asks for.
//
// Two shapes may, because neither can answer it, and both are recognized by
// what they change rather than by a branch name anyone could adopt:
//   - the release pull request: `changeset version` bumps every package's
//     version, writes the changelogs, and deletes the changesets it consumed,
//     so its diff has no changeset by construction
//   - a dependency bump, Dependabot's or one by hand: the bot cannot write a
//     changeset, and a rule that turns every dependency pull request red is
//     one people learn to ignore (where a bump is worth a line in the
//     changelog, add one)
// Each changes nothing in a package but its CHANGELOG.md and, in its
// package.json, the version and the dependency ranges. Anything else there —
// exports, files, publishConfig, a peer made optional — changes what ships,
// and is asked for a changeset like a source file is.
//
//   node scripts/changesetExempt.mjs origin/main   # exit 0 if exempt
//
// Plain Node, no dependencies.

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const RANGES = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

// A manifest with what a version or a dependency bump may change taken out.
const withoutVersions = (text) =>
	JSON.stringify(
		Object.fromEntries(
			Object.entries(JSON.parse(text)).filter(
				([key]) => key !== 'version' && !RANGES.includes(key)
			)
		)
	);

/**
 * Why a pull request may go without a changeset, or null if it may not.
 * @param {{ path: string, before: string | null, after: string | null }[]} changes
 *   each file it changes under packages/, as it was and as it is (null where
 *   it did not exist)
 * @returns {string | null}
 */
export const exemption = (changes) => {
	if (changes.length === 0) return null;
	const allowed = changes.every(({ path, before, after }) => {
		if (/(?:^|\/)CHANGELOG\.md$/u.test(path)) return true;
		if (!/(?:^|\/)package\.json$/u.test(path) || before === null || after === null)
			return false;
		return withoutVersions(before) === withoutVersions(after);
	});
	return allowed
		? 'Only versions, changelogs and dependency ranges changed. No changeset needed.'
		: null;
};

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe' });

// A file at a commit, or null where it is not there.
const at = (commit, path) => {
	try {
		return git('show', `${commit}:${path}`);
	} catch {
		return null;
	}
};

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [base] = process.argv.slice(2);
	if (!base) throw new Error('usage: node scripts/changesetExempt.mjs <base ref>');
	// As `git diff base...HEAD` compares: from where the branch left the base.
	const from = git('merge-base', base, 'HEAD').trim();
	const changes = git('diff', '--name-only', `${from}...HEAD`, '--', 'packages')
		.split('\n')
		.filter((path) => path !== '')
		// Only a manifest's contents matter; any other file decides by its name.
		.map((path) =>
			path.endsWith('package.json')
				? { path, before: at(from, path), after: at('HEAD', path) }
				: { path, before: null, after: null }
		);
	const why = exemption(changes);
	if (why === null) process.exitCode = 1;
	else process.stdout.write(`${why}\n`);
}
