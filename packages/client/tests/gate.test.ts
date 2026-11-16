import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type ApiClient, ApiError } from '../src/api/client.js';
import {
	ASK_AGAIN_MS,
	askHeldCodeAgain,
	checkConnectCode,
	codeWasRefused,
	useConnectCodeHeldUntil,
} from '../src/connect/gate.js';
import {
	connectCodeAskedAt,
	dropConnectCode,
	heldConnectCode,
	heldConnectCodeShown,
	holdAcceptedCode,
	holdConnectCode,
} from '../src/store/connectCode.js';

/**
 * The rules of an operator's gate that every app had copied: asking the
 * policy about a code typed into it, asking again about a value held in its
 * place, whether a refused connect is about the code, and until when a gate
 * showing a held code shows it. The words are each app's.
 */

const YEAR_S = 365 * 24 * 60 * 60;

const policy = () => ({
	checkConnectCode: vi.fn<ApiClient['checkConnectCode']>(() =>
		Promise.resolve({ ok: true, value: { accepted: true, expiresIn: YEAR_S } })
	),
});

/** A pass the policy gave this device for a typed code, `ago` ms back. */
const passFrom = (ago: number) => {
	const at = Date.now() - ago;
	holdAcceptedCode('INVITE-7', { expiresIn: YEAR_S, hold: 'PASS-1' }, at);
	return at;
};

afterEach(() => {
	vi.useRealTimers();
	dropConnectCode();
});

describe('a code typed into the gate', () => {
	it('is held, or what the policy gave in its place, where the policy takes it', async () => {
		const client = policy();
		client.checkConnectCode.mockResolvedValueOnce({
			ok: true,
			value: { accepted: true, expiresIn: 600, hold: 'PASS-1' },
		});

		expect(await checkConnectCode(client, 'INVITE-7')).toEqual({ kind: 'accepted' });
		expect(heldConnectCode()).toBe('PASS-1');
		expect(heldConnectCodeShown()).toBe(false);

		expect(await checkConnectCode(client, 'INVITE-8')).toEqual({ kind: 'accepted' });
		expect(heldConnectCode()).toBe('INVITE-8');
		expect(heldConnectCodeShown()).toBe(true);
	});

	it("is refused with the policy's reason, where it gave one, and nothing is held", async () => {
		const client = policy();
		client.checkConnectCode
			.mockResolvedValueOnce({
				ok: true,
				value: { accepted: false, reason: 'That code has been used.' },
			})
			.mockResolvedValueOnce({ ok: true, value: { accepted: false } });

		expect(await checkConnectCode(client, 'INVITE-7')).toEqual({
			kind: 'refused',
			reason: 'That code has been used.',
		});
		expect(await checkConnectCode(client, 'INVITE-7')).toEqual({ kind: 'refused' });
		expect(heldConnectCode()).toBeUndefined();
	});

	it('is too many where the instance has had too many guesses from the address', async () => {
		const client = policy();
		client.checkConnectCode.mockRejectedValueOnce(new ApiError('too many', 429));

		expect(await checkConnectCode(client, 'INVITE-7')).toEqual({ kind: 'tooMany' });
		expect(heldConnectCode()).toBeUndefined();
	});

	it('is unchecked where the server would not ask, or gave no answer', async () => {
		const client = policy();
		client.checkConnectCode
			.mockResolvedValueOnce({ ok: false, refusal: 'forbidden_origin' })
			.mockRejectedValueOnce(new ApiError('down', 503))
			.mockRejectedValueOnce(new TypeError('Failed to fetch'));

		expect(await checkConnectCode(client, 'INVITE-7')).toEqual({ kind: 'unchecked' });
		expect(await checkConnectCode(client, 'INVITE-7')).toEqual({ kind: 'unchecked' });
		expect(await checkConnectCode(client, 'INVITE-7')).toEqual({ kind: 'unchecked' });
		expect(heldConnectCode()).toBeUndefined();
	});
});

