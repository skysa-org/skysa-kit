import type { RemoteEntry } from '@skysa/storage';
import type { FakeProvider } from '@skysa/storage/testing';

/** What the remote holds at a path, if anything. */
export const remoteAt = (provider: FakeProvider, path: string): RemoteEntry | undefined =>
	provider.snapshot().find((entry) => entry.path === path);

/** What the remote holds at a path, for a test that cannot go on without it. */
export const entryAt = (provider: FakeProvider, path: string): RemoteEntry => {
	const found = remoteAt(provider, path);
	if (found === undefined) throw new Error(`nothing on the remote at ${path}`);
	return found;
};
