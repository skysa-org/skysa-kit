import { describeConnection } from './client/connection.js';
import { memoryDevice } from './client/memoryDevice.js';

// The scheduler following the connection over the ports in memory: no app's
// database, as the kit runs it (skysa-notes' record 0018). skysa-notes'
// own run, over its database and with its own scheduler, is
// `scheduler.connection.dexie.test.ts`.
describeConnection('over the ports in memory', memoryDevice);
