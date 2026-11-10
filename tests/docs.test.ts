import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
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
	readdirSync(join(ROOT, path), { recursive: true, encoding: 'utf8' }).map((file) =>
		join(path, file)
	);

const PACKAGES = readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
	.filter(
		(entry) =>
			entry.isDirectory() && existsSync(join(ROOT, 'packages', entry.name, 'package.json'))
	)
	.map((entry) => join('packages', entry.name));

const RECORDS = readdirSync(join(ROOT, 'docs/decisions')).filter(
	(file) => file.endsWith('.md') && file !== 'README.md'
);
const CURRENT = [
	'docs/ARCHITECTURE.md',
	'docs/decisions/README.md',
	...RECORDS.map((file) => join('docs/decisions', file)),
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
	...under('scripts').filter((file) => /\.m?js$/u.test(file)),
	'.changeset/README.md',
	...['CLAUDE.md', 'CONTRIBUTING.md', 'README.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md'],
	...['CLA-individual.md', 'CLA-entity.md'],
	...CURRENT,
];
const SPELLED = [
	...CITING,
	...PACKAGES.flatMap((folder) =>
		readdirSync(join(ROOT, folder))
			.filter((file) => /\.(?:tsx?|m?js|md)$/u.test(file))
			.map((file) => join(folder, file))
	),
	...under('tests').filter((file) => /\.tsx?$/u.test(file)),
	'vitest.config.ts',
	...under('.github/workflows').filter((file) => /\.ya?ml$/u.test(file)),
].filter((file, at, all) => all.indexOf(file) === at);
const TEXTS = new Map(SPELLED.map((file) => [file, read(file)]));
const textOf = (file: string): string => TEXTS.get(file) ?? '';

/** A comment's or a paragraph's words, with its line breaks and margins taken out. */
const unwrapped = (text: string): string => text.replace(/\s*\n\s*(?:\*\s|\/\/\s|>\s)?\s*/gu, ' ');
/** A markdown text without its fenced blocks, indented or not, of backticks or tildes. */
const withoutFences = (text: string): string =>
	text.replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gmu, '');
/** A markdown text without its code, fenced or inline, or its HTML comments. */
const withoutCode = (text: string): string =>
	withoutFences(text).replace(/`[^`\n]*`|<!--[\s\S]*?-->/gu, '');

/** A text without its citations of skysa-notes' own document, which lead there. */
const ours = (text: string): string =>
	unwrapped(text).replace(
		/skysa-notes'? `?(?:docs\/)?(?:ARCHITECTURE\.md`?,? )?§[\d.]+(?:,? ["“][^"”]{3,80}["”])?/gu,
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

/**
 * The anchors `ARCHITECTURE.md` has, and the anchor of each section a text
 * names by number (`§5.1` is `s5-1`), other than a standard's (`RFC 9110 §10.2.3`,
 * `OIDC Core §3.1.3.7`).
 */
const architecture = read('docs/ARCHITECTURE.md');
const anchors = [...architecture.matchAll(/<a id="([^"]+)"><\/a>/gu)].map(([, id]) => String(id));
const citedNumbers = (text: string): readonly string[] =>
	[...ours(text).matchAll(/(?<!(?:RFC \d+|Core) )§(\d+(?:\.\d+)*)/gu)].map(
		([, number]) => `s${String(number).replaceAll('.', '-')}`
	);
const citedAnchors = (text: string): readonly string[] =>
	[...text.matchAll(/(?<!skysa-notes\/blob\/main\/docs\/)ARCHITECTURE\.md#([a-z0-9-]+)/gu)].map(
		([, id]) => String(id)
	);

/**
 * What is skysa-notes' own, which a text here names only with whose it is: its
 * apps' paths and its core's, its documents and records, and its issues.
 */
const NOTES_ONLY =
	/apps\/(?:api|web)\/|packages\/core\b|@skysa\/core\b|docs\/(?:history|self-hosting|google-oauth)\.md|(?:docs\/decisions\/|record )(?!0003)\d{4}/u;
const unattributed = (text: string): readonly string[] =>
	unwrapped(text)
		.split(/(?<=[.;:!?])\s+|\s+-\s+/u)
		.filter((sentence) => NOTES_ONLY.test(sentence) && !sentence.includes('skysa-notes'));
const bareIssues = (text: string): readonly string[] =>
	[...text.matchAll(/(?<![\w&/'"`[-])#\d+\b(?![0-9a-f])/giu)].map(([issue]) => issue);

/**
 * Spellings that are British, by the patterns they follow and by name: the
 * kit's comments and documents are in American English. Identifiers and
 * strings are what they are, so only prose is read.
 */
