import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Code cites the design by name (`docs/ARCHITECTURE.md §7, "Merge before the
 * copy"`), and nothing else notices when a name stops leading anywhere. A
 * citation of skysa-notes' own document (`skysa-notes §7, "The scratchpad"`)
 * leads there, and is not looked for here.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

const under = (path: string): readonly string[] =>
	readdirSync(join(ROOT, path), { recursive: true, encoding: 'utf8' })
		.filter((file) => !file.split('/').includes('node_modules'))
		.map((file) => join(path, file));

const PACKAGES = readdirSync(join(ROOT, 'packages')).map((name) => join('packages', name));

const CURRENT = [
	'docs/ARCHITECTURE.md',
	...under('docs/decisions').filter((file) => file.endsWith('.md')),
];
const CITING = [
	...PACKAGES.flatMap((folder) =>
		['src', 'tests', 'scripts']
			.map((part) => join(folder, part))
			.filter((path) => existsSync(join(ROOT, path)))
	)
		.flatMap(under)
		.filter((file) => /\.(?:tsx?|m?js)$/u.test(file)),
	'packages/eslint-config/index.js',
	'eslint.config.js',
	...['CLAUDE.md', 'CONTRIBUTING.md', 'README.md', 'SECURITY.md'],
	...CURRENT,
];

/** A comment's or a paragraph's words, with its line breaks and margins taken out. */
const unwrapped = (text: string): string => text.replace(/\s*\n\s*(?:\*\s|\/\/\s|>\s)?\s*/gu, ' ');
const withoutFences = (text: string): string => text.replace(/^```[\s\S]*?^```/gmu, '');

/** A text without its citations of skysa-notes' own document, which lead there. */
const ours = (text: string): string =>
	unwrapped(text).replace(
		/skysa-notes'? (?:docs\/)?(?:ARCHITECTURE\.md,? )?§[\d.]+(?:,? ["“][^"”]+["”])?/gu,
		''
	);

