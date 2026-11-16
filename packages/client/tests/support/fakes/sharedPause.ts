import type { SharedPause } from '../../../src/sync/sharedPause.js';

/** A tab's part in a pause: told as it ends, unless it was let go of first. */
interface Part {
	readonly ended: () => void;
	gone: boolean;
}

/**
 * The pause the app's tabs share (`SharedPause`), between the tabs of a test:
 * a lock each paused tab holds a part in, and a word to the others once one
 * makes it. A word is heard a moment later, as a browser's is, or only when
 * the test delivers it (`words: 'byHand'`), to be late or never come. A look
 * at the lock says what it was as it was asked, at once, or, from
 * `holdLooks`, when the test answers it, as one at another process can take
 * a while. A join is the browser's, one at a time.
 */
export const fakeSharedPause = (options: Readonly<{ words?: 'byHand' }> = {}) => {
	const parts = new Map<string, Set<Part>>();
	/** What each open tab calls as it is told. */
	const tabs = new Set<() => void>();
	const words: (() => void)[] = [];
	const looks = new Map<'held', (() => void)[]>();

	const isHeld = (name: string): boolean => (parts.get(name)?.size ?? 0) > 0;

	const take = (name: string, ended: () => void) => {
		const part: Part = { ended, gone: false };
		const holders = parts.get(name) ?? new Set();
		holders.add(part);
		parts.set(name, holders);
		return () => {
			part.gone = true;
			holders.delete(part);
		};
	};

	const open = (heard: () => void): SharedPause => {
		tabs.add(heard);
		return {
			hold: (name, ended) => {
				const release = take(name, ended);
				tabs.forEach((other) => {
					if (other === heard) return;
					const word = () => {
						if (tabs.has(other)) other();
					};
					if (options.words === 'byHand') words.push(word);
					else queueMicrotask(word);
				});
				return release;
			},
			held: (name) => {
				const answer = isHeld(name);
				const held = looks.get('held');
				if (held === undefined) return Promise.resolve(answer);
				return new Promise((resolve) => {
					held.push(() => {
						resolve(answer);
					});
				});
			},
			join: (name, ended) => Promise.resolve(isHeld(name) ? take(name, ended) : undefined),
			end: (name) => {
				const ending = [...(parts.get(name) ?? [])];
				parts.delete(name);
				ending.forEach((part) => {
					queueMicrotask(() => {
						if (!part.gone) part.ended();
					});
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
		/** Has each look from now on wait for `answer`. */
		holdLooks: () => {
			looks.set('held', looks.get('held') ?? []);
		},
		/** Looks waiting to be answered. */
		looking: () => looks.get('held')?.length ?? 0,
		/** Answers every look waiting, and each from now on at once. */
		answer: () => {
			const held = looks.get('held') ?? [];
			looks.delete('held');
			held.forEach((look) => {
				look();
			});
		},
	};
};
