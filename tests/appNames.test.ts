import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Nothing in the kit names an app (CLAUDE.md): what is an app's own is handed
 * in. A comment may name one as the example, saying whose it is, which the
 * docs test holds; the code may not, in a string or in a name. A name in a
 * string reaches every app that uses the kit, as the brand plugin's
 * `notes-brand` did, in Vite's messages from skysa-draw's build.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The apps the kit serves, by the ways their names are spelled in code: in
 * full, or as a prefix (`notes-`, `NOTES_`). The kit's own words are not
 * among them: a "note" is any app's document (`upsert-note`, `note-added`,
 * `notesUnderNow`, `NOTE_KINDS`), so only the plural, an app's name, counts.
 */
const APP = /skysa-(?:notes|draw)|memoriam|\bnotes-|\bdraw(?:ing)?-|\b(?:NOTES|DRAW)_/u;

const CODE = readdirSync(join(ROOT, 'packages'))
	.flatMap((name) => ['src', 'scripts'].map((part) => join('packages', name, part)))
	.filter((folder) => existsSync(join(ROOT, folder)))
	.flatMap((folder) =>
		readdirSync(join(ROOT, folder), { recursive: true, encoding: 'utf8' }).map((file) =>
			join(folder, file)
		)
	)
	.filter((file) => /\.(?:tsx?|m?js)$/u.test(file));

const SPELLED = new Set([
	ts.SyntaxKind.StringLiteral,
	ts.SyntaxKind.NoSubstitutionTemplateLiteral,
	ts.SyntaxKind.TemplateHead,
	ts.SyntaxKind.TemplateMiddle,
	ts.SyntaxKind.TemplateTail,
	ts.SyntaxKind.Identifier,
	ts.SyntaxKind.PrivateIdentifier,
]);

/** Every string and every name in a module, by a parse, so that no comment is read as code. */
const spelled = (file: string): readonly string[] => {
	const source = ts.createSourceFile(
		file,
		readFileSync(join(ROOT, file), 'utf8'),
		ts.ScriptTarget.Latest,
		true
	);
	const walk = (node: ts.Node): readonly ts.Node[] => [
		node,
		...node.getChildren(source).flatMap(walk),
	];
	return walk(source)
		.filter((node) => SPELLED.has(node.kind))
		.map((node) => node.getText(source));
};

describe("the kit's code", () => {
	it('finds what it is meant to look at', () => {
		expect(CODE).toContain(join('packages', 'pwa', 'src', 'brand.ts'));
		expect(CODE).toContain(join('packages', 'pwa', 'scripts', 'bundleBudget.mjs'));
		expect(spelled(join('packages', 'pwa', 'src', 'brand.ts'))).toContain('brandPlugin');
	});

	it("knows an app's name from the kit's own words", () => {
		['notes-brand', 'skysa-draw:sync:', 'NOTES_BRAND', 'DRAW_FORMAT', 'drawing-row'].forEach(
			(name) => {
				expect(APP.test(name), name).toBe(true);
			}
		);
		[
			'upsert-note',
			'note-added',
			'notesUnderNow',
			'PullNotes',
			'NOTE_KINDS',
			'skysa-update',
			'@skysa/pwa:brand',
		].forEach((word) => {
			expect(APP.test(word), word).toBe(false);
		});
	});

	it('names no app, in a string or a name', () => {
		const named = CODE.flatMap((file) =>
			spelled(file)
				.filter((text) => APP.test(text))
				.map((text) => `${file}: ${text}`)
		);
		expect(named).toEqual([]);
	});
});
