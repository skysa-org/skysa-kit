import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { browserSharedPause, type SharedPause } from '../src/sync/sharedPause.js';
import { fakeLocks } from './support/fakes/locks.js';

/**
 * The browser's shared pause (`browserSharedPause`), over Web Locks as the
 * spec has them (`fakeLocks`), since Node has none, and the real
 * `BroadcastChannel`. Each tab is a port of its own.
 */
describe('the shared pause, in the browser', () => {
	const opened: SharedPause[] = [];
	const locks = fakeLocks();

	beforeEach(() => {
		vi.stubGlobal('navigator', { locks: locks.locks });
	});

	afterEach(() => {
		opened.splice(0).forEach((pause) => {
			pause.close();
		});
		locks.refuse('request', false);
		locks.refuse('query', false);
		vi.unstubAllGlobals();
	});

	const tab = () => {
		const heard = vi.fn<(name: string) => void>();
		const pause = browserSharedPause(heard);
		opened.push(pause);
		return { pause, heard };
	};

	/** What a part is told as its pause ends, if it is. */
	const part = () => vi.fn<() => void>();

	const settled = () =>
		new Promise((resolve) => {
			setTimeout(resolve, 20);
		});

	it('holds a part, and has the other tabs look once it holds it', async () => {
		const one = tab();
		const two = tab();

		const release = one.pause.hold('p', part());

		await vi.waitFor(() => {
			expect(two.heard).toHaveBeenCalledWith('p');
		});
		expect(one.heard).not.toHaveBeenCalled();
		expect(await two.pause.held('p')).toBe(true);
		release();
		await settled();
		expect(await two.pause.held('p')).toBe(false);
	});

	it('ends every part, telling each that was kept and none let go of', async () => {
		const one = tab();
		const two = tab();
		const ended = { one: part(), two: part() };
		const release = one.pause.hold('p', ended.one);
		two.pause.hold('p', ended.two);
		await settled();
		release();

		await two.pause.end('p');

		await vi.waitFor(() => {
			expect(ended.two).toHaveBeenCalledTimes(1);
		});
		await settled();
		expect(ended.one).not.toHaveBeenCalled();
		expect(await one.pause.held('p')).toBe(false);
	});

	it('joins a pause that stands, and keeps no part of one that is over', async () => {
		const one = tab();
		const two = tab();

		expect(await two.pause.join('p', part())).toBeUndefined();
		await settled();
		expect(locks.held('p')).toBe(0);

		one.pause.hold('p', part());
		await settled();
		const ended = part();
		const release = await two.pause.join('p', ended);

		expect(release).toBeTypeOf('function');
		expect(locks.held('p')).toBe(2);
		await one.pause.end('p');
		await vi.waitFor(() => {
			expect(ended).toHaveBeenCalledTimes(1);
		});
		// Nobody else is told to look by a join.
		expect(one.heard).not.toHaveBeenCalled();
	});

	it('has two tabs that looked before the pause ended join it one at a time, and keep nothing', async () => {
		const one = tab();
		const two = tab();
		const three = tab();
		one.pause.hold('p', part());
		await settled();
		expect(await two.pause.held('p')).toBe(true);
		expect(await three.pause.held('p')).toBe(true);
		await one.pause.end('p');

		const joined = await Promise.all([
			two.pause.join('p', part()),
			three.pause.join('p', part()),
		]);

		expect(joined).toEqual([undefined, undefined]);
		await settled();
		expect(locks.held('p')).toBe(0);
	});

	it('ends no pause while a tab joins it, so a part it keeps is told', async () => {
		const one = tab();
		const two = tab();
		one.pause.hold('p', part());
		await settled();
		const ended = part();

		const joining = two.pause.join('p', ended);
		const ending = one.pause.end('p');

		expect(await joining).toBeTypeOf('function');
		await ending;
		await vi.waitFor(() => {
			expect(ended).toHaveBeenCalledTimes(1);
		});
		expect(locks.held('p')).toBe(0);
	});

	it('rejects nothing where the lock manager refuses, and holds no pause', async () => {
		const one = tab();
		const two = tab();
		one.pause.hold('p', part());
		await settled();
		locks.refuse('query');

		expect(await two.pause.held('p')).toBe(false);
		expect(await two.pause.join('p', part())).toBeUndefined();
		await settled();
		// The join's part let go of, though it could not count.
		expect(locks.held('p')).toBe(1);

		locks.refuse('request');
		const ended = part();
		two.pause.hold('p', ended);
		expect(await two.pause.join('p', part())).toBeUndefined();
		await expect(two.pause.end('p')).resolves.toBeUndefined();
		await settled();
		// Refused, not stolen, and no other tab told to look.
		expect(ended).not.toHaveBeenCalled();
		expect(one.heard).not.toHaveBeenCalled();
	});

	it('hears only a name, and nothing once closed', async () => {
		const one = tab();
		const two = tab();
		const other = new BroadcastChannel('skysa-pause');
		other.postMessage({ kind: 'paused' });
		await settled();
		other.close();
		expect(two.heard).not.toHaveBeenCalled();

		two.pause.close();
		one.pause.hold('p', part());
		await settled();

		expect(two.heard).not.toHaveBeenCalled();
	});
});