describe('a held value, asked about again as the app loads', () => {
	const asks = () => vi.fn(() => Promise.resolve(true));

	it('asks nothing while nothing is held, or what is held was typed', async () => {
		const client = policy();
		const asksForCode = asks();
		await askHeldCodeAgain(client, { asksForCode });
		holdConnectCode('INVITE-7', 600);
		await askHeldCodeAgain(client, { asksForCode, refused: true });

		expect(asksForCode).not.toHaveBeenCalled();
		expect(client.checkConnectCode).not.toHaveBeenCalled();
		expect(heldConnectCode()).toBe('INVITE-7');
	});

	it('asks about a pass once its hour is up, and at once after a refused connect', async () => {
		const client = policy();
		const at = passFrom(30 * 60_000);
		await askHeldCodeAgain(client, { asksForCode: asks() });
		expect(client.checkConnectCode).not.toHaveBeenCalled();
		expect(connectCodeAskedAt()).toBe(at);

		await askHeldCodeAgain(client, { asksForCode: asks(), refused: true });
		expect(client.checkConnectCode).toHaveBeenCalledWith('PASS-1');
		expect(connectCodeAskedAt()).toBeGreaterThan(at);

		dropConnectCode();
		passFrom(ASK_AGAIN_MS + 1);
		await askHeldCodeAgain(client, { asksForCode: asks() });
		expect(client.checkConnectCode).toHaveBeenCalledTimes(2);
	});

	it('takes the hour from the clock it is given', async () => {
		const client = policy();
		const at = passFrom(0);

		await askHeldCodeAgain(client, { asksForCode: asks(), now: at + ASK_AGAIN_MS - 1 });
		expect(client.checkConnectCode).not.toHaveBeenCalled();
		await askHeldCodeAgain(client, { asksForCode: asks(), now: at + ASK_AGAIN_MS });
		expect(client.checkConnectCode).toHaveBeenCalledOnce();
	});

	it('holds what the policy gives in its place, still out of sight', async () => {
		const client = policy();
		client.checkConnectCode.mockResolvedValue({
			ok: true,
			value: { accepted: true, expiresIn: YEAR_S, hold: 'PASS-2' },
		});
		passFrom(2 * ASK_AGAIN_MS);
		await askHeldCodeAgain(client, { asksForCode: asks() });

		expect(heldConnectCode()).toBe('PASS-2');
		expect(heldConnectCodeShown()).toBe(false);
	});

	it('lets go of a pass the policy no longer takes', async () => {
		const client = policy();
		client.checkConnectCode.mockResolvedValue({ ok: true, value: { accepted: false } });
		passFrom(2 * ASK_AGAIN_MS);
		await askHeldCodeAgain(client, { asksForCode: asks() });

		expect(heldConnectCode()).toBeUndefined();
	});

	it('keeps a pass it could not ask about, or got no answer about', async () => {
		const client = policy();
		passFrom(2 * ASK_AGAIN_MS);
		client.checkConnectCode.mockResolvedValueOnce({ ok: false, refusal: 'forbidden_origin' });
		await askHeldCodeAgain(client, { asksForCode: asks() });
		client.checkConnectCode.mockRejectedValueOnce(new ApiError('too many', 429));
		await askHeldCodeAgain(client, { asksForCode: asks() });
		await askHeldCodeAgain(client, {
			asksForCode: () => Promise.reject(new TypeError('Failed to fetch')),
		});

		expect(client.checkConnectCode).toHaveBeenCalledTimes(2);
		expect(heldConnectCode()).toBe('PASS-1');
	});

	it('asks whether the gate takes a code only once a pass is held and due, and nothing where it does not', async () => {
		const client = policy();
		const asksForCode = vi.fn(() => Promise.resolve(false));
		passFrom(0);
		await askHeldCodeAgain(client, { asksForCode });
		expect(asksForCode).not.toHaveBeenCalled();

		dropConnectCode();
		passFrom(2 * ASK_AGAIN_MS);
		await askHeldCodeAgain(client, { asksForCode });

		expect(asksForCode).toHaveBeenCalledOnce();
		expect(client.checkConnectCode).not.toHaveBeenCalled();
		expect(heldConnectCode()).toBe('PASS-1');
	});

	it('takes the answer to whether the gate takes a code as it is, where the app knows it already', async () => {
		const client = policy();
		passFrom(2 * ASK_AGAIN_MS);
		await askHeldCodeAgain(client, { asksForCode: () => true });

		expect(client.checkConnectCode).toHaveBeenCalledWith('PASS-1');
	});

	it('changes nothing with an answer about a value no longer held', async () => {
		const client = policy();
		client.checkConnectCode.mockImplementation(() => {
			// A new code typed while the policy was being asked about the pass.
			holdConnectCode('INVITE-8', 600);
			return Promise.resolve({ ok: true, value: { accepted: false } });
		});
		passFrom(2 * ASK_AGAIN_MS);
		await askHeldCodeAgain(client, { asksForCode: asks() });

		expect(heldConnectCode()).toBe('INVITE-8');
	});
});

