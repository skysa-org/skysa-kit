import { readFileSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, relative, resolve, sep } from 'node:path';

import {
	BROWSER_ONLY_GLOBALS,
	CELL_SYNTAX,
	NODE_BUILTINS,
	NOT_ABOVE,
	RESTRICTED_SYNTAX,
	skysa,
} from '@skysa/eslint-config';
import globals from 'globals';

/** Where the kit's packages are, from this file. */
const PACKAGES = resolve(import.meta.dirname, 'packages');

/** The package a file is in, by its folder's name, or undefined outside them. */
const packageOf = (file) => {
	const inside = relative(PACKAGES, file);
	if (inside.startsWith('..')) return undefined;
	return inside.split(sep)[0];
};

/**
 * Each package's manifest, read again whenever it changes, so an editor's
 * long-lived lint sees a dependency the moment it is added. Undefined for a
 * folder with none.
 */
const manifests = new Map();
const manifestOf = (folder) => {
	const file = resolve(PACKAGES, folder, 'package.json');
	const stamp = statSync(file, { throwIfNoEntry: false })?.mtimeMs;
	if (stamp === undefined) return undefined;
	const held = manifests.get(folder);
	if (held?.stamp === stamp) return held.manifest;
	const manifest = JSON.parse(readFileSync(file, 'utf8'));
	manifests.set(folder, { stamp, manifest });
	return manifest;
};

/** `@skysa/sync/testing` → `@skysa/sync`; `hono/csrf` → `hono`. */
const packageNameOf = (specifier) =>
	specifier
		.split('/')
		.slice(0, specifier.startsWith('@') ? 2 : 1)
		.join('/');

/** The specifier a node names, when it is written out whole. */
const specifierOf = (node) => {
	if (node === null || node === undefined) return undefined;
	if (node.type === 'Literal') return node.value;
	if (node.type === 'TSLiteralType') return specifierOf(node.literal);
	if (node.type === 'TemplateLiteral' && node.expressions.length === 0)
		return node.quasis[0].value.cooked;
	return undefined;
};

/**
 * Whether a file of a package ships: everything but its tests and its tools'
 * config. A `/testing` entry is a test's, and takes what the tests take.
 */
const shipsFrom = (folder, file) => {
	const inside = relative(resolve(PACKAGES, folder), file);
	return !inside.startsWith(`tests${sep}`) && !/\.config\.[cm]?[jt]s$/.test(inside);
};

/**
 * A local rule: the edges between packages are their manifests. A relative
 * import stays inside its own package; any other package is reached by its
 * name, which the importer's manifest lists — under `dependencies` or
 * `peerDependencies` for what ships, or anywhere for a test. And code that
 * ships never imports its own package's entry, which would reach round the
 * layers inside it. Node's own modules, and a scheme such as
 * `cloudflare:workers`, are judged by the blocks for where each package runs.
 *
 * Neither pnpm nor TypeScript refuses an unlisted package for certain: Node's
 * resolution climbs to the root's `node_modules`, where the tools live.
 */
const EDGES = {
	meta: {
		type: 'problem',
		messages: {
			leaves: "a relative import leaves @skysa/{{from}}: reach {{target}} by its package's name.",
			unlisted:
				'@skysa/{{from}} does not list {{target}} under {{where}} in its package.json.',
			self: '@skysa/{{from}} imports its own entry: inside a package, reach a module by its relative path.',
		},
		schema: [],
	},
	create: (context) => {
		const from = packageOf(context.filename);
		if (from === undefined) return {};
		const manifest = manifestOf(from);
		if (manifest === undefined) return {};
		const ships = shipsFrom(from, context.filename);
		const listed = ships
			? { ...manifest.dependencies, ...manifest.peerDependencies }
			: {
					...manifest.dependencies,
					...manifest.peerDependencies,
					...manifest.devDependencies,
				};
		const where = ships ? 'dependencies or peerDependencies' : 'any of its dependencies';

		const check = (node, specifier) => {
			if (typeof specifier !== 'string') return;
			if (specifier.startsWith('.')) {
				const target = resolve(dirname(context.filename), specifier);
				if (packageOf(target) !== from)
					context.report({
						node,
						messageId: 'leaves',
						data: { from, target: relative(PACKAGES, target) },
					});
				return;
			}
			if (isBuiltin(specifier) || specifier.includes(':')) return;
			const name = packageNameOf(specifier);
			if (name === manifest.name) {
				if (ships) context.report({ node, messageId: 'self', data: { from } });
				return;
			}
			if (name in listed) return;
			context.report({ node, messageId: 'unlisted', data: { from, target: name, where } });
		};

		return {
			ImportDeclaration: (node) => {
				check(node, node.source.value);
			},
			ExportNamedDeclaration: (node) => {
				if (node.source !== null && node.source !== undefined)
					check(node, node.source.value);
			},
			ExportAllDeclaration: (node) => {
				check(node, node.source.value);
			},
			ImportExpression: (node) => {
				check(node, specifierOf(node.source));
			},
			// `import('…').Type`, a type that names a module.
			TSImportType: (node) => {
				check(node, specifierOf(node.argument));
			},
			TSExternalModuleReference: (node) => {
				check(node, specifierOf(node.expression));
			},
		};
	},
};

/** What the Worker's code refuses: it runs without `nodejs_compat`. */
const NO_NODE_IN_THE_WORKER = {
	group: NODE_BUILTINS,
	message: 'the Worker runs without nodejs_compat — Web Crypto and fetch only.',
};

