import { describe, expect, it } from 'vitest';

import type { Refusal } from '../src/api/client.js';
import { needsReconnect, type SyncPhase } from '../src/sync/scheduler.js';

const PHASES: readonly SyncPhase[] = [
	'local',
	'idle',
	'syncing',
	'retrying',
	'offline',
	'attention',
	'paused',
];

describe('needsReconnect', () => {
	it.each<[Refusal, boolean]>([
		['credential_required', true],
		['credential_revoked', true],
		['reauthorize_required', true],
		['not_entitled', false],
		['not_found', false],
		['forbidden_origin', false],
	])(
		'says a refusal of %s is answered by connecting again: %s, whatever the phase',
		(refusal, answer) => {
			expect(
				PHASES.map((phase) => needsReconnect({ phase, refusal, conflicts: [] }))
			).toEqual(PHASES.map(() => answer));
		}
	);

	it('says nothing is, where nothing was refused', () => {
		expect(
			PHASES.map((phase) =>
				needsReconnect({ phase, error: 'authorization required', conflicts: [] })
			)
		).toEqual(PHASES.map(() => false));
	});
});
