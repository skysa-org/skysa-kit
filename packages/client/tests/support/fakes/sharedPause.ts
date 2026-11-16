import type { SharedPause } from '../../../src/sync/sharedPause.js';

/**
 * The pause the app's tabs share (`SharedPause`), between the tabs of a test:
 * a lock each paused tab holds a part in, and a word to the others once one
 * does. A word is heard a moment later, as a browser's is, or only when the
 * test delivers it (`words: 'byHand'`), to be late or never come. A look at
 * the lock is answered at once, or only when the test answers it
 * (`looks: 'byHand'`), as one at another process can take a while.
 */
export const fakeSharedPause = (options: Readonly<{ words?: 'byHand'; looks?: 'byHand' }> = {}) => {
	/** Each pause's parts, each what to call as it ends. */
	const parts = new Map<string, Set<() => void>>();
	/** What each open tab calls as it is told. */
	const tabs = new Set<() => void>();
	const words: (() => void)[] = [];
	const looks: (() => void)[] = [];

	const isHeld = (name: string): boolean => (parts.get(name)?.size ?? 0) > 0;

	const open = (heard: () => void): SharedPause => {
		tabs.add(heard);
		return {
			hold: (name, ended) => {
				const part = () => {
					ended();
				};
				const holders = parts.get(name) ?? new Set();
				holders.add(part);
				parts.set(name, holders);
				tabs.forEach((other) => {
					if (other === heard) return;
					const word = () => {
						if (tabs.has(other)) other();
					};
					if (options.words === 'byHand') words.push(word);
					else queueMicrotask(word);
				});
				return () => {
					holders.delete(part);
				};
			},
			held: (name) => {
				if (options.looks !== 'byHand') return Promise.resolve(isHeld(name));
				// As the lock is when the answer comes.
				return new Promise((resolve) => {
					looks.push(() => {
						resolve(isHeld(name));
					});
				});
			},
			end: (name) => {
				const ending = [...(parts.get(name) ?? [])];
				parts.delete(name);
				ending.forEach((part) => {
					queueMicrotask(part);
				});
				return Promise.resolve();
			},
			close: () => {
				tabs.delete(heard);
			},
		};
	};

	return {
		open,
		/** Parts held in every pause, across tabs. */
		parts: () => [...parts.values()].reduce((sum, held) => sum + held.size, 0),
		/** Tabs open to be told. */
		openCount: () => tabs.size,
		/** Delivers every word waiting, `words: 'byHand'`. */
		deliver: () => {
			words.splice(0).forEach((word) => {
				word();
			});
		},
		/** Looks waiting to be answered, `looks: 'byHand'`. */
		looking: () => looks.length,
		/** Answers every look waiting. */
		answer: () => {
			looks.splice(0).forEach((look) => {
				look();
			});
		},
	};
};
