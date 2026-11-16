import type { ConnectCodeCheck, EntitlementCode } from '@skysa/protocol';
import { cell } from '@skysa/storage';
import { useEffect, useRef, useSyncExternalStore } from 'react';

import { type ApiClient, ApiError } from '../api/client.js';
import {
	connectCodeTried,
	dropConnectCode,
	forgetLapsedConnectCode,
	type HeldConnectCode,
	heldConnectCode,
	heldConnectCodeRecord,
	holdAcceptedCode,
	storedConnectCode,
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
 * What the policy says of `code`: `tooMany` where the instance has had as
 * many guesses from this address as it allows for now, and nothing where it
 * could not be asked or did not answer.
 */
const policySays = async (
	client: Pick<ApiClient, 'checkConnectCode'>,
	code: string
): Promise<ConnectCodeCheck | 'tooMany' | undefined> => {
	try {
		const result = await client.checkConnectCode(code);
		return result.ok ? result.value : undefined;
	} catch (error) {
		return error instanceof ApiError && error.status === 429 ? 'tooMany' : undefined;
	}
};

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
	const said = await policySays(client, code);
	if (said === undefined) return { kind: 'unchecked' };
	if (said === 'tooMany') return { kind: 'tooMany' };
	if (!said.accepted) {
		return said.reason === undefined
			? { kind: 'refused' }
			: { kind: 'refused', reason: said.reason };
	}
	holdAcceptedCode(code, said);
	return { kind: 'accepted' };
};

/**
 * How long the policy's word on a held value stands before the app asks again
 * as it loads, counted from that word or from this device last asking,
 * answered or not, whichever is later.
 */
export const ASK_AGAIN_MS = 60 * 60_000;

/** When this page loaded, by this device's clock: a refused connect comes back as a fresh load. */
const LOADED = Date.now();

/** What a tab holds while it asks about a held value again, so another tab asks nothing meanwhile. */
const LOCK = 'skysa.connectCode.askAgain';

export interface AskAgainOptions {
	/**
	 * Whether the instance's gate takes a code, asked only once a value is held
	 * and due, so an app that has to ask the server for it (`/config`) asks
	 * only then. Where the gate no longer takes one, or it cannot say, nothing
	 * is asked.
	 */
	readonly asksForCode: () => boolean | Promise<boolean>;
	/** The app is loading after a refused connect: asked at once, whatever the hour, once in this load. */
	readonly refused?: boolean;
	readonly now?: number;
}

/**
 * Whether the policy's word on what is held is old enough to ask for again:
 * after a refused connect, where this load has not asked yet; and otherwise
 * an hour after that word or this device's last asking. A clock set back
 * since says nothing of how long it has been, and counts as an hour.
 */
const due = (held: HeldConnectCode, refused: boolean, now: number): boolean => {
	if (held.shown) return false;
	if (refused && held.tried < LOADED) return true;
	const since = Math.max(held.asked, held.tried);
	return now < since || now - since >= ASK_AGAIN_MS;
};