/** What protocol, storage and sync refuse: they run in the browser, Node and Workers. */
const PORTABLE_MESSAGE =
	'@skysa/protocol, storage and sync run in the browser, Node and Workers alike.';
const NO_NODE_ANYWHERE = { group: NODE_BUILTINS, message: PORTABLE_MESSAGE };

/** What the client refuses: it runs in the browser. */
const NO_NODE_IN_THE_BROWSER = {
	group: NODE_BUILTINS,
	message: '@skysa/client runs in the browser.',
};

const NO_ENV_MESSAGE =
	"the server reads no environment: it takes its configuration through createApp(options), from the app's Worker entry.";

export default skysa({
	root: import.meta.dirname,
	ignores: [
		// Generated by drizzle-kit from src/db/schema.ts.
		'packages/server/migrations/**',
	],
	react: { files: ['packages/client/**/*.ts', 'packages/client/**/*.tsx'], version: '19.3.0' },
	blocks: [
		// ---- Between the packages ------------------------------------------

		{
			files: [
				'packages/*/{src,tests}/**/*.{ts,tsx}',
				'packages/*/scripts/**/*.mjs',
				'packages/*/*.js',
			],
			plugins: { kit: { rules: { edges: EDGES } } },
			rules: { 'kit/edges': 'error' },
		},

		// ---- Where each package runs ---------------------------------------

		{
			// lib.dom is in their tsconfigs for the web standards they use; these
			// are the globals that would tie them to a browser.
			files: ['packages/{protocol,storage,sync}/src/**/*.ts'],
			languageOptions: { globals: globals.browser },
			rules: {
				'no-restricted-globals': [
					'error',
					...BROWSER_ONLY_GLOBALS.map((name) => ({ name, message: PORTABLE_MESSAGE })),
				],
				'no-restricted-imports': ['error', { patterns: [NO_NODE_ANYWHERE] }],
			},
		},
		{
			// names/ sits below the providers, which name files by it; reaching up
			// into them would bring the cycle back. Repeats the block above, which
			// a rule set here replaces rather than adds to.
			files: ['packages/storage/src/names/**/*.ts'],
			rules: {
				'no-restricted-imports': [
					'error',
					{
						patterns: [
							NO_NODE_ANYWHERE,
							NOT_ABOVE(['providers'], 'names/ sits below the providers.'),
						],
					},
				],
			},
		},
		{
			// No Node built-ins anywhere in the Worker's code. `wrangler deploy
			// --dry-run` bundles one without a word, and only the deployed Worker
			// would find out. `pnpm build` refuses it too, through
			// `tsconfig.build.json` (src with no Node types; `tsconfig.json` holds
			// the tests, which pull @types/node in), but this says why, and says it
			// first.
			files: ['packages/server/src/**/*.ts'],
			languageOptions: { globals: globals.node },
			rules: {
				'no-restricted-imports': [
					'error',
					{
						patterns: [
							NO_NODE_IN_THE_WORKER,
							{
								// The rest runs under Node in the tests and knows the
								// runtime only through createApp's seams.
								group: ['cloudflare:*'],
								message:
									'only src/relay/durableObject.ts may name the Workers runtime.',
							},
						],
					},
				],
				// The server reads no configuration of its own: the app's Worker
				// entry reads it and hands it to `createApp`. Importing
				// `node:process`, the third way in, is a Node built-in, refused
				// above.
				'no-restricted-globals': ['error', { name: 'process', message: NO_ENV_MESSAGE }],
				'no-restricted-syntax': [
					'error',
					...RESTRICTED_SYNTAX,
					...CELL_SYNTAX,
					{
						selector:
							"MemberExpression[object.name='globalThis'][property.name='process']",
						message: NO_ENV_MESSAGE,
					},
				],
			},
		},
		{
			// The Durable Object class the app's entry exports, which has to
			// extend `DurableObject` and reach its state through `this.ctx`. Node
			// built-ins stay refused.
			files: ['packages/server/src/relay/durableObject.ts'],
			rules: {
				'no-restricted-imports': ['error', { patterns: [NO_NODE_IN_THE_WORKER] }],
				'functional/no-this-expressions': 'off',
			},
		},
		{
			// Workers has no logger binding and no stdout: `console` is the only
			// sink Cloudflare's observability and `wrangler tail` read. Scoped to
			// the places that report an error, not opened up across the server.
			files: ['packages/server/src/app.ts', 'packages/server/src/log.ts'],
			rules: { 'no-console': 'off' },
		},
		{
			// The client runs in the browser. Its tsconfig has Node's types, for
			// the tests, so typecheck would let a built-in through.
			files: ['packages/client/src/**/*.ts'],
			rules: { 'no-restricted-imports': ['error', { patterns: [NO_NODE_IN_THE_BROWSER] }] },
		},
		{
			// The PWA's build runs in Node, inside the app's Vite config.
			files: ['packages/pwa/src/**/*.ts'],
			languageOptions: { globals: globals.node },
		},

		// ---- Inside the client ---------------------------------------------

		{
			// The store is the data layer: the sync layer drives it, so it does
			// not import the sync layer. Repeats the client's block, which a rule
			// set here replaces rather than adds to.
			files: ['packages/client/src/store/**/*.ts'],
			rules: {
				'no-restricted-imports': [
					'error',
					{
						patterns: [
							NO_NODE_IN_THE_BROWSER,
							NOT_ABOVE(
								['sync'],
								'the store is the data layer: it does not import the sync layer.'
							),
						],
					},
				],
			},
		},
	],
});
