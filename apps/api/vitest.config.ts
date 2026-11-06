import { defineConfig } from "vitest/config";

/** Unit tests: the pure rule modules in src/utils. No database. */
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
