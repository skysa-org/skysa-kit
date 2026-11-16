import { cell } from '@skysa/storage';

type Mode = 'exclusive' | 'shared';

interface Held {
	readonly name: string;
	readonly mode: Mode;
	/** Its request's promise refused, as a steal refuses it. */
	readonly stolen: () => void;
}

interface Waiting {
	readonly name: string;
	readonly mode: Mode;
	readonly grant: () => void;
}

type Callback = (lock: Readonly<{ name: string; mode: Mode }>) => unknown;

/**
 * `navigator.locks` as the Web Locks spec has it, in memory, for the browser's
 * shared pause (`browserSharedPause`), which Node has no locks to run over:
 * each name's requests granted in the order they came, shared ones together,
 * a steal granted at once with every lock it takes refused with an
 * `AbortError`, and `query` a snapshot. It can be made to refuse requests or
 * queries, as a lock manager can.
 * https://w3c.github.io/web-locks/#api-lock-manager
 */
export const fakeLocks = () => {
	const held: Held[] = [];
	const queue: Waiting[] = [];
	const refusing = new Set<'request' | 'query'>();

	const grantable = (request: Waiting): boolean => {
		if (queue.find((waiting) => waiting.name === request.name) !== request) return false;
		const holders = held.filter((lock) => lock.name === request.name);
		return request.mode === 'shared'
			? holders.every((lock) => lock.mode === 'shared')
			: holders.length === 0;
	};

	const process = () => {
		const next = queue.find(grantable);
		if (next === undefined) return;
		queue.splice(queue.indexOf(next), 1);
		next.grant();
		process();
	};

	const remove = (lock: Held) => {
		const at = held.indexOf(lock);
		if (at >= 0) held.splice(at, 1);
	};

	const request = (
		name: string,
		...args: [Callback] | [Readonly<{ mode?: Mode; steal?: boolean }>, Callback]
	): Promise<unknown> => {
		const [options, callback] = args.length === 1 ? [{}, args[0]] : args;
		const mode = options.mode ?? 'exclusive';
		if (refusing.has('request')) {
			return Promise.reject(new DOMException('Refused.', 'InvalidStateError'));
		}
		return new Promise((resolve, reject) => {
			const done = cell(false);
			const lock: Held = {
				name,
				mode,
				stolen: () => {
					done.current = true;
					reject(new DOMException('The lock was stolen.', 'AbortError'));
				},
			};
			const grant = () => {
				held.push(lock);
				// The callback runs as a task would, after the grant.
				void Promise.resolve()
					.then(() => callback({ name, mode }))
					.then(
						(value) => {
							remove(lock);
							if (!done.current) resolve(value);
							process();
						},
						(error: unknown) => {
							remove(lock);
							if (!done.current)
								reject(error instanceof Error ? error : new Error(String(error)));
							process();
						}
					);
			};
			if (options.steal === true) {
				held.filter((other) => other.name === name).forEach((other) => {
					remove(other);
					other.stolen();
				});
				grant();
				return;
			}
			queue.push({ name, mode, grant });
			process();
		});
	};

	const query = () =>
		refusing.has('query')
			? Promise.reject(new DOMException('Refused.', 'InvalidStateError'))
			: Promise.resolve({
					held: held.map(({ name, mode }) => ({ name, mode })),
					pending: queue.map(({ name, mode }) => ({ name, mode })),
				});

	return {
		locks: { request, query },
		/** Locks held under `name`, in either mode. */
		held: (name: string) => held.filter((lock) => lock.name === name).length,
		/** Has the lock manager refuse `what` from now on, or no longer. */
		refuse: (what: 'request' | 'query', refused = true) => {
			if (refused) refusing.add(what);
			else refusing.delete(what);
		},
	};
};
