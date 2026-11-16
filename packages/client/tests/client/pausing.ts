import { afterEach, describe, expect, it, vi } from 'vitest';

import { type Companion, SYNC_WAIT_MS } from '../../src/sync/scheduler.js';
import type { SharedPause } from '../../src/sync/sharedPause.js';
import { fakeEnvironment } from '../support/fakes/environment.js';
import { fakeSharedPause } from '../support/fakes/sharedPause.js';
import { type ClientDevice, fileOf } from './device.js';
import {
	cleanups,
	DEBOUNCE,
	deferred,
	type Harness,
	INTERVAL,
	quiet,
	reaches,
	remote,
	schedulerDefaults,
	started,
	stopSchedulers,
} from './schedulerHarness.js';

/**
 * Pausing a sync, and a run held up on another tab, over a device made new for
 * each test by `makeDevice`: the kit runs it over the ports in memory, and an
 * app over its own database with its own scheduler (`ClientDevice.schedule`).
 * Another tab holds the device up as `ClientDevice.holdUp` says, or holds the
 * sync's lock, which the device names (`ClientDevice.app`).
 */
export const describePausing = (
	name: string,
	makeDevice: () => ClientDevice | Promise<ClientDevice>
) => {
	const bound = async () => {
		const device = await makeDevice();
		await device.bind('c1');
		return device;
	};

	describe(`pausing and waiting, ${name}`, () => {
		afterEach(stopSchedulers);

		describe('pausing', () => {
			it('aborts the run under way, and says it is paused whatever that run comes to', async () => {
				const device = await bound();
				const signals: (AbortSignal | undefined)[] = [];
				const theRemote = remote();
				const held = deferred();
				theRemote.gate.set('changes', held.promise);
				const h = started(device, {
					createProvider: (input) => {
						signals.push(input.signal);
						return theRemote.factory(input);
					},
				});
				await vi.waitFor(() => {
					expect(theRemote.gated()).toBe(1);
				});

				h.scheduler.pause();

				expect(signals[0]?.aborted).toBe(true);
				// A session of its own, whose requests are not aborted: a file beside a
				// note is still read when it is opened.
				expect(signals).toHaveLength(2);
				expect(signals[1]?.aborted).toBe(false);
				expect(h.scheduler.status().phase).toBe('paused');
				theRemote.gate.delete('changes');
				held.resolve();
				await quiet();
				expect(h.scheduler.status().phase).toBe('paused');
			});

			it('starts nothing while paused, whatever asks', async () => {
				const device = await bound();
				const notices: (() => void)[] = [];
				const h = started(device, {
					relay: ({ onChanged }) => {
						notices.push(onChanged);
						return { pushed: () => undefined, close: () => undefined };
					},
				});
				await reaches(h.scheduler, 'idle');
				h.scheduler.pause();
				const before = h.remote.pulls();

				await device.create('c1', 'Later', 'kept here\n');
				await quiet();
				h.env.advance(DEBOUNCE);
				h.env.fire('focus');
				h.env.advance(INTERVAL);
				h.env.state.online = false;
				h.env.fire('offline');
				h.env.state.online = true;
				h.env.fire('online');
				notices.at(-1)?.();
				h.env.advance(10_000);
				await quiet();

				expect(h.remote.pulls()).toBe(before);
				// Not said to be offline over it either: `online` would not say paused again.
				expect(h.scheduler.status().phase).toBe('paused');
			});

			it('syncs again when the user asks, by Sync now or a re-scan', async () => {
				const device = await bound();
				const h = started(device);
				await reaches(h.scheduler, 'idle');
				const note = await device.create('c1', 'Kept', 'kept here\n');
				h.scheduler.pause();

				await h.scheduler.syncNow();

				expect(h.remote.fake.contentAt(note.path)).toContain('kept here');
				expect(h.scheduler.status().phase).toBe('idle');

				h.scheduler.pause();
				await h.scheduler.resync();

				expect(h.remote.cursors.at(-1)).toBeUndefined();
				expect(h.scheduler.status().phase).toBe('idle');
			});

			it('is over once the source is shown again after another', async () => {
				const device = await bound();
				const h = started(device);
				await reaches(h.scheduler, 'idle');
				h.scheduler.pause();

				await device.bind('c2');
				await vi.waitFor(() => {
					expect(h.server.withCredential).toHaveBeenLastCalledWith('sk1_c2');
				});
				await reaches(h.scheduler, 'idle');
				const before = h.remote.pulls();
				await device.show('c1');

				await vi.waitFor(() => {
					expect(h.remote.pulls()).toBeGreaterThan(before);
				});
				await reaches(h.scheduler, 'idle');
			});

			it('leaves an op given up on for a reason of its own as it was', async () => {
				const device = await bound();
				await device.create('c1', 'Stuck', 'refused\n');
				const documents = device.store.syncStore('c1');
				const [op] = await documents.pendingOps();
				if (op === undefined) throw new Error('nothing was queued');
				await documents.failOp(op.seq, 'refused');
				await documents.failOp(op.seq, 'refused');
				// Paused while a run is out, as a run so often is.
				const theRemote = remote();
				const held = deferred();
				theRemote.gate.set('changes', held.promise);
				const h = started(device, { maxAttempts: 2, createProvider: theRemote.factory });
				await vi.waitFor(() => {
					expect(theRemote.gated()).toBe(1);
				});

				h.scheduler.pause();
				theRemote.gate.delete('changes');
				held.resolve();
				await quiet();

				expect((await documents.pendingOps()).map((queued) => queued.attempts)).toEqual([
					2,
				]);
				expect(h.scheduler.status().phase).toBe('paused');
			});

			it('still shows the conflict copies the last sync wrote', async () => {
				const device = await bound();
				const note = await device.create('c1', 'Plan', 'one\n');
				const h = started(device);
				const documents = device.store.syncStore('c1');
				await vi.waitFor(async () => {
					expect((await documents.noteById(note.id))?.dirty).toBe(false);
				});
				await reaches(h.scheduler, 'idle');
				const version = h.remote.fake
					.snapshot()
					.find((entry) => entry.path === note.path)?.version;
				await h.remote.fake.write(note.path, fileOf(device, 'remote\n', note.id), {
					expectedVersion: version,
				});
				await device.edit('c1', note.id, 'local\n');
				await h.scheduler.syncNow();
				const copies = (await documents.allNotes())
					.filter((row) => row.path.includes('(conflict'))
					.map((row) => row.path);
				expect(copies).toHaveLength(1);

				h.scheduler.pause();

				expect(h.scheduler.status()).toMatchObject({ phase: 'paused', conflicts: copies });
			});

			it('counts no attempt against a send it aborted', async () => {
				const device = await bound();
				const theRemote = remote();
				const held = deferred();
				const aborted = new Map<'write', true>();
				const h = started(device, {
					createProvider: (input) => {
						const provider = theRemote.factory(input);
						if (provider === undefined) return provider;
						return {
							...provider,
							// As a real request does: refused once its signal is aborted.
							write: async (path, content, expectedVersion) => {
								await held.promise;
								if (input.signal?.aborted === true) {
									aborted.set('write', true);
									throw new DOMException(
										'The operation was aborted.',
										'AbortError'
									);
								}
								return provider.write(path, content, expectedVersion);
							},
						};
					},
				});
				await reaches(h.scheduler, 'idle');
				await device.create('c1', 'Sent', 'on its way\n');
				await quiet();
				h.env.advance(DEBOUNCE);
				await vi.waitFor(async () => {
					expect(await device.queued('c1')).not.toEqual([]);
					expect(h.scheduler.status().phase).toBe('syncing');
				});
				await quiet();

				h.scheduler.pause();
				held.resolve();
				await vi.waitFor(() => {
					expect(aborted.has('write')).toBe(true);
				});
				await quiet();

				const ops = await device.store.syncStore('c1').pendingOps();
				expect(ops.length).toBeGreaterThan(0);
				expect(ops.every((op) => op.attempts === 0)).toBe(true);
				expect(h.scheduler.status().phase).toBe('paused');
			});
		});

		describe('pausing, in every tab of the app', () => {
			/**
			 * Tabs of the app on one device: one remote, one token server, the
			 * device's locks, and the pause they share
			 * (`SchedulerEnvironment.sharedPause`, as `fakeSharedPause` takes
			 * `timing`). Each tab is started telling `companion`, if it is given
			 * one, over the shared pause the hub opens unless it is given another.
			 */
			const tabsOf = async (timing?: Parameters<typeof fakeSharedPause>[0]) => {
				const device = await bound();
				const hub = fakeSharedPause(timing);
				const first = schedulerDefaults();
				const tab = ({
					companion = {},
					sharedPause = hub.open,
				}: Readonly<{
					companion?: Companion;
					sharedPause?: (heard: (name: string) => void) => SharedPause;
				}> = {}) => {
					const env = fakeEnvironment();
					const scheduler = device.schedule({
						...first.options,
						environment: {
							...env.environment,
							withLock: first.env.environment.withLock,
							sharedPause,
						},
					});
					cleanups.unshift(() => {
						scheduler.stop();
					});
					scheduler.attach(companion);
					scheduler.start();
					return { scheduler, env };
				};
				return {
					device,
					hub,
					remote: first.remote,
					tab,
					withLock: first.env.environment.withLock,
				};
			};

			/** A companion, and what it is told, in order. */
			const told = () => {
				const said: string[] = [];
				const companion: Companion = {
					started: () => {
						said.push('started');
					},
					ended: () => {
						said.push('ended');
					},
				};
				return { said, companion };
			};

			it('pauses every tab that shows the source, and asking again in one ends it in all', async () => {
				const { device, hub, remote: theRemote, tab } = await tabsOf();
				const one = tab();
				const two = tab();
				await reaches(one.scheduler, 'idle');
				await reaches(two.scheduler, 'idle');

				one.scheduler.pause();

				await reaches(two.scheduler, 'paused');
				// A change made in either is kept here, as the apps say.
				const note = await device.create('c1', 'Kept', 'kept here\n');
				const before = theRemote.pulls();
				[one, two].forEach(({ env }) => {
					env.advance(DEBOUNCE);
					env.fire('focus');
					env.advance(INTERVAL);
				});
				await quiet();
				expect(theRemote.pulls()).toBe(before);
				expect(theRemote.fake.contentAt(note.path)).toBeUndefined();

				const asking = two.scheduler.syncNow();
				// Over in every tab as the user asks.
				expect(hub.parts()).toBe(0);
				await asking;

				expect(theRemote.fake.contentAt(note.path)).toContain('kept here');
				expect(two.scheduler.status().phase).toBe('idle');
				await reaches(one.scheduler, 'idle');
				// The other ran no round beside the one asked for, and syncs at its
				// next minute.
				await quiet();
				expect(theRemote.pulls()).toBe(before + 1);
				one.env.advance(INTERVAL);
				await vi.waitFor(() => {
					expect(theRemote.pulls()).toBe(before + 2);
				});

				// And a re-scan.
				two.scheduler.pause();
				await reaches(one.scheduler, 'paused');
				await two.scheduler.resync();
				expect(theRemote.cursors.at(-1)).toBeUndefined();
				await reaches(one.scheduler, 'idle');
				await quiet();
				expect(theRemote.pulls()).toBe(before + 3);
			});

			it('tells each tab’s companions the sync stopped there, and started again', async () => {
				const { tab } = await tabsOf();
				const first = told();
				const second = told();
				const one = tab({ companion: first.companion });
				const two = tab({ companion: second.companion });
				await reaches(one.scheduler, 'idle');
				await reaches(two.scheduler, 'idle');

				one.scheduler.pause();
				await reaches(two.scheduler, 'paused');

				expect(first.said).toEqual(['started', 'ended']);
				expect(second.said).toEqual(['started', 'ended']);

				await one.scheduler.syncNow();

				expect(first.said).toEqual(['started', 'ended', 'started']);
				// The other's, as it next syncs.
				await quiet();
				expect(second.said).toEqual(['started', 'ended']);
				two.env.advance(INTERVAL);
				await vi.waitFor(() => {
					expect(second.said).toEqual(['started', 'ended', 'started']);
				});
				// Asked again unpaused, nothing started again.
				await one.scheduler.syncNow();
				await quiet();
				expect(first.said).toEqual(['started', 'ended', 'started']);
				expect(second.said).toEqual(['started', 'ended', 'started']);
			});

			it('pauses a tab opened while another is paused, which starts nothing', async () => {
				const { remote: theRemote, tab } = await tabsOf();
				const one = tab();
				await reaches(one.scheduler, 'idle');
				one.scheduler.pause();
				const before = theRemote.pulls();
				const second = told();

				const two = tab({ companion: second.companion });

				await reaches(two.scheduler, 'paused');
				two.env.fire('focus');
				two.env.advance(INTERVAL);
				await quiet();
				expect(theRemote.pulls()).toBe(before);
				// Not even that a session ended, which it was never told started.
				expect(second.said).toEqual([]);
				// A paused tab, told as a third pauses with it, is left as it is.
				const said: string[] = [];
				[one, two].forEach(({ scheduler }) => {
					scheduler.subscribe((next) => said.push(next.phase));
				});
				const three = tab();
				await reaches(three.scheduler, 'paused');
				await quiet();
				expect(said).toEqual([]);
			});

			it('stops a run under way in another tab as it hears', async () => {
				const { remote: theRemote, tab } = await tabsOf();
				const one = tab();
				const two = tab();
				await reaches(one.scheduler, 'idle');
				await reaches(two.scheduler, 'idle');
				const held = deferred();
				theRemote.gate.set('changes', held.promise);
				const arrived = theRemote.gated();
				two.env.advance(INTERVAL);
				await vi.waitFor(() => {
					expect(theRemote.gated()).toBe(arrived + 1);
				});

				one.scheduler.pause();

				await reaches(two.scheduler, 'paused');
				theRemote.gate.delete('changes');
				held.resolve();
			});

			it('keeps a pause made as Sync now asks', async () => {
				const { hub, remote: theRemote, tab } = await tabsOf();
				const one = tab();
				const two = tab();
				await reaches(one.scheduler, 'idle');
				await reaches(two.scheduler, 'idle');
				one.scheduler.pause();
				await reaches(two.scheduler, 'paused');
				const before = theRemote.pulls();

				const asking = one.scheduler.syncNow();
				one.scheduler.pause();
				await asking;
				// Whatever asks it to run after.
				one.env.fire('focus');
				one.env.advance(INTERVAL);

				await reaches(two.scheduler, 'paused');
				await quiet();
				expect(one.scheduler.status().phase).toBe('paused');
				expect(hub.parts()).toBe(2);
				expect(theRemote.pulls()).toBe(before);
			});

			it('stays paused while a re-scan waits for the lock, and runs only the round asked for', async () => {
				const { device, remote: theRemote, tab, withLock } = await tabsOf();
				const one = tab();
				const two = tab();
				await reaches(one.scheduler, 'idle');
				await reaches(two.scheduler, 'idle');
				one.scheduler.pause();
				await reaches(two.scheduler, 'paused');
				const before = theRemote.pulls();
				// Another tab's run, of a build before this one, at the network.
				const theirs = deferred();
				const theirSync = withLock(device.app.lockName('c1'), () => theirs.promise);

				const asking = one.scheduler.resync();
				await reaches(two.scheduler, 'idle');
				one.env.fire('focus');
				one.env.advance(DEBOUNCE);
				await quiet();
				expect(one.scheduler.status().phase).toBe('paused');
				theirs.resolve();
				await theirSync;
				await asking;

				await quiet();
				expect(theRemote.pulls()).toBe(before + 1);
				expect(theRemote.cursors.at(-1)).toBeUndefined();
				expect(one.scheduler.status().phase).toBe('idle');
			});

			it('stays paused while Sync now gives the attempts back, and runs only the round asked for', async () => {
				const { device, remote: theRemote, tab, withLock } = await tabsOf();
				const one = tab();
				const two = tab();
				await reaches(one.scheduler, 'idle');
				await reaches(two.scheduler, 'idle');
				one.scheduler.pause();
				await reaches(two.scheduler, 'paused');
				const before = theRemote.pulls();
				// Another tab's run at the network, so that a run started here
				// waits for it.
				const theirs = deferred();
				const theirSync = withLock(device.app.lockName('c1'), () => theirs.promise);

				const asking = one.scheduler.syncNow();
				one.env.fire('focus');
				one.env.advance(DEBOUNCE);
				await quiet();
				theirs.resolve();
				await theirSync;
				await asking;

				await quiet();
				expect(theRemote.pulls()).toBe(before + 1);
				expect(one.scheduler.status().phase).toBe('idle');
			});

			it('syncs again at its next minute, or in sight, in a tab whose pause another ended', async () => {
				const { remote: theRemote, tab } = await tabsOf();
				const one = tab();
				const two = tab();
				const three = tab();
				await reaches(one.scheduler, 'idle');
				await reaches(two.scheduler, 'idle');
				await reaches(three.scheduler, 'idle');
				two.env.set({ visible: false });
				three.env.set({ online: false });
				one.scheduler.pause();
				await reaches(two.scheduler, 'paused');
				await reaches(three.scheduler, 'paused');
				const before = theRemote.pulls();

				await one.scheduler.syncNow();

				await reaches(two.scheduler, 'idle');
				// Offline says more than idle does.
				await reaches(three.scheduler, 'offline');
				two.env.advance(INTERVAL);
				await quiet();
				expect(theRemote.pulls()).toBe(before + 1);
				two.env.set({ visible: true });
				await vi.waitFor(() => {
					expect(theRemote.pulls()).toBe(before + 2);
				});
			});

			it('tells companions nothing of a session ended while it looked', async () => {
				const { device, hub, tab } = await tabsOf();
				await device.bind('c2');
				await device.show('c1');
				const first = told();
				hub.holdLooks();
				tab({ companion: first.companion });
				await vi.waitFor(() => {
					expect(hub.looking()).toBe(1);
				});

				await device.show('c2');
				await vi.waitFor(() => {
					expect(hub.looking()).toBe(2);
				});
				hub.answer();
				await quiet();

				// The one for the source shown first was never started.
				expect(first.said).toEqual(['started']);
			});

			it('keeps no pause that a look found as it was asked again', async () => {
				const { hub, tab } = await tabsOf();
				const one = tab();
				const two = tab();
				await reaches(one.scheduler, 'idle');
				await reaches(two.scheduler, 'idle');
				one.scheduler.pause();
				await reaches(two.scheduler, 'paused');
				hub.holdLooks();
				const three = tab();
				await vi.waitFor(() => {
					expect(hub.looking()).toBe(1);
				});

				const asking = one.scheduler.syncNow();
				await reaches(two.scheduler, 'idle');
				// Held as it was asked: over as it is answered.
				hub.answer();
				await asking;

				await reaches(three.scheduler, 'idle');
				await quiet();
				expect(hub.parts()).toBe(0);
				expect(one.scheduler.status().phase).toBe('idle');
				expect(two.scheduler.status().phase).toBe('idle');
			});

			it('pauses a tab that never heard of it as it next runs', async () => {
				const { remote: theRemote, tab } = await tabsOf({ words: 'byHand' });
				const one = tab();
				const two = tab();
				await reaches(one.scheduler, 'idle');
				await reaches(two.scheduler, 'idle');
				one.scheduler.pause();
				await quiet();
				expect(two.scheduler.status().phase).toBe('idle');
				const before = theRemote.pulls();

				two.env.advance(INTERVAL);

				await reaches(two.scheduler, 'paused');
				await quiet();
				expect(theRemote.pulls()).toBe(before);
			});

			it('leaves a tab as it is that hears of a pause already over', async () => {
				const { hub, tab } = await tabsOf({ words: 'byHand' });
				const one = tab();
				const two = tab();
				await reaches(one.scheduler, 'idle');
				await reaches(two.scheduler, 'idle');
				one.scheduler.pause();
				await one.scheduler.syncNow();
				const said: string[] = [];
				two.scheduler.subscribe((next) => said.push(next.phase));

				hub.deliver();
				await quiet();

				expect(said).toEqual([]);
			});

			it('leaves a tab alone that another source is paused in', async () => {
				const { hub, remote: theRemote, tab } = await tabsOf();
				const one = tab();
				await reaches(one.scheduler, 'idle');
				const other = hub.open(() => undefined);
				hub.holdLooks();

				other.hold('another source', () => undefined);
				await quiet();

				// Not even a look.
				expect(hub.looking()).toBe(0);
				hub.answer();
				expect(one.scheduler.status().phase).toBe('idle');
				const before = theRemote.pulls();
				one.env.advance(INTERVAL);
				await vi.waitFor(() => {
					expect(theRemote.pulls()).toBeGreaterThan(before);
				});
				await reaches(one.scheduler, 'idle');
			});

			it('keeps a tab paused for an update through another tab asking again', async () => {
				const { hub, remote: theRemote, tab } = await tabsOf();
				const one = tab();
				const two = tab();
				await reaches(one.scheduler, 'idle');
				await reaches(two.scheduler, 'idle');
				const stillPaused = async (asked: () => void) => {
					asked();
					await reaches(two.scheduler, 'paused');
					const before = theRemote.pulls();

					await two.scheduler.syncNow();
					one.env.advance(INTERVAL);
					one.env.fire('focus');
					await quiet();

					expect(one.scheduler.status().phase).toBe('paused');
					expect(theRemote.pulls()).toBe(before + 1);
				};

				await stillPaused(() => {
					one.scheduler.pause();
					one.scheduler.pause({ thisTab: true });
				});
				// Paused on the device again there, it holds a part again.
				await stillPaused(() => {
					one.scheduler.pause();
				});
				// Its part ended, it takes none again as it starts.
				one.scheduler.stop();
				one.scheduler.start();
				await quiet();
				expect(hub.parts()).toBe(0);
				await one.scheduler.syncNow();
				await stillPaused(() => {
					one.scheduler.pause({ thisTab: true });
					one.scheduler.pause();
				});
				// Paused for an update, it takes no part in a pause another tab
				// makes after.
				await one.scheduler.syncNow();
				await stillPaused(() => {
					one.scheduler.pause({ thisTab: true });
					two.scheduler.pause();
				});
			});

			it('pauses no other tab for an update, nor one opened after it', async () => {
				const { hub, tab } = await tabsOf();
				const one = tab();
				const two = tab();
				await reaches(one.scheduler, 'idle');
				await reaches(two.scheduler, 'idle');

				one.scheduler.pause({ thisTab: true });
				const three = tab();
				await quiet();

				expect(hub.parts()).toBe(0);
				expect(one.scheduler.status().phase).toBe('paused');
				expect(two.scheduler.status().phase).toBe('idle');
				expect(three.scheduler.status().phase).toBe('idle');
			});

			it('lets go of its part as it shows another source, and keeps it as it stops', async () => {
				const { device, hub, tab } = await tabsOf();
				const one = tab();
				const two = tab();
				await reaches(one.scheduler, 'idle');
				await reaches(two.scheduler, 'idle');
				one.scheduler.pause();
				await reaches(two.scheduler, 'paused');
				expect(hub.parts()).toBe(2);
				// Paused again, it holds the one part it had.
				one.scheduler.pause();
				expect(hub.parts()).toBe(2);

				await device.bind('c2');

				await vi.waitFor(() => {
					expect(hub.parts()).toBe(0);
				});
				await device.show('c1');
				const three = tab();
				await reaches(one.scheduler, 'idle');
				await reaches(three.scheduler, 'idle');

				// Stopped, it hears no word, and holds its part still.
				one.scheduler.pause();
				await reaches(two.scheduler, 'paused');
				two.scheduler.stop();
				expect(hub.openCount()).toBe(2);
				expect(hub.parts()).toBe(3);
			});

			it('keeps a pause, and its part, through a stop and a start', async () => {
				const { hub, remote: theRemote, tab } = await tabsOf();
				const one = tab();
				await reaches(one.scheduler, 'idle');
				one.scheduler.pause();
				const before = theRemote.pulls();

				one.scheduler.stop();
				expect(hub.parts()).toBe(1);
				one.scheduler.start();

				await reaches(one.scheduler, 'paused');
				one.env.advance(INTERVAL);
				await quiet();
				expect(theRemote.pulls()).toBe(before);
				expect(hub.parts()).toBe(1);
			});

			it('starts unpaused once another tab asked again while it was stopped', async () => {
				const { hub, remote: theRemote, tab } = await tabsOf();
				const one = tab();
				const two = tab();
				await reaches(one.scheduler, 'idle');
				await reaches(two.scheduler, 'idle');
				one.scheduler.pause();
				await reaches(two.scheduler, 'paused');
				one.scheduler.stop();

				await two.scheduler.syncNow();
				await quiet();
				const before = theRemote.pulls();
				one.scheduler.start();

				await vi.waitFor(() => {
					expect(theRemote.pulls()).toBe(before + 1);
				});
				await reaches(one.scheduler, 'idle');
				expect(hub.parts()).toBe(0);
			});
		});

		/**
		 * A run held up on another tab (2026-10-10): reported on a phone, behind reads
		 * a frozen tab of the app had left open, saying "Syncing…" for minutes. Held
		 * up here as the device is by another tab (`ClientDevice.holdUp`), or behind
		 * another tab's run holding the sync's lock.
		 */
		describe('a run held up on another tab', () => {
			/** Held up, and the scheduler told: the same wait a moment later, and timed. */
			const waitedOn = async (h: Harness) => {
				const held = h.device.store.heldUp();
				await vi.waitFor(async () => {
					const wait = held?.waiting();
					expect(wait).toBeDefined();
					await new Promise((resolve) => setTimeout(resolve, 20));
					expect(held?.waiting()).toBe(wait);
					expect(h.env.pending()).toContain(SYNC_WAIT_MS);
				});
			};

			it('says so once it has waited a while, and stops saying so when the other tab lets go', async () => {
				const device = await bound();
				const h = started(device);
				await reaches(h.scheduler, 'idle');
				const release = await device.holdUp();

				h.env.fire('focus');
				await waitedOn(h);
				h.env.advance(SYNC_WAIT_MS - 1);
				expect(h.scheduler.status()).toMatchObject({ phase: 'syncing' });
				expect(h.scheduler.status().waiting).toBeUndefined();

				h.env.advance(1);
				expect(h.scheduler.status()).toMatchObject({ phase: 'syncing', waiting: true });

				release();
				await reaches(h.scheduler, 'idle');
				expect(h.scheduler.status().waiting).toBeUndefined();
				expect(h.env.pending().filter((ms) => ms < INTERVAL)).toEqual([]);
			});

			it('says so behind another tab’s sync of the same source, and stops once it has its turn', async () => {
				const device = await bound();
				const h = started(device);
				await reaches(h.scheduler, 'idle');
				const theirs = deferred();
				const theirSync = h.env.environment.withLock(
					device.app.lockName('c1'),
					() => theirs.promise
				);
				const held = deferred();
				h.remote.gate.set('changes', held.promise);
				const arrived = h.remote.gated();

				h.env.fire('focus');
				await reaches(h.scheduler, 'syncing');
				h.env.advance(SYNC_WAIT_MS - 1);
				expect(h.scheduler.status().waiting).toBeUndefined();
				h.env.advance(1);
				expect(h.scheduler.status()).toMatchObject({ phase: 'syncing', waiting: true });

				theirs.resolve();
				await theirSync;
				await vi.waitFor(() => {
					expect(h.remote.gated()).toBe(arrived + 1);
				});
				expect(h.scheduler.status().phase).toBe('syncing');
				expect(h.scheduler.status().waiting).toBeUndefined();

				h.remote.gate.delete('changes');
				held.resolve();
				await reaches(h.scheduler, 'idle');
			});

			it('does not take a wait behind this tab’s own paused run for another tab', async () => {
				// Its requests are aborted, but it puts away what it has before it lets
				// go of the lock, and Sync now can come first.
				const device = await bound();
				const h = started(device);
				await reaches(h.scheduler, 'idle');
				const held = deferred();
				h.remote.gate.set('changes', held.promise);
				const arrived = h.remote.gated();
				h.env.fire('focus');
				await vi.waitFor(() => {
					expect(h.remote.gated()).toBe(arrived + 1);
				});
				h.scheduler.pause();
				h.remote.gate.delete('changes');

				void h.scheduler.syncNow();
				await reaches(h.scheduler, 'syncing');
				h.env.advance(SYNC_WAIT_MS);
				expect(h.scheduler.status().waiting).toBeUndefined();
				// Asked again a while later, since another tab may be next.
				expect(h.env.pending()).toContain(SYNC_WAIT_MS);

				held.resolve();
				await reaches(h.scheduler, 'idle');
				expect(h.scheduler.status().waiting).toBeUndefined();
			});
		});
	});
};
