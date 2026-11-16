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
 * of that from its own part's ending. A word between tabs only has one that
 * is syncing look now, and what it finds is the lock, so a word that comes
 * late changes nothing.
 * https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
 */
export interface SharedPause {
	/**
	 * Holds this tab's part in the pause `name` until the call it returns,
	 * and has the other tabs look once it holds it. `ended` is called if
	 * another tab ends the pause first, and never once it is let go of.
	 */
	readonly hold: (name: string, ended: () => void) => () => void;
	/** Whether any tab holds a part in the pause `name`. */
	readonly held: (name: string) => Promise<boolean>;
	/** Ends the pause `name` in every tab, ending each part held in it. */
	readonly end: (name: string) => Promise<void>;
	/** Has no more said to look, and says it to no other tab. */
	readonly close: () => void;
}

const CHANNEL = 'skysa-pause';

/**
 * The browser's, where it has Web Locks. Where it has no `BroadcastChannel`
 * either, a tab finds the pause as its next run looks.
 * https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel
 */
export const browserSharedPause = (heard: () => void): SharedPause => {
	const channel =
		typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(CHANNEL);
	channel?.addEventListener('message', heard);
	return {
		hold: (name, ended) => {
			const gone = cell(false);
			const free = cell<() => void>(() => undefined);
			const kept = new Promise<void>((resolve) => {
				free.current = resolve;
			});
			navigator.locks
				.request(name, { mode: 'shared' }, () => {
					// Held, so a tab that looks now finds it.
					if (!gone.current) channel?.postMessage(name);
					return kept;
				})
				// Stolen (an `AbortError`), unless it was being let go of anyway.
				.catch(() => {
					if (!gone.current) ended();
				});
			return () => {
				gone.current = true;
				free.current();
			};
		},
		held: async (name) => {
			const { held = [] } = await navigator.locks.query();
			// Only a part: `end` holds it alone for the moment it takes.
			return held.some((lock) => lock.name === name && lock.mode === 'shared');
		},
		end: async (name) => {
			await navigator.locks.request(name, { steal: true }, () => undefined);
		},
		close: () => {
			channel?.close();
		},
	};
};
