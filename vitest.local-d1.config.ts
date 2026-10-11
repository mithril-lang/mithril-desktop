import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["verification/local-workspace.d1.ts"],
    testTimeout: 90000,
    hookTimeout: 90000,
  },
});
