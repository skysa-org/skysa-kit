import { builtinModules } from 'node:module';

import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import functional from 'eslint-plugin-functional';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import preferArrowFunctions from 'eslint-plugin-prefer-arrow-functions';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Syntax refused everywhere. A named list because flat config *replaces* a
 * rule's options rather than merging them: a block that sets
 * `no-restricted-syntax` without spreading these turns both of them off for
 * every file it covers, and no existing file violates them, so nothing would
 * ever say so.
 */
export const RESTRICTED_SYNTAX = [
	{
		selector: 'IfStatement > IfStatement.alternate',
		message: "'else if' is not allowed, use early returns instead.",
	},
	{
		// A static import is what the src rule on a `/testing` entry sees; this
		// keeps a lazy one from slipping a test double into a chunk.
		selector: 'ImportExpression[source.value=/^@skysa\\/[^/]+\\/testing$/]',
		message: 'import the test doubles statically, from a test (skysa-notes#449).',
	},
	{
		// `no-import-type-side-effects`, for re-exports, which it does not look
		// at: `export { type X } from 'm'` is kept as `export {} from 'm'`.
		selector:
			"ExportNamedDeclaration[source][exportKind='value']:not(:has(ExportSpecifier[exportKind='value']))",
		message:
			"a re-export of nothing but types is 'export type { … } from', which loads nothing.",
	},
	{
		selector: 'AwaitExpression > ImportExpression',
		message:
			'Await with dynamic imports (await import()) is not allowed. Use static imports at the top of the file instead.',
	},
];

/**
 * The one way to hold a value that changes: `cell()` from `@skysa/storage`
 * (skysa-notes#457). Not a `Map` keyed by one literal, and not a `{ current }`
 * written out — the two ways the rule against `let` used to be worked around,
 * each to be learned where it was met. A React ref is a cell's shape already
 * and is not written as one of these. In source only: tests keep their own
 * idioms.
 */
const CELL_MESSAGE =
	'a value that changes is a cell (skysa-notes#457): cell() and Cell<T>, from @skysa/storage, or from src/cell.js inside it.';

export const CELL_SYNTAX = [
	{
		// Keyed by one literal, or by a union of nothing but literals: a value or
		// two by name, not a table. A key named through a type alias is not seen;
		// only a type-aware rule could, and review is that here.
		selector:
			"NewExpression[callee.name='Map'] > TSTypeParameterInstantiation > :first-child:matches(TSLiteralType, TSUnionType:not(:has(> :not(TSLiteralType))))",
		message: CELL_MESSAGE,
	},
	{
		// A set that can only ever hold one thing is a flag.
		selector:
			"NewExpression[callee.name='Set'] > TSTypeParameterInstantiation > TSLiteralType:first-child",
		message: CELL_MESSAGE,
	},
	{
		selector:
			"ObjectExpression[properties.length=1] > Property:matches([key.name='current'], [key.value='current'])",
		message: CELL_MESSAGE,
	},
	{
		selector:
			"TSTypeLiteral[members.length=1] > TSPropertySignature:matches([key.name='current'], [key.value='current'])",
		message: CELL_MESSAGE,
	},
];

/**
 * Every Node built-in, by bare name and by `node:` — read from Node itself, so a
 * hand-kept list cannot leave one out. Names that start with `_` are Node's
 * internals, not modules anyone imports.
 */
export const NODE_BUILTINS = ['node:*', ...builtinModules.filter((name) => !name.startsWith('_'))];

/**
 * The browser's globals that would tie code to a browser. A package that runs
 * in the browser, Node and Workers alike takes lib.dom for the web standards it
 * does use (Web Crypto, TextEncoder, fetch, URL), and no lib setting leaves
 * these out on their own.
 */
export const BROWSER_ONLY_GLOBALS = [
	'document',
	'window',
	'localStorage',
	'sessionStorage',
	'navigator',
	'location',
	'alert',
	'indexedDB',
];

/**
 * Restricted import patterns for a folder that sits below others: it may not
 * reach up into the folders named, so the layers stay one way round. `**`
 * either side because a file one folder deeper writes `../../components/…`.
 */
export const NOT_ABOVE = (folders, message) => ({
	group: folders.map((folder) => `**/${folder}/**`),
	message,
});

/**
 * What every TypeScript file is held to, `.ts` and `.tsx` alike, so component
 * code meets the same standard as the rest rather than a looser one. On top of
 * `eslint:recommended` and typescript-eslint's `recommendedTypeChecked`.
 * Formatting is Prettier's: `prettierConfig`, last in `skysa()`, switches off
 * every rule that would fight it.
 */
