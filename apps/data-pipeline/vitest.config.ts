import {
  defineWorkersProject,
} from "@cloudflare/vitest-pool-workers/config";
import { defineConfig } from "vitest/config";
import { resolve } from "path";

const aliases = {
  "@travel/proto-ts": resolve(__dirname, "../../packages/proto-ts/src/index.ts"),
  "@travel/pipeline-core": resolve(
    __dirname,
    "../../packages/pipeline-core/src/index.ts",
  ),
};

export default defineConfig({
  test: {
    projects: [
      // Workers project: cloudflare pool-workers tests (excludes analytics-smoke).
      defineWorkersProject({
        resolve: { alias: aliases },
        test: {
          name: "workers",
          include: ["test/**/*.test.ts"],
          exclude: ["test/analytics-smoke.test.ts"],
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
      }),
      // Node project: DuckDB analytics smoke (native module — cannot run in workerd).
      {
        resolve: { alias: aliases },
        test: {
          name: "node-analytics",
          include: ["test/analytics-smoke.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
