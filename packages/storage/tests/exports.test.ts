import { describe, expect, it } from 'vitest';

import { conflictStamp } from '../src/index.js';
import { conflictStamp as named } from '../src/names/conflicts.js';

/**
 * `@skysa/storage` resolves to `src/index.ts`, so what an app can reach is
 * exactly what that module exports. Most of it is reached by an app's own
 * tests already; what is here is what an app needs that the kit's own code
 * reaches by its module instead.
 */
describe('the package entry', () => {
	it('exports conflictStamp, the stamp every conflict name carries', () => {
		// The same function, so an app that says a copy's stamp beside its
		// name says the name's.
		expect(conflictStamp).toBe(named);
	});
});
