import type { EntitlementCode } from '@skysa/protocol';
import { useEffect, useState } from 'react';

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
 * which every app had copied: asking the policy about a code typed into it, asking
 * again about a value held in its place, whether a refused connect is about
 * the code, and until when a gate showing a held code shows it. What is held,
 * and for how long, is `store/connectCode.ts`'s. The words are each app's: an
 * outcome here is what happened, not what to say about it.
 */

/** What the policy said of a code typed into the gate. */
export type CodeCheck = Readonly<
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
 * it is taken.
 */
export const checkConnectCode = async (
	client: Pick<ApiClient, 'checkConnectCode'>,
	code: string
): Promise<CodeCheck> => {
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

/**
 * What the policy gave to hold in place of a code (`ConnectCodeCheck.hold`),
 * asked about again as the app loads, where the instance's gate takes a code:
 * at most once an hour since the policy last answered, and at once after a
 * refused connect.
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
export const askHeldCodeAgain = async (
	client: Pick<ApiClient, 'checkConnectCode'>,
	{ asksForCode, refused = false, now = Date.now() }: AskAgainOptions
): Promise<void> => {
	const held = heldConnectCode(now);
	if (held === undefined || heldConnectCodeShown(now)) return;
	if (!refused && now - (connectCodeAskedAt(now) ?? 0) < ASK_AGAIN_MS) return;
	try {
		if (!(await asksForCode())) return;
		const result = await client.checkConnectCode(held);
		if (!result.ok || heldConnectCode() !== held) return;
		if (result.value.accepted) holdAcceptedCode(held, result.value);
		else dropConnectCode();
	} catch {
		// A limit reached or no answer at all: kept, as it was.
	}
};

/**
 * Whether a refused connect is the policy turning down the code typed into its
 * gate: a plain no — `not_allowed`, or no code at all — to a connect made while
 * this device held a code the person typed. That is what they can put right,
 * so the app says it is about the code, and lets it go so the field is empty
 * for the next. A `lapsed` or a `limit_reached` is about the account or the
 * instance; and a value the policy gave to hold is not thrown away on a no
 * that may be about the account, but asked about again (`askHeldCodeAgain`).
 */
export const codeWasRefused = (code: EntitlementCode | undefined): boolean =>
	(code === undefined || code === 'not_allowed') &&
	heldConnectCode() !== undefined &&
	heldConnectCodeShown();

/** The longest delay `setTimeout` takes as meant; one longer fires at once. */
const LONGEST_TIMER_MS = 2 ** 31 - 1;

/**
 * Until when this device holds a code the gate took, for a gate showing it.
 * Read at every render, since another tab can take or drop one and the hold
 * ends by the clock, each with a render. As the hold ends, it is let go of
 * here, out of any render, and `onLapse` is told which code it was: a field
 * still holding it can let it go too. `onLapse` should keep its identity
 * (`useCallback`), or each render sets the timer again.
 *
 * A hold may run a year, longer than a browser's timer can count (2³¹ ms,
 * about 25 days, past which it fires at once), so the timer wakes at its
 * longest and is set again from there until the hold has truly ended.
 */
export const useConnectCodeHeldUntil = (onLapse?: (code: string) => void): number | undefined => {
	const until = connectCodeHeldUntil();
	const code = until === undefined ? undefined : heldConnectCode();
	const [woken, setWoken] = useState(0);
	useEffect(
		() =>
			watchConnectCode(() => {
				setWoken((n) => n + 1);
			}),
		[]
	);
	useEffect(() => {
		if (code === undefined || until === undefined) return;
		const timer = setTimeout(
			() => {
				setWoken((n) => n + 1);
				if (Date.now() < until) return;
				forgetLapsedConnectCode();
				onLapse?.(code);
			},
			Math.min(Math.max(0, until - Date.now()) + 50, LONGEST_TIMER_MS)
		);
		return () => {
			clearTimeout(timer);
		};
	}, [code, until, onLapse, woken]);
	return until;
};
