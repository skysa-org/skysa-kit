import type { DocumentFormat } from '@skysa/storage';

import type { ClientDevice } from './device.js';
import { memoryDevice } from './memoryDevice.js';

/** A framed document, and the id it claims in the frame where it claims one. */
const FRAME = /^<doc(?: id="([^"]+)")?>([\s\S]*)<\/doc>\n$/;

/** A document holding `body`, claiming `id` where one is given. */
const framed = (body: string, id?: string): string =>
	`${id === undefined ? '<doc>' : `<doc id="${id}">`}${body}</doc>\n`;

/**
 * Documents that are documents only inside a frame: an app's whose documents
 * are more than their words, as an image's are, so that plain text is no
 * document to it (`DocumentFormat.isDocumentText`). The suites run over it as
 * well as over the kit's own format, so that what they put on the remote
 * themselves goes through the device (`ClientDevice.written`).
 */
const FRAMED: DocumentFormat = {
	extension: '.framed',
	mediaType: 'text/plain',
	claimedId: (content) => FRAME.exec(content)?.[1],
	conflictContent: (localContent, id) =>
		framed(FRAME.exec(localContent)?.[2] ?? localContent, id),
	isDocumentText: (content) => FRAME.test(content),
};

/** A device in memory whose documents are framed. */
export const framedDevice = (): ClientDevice => memoryDevice({ document: FRAMED, written: framed });
