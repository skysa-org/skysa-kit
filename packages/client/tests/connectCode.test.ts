import { MAX_CONNECT_CODE } from '@skysa/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	connectCodeAskedAt,
	connectCodeHeldUntil,
	connectCodeTried,
	dropConnectCode,
	forgetLapsedConnectCode,
	heldConnectCode,
	heldConnectCodeRecord,
	heldConnectCodeShown,
	holdAcceptedCode,
	holdConnectCode,
	renewHeldConnectCode,
	storedConnectCode,
	watchConnectCode,
} from '../src/store/connectCode.js';

/**
 * The code the operator's policy accepted at the connect gate, held for as
 * long as the policy said, so it outlives the round trip through the
 * provider's consent screen and a closed tab, and nothing after that.
 */

const NOW = Date.parse('2026-09-29T15:00:00Z');

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	localStorage.clear();
	dropConnectCode();
});

describe('the connect code held for as long as it is good', () => {
	it('is nothing until one is accepted', () => {
		expect(heldConnectCode()).toBeUndefined();
		expect(connectCodeHeldUntil()).toBeUndefined();
	});

	it('is kept in local storage, with the time it stops being good', () => {
		holdConnectCode('K7QM-2XRD', 900, NOW);

		expect(localStorage.length).toBe(1);
		expect(heldConnectCode(NOW + 1000)).toBe('K7QM-2XRD');
		expect(connectCodeHeldUntil(NOW)).toBe(NOW + 900_000);
	});

	it('is nothing once that time has come, and let go of just after it is read so', async () => {
		holdConnectCode('K7QM-2XRD', 900, NOW);

		expect(heldConnectCode(NOW + 899_999)).toBe('K7QM-2XRD');
		await Promise.resolve();
		expect(localStorage.length).toBe(1);

		expect(heldConnectCode(NOW + 900_000)).toBeUndefined();
		expect(connectCodeHeldUntil(NOW + 900_000)).toBeUndefined();
		expect(localStorage.length).toBe(1);
		await Promise.resolve();
		expect(localStorage.length).toBe(0);
	});

	it('tells no one as it is read, past its time or not, and once just after where it was past', async () => {
		holdConnectCode('K7QM-2XRD', 900, NOW);
		const told = vi.fn();
		const stop = watchConnectCode(told);

		// What a render reads: a watcher told then sets another component's
		// state in the middle of it.
		heldConnectCode(NOW);
		heldConnectCode(NOW + 900_000);
		connectCodeHeldUntil(NOW + 900_000);
		heldConnectCodeShown(NOW + 900_000);
		connectCodeAskedAt(NOW + 900_000);
		expect(told).not.toHaveBeenCalled();

		await Promise.resolve();
		stop();
		expect(told).toHaveBeenCalledOnce();
	});

	it("is not let go of by a read at a time ahead of this device's clock", async () => {
		holdConnectCode('K7QM-2XRD', 900);

		expect(heldConnectCode(Date.now() + 900_000)).toBeUndefined();
		await Promise.resolve();
		expect(heldConnectCode()).toBe('K7QM-2XRD');
	});

	it('is let go of where its time has come, and only then, telling whoever is watching', () => {
		holdConnectCode('K7QM-2XRD', 900, NOW);
		const told = vi.fn();
		const stop = watchConnectCode(told);

		forgetLapsedConnectCode(NOW + 899_999);
		expect(heldConnectCode(NOW)).toBe('K7QM-2XRD');
		forgetLapsedConnectCode(NOW + 900_000);
		stop();

		expect(localStorage.length).toBe(0);
		expect(told).toHaveBeenCalledOnce();
	});

	it('is held trimmed, and a blank one, or one good for no time, is none', () => {
		holdConnectCode('  K7QM-2XRD ', 900, NOW);
		expect(heldConnectCode(NOW)).toBe('K7QM-2XRD');

		holdConnectCode('   ', 900, NOW);
		expect(heldConnectCode(NOW)).toBeUndefined();
		expect(localStorage.length).toBe(0);

		holdConnectCode('K7QM-2XRD', 0, NOW);
		expect(heldConnectCode(NOW)).toBeUndefined();
	});

	it('is held to the bound the server takes', () => {
		holdConnectCode('x'.repeat(MAX_CONNECT_CODE + 16), 900, NOW);
		expect(heldConnectCode(NOW)).toBe('x'.repeat(MAX_CONNECT_CODE));
	});

	it('goes when it is dropped', () => {
		holdConnectCode('K7QM-2XRD', 900, NOW);
		dropConnectCode();
		expect(heldConnectCode(NOW)).toBeUndefined();
	});

	it('reads anything it did not write as nothing', () => {
		for (const stored of ['K7QM-2XRD', '{"code":"K7QM-2XRD"}', '{"code":7,"until":1}', '[']) {
			localStorage.setItem('skysa.connectCode', stored);
			expect(heldConnectCode(NOW)).toBeUndefined();
		}
	});

	it('is still there to send where the browser refuses storage, until its time', () => {
		const refusing = () => {
			throw new DOMException('The operation is insecure.', 'SecurityError');
		};
		vi.stubGlobal('localStorage', {
			getItem: refusing,
			setItem: refusing,
			removeItem: refusing,
		});

		holdConnectCode('K7QM-2XRD', 900, NOW);
		expect(heldConnectCode(NOW)).toBe('K7QM-2XRD');
		expect(heldConnectCode(NOW + 900_000)).toBeUndefined();

		holdConnectCode('K7QM-2XRD', 900, NOW);
		dropConnectCode();
		expect(heldConnectCode(NOW)).toBeUndefined();
	});
});

