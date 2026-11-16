import type { TabChannel, TabMessage } from '../../../src/sync/tabs.js';

/**
 * The tabs of the app on one device: what one tells, every other one open
 * hears, and never the teller. A moment later, as over a `BroadcastChannel`;
 * or at once, for a tab that hears before it has read what the app shows, as
 * one whose database is slower than the channel does.
 */
export const fakeTabs = (delivery: 'later' | 'at once' = 'later') => {
	const channels = new Set<(message: TabMessage) => void>();
	/** Everything any tab told, in order. */
	const told: TabMessage[] = [];

	const open = (heard: (message: TabMessage) => void): TabChannel => {
		// Each its own, so a tab that opens twice is two tabs.
		const hears = (message: TabMessage) => {
			heard(message);
		};
		channels.add(hears);
		return {
			tell: (message) => {
				told.push(message);
				channels.forEach((other) => {
					if (other === hears) return;
					const deliver = () => {
						// Closed meanwhile, it hears nothing.
						if (channels.has(other)) other(message);
					};
					if (delivery === 'at once') deliver();
					else queueMicrotask(deliver);
				});
			},
			close: () => {
				channels.delete(hears);
			},
		};
	};

	return { open, told, openCount: () => channels.size };
};
