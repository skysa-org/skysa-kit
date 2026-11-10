import { describeClientStore } from './client/clientStore.js';
import { memoryDevice } from './client/memoryDevice.js';

// The scheduler's port over the ports in memory: no app's database, as the kit
// runs it (skysa-notes' record 0018). skysa-notes' own run, over
// its database, is `clientStore.dexie.test.ts`.
describeClientStore('over the ports in memory', memoryDevice);
