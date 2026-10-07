import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Many backend tests spawn real git / node child processes. On Windows, process startup under
    // a parallel run regularly exceeds vitest's 5s default even though nothing is hung.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Keeps every test away from the user's real ~/.agy-studio (see the setup file).
    setupFiles: ['./test/setup-data-dir.ts'],
  },
});