describe('a refused connect', () => {
	it('is about the code typed into the gate where the policy said a plain no', () => {
		holdConnectCode('INVITE-7', 600);

		expect(codeWasRefused(undefined)).toBe(true);
		expect(codeWasRefused('not_allowed')).toBe(true);
		expect(codeWasRefused('lapsed')).toBe(false);
		expect(codeWasRefused('limit_reached')).toBe(false);
	});

	it('is not about a pass the policy gave, or about nothing held', () => {
		expect(codeWasRefused(undefined)).toBe(false);
		passFrom(0);
		expect(codeWasRefused('not_allowed')).toBe(false);
	});
});

describe('until when a gate shows the code held', () => {
	const NOW = Date.parse('2026-11-15T12:00:00Z');

	it('is when the hold ends, and nothing once it has, with the lapse told which code it was', () => {
		vi.useFakeTimers({ now: NOW });
		holdConnectCode('INVITE-7', 600, NOW);
		const lapsed = vi.fn();
		const { result } = renderHook(() => useConnectCodeHeldUntil(lapsed));
		expect(result.current).toBe(NOW + 600_000);

		act(() => {
			vi.advanceTimersByTime(600_000 + 50);
		});

		expect(result.current).toBeUndefined();
		expect(lapsed).toHaveBeenCalledExactlyOnceWith('INVITE-7');
		// Let go of by the timer, not by a read in a render.
		expect(localStorage.getItem('skysa.connectCode')).toBeNull();
	});

	it('follows a code taken or dropped in this tab or another', () => {
		vi.useFakeTimers({ now: NOW });
		const { result } = renderHook(() => useConnectCodeHeldUntil());
		expect(result.current).toBeUndefined();

		act(() => {
			holdConnectCode('INVITE-7', 600, NOW);
		});
		expect(result.current).toBe(NOW + 600_000);

		act(() => {
			localStorage.removeItem('skysa.connectCode');
			window.dispatchEvent(new StorageEvent('storage', { key: 'skysa.connectCode' }));
		});
		expect(result.current).toBeUndefined();
	});

	it('wakes no later than a browser can count to, for a hold of a year, and holds on', () => {
		vi.useFakeTimers({ now: NOW });
		const set = vi.spyOn(globalThis, 'setTimeout');
		holdAcceptedCode('INVITE-7', { expiresIn: YEAR_S, hold: 'PASS-1' }, NOW);
		const lapsed = vi.fn();
		const { result } = renderHook(() => useConnectCodeHeldUntil(lapsed));

		// A timer past 2³¹ ms fires at once in a browser, and these fakes wait
		// it out: so it is set to that at most, and set again once it wakes.
		act(() => {
			vi.advanceTimersByTime(2 ** 31 - 1);
		});

		const delays = set.mock.calls.map(([, ms]) => ms ?? 0);
		expect(Math.max(...delays)).toBe(2 ** 31 - 1);
		expect(delays.filter((ms) => ms === 2 ** 31 - 1)).toHaveLength(2);
		expect(result.current).toBe(NOW + YEAR_S * 1000);
		expect(lapsed).not.toHaveBeenCalled();
	});
});
