import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type ApiClient, ApiError } from '../src/api/client.js';
import {
	ASK_AGAIN_MS,
	askAboutConnectCode,
	askHeldCodeAgain,
	codeWasRefused,
	useConnectCodeHeldUntil,
} from '../src/connect/gate.js';
import {
	connectCodeAskedAt,
	connectCodeTried,
	dropConnectCode,
	heldConnectCode,
	heldConnectCodeShown,
	holdAcceptedCode,
	holdConnectCode,
	watchConnectCode,
} from '../src/store/connectCode.js';

/**
 * The rules of an operator's gate that every app had copied: asking the
 * policy about a code typed into it, asking again about a value held in its
 * place, whether a refused connect is about the code, and until when a gate
 * showing a held code shows it. The words are each app's.
 */

const YEAR_S = 365 * 24 * 60 * 60;
const LOCK = 'skysa.connectCode.askAgain';
const NOW = Date.parse('2026-11-15T12:00:00Z');

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
	// Unmounted first, so letting go of the code tells no hook still showing it.
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	dropConnectCode();
});

describe('a code typed into the gate', () => {
	it('is held, or what the policy gave in its place, where the policy takes it', async () => {
		const client = policy();
		client.checkConnectCode.mockResolvedValueOnce({
			ok: true,
			value: { accepted: true, expiresIn: 600, hold: 'PASS-1' },
		});

		expect(await askAboutConnectCode(client, 'INVITE-7')).toEqual({ kind: 'accepted' });
		expect(heldConnectCode()).toBe('PASS-1');
		expect(heldConnectCodeShown()).toBe(false);

		expect(await askAboutConnectCode(client, 'INVITE-8')).toEqual({ kind: 'accepted' });
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

		expect(await askAboutConnectCode(client, 'INVITE-7')).toEqual({
			kind: 'refused',
			reason: 'That code has been used.',
		});
		expect(await askAboutConnectCode(client, 'INVITE-7')).toEqual({ kind: 'refused' });
		expect(heldConnectCode()).toBeUndefined();
	});

	it('is too many where the instance has had too many guesses from the address', async () => {
		const client = policy();
		client.checkConnectCode.mockRejectedValueOnce(new ApiError('too many', 429));

		expect(await askAboutConnectCode(client, 'INVITE-7')).toEqual({ kind: 'tooMany' });
		expect(heldConnectCode()).toBeUndefined();
	});

	it('lets a fault in holding what the policy took be seen, not called unchecked', async () => {
		const client = policy();
		const stop = watchConnectCode(() => {
			throw new Error('a watcher that throws');
		});

		await expect(askAboutConnectCode(client, 'INVITE-7')).rejects.toThrow(
			'a watcher that throws'
		);
		stop();
	});

	it('is unchecked where the server would not ask, or gave no answer', async () => {
		const client = policy();
		client.checkConnectCode
			.mockResolvedValueOnce({ ok: false, refusal: 'forbidden_origin' })
			.mockRejectedValueOnce(new ApiError('down', 503))
			.mockRejectedValueOnce(new TypeError('Failed to fetch'));

		expect(await askAboutConnectCode(client, 'INVITE-7')).toEqual({ kind: 'unchecked' });
		expect(await askAboutConnectCode(client, 'INVITE-7')).toEqual({ kind: 'unchecked' });
		expect(await askAboutConnectCode(client, 'INVITE-7')).toEqual({ kind: 'unchecked' });
		expect(heldConnectCode()).toBeUndefined();
	});
});

