import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
 * full (`skysa-notes`, `Skysa Notes`, `skysaDraw`), or as a prefix (`notes-`,
 * `NOTES_`, `VITE_NOTES_`, `draw:`). The kit's own words are not among them:
 * a "note" is any app's document (`upsert-note`, `note-added`,
 * `notesUnderNow`, `NOTE_KINDS`), so only the plural, an app's name, counts,
 * and only where it starts a word.
 */
const APP = /skysa[\s_/-]?(?:notes|draw)|memoriam|(?<![a-z-])(?:notes|draw(?:ing)?)[-_:]/iu;
/** A citation says whose a thing is, as a comment does: an issue, or a link. */
const CITED = /https:\/\/github\.com\/skysa-org\/[\w./#-]*|skysa-org\/skysa-\w+|skysa-\w+#\d+/gu;
const names = (text: string): boolean => APP.test(text.replace(CITED, ''));

const PACKAGES = readdirSync(join(ROOT, 'packages')).map((name) => join('packages', name));
/** Every module a package ships or tests with, as the docs test reads them. */
const CODE = [
	...PACKAGES.flatMap((folder) => ['src', 'tests', 'scripts'].map((part) => join(folder, part)))
		.filter((folder) => existsSync(join(ROOT, folder)))
		.flatMap((folder) =>
			readdirSync(join(ROOT, folder), { recursive: true, encoding: 'utf8' }).map((file) =>
				join(folder, file)
			)
		),
	join('packages', 'eslint-config', 'index.js'),
].filter((file) => /\.[cm]?[jt]sx?$/u.test(file));

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
			'release-notes-x',
			'skysa-update',
			'@skysa/pwa:brand',
			'from a test (skysa-notes#449).',
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
});
