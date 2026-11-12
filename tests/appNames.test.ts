import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Nothing in the kit names an app (CLAUDE.md): what is an app's own is handed
 * in. A comment may name one as the example, saying whose it is; the code may
 * not, in a string, a name, a pattern or a JSX text. A name in a string
 * reaches every app that uses the kit, as the brand plugin's `notes-brand`
 * did, in Vite's messages from skysa-draw's build.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The apps the kit serves, by the ways their names are spelled in code: in
 * full (`skysa-notes`, `Skysa Notes`, `skysa.draw`), as their folders' tags
 * (`notesapp`, `.drawapp.json`), as a prefix (`notes-`, `NOTES_`,
 * `VITE_NOTES_`, `draw:`), and, for draw, which means nothing in the kit, in
 * a camel-cased name (`drawMarker`, `DrawDatabase`). The kit's own words are
 * not among them: a "note" is any app's document (`upsert-note`,
 * `notesUnderNow`, `NOTE_KINDS`, `notes.md`), so only the plural, an app's
 * name, counts, and only where it starts a word and a separator follows.
 *
 * A list, and so only as good as it is long: an app that comes to the kit
 * adds its names here.
 */
const APP =
	/skysa[\s_./:-]?(?:notes|draw)|memoriam|(?:notes|draw)app|(?<![a-z-])(?:notes|draw(?:ings?)?)[-_:]/iu;
const CAMEL = /\b[Dd]raw(?:ings?)?[A-Z]/u;
/** A citation says whose a thing is, as a comment does: an issue, or a link. */
const CITED =
	/https:\/\/github\.com\/skysa-org\/[\w./#-]*|skysa-org\/skysa-[\w-]+|skysa-[\w-]+#\d+/gu;
const names = (text: string): boolean => {
	const uncited = text.replace(CITED, '');
	return APP.test(uncited) || CAMEL.test(uncited);
};

const PACKAGES = readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
	.filter(
		(entry) =>
			entry.isDirectory() && existsSync(join(ROOT, 'packages', entry.name, 'package.json'))
	)
	.map((entry) => join('packages', entry.name));
const under = (folder: string): readonly string[] =>
	existsSync(join(ROOT, folder))
		? readdirSync(join(ROOT, folder), { recursive: true, encoding: 'utf8' }).map((file) =>
				join(folder, file)
			)
		: [];
/**
 * Every module of every package: its `src/`, `tests/` and `scripts/`, and the
 * files at its top (eslint-config's `index.js`, a `vitest.config.ts`).
 */
const CODE = PACKAGES.flatMap((folder) => [
	...['src', 'tests', 'scripts'].flatMap((part) => under(join(folder, part))),
	...readdirSync(join(ROOT, folder)).map((file) => join(folder, file)),
]).filter((file) => /\.[cm]?[jt]sx?$/u.test(file) && statSync(join(ROOT, file)).isFile());
/** The server's migrations, which every app's database takes as they are. */
const MIGRATIONS = under(join('packages', 'server', 'migrations')).filter((file) =>
	file.endsWith('.sql')
);

const SPELLED = new Set([
	ts.SyntaxKind.StringLiteral,
	ts.SyntaxKind.NoSubstitutionTemplateLiteral,
	ts.SyntaxKind.TemplateHead,
	ts.SyntaxKind.TemplateMiddle,
	ts.SyntaxKind.TemplateTail,
	ts.SyntaxKind.RegularExpressionLiteral,
	ts.SyntaxKind.JsxText,
	ts.SyntaxKind.Identifier,
	ts.SyntaxKind.PrivateIdentifier,
]);

/**
 * Every string, pattern, JSX text and name in a module, by a parse. A comment
 * is no node, and a doc comment's (`{@link …}`, `@param`) is left out, so
 * that no comment is read as code.
 */
const spelled = (file: string, text: string): readonly string[] => {
	const source = ts.createSourceFile(
		file,
		text,
		ts.ScriptTarget.Latest,
		true,
		/x$/u.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
	);
	const walk = (node: ts.Node): readonly ts.Node[] => [
		node,
		...node
			.getChildren(source)
			.filter((child) => !ts.isJSDoc(child))
			.flatMap(walk),
	];
	return walk(source)
		.filter((node) => SPELLED.has(node.kind))
		.map((node) => node.getText(source));
};
const spelledIn = (file: string): readonly string[] =>
	spelled(file, readFileSync(join(ROOT, file), 'utf8'));

describe("the kit's code", () => {
	it('finds what it is meant to look at', () => {
		expect(CODE).toContain(join('packages', 'pwa', 'src', 'brand.ts'));
		expect(CODE).toContain(join('packages', 'pwa', 'scripts', 'bundleBudget.mjs'));
		expect(CODE).toContain(join('packages', 'pwa', 'tests', 'testing.ts'));
		expect(CODE).toContain(join('packages', 'eslint-config', 'index.js'));
		expect(CODE).toContain(join('packages', 'server', 'vitest.config.ts'));
		expect(MIGRATIONS).toContain(join('packages', 'server', 'migrations', '0000_init.sql'));
		expect(spelledIn(join('packages', 'pwa', 'src', 'brand.ts'))).toContain('brandPlugin');
	});

	it('reads strings, patterns, JSX text and names, and no comment', () => {
		const found = spelled(
			'probe.tsx',
			[
				'/** Read from {@link NOTES_BRAND}. @param NOTES_X the one */',
				'// skysa-notes',
				'const p = <p>Made here</p>;',
				'const r = /a-pattern/u;',
				'const s = `a ${p} b`;',
			].join('\n')
		);
		expect(found).toEqual(
			expect.arrayContaining(['Made here', '/a-pattern/u', '`a ${', '} b`'])
		);
		expect(found.filter((text) => text.includes('NOTES') || text.includes('skysa'))).toEqual(
			[]
		);
	});

	it("knows an app's name from the kit's own words", () => {
		[
			'notes-brand',
			'skysa-draw:sync:',
			'NOTES_BRAND',
			'VITE_NOTES_RELAY',
			'DRAW_FORMAT',
			'drawing-row',
			'notes:sync',
			'Skysa Notes',
			'skysaDraw',
			'skysa.notes.prefs',
			'.notesapp.json',
			'drawapp',
			'drawMarker',
			'DrawDatabase',
			'memoriam',
		].forEach((name) => {
			expect(names(name), name).toBe(true);
		});
		[
			'upsert-note',
			'note-added',
			'notesUnderNow',
			'PullNotes',
			'NOTE_KINDS',
			'notes.md',
			'./pull/notes.js',
			'release-notes-x',
			'withdrawn',
			'skysa-update',
			'@skysa/pwa:brand',
			'from a test (skysa-notes#449).',
			'skysa-notes-cloud#12',
			'https://github.com/skysa-org/skysa-notes/blob/main/docs/ARCHITECTURE.md',
		].forEach((word) => {
			expect(names(word), word).toBe(false);
		});
	});

	it('names no app', () => {
		const named = CODE.flatMap((file) =>
			spelledIn(file)
				.filter(names)
				.map((text) => `${file}: ${text}`)
		);
		expect(named).toEqual([]);
	});

	it('makes no table, column or key that names an app', () => {
		const named = MIGRATIONS.flatMap((file) =>
			readFileSync(join(ROOT, file), 'utf8')
				.split('\n')
				.filter((line) => !/^\s*--/u.test(line) && names(line))
				.map((line) => `${file}: ${line}`)
		);
		expect(named).toEqual([]);
	});
});
