/**
 * The adapter interface and its errors, one adapter per provider, and below
 * them names, paths, the marker and hashing.
 */

export { concatBytes } from './bytes.js';
export { cell, type Cell } from './cell.js';
export type { DocumentFormat } from './documentFormat.js';
export {
	contentTypeOf,
	extensionForType,
	type FileKind,
	isImageExtension,
	mediaOf,
} from './files/mediaTypes.js';
export type { AppFolderSpec } from './folderSpec.js';
export { bytesHash, contentHash } from './hash.js';
export { isJsonObject, parseJson } from './json.js';
export { buildMarker, parseMarker, serializeMarker } from './marker.js';
export { type Caps, clusters, cut, fitBytes, MAX_NAME_BYTES, utf8Length } from './names/bytes.js';
export {
	conflictFilePath,
	conflictFolderPath,
	conflictNameKeepingExtension,
	documentNames,
	type DocumentNames,
} from './names/conflicts.js';
export { extensionAt, extensionOf, extensionPart } from './names/extension.js';
export { foldName } from './names/fold.js';
export {
	ancestorPaths,
	basename,
	HIDDEN_PREFIX,
	isHidden,
	isWithin,
	joinPath,
	normalizePath,
	parentPath,
	pathSegments,
	rebasePath,
	replaceBasename,
	ROOT,
	SEPARATOR,
} from './paths.js';
export { createDropboxProvider } from './providers/dropbox.js';
export { createGDriveProvider } from './providers/gdrive/index.js';
export type { FetchLike } from './providers/http.js';
export { createOneDriveProvider } from './providers/onedrive.js';
export { withoutNul } from './providers/text.js';
export {
	AuthError,
	type ChangeEntry,
	type ChangeSet,
	ConflictError,
	CursorResetError,
	type DeletedEntry,
	type EntryRef,
	isAuthError,
	isConflictError,
	isCursorResetError,
	isNotFoundError,
	isRateLimitError,
	isUnreadableError,
	NotFoundError,
	RateLimitError,
	type RemoteEntry,
	type StorageProvider,
	UnreadableError,
} from './providers/types.js';
