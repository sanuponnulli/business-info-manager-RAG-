import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Fake values so env.ts validation passes. Tests mock every external
    // service, so these keys are never sent anywhere.
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      GEMINI_API_KEY: "test-key",
      ADMIN_API_KEY: "test-admin-key-0123456789",
    },
  },
});
