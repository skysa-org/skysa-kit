import { describe, expect, it } from 'vitest';

import { createApp, envWarnings, misconfigured, parseEnv } from '../src/index.js';

/**
 * `@skysa/server` resolves to `src/index.ts` (and the Durable Object to
 * `/relay`), so what an app's Worker entry can reach is exactly what that
 * module exports. An app composes its own entry from `createApp`; that is only
 * true if it can also build a config the way the server's own checks do.
 */
describe('the package entry', () => {
	it('exports parseEnv and envWarnings beside createApp', () => {
		expect(typeof createApp).toBe('function');
		expect(typeof parseEnv).toBe('function');
		expect(typeof envWarnings).toBe('function');
	});

	it('exports misconfigured, the answer while that config is wrong', () => {
		expect(typeof misconfigured).toBe('function');
	});
});
