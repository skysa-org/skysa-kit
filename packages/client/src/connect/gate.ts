import type { EntitlementCode } from '@skysa/protocol';
import { cell } from '@skysa/storage';
import { useEffect, useRef, useSyncExternalStore } from 'react';

import { type ApiClient, ApiError } from '../api/client.js';
import {
	connectCodeAskedAt,
	connectCodeHeldUntil,
	dropConnectCode,
	forgetLapsedConnectCode,
	heldConnectCode,
	heldConnectCodeShown,
	holdAcceptedCode,
	watchConnectCode,
} from '../store/connectCode.js';

/**
 * The rules of an operator's gate (docs/ARCHITECTURE.md §6, "The gate"),
 * which every app had copied: asking the policy about a code typed into it,
 * asking again about a value held in its place, whether a refused connect is
 * about the code, and until when a gate showing a held code shows it. What is
 * held, and for how long, is `store/connectCode.ts`'s. The words are each
 * app's: an outcome here is what happened, not what to say about it.
 */

/** What the policy said of a code typed into the gate. */
export type ConnectCodeOutcome = Readonly<
	/** Taken, and held — or what the policy gave in its place — for as long as it said. */
	| { kind: 'accepted' }
	/** Not taken, with the policy's reason where it gave one. */
	| { kind: 'refused'; reason?: string }
	/** The instance has had as many guesses from this address as it allows for now. */
	| { kind: 'tooMany' }
	/** Not asked, or no answer: the server would not, or could not be reached. */
	| { kind: 'unchecked' }
>;

/**
 * Asks the operator's policy about a code typed into the gate, and holds it,
 * or what the policy gave in its place, for as long as the policy says, where
 * it is taken. Not `ApiClient.checkConnectCode`, which only asks: this is
 * what a gate calls.
 */
export const askAboutConnectCode = async (
	client: Pick<ApiClient, 'checkConnectCode'>,
	code: string
): Promise<ConnectCodeOutcome> => {
	try {
		const result = await client.checkConnectCode(code);
		if (!result.ok) return { kind: 'unchecked' };
		const { value } = result;
		if (!value.accepted) {
			return value.reason === undefined
				? { kind: 'refused' }
				: { kind: 'refused', reason: value.reason };
		}
		holdAcceptedCode(code, value);
		return { kind: 'accepted' };
	} catch (error) {
		return error instanceof ApiError && error.status === 429
			? { kind: 'tooMany' }
			: { kind: 'unchecked' };
	}
};

/** How long the policy's word on a held value stands before the app asks again as it loads. */
export const ASK_AGAIN_MS = 60 * 60_000;

/**
 * How long the policy's word stands after a refused connect: long enough
 * that the same load asking twice — an effect run again, a remount — asks
 * once, and short of any load after it.
 */
const JUST_ASKED_MS = 60_000;

export interface AskAgainOptions {
	/**
	 * Whether the instance's gate takes a code, asked only once a value is held
	 * and due, so an app that has to ask the server for it (`/config`) asks
	 * only then. Where the gate no longer takes one, nothing is asked.
	 */
	readonly asksForCode: () => boolean | Promise<boolean>;
	/** The app is loading after a refused connect: asked at once, whatever the hour. */
	readonly refused?: boolean;
	readonly now?: number;
}

/** Whether the policy's word on `held` is old enough to ask for again. */
const due = (held: string, refused: boolean, now: number): boolean => {
	if (heldConnectCode(now) !== held) return false;
	const since = now - (connectCodeAskedAt(now) ?? 0);
	// A clock set back since the policy answered says nothing of how long ago.
	return since < 0 || since >= (refused ? JUST_ASKED_MS : ASK_AGAIN_MS);
};

const ask = async (
	client: Pick<ApiClient, 'checkConnectCode'>,
	{ asksForCode, refused = false, now = Date.now() }: AskAgainOptions
): Promise<void> => {
	const held = heldConnectCode(now);
	if (held === undefined || heldConnectCodeShown(now) || !due(held, refused, now)) return;
	try {
		if (!(await asksForCode())) return;
		// Asked about meanwhile in another tab, or a new code typed: each
		// asking spends a guess the address shares.
		if (!due(held, refused, now)) return;
		const result = await client.checkConnectCode(held);
		if (!result.ok || heldConnectCode() !== held) return;
		if (result.value.accepted) holdAcceptedCode(held, result.value);
		else dropConnectCode();
	} catch {
		// A limit reached or no answer at all: kept, as it was.
	}
};