describe('what the policy gives to hold in place of a code', () => {
	const PASS = `dt1.${'Ab_-'.repeat(40)}`;

	it('is held in place of what was typed, for as long as the policy said, and never shown', () => {
		holdAcceptedCode('K7QM-2XRD', { expiresIn: 180 * 86_400, hold: PASS }, NOW);

		expect(heldConnectCode(NOW)).toBe(PASS);
		expect(connectCodeHeldUntil(NOW)).toBe(NOW + 180 * 86_400_000);
		expect(heldConnectCodeShown(NOW)).toBe(false);
	});

	it('leaves a code the policy gave nothing for held as typed, and shown', () => {
		holdAcceptedCode(' K7QM-2XRD ', { expiresIn: 900 }, NOW);

		expect(heldConnectCode(NOW)).toBe('K7QM-2XRD');
		expect(heldConnectCodeShown(NOW)).toBe(true);
	});

	it('stays unshown when it is asked about again and kept as it is', () => {
		holdAcceptedCode('K7QM-2XRD', { expiresIn: 60, hold: PASS }, NOW);
		holdAcceptedCode(PASS, { expiresIn: 120 }, NOW);

		expect(heldConnectCode(NOW)).toBe(PASS);
		expect(connectCodeHeldUntil(NOW)).toBe(NOW + 120_000);
		expect(heldConnectCodeShown(NOW)).toBe(false);
	});

	it('is replaced by a code typed after it, which is shown', () => {
		holdAcceptedCode('K7QM-2XRD', { expiresIn: 60, hold: PASS }, NOW);
		holdAcceptedCode('W3TB-9HQP', { expiresIn: 900 }, NOW);

		expect(heldConnectCode(NOW)).toBe('W3TB-9HQP');
		expect(heldConnectCodeShown(NOW)).toBe(true);
	});

	it('reads a code kept before there were holds as typed, asked about at no known time', () => {
		localStorage.setItem(
			'skysa.connectCode',
			JSON.stringify({ code: 'K7QM-2XRD', until: NOW + 60_000 })
		);

		expect(heldConnectCode(NOW)).toBe('K7QM-2XRD');
		expect(heldConnectCodeShown(NOW)).toBe(true);
		expect(connectCodeAskedAt(NOW)).toBe(0);
		expect(heldConnectCodeRecord(NOW)?.tried).toBe(0);
	});

	it('remembers when the policy last answered about it', () => {
		holdAcceptedCode('K7QM-2XRD', { expiresIn: 60, hold: PASS }, NOW);
		holdAcceptedCode(PASS, { expiresIn: 60 }, NOW + 30_000);

		expect(connectCodeAskedAt(NOW + 30_000)).toBe(NOW + 30_000);
	});

	it('remembers when this device asked about it again, answered or not, and keeps that through the answer', () => {
		holdAcceptedCode('K7QM-2XRD', { expiresIn: 60, hold: PASS }, NOW);
		expect(heldConnectCodeRecord(NOW)?.tried).toBe(0);

		expect(connectCodeTried('W3TB-9HQP', NOW + 10_000)).toBeUndefined();
		expect(heldConnectCodeRecord(NOW)?.tried).toBe(0);
		expect(connectCodeTried(PASS, NOW + 10_000)).toEqual(heldConnectCodeRecord(NOW));
		expect(heldConnectCodeRecord(NOW)).toEqual({
			code: PASS,
			until: NOW + 60_000,
			shown: false,
			asked: NOW,
			tried: NOW + 10_000,
		});

		holdAcceptedCode(PASS, { expiresIn: 60 }, NOW + 20_000);
		expect(heldConnectCodeRecord(NOW + 20_000)?.tried).toBe(NOW + 10_000);
		holdAcceptedCode(PASS, { expiresIn: 60, hold: `${PASS}2` }, NOW + 30_000);
		expect(heldConnectCodeRecord(NOW + 30_000)?.tried).toBe(NOW + 10_000);

		holdAcceptedCode('W3TB-9HQP', { expiresIn: 900 }, NOW + 40_000);
		expect(heldConnectCodeRecord(NOW + 40_000)?.tried).toBe(0);
	});

	it('is renewed as a pass, never shown, keeping when it was asked about again', () => {
		holdAcceptedCode('K7QM-2XRD', { expiresIn: 60, hold: PASS }, NOW);
		const tried = connectCodeTried(PASS, NOW + 10_000);
		if (tried === undefined) throw new Error('not held');
		dropConnectCode();

		renewHeldConnectCode(tried, { expiresIn: 600 }, NOW + 20_000);
		expect(heldConnectCodeRecord(NOW + 20_000)).toEqual({
			code: PASS,
			until: NOW + 620_000,
			shown: false,
			asked: NOW + 20_000,
			tried: NOW + 10_000,
		});
		renewHeldConnectCode(tried, { expiresIn: 600, hold: `${PASS}2` }, NOW + 30_000);
		expect(heldConnectCode(NOW + 30_000)).toBe(`${PASS}2`);
		expect(heldConnectCodeShown(NOW + 30_000)).toBe(false);
	});

	it('is, as stored, the same record while storage is unchanged, run out or not', () => {
		holdConnectCode('K7QM-2XRD', 900, NOW);
		const stored = storedConnectCode();

		expect(stored?.until).toBe(NOW + 900_000);
		expect(storedConnectCode()).toBe(stored);
		expect(heldConnectCode(NOW + 900_000)).toBeUndefined();
		expect(storedConnectCode()).toBe(stored);

		holdConnectCode('K7QM-2XRD', 900, NOW + 1000);
		expect(storedConnectCode()).not.toBe(stored);
		expect(storedConnectCode()?.until).toBe(NOW + 901_000);
		dropConnectCode();
		expect(storedConnectCode()).toBeUndefined();
	});

	it("takes the policy's word as no later than an asking about it, where a clock set back dated it ahead", () => {
		holdAcceptedCode('K7QM-2XRD', { expiresIn: 600, hold: PASS }, NOW + 60_000);
		connectCodeTried(PASS, NOW);

		expect(connectCodeAskedAt(NOW)).toBe(NOW);
		expect(heldConnectCodeRecord(NOW)?.tried).toBe(NOW);
	});

	it('is read back as storage holds it after an asking, without the stamp where storage will not take it', () => {
		holdAcceptedCode('K7QM-2XRD', { expiresIn: 600, hold: PASS }, NOW);
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
		});

		expect(connectCodeTried(PASS, NOW + 10_000)?.tried).toBe(0);
	});

	it('asks once to be let go of, however many reads past the end come before it is', async () => {
		holdConnectCode('K7QM-2XRD', 900, NOW);
		heldConnectCode(NOW + 900_000);
		heldConnectCodeShown(NOW + 900_000);
		connectCodeHeldUntil(NOW + 900_000);
		const reads = vi.spyOn(Storage.prototype, 'getItem');
		await Promise.resolve();

		expect(reads).toHaveBeenCalledOnce();
		expect(localStorage.length).toBe(0);
	});

	it('tells whoever is watching when another tab changes it', () => {
		const told = vi.fn();
		const stop = watchConnectCode(told);

		window.dispatchEvent(new StorageEvent('storage', { key: 'skysa.connectCode' }));
		window.dispatchEvent(new StorageEvent('storage', { key: 'something.else' }));
		stop();
		window.dispatchEvent(new StorageEvent('storage', { key: 'skysa.connectCode' }));

		expect(told).toHaveBeenCalledTimes(1);
	});

	it('tells whoever is watching each time what is held changes, until they stop', () => {
		const told = vi.fn();
		const stop = watchConnectCode(told);

		holdAcceptedCode('K7QM-2XRD', { expiresIn: 60, hold: PASS }, NOW);
		dropConnectCode();
		stop();
		holdConnectCode('K7QM-2XRD', 900, NOW);

		expect(told).toHaveBeenCalledTimes(2);
	});
});
