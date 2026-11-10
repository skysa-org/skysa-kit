/**
 * Storage's test doubles, for the tests of what uses it: the fake provider,
 * the providers' wire stubs, `describeProviderContract`, and a document format
 * of the tests' own.
 */

export {
	createFakeProvider,
	type FakeCall,
	type FakeFault,
	type FakeOperation,
	type FakeProvider,
	type FakeProviderOptions,
	TEST_FOLDER,
} from '../src/providers/fake.js';
export { describeProviderContract, drainChanges } from './providers/contract.js';
export {
	AT,
	driveWorld,
	emptyFeed,
	feedRequests,
	FOLDER,
	MARKER_FILE,
	over,
} from './providers/driveWorld.js';
export { createDropboxStub, type DropboxStub } from './providers/dropboxStub.js';
export {
	createGDriveStub,
	type GDriveStub,
	type GDriveStubOptions,
} from './providers/gdriveStub.js';
export {
	createOneDriveStub,
	type OneDriveStub,
	type OneDriveStubOptions,
} from './providers/onedriveStub.js';
export { mulberry32 } from './support/random.js';
export {
	conflictFilename,
	conflictPath,
	isDocumentName,
	TEST_FORMAT,
} from './support/testFormat.js';
