import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts", "src/index.ts", "src/graphql/schema.ts", "src/plugins/postgres.ts", "src/services/pathlightSession.ts"],
      thresholds: {
        lines: 55,
        functions: 60,
        branches: 45,
        statements: 53,
      },
    },
    mockReset: true,
    restoreMocks: true,
  },
});
