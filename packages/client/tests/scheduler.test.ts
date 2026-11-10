import { memoryDevice } from './client/memoryDevice.js';
import { describeScheduling } from './client/scheduling.js';

// The scheduler over the ports in memory: no app's database, as the kit runs
// it (skysa-notes' record 0018). skysa-notes' own run, over its
// database and with its own scheduler, is `scheduler.dexie.test.ts`.
describeScheduling('over the ports in memory', memoryDevice);
