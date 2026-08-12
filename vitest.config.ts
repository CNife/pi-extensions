import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "personal/*/test/**/*.test.ts"],
    passWithNoTests: true,
  },
});
