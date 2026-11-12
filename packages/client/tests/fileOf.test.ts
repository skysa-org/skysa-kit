import type { DocumentFormat } from '@skysa/storage';
import { describe, expect, it } from 'vitest';

import { fileOf } from './client/device.js';
import { framedDevice } from './client/framed.js';
import { memoryDevice } from './client/memoryDevice.js';

// What the suites put on the remote themselves, as another device of the app
// writes it (`ClientDevice.written`).
describe('a file the suites put on the remote (fileOf)', () => {
	it('is the body as it is, on a device whose plain text is a document', () => {
		expect(fileOf(memoryDevice(), 'plain\n', 'doc-1')).toBe('plain\n');
	});

	it('is the device’s own, claiming the id it is given, where the device writes its files', () => {
		expect(fileOf(framedDevice(), 'plain\n', 'doc-1')).toBe('<doc id="doc-1">plain\n</doc>\n');
		expect(fileOf(framedDevice(), 'plain\n')).toBe('<doc>plain\n</doc>\n');
	});

	it('is refused, naming what the device lacks, where plain text is no document to the app', () => {
		const device = { ...memoryDevice(), app: framedDevice().app };
		expect(() => fileOf(device, 'plain\n')).toThrow(/give the device `written`/);
	});

	it('is refused where the device writes a file that is no document to its app', () => {
		const device = { ...framedDevice(), written: (body: string) => body };
		expect(() => fileOf(device, 'plain\n')).toThrow(/`written` made a file this app/);
	});

	it('is refused where the device writes a file that does not claim the id it is given', () => {
		const device = { ...framedDevice(), written: (body: string) => `<doc>${body}</doc>\n` };
		expect(() => fileOf(device, 'plain\n', 'doc-1')).toThrow(/does not claim doc-1/);
		expect(fileOf(device, 'plain\n')).toBe('<doc>plain\n</doc>\n');
	});

	it('claims no id where the app’s documents claim none', () => {
		const boxed: DocumentFormat = {
			extension: '.box',
			mediaType: 'text/plain',
			claimedId: () => undefined,
			conflictContent: (localContent) => localContent,
			isDocumentText: (content) => content.startsWith('['),
		};
		const plain = memoryDevice();
		const device = {
			...plain,
			app: { ...plain.app, document: boxed },
			written: (body: string) => `[${body}]\n`,
		};
		expect(fileOf(device, 'plain\n', 'doc-1')).toBe('[plain\n]\n');
	});
});
