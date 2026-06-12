import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
import { resolve } from "path";

export default defineWorkersConfig({
  resolve: {
    alias: {
      "@travel/proto-ts": resolve(__dirname, "../../packages/proto-ts/src/index.ts"),
      "@travel/pipeline-core": resolve(__dirname, "../../packages/pipeline-core/src/index.ts"),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    poolOptions: {
      workers: {
        miniflare: {
          d1Databases: ["GROUPS"],
          r2Buckets: ["DATA"],
          compatibilityDate: "2025-05-01",
          compatibilityFlags: ["nodejs_compat"],
        },
      },
    },
  },
});