/** The asking under way, which another asked for meanwhile joins. */
const asking = cell<Promise<void> | undefined>(undefined);

/**
 * What the policy gave to hold in place of a code (`ConnectCodeCheck.hold`),
 * asked about again as the app loads, where the instance's gate takes a code:
 * at most once an hour since the policy last answered, and at once after a
 * refused connect. Asked for again while it is under way, it is joined, and
 * asked for again just after it was answered, it asks nothing, so an app may
 * call it from an effect.
 *
 * A typed code is not asked about again: it is good for as long as the policy
 * said when it took it, minutes as a rule, and an answer would add nothing.
 * Each asking costs one of the guesses the instance allows an address
 * (`connect-code:<ip>`), which the people behind one carrier's or one office's
 * address share, and someone typing a fresh code must not find them spent by
 * the others opening the app.
 *
 * A policy that hands a device a pass says each time whether it still takes
 * it, and may answer with a fresh one, so a pass lives as long as the device
 * is used. One it no longer takes is let go of here, so the gate asks for a
 * code before a consent screen rather than after one. Not asked, or not
 * answered, it is kept: the callback still decides. An answer about a value no
 * longer held, because a new code was typed meanwhile, changes nothing.
 */
export const askHeldCodeAgain = (
	client: Pick<ApiClient, 'checkConnectCode'>,
	options: AskAgainOptions
): Promise<void> => {
	const under = asking.current;
	if (under !== undefined) return under;
	const asked = ask(client, options).finally(() => {
		asking.current = undefined;
	});
	asking.current = asked;
	return asked;
};

/**
 * Whether a connect that came back is the policy turning down the code typed
 * into its gate: refused, with a plain no — `not_allowed`, or no code at all —
 * while this device held a code the person typed. That is what they can put
 * right, so the app says it is about the code, and lets it go so the field is
 * empty for the next. A `lapsed` or a `limit_reached` is about the account or
 * the instance; and a value the policy gave to hold is not thrown away on a no
 * that may be about the account, but asked about again (`askHeldCodeAgain`).
 */
export const codeWasRefused = ({
	refused,
	code,
}: Readonly<{ refused: boolean; code?: EntitlementCode | undefined }>): boolean =>
	refused &&
	(code === undefined || code === 'not_allowed') &&
	heldConnectCode() !== undefined &&
	heldConnectCodeShown();

/** The longest delay `setTimeout` takes as meant; one longer fires at once. */
const LONGEST_TIMER_MS = 2 ** 31 - 1;

/** What `useConnectCodeHeldUntil` last showed, to tell a lapse from a drop. */
interface Shown {
	readonly code: string;
	readonly until: number;
}

/**
 * Until when this device holds a code the gate took, for a gate showing it,
 * as the store says it (`useSyncExternalStore`): another tab can take or drop
 * one, and this one ask about it again, each telling the store's watchers.
 * The hold also ends by the clock, which tells no one, so a timer lets it go
 * as it ends. `onLapse` is told which code it was, where a hold that was shown
 * runs out, however that is seen — this timer, another tab's, or a render
 * after the end — and not where one is dropped or replaced before its end: a
 * field still holding it can let it go too.
 *
 * A hold may run a year, longer than a browser's timer can count (2³¹ ms,
 * about 25 days, past which it fires at once), so the timer wakes at its
 * longest and is set again from there until the hold has truly ended.
 */
export const useConnectCodeHeldUntil = (onLapse?: (code: string) => void): number | undefined => {
	const until = useSyncExternalStore(watchConnectCode, () => connectCodeHeldUntil());
	const shown = useRef<Shown | undefined>(undefined);
	useEffect(() => {
		const before = shown.current;
		const now = Date.now();
		// As it was at the render, which may have come just before the end.
		const code = until === undefined ? undefined : heldConnectCode(Math.min(now, until - 1));
		shown.current = code === undefined || until === undefined ? undefined : { code, until };
		if (before === undefined || shown.current?.code === before.code) return;
		if (before.until <= now) onLapse?.(before.code);
	}, [until, onLapse]);
	useEffect(() => {
		if (until === undefined) return;
		const timer = cell<ReturnType<typeof setTimeout> | undefined>(undefined);
		const wake = () => {
			timer.current = setTimeout(
				() => {
					if (Date.now() < until) wake();
					else forgetLapsedConnectCode();
				},
				Math.min(Math.max(0, until - Date.now()) + 50, LONGEST_TIMER_MS)
			);
		};
		wake();
		return () => {
			clearTimeout(timer.current);
		};
	}, [until]);
	return until;
};