const BRITISH = new RegExp(
	[
		String.raw`\w*(?:colo|behavio|hono|favo|neighbo|labo|harbo|humo|rumo|vapo|flavo|savo|armo|endeavo|odo|parlo|valo|vigo)ur\w*`,
		String.raw`\w*(?:organ|recogn|normal|serial|initial|final|optim|minim|maxim|priorit|summar|author|synchron|custom|standard|real|categor|character|memo|material|special|sanit|token|random|stabil|visual|central|general|local|global|capital|critic|parameter|util|apolog|digit|neutral|modern|personal|rational|scrutin|symbol|trivial|virtual|familiar|item|emphas|harmon|mobil|polar|equal)is(?:e|ed|es|ing|ation|ations|er|ers|able|ably)`,
		String.raw`\w*(?:anal|paral|catal)ys(?:e|ed|ing)`,
		String.raw`\w*(?:cancel|label|model|travel|signal|level|fuel|total|channel|funnel|tunnel|marshal|dial|counsel|initial|equal)l(?:ed|ing|er|ers|or|ors)`,
		String.raw`(?:cent|met|lit|fib|theat|calib|lust|somb|spect|meag)re[sd]?`,
		String.raw`licences?|defence|offence|pretence|practis\w*|judgement|acknowledgement|ageing|artefacts?|learnt|spelt|dreamt|whilst|amongst|sceptic\w*|cheques?|tyres?|kerb|storeys?|plough\w*|mould\w*|draught\w*|enrol(?:s|ment)?|fulfil(?:s|ment)?|instalment|skilful|wilful|catalogue\w*|analogue|grey\w*|aeroplanes?|programmes?|manoeuvr\w*`,
		String.raw`for ever|any more(?! than)|per cent`,
	]
		.map((part) => `\\b(?:${part})\\b`)
		.join('|'),
	'giu'
);
const LEGAL = new Set(['CLA-individual.md', 'CLA-entity.md']);

/** Every comment in a module, by a parse, so that no string is read as one. */
const comments = (file: string, text: string): string => {
	const source = ts.createSourceFile(
		file,
		text,
		ts.ScriptTarget.Latest,
		true,
		file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
	);
	const walk = (node: ts.Node): readonly ts.Node[] => [
		node,
		...node.getChildren(source).flatMap(walk),
	];
	const nodes = walk(source);
	const jsxText = nodes.filter((node) => node.kind === ts.SyntaxKind.JsxText);
	const ranges = new Map(
		nodes
			.flatMap((node) => [node.pos, node.end])
			.flatMap((at) => [
				...(ts.getLeadingCommentRanges(text, at) ?? []),
				...(ts.getTrailingCommentRanges(text, at) ?? []),
			])
			.filter(
				(range) => !jsxText.some((node) => range.pos >= node.pos && range.pos < node.end)
			)
			.map((range) => [range.pos, range.end])
	);
	return [...ranges]
		.sort(([a], [b]) => a - b)
		.map(([pos, end]) => text.slice(pos, end))
		.join('\n');
};

