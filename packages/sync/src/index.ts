/**
 * The sync engine and its store port, over a document format the app supplies.
 */

export { outOfAttempts } from './attempts.js';
export { createSyncEngine, type MergeInput, type SyncEngine } from './engine.js';
export { messageOf, type SyncOutcome, type Watch } from './outcome.js';
export type { SyncProgress } from './progress.js';
export {
	type ConflictResolution,
	isFileChange,
	type NewSyncOp,
	type OpOutcome,
	type PullBatch,
	type PullChange,
	type SyncFile,
	type SyncFolder,
	type SyncNote,
	type SyncOp,
	type SyncOperation,
	type SyncStore,
	type UnreadableFile,
} from './store.js';
