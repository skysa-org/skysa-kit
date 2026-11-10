/**
 * The client's suites, each over a device (`ClientDevice`): an app runs them
 * over its own ports, as the kit runs them over ports in memory.
 */

export { describeChangeRelay, relayed } from './client/changeRelay.js';
export { describeClientStore } from './client/clientStore.js';
export { describeConnection } from './client/connection.js';
export type { AppSchedulerOptions, ClientDevice } from './client/device.js';
export { describeFailures } from './client/failures.js';
export { describePausing } from './client/pausing.js';
export { describePushTiming } from './client/pushTiming.js';
export { cleanups, focused, nextTimer, quiet, reaches, remote, schedulerDefaults, stopSchedulers } from './client/schedulerHarness.js';
export { describeScheduling } from './client/scheduling.js';
export { describeTokenSource } from './client/tokenSource.js';
export { fakeEnvironment } from './support/fakes/environment.js';
