// A version's release notes, from what Changesets wrote for it into each
// package's CHANGELOG.md. `.github/workflows/release.yml` hands them to the
// GitHub release it creates.
//
// What a package says of its own, said once. Dropped are a package's
// dependency bumps, in either shape Changesets writes them (`- @skysa/sync@1.2.0`
// alone, or `- Updated dependencies [abc1234]` over a list of them), and the
// "No changes in this release." a package gets when it moved only because the
// others did: in packages fixed to one version, that is most of them on most
// releases. Packages whose entries are the same are listed together under one
// heading, so a change written for all seven is not told seven times.
//
//   node scripts/releaseNotes.mjs 0.2.0 > notes.md
//
// Plain Node, no dependencies.

import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEPENDENCY_BUMP = /^- (?:@skysa\/[a-z-]+@\S+|Updated dependencies(?: \[[^\]]*\])?)$/u;

// The lines under `## <version>`, up to the next version's heading. A summary's
// own lines are indented under its bullet, so a heading at the start of a line
// is Changesets', and only one that starts with a digit is another version.
const sectionOf = (version, text) => {
	const lines = text.split('\n');
	const start = lines.findIndex((line) => line.trimEnd() === `## ${version}`);
	if (start === -1) return [];
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((line) => /^## \d/u.test(line));
	return end === -1 ? rest : rest.slice(0, end);
};

// A bullet is its `- ` line and every indented or blank line after it.
const bulletsOf = (lines) =>
	lines.reduce((bullets, line) => {
		if (line.startsWith('- ')) return [...bullets, [line]];
		if (bullets.length > 0 && (line === '' || /^\s/u.test(line))) {
			return [...bullets.slice(0, -1), [...bullets.at(-1), line]];
		}
		return bullets;
	}, []);

// A package's own entries for a version: each `### … Changes` heading that
// still has a bullet once the dependency bumps are gone, with those bullets.
const ownEntries = (version, text) =>
	sectionOf(version, text)
		.join('\n')
		.split(/^(?=### )/mu)
		.filter((part) => part.startsWith('### '))
		.map((part) => {
			const [heading, ...body] = part.split('\n');
			const bullets = bulletsOf(body)
				.filter(([first]) => !DEPENDENCY_BUMP.test(first))
				.map((bullet) =>
					bullet
						.map((line) => line.trimEnd())
						.join('\n')
						.trimEnd()
				);
			return bullets.length === 0 ? '' : `${heading}\n\n${bullets.join('\n')}`;
		})
		.filter((entry) => entry !== '')
		.join('\n\n');

/**
 * @param {string} version
 * @param {{ name: string, text: string }[]} changelogs every package's, in the
 *   order to list them; `text` is its CHANGELOG.md, or '' where it has none
 * @returns {string}
 */
export const releaseNotes = (version, changelogs) => {
	const groups = changelogs.reduce((byEntries, { name, text }) => {
		const entries = ownEntries(version, text);
		if (entries === '') return byEntries;
		return new Map(byEntries).set(entries, [...(byEntries.get(entries) ?? []), name]);
	}, new Map());
	if (groups.size === 0) return 'No changelog entries for this version.\n';
	return [...groups]
		.map(([entries, names]) => {
			// `##`, so the `###` headings Changesets writes nest underneath.
			const heading = names.length === changelogs.length ? 'Every package' : names.join(', ');
			return `## ${heading}\n\n${entries}\n`;
		})
		.join('\n');
};

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [version] = process.argv.slice(2);
	if (!version) throw new Error('usage: node scripts/releaseNotes.mjs <version>');
	const packages = join(import.meta.dirname, '..', 'packages');
	const changelogs = readdirSync(packages)
		.filter((dir) => existsSync(join(packages, dir, 'package.json')))
		.map((dir) => {
			const log = join(packages, dir, 'CHANGELOG.md');
			return {
				name: JSON.parse(readFileSync(join(packages, dir, 'package.json'), 'utf8')).name,
				text: existsSync(log) ? readFileSync(log, 'utf8') : '',
			};
		});
	process.stdout.write(releaseNotes(version, changelogs));
}
