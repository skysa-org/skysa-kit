import type { ConnectCodeCheck, EntitlementCode } from '@skysa/protocol';
import { cell } from '@skysa/storage';
import { useEffect, useRef, useSyncExternalStore } from 'react';

import { type ApiClient, ApiError } from '../api/client.js';
import {
	connectCodeHeldUntil,
	connectCodeTried,
	dropConnectCode,
	forgetLapsedConnectCode,
	type HeldConnectCode,
	heldConnectCode,
	heldConnectCodeRecord,
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
 * How long after this device asked about a held value again, answered or
 * not, it does not ask again, here or in another tab: long enough that one
 * load asking twice — an effect run again, a remount, two tabs opening —
 * asks once, and that no answer does not become a request on every render.
 */
const JUST_ASKED_MS = 60_000;

export interface AskAgainOptions {
	/**
	 * Whether the instance's gate takes a code, asked only once a value is held
	 * and due, so an app that has to ask the server for it (`/config`) asks
	 * only then. Where the gate no longer takes one, or it cannot say, nothing
	 * is asked.
	 */
	readonly asksForCode: () => boolean | Promise<boolean>;
	/** The app is loading after a refused connect: asked at once, whatever the hour. */
	readonly refused?: boolean;
	readonly now?: number;
}

/** Whether `ms` have gone by since `then`; a clock set back since then says nothing of how long, and counts. */
const gone = (now: number, then: number, ms: number): boolean => now < then || now - then >= ms;

/** Whether the policy's word on what is held is old enough to ask for again. */
const due = (held: HeldConnectCode, refused: boolean, now: number): boolean =>
	!held.shown &&
	gone(now, held.tried, JUST_ASKED_MS) &&
	(refused || gone(now, held.asked, ASK_AGAIN_MS));

/** Whether what is held is as it was: not replaced, dropped, renewed or asked about meanwhile. */
const unchanged = (held: HeldConnectCode): boolean => {
	const now = heldConnectCodeRecord();
	return now?.code === held.code && now.asked === held.asked && now.tried === held.tried;
};

/** What the policy says of `code`, or nothing where it could not be asked or did not answer. */
const answer = async (
	client: Pick<ApiClient, 'checkConnectCode'>,
	code: string
): Promise<ConnectCodeCheck | undefined> => {
	try {
		const result = await client.checkConnectCode(code);
		return result.ok ? result.value : undefined;
	} catch {
		// A limit reached or no answer at all.
		return undefined;
	}
};

/** Whether the gate takes a code, where it can say: one that cannot is taken as no. */
const takesCode = async (asksForCode: AskAgainOptions['asksForCode']): Promise<boolean> => {
	try {
		return await asksForCode();
	} catch {
		return false;
	}
};

/**
 * What the policy gave to hold in place of a code (`ConnectCodeCheck.hold`),
 * asked about again as the app loads, where the instance's gate takes a code:
 * at most once an hour since the policy last answered, and at once after a
 * refused connect. Either way not within a minute of this device asking about
 * it again, answered or not, in this tab or another, so an app may call it
 * from an effect.
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
 * answered, it is kept: the callback still decides. Where what is held changes
 * while `asksForCode` answers, nothing is asked; and an answer about a value
 * no longer held, because a new code was typed meanwhile, changes nothing.
 */
export const askHeldCodeAgain = async (
	client: Pick<ApiClient, 'checkConnectCode'>,
	{ asksForCode, refused = false, now = Date.now() }: AskAgainOptions
): Promise<void> => {
	const held = heldConnectCodeRecord(now);
	if (held === undefined || !due(held, refused, now)) return;
	if (!(await takesCode(asksForCode)) || !unchanged(held)) return;
	connectCodeTried(held.code, now);
	const said = await answer(client, held.code);
	if (said === undefined || heldConnectCode() !== held.code) return;
	if (said.accepted) holdAcceptedCode(held.code, said);
	else dropConnectCode();
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

/** The typed code `useConnectCodeHeldUntil` last showed, to tell a lapse from a drop. */
interface Showing {
	readonly code: string;
	readonly until: number;
}

/**
 * Until when this device holds a code the gate took, for a gate showing it,
 * as the store says it (`useSyncExternalStore`): another tab can take or drop
 * one, and this one ask about it again, each telling the store's watchers.
 * The hold also ends by the clock, which tells no one, so a timer lets it go
 * as it ends. `onLapse` is told which code it was, where a code the person
 * typed runs out, however that is seen — this timer, another tab's, or a
 * render after the end — and not where one is dropped or replaced before its
 * end: a field still holding it can let it go too. It is never told a value
 * the policy gave to hold, which is never shown.
 *
 * A hold may run a year, longer than a browser's timer can count (2³¹ ms,
 * about 25 days, past which it fires at once), so the timer wakes at its
 * longest and is set again from there until the hold has truly ended.
 */
export const useConnectCodeHeldUntil = (onLapse?: (code: string) => void): number | undefined => {
	const until = useSyncExternalStore(watchConnectCode, () => connectCodeHeldUntil());
	const showing = useRef<Showing | undefined>(undefined);
	useEffect(() => {
		const before = showing.current;
		const now = Date.now();
		// As it was at the render, which may have come just before the end.
		const held =
			until === undefined ? undefined : heldConnectCodeRecord(Math.min(now, until - 1));
		showing.current = held?.shown === true ? { code: held.code, until: held.until } : undefined;
		if (before === undefined || showing.current?.code === before.code) return;
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
