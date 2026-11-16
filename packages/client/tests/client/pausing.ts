import { afterEach, describe, expect, it, vi } from 'vitest';

import { SYNC_WAIT_MS } from '../../src/sync/scheduler.js';
import { fakeEnvironment } from '../support/fakes/environment.js';
import { fakeTabs } from '../support/fakes/tabs.js';
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

		/**
		 * A run held up on another tab (2026-10-10): reported on a phone, behind reads
		 * a frozen tab of the app had left open, saying "Syncing…" for minutes. Held
		 * up here as the device is by another tab (`ClientDevice.holdUp`), or behind
		 * another tab's run holding the sync's lock.
		 */
		describe('pausing, in every tab of the app', () => {
			/**
			 * Tabs of the app on one device: one remote, one token server, the
			 * device's locks, and a channel between them (`SchedulerEnvironment.tabs`).
			 */
			const tabsOf = async (delivery?: 'later' | 'at once') => {
				const device = await bound();
				const hub = fakeTabs(delivery);
				const first = schedulerDefaults();
				const tab = () => {
					const env = fakeEnvironment();
					const scheduler = device.schedule({
						...first.options,
						environment: {
							...env.environment,
							withLock: first.env.environment.withLock,
							tabs: hub.open,
						},
					});
					cleanups.unshift(() => {
						scheduler.stop();
					});
					scheduler.start();
					return { scheduler, env };
				};
				return { device, hub, remote: first.remote, tab };
			};

			it('pauses every tab that shows the source, and asking again in one ends it in all', async () => {
				const { device, hub, remote: theRemote, tab } = await tabsOf();
				const one = tab();
				const two = tab();
				await reaches(one.scheduler, 'idle');
				await reaches(two.scheduler, 'idle');

				one.scheduler.pause();

				await reaches(two.scheduler, 'paused');
				// Heard there, and not told again.
				expect(hub.told.filter((message) => message.kind === 'paused')).toHaveLength(1);
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

				await two.scheduler.syncNow();

				expect(theRemote.fake.contentAt(note.path)).toContain('kept here');
				await reaches(one.scheduler, 'idle');
				expect(two.scheduler.status().phase).toBe('idle');
			});

			it('pauses a tab opened while another is paused', async () => {
				const { remote: theRemote, tab } = await tabsOf();
				const one = tab();
				await reaches(one.scheduler, 'idle');
				one.scheduler.pause();

				const two = tab();

				await reaches(two.scheduler, 'paused');
				const before = theRemote.pulls();
				two.env.fire('focus');
				two.env.advance(INTERVAL);
				await quiet();
				expect(theRemote.pulls()).toBe(before);
				expect(two.scheduler.status().phase).toBe('paused');
				// Told again as a third asks, a paused tab is left as it is.
				const said: string[] = [];
				[one, two].forEach(({ scheduler }) => {
					scheduler.subscribe((next) => said.push(next.phase));
				});
				const three = tab();
				await reaches(three.scheduler, 'paused');
				await quiet();
				expect(said).toEqual([]);
			});

			it('pauses a tab opened while another is paused, told before it reads what the app shows', async () => {
				const { remote: theRemote, tab } = await tabsOf('at once');
				const one = tab();
				await reaches(one.scheduler, 'idle');
				one.scheduler.pause();
				const before = theRemote.pulls();

				const two = tab();

				await reaches(two.scheduler, 'paused');
				await quiet();
				expect(theRemote.pulls()).toBe(before);
			});

			it('leaves a tab alone that another source is paused or resumed in, and answers no ask unpaused', async () => {
				const { hub, remote: theRemote, tab } = await tabsOf();
				const one = tab();
				await reaches(one.scheduler, 'idle');
				const other = hub.open(() => undefined);

				other.tell({ kind: 'paused', connectionId: 'c2' });
				other.tell({ kind: 'asking' });
				await quiet();

				expect(one.scheduler.status().phase).toBe('idle');
				expect(hub.told.filter((message) => message.kind === 'paused')).toHaveLength(1);

				one.scheduler.pause();
				other.tell({ kind: 'resumed', connectionId: 'c2' });
				await quiet();
				const before = theRemote.pulls();
				one.env.fire('focus');
				one.env.advance(INTERVAL);
				await quiet();

				expect(theRemote.pulls()).toBe(before);
				expect(one.scheduler.status().phase).toBe('paused');
			});

			it('hears no other tab once stopped', async () => {
				const { hub, tab } = await tabsOf();
				const one = tab();
				const two = tab();
				await reaches(two.scheduler, 'idle');
				expect(hub.openCount()).toBe(2);

				two.scheduler.stop();

				expect(hub.openCount()).toBe(1);
				one.scheduler.pause();
				await quiet();
				expect(two.scheduler.status().phase).not.toBe('paused');
			});
		});

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
