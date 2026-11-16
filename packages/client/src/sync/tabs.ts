/**
 * The app's other tabs on this origin, which a pause is shared with: the apps
 * say a sync is paused on the device, and every tab syncs the device's one
 * queue (skysa-kit#20, item 2). A tab tells the others when its user pauses
 * or asks again, and a tab just opened asks whether one is paused.
 */

/** What one tab tells the app's others. */
export type TabMessage = Readonly<
	| { kind: 'paused'; connectionId: string }
	| { kind: 'resumed'; connectionId: string }
	| { kind: 'asking' }
>;

/**
 * What the scheduler needs of a `BroadcastChannel`, so a test can stand in:
 * opened with what to call when another tab tells, which it hears until it
 * is closed.
 */
export interface TabChannel {
	/** Tells every other tab of the app; never this one. */
	readonly tell: (message: TabMessage) => void;
	/** Hears and tells no more. */
	readonly close: () => void;
}

const CHANNEL = 'skysa-sync';

/**
 * A tab of an older or newer build may say something else, or say it in
 * another shape: what is not a message of these is not heard.
 */
const asMessage = (data: unknown): TabMessage | undefined => {
	if (typeof data !== 'object' || data === null || !('kind' in data)) return undefined;
	if (data.kind === 'asking') return { kind: 'asking' };
	if (data.kind !== 'paused' && data.kind !== 'resumed') return undefined;
	if (!('connectionId' in data) || typeof data.connectionId !== 'string') return undefined;
	return { kind: data.kind, connectionId: data.connectionId };
};

/** Every other tab of the app on this origin, over a `BroadcastChannel`. */
export const browserTabs = (heard: (message: TabMessage) => void): TabChannel => {
	const channel = new BroadcastChannel(CHANNEL);
	channel.addEventListener('message', (event: MessageEvent) => {
		const message = asMessage(event.data);
		if (message !== undefined) heard(message);
	});
	return {
		tell: (message) => {
			channel.postMessage(message);
		},
		close: () => {
			channel.close();
		},
	};
};
