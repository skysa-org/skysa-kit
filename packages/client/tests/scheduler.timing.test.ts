import { memoryDevice } from './client/memoryDevice.js';
import { describePushTiming } from './client/pushTiming.js';

// When a push goes, over the ports in memory, as the kit runs it
// (skysa-notes' record 0018). skysa-notes' own run is
// `scheduler.timing.dexie.test.ts`.
describePushTiming('over the ports in memory', memoryDevice);
