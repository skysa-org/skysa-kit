import { afterEach, expect, it, vi } from 'vitest';

import type { ApiClient } from '../src/api/client.js';
import { askHeldCodeAgain } from '../src/connect/gate.js';
import { dropConnectCode, holdAcceptedCode } from '../src/store/connectCode.js';

/**
 * When the page loaded, which the gate reads as it is imported, put hours
 * before the clock the stamps are on, as a browser may put
 * `performance.timeOrigin` once the device has slept.
 */

vi.hoisted(() => {
	vi.spyOn(performance, 'timeOrigin', 'get').mockReturnValue(Date.now() - 3 * 60 * 60_000);
});

const YEAR_S = 365 * 24 * 60 * 60;

afterEach(() => {
	vi.restoreAllMocks();
	dropConnectCode();
});

it('asks at once after a refused connect about a pass given in an earlier load', async () => {
	const client = {
		checkConnectCode: vi.fn<ApiClient['checkConnectCode']>(() =>
			Promise.resolve({ ok: true, value: { accepted: true, expiresIn: YEAR_S } })
		),
	};
	// Given in an earlier load, half an hour back.
	holdAcceptedCode('INVITE-7', { expiresIn: YEAR_S, hold: 'PASS-1' }, Date.now() - 30 * 60_000);
	await askHeldCodeAgain(client, {
		asksForCode: () => Promise.resolve(true),
		refused: true,
	});

	expect(client.checkConnectCode).toHaveBeenCalledExactlyOnceWith('PASS-1');
});