const typescriptRules = {
	// Mistakes JavaScript lets through.
	eqeqeq: 'error',
	'guard-for-in': 'error',
	'no-caller': 'error',
	'no-extend-native': 'error',
	'no-extra-bind': 'error',
	'no-invalid-this': 'error',
	'no-irregular-whitespace': 'error',
	'no-multi-str': 'error',
	'no-new-wrappers': 'error',
	'no-param-reassign': 'error',
	// Allowed, though `eslint:recommended` refuses it.
	'no-cond-assign': 'off',

	// Nothing left behind from debugging, and no browser dialogs.
	'no-console': 'error',
	'no-debugger': 'error',
	'no-alert': 'error',

	// Shallow, flat code: early returns rather than nesting.
	complexity: ['error', 20],
	'max-depth': ['error', 2],
	'no-else-return': 'error',
	// `no-restricted-syntax` is set in `skysa()`, with the repo's own `syntax`:
	// set here, a block that spread these rules would drop that list.

	// Declarations, names and comments.
	'no-var': 'error',
	'prefer-const': ['error', { destructuring: 'all' }],
	'one-var': ['error', { var: 'never', let: 'never', const: 'never' }],
	'object-shorthand': 'error',
	'prefer-rest-params': 'error',
	'prefer-spread': 'error',
	camelcase: [
		'error',
		{ ignoreDestructuring: true, ignoreImports: true, ignoreGlobals: true, allow: [''] },
	],
	'spaced-comment': ['error', 'always'],

	// Functions are arrow functions held in consts.
	'func-style': ['error', 'expression'],
	'prefer-arrow-callback': 'error',
	'arrow-body-style': ['error', 'as-needed'],
	'prefer-arrow-functions/prefer-arrow-functions': [
		'error',
		{ disallowPrototype: true, singleReturnOnly: false, classPropertiesAllowed: false },
	],

	// Functional style. `functional/immutable-data` is added in `skysa()`, for
	// `.ts` only.
	'functional/no-this-expressions': 'error',
	'functional/no-loop-statements': 'error',
	'functional/no-let': 'error',
	'functional/functional-parameters': [
		'error',
		{ allowRestParameter: true, enforceParameterCount: false },
	],
	'functional/prefer-tacit': 'error',
	'functional/readonly-type': 'error',
	'functional/prefer-property-signatures': 'error',

	// Imports: sorted, types imported as types, and none left unused.
	'simple-import-sort/imports': 'error',
	'unused-imports/no-unused-imports': 'error',
	'@typescript-eslint/consistent-type-imports': 'error',
	// An import whose every name is a type is `import type`: with
	// `verbatimModuleSyntax`, `import { type X }` is kept as `import {}`, which
	// still loads the module — and whatever it builds as it loads.
	'@typescript-eslint/no-import-type-side-effects': 'error',

	// Where typescript-eslint has a type-aware version of a core rule, the core
	// one is off and that one is on.
	'no-unused-vars': 'off',
	'@typescript-eslint/no-unused-vars': [
		'error',
		{
			argsIgnorePattern: '^_',
			varsIgnorePattern: '^_',
			destructuredArrayIgnorePattern: '^_',
			ignoreRestSiblings: true,
		},
	],
	'no-throw-literal': 'off',
	'@typescript-eslint/only-throw-error': 'error',
	'prefer-promise-reject-errors': 'off',
	'@typescript-eslint/prefer-promise-reject-errors': 'error',
	'require-await': 'off',
	'@typescript-eslint/require-await': 'error',

	// The rest of TypeScript.
	'@typescript-eslint/no-explicit-any': 'off',
	'@typescript-eslint/no-array-delete': 'error',
	'@typescript-eslint/no-base-to-string': 'error',
	'@typescript-eslint/no-deprecated': 'error',
	'@typescript-eslint/no-duplicate-enum-values': 'error',
	'@typescript-eslint/no-duplicate-type-constituents': 'error',
	'@typescript-eslint/no-empty-function': 'error',
	'@typescript-eslint/no-extra-non-null-assertion': 'error',
	'@typescript-eslint/no-for-in-array': 'error',
	'@typescript-eslint/no-redundant-type-constituents': 'error',
	'@typescript-eslint/no-this-alias': 'error',
	'@typescript-eslint/no-unnecessary-condition': 'error',
	'@typescript-eslint/no-unnecessary-type-assertion': 'error',
	'@typescript-eslint/no-unnecessary-type-constraint': 'error',
	'@typescript-eslint/no-wrapper-object-types': 'error',
	'@typescript-eslint/prefer-as-const': 'error',
	'@typescript-eslint/restrict-plus-operands': 'error',
	'@typescript-eslint/restrict-template-expressions': 'error',
	'@typescript-eslint/triple-slash-reference': 'error',
};

/** Where the code that ships lives, in every package of the repo using this. */
const SOURCE = ['**/src/**/*.ts', '**/src/**/*.tsx'];

