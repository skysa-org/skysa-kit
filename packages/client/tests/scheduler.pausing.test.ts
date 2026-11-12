import { framedDevice } from './client/framed.js';
import { memoryDevice } from './client/memoryDevice.js';
import { describePausing } from './client/pausing.js';

// Pausing and waiting over the ports in memory: no app's database, as the kit
// runs it (skysa-notes' record 0018). skysa-notes' own run, over its
// database and with its own scheduler, is `scheduler.pausing.dexie.test.ts`.
describePausing('over the ports in memory', memoryDevice);
describePausing('over the ports in memory, in frames', framedDevice);
