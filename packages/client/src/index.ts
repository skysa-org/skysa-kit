/**
 * The API client, the token source, the provider factory and its request
 * deadlines, the scheduler, the relay client, the connect code a device holds,
 * a long run's count, and the stores a screen listens to.
 */

export {
	api,
	type ApiClient,
	ApiError,
	type Connection,
	type Grant,
	type InstanceConfig,
	type Refusal,
	type Result,
} from './api/client.js';
export { answer, type Asked, useInstanceConfig } from './api/instanceConfig.js';
export {
	connectCodeAskedAt,
	connectCodeHeldUntil,
	dropConnectCode,
	heldConnectCode,
	heldConnectCodeShown,
	holdAcceptedCode,
	holdConnectCode,
	watchConnectCode,
} from './store/connectCode.js';
export {
	beginConnect,
	credentialFor,
	type CredentialRecord,
	forgetCredential,
	hashCredential,
	keepCredential,
	PENDING_CREDENTIAL_ID,
	pendingCredential,
	toBase64Url,
} from './store/credentials.js';
export { createEmitter, createStore } from './store/emitter.js';
export { makeWay, makeWayWhenAsked, updateChannel } from './sync/beforeUpdate.js';
export { isLongRun, PROGRESS_FROM, runBar, runCount, type RunCount } from './sync/progress.js';
export { createProviderFactory } from './sync/providers.js';
export { createRelayFactory, type RelayFactory } from './sync/relay.js';
export {
	browserEnvironment,
	type ClientStore,
	type Companion,
	createSyncScheduler,
	type SchedulerEnvironment,
	type SchedulerStatus,
	type StuckOp,
	SYNC_WAIT_MS,
	type SyncPhase,
	type SyncScheduler,
	type SyncSchedulerOptions,
} from './sync/scheduler.js';
export type { TokenStates } from './sync/tokens.js';
export { keepAwakeWhileSyncing } from './sync/wakeLock.js';