/**
 * The lint every Skysa repo shares, with the repo's own blocks between it and
 * Prettier's, which must come last.
 *
 * - `root`: the directory typescript-eslint finds each file's tsconfig from.
 * - `ignores`: what the repo generates or keeps out of lint.
 * - `react`: `{ files, version }` — the files that are React code, for its
 *   rules and the browser's globals, and the React the repo depends on, which
 *   eslint-plugin-react's version-gated rules read.
 * - `syntax`: the repo's own refused syntax, added wherever this sets
 *   `no-restricted-syntax`. A block of the repo's own that sets it spreads
 *   `RESTRICTED_SYNTAX` (and `CELL_SYNTAX` in source) and its own list too.
 * - `blocks`: the repo's own config blocks: its boundaries and layers.
 */
export const skysa = ({ root, ignores = [], react: reactCode, syntax = [], blocks = [] }) =>
	tseslint.config(
		{
			ignores: [
				'**/dist/**',
				'**/coverage/**',
				'**/node_modules/**',
				'**/.wrangler/**',
				'.claude/**',
				...ignores,
			],
		},

		js.configs.recommended,

		// ---- TypeScript -----------------------------------------------------

		{
			files: ['**/*.ts', '**/*.tsx'],
			extends: [...tseslint.configs.recommendedTypeChecked],
			languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: root } },
			plugins: {
				'prefer-arrow-functions': preferArrowFunctions,
				functional,
				'unused-imports': unusedImports,
				'simple-import-sort': simpleImportSort,
			},
			rules: {
				...typescriptRules,
				'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX, ...syntax],
			},
		},
		{
			// Not in components: it flags ordinary useState setter patterns that
			// the accessor carve-out does not quite cover.
			files: ['**/*.ts'],
			rules: {
				'functional/immutable-data': [
					'error',
					{ ignoreMapsAndSets: true, ignoreAccessorPattern: ['**.current', 'window.**'] },
				],
			},
		},

		// ---- React ----------------------------------------------------------

		...(reactCode === undefined
			? []
			: [
					{
						files: reactCode.files,
						extends: [
							react.configs.flat.recommended,
							react.configs.flat['jsx-runtime'], // new JSX transform — no `React` import needed
							jsxA11y.flatConfigs.recommended,
						],
						languageOptions: { globals: globals.browser },
						plugins: { 'react-hooks': reactHooks },
						settings: {
							// Handed in rather than 'detect': eslint-plugin-react 7.37.5's
							// version detection calls an API ESLint 10's flat-config rule
							// context no longer exposes, and crashes the run instead of
							// warning.
							react: { version: reactCode.version },
						},
						rules: {
							...reactHooks.configs['recommended-latest'].rules,
							'react/react-in-jsx-scope': 'off', // React 19 automatic JSX runtime
							'react/prop-types': 'off', // types come from TypeScript
						},
					},
				]),

		{
			// A value that changes is a cell (skysa-notes#457), in every package's
			// src. A block of the repo's own that sets the rule again spreads the
			// list too.
			files: SOURCE,
			rules: {
				'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX, ...syntax, ...CELL_SYNTAX],
			},
		},

		// ---- What ships ------------------------------------------------------

		{
			// A warning, not an error: it says which files have grown too long to
			// read whole, and keeps a split file from growing back. Code lines
			// only — the comments here are long on purpose.
			files: SOURCE,
			rules: {
				'max-lines': ['warn', { max: 600, skipBlankLines: true, skipComments: true }],
			},
		},
		{
			// The test doubles are each package's `/testing` entry (skysa-notes#449),
			// for tests alone: nothing that ships may reach them, by the entry or
			// by a path into any tests folder. typescript-eslint's rule rather than
			// core's, which a repo's layer blocks set per folder and would replace
			// this in each.
			files: SOURCE,
			rules: {
				'@typescript-eslint/no-restricted-imports': [
					'error',
					{
						patterns: [
							{
								regex: '^@skysa/[^/]+/testing$',
								message: 'test doubles are for tests.',
							},
							{
								group: ['**/tests/**', '**/providers/fake', '**/providers/fake.js'],
								message: 'test doubles are for tests.',
							},
						],
					},
				],
			},
		},

		// ---- Relaxations ----------------------------------------------------

		{
			// Vitest's `describe`/`it` callbacks are inherently imperative — shared
			// setup captured in a closure, table-driven loops over fixtures read
			// from disk. Code that ships keeps full enforcement.
			files: ['**/*.test.ts', '**/*.test.tsx', '**/tests/**/*.ts', '**/tests/**/*.tsx'],
			rules: {
				'functional/no-let': 'off',
				'functional/no-loop-statements': 'off',
				'functional/immutable-data': 'off',
				'functional/functional-parameters': 'off',
			},
		},
		{
			// Build and tool configuration, and scripts: plain Node ESM.
			files: ['**/*.config.js', '**/*.config.ts', '**/*.mjs'],
			languageOptions: { globals: globals.node },
			rules: {
				'functional/no-let': 'off',
				'functional/immutable-data': 'off',
			},
		},

		...blocks,

		// Must stay last: turns off every rule that would fight Prettier.
		prettierConfig
	);
