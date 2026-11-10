import { TEXT_FORMAT } from './kit/textFormat.js';
import { createMemoryStore } from './memoryStore.js';
import { describeSyncStoreContract } from './storeContract.js';

/**
 * The registry for `SyncStore` implementations that live in `@skysa/sync`, in
 * the shape the provider contract already uses. An app's store registers in
 * its own tests instead (skysa-notes' `apps/web/tests/syncStore.test.ts`) —
 * so the engine's promises are checked against the thing the app actually runs
 * rather than only against the fixture.
 *
 * The Dexie store is notes' and runs with `NOTE_FORMAT`; this one runs with a
 * format that is not, so that a store reading markdown for itself would show.
 */

describeSyncStoreContract('in-memory', TEXT_FORMAT, () => {
	const store = createMemoryStore(TEXT_FORMAT);
	return {
		store,
		seed: store.put,
		// One connection is all this store is: there is no elsewhere to put it.
		seedElsewhere: () => undefined,
		seedFolder: store.putFolder,
		seedFile: store.putFile,
		dropFile: store.dropFile,
		seedOp: (op) => store.queue(op).seq,
		withdrawOp: (seq) => {
			store.unqueue(seq);
		},
	};
});