/** A file's prose: a module's comments, a workflow's, or a document outside its code. */
const prose = (file: string, text: string): string =>
	unwrapped(
		(/\.md$/u.test(file)
			? withoutCode(text)
			: /\.ya?ml$/u.test(file)
				? text
						.split('\n')
						.filter((line) => /^\s*#/u.test(line))
						.join('\n')
				: comments(file, text).replace(/`[^`\n]*`/gu, '')
		)
			.replace(/https?:\/\/\S+|\]\([^)]*\)|<a id="[^"]*">|\S*\.md#[\w-]+/gu, '')
			.replace(/^\s*\[[^\]\n]+\]:\s*\S+/gmu, '')
	);
const british = (file: string, text: string): readonly string[] =>
	LEGAL.has(file) ? [] : [...prose(file, text).matchAll(BRITISH)].map(([word]) => word);

/** Each `[…](path)` in a markdown text, outside its code, that points at another file. */
const links = (text: string): readonly string[] =>
	[...withoutCode(text).matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/gu)]
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
		expect(CITING.flatMap((file) => citations(textOf(file))).length).toBeGreaterThan(50);
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
		expect(citedNumbers("skysa-notes' `docs/ARCHITECTURE.md` §12.1")).toEqual([]);
		expect(citedNumbers('skysa-notes §7, "The clipboard says. Then §13')).toEqual(['s13']);
	});

	it('reads a number however it is written', () => {
		expect(citedNumbers('`docs/ARCHITECTURE.md` §13, and §5.4.')).toEqual(['s13', 's5-4']);
		expect(citedNumbers('RFC 9110 §10.2.3, which says')).toEqual([]);
		expect(citedNumbers('OpenID Connect Core §3.1.3.7 lets')).toEqual([]);
	});

	it('reads only prose for spelling', () => {
		expect(british('x.ts', "// a colour\nconst colour = 'a colour';")).toEqual(['colour']);
		expect(british('x.ts', 'const a = 1; // the colour')).toEqual(['colour']);
		expect(british('x.ts', 'const md = `\n* a colour\n// honour\n`;')).toEqual([]);
		expect(british('x.ts', '/*\n  the colour here\n*/')).toEqual(['colour']);
		expect(british('x.tsx', 'const a = <b>{/* colour */}</b>;')).toEqual(['colour']);
		expect(british('x.tsx', 'const a = <b>// colour</b>;')).toEqual([]);
		expect(british('x.ts', '// retried for\n// ever, and any more than that')).toEqual([
			'for ever',
		]);
		expect(
			british('x.ts', '// see docs/ARCHITECTURE.md#the-colour-rule, https://x.org/colour')
		).toEqual([]);
		expect(
			british('x.md', 'Its behaviour, [a](https://x.org/colour), cancellation, any more.')
		).toEqual(['behaviour', 'any more']);
		expect(
			british(
				'x.md',
				'- item\n  ```\n  const colour = 1;\n  ```\n\n~~~\ncolour\n~~~\n\n[x]: ./colour.md\n<!-- colour -->\n<a id="the-colour-rule"></a>\nAt https://x.org/colour.'
			)
		).toEqual([]);
		expect(british('x.yml', "# a colour\nmessage: 'a licence'")).toEqual(['colour']);
		expect(british('CLA-individual.md', 'a licence grant')).toEqual([]);
	});

	it('knows a British spelling from an American one', () => {
		const words =
			'colour honours recognised normalise analysed cancelled labelling centre grey aeroplane licence';
		expect(british('x.md', words)).toHaveLength(11);
		const american =
			'color honors recognized normalize analyzed analyses canceled cancellation labeling center gray airplane license four our promise otherwise exercise raise noise premise installed controlled fulfilled enrolled emphasis criticism realism';
		expect(british('x.md', american)).toEqual([]);
	});

	it("tells what is skysa-notes' from what says whose it is", () => {
		expect(unattributed('See `apps/web/src/sync/account.ts`. And more.')).toHaveLength(1);
		expect(unattributed("See skysa-notes' `apps/web/src/sync/account.ts`.")).toEqual([]);
		expect(unattributed('The relay (record 0003) and the kit (record 0018).')).toHaveLength(1);
		expect(bareIssues('(#187), skysa-notes#118, `#4B5563`, `#000000`, [#12]')).toEqual([
			'#187',
		]);
	});

	it('has every citation by name lead to a section', () => {
		const lost = CITING.flatMap((file) =>
			citations(textOf(file))
				.filter((name) => !isSection(name))
				.map((name) => `${file}: ${name}`)
		);
		expect(lost).toEqual([]);
	});

	it('cites a phase where the phases are', () => {
		const stale = CITING.filter((file) =>
			/ARCHITECTURE\.md,? (?:the )?Phase \d/u.test(unwrapped(textOf(file)))
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
			[...citedAnchors(textOf(file)), ...citedNumbers(textOf(file))]
				.filter((id) => !anchors.includes(id))
				.map((id) => `${file}: ${id}`)
		);
		expect(lost).toEqual([]);
	});

	it('links only to files that are there', () => {
		const dead = CITING.filter((file) => file.endsWith('.md')).flatMap((file) =>
			links(textOf(file))
				.filter((target) => !existsSync(join(ROOT, dirname(file), target)))
				.map((target) => `${file}: ${target}`)
		);
		expect(dead).toEqual([]);
	});

	it('lists every decision record', () => {
		const index = textOf('docs/decisions/README.md');
		expect(RECORDS.filter((file) => !index.includes(`(${file})`))).toEqual([]);
	});

	it('is written in American English', () => {
		const words = SPELLED.flatMap((file) =>
			british(file, textOf(file)).map((word) => `${file}: ${word}`)
		);
		expect(words).toEqual([]);
	});

	it("says whose it is where it names something of skysa-notes'", () => {
		const unnamed = CITING.flatMap((file) =>
			[...unattributed(textOf(file)), ...bareIssues(textOf(file))].map(
				(found) => `${file}: ${found}`
			)
		);
		expect(unnamed).toEqual([]);
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
