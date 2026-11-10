/**
 * The engine's test doubles: the in-memory store, `describeSyncStoreContract`,
 * and the simulation kit the engine's tests run in.
 */

export { syncWorld } from './kit/world.js';
export { createMemoryStore, type MemoryStore } from './memoryStore.js';
export { describeSyncStoreContract, type StoreHarness } from './storeContract.js';
