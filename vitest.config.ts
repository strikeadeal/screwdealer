import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost/" } },
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["shared/**/*.test.ts", "worker/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["worker/**/*.integration.test.ts"],
  },
});