/** Whether what is held is as it was: not replaced, dropped, renewed or asked about meanwhile. */
const unchanged = (held: HeldConnectCode): boolean => {
	const now = heldConnectCodeRecord();
	return now?.code === held.code && now.asked === held.asked && now.tried === held.tried;
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
 * `work`, where no other tab of this app is asking already, and nothing where
 * one is: a store in `localStorage` is read and written apart, so two tabs
 * opening together would each find the value due. In a browser without Web
 * Locks, `work` alone.
 */
const alone = (work: () => Promise<void>): Promise<void> =>
	'locks' in navigator
		? navigator.locks.request(LOCK, { ifAvailable: true }, (lock) =>
				lock === null ? undefined : work()
			)
		: work();

/**
 * What the policy gave to hold in place of a code (`ConnectCodeCheck.hold`),
 * asked about again as the app loads, where the instance's gate takes a code:
 * at most once an hour, and at once after a refused connect, once in that
 * load. Not while another tab is asking, so an app may call it from an effect.
 *
 * A typed code is not asked about again: it is good for as long as the policy
 * said when it took it, minutes as a rule, and an answer would add nothing.
 * Each asking costs one of the guesses the instance allows an address
 * (`connect-code:<ip>`), which the people behind one carrier's or one office's
 * address share, and someone typing a fresh code must not find them spent by
 * the others opening the app. So an asking counts from when it was made,
 * answered or not, and one with no answer — a limit reached, the network gone,
 * or `asksForCode` failing — waits the hour like any other.
 *
 * A policy that hands a device a pass says each time whether it still takes
 * it, and may answer with a fresh one, so a pass lives as long as the device
 * is used, where the policy gives it for longer than the hour: a shorter one
 * runs out unasked. One it no longer takes is let go of here, so the gate asks
 * for a code before a consent screen rather than after one. Not asked, or not
 * answered, it is kept: the callback still decides. Where what is held changes
 * while `asksForCode` answers, nothing is asked; and an answer about a value
 * no longer held, because a new code was typed meanwhile, changes nothing.
 */
export const askHeldCodeAgain = (
	client: Pick<ApiClient, 'checkConnectCode'>,
	{ asksForCode, refused = false, now = Date.now() }: AskAgainOptions
): Promise<void> =>
	alone(async () => {
		const held = heldConnectCodeRecord(now);
		if (held === undefined || !due(held, refused, now)) return;
		const tried = connectCodeTried(held.code);
		if (tried === undefined || !(await takesCode(asksForCode)) || !unchanged(tried)) return;
		const said = await policySays(client, held.code);
		if (said === undefined || said === 'tooMany' || heldConnectCode() !== held.code) return;
		if (said.accepted) holdAcceptedCode(held.code, said);
		else dropConnectCode();
	});

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
	heldConnectCodeRecord()?.shown === true;

/** The longest delay `setTimeout` takes as meant; one longer fires at once. */
const LONGEST_TIMER_MS = 2 ** 31 - 1;

/**
 * Until when this device holds a code the gate took, for a gate showing it.
 * It follows the record as stored (`useSyncExternalStore`): another tab can
 * take or drop one, and this one ask about it again, each telling the store's
 * watchers. The hold also ends by the clock, which tells no one, so a timer
 * lets it go as it ends; a browser runs a timer that came due while the tab
 * slept as it wakes, and any other read past the end lets it go too. Until
 * then, for that moment, this is the end that has passed: a render reads no
 * clock.
 *
 * `onLapse` is told which code it was, where a code the person typed, and
 * this hook showed, is let go of once its end has passed, however that is
 * seen: this tab or another. It is not told where one is dropped before its
 * end, or replaced by another typed code at any time: the field holds that
 * one now. A drop that a tab asleep meanwhile sees only after the end is, as
 * far as it can tell, a lapse. It is never told a value the policy gave to
 * hold, which is never shown.
 *
 * A hold may run a year, longer than a browser's timer can count (2³¹ ms,
 * about 25 days, past which it fires at once), so the timer wakes at its
 * longest and is set again from there until the hold has truly ended.
 */
export const useConnectCodeHeldUntil = (onLapse?: (code: string) => void): number | undefined => {
	const stored = useSyncExternalStore(watchConnectCode, storedConnectCode);
	const until = stored?.until;
	const showing = useRef<HeldConnectCode | undefined>(undefined);
	useEffect(() => {
		const before = showing.current;
		showing.current = stored?.shown === true ? stored : undefined;
		if (before === undefined || showing.current !== undefined) return;
		if (before.until <= Date.now()) onLapse?.(before.code);
	}, [stored, onLapse]);
	useEffect(() => {
		if (until === undefined) return;
		const timer = cell<ReturnType<typeof setTimeout> | undefined>(undefined);
		const wake = () => {
			const left = until - Date.now();
			if (left <= 0) forgetLapsedConnectCode();
			else timer.current = setTimeout(wake, Math.min(left + 50, LONGEST_TIMER_MS));
		};
		wake();
		return () => {
			clearTimeout(timer.current);
		};
	}, [until]);
	return until;
};
