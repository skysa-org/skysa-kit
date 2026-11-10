import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// After every test, what it rendered is unmounted. Testing Library only cleans
// up by itself where `afterEach` is a global, and here it is imported.
afterEach(() => {
	cleanup();
});

// How long `waitFor` and `findBy…` wait for what they are told will happen.
// Testing Library's second is the time a test takes on an idle machine, and a
// loaded one (CI, or the whole suite at once) can take longer. Longer costs
// nothing where the thing happens, only a slower failure where it does not.
// Inside the five seconds vitest gives a test, so a test still fails as itself.
configure({ asyncUtilTimeout: 4_000 });
