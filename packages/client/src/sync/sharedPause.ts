import { cell } from '@skysa/storage';

/**
 * A pause the app's tabs on this origin share: the apps say a sync is paused
 * on the device, and every tab syncs the device's one queue (skysa-kit#20,
 * item 2).
 *
 * The pause is a Web Lock, which each paused tab holds a part in, shared,
 * and which lasts while any tab holds one: a tab opened meanwhile, or one
 * that was frozen when it was made, finds it held when it next looks. Asking
 * again steals it, which ends every tab's part at once, and each tab learns
 * of that from its own part's ending. A word between tabs, naming the pause,
 * only has one that is syncing look now. None of it rejects: a lock manager
 * that refuses holds no pause, and each tab syncs as it would without one.
 * https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
 */
export interface SharedPause {
	/**
	 * Holds this tab's part in the pause `name`, made here, until the call it
	 * returns, and has the other tabs look once it holds it. `ended` is called
	 * if another tab ends the pause first, and never once it is let go of.
	 */
	readonly hold: (name: string, ended: () => void) => () => void;
	/** Whether any tab held a part in the pause `name` as it was asked. */
	readonly held: (name: string) => Promise<boolean>;
	/**
	 * Takes a part in the pause `name` made in another tab, as `hold` does,
	 * if the pause still stands once this tab holds it: resolves to the way to
	 * let go of it, or to nothing where the pause was over. A tab that looked
	 * just before the pause was asked again so finds it over, though the look
	 * found it held. One tab joins at a time, and no pause is ended while one
	 * does, so two of them never find each other's part, and what a join counts
	 * holds until it is kept. Has no other tab look.
	 */
	readonly join: (name: string, ended: () => void) => Promise<(() => void) | undefined>;
	/**
	 * Ends the pause `name` in every tab, ending each part held in it: not
	 * while a tab joins it.
	 */
	readonly end: (name: string) => Promise<void>;
	/** Has no more said to look, and says it to no other tab. */
	readonly close: () => void;
}

const CHANNEL = 'skysa-pause';

/**
 * A part in the pause `name`: `held` once the lock is had, false if it was
 * refused; `ended` called if it is stolen, and not once let go of. No steal
 * comes while a tab joins (`join`), so none comes before a part is kept.
 */
const take = (name: string, ended: () => void) => {
	const gone = cell(false);
	const free = cell<() => void>(() => undefined);
	const holding = new Promise<void>((resolve) => {
		free.current = resolve;
	});
	const had = cell<(granted: boolean) => void>(() => undefined);
	const held = new Promise<boolean>((resolve) => {
		had.current = resolve;
	});
	const done = navigator.locks
		.request(name, { mode: 'shared' }, () => {
			had.current(true);
			return holding;
		})
		.then(
			() => undefined,
			(error: unknown) => {
				had.current(false);
				// Stolen; refused for any other reason, it was never held.
				const stolen = error instanceof DOMException && error.name === 'AbortError';
				if (stolen && !gone.current) ended();
			}
		);
	return {
		held,
		done,
		release: () => {
			gone.current = true;
			free.current();
		},
	};
};

/** How many parts are held in the pause `name`: none, where the lock manager will not say. */
const parts = async (name: string): Promise<number> => {
	const { held = [] } = await navigator.locks.query().catch(() => ({ held: [] }));
	// Only parts: `end` holds it alone for the moment it takes.
	return held.filter((lock) => lock.name === name && lock.mode === 'shared').length;
};

/** The lock a tab joins the pause `name` under, and ends it under (`join`). */
const joining = (name: string): string => `${name} joining`;

/**
 * The browser's, where it has Web Locks. Where it has no `BroadcastChannel`
 * either, a tab finds the pause as its next run looks.
 * https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel
 */
export const browserSharedPause = (heard: (name: string) => void): SharedPause => {
	const channel =
		typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(CHANNEL);
	channel?.addEventListener('message', (event: MessageEvent) => {
		// Another build may say something else.
		if (typeof event.data === 'string') heard(event.data);
	});
	return {
		hold: (name, ended) => {
			const part = take(name, ended);
			// Held, so a tab that looks now finds it.
			void part.held.then((granted) => {
				if (granted) channel?.postMessage(name);
			});
			return part.release;
		},
		held: async (name) => (await parts(name)) > 0,
		join: (name, ended) =>
			navigator.locks
				.request(joining(name), async () => {
					const part = take(name, ended);
					if (!(await part.held)) return undefined;
					// Another tab's part, held now: no pause is ended while a
					// tab joins it.
					if ((await parts(name)) > 1) return part.release;
					part.release();
					// Gone before the next tab to join counts.
					await part.done;
					return undefined;
				})
				.catch(() => undefined),
		end: async (name) => {
			await navigator.locks
				.request(joining(name), () =>
					navigator.locks.request(name, { steal: true }, () => undefined)
				)
				.catch(() => undefined);
		},
		close: () => {
			channel?.close();
		},
	};
};
