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
		expect(() => fileOf(device, 'plain\n')).toThrow(/`written` made a file/);
	});
});