describe('a held value, asked about again as the app loads', () => {
	const asks = () => vi.fn(() => Promise.resolve(true));

	it('asks nothing while nothing is held, or what is held was typed', async () => {
		const client = policy();
		const asksForCode = asks();
		await askHeldCodeAgain(client, { asksForCode });
		// Typed long enough ago that a pass would be due.
		holdConnectCode('INVITE-7', 3 * 60 * 60, Date.now() - 2 * ASK_AGAIN_MS);
		await askHeldCodeAgain(client, { asksForCode });
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

	it('asks nothing after a refused connect about a pass given in this load, after the refusal', async () => {
		const client = policy();
		passFrom(0);
		await askHeldCodeAgain(client, { asksForCode: asks(), refused: true });

		expect(client.checkConnectCode).not.toHaveBeenCalled();
	});

	it('asks once after a refused connect where the clock has gone back past this load, not on every call', async () => {
		const client = policy();
		passFrom(30 * 60_000);
		const back = Date.now() - 10 * ASK_AGAIN_MS;
		client.checkConnectCode.mockResolvedValue({ ok: false, refusal: 'forbidden_origin' });
		await askHeldCodeAgain(client, { asksForCode: asks(), refused: true, now: back });
		await askHeldCodeAgain(client, { asksForCode: asks(), refused: true, now: back });

		expect(client.checkConnectCode).toHaveBeenCalledOnce();
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

	it('keeps a pass it could not ask about, or got no answer about, and waits the hour after each asking', async () => {
		const client = policy();
		passFrom(2 * ASK_AGAIN_MS);
		const at = Date.now();
		client.checkConnectCode.mockResolvedValueOnce({ ok: false, refusal: 'forbidden_origin' });
		await askHeldCodeAgain(client, { asksForCode: asks(), now: at });
		await askHeldCodeAgain(client, { asksForCode: asks(), now: at + ASK_AGAIN_MS - 1 });
		expect(client.checkConnectCode).toHaveBeenCalledOnce();

		client.checkConnectCode.mockRejectedValueOnce(new ApiError('too many', 429));
		await askHeldCodeAgain(client, { asksForCode: asks(), now: at + ASK_AGAIN_MS });
		await askHeldCodeAgain(client, { asksForCode: asks(), now: at + 2 * ASK_AGAIN_MS - 1 });
		expect(client.checkConnectCode).toHaveBeenCalledTimes(2);

		expect(heldConnectCode()).toBe('PASS-1');
	});

	it('waits the hour after an asking that could not say whether the gate takes a code', async () => {
		const client = policy();
		passFrom(2 * ASK_AGAIN_MS);
		const failing = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
		await askHeldCodeAgain(client, { asksForCode: failing });
		const asksForCode = asks();
		await askHeldCodeAgain(client, { asksForCode });

		expect(failing).toHaveBeenCalledOnce();
		expect(asksForCode).not.toHaveBeenCalled();
		expect(client.checkConnectCode).not.toHaveBeenCalled();
		expect(heldConnectCode()).toBe('PASS-1');
	});

	it('lets a fault that is not about the answer be seen', async () => {
		const client = policy();
		passFrom(2 * ASK_AGAIN_MS);
		// Told first that the pass is being asked about, and then of the answer.
		const stop = watchConnectCode(
			vi
				.fn()
				.mockImplementationOnce(() => undefined)
				.mockImplementation(() => {
					throw new Error('a watcher that throws');
				})
		);

		await expect(askHeldCodeAgain(client, { asksForCode: asks() })).rejects.toThrow(
			'a watcher that throws'
		);
		stop();
	});

	it('asks alone where the browser refuses the lock, and lets a fault while holding it be seen', async () => {
		const client = policy();
		passFrom(2 * ASK_AGAIN_MS);
		vi.stubGlobal('navigator', {
			locks: {
				request: () =>
					Promise.reject(new DOMException('The operation is insecure.', 'SecurityError')),
			},
		});
		await askHeldCodeAgain(client, { asksForCode: asks() });
		expect(client.checkConnectCode).toHaveBeenCalledOnce();

		dropConnectCode();
		passFrom(2 * ASK_AGAIN_MS);
		vi.stubGlobal('navigator', {
			locks: {
				request: (
					name: string,
					_options: LockOptions,
					work: LockGrantedCallback<unknown>
				) => Promise.resolve(work({ name, mode: 'exclusive' })),
			},
		});
		const stop = watchConnectCode(
			vi
				.fn()
				.mockImplementationOnce(() => undefined)
				.mockImplementation(() => {
					throw new Error('a watcher that throws');
				})
		);
		await expect(askHeldCodeAgain(client, { asksForCode: asks() })).rejects.toThrow(
			'a watcher that throws'
		);
		stop();
		expect(client.checkConnectCode).toHaveBeenCalledTimes(2);
	});

	it('judges again once it has the lock it waited for, and asks nothing where another tab asked meanwhile', async () => {
		const client = policy();
		// Today, so that the clock is past this load's start, as a refused connect needs.
		vi.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
		// Given in an earlier load, half an hour back.
		passFrom(30 * 60_000);
		vi.stubGlobal('navigator', {
			locks: {
				request: (
					name: string,
					_options: LockOptions,
					work: LockGrantedCallback<unknown>
				) => {
					// Another tab, holding the lock for a second until it had its answer.
					vi.setSystemTime(Date.now() + 1000);
					connectCodeTried('PASS-1');
					holdAcceptedCode('PASS-1', { expiresIn: YEAR_S });
					return Promise.resolve(work({ name, mode: 'exclusive' }));
				},
			},
		});
		await askHeldCodeAgain(client, { asksForCode: asks(), refused: true });

		expect(client.checkConnectCode).not.toHaveBeenCalled();
	});

	it('takes no lock where nothing is due, and waits for it after a refused connect', async () => {
		const client = policy();
		const request = vi.fn(
			(_name: string, options: LockOptions, work: LockGrantedCallback<unknown>) =>
				Promise.resolve(
					work(options.ifAvailable === true ? null : { name: LOCK, mode: 'exclusive' })
				)
		);
		vi.stubGlobal('navigator', { locks: { request } });
		await askHeldCodeAgain(client, { asksForCode: asks(), refused: true });
		passFrom(0);
		await askHeldCodeAgain(client, { asksForCode: asks() });
		expect(request).not.toHaveBeenCalled();

		dropConnectCode();
		// Given in an earlier load, half an hour back.
		passFrom(30 * 60_000);
		await askHeldCodeAgain(client, { asksForCode: asks(), refused: true });

		expect(request).toHaveBeenCalledExactlyOnceWith(
			LOCK,
			{ ifAvailable: false },
			expect.any(Function)
		);
		expect(client.checkConnectCode).toHaveBeenCalledWith('PASS-1');
	});

	it('asks nothing where another tab is asking already, and asks holding the lock where none is', async () => {
		const client = policy();
		passFrom(2 * ASK_AGAIN_MS);
		const taken = vi.fn(
			(_name: string, _options: LockOptions, work: LockGrantedCallback<unknown>) =>
				Promise.resolve(work(null))
		);
		vi.stubGlobal('navigator', { locks: { request: taken } });
		const asksForCode = asks();
		await askHeldCodeAgain(client, { asksForCode });
		expect(asksForCode).not.toHaveBeenCalled();

		const free = vi.fn(
			(name: string, _options: LockOptions, work: LockGrantedCallback<unknown>) =>
				Promise.resolve(work({ name, mode: 'exclusive' }))
		);
		vi.stubGlobal('navigator', { locks: { request: free } });
		await askHeldCodeAgain(client, { asksForCode });

		expect(taken).toHaveBeenCalledWith(
			'skysa.connectCode.askAgain',
			{ ifAvailable: true },
			expect.any(Function)
		);
		expect(free).toHaveBeenCalledWith(
			'skysa.connectCode.askAgain',
			{ ifAvailable: true },
			expect.any(Function)
		);
		expect(client.checkConnectCode).toHaveBeenCalledOnce();
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

	it('takes a clock set back since the policy answered as due, once, answered or not', async () => {
		const client = policy();
		passFrom(-10 * 60_000);
		client.checkConnectCode.mockResolvedValue({ ok: false, refusal: 'forbidden_origin' });
		await askHeldCodeAgain(client, { asksForCode: asks() });
		await askHeldCodeAgain(client, { asksForCode: asks() });

		expect(client.checkConnectCode).toHaveBeenCalledExactlyOnceWith('PASS-1');
	});

	it('judges and stamps by the clock it is given, so one held still asks once', async () => {
		const client = policy();
		passFrom(2 * ASK_AGAIN_MS);
		const now = Date.now() - 60_000;
		await askHeldCodeAgain(client, { asksForCode: asks(), now });
		await askHeldCodeAgain(client, { asksForCode: asks(), now });

		expect(client.checkConnectCode).toHaveBeenCalledOnce();
		expect(connectCodeAskedAt(now)).toBe(now);
	});

	it('still asks where storage will not take the stamp, once in the load', async () => {
		const client = policy();
		passFrom(2 * ASK_AGAIN_MS);
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
		});
		await askHeldCodeAgain(client, { asksForCode: asks() });
		await askHeldCodeAgain(client, { asksForCode: asks(), refused: true });

		expect(client.checkConnectCode).toHaveBeenCalledExactlyOnceWith('PASS-1');
	});

	it('asks nothing where a watcher told of the asking holds something else', async () => {
		const client = policy();
		passFrom(2 * ASK_AGAIN_MS);
		const stop = watchConnectCode(
			vi.fn().mockImplementationOnce(() => {
				holdConnectCode('INVITE-8', 600);
			})
		);
		await askHeldCodeAgain(client, { asksForCode: asks() });
		stop();

		expect(client.checkConnectCode).not.toHaveBeenCalled();
		expect(heldConnectCode()).toBe('INVITE-8');
	});

	it('keeps a renewal of a pass that ran out while the policy was asked, still never shown', async () => {
		vi.useFakeTimers({ now: NOW });
		const client = policy();
		holdAcceptedCode(
			'INVITE-7',
			{ expiresIn: 2 * 60 * 60, hold: 'PASS-1' },
			NOW - 2 * ASK_AGAIN_MS + 1
		);
		client.checkConnectCode.mockImplementation(() => {
			// The answer comes after the end, and a read in the meantime lets the pass go.
			vi.setSystemTime(NOW + 10_000);
			expect(heldConnectCode()).toBeUndefined();
			return Promise.resolve({ ok: true, value: { accepted: true, expiresIn: YEAR_S } });
		});
		await askHeldCodeAgain(client, { asksForCode: asks() });

		expect(client.checkConnectCode).toHaveBeenCalledWith('PASS-1');
		expect(heldConnectCode()).toBe('PASS-1');
		expect(heldConnectCodeShown()).toBe(false);
	});

	it('asks nothing where the pass was asked about, dropped, or a code typed, while the gate said whether it takes one', async () => {
		const client = policy();
		passFrom(2 * ASK_AGAIN_MS);
		await askHeldCodeAgain(client, {
			asksForCode: () => {
				// Another tab, loading too, has had its answer: the same pass, renewed.
				holdAcceptedCode('PASS-1', { expiresIn: YEAR_S });
				return true;
			},
		});
		dropConnectCode();
		passFrom(2 * ASK_AGAIN_MS);
		await askHeldCodeAgain(client, {
			asksForCode: () => {
				// Or a fresh one in its place.
				holdAcceptedCode('PASS-1', { expiresIn: YEAR_S, hold: 'PASS-2' });
				return true;
			},
		});
		dropConnectCode();
		passFrom(2 * ASK_AGAIN_MS);
		await askHeldCodeAgain(client, {
			asksForCode: () => {
				dropConnectCode();
				return true;
			},
		});
		passFrom(2 * ASK_AGAIN_MS);
		await askHeldCodeAgain(client, {
			asksForCode: () => {
				holdConnectCode('INVITE-8', 600);
				return true;
			},
		});

		expect(client.checkConnectCode).not.toHaveBeenCalled();
		expect(heldConnectCode()).toBe('INVITE-8');
	});

	it('asks once where two ask together, and after a refused connect once in a load', async () => {
		const client = policy();
		passFrom(2 * ASK_AGAIN_MS);
		const refused = { asksForCode: asks(), refused: true };
		await Promise.all([askHeldCodeAgain(client, refused), askHeldCodeAgain(client, refused)]);
		expect(client.checkConnectCode).toHaveBeenCalledOnce();

		await askHeldCodeAgain(client, refused);
		await askHeldCodeAgain(client, { ...refused, now: Date.now() + ASK_AGAIN_MS - 60_000 });
		expect(client.checkConnectCode).toHaveBeenCalledOnce();
		await askHeldCodeAgain(client, { ...refused, now: Date.now() + ASK_AGAIN_MS });
		expect(client.checkConnectCode).toHaveBeenCalledTimes(2);
	});

	it('asks after a refused connect about a pass renewed in an earlier load, however lately', async () => {
		const client = policy();
		const earlier = Date.now() - 30 * 60_000;
		holdAcceptedCode('INVITE-7', { expiresIn: YEAR_S, hold: 'PASS-1' }, earlier);
		connectCodeTried('PASS-1', earlier);
		await askHeldCodeAgain(client, { asksForCode: asks() });
		expect(client.checkConnectCode).not.toHaveBeenCalled();

		await askHeldCodeAgain(client, { asksForCode: asks(), refused: true });
		expect(client.checkConnectCode).toHaveBeenCalledWith('PASS-1');
	});

	it('takes nothing back that was dropped before its end while the policy was asked', async () => {
		const client = policy();
		client.checkConnectCode.mockImplementation(() => {
			dropConnectCode();
			return Promise.resolve({ ok: true, value: { accepted: true, expiresIn: YEAR_S } });
		});
		passFrom(2 * ASK_AGAIN_MS);
		await askHeldCodeAgain(client, { asksForCode: asks() });

		expect(heldConnectCode()).toBeUndefined();
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

		expect(codeWasRefused({ refused: true })).toBe(true);
		expect(codeWasRefused({ refused: true, code: 'not_allowed' })).toBe(true);
		expect(codeWasRefused({ refused: true, code: 'lapsed' })).toBe(false);
		expect(codeWasRefused({ refused: true, code: 'limit_reached' })).toBe(false);
	});

	it('is not a connect that was not refused, or about a pass the policy gave, or about nothing held', () => {
		holdConnectCode('INVITE-7', 600);
		expect(codeWasRefused({ refused: false })).toBe(false);
		dropConnectCode();
		expect(codeWasRefused({ refused: true })).toBe(false);
		passFrom(0);
		expect(codeWasRefused({ refused: true, code: 'not_allowed' })).toBe(false);
	});
});

describe('until when a gate shows the code held', () => {
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

	it('follows a code taken, replaced or dropped in this tab or another, none of which is a lapse', () => {
		vi.useFakeTimers({ now: NOW });
		const lapsed = vi.fn();
		const { result } = renderHook(() => useConnectCodeHeldUntil(lapsed));
		expect(result.current).toBeUndefined();

		act(() => {
			holdConnectCode('INVITE-7', 600, NOW);
		});
		expect(result.current).toBe(NOW + 600_000);
		act(() => {
			holdConnectCode('INVITE-8', 900, NOW);
		});
		expect(result.current).toBe(NOW + 900_000);

		act(() => {
			localStorage.removeItem('skysa.connectCode');
			window.dispatchEvent(new StorageEvent('storage', { key: 'skysa.connectCode' }));
		});
		expect(result.current).toBeUndefined();
		expect(lapsed).not.toHaveBeenCalled();
	});

	it('is not told of a code that had run out before the hook could show it, and lets it go before a paint', () => {
		vi.useFakeTimers({ now: NOW + 600_000 });
		holdConnectCode('INVITE-7', 600, NOW);
		const lapsed = vi.fn();
		const { result, unmount } = renderHook(() => useConnectCodeHeldUntil(lapsed));

		expect(result.current).toBeUndefined();
		expect(localStorage.getItem('skysa.connectCode')).toBeNull();
		unmount();

		// Rendered a moment before the end, with its effects after it.
		vi.setSystemTime(NOW + 599_999);
		holdConnectCode('INVITE-8', 600, NOW);
		renderHook(() => {
			const until = useConnectCodeHeldUntil(lapsed);
			vi.setSystemTime(Math.max(Date.now(), NOW + 600_000));
			return until;
		});

		expect(lapsed).not.toHaveBeenCalled();
	});

	it('tells the latest function of a lapse, given a new one in a render after the end', () => {
		vi.useFakeTimers({ now: NOW });
		holdConnectCode('INVITE-7', 600, NOW);
		const first = vi.fn();
		const latest = vi.fn();
		const { rerender } = renderHook(
			({ onLapse }: Readonly<{ onLapse: (code: string) => void }>) =>
				useConnectCodeHeldUntil(onLapse),
			{ initialProps: { onLapse: first } }
		);

		vi.setSystemTime(NOW + 600_000);
		rerender({ onLapse: latest });
		act(() => {
			vi.advanceTimersByTime(600_000);
		});

		expect(first).not.toHaveBeenCalled();
		expect(latest).toHaveBeenCalledExactlyOnceWith('INVITE-7');
	});

	it('is not told of a lapse where a pass is held in its place before it is let go of', () => {
		vi.useFakeTimers({ now: NOW });
		holdConnectCode('INVITE-7', 600, NOW);
		const lapsed = vi.fn();
		renderHook(() => useConnectCodeHeldUntil(lapsed));

		vi.setSystemTime(NOW + 600_010);
		act(() => {
			holdAcceptedCode('INVITE-8', { expiresIn: YEAR_S, hold: 'PASS-1' }, NOW + 600_010);
		});

		expect(lapsed).not.toHaveBeenCalled();
	});

	it('is never told of a value the policy gave to hold, which is never shown', () => {
		vi.useFakeTimers({ now: NOW });
		holdAcceptedCode('INVITE-7', { expiresIn: 600, hold: 'PASS-1' }, NOW);
		const lapsed = vi.fn();
		const { result } = renderHook(() => useConnectCodeHeldUntil(lapsed));
		expect(result.current).toBe(NOW + 600_000);

		act(() => {
			vi.advanceTimersByTime(600_000 + 50);
		});

		expect(result.current).toBeUndefined();
		expect(lapsed).not.toHaveBeenCalled();
	});

	it('is not told of a lapse where a code is typed over it before it is let go of, the same or another', () => {
		vi.useFakeTimers({ now: NOW });
		holdConnectCode('INVITE-7', 600, NOW);
		const lapsed = vi.fn();
		const { result } = renderHook(() => useConnectCodeHeldUntil(lapsed));

		vi.setSystemTime(NOW + 600_010);
		act(() => {
			holdConnectCode('INVITE-7', 600, NOW + 600_010);
		});
		expect(result.current).toBe(NOW + 1_200_010);

		vi.setSystemTime(NOW + 1_200_020);
		act(() => {
			holdConnectCode('INVITE-8', 600, NOW + 1_200_020);
		});

		expect(result.current).toBe(NOW + 1_800_020);
		expect(lapsed).not.toHaveBeenCalled();
	});

	it('tells the lapse however its end is seen: a read elsewhere after it, or another tab letting it go', async () => {
		vi.useFakeTimers({ now: NOW });
		holdConnectCode('INVITE-7', 600, NOW);
		const lapsed = vi.fn();
		const { result, unmount } = renderHook(() => useConnectCodeHeldUntil(lapsed));

		// Past the end before the timer has fired: a tab woken from sleep, and
		// the gate reading the code as it renders.
		vi.setSystemTime(NOW + 600_000);
		expect(heldConnectCode()).toBeUndefined();
		await act(() => Promise.resolve());
		expect(result.current).toBeUndefined();
		expect(lapsed).toHaveBeenCalledExactlyOnceWith('INVITE-7');
		expect(localStorage.getItem('skysa.connectCode')).toBeNull();
		unmount();

		holdConnectCode('INVITE-8', 600, NOW + 600_000);
		const other = renderHook(() => useConnectCodeHeldUntil(lapsed));
		vi.setSystemTime(NOW + 1_200_000);
		act(() => {
			localStorage.removeItem('skysa.connectCode');
			window.dispatchEvent(new StorageEvent('storage', { key: 'skysa.connectCode' }));
		});
		expect(other.result.current).toBeUndefined();
		expect(lapsed).toHaveBeenCalledTimes(2);
		expect(lapsed).toHaveBeenLastCalledWith('INVITE-8');
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
