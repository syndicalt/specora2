import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts", "src/index.ts", "src/graphql/schema.ts", "src/plugins/postgres.ts", "src/services/aiRuleGenerator.ts", "src/services/appTools.ts", "src/routes/health.ts", "src/services/healthRules.ts", "src/services/eventBus.ts", "src/services/websocket.ts"],
      thresholds: {
        lines: 65,
        functions: 70,
        branches: 45,
        statements: 63,
      },
    },
    mockReset: true,
    restoreMocks: true,
  },
});
