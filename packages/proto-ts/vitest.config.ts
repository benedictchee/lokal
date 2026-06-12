import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@travel/proto-ts": resolve(__dirname, "src/index.ts"),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
