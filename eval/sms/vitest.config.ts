import { defineConfig, mergeConfig } from "vitest/config";
import base from "../../vitest.config";

// The evaluation runs on real datasets in plain node and is kept out of `npm test` (whose include is src/**).
// Run: npx vitest run --config eval/sms/vitest.config.ts   (from an uppercase-drive path on Windows)
const merged = mergeConfig(
  base,
  defineConfig({
    test: { environment: "node", testTimeout: 15 * 60_000, hookTimeout: 5 * 60_000 },
  }),
);
// mergeConfig concatenates arrays, so replace these outright: the root setup file needs `window` (jsdom).
merged.test = { ...merged.test, include: ["eval/**/*.eval.ts"], setupFiles: [] };
export default merged;