const current = withoutFences(CURRENT.map(read).join('\n')).toLowerCase();
const headings = current.match(/^#{1,3} .*$/gmu) ?? [];
const leadIns = [...current.matchAll(/^\s*(?:(?:[-+]|\d+\.)\s+)?\*{1,2}([^*\n]+)/gmu)];
const sectionNames = [
	...headings.map((heading) => heading.replace(/^#+ (?:[\d.]+ )?/u, '')),
	...leadIns.map(([, words]) => String(words)),
];

/** Whether a name is how a heading or a lead-in begins, a whole word at its end. */
const isSection = (name: string): boolean =>
	sectionNames.some(
		(section) =>
			section.startsWith(name.toLowerCase()) && !/\w/u.test(section.charAt(name.length))
	);

/** Each section number with a quoted name in a text. */
const citations = (text: string): readonly string[] =>
	[...ours(text).matchAll(/§\d[\d.]*(?:,|'s)? ["“]([^"”]{3,80})["”]/gu)].map(([, name]) =>
		String(name).replace(/[.,]$/u, '')
	);

/** The anchors `ARCHITECTURE.md` has, and each section of it that a text names by number. */
const architecture = read('docs/ARCHITECTURE.md');
const anchors = [...architecture.matchAll(/<a id="([^"]+)"><\/a>/gu)].map(([, id]) => String(id));
const citedNumbers = (text: string): readonly string[] =>
	[...ours(text).matchAll(/ARCHITECTURE\.md,? §(\d+)/gu)].map(
		([, number]) => `s${String(number)}`
	);
const citedAnchors = (text: string): readonly string[] =>
	[...text.matchAll(/(?<!skysa-notes\/blob\/main\/docs\/)ARCHITECTURE\.md#([a-z0-9-]+)/gu)].map(
		([, id]) => String(id)
	);

/** Each `[…](path)` in a markdown text, outside its code, that points at another file. */
const links = (text: string): readonly string[] =>
	[...text.replace(/```[\s\S]*?```|`[^`\n]*`/gu, '').matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/gu)]
		.map(([, target]) => String(target))
		.filter((target) => !/^[a-z]+:/u.test(target));

/**
 * The paths §11 names, each under the directories its row is indented below.
 * A row is a path or several, and then a `#` and what they are.
 */
const layoutPaths = (text: string): readonly string[] => {
	const section = text.slice(text.indexOf('<a id="repo-layout">'));
	const block = section.slice(
		section.indexOf('```') + 3,
		section.indexOf('```', section.indexOf('```') + 3)
	);
	const walked = block
		.split('\n')
		.reduce<Readonly<{ above: readonly string[]; found: readonly string[] }>>(
			({ above, found }, row) => {
				const names = (row.split('#')[0] ?? '').trim().split(/\s+/u).filter(Boolean);
				const first = names[0];
				if (first === undefined) return { above, found };
				const parents = above.slice(0, (row.length - row.trimStart().length) / 2);
				return {
					above: first.endsWith('/') ? [...parents, first.slice(0, -1)] : parents,
					found: [
						...found,
						...names
							.filter((name) => !name.includes('*'))
							.map((name) => [...parents, name.replace(/\/$/u, '')].join('/')),
					],
				};
			},
			{ above: [], found: [] }
		);
	return walked.found;
};

describe('the docs', () => {
	it('finds what it is meant to look at', () => {
		expect(CITING.flatMap((file) => citations(read(file))).length).toBeGreaterThan(50);
		expect(layoutPaths(architecture)).toContain('packages/sync/src/engine.ts');
	});

	it('reads a citation across the lines of a comment', () => {
		expect(citations(' * docs/ARCHITECTURE.md §7,\n * "Merge before the copy").')).toEqual([
			'Merge before the copy',
		]);
		expect(citations('RFC 9110 §10.2.3, which says')).toEqual([]);
	});

	it("leaves a citation of skysa-notes' own document to it", () => {
		expect(citations('skysa-notes §7, "The scratchpad", and §7, "Sync loop"')).toEqual([
			'Sync loop',
		]);
		expect(citedNumbers("skysa-notes' docs/ARCHITECTURE.md §12.1")).toEqual([]);
	});

	it('has every citation by name lead to a section', () => {
		const lost = CITING.flatMap((file) =>
			citations(read(file))
				.filter((name) => !isSection(name))
				.map((name) => `${file}: ${name}`)
		);
		expect(lost).toEqual([]);
	});

	it('cites a phase where the phases are', () => {
		const stale = CITING.filter((file) =>
			/ARCHITECTURE\.md,? (?:the )?Phase \d/u.test(unwrapped(read(file)))
		);
		expect(stale).toEqual([]);
	});

	it('has an anchor, its own, on every heading', () => {
		const lines = withoutFences(architecture).split('\n');
		const bare = lines.filter(
			(line, at) => /^#{2,3} /u.test(line) && !(lines[at - 1] ?? '').startsWith('<a id="')
		);
		expect(bare).toEqual([]);
		expect(anchors.filter((id, at) => anchors.indexOf(id) !== at)).toEqual([]);
	});

	it('has every citation by anchor or number lead to one', () => {
		const lost = CITING.flatMap((file) =>
			[...citedAnchors(read(file)), ...citedNumbers(read(file))]
				.filter((id) => !anchors.includes(id))
				.map((id) => `${file}: ${id}`)
		);
		expect(lost).toEqual([]);
	});

	it('links only to files that are there', () => {
		const dead = CITING.filter((file) => file.endsWith('.md')).flatMap((file) =>
			links(read(file))
				.filter((target) => !existsSync(join(ROOT, dirname(file), target)))
				.map((target) => `${file}: ${target}`)
		);
		expect(dead).toEqual([]);
	});

	it('lists every decision record', () => {
		const index = read('docs/decisions/README.md');
		const unlisted = readdirSync(join(ROOT, 'docs/decisions')).filter(
			(file) => file !== 'README.md' && !index.includes(`(${file})`)
		);
		expect(unlisted).toEqual([]);
	});

	describe('§11, the repo layout', () => {
		const paths = layoutPaths(architecture);

		it('names only paths that are there', () => {
			expect(paths.filter((path) => !existsSync(join(ROOT, path)))).toEqual([]);
		});

		it('has a row for each package', () => {
			expect(PACKAGES.filter((folder) => !paths.includes(folder))).toEqual([]);
		});

		it.each(
			PACKAGES.map((folder) => join(folder, 'src')).filter((src) =>
				existsSync(join(ROOT, src))
			)
		)('has a row for each directory at the top of %s', (source) => {
			const directories = readdirSync(join(ROOT, source), { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => join(source, entry.name));
			expect(directories.filter((directory) => !paths.includes(directory))).toEqual([]);
		});
	});
});
