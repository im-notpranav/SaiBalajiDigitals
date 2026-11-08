import { defineConfig } from "vitest/config";
import { testDatabaseUrl } from "./tests/api/test-db";

/**
 * API tests: the real Express app against a throwaway database (`<dev db>_test`), rebuilt
 * from the migrations at the start of every run. Files run one at a time because they
 * share that database.
 */
export default defineConfig({
  test: {
    include: ["tests/api/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/api/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDatabaseUrl(),
      JWT_SECRET: "test-secret-not-for-production",
      WHATSAPP_MODE: "log",
      BREVO_API_KEY: "",
    },
  },
});
