# Data Pipeline M1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the M1 producer slice of the travel data pipeline — scrape OSM POIs for one region, normalize to canonical Records (H3 + minted group identity), and land them in the R2 NDJSON lake, R2 cold H3-blobs, and the Vectorize semantic index — runnable locally and on Cloudflare.

**Architecture:** A shared pure-TS `@travel/pipeline-core` (fetch/normalize/H3/UUID/grouping/lake/blobs/embed-text) consumed by a Cloudflare Worker app `@travel/data-pipeline` that orchestrates ingestion via a Workflow + Queue, with a CLI for local runs. proto is the schema source-of-truth; a snake_case `TravelRecord` TS view is the in-memory/storage type, bridged to proto. See [the design spec](../specs/2026-06-12-data-pipeline-design.md).

**Tech Stack:** TypeScript (ESM/NodeNext), pnpm workspace, Buf + protobuf-es v2, h3-js v4, uuid (v5/v7), Cloudflare Workers/Workflows/Queues/R2/D1/Vectorize/Workers AI, Vitest + @cloudflare/vitest-pool-workers, DuckDB (@duckdb/node-api) for the analytics smoke.

**Task order:** 0 scaffold → 1 canonical types (TravelRecord + OverpassElement + MatchSignals) → 2 fnv1a+H3 → 3 recordUuid → 4 OSM normalizer → 5 grouping+registry → 6 Overpass fetcher+raw → 7 LakeWriter+blob builder → 8 embed+enrich → 9 Workflow+Worker+CLI+wrangler → 10 DuckDB smoke.

---

## File Structure

```
proto/travel/data/v1/record.proto          # canonical schema (Task 0)
packages/proto-ts/                          # generated protobuf-es (Task 0)
packages/pipeline-core/src/
  record.ts        types.ts                 # TravelRecord + helpers; OverpassElement + MatchSignals (Task 1)
  hash.ts          h3.ts                     # fnv1a; deriveCells (Task 2)
  ids.ts                                     # recordUuid (Task 3)
  normalize/osm.ts                           # osmElementToRecord (Task 4)
  grouping/alias.ts  grouping/registry.ts    # aliasFor; GroupRegistry+InMemory (Task 5)
  fetchers/overpass.ts  lake/raw.ts          # fetchOverpass; putRaw (Task 6)
  lake/lake-writer.ts lake/ndjson-r2.ts      # LakeWriter; NdjsonR2LakeWriter (Task 7)
  serving/blob-builder.ts                    # bucketByR7/buildGroupBlobs (Task 7)
  embed/embed-text.ts                        # composeEmbedText (Task 8)
apps/data-pipeline/
  migrations/0001_groups.sql                 # groups + group_aliases (Task 5)
  src/registry-d1.ts                         # D1GroupRegistry (Task 5)
  src/consumers/enrich.ts                    # enrichBatch (Task 8)
  src/workflows/ingest-region.ts             # IngestRegion (Task 9)
  src/index.ts  src/cli.ts                    # Worker entry; CLI (Task 9)
  wrangler.jsonc                             # bindings (Task 9)
```

---

### Task 0: Scaffold — workspace + proto + tooling

**Files:**
- Create: `.gitignore`
- Create: `pnpm-workspace.yaml`
- Create: `package.json` (root)
- Create: `tsconfig.base.json`
- Create: `buf.yaml`
- Create: `buf.gen.yaml`
- Create: `proto/travel/data/v1/record.proto`
- Create: `packages/proto-ts/package.json`
- Create: `packages/proto-ts/tsconfig.json`
- Create: `packages/proto-ts/src/gen/.gitkeep`
- Generate: `packages/proto-ts/src/gen/travel/data/v1/record_pb.ts` (via `buf generate`)
- Create: `packages/proto-ts/src/index.ts`
- Create: `packages/pipeline-core/package.json`
- Create: `packages/pipeline-core/tsconfig.json`
- Create: `packages/pipeline-core/vitest.config.ts`
- Create: `packages/pipeline-core/src/index.ts`
- Create: `apps/data-pipeline/package.json`
- Create: `apps/data-pipeline/tsconfig.json`
- Create: `apps/data-pipeline/vitest.config.ts`
- Test: `packages/proto-ts/test/record-pb.smoke.test.ts`

> Single-ownership note: this task ALONE creates every `package.json`/`tsconfig.json`/`vitest.config.ts` for `@travel/proto-ts`, `@travel/pipeline-core`, and `@travel/data-pipeline`, plus the proto + Buf config. Later tasks only ADD source/test files. This task does NOT create `packages/pipeline-core/src/record.ts` (Task 1) or `apps/data-pipeline/wrangler.jsonc` (Task 9).

---

- [ ] **Step 1: git init + .gitignore + verify toolchain**

  The repo is not git yet and Node >=22 is required. Initialize git and pin the ignore list, then confirm the toolchain.

  Create `.gitignore`:
  ```gitignore
  node_modules/
  dist/
  .wrangler/
  *.tsbuildinfo
  coverage/
  .DS_Store
  ```

  Run (expected: prints a Node 22.x or newer version, pnpm 9.x or newer, and an empty git repo with no commits):
  ```bash
  cd /Users/benedict/Developer/travel && git init && node --version && pnpm --version
  ```
  Expected: `git init` reports `Initialized empty Git repository`; `node --version` >= `v22`; `pnpm --version` >= `9`.

  Commit:
  ```bash
  cd /Users/benedict/Developer/travel && git add .gitignore && git commit -m "chore: git init + .gitignore

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

- [ ] **Step 2: Write the workspace + root tooling config (no install yet)**

  Establish the pnpm workspace, root scripts, the shared ESM/NodeNext TS base, and the Buf config. No source code yet, so nothing to run except a parse check.

  Create `pnpm-workspace.yaml`:
  ```yaml
  packages:
    - "packages/*"
    - "apps/*"
  ```

  Create `package.json` (root):
  ```json
  {
    "name": "travel",
    "version": "0.0.0",
    "private": true,
    "type": "module",
    "engines": {
      "node": ">=22"
    },
    "packageManager": "pnpm@9.15.0",
    "scripts": {
      "proto:gen": "buf generate",
      "build": "pnpm -r --filter \"./packages/**\" run build",
      "typecheck": "pnpm -r run typecheck",
      "test": "pnpm -r run test"
    },
    "devDependencies": {
      "@bufbuild/buf": "^1.50.0",
      "@bufbuild/protoc-gen-es": "^2.2.3",
      "typescript": "^5.7.3"
    }
  }
  ```

  Create `tsconfig.base.json`:
  ```json
  {
    "$schema": "https://json.schemastore.org/tsconfig",
    "compilerOptions": {
      "target": "ES2022",
      "lib": ["ES2023"],
      "module": "NodeNext",
      "moduleResolution": "NodeNext",
      "declaration": true,
      "declarationMap": true,
      "sourceMap": true,
      "strict": true,
      "noUncheckedIndexedAccess": true,
      "esModuleInterop": true,
      "forceConsistentCasingInFileNames": true,
      "skipLibCheck": true,
      "verbatimModuleSyntax": true,
      "isolatedModules": true
    }
  }
  ```

  Create `buf.yaml`:
  ```yaml
  version: v2
  modules:
    - path: proto
  lint:
    use:
      - STANDARD
  breaking:
    use:
      - FILE
  ```

  Create `buf.gen.yaml`:
  ```yaml
  version: v2
  inputs:
    - directory: proto
  plugins:
    - local: protoc-gen-es
      out: packages/proto-ts/src/gen
      opt:
        - target=ts
        - import_extension=js
  ```

  Run (expected PASS — the YAML/JSON files parse):
  ```bash
  cd /Users/benedict/Developer/travel && node --input-type=module -e "import('node:fs').then(async fs=>{const r=await fs.promises.readFile('package.json','utf8');JSON.parse(r);console.log('root package.json OK');const b=await fs.promises.readFile('tsconfig.base.json','utf8');JSON.parse(b);console.log('tsconfig.base.json OK');})"
  ```
  Expected: `root package.json OK` then `tsconfig.base.json OK`.

  Commit:
  ```bash
  cd /Users/benedict/Developer/travel && git add pnpm-workspace.yaml package.json tsconfig.base.json buf.yaml buf.gen.yaml && git commit -m "chore: pnpm workspace + root tsconfig + buf config

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

- [ ] **Step 3: Author record.proto (SCHEMA source-of-truth, snake_case, int64 data_version)**

  `proto/travel/data/v1/record.proto` is the canonical schema source-of-truth and cross-subsystem wire type. ALL fields are snake_case per §5 of the spec; `data_version` is `int64`. (The pipeline's in-memory working type is a separate plain snake_case TS interface created in Task 1 — NOT this generated class.)

  Create `proto/travel/data/v1/record.proto`:
  ```proto
  syntax = "proto3";

  package travel.data.v1;

  // Canonical travel data record — the SCHEMA source-of-truth and cross-subsystem
  // wire type. Projected to NDJSON (lake), R2 blob payloads, D1 rows, and
  // Vectorize metadata. See docs/superpowers/specs/2026-06-12-data-pipeline-design.md §5.
  // NOTE: pipeline processing uses a plain snake_case TS interface (TravelRecord,
  // Task 1), not the generated camelCase class. This message is the wire/schema
  // contract only.
  message Record {
    // uuidv5("${source}:${source_id}") — stable; re-scrape yields the same id.
    string record_uuid = 1;
    // Program-minted UUIDv7 from the D1 group registry (aliases are signals, not identity).
    string group_uuid = 2;
    // poi | transport | (future)
    string subject = 3;
    // restaurant/hotel/… or train/hsr/mrt/light_rail/bus/cable_car
    string category = 4;
    string name = 5;
    double lat = 6;
    double lng = 7;
    // 15-char lowercase hex H3 cells. r10 = latLngToCell; r7/r5 = cellToParent(r10,…).
    string h3_r5 = 8;
    string h3_r7 = 9;
    string h3_r10 = 10;
    // Subject-specific JSON string — keeps the model extensible without migrations.
    string attributes = 11;
    string source = 12;
    string source_id = 13;
    string source_url = 14;
    string raw_r2_key = 15;
    string lang = 16;
    string content_hash = 17;
    // Monotonic ingest version stamp.
    int64 data_version = 18;
  }
  ```

  Run (expected PASS — proto lints clean; downloads the buf binary on first run):
  ```bash
  cd /Users/benedict/Developer/travel && pnpm dlx @bufbuild/buf@1.50.0 lint
  ```
  Expected: exits 0 with no output (lint passes; field 13 `source_id`, package/file naming all satisfy STANDARD).

  Commit:
  ```bash
  cd /Users/benedict/Developer/travel && git add proto/travel/data/v1/record.proto && git commit -m "feat(proto): travel.data.v1.Record canonical schema

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

- [ ] **Step 4: Create @travel/proto-ts package shell + install deps**

  Create the generated-types package (it owns ONLY the codegen output + a re-export barrel). Install the whole workspace so `buf`/`protoc-gen-es` resolve from root and workspace links are wired.

  Create `packages/proto-ts/package.json`:
  ```json
  {
    "name": "@travel/proto-ts",
    "version": "0.0.0",
    "private": true,
    "type": "module",
    "exports": {
      ".": {
        "types": "./dist/index.d.ts",
        "import": "./dist/index.js"
      }
    },
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "scripts": {
      "build": "tsc -p tsconfig.json",
      "typecheck": "tsc -p tsconfig.json --noEmit",
      "test": "vitest run"
    },
    "dependencies": {
      "@bufbuild/protobuf": "^2.2.3"
    },
    "devDependencies": {
      "typescript": "^5.7.3",
      "vitest": "^3.0.5"
    }
  }
  ```

  Create `packages/proto-ts/tsconfig.json`:
  ```json
  {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
      "rootDir": "src",
      "outDir": "dist",
      "composite": true
    },
    "include": ["src/**/*.ts"]
  }
  ```

  Create `packages/proto-ts/src/gen/.gitkeep` (empty file so the codegen target dir exists before `buf generate`):
  ```text
  ```

  Run (expected PASS — installs all workspace deps; first run resolves the registry):
  ```bash
  cd /Users/benedict/Developer/travel && pnpm install
  ```
  Expected: `pnpm install` completes; reports the workspace packages (`@travel/proto-ts` and later ones added in this task) and writes `pnpm-lock.yaml`.

  Commit:
  ```bash
  cd /Users/benedict/Developer/travel && git add packages/proto-ts/package.json packages/proto-ts/tsconfig.json packages/proto-ts/src/gen/.gitkeep pnpm-lock.yaml && git commit -m "chore(proto-ts): package shell + workspace install

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

- [ ] **Step 5: Generate @travel/proto-ts and add the re-export barrel**

  Run `buf generate` to emit `record_pb.ts` (protobuf-es v2: camelCase accessors, `RecordSchema`, `dataVersion: bigint`), then add the barrel that re-exports the generated module.

  Run (expected PASS — emits the generated file):
  ```bash
  cd /Users/benedict/Developer/travel && pnpm run proto:gen && ls packages/proto-ts/src/gen/travel/data/v1/record_pb.ts
  ```
  Expected: prints `packages/proto-ts/src/gen/travel/data/v1/record_pb.ts`. The file defines `RecordSchema` (a `GenMessage`) and a `Record` message type with camelCase fields (`recordUuid`, `groupUuid`, `h3R5`, `h3R7`, `h3R10`, `sourceId`, `sourceUrl`, `rawR2Key`, `contentHash`, `dataVersion: bigint`).

  Create `packages/proto-ts/src/index.ts`:
  ```ts
  // @travel/proto-ts — generated protobuf-es v2 types (camelCase accessors).
  // The SCHEMA/wire contract. Pipeline processing uses the snake_case TravelRecord
  // interface from @travel/pipeline-core, NOT these generated classes.
  export {
    Record,
    RecordSchema,
  } from "./gen/travel/data/v1/record_pb.js";
  export { file_travel_data_v1_record } from "./gen/travel/data/v1/record_pb.js";
  ```

  > protobuf-es v2 emits `Record`, `RecordSchema`, and `file_travel_data_v1_record` (verified); there is no `RecordJson` export. The smoke test in Step 7 depends only on `Record` and `RecordSchema`.

  Run (expected PASS — barrel + generated code typecheck and build):
  ```bash
  cd /Users/benedict/Developer/travel && pnpm --filter @travel/proto-ts run build
  ```
  Expected: `tsc` exits 0; `packages/proto-ts/dist/index.js` and `dist/gen/travel/data/v1/record_pb.js` exist.

  Commit:
  ```bash
  cd /Users/benedict/Developer/travel && git add packages/proto-ts/src && git commit -m "feat(proto-ts): generate Record types + barrel export

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

- [ ] **Step 6: Create @travel/pipeline-core + @travel/data-pipeline package shells (single-ownership)**

  Create the FULL `package.json`/`tsconfig.json`/`vitest.config.ts` for both remaining packages with ALL their declared deps. `pipeline-core` is pure TS (Vitest). `data-pipeline` touches Worker bindings (Miniflare pool). A placeholder `index.ts` in core keeps the build green; later tasks add `record.ts` and re-export it from here.

  Create `packages/pipeline-core/package.json` (deps per contract: `h3-js@^4.4.0`, `uuid@^11`, `@travel/proto-ts`, `@bufbuild/protobuf`):
  ```json
  {
    "name": "@travel/pipeline-core",
    "version": "0.0.0",
    "private": true,
    "type": "module",
    "exports": {
      ".": {
        "types": "./dist/index.d.ts",
        "import": "./dist/index.js"
      }
    },
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "scripts": {
      "build": "tsc -p tsconfig.json",
      "typecheck": "tsc -p tsconfig.json --noEmit",
      "test": "vitest run"
    },
    "dependencies": {
      "@bufbuild/protobuf": "^2.2.3",
      "@travel/proto-ts": "workspace:*",
      "h3-js": "^4.4.0",
      "uuid": "^11.0.5"
    },
    "devDependencies": {
      "typescript": "^5.7.3",
      "vitest": "^3.0.5"
    }
  }
  ```

  Create `packages/pipeline-core/tsconfig.json`:
  ```json
  {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
      "rootDir": "src",
      "outDir": "dist",
      "composite": true
    },
    "references": [{ "path": "../proto-ts" }],
    "include": ["src/**/*.ts", "test/**/*.ts"]
  }
  ```

  Create `packages/pipeline-core/vitest.config.ts`:
  ```ts
  import { defineConfig } from "vitest/config";

  export default defineConfig({
    test: {
      include: ["test/**/*.test.ts"],
      environment: "node",
    },
  });
  ```

  Create `packages/pipeline-core/src/index.ts` (placeholder barrel; Task 1 adds `export * from "./record.js";` here):
  ```ts
  // @travel/pipeline-core — pure TS pipeline logic (no Worker bindings).
  // Task 1 adds: export * from "./record.js";
  export {};
  ```

  Create `apps/data-pipeline/package.json` (Miniflare test pool + wrangler; NO wrangler.jsonc here — Task 9):
  ```json
  {
    "name": "@travel/data-pipeline",
    "version": "0.0.0",
    "private": true,
    "type": "module",
    "scripts": {
      "typecheck": "tsc -p tsconfig.json --noEmit",
      "test": "vitest run",
      "deploy": "wrangler deploy"
    },
    "dependencies": {
      "@bufbuild/protobuf": "^2.2.3",
      "@travel/pipeline-core": "workspace:*",
      "@travel/proto-ts": "workspace:*",
      "h3-js": "^4.4.0",
      "uuid": "^11.0.5"
    },
    "devDependencies": {
      "@cloudflare/vitest-pool-workers": "^0.5.40",
      "@cloudflare/workers-types": "^4.20250121.0",
      "typescript": "^5.7.3",
      "vitest": "^3.0.5",
      "wrangler": "^3.107.0"
    }
  }
  ```

  Create `apps/data-pipeline/tsconfig.json`:
  ```json
  {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
      "rootDir": ".",
      "noEmit": true,
      "types": ["@cloudflare/workers-types"]
    },
    "references": [
      { "path": "../../packages/pipeline-core" },
      { "path": "../../packages/proto-ts" }
    ],
    "include": ["src/**/*.ts", "test/**/*.ts"]
  }
  ```

  Create `apps/data-pipeline/vitest.config.ts` (Miniflare pool; references the wrangler config Task 9 will create):
  ```ts
  import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

  export default defineWorkersConfig({
    test: {
      include: ["test/**/*.test.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.jsonc" },
        },
      },
    },
  });
  ```

  Run (expected PASS — workspace links resolve the two new packages):
  ```bash
  cd /Users/benedict/Developer/travel && pnpm install
  ```
  Expected: install completes; `node_modules/@travel/pipeline-core` and `node_modules/@travel/data-pipeline` are workspace symlinks; `h3-js`, `uuid`, `@cloudflare/vitest-pool-workers`, `wrangler` resolved.

  Commit:
  ```bash
  cd /Users/benedict/Developer/travel && git add packages/pipeline-core/package.json packages/pipeline-core/tsconfig.json packages/pipeline-core/vitest.config.ts packages/pipeline-core/src/index.ts apps/data-pipeline/package.json apps/data-pipeline/tsconfig.json apps/data-pipeline/vitest.config.ts pnpm-lock.yaml && git commit -m "chore: pipeline-core + data-pipeline package shells

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

- [ ] **Step 7: Failing smoke test — import RecordSchema + create(...) from @travel/proto-ts**

  Write the smoke test asserting the generated schema is importable and `create()` runs with ALL canonical fields (camelCase accessors, `dataVersion: bigint`). Write it BEFORE confirming green so we see it drive the build.

  Create `packages/proto-ts/test/record-pb.smoke.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { create, toBinary, fromBinary } from "@bufbuild/protobuf";
  import { Record, RecordSchema } from "@travel/proto-ts";

  describe("@travel/proto-ts smoke", () => {
    it("creates a Record from RecordSchema with all canonical fields", () => {
      const r = create(RecordSchema, {
        recordUuid: "x",
        groupUuid: "standalone:x",
        subject: "poi",
        category: "restaurant",
        name: "Test Cafe",
        lat: 1.3,
        lng: 103.8,
        h3R5: "85123456fffffff",
        h3R7: "87123456affffff",
        h3R10: "8a123456abcffff",
        attributes: "{}",
        source: "osm",
        sourceId: "node/1",
        sourceUrl: "https://www.openstreetmap.org/node/1",
        rawR2Key: "raw/osm/abc",
        lang: "en",
        contentHash: "deadbeef",
        dataVersion: 1n,
      });

      expect(r.recordUuid).toBe("x");
      expect(r.subject).toBe("poi");
      // protobuf-es v2 maps proto int64 -> bigint
      expect(typeof r.dataVersion).toBe("bigint");
      expect(r.dataVersion).toBe(1n);
    });

    it("round-trips through binary preserving snake_case wire fields", () => {
      const r = create(RecordSchema, {
        recordUuid: "y",
        sourceId: "way/2",
        dataVersion: 42n,
      });
      const bytes = toBinary(RecordSchema, r);
      const back: Record = fromBinary(RecordSchema, bytes);
      expect(back.recordUuid).toBe("y");
      expect(back.sourceId).toBe("way/2");
      expect(back.dataVersion).toBe(42n);
    });
  });
  ```

  Run BEFORE the package is built — expected FAIL (the barrel/generated dist must compile and resolve; if Step 5 dist is stale or the import path is wrong, this errors on import resolution):
  ```bash
  cd /Users/benedict/Developer/travel && pnpm --filter @travel/proto-ts exec vitest run --no-coverage 2>&1 | tail -20
  ```
  Expected at this point: FAIL only if `dist` is missing/stale (e.g. `Cannot find module '@travel/proto-ts'`). If Step 5's build is current it may already pass — either way Step 8 rebuilds and confirms green.

- [ ] **Step 8: Rebuild + run the smoke test — expected PASS, then full workspace verify**

  Rebuild `@travel/proto-ts` so the barrel `dist` is fresh, run the smoke test, then run a workspace-wide typecheck to prove every package shell compiles.

  Run (expected PASS):
  ```bash
  cd /Users/benedict/Developer/travel && pnpm --filter @travel/proto-ts run build && pnpm --filter @travel/proto-ts run test
  ```
  Expected: build exits 0; Vitest reports `2 passed` for `record-pb.smoke.test.ts`.

  Run (expected PASS — every package typechecks under the shared base):
  ```bash
  cd /Users/benedict/Developer/travel && pnpm -r run typecheck
  ```
  Expected: `@travel/proto-ts`, `@travel/pipeline-core`, and `@travel/data-pipeline` each exit 0. (`pipeline-core` typechecks its placeholder `index.ts`; `data-pipeline` has no `src/` yet so `tsc --noEmit` is a no-op success.)

  Commit:
  ```bash
  cd /Users/benedict/Developer/travel && git add packages/proto-ts/test/record-pb.smoke.test.ts && git commit -m "test(proto-ts): RecordSchema create + binary round-trip smoke

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 1: Canonical TravelRecord + helpers (record.ts)

This task creates the SINGLE definition of `TravelRecord` (plain snake_case TS interface) plus its helpers, and the proto bridge to `@travel/proto-ts`. Every other module imports `TravelRecord` from here. No other file ever re-declares it. Task 0 has already created `packages/pipeline-core/{package.json,tsconfig.json,vitest.config.ts}` with deps (`h3-js^4.4.0`, `uuid^11`, `@travel/proto-ts`, `@bufbuild/protobuf`) and the `@travel/proto-ts` package (generated `Record` message + `RecordSchema` from `proto/travel/data/v1/record.proto`). This task only ADDS source/test files and MODIFIES the existing `src/index.ts` barrel — it never recreates a package.json/tsconfig/vitest.config.

**Files:**
- Create: `packages/pipeline-core/src/record.ts`
- Create: `packages/pipeline-core/src/types.ts`
- Create: `packages/pipeline-core/test/record.test.ts`
- Modify: `packages/pipeline-core/src/index.ts`

**Steps:**

- [ ] **Step 1: Failing test — TravelRecord shape + the 4 helpers (round-trip, drift-guard, metadata, ndjson).**
  Create `packages/pipeline-core/test/record.test.ts` with REAL code. The drift-guard imports `RecordSchema` from `@travel/proto-ts` and iterates `RecordSchema.fields`, asserting every `field.name` (snake_case proto field name) is a key of a sample `TravelRecord`. The round-trip asserts `recordFromProto(recordToProto(r))` deep-equals `r`. `recordMetadata` returns exactly the 6 snake_case keys. `toNdjsonLine` produces snake_case JSON parseable back to the record.

  ```ts
  import { describe, it, expect } from 'vitest';
  import { RecordSchema } from '@travel/proto-ts';
  import {
    type TravelRecord,
    recordMetadata,
    toNdjsonLine,
    recordToProto,
    recordFromProto,
  } from '../src/record.js';

  // A fully-populated sample TravelRecord (all snake_case fields present).
  const sample: TravelRecord = {
    record_uuid: '6f9619ff-8b86-d011-b42d-00cf4fc964ff',
    group_uuid: '018f2c1a-0000-7000-8000-000000000000',
    subject: 'poi',
    category: 'restaurant',
    name: 'Toh Yuen',
    lat: 5.4141,
    lng: 100.3288,
    h3_r5: '85650d33fffffff',
    h3_r7: '87650d33effffff',
    h3_r10: '8a650d33e74ffff',
    attributes: JSON.stringify({
      address: { housenumber: '1', street: 'Jalan Magazine', city: 'George Town', postcode: '10300', country: 'MY' },
      cuisine: 'chinese',
      opening_hours: 'Mo-Su 11:00-22:00',
    }),
    source: 'osm',
    source_id: 'node/123456789',
    source_url: 'https://www.openstreetmap.org/node/123456789',
    raw_r2_key: 'raw/osm/0a1b2c3d',
    lang: 'en',
    content_hash: '1a2b3c4d',
    data_version: 7,
  };

  describe('TravelRecord drift-guard', () => {
    it('every proto field.name (snake_case) is a key of TravelRecord', () => {
      const keys = new Set(Object.keys(sample));
      for (const field of RecordSchema.fields) {
        expect(keys.has(field.name)).toBe(true);
      }
    });

    it('every TravelRecord key is a proto field.name (no orphan TS fields)', () => {
      const protoNames = new Set(RecordSchema.fields.map((f) => f.name));
      for (const key of Object.keys(sample)) {
        expect(protoNames.has(key)).toBe(true);
      }
    });
  });

  describe('recordToProto / recordFromProto bridge', () => {
    it('round-trips deep-equal', () => {
      const proto = recordToProto(sample);
      const back = recordFromProto(proto);
      expect(back).toEqual(sample);
    });

    it('maps data_version (number) to proto dataVersion (bigint)', () => {
      const proto = recordToProto(sample);
      expect(proto.dataVersion).toBe(7n);
      expect(recordFromProto(proto).data_version).toBe(7);
    });

    it('camelCase proto accessors carry the snake_case values', () => {
      const proto = recordToProto(sample);
      expect(proto.recordUuid).toBe(sample.record_uuid);
      expect(proto.h3R7).toBe(sample.h3_r7);
      expect(proto.rawR2Key).toBe(sample.raw_r2_key);
    });
  });

  describe('recordMetadata', () => {
    it('returns exactly the 6 snake_case pointer keys', () => {
      const meta = recordMetadata(sample);
      expect(Object.keys(meta).sort()).toEqual(
        ['category', 'group_uuid', 'h3_r10', 'h3_r5', 'h3_r7', 'subject'].sort(),
      );
      expect(meta).toEqual({
        subject: 'poi',
        category: 'restaurant',
        group_uuid: '018f2c1a-0000-7000-8000-000000000000',
        h3_r5: '85650d33fffffff',
        h3_r7: '87650d33effffff',
        h3_r10: '8a650d33e74ffff',
      });
    });
  });

  describe('toNdjsonLine', () => {
    it('emits a single-line snake_case JSON string round-tripping the record', () => {
      const line = toNdjsonLine(sample);
      expect(line).not.toContain('\n');
      expect(line).toContain('"record_uuid"');
      expect(line).toContain('"h3_r7"');
      expect(line).toContain('"data_version":7');
      expect(JSON.parse(line)).toEqual(sample);
    });
  });
  ```

- [ ] **Step 2: Run the test — expect FAIL (module not found).**
  ```bash
  pnpm --filter @travel/pipeline-core exec vitest run test/record.test.ts
  ```
  Expected: FAIL — `Cannot find module '../src/record.js'` (record.ts does not exist yet).

- [ ] **Step 3: Implement `src/record.ts` — the SINGLE TravelRecord + 4 helpers + proto bridge.**
  Create `packages/pipeline-core/src/record.ts` with COMPLETE real code. `recordToProto` uses `create(RecordSchema, {...})` from `@bufbuild/protobuf` with camelCase proto field accessors and `dataVersion: BigInt(r.data_version)`. `recordFromProto` reverses it with `Number(m.dataVersion)`.

  ```ts
  import { create } from '@bufbuild/protobuf';
  import { type Record, RecordSchema } from '@travel/proto-ts';

  /**
   * The canonical pipeline working type. Plain snake_case TS interface — this is
   * the SINGLE definition of a travel record used by all in-memory/storage
   * processing. It deliberately does NOT use the protobuf-es generated class
   * (which exposes camelCase accessors and `dataVersion: bigint`). The proto
   * `Record` message is the wire/schema source-of-truth; this interface is the
   * pipeline's view of it, bridged via recordToProto/recordFromProto.
   */
  export interface TravelRecord {
    record_uuid: string;
    group_uuid: string;
    subject: string;
    category: string;
    name: string;
    lat: number;
    lng: number;
    h3_r5: string;
    h3_r7: string;
    h3_r10: string;
    attributes: string; // JSON string
    source: string;
    source_id: string;
    source_url: string;
    raw_r2_key: string;
    lang: string;
    content_hash: string;
    data_version: number;
  }

  /**
   * Vectorize metadata: fetch pointers only, never payload. The 6 string fields
   * indexed before any upsert (subject, category, group_uuid, h3_r5, h3_r7,
   * h3_r10). All snake_case to match the Vectorize index names.
   */
  export function recordMetadata(r: TravelRecord): {
    subject: string;
    category: string;
    group_uuid: string;
    h3_r5: string;
    h3_r7: string;
    h3_r10: string;
  } {
    return {
      subject: r.subject,
      category: r.category,
      group_uuid: r.group_uuid,
      h3_r5: r.h3_r5,
      h3_r7: r.h3_r7,
      h3_r10: r.h3_r10,
    };
  }

  /** One NDJSON line for the R2 lake tier. Already snake_case — just stringify. */
  export function toNdjsonLine(r: TravelRecord): string {
    return JSON.stringify(r);
  }

  /**
   * Bridge to the proto wire type. Maps snake_case TS fields onto the
   * protobuf-es camelCase accessors; data_version (number) -> dataVersion (bigint).
   */
  export function recordToProto(r: TravelRecord): Record {
    return create(RecordSchema, {
      recordUuid: r.record_uuid,
      groupUuid: r.group_uuid,
      subject: r.subject,
      category: r.category,
      name: r.name,
      lat: r.lat,
      lng: r.lng,
      h3R5: r.h3_r5,
      h3R7: r.h3_r7,
      h3R10: r.h3_r10,
      attributes: r.attributes,
      source: r.source,
      sourceId: r.source_id,
      sourceUrl: r.source_url,
      rawR2Key: r.raw_r2_key,
      lang: r.lang,
      contentHash: r.content_hash,
      dataVersion: BigInt(r.data_version),
    });
  }

  /** Reverse bridge: proto wire type -> snake_case TravelRecord. */
  export function recordFromProto(m: Record): TravelRecord {
    return {
      record_uuid: m.recordUuid,
      group_uuid: m.groupUuid,
      subject: m.subject,
      category: m.category,
      name: m.name,
      lat: m.lat,
      lng: m.lng,
      h3_r5: m.h3R5,
      h3_r7: m.h3R7,
      h3_r10: m.h3R10,
      attributes: m.attributes,
      source: m.source,
      source_id: m.sourceId,
      source_url: m.sourceUrl,
      raw_r2_key: m.rawR2Key,
      lang: m.lang,
      content_hash: m.contentHash,
      data_version: Number(m.dataVersion),
    };
  }
  ```

- [ ] **Step 4: Run the test — expect PASS.**
  ```bash
  pnpm --filter @travel/pipeline-core exec vitest run test/record.test.ts
  ```
  Expected: PASS — all drift-guard, round-trip, metadata, and ndjson assertions green.

- [ ] **Step 5: Create shared input types (`src/types.ts`) + re-export the barrel.**
  Create `packages/pipeline-core/src/types.ts` — the single home for cross-cutting input types used by the fetcher, normalizer, and grouping modules. Declaring them here (Task 1) means no later module forward-depends on a type defined in a later task:

  ```ts
  /**
   * A single OSM element as returned by the Overpass API `out center` form.
   * SINGLE definition across the monorepo — fetcher + normalizer import it from here.
   */
  export interface OverpassElement {
    type: 'node' | 'way' | 'relation';
    id: number;
    lat?: number; // present on nodes
    lon?: number; // present on nodes
    center?: { lat: number; lon: number }; // present on ways/relations via `out center`
    tags: Record<string, string>;
  }

  /** Entity-resolution match signals extracted by the normalizer, consumed by aliasFor. */
  export interface MatchSignals {
    brand?: string;
    brandWikidata?: string;
  }
  ```

  Then modify `packages/pipeline-core/src/index.ts` (created empty/minimal by Task 0) to re-export the canonical modules, so consumers can `import { TravelRecord, OverpassElement, MatchSignals } from '@travel/pipeline-core'`:

  ```ts
  export * from './record.js';
  export * from './types.js';
  ```

- [ ] **Step 6: Typecheck the package — expect PASS.**
  ```bash
  pnpm --filter @travel/pipeline-core exec tsc --noEmit
  ```
  Expected: PASS — no type errors; the barrel and record.ts compile under NodeNext ESM.

- [ ] **Step 7: Commit.**
  ```bash
  git add packages/pipeline-core/src/record.ts packages/pipeline-core/src/types.ts packages/pipeline-core/test/record.test.ts packages/pipeline-core/src/index.ts
  git commit -m "feat(pipeline-core): canonical snake_case TravelRecord + proto bridge

Single source of TravelRecord (record.ts): snake_case interface,
recordMetadata, toNdjsonLine, recordToProto/recordFromProto
(data_version<->bigint). Drift-guard test iterates RecordSchema.fields
so proto and the TS view can never silently diverge.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 2: pipeline-core: fnv1a + H3 deriveCells

**Files:**
- Create: `packages/pipeline-core/src/hash.ts`
- Create: `packages/pipeline-core/src/h3.ts`
- Modify: `packages/pipeline-core/src/index.ts` (add two re-export lines only — file already exists from Task 1; do NOT touch `package.json`/`tsconfig.json`/`vitest.config.ts`)
- Test: `packages/pipeline-core/test/hash.test.ts`
- Test: `packages/pipeline-core/test/h3.test.ts`

> Pins honored: this task only ADDS source/test files and appends to the existing `index.ts` (single-ownership — Task 0 owns `package.json`/`tsconfig`/`vitest.config`, `h3-js@^4.4.0` already a dep). Signatures verbatim from contract: `fnv1a(s:string): string` (sync, deterministic 32-bit hex) and `deriveCells(lat:number,lng:number): {h3_r5:string;h3_r7:string;h3_r10:string}` with `r10=latLngToCell(lat,lng,10); r7=cellToParent(r10,7); r5=cellToParent(r10,5)`. Snake_case keys on the returned cells object match `TravelRecord` (`h3_r5`/`h3_r7`/`h3_r10`). All commands run from repo root. Expected values below were empirically verified against `h3-js@4.4.0` and canonical FNV-1a 32-bit vectors.

- [ ] **Step 1: Write failing test for `fnv1a` (known vectors + determinism).**
  Create `packages/pipeline-core/test/hash.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { fnv1a } from '../src/hash.js';

  describe('fnv1a (32-bit FNV-1a, lowercase hex)', () => {
    it('matches canonical 32-bit FNV-1a vectors', () => {
      // Canonical FNV-1a 32-bit hashes, rendered as 8-char zero-padded hex.
      expect(fnv1a('')).toBe('811c9dc5');
      expect(fnv1a('a')).toBe('e40c292c');
      expect(fnv1a('foobar')).toBe('bf9cf968');
      expect(fnv1a('hello')).toBe('4f9f2cab');
    });

    it('always returns 8 lowercase hex chars (zero-padded)', () => {
      for (const s of ['', 'a', 'foobar', 'hello', 'Gurney Drive', 'x'.repeat(1000)]) {
        const h = fnv1a(s);
        expect(h).toMatch(/^[0-9a-f]{8}$/);
      }
    });

    it('is deterministic across repeated calls', () => {
      const sample = 'Gurney Drive Hawker5.4157621100.3318078osmnode/123';
      expect(fnv1a(sample)).toBe(fnv1a(sample));
      expect(fnv1a(sample)).toBe('3d01d515');
    });

    it('is sensitive to input (no trivial collisions on close strings)', () => {
      expect(fnv1a('abc')).not.toBe(fnv1a('abd'));
      expect(fnv1a('ab')).not.toBe(fnv1a('ba'));
    });
  });
  ```

- [ ] **Step 2: Run the hash test — expect FAIL (module not found).**
  `pnpm --filter @travel/pipeline-core test -- --run hash`
  Expected: FAIL — Vitest cannot resolve `../src/hash.js` (`Failed to resolve import "../src/hash.js"` / "Cannot find module"). No `hash.ts` exists yet.

- [ ] **Step 3: Implement `fnv1a` (minimal, sync, deterministic 32-bit hex).**
  Create `packages/pipeline-core/src/hash.ts`:
  ```ts
  /**
   * FNV-1a 32-bit hash, rendered as a lowercase, zero-padded 8-char hex string.
   * Synchronous and deterministic — no async crypto. Used for `content_hash`
   * (change detection) and raw-blob keying. Stable across Node and workerd.
   */
  export function fnv1a(s: string): string {
    let h = 0x811c9dc5; // FNV offset basis (2166136261)
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      // FNV prime 0x01000193; Math.imul keeps the 32-bit multiply exact.
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
  ```

- [ ] **Step 4: Run the hash test — expect PASS.**
  `pnpm --filter @travel/pipeline-core test -- --run hash`
  Expected: PASS — all 4 `fnv1a` tests green.

- [ ] **Step 5: Re-export `fnv1a` from the package barrel.**
  Modify `packages/pipeline-core/src/index.ts` — append:
  ```ts
  export * from './hash.js';
  ```

- [ ] **Step 6: Commit hash module.**
  ```sh
  git add packages/pipeline-core/src/hash.ts packages/pipeline-core/src/index.ts packages/pipeline-core/test/hash.test.ts
  git commit -m "$(cat <<'EOF'
  feat(pipeline-core): add sync fnv1a 32-bit hex hash

  Deterministic, no-async-crypto content hash for content_hash + raw keying.
  Verified against canonical FNV-1a 32-bit vectors.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

- [ ] **Step 7: Write failing test for `deriveCells` (parent-derivation rule + 15-char hex).**
  Create `packages/pipeline-core/test/h3.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { latLngToCell, cellToParent } from 'h3-js';
  import { deriveCells } from '../src/h3.js';

  // Penang reference coordinate (Gurney Drive area).
  const LAT = 5.4157621;
  const LNG = 100.3318078;

  describe('deriveCells', () => {
    it('returns the known r10/r7/r5 cells for the reference coord', () => {
      const cells = deriveCells(LAT, LNG);
      expect(cells.h3_r10).toBe('8a651d8c8987fff');
      expect(cells.h3_r7).toBe('87651d8c8ffffff');
      expect(cells.h3_r5).toBe('85651d8ffffffff');
    });

    it('emits exactly the three snake_case keys matching TravelRecord', () => {
      const cells = deriveCells(LAT, LNG);
      expect(Object.keys(cells).sort()).toEqual(['h3_r10', 'h3_r5', 'h3_r7']);
    });

    it('every cell is a 15-char lowercase hex string', () => {
      const cells = deriveCells(LAT, LNG);
      for (const c of [cells.h3_r5, cells.h3_r7, cells.h3_r10]) {
        expect(c).toMatch(/^[0-9a-f]{15}$/);
      }
    });

    it('derives r7 and r5 as PARENTS of r10 (not independent latLngToCell calls)', () => {
      const cells = deriveCells(LAT, LNG);
      // Contract D8/§7: c10 = latLngToCell; r7 = cellToParent(c10,7); r5 = cellToParent(c10,5).
      expect(cells.h3_r7).toBe(cellToParent(cells.h3_r10, 7));
      expect(cells.h3_r5).toBe(cellToParent(cells.h3_r10, 5));
      // And r10 itself is the resolution-10 cell for the coord.
      expect(cells.h3_r10).toBe(latLngToCell(LAT, LNG, 10));
    });

    it('is deterministic for the same coordinate', () => {
      expect(deriveCells(LAT, LNG)).toEqual(deriveCells(LAT, LNG));
    });
  });
  ```

- [ ] **Step 8: Run the h3 test — expect FAIL (module not found).**
  `pnpm --filter @travel/pipeline-core test -- --run h3`
  Expected: FAIL — Vitest cannot resolve `../src/h3.js` (`Failed to resolve import "../src/h3.js"`). No `h3.ts` exists yet. (`h3-js` itself resolves — it is a Task 0 dep.)

- [ ] **Step 9: Implement `deriveCells` (r7/r5 from r10 via `cellToParent`).**
  Create `packages/pipeline-core/src/h3.ts`:
  ```ts
  import { latLngToCell, cellToParent } from 'h3-js';

  /**
   * Derive the three H3 cells used across the pipeline (resolutions 10/7/5)
   * from a lat/lng. r10 is the base cell; r7 (blob/zone) and r5 (metro rollup)
   * are computed as PARENTS of r10 — never independent latLngToCell calls —
   * so the cells nest cleanly (contract D8 / spec §7). Keys are snake_case to
   * match the TravelRecord fields h3_r5 / h3_r7 / h3_r10 (15-char hex strings).
   */
  export function deriveCells(
    lat: number,
    lng: number,
  ): { h3_r5: string; h3_r7: string; h3_r10: string } {
    const h3_r10 = latLngToCell(lat, lng, 10);
    const h3_r7 = cellToParent(h3_r10, 7);
    const h3_r5 = cellToParent(h3_r10, 5);
    return { h3_r5, h3_r7, h3_r10 };
  }
  ```

- [ ] **Step 10: Run the h3 test — expect PASS.**
  `pnpm --filter @travel/pipeline-core test -- --run h3`
  Expected: PASS — all 5 `deriveCells` tests green (r10=`8a651d8c8987fff`, r7=`87651d8c8ffffff`, r5=`85651d8ffffffff`; parent-derivation assertion confirms r7/r5 = `cellToParent(r10, …)`).

- [ ] **Step 11: Re-export `deriveCells` from the package barrel and run the full suite.**
  Modify `packages/pipeline-core/src/index.ts` — append:
  ```ts
  export * from './h3.js';
  ```
  Then run the whole package suite to confirm nothing regressed:
  `pnpm --filter @travel/pipeline-core test -- --run`
  Expected: PASS — `hash.test.ts` and `h3.test.ts` both green (plus any prior Task 1 tests).

- [ ] **Step 12: Commit h3 module.**
  ```sh
  git add packages/pipeline-core/src/h3.ts packages/pipeline-core/src/index.ts packages/pipeline-core/test/h3.test.ts
  git commit -m "$(cat <<'EOF'
  feat(pipeline-core): add H3 deriveCells (r10 base, r7/r5 via cellToParent)

  r10 = latLngToCell(lat,lng,10); r7/r5 = cellToParent(r10,...) so cells nest
  (contract D8 / spec §7). Snake_case keys match TravelRecord h3_* fields.
  Verified r10=8a651d8c8987fff for 5.4157621,100.3318078.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 3: pipeline-core — recordUuid (src/ids.ts)

Deterministic, idempotent record identity. `recordUuid(source, sourceId)` = `uuidv5("${source}:${sourceId}", NS_RECORD)` so a re-scrape of the same source object always yields the same `record_uuid` (spec §7). This task ONLY ADDS `src/ids.ts` + its test and appends one re-export line to the existing `src/index.ts` (created by Task 1). It does NOT touch `package.json`, `tsconfig.json`, or `vitest.config.ts` — those are owned by Task 0 (which already added the `uuid` `^11` dep) and Task 1.

**Files:**
- Create: `packages/pipeline-core/src/ids.ts`
- Create: `packages/pipeline-core/src/ids.test.ts`
- Modify: `packages/pipeline-core/src/index.ts` (append re-export of `./ids.js`)

- [ ] **Step 1: Write failing test for determinism, distinctness, and UUIDv5 format.**
  Create `packages/pipeline-core/src/ids.test.ts` with complete real code:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { validate as uuidValidate, version as uuidVersion, v5 as uuidv5 } from 'uuid';
  import { recordUuid, NS_RECORD } from './ids.js';

  describe('recordUuid', () => {
    it('exports NS_RECORD as the pinned namespace UUID', () => {
      expect(NS_RECORD).toBe('1b671a64-40d5-491e-99b0-da01ff1f3341');
      expect(uuidValidate(NS_RECORD)).toBe(true);
    });

    it('is deterministic: same (source, sourceId) -> same uuid', () => {
      const a = recordUuid('osm', 'node/123');
      const b = recordUuid('osm', 'node/123');
      expect(a).toBe(b);
    });

    it('produces a valid UUIDv5', () => {
      const id = recordUuid('osm', 'way/456');
      expect(uuidValidate(id)).toBe(true);
      expect(uuidVersion(id)).toBe(5);
    });

    it('is distinct across different source / sourceId', () => {
      const osmNode = recordUuid('osm', 'node/123');
      const osmWay = recordUuid('osm', 'way/123');
      const gtfsNode = recordUuid('gtfs', 'node/123');
      const set = new Set([osmNode, osmWay, gtfsNode]);
      expect(set.size).toBe(3);
    });

    it('joins source and sourceId with a single colon (matches uuidv5 over "source:sourceId")', () => {
      expect(recordUuid('osm', 'node/123')).toBe(uuidv5('osm:node/123', NS_RECORD));
    });

    it('does not collapse a moved colon: ("a:b","c") !== ("a","b:c")', () => {
      expect(recordUuid('a:b', 'c')).not.toBe(recordUuid('a', 'b:c'));
    });
  });
  ```

- [ ] **Step 2: Run the test — expect FAIL.**
  Command: `pnpm --filter @travel/pipeline-core test run src/ids.test.ts`
  Expected: FAIL — Vitest cannot resolve the import `./ids.js` because `src/ids.ts` does not exist yet (error like `Failed to resolve import "./ids.js"` / `Cannot find module`).

- [ ] **Step 3: Implement `src/ids.ts` (minimal real code).**
  Create `packages/pipeline-core/src/ids.ts`:
  ```ts
  import { v5 as uuidv5 } from 'uuid';

  /**
   * Pinned namespace UUID for travel `record_uuid` minting. NEVER change this —
   * altering it would re-key every record. record_uuid = uuidv5(`${source}:${source_id}`, NS_RECORD).
   */
  export const NS_RECORD = '1b671a64-40d5-491e-99b0-da01ff1f3341';

  /**
   * Stable, idempotent record identity (spec §7). A re-scrape of the same source
   * object yields the same id, so Workflow steps keyed by record_uuid overwrite
   * rather than duplicate.
   */
  export function recordUuid(source: string, sourceId: string): string {
    return uuidv5(`${source}:${sourceId}`, NS_RECORD);
  }
  ```

- [ ] **Step 4: Append the re-export to `src/index.ts`.**
  Add this line to the existing `packages/pipeline-core/src/index.ts` (created by Task 1; it already re-exports `./record.js`). Do NOT recreate the file — only append:
  ```ts
  export * from './ids.js';
  ```

- [ ] **Step 5: Run the test — expect PASS.**
  Command: `pnpm --filter @travel/pipeline-core test run src/ids.test.ts`
  Expected: PASS — all 6 assertions green (`Test Files 1 passed`, `Tests 6 passed`).

- [ ] **Step 6: Typecheck the package — expect PASS.**
  Command: `pnpm --filter @travel/pipeline-core exec tsc --noEmit`
  Expected: PASS — no type errors (confirms ESM NodeNext `./ids.js` specifier and the `uuid` types resolve).

- [ ] **Step 7: Commit.**
  Command:
  ```sh
  git add packages/pipeline-core/src/ids.ts packages/pipeline-core/src/ids.test.ts packages/pipeline-core/src/index.ts
  git commit -m "$(cat <<'EOF'
  feat(pipeline-core): add recordUuid (UUIDv5 over source:source_id)

  Deterministic, idempotent record_uuid minting per spec §7 with pinned
  NS_RECORD namespace. Re-export from package index.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 4: pipeline-core — OSM normalizer

Turns one Overpass element into the snake_case working type minus the fields that only the Workflow knows (`group_uuid`, `data_version`, `raw_r2_key`), plus the entity-resolution `signals`. Returns `null` when the element has no usable coords or no name. Reuses `fnv1a` (hash.ts), `deriveCells` (h3.ts), `recordUuid` (ids.ts), `OverpassElement` and `MatchSignals` (types.ts), and `TravelRecord` (record.ts) — defines no new shared types. Only ADDS `src/normalize/osm.ts` + its test fixture/spec; touches no package.json/tsconfig/vitest.config (owned by Task 0).

**Files:**
- Create: `packages/pipeline-core/src/normalize/osm.ts`
- Create: `packages/pipeline-core/test/fixtures/overpass-sample.ts`
- Test: `packages/pipeline-core/test/normalize/osm.test.ts`

- [ ] **Step 1: Failing test — golden fixture + the three core cases (brand'd node, way-with-center, missing-name → null).** Write the fixture, then the spec. The fixture is real `OverpassElement` data (imported type from `../../src/fetchers/overpass.js`).

  Create `packages/pipeline-core/test/fixtures/overpass-sample.ts`:
  ```ts
  import type { OverpassElement } from '../../src/types.js';

  // A non-branded standalone restaurant node (lat/lon directly on the element).
  export const standaloneRestaurant: OverpassElement = {
    type: 'node',
    id: 11111,
    lat: 5.41535,
    lon: 100.33205,
    tags: {
      amenity: 'restaurant',
      name: 'Tek Sen Restaurant',
      cuisine: 'chinese',
      opening_hours: 'Th-Tu 11:30-14:30,17:30-20:30',
      'addr:housenumber': '18',
      'addr:street': 'Lebuh Carnarvon',
      'addr:city': 'George Town',
      'addr:postcode': '10100',
      'addr:country': 'MY',
    },
  };

  // A branded chain outlet (carries brand + brand:wikidata → chain signals).
  export const brandedCafe: OverpassElement = {
    type: 'node',
    id: 22222,
    lat: 5.42101,
    lon: 100.33890,
    tags: {
      amenity: 'cafe',
      name: 'Starbucks Gurney',
      brand: 'Starbucks',
      'brand:wikidata': 'Q37158',
      'addr:street': 'Persiaran Gurney',
      'addr:city': 'George Town',
    },
  };

  // A 'way' POI: no lat/lon on the element, coords come from `center` (Overpass `out center`).
  export const wayWithCenter: OverpassElement = {
    type: 'way',
    id: 33333,
    center: { lat: 5.41999, lon: 100.34010 },
    tags: {
      tourism: 'hotel',
      name: 'Eastern & Oriental Hotel',
      'addr:street': 'Lebuh Farquhar',
      'addr:city': 'George Town',
    },
  };

  // A shop POI — category must fall through amenity(none) → shop.
  export const shopElement: OverpassElement = {
    type: 'node',
    id: 44444,
    lat: 5.41600,
    lon: 100.33300,
    tags: {
      shop: 'bakery',
      name: 'Sunshine Bakery',
    },
  };

  // No usable name → normalizer returns null.
  export const namelessElement: OverpassElement = {
    type: 'node',
    id: 55555,
    lat: 5.41700,
    lon: 100.33400,
    tags: {
      amenity: 'bench',
    },
  };

  // No usable coords (way without center, no lat/lon) → normalizer returns null.
  export const noCoordsElement: OverpassElement = {
    type: 'way',
    id: 66666,
    tags: {
      amenity: 'restaurant',
      name: 'Ghost Kitchen',
    },
  };
  ```

  Create `packages/pipeline-core/test/normalize/osm.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { osmElementToRecord } from '../../src/normalize/osm.js';
  import { deriveCells } from '../../src/h3.js';
  import { recordUuid } from '../../src/ids.js';
  import { fnv1a } from '../../src/hash.js';
  import {
    standaloneRestaurant,
    brandedCafe,
    wayWithCenter,
    shopElement,
    namelessElement,
    noCoordsElement,
  } from '../fixtures/overpass-sample.js';

  describe('osmElementToRecord', () => {
    it('normalizes a standalone restaurant node into a snake_case TravelRecord (minus group/version/raw key)', () => {
      const out = osmElementToRecord(standaloneRestaurant);
      expect(out).not.toBeNull();
      const { record, signals } = out!;

      const cells = deriveCells(5.41535, 100.33205);
      expect(record.record_uuid).toBe(recordUuid('osm', 'node/11111'));
      expect(record.subject).toBe('poi');
      expect(record.category).toBe('restaurant');
      expect(record.name).toBe('Tek Sen Restaurant');
      expect(record.lat).toBe(5.41535);
      expect(record.lng).toBe(100.33205);
      expect(record.h3_r5).toBe(cells.h3_r5);
      expect(record.h3_r7).toBe(cells.h3_r7);
      expect(record.h3_r10).toBe(cells.h3_r10);
      expect(record.source).toBe('osm');
      expect(record.source_id).toBe('node/11111');
      expect(record.source_url).toBe('https://www.openstreetmap.org/node/11111');
      expect(record.lang).toBe('en');
      expect(record.content_hash).toBe(
        fnv1a('Tek Sen Restaurant' + 5.41535 + 100.33205 + 'osm' + 'node/11111'),
      );

      // attributes is a JSON STRING; address is an OBJECT inside it.
      const attrs = JSON.parse(record.attributes);
      expect(attrs.address).toEqual({
        housenumber: '18',
        street: 'Lebuh Carnarvon',
        city: 'George Town',
        postcode: '10100',
        country: 'MY',
      });
      expect(attrs.cuisine).toBe('chinese');
      expect(attrs.opening_hours).toBe('Th-Tu 11:30-14:30,17:30-20:30');

      // standalone → no chain signals
      expect(signals).toEqual({});

      // the three excluded fields are NOT present on record.
      expect('group_uuid' in record).toBe(false);
      expect('data_version' in record).toBe(false);
      expect('raw_r2_key' in record).toBe(false);
    });

    it('extracts brand + brand:wikidata signals for a chain outlet', () => {
      const out = osmElementToRecord(brandedCafe);
      expect(out).not.toBeNull();
      const { record, signals } = out!;
      expect(record.category).toBe('cafe');
      expect(signals).toEqual({ brand: 'Starbucks', brandWikidata: 'Q37158' });
      const attrs = JSON.parse(record.attributes);
      expect(attrs.address).toEqual({ street: 'Persiaran Gurney', city: 'George Town' });
    });

    it('reads coords from center for a way and category from tourism', () => {
      const out = osmElementToRecord(wayWithCenter);
      expect(out).not.toBeNull();
      const { record } = out!;
      expect(record.category).toBe('hotel');
      expect(record.lat).toBe(5.41999);
      expect(record.lng).toBe(100.34010);
      expect(record.source_id).toBe('way/33333');
      expect(record.source_url).toBe('https://www.openstreetmap.org/way/33333');
      const cells = deriveCells(5.41999, 100.34010);
      expect(record.h3_r7).toBe(cells.h3_r7);
    });

    it('derives category from shop when amenity and tourism are absent', () => {
      const out = osmElementToRecord(shopElement);
      expect(out).not.toBeNull();
      expect(out!.record.category).toBe('bakery');
      // empty address object when no addr:* tags
      expect(JSON.parse(out!.record.attributes).address).toEqual({});
    });

    it('returns null when the element has no usable name', () => {
      expect(osmElementToRecord(namelessElement)).toBeNull();
    });

    it('returns null when the element has no usable coords', () => {
      expect(osmElementToRecord(noCoordsElement)).toBeNull();
    });
  });
  ```

- [ ] **Step 2: Run the test — expect FAIL (module not found).**
  ```
  pnpm --filter @travel/pipeline-core test -- run normalize/osm
  ```
  Expected: FAIL — `Cannot find module '../../src/normalize/osm.js'` (osm.ts does not exist yet).

- [ ] **Step 3: Minimal impl — `src/normalize/osm.ts`.** Complete real code, snake_case fields, address as an OBJECT, content_hash via `fnv1a`, category `amenity || shop || tourism`, coords from node or `center`, signals from `brand` / `brand:wikidata`.

  Create `packages/pipeline-core/src/normalize/osm.ts`:
  ```ts
  import type { TravelRecord } from '../record.js';
  import type { OverpassElement, MatchSignals } from '../types.js';
  import { deriveCells } from '../h3.js';
  import { recordUuid } from '../ids.js';
  import { fnv1a } from '../hash.js';

  /** The fields a normalizer can know up front — the Workflow adds group_uuid, data_version, raw_r2_key. */
  type NormalizedRecord = Omit<TravelRecord, 'group_uuid' | 'data_version' | 'raw_r2_key'>;

  function pickCoords(el: OverpassElement): { lat: number; lng: number } | null {
    if (typeof el.lat === 'number' && typeof el.lon === 'number') {
      return { lat: el.lat, lng: el.lon };
    }
    if (el.center && typeof el.center.lat === 'number' && typeof el.center.lon === 'number') {
      return { lat: el.center.lat, lng: el.center.lon };
    }
    return null;
  }

  /** Build the address OBJECT from addr:* tags (only present keys, snake_case-free OSM names mapped). */
  function buildAddress(tags: Record<string, string>): Record<string, string> {
    const address: Record<string, string> = {};
    if (tags['addr:housenumber']) address.housenumber = tags['addr:housenumber'];
    if (tags['addr:street']) address.street = tags['addr:street'];
    if (tags['addr:city']) address.city = tags['addr:city'];
    if (tags['addr:postcode']) address.postcode = tags['addr:postcode'];
    if (tags['addr:country']) address.country = tags['addr:country'];
    return address;
  }

  /**
   * Convert one Overpass element into a TravelRecord (minus group_uuid/data_version/raw_r2_key)
   * plus the entity-resolution match signals. Returns null when the element has no usable
   * coordinates or no name.
   */
  export function osmElementToRecord(
    el: OverpassElement,
  ): { record: NormalizedRecord; signals: MatchSignals } | null {
    const name = el.tags.name;
    if (!name) return null;

    const coords = pickCoords(el);
    if (!coords) return null;

    const category = el.tags.amenity ?? el.tags.shop ?? el.tags.tourism;
    if (!category) return null;

    const source = 'osm';
    const source_id = `${el.type}/${el.id}`;
    const { lat, lng } = coords;
    const cells = deriveCells(lat, lng);

    const attributes = JSON.stringify({
      address: buildAddress(el.tags),
      cuisine: el.tags.cuisine,
      opening_hours: el.tags.opening_hours,
    });

    const record: NormalizedRecord = {
      record_uuid: recordUuid(source, source_id),
      subject: 'poi',
      category,
      name,
      lat,
      lng,
      h3_r5: cells.h3_r5,
      h3_r7: cells.h3_r7,
      h3_r10: cells.h3_r10,
      attributes,
      source,
      source_id,
      source_url: `https://www.openstreetmap.org/${source_id}`,
      lang: 'en',
      content_hash: fnv1a(name + lat + lng + source + source_id),
    };

    const signals: MatchSignals = {};
    if (el.tags.brand) signals.brand = el.tags.brand;
    if (el.tags['brand:wikidata']) signals.brandWikidata = el.tags['brand:wikidata'];

    return { record, signals };
  }
  ```

- [ ] **Step 4: Run the test — expect PASS.**
  ```
  pnpm --filter @travel/pipeline-core test -- run normalize/osm
  ```
  Expected: PASS — all 6 cases green (standalone, brand'd, way-with-center, shop fall-through, nameless→null, no-coords→null).

- [ ] **Step 5: Typecheck + commit.**
  ```
  pnpm --filter @travel/pipeline-core exec tsc --noEmit
  git add packages/pipeline-core/src/normalize/osm.ts packages/pipeline-core/test/fixtures/overpass-sample.ts packages/pipeline-core/test/normalize/osm.test.ts
  git commit -m "$(cat <<'EOF'
  feat(pipeline-core): OSM Overpass element normalizer

  Add osmElementToRecord: maps an OverpassElement to a snake_case
  TravelRecord (minus group_uuid/data_version/raw_r2_key) plus brand /
  brand:wikidata match signals. Category falls through amenity||shop||tourism,
  coords from node lat/lon or way/relation center, address kept as a JSON
  object, content_hash via sync fnv1a. Returns null on missing name or coords.
  Golden fixture covers standalone, branded chain, way-with-center, shop
  fall-through, and both null cases.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```
  Expected: tsc clean (no emit), commit created.

---

### Task 5: Grouping + GroupRegistry (in-memory + D1)

Entity-resolution alias derivation and the program-owned group registry. `aliasFor` maps a record + its match signals to a stable alias key with a fixed precedence (`brand:wikidata` → `brand:slug` → `transport:<category>` → `standalone:<record_uuid>`); the registry mints exactly one UUIDv7 per alias (D9: aliases are match signals, never identity). Two impls: `InMemoryGroupRegistry` (CLI/tests) and `D1GroupRegistry` (idempotent under retry/race via `INSERT OR IGNORE`). All field access is snake_case per the canonical `TravelRecord`. This task ONLY ADDS files — it never creates a `package.json`, `tsconfig.json`, or `vitest.config.ts` (those are owned by Task 0).

**Files:**
- Create: `packages/pipeline-core/src/grouping/alias.ts`
- Create: `packages/pipeline-core/src/grouping/registry.ts`
- Create: `apps/data-pipeline/src/registry-d1.ts`
- Create: `apps/data-pipeline/migrations/0001_groups.sql`
- Modify: `packages/pipeline-core/src/index.ts` (re-export grouping)
- Test: `packages/pipeline-core/test/grouping/alias.test.ts`
- Test: `packages/pipeline-core/test/grouping/registry.test.ts`
- Test: `apps/data-pipeline/test/registry-d1.test.ts`

- [ ] **Step 1: Failing test — `aliasFor` precedence (pipeline-core, Vitest pure).**
  Create `packages/pipeline-core/test/grouping/alias.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { aliasFor, slugify } from '../../src/grouping/alias.js';

  const rec = (over: Partial<{ subject: string; category: string; name: string; record_uuid: string }> = {}) => ({
    subject: 'poi',
    category: 'restaurant',
    name: 'Tek Sen Restaurant',
    record_uuid: '7652d8d8-903d-5c7c-9eab-f982ef6aec68',
    ...over,
  });

  describe('slugify', () => {
    it('lowercases, dashes non-alphanumerics, trims edge dashes', () => {
      expect(slugify('Old Town White Coffee!')).toBe('old-town-white-coffee');
      expect(slugify('  --Kopitiam--  ')).toBe('kopitiam');
    });
  });

  describe('aliasFor precedence', () => {
    it('1) brand:wikidata wins over every other signal', () => {
      const a = aliasFor(rec({ subject: 'transport', category: 'bus' }), {
        brand: 'McDonalds',
        brandWikidata: 'Q38076',
      });
      expect(a).toEqual({ key: 'brand:wikidata:Q38076', kind: 'chain', name: 'McDonalds' });
    });

    it('2) brand:slug when wikidata absent but brand present', () => {
      const a = aliasFor(rec({ subject: 'transport' }), { brand: 'Old Town White Coffee' });
      expect(a).toEqual({
        key: 'brand:slug:old-town-white-coffee',
        kind: 'chain',
        name: 'Old Town White Coffee',
      });
    });

    it('3) transport:<category> when no brand and subject is transport', () => {
      const a = aliasFor(rec({ subject: 'transport', category: 'bus', name: 'Komtar Bus Terminal' }), {});
      expect(a).toEqual({ key: 'transport:bus', kind: 'transport_category', name: 'bus' });
    });

    it('4) standalone:<record_uuid> as the fallback (reads rec.record_uuid snake_case)', () => {
      const a = aliasFor(rec(), {});
      expect(a).toEqual({
        key: 'standalone:7652d8d8-903d-5c7c-9eab-f982ef6aec68',
        kind: 'standalone',
        name: 'Tek Sen Restaurant',
      });
    });

    it('brand falls back to slug even if brand has odd casing/punctuation', () => {
      const a = aliasFor(rec(), { brand: "McDonald's" });
      expect(a.key).toBe('brand:slug:mcdonald-s');
      expect(a.kind).toBe('chain');
      expect(a.name).toBe("McDonald's");
    });
  });
  ```

- [ ] **Step 2: Run — expect FAIL (module missing).**
  Run: `pnpm --filter @travel/pipeline-core test run grouping/alias`
  Expected: FAIL — `Cannot find module '../../src/grouping/alias.js'` (the file does not exist yet).

- [ ] **Step 3: Implement `aliasFor` + `slugify` (minimal real code).**
  Create `packages/pipeline-core/src/grouping/alias.ts`:
  ```ts
  import type { MatchSignals } from '../types.js';

  /** Lowercase, collapse non-alphanumerics to single dashes, trim edge dashes. */
  export function slugify(s: string): string {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  export interface Alias {
    key: string;
    kind: 'chain' | 'transport_category' | 'standalone';
    name: string;
  }

  /**
   * Pick the alias that identifies a record's program group (the ER match signal).
   * Precedence (D9 — aliases are signals, never identity):
   *   1. brand:wikidata:<qid>      (chain)
   *   2. brand:slug:<slug>         (chain)
   *   3. transport:<category>      (transport_category)  — only when subject==='transport'
   *   4. standalone:<record_uuid>  (standalone)          — fallback
   * Reads rec.record_uuid (snake_case).
   */
  export function aliasFor(
    rec: { subject: string; category: string; name: string; record_uuid: string },
    signals: MatchSignals,
  ): Alias {
    if (signals.brandWikidata) {
      return { key: `brand:wikidata:${signals.brandWikidata}`, kind: 'chain', name: signals.brand ?? rec.name };
    }
    if (signals.brand) {
      return { key: `brand:slug:${slugify(signals.brand)}`, kind: 'chain', name: signals.brand };
    }
    if (rec.subject === 'transport') {
      return { key: `transport:${rec.category}`, kind: 'transport_category', name: rec.category };
    }
    return { key: `standalone:${rec.record_uuid}`, kind: 'standalone', name: rec.name };
  }
  ```
  Note: `MatchSignals` is defined once in `types.ts` (Task 1) and imported here as a type only — no value-level dependency or import cycle.

- [ ] **Step 4: Run — expect PASS.**
  Run: `pnpm --filter @travel/pipeline-core test run grouping/alias`
  Expected: PASS — all 6 assertions green.

- [ ] **Step 5: Commit.**
  Run:
  ```sh
  git add packages/pipeline-core/src/grouping/alias.ts packages/pipeline-core/test/grouping/alias.test.ts
  git commit -m "$(cat <<'EOF'
  feat(pipeline-core): aliasFor + slugify for entity-resolution grouping

  Fixed precedence brand:wikidata > brand:slug > transport:<cat> > standalone.
  Reads snake_case rec.record_uuid; MatchSignals imported from types.ts.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

- [ ] **Step 6: Failing test — `InMemoryGroupRegistry` idempotency + chain-merge + transport-category.**
  Create `packages/pipeline-core/test/grouping/registry.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { InMemoryGroupRegistry } from '../../src/grouping/registry.js';

  const meta = (over = {}) => ({ subject: 'poi', kind: 'standalone', canonical_name: 'X', ...over });

  describe('InMemoryGroupRegistry', () => {
    it('mints a UUIDv7 and returns it (version nibble === 7)', async () => {
      const reg = new InMemoryGroupRegistry();
      const id = await reg.resolve('standalone:abc', meta());
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('is idempotent — same alias resolves to the same uuid across calls', async () => {
      const reg = new InMemoryGroupRegistry();
      const a = await reg.resolve('standalone:abc', meta());
      const b = await reg.resolve('standalone:abc', meta({ canonical_name: 'IGNORED' }));
      expect(a).toBe(b);
    });

    it('chain-merge — two outlets sharing a brand alias share one group', async () => {
      const reg = new InMemoryGroupRegistry();
      const a = await reg.resolve('brand:slug:kopitiam', meta({ kind: 'chain', canonical_name: 'Kopitiam' }));
      const b = await reg.resolve('brand:slug:kopitiam', meta({ kind: 'chain', canonical_name: 'Kopitiam' }));
      const c = await reg.resolve('brand:slug:old-town', meta({ kind: 'chain', canonical_name: 'Old Town' }));
      expect(a).toBe(b);
      expect(a).not.toBe(c);
    });

    it('transport-category — all bus stations share one category group', async () => {
      const reg = new InMemoryGroupRegistry();
      const bus1 = await reg.resolve('transport:bus', meta({ subject: 'transport', kind: 'transport_category', canonical_name: 'bus' }));
      const bus2 = await reg.resolve('transport:bus', meta({ subject: 'transport', kind: 'transport_category', canonical_name: 'bus' }));
      const train = await reg.resolve('transport:train', meta({ subject: 'transport', kind: 'transport_category', canonical_name: 'train' }));
      expect(bus1).toBe(bus2);
      expect(bus1).not.toBe(train);
    });

    it('distinct aliases mint distinct uuids', async () => {
      const reg = new InMemoryGroupRegistry();
      const a = await reg.resolve('standalone:one', meta());
      const b = await reg.resolve('standalone:two', meta());
      expect(a).not.toBe(b);
    });
  });
  ```

- [ ] **Step 7: Run — expect FAIL (module missing).**
  Run: `pnpm --filter @travel/pipeline-core test run grouping/registry`
  Expected: FAIL — `Cannot find module '../../src/grouping/registry.js'`.

- [ ] **Step 8: Implement `GroupRegistry` + `InMemoryGroupRegistry` (minimal real code).**
  Create `packages/pipeline-core/src/grouping/registry.ts`:
  ```ts
  import { v7 as uuidv7 } from 'uuid';

  /** Metadata captured the first time an alias mints a group (groups table row). */
  export interface GroupMeta {
    subject: string;
    kind: string;
    canonical_name: string;
  }

  /**
   * Program-owned group identity registry. resolve() reuses the existing
   * group_uuid for a known alias, otherwise mints a fresh UUIDv7 (D9 — the
   * minted uuid is the identity; the alias is only a match signal). Idempotent.
   */
  export interface GroupRegistry {
    resolve(aliasKey: string, meta: GroupMeta): Promise<string>;
  }

  /** In-memory impl for the CLI and unit tests; mints exactly one uuidv7 per alias. */
  export class InMemoryGroupRegistry implements GroupRegistry {
    private readonly aliases = new Map<string, string>(); // alias_key -> group_uuid
    private readonly groups = new Map<string, GroupMeta>(); // group_uuid -> meta

    async resolve(aliasKey: string, meta: GroupMeta): Promise<string> {
      const existing = this.aliases.get(aliasKey);
      if (existing) return existing;
      const group_uuid = uuidv7(); // program-minted — NOT derived from any external id
      this.aliases.set(aliasKey, group_uuid);
      this.groups.set(group_uuid, meta);
      return group_uuid;
    }
  }
  ```

- [ ] **Step 9: Run — expect PASS.**
  Run: `pnpm --filter @travel/pipeline-core test run grouping/registry`
  Expected: PASS — all 5 assertions green.

- [ ] **Step 10: Re-export grouping from pipeline-core barrel, then build.**
  Modify `packages/pipeline-core/src/index.ts` — append:
  ```ts
  export * from './grouping/alias.js';
  export * from './grouping/registry.js';
  ```
  Run: `pnpm --filter @travel/pipeline-core build`
  Expected: PASS — `tsc` compiles with no errors; `aliasFor`, `slugify`, `GroupRegistry`, `GroupMeta`, `InMemoryGroupRegistry` are exported from `@travel/pipeline-core`.

- [ ] **Step 11: Commit.**
  Run:
  ```sh
  git add packages/pipeline-core/src/grouping/registry.ts packages/pipeline-core/src/index.ts packages/pipeline-core/test/grouping/registry.test.ts
  git commit -m "$(cat <<'EOF'
  feat(pipeline-core): GroupRegistry interface + InMemoryGroupRegistry

  Mints one UUIDv7 per alias; idempotent resolve(); chain-merge and
  transport-category share groups. Re-exported from package barrel.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

- [ ] **Step 12: Create the D1 migration for the group registry tables.**
  Create `apps/data-pipeline/migrations/0001_groups.sql`:
  ```sql
  -- Program-owned group identity registry (write-side state for entity resolution, v1).
  -- groups: minted UUIDv7 identities. group_aliases: match signals -> group_uuid.
  CREATE TABLE IF NOT EXISTS groups (
    group_uuid     TEXT PRIMARY KEY,   -- minted UUIDv7 (program-internal, never an external id)
    subject        TEXT NOT NULL,
    kind           TEXT NOT NULL,      -- chain | transport_category | standalone
    canonical_name TEXT NOT NULL,
    created_at     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS group_aliases (
    alias_key  TEXT PRIMARY KEY,       -- brand:wikidata:Q123 | brand:slug:<slug> | transport:<cat> | standalone:<record_uuid>
    group_uuid TEXT NOT NULL,
    FOREIGN KEY (group_uuid) REFERENCES groups(group_uuid)
  );

  CREATE INDEX IF NOT EXISTS idx_group_aliases_group ON group_aliases(group_uuid);
  ```

- [ ] **Step 13: Failing test — `D1GroupRegistry` via @cloudflare/vitest-pool-workers (Miniflare), migration applied.**
  Create `apps/data-pipeline/test/registry-d1.test.ts`:
  ```ts
  import { describe, it, expect, beforeEach } from 'vitest';
  import { env } from 'cloudflare:test';
  import { readFileSync } from 'node:fs';
  import { fileURLToPath } from 'node:url';
  import { D1GroupRegistry } from '../src/registry-d1.js';

  const migration = readFileSync(
    fileURLToPath(new URL('../migrations/0001_groups.sql', import.meta.url)),
    'utf8',
  );

  // Apply the migration once per test against the isolated-per-test D1 (env.GROUPS).
  async function applyMigration() {
    for (const stmt of migration.split(';').map((s) => s.trim()).filter(Boolean)) {
      await env.GROUPS.prepare(stmt).run();
    }
  }

  const meta = (over = {}) => ({ subject: 'poi', kind: 'standalone', canonical_name: 'X', ...over });

  describe('D1GroupRegistry', () => {
    beforeEach(async () => {
      await applyMigration();
    });

    it('mints a UUIDv7 and persists groups + group_aliases rows', async () => {
      const reg = new D1GroupRegistry(env.GROUPS);
      const id = await reg.resolve('standalone:abc', meta({ canonical_name: 'Tek Sen' }));
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

      const alias = await env.GROUPS.prepare('SELECT group_uuid FROM group_aliases WHERE alias_key = ?')
        .bind('standalone:abc')
        .first<{ group_uuid: string }>();
      expect(alias?.group_uuid).toBe(id);

      const group = await env.GROUPS.prepare('SELECT canonical_name, kind FROM groups WHERE group_uuid = ?')
        .bind(id)
        .first<{ canonical_name: string; kind: string }>();
      expect(group).toEqual({ canonical_name: 'Tek Sen', kind: 'standalone' });
    });

    it('repeated resolve of the same alias returns the same uuid (idempotent)', async () => {
      const reg = new D1GroupRegistry(env.GROUPS);
      const a = await reg.resolve('brand:slug:kopitiam', meta({ kind: 'chain', canonical_name: 'Kopitiam' }));
      const b = await reg.resolve('brand:slug:kopitiam', meta({ kind: 'chain', canonical_name: 'IGNORED' }));
      expect(a).toBe(b);

      const rows = await env.GROUPS.prepare('SELECT COUNT(*) AS n FROM groups').first<{ n: number }>();
      expect(rows?.n).toBe(1); // INSERT OR IGNORE — no duplicate group row
    });

    it('concurrent resolves of the same NEW alias converge on one group (race-safe)', async () => {
      const reg = new D1GroupRegistry(env.GROUPS);
      const [a, b, c] = await Promise.all([
        reg.resolve('brand:slug:raced', meta({ kind: 'chain', canonical_name: 'Raced' })),
        reg.resolve('brand:slug:raced', meta({ kind: 'chain', canonical_name: 'Raced' })),
        reg.resolve('brand:slug:raced', meta({ kind: 'chain', canonical_name: 'Raced' })),
      ]);
      expect(a).toBe(b);
      expect(b).toBe(c);
      const aliasRows = await env.GROUPS.prepare('SELECT COUNT(*) AS n FROM group_aliases WHERE alias_key = ?')
        .bind('brand:slug:raced')
        .first<{ n: number }>();
      expect(aliasRows?.n).toBe(1);
    });

    it('distinct aliases mint distinct uuids', async () => {
      const reg = new D1GroupRegistry(env.GROUPS);
      const a = await reg.resolve('standalone:one', meta());
      const b = await reg.resolve('standalone:two', meta());
      expect(a).not.toBe(b);
    });
  });
  ```

- [ ] **Step 14: Run — expect FAIL (module missing).**
  Run: `pnpm --filter @travel/data-pipeline test run registry-d1`
  Expected: FAIL — `Cannot find module '../src/registry-d1.js'`. (The Miniflare D1 binding `env.GROUPS` is provided by Task 0's `vitest.config.ts` / `wrangler.jsonc`; this task only adds the source + migration + test.)

- [ ] **Step 15: Implement `D1GroupRegistry` (idempotent INSERT OR IGNORE, real code).**
  Create `apps/data-pipeline/src/registry-d1.ts`:
  ```ts
  import { v7 as uuidv7 } from 'uuid';
  import type { GroupRegistry, GroupMeta } from '@travel/pipeline-core';

  /**
   * D1-backed group registry. resolve():
   *   1. Read group_aliases by alias_key — reuse on hit.
   *   2. On miss, mint a UUIDv7 and INSERT OR IGNORE both rows (idempotent under
   *      retry; race-safe — a concurrent writer's row survives, ours is ignored).
   *   3. Re-read the alias to return the WINNING group_uuid (ours or the racer's).
   */
  export class D1GroupRegistry implements GroupRegistry {
    constructor(private readonly db: D1Database) {}

    async resolve(aliasKey: string, meta: GroupMeta): Promise<string> {
      const existing = await this.db
        .prepare('SELECT group_uuid FROM group_aliases WHERE alias_key = ?')
        .bind(aliasKey)
        .first<{ group_uuid: string }>();
      if (existing) return existing.group_uuid;

      const group_uuid = uuidv7(); // program-minted — NOT derived from any external id
      const created_at = Date.now();

      await this.db.batch([
        this.db
          .prepare(
            'INSERT OR IGNORE INTO groups (group_uuid, subject, kind, canonical_name, created_at) VALUES (?, ?, ?, ?, ?)',
          )
          .bind(group_uuid, meta.subject, meta.kind, meta.canonical_name, created_at),
        this.db
          .prepare('INSERT OR IGNORE INTO group_aliases (alias_key, group_uuid) VALUES (?, ?)')
          .bind(aliasKey, group_uuid),
      ]);

      // Re-read: if a concurrent writer won the alias INSERT, return THEIR uuid.
      const winner = await this.db
        .prepare('SELECT group_uuid FROM group_aliases WHERE alias_key = ?')
        .bind(aliasKey)
        .first<{ group_uuid: string }>();
      return winner!.group_uuid;
    }
  }
  ```
  Note: the orphan `groups` row that loses an alias race is harmless (its alias row was ignored, so nothing points to it); registry-scale cleanup is out of v1 scope per the spec's open questions.

- [ ] **Step 16: Run — expect PASS.**
  Run: `pnpm --filter @travel/data-pipeline test run registry-d1`
  Expected: PASS — mint/persist, idempotent (1 group row), race-safe (1 alias row), and distinct-aliases assertions all green.

- [ ] **Step 17: Commit.**
  Run:
  ```sh
  git add apps/data-pipeline/src/registry-d1.ts apps/data-pipeline/migrations/0001_groups.sql apps/data-pipeline/test/registry-d1.test.ts
  git commit -m "$(cat <<'EOF'
  feat(data-pipeline): D1GroupRegistry + 0001_groups migration

  INSERT OR IGNORE for both groups + group_aliases (idempotent under retry,
  race-safe via re-read of the winning alias). Tested with vitest-pool-workers.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 6: Overpass fetcher + raw landing

Adds the v1 OSM source fetcher and the R2 raw-landing writer. `OverpassElement`
is defined ONCE here (Task 6) and imported by every other module (normalize/osm.ts
in Task 7 imports it from `'../fetchers/overpass.js'`). `fetchOverpass` builds a
single Overpass-QL query over `amenity`, `shop`, AND `tourism` (`nwr ... out center;`),
takes an injected `fetch` dep (so tests mock it and the Worker/CLI pass their own),
and sends an honest `User-Agent`. `putRaw` writes the unmodified payload to
`env.DATA` under the deterministic key `raw/<source>/<fnv1a-hex>` BEFORE parsing,
so the pipeline is replayable. Single-bbox is v1; a comment seam marks where
bbox-chunking lands later. This task ONLY ADDS source/test files — it never
recreates `package.json`/`tsconfig.json`/`vitest.config.ts` (owned by Task 0).

**Files:**
- Create: `packages/pipeline-core/src/fetchers/overpass.ts`
- Create: `packages/pipeline-core/test/fetchers/overpass.test.ts`
- Create: `packages/pipeline-core/test/fixtures/overpass-response.json`
- Create: `packages/pipeline-core/src/lake/raw.ts`
- Create: `packages/pipeline-core/test/lake/raw.test.ts`
- Modify: `packages/pipeline-core/src/index.ts` (re-export the two new modules)

#### Step 1: Failing test for `fetchOverpass` (interface shape + parse)

- [ ] **Step 1: Write the Overpass fixture + failing fetcher test (real code).**

Create the golden fixture `packages/pipeline-core/test/fixtures/overpass-response.json`
(a realistic Overpass JSON envelope with one node, one way-with-center, and one
relation-with-center — covers all three `OverpassElement` coordinate shapes):

```json
{
  "version": 0.6,
  "generator": "Overpass API 0.7.62",
  "osm3s": {
    "timestamp_osm_base": "2026-06-12T00:00:00Z",
    "copyright": "The data included in this document is from www.openstreetmap.org. The data is made available under ODbL."
  },
  "elements": [
    {
      "type": "node",
      "id": 1001,
      "lat": 1.3000,
      "lon": 103.8000,
      "tags": { "amenity": "restaurant", "name": "Maxwell Food Centre", "cuisine": "hawker" }
    },
    {
      "type": "way",
      "id": 2002,
      "center": { "lat": 1.3010, "lon": 103.8010 },
      "tags": { "shop": "supermarket", "name": "FairPrice", "brand:wikidata": "Q5430873" }
    },
    {
      "type": "relation",
      "id": 3003,
      "center": { "lat": 1.3020, "lon": 103.8020 },
      "tags": { "tourism": "museum", "name": "National Museum" }
    }
  ]
}
```

Create `packages/pipeline-core/test/fetchers/overpass.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fetchOverpass, type OverpassElement } from '../../src/fetchers/overpass.js';

const fixtureUrl = new URL('../fixtures/overpass-response.json', import.meta.url);
const fixtureText = await readFile(fileURLToPath(fixtureUrl), 'utf8');

function mockFetch(body: string, ok = true, status = 200): typeof fetch {
  return vi.fn(async () =>
    new Response(body, { status, headers: { 'content-type': 'application/json' } }),
  ) as unknown as typeof fetch;
}

const BBOX: [number, number, number, number] = [1.29, 103.79, 1.31, 103.81];

describe('fetchOverpass', () => {
  it('parses the Overpass envelope into OverpassElement[]', async () => {
    const fetchSpy = mockFetch(fixtureText);
    const els = await fetchOverpass({ bbox: BBOX }, { fetch: fetchSpy });

    expect(els).toHaveLength(3);
    const node = els.find((e) => e.id === 1001) as OverpassElement;
    expect(node.type).toBe('node');
    expect(node.lat).toBe(1.3);
    expect(node.lon).toBe(103.8);
    expect(node.tags.amenity).toBe('restaurant');

    const way = els.find((e) => e.id === 2002) as OverpassElement;
    expect(way.type).toBe('way');
    expect(way.center).toEqual({ lat: 1.301, lon: 103.801 });
    expect(way.tags['brand:wikidata']).toBe('Q5430873');

    const rel = els.find((e) => e.id === 3003) as OverpassElement;
    expect(rel.type).toBe('relation');
    expect(rel.tags.tourism).toBe('museum');
  });

  it('POSTs a QL query covering amenity, shop AND tourism with out center, bbox, and honest User-Agent', async () => {
    const fetchSpy = mockFetch(fixtureText);
    await fetchOverpass({ bbox: BBOX }, { fetch: fetchSpy });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://overpass-api.de/api/interpreter');
    expect(init.method).toBe('POST');

    const headers = new Headers(init.headers);
    expect(headers.get('User-Agent')).toBe('travel-data-pipeline/1.0 (+management@rushowl.app)');
    expect(headers.get('content-type')).toBe('application/x-www-form-urlencoded');

    const body = String(init.body);
    const ql = decodeURIComponent(body.replace(/^data=/, ''));
    expect(ql).toContain('[out:json]');
    expect(ql).toContain('nwr["amenity"]');
    expect(ql).toContain('nwr["shop"]');
    expect(ql).toContain('nwr["tourism"]');
    // bbox is south,west,north,east per Overpass QL
    expect(ql).toContain('(1.29,103.79,1.31,103.81)');
    expect(ql).toContain('out center');
  });

  it('throws on a non-OK HTTP response', async () => {
    const fetchSpy = mockFetch('rate limited', false, 429);
    await expect(fetchOverpass({ bbox: BBOX }, { fetch: fetchSpy })).rejects.toThrow(
      /Overpass request failed: 429/,
    );
  });
});
```

#### Step 2: Run the fetcher test — expect FAIL

- [ ] **Step 2: Run and confirm RED.**

```bash
pnpm --filter @travel/pipeline-core test -- run test/fetchers/overpass.test.ts
```

Expected: FAIL — `Cannot find module '../../src/fetchers/overpass.js'` (the source
file does not exist yet). This proves the test is wired to real code.

#### Step 3: Implement `fetchOverpass` + `OverpassElement` (minimal real code)

- [ ] **Step 3: Create `packages/pipeline-core/src/fetchers/overpass.ts`.**

```ts
/**
 * OSM Overpass API fetcher (v1 source).
 *
 * `OverpassElement` is defined once in `../types.ts` (Task 1) so the normalizer
 * (Task 4) never forward-depends on this later task; we import and re-export it.
 */
import type { OverpassElement } from '../types.js';
export type { OverpassElement };

interface OverpassResponse {
  elements: OverpassElement[];
}

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

/** Honest identification per OSM/Overpass usage policy (rate-limit accountability). */
const USER_AGENT = 'travel-data-pipeline/1.0 (+management@rushowl.app)';

export interface FetchOverpassOpts {
  /** [south, west, north, east] in WGS84 degrees. */
  bbox: [number, number, number, number];
}

export interface FetchOverpassDeps {
  /** Injected so tests can mock and Worker/CLI pass their own runtime fetch. */
  fetch: typeof fetch;
}

/**
 * Build the Overpass-QL query for POI candidates inside `bbox`.
 *
 * Covers `amenity`, `shop`, AND `tourism` as `nwr` (node/way/relation) sets and
 * emits `out center` so ways/relations carry a representative coordinate.
 */
function buildQuery(bbox: [number, number, number, number]): string {
  const [south, west, north, east] = bbox;
  // Overpass QL bbox filter order is (south,west,north,east).
  const box = `(${south},${west},${north},${east})`;
  return [
    '[out:json][timeout:180];',
    '(',
    `  nwr["amenity"]${box};`,
    `  nwr["shop"]${box};`,
    `  nwr["tourism"]${box};`,
    ');',
    'out center;',
  ].join('\n');
}

/**
 * Fetch POI candidate elements from Overpass for a single bbox.
 *
 * v1 issues ONE request per bbox. SEAM: for large regions, chunk `bbox` into a
 * grid (e.g. by max element count or area) and merge the per-chunk element
 * arrays here, deduping by `${type}/${id}`. Deferred past v1 (D7 — single-bbox).
 */
export async function fetchOverpass(
  opts: FetchOverpassOpts,
  deps: FetchOverpassDeps,
): Promise<OverpassElement[]> {
  const query = buildQuery(opts.bbox);
  const res = await deps.fetch(OVERPASS_ENDPOINT, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!res.ok) {
    throw new Error(`Overpass request failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as OverpassResponse;
  return json.elements ?? [];
}
```

#### Step 4: Run the fetcher test — expect PASS

- [ ] **Step 4: Run and confirm GREEN.**

```bash
pnpm --filter @travel/pipeline-core test -- run test/fetchers/overpass.test.ts
```

Expected: PASS — all three cases (parse, query-construction, non-OK throw) green.

#### Step 5: Failing test for `putRaw` (deterministic key + stored body)

- [ ] **Step 5: Create `packages/pipeline-core/test/lake/raw.test.ts` (real code, R2 stub).**

```ts
import { describe, it, expect } from 'vitest';
import { putRaw } from '../../src/lake/raw.js';
import { fnv1a } from '../../src/hash.js';

/** Minimal in-memory R2Bucket stub — only the methods putRaw touches. */
function makeBucketStub() {
  const store = new Map<string, string>();
  const bucket = {
    async put(key: string, value: string) {
      store.set(key, value);
      return { key };
    },
    async get(key: string) {
      const v = store.get(key);
      return v === undefined ? null : { async text() { return v; } };
    },
  };
  return { bucket: bucket as unknown as R2Bucket, store };
}

describe('putRaw', () => {
  it('writes under the deterministic key raw/<source>/<fnv1a-hex> and returns it', async () => {
    const { bucket, store } = makeBucketStub();
    const payload = '{"elements":[{"type":"node","id":1}]}';

    const key = await putRaw(bucket, 'osm', payload);

    expect(key).toBe(`raw/osm/${fnv1a(payload)}`);
    expect(store.get(key)).toBe(payload);
  });

  it('is idempotent — same source + payload yields the same key (retry overwrites, never duplicates)', async () => {
    const { bucket, store } = makeBucketStub();
    const payload = 'identical-bytes';

    const k1 = await putRaw(bucket, 'osm', payload);
    const k2 = await putRaw(bucket, 'osm', payload);

    expect(k1).toBe(k2);
    expect(store.size).toBe(1);
  });

  it('namespaces by source', async () => {
    const { bucket } = makeBucketStub();
    const payload = 'shared-bytes';

    const a = await putRaw(bucket, 'osm', payload);
    const b = await putRaw(bucket, 'gtfs', payload);

    expect(a).toBe(`raw/osm/${fnv1a(payload)}`);
    expect(b).toBe(`raw/gtfs/${fnv1a(payload)}`);
    expect(a).not.toBe(b);
  });
});
```

#### Step 6: Run the raw test — expect FAIL

- [ ] **Step 6: Run and confirm RED.**

```bash
pnpm --filter @travel/pipeline-core test -- run test/lake/raw.test.ts
```

Expected: FAIL — `Cannot find module '../../src/lake/raw.js'` (source not created
yet). `fnv1a` already exists from Task 2's `hash.ts`, so the import of it resolves.

#### Step 7: Implement `putRaw` (minimal real code)

- [ ] **Step 7: Create `packages/pipeline-core/src/lake/raw.ts`.**

```ts
import { fnv1a } from '../hash.js';

/**
 * Land an unmodified source payload in R2 before any parsing → replayable ingest.
 *
 * Key is deterministic: `raw/<source>/<fnv1a-hex>`. Same bytes from the same
 * source always map to the same key, so a Workflow step retry overwrites the
 * blob instead of duplicating it. `fnv1a` is the repo's sync, deterministic
 * content hash (hash.ts) — no async crypto on the ingest hot path.
 *
 * @param bucket  the single R2 bucket binding (env.DATA)
 * @param source  provenance namespace, e.g. 'osm'
 * @param payload the raw response text exactly as received
 * @returns the R2 key the payload was stored under
 */
export async function putRaw(
  bucket: R2Bucket,
  source: string,
  payload: string,
): Promise<string> {
  const key = `raw/${source}/${fnv1a(payload)}`;
  await bucket.put(key, payload);
  return key;
}
```

#### Step 8: Run the raw test — expect PASS

- [ ] **Step 8: Run and confirm GREEN.**

```bash
pnpm --filter @travel/pipeline-core test -- run test/lake/raw.test.ts
```

Expected: PASS — deterministic-key, idempotency, and source-namespacing cases green.

#### Step 9: Re-export the new modules + full-suite green

- [ ] **Step 9: Add re-exports to `packages/pipeline-core/src/index.ts`.**

Append these lines (so `@travel/pipeline-core` consumers — the app's workflow and
CLI — can import `fetchOverpass`, `OverpassElement`, and `putRaw` from the package
root):

```ts
export * from './fetchers/overpass.js';
export * from './lake/raw.js';
```

Then run the whole package test suite and the type-check to confirm nothing
regressed and the new exports type-check:

```bash
pnpm --filter @travel/pipeline-core test -- run
pnpm --filter @travel/pipeline-core exec tsc --noEmit
```

Expected: PASS — all pipeline-core tests green; `tsc --noEmit` reports no errors
(R2Bucket resolves from `@cloudflare/workers-types` already present via Task 0).

#### Step 10: Commit

- [ ] **Step 10: Commit the Overpass fetcher + raw landing.**

```bash
git add packages/pipeline-core/src/fetchers/overpass.ts \
        packages/pipeline-core/src/lake/raw.ts \
        packages/pipeline-core/src/index.ts \
        packages/pipeline-core/test/fetchers/overpass.test.ts \
        packages/pipeline-core/test/fixtures/overpass-response.json \
        packages/pipeline-core/test/lake/raw.test.ts
git commit -m "$(cat <<'EOF'
feat(pipeline-core): Overpass fetcher + R2 raw landing

- fetchOverpass: single-bbox QL over amenity/shop/tourism (out center),
  injected fetch dep, honest User-Agent; bbox-chunking seam for v2.
- putRaw: deterministic raw/<source>/<fnv1a> key into env.DATA, replay-safe.
- OverpassElement defined once in types.ts (Task 1); imported + re-exported here.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: LakeWriter (NDJSON→R2) + r7 blob builder

Adds the SoT/analytics write tier and the R2 cold-serving blob builder to `@travel/pipeline-core`. `NdjsonR2LakeWriter` gzips one `toNdjsonLine` per record and PUTs it to the **deterministic** key `lake/<subject>/<region>/v<dataVersion>.ndjson.gz` (no wall-clock → Workflow-step retries overwrite the same object, never duplicate). The blob builder buckets records by `h3_r7` into `groups/r7/<h3_r7>` payloads stamped with `data_version`. All field access is **snake_case** on `TravelRecord` imported from `../record.js` (no new `TravelRecord` definition — single-ownership pin). This task only ADDS files; it does not touch any `package.json`, `tsconfig.json`, or `vitest.config.ts` (owned by Task 0).

`blob-builder.ts` is pure TS → Vitest. `ndjson-r2.ts` writes to an `R2Bucket` binding → `@cloudflare/vitest-pool-workers` (Miniflare) with a real R2 binding named `DATA`, per the testing-strategy contract.

**Files:**

- Create: `packages/pipeline-core/src/lake/lake-writer.ts`
- Create: `packages/pipeline-core/src/serving/blob-builder.ts`
- Create: `packages/pipeline-core/src/lake/ndjson-r2.ts`
- Modify: `packages/pipeline-core/src/index.ts`
- Test: `packages/pipeline-core/test/serving/blob-builder.test.ts`
- Test: `packages/pipeline-core/test/lake/ndjson-r2.test.ts`

---

- [ ] **Step 1: Failing test for `bucketByR7` + `buildGroupBlobs`**

  Create `packages/pipeline-core/test/serving/blob-builder.test.ts`. This is pure TS (no bindings) so it runs under the default Vitest project. It pins the key scheme `groups/r7/<h3_r7>`, the `data_version` stamp on the blob body, and grouping by `h3_r7`.

  ```ts
  import { describe, it, expect } from 'vitest';
  import type { TravelRecord } from '../../src/record.js';
  import { bucketByR7, buildGroupBlobs } from '../../src/serving/blob-builder.js';

  function rec(over: Partial<TravelRecord>): TravelRecord {
    return {
      record_uuid: 'r-uuid',
      group_uuid: 'g-uuid',
      subject: 'poi',
      category: 'restaurant',
      name: 'Somewhere',
      lat: 1.3,
      lng: 103.8,
      h3_r5: '8565a9bffffffff',
      h3_r7: '8765a9b40ffffff',
      h3_r10: '8a65a9b40007fff',
      attributes: '{}',
      source: 'osm',
      source_id: 'node/1',
      source_url: '',
      raw_r2_key: 'raw/osm/abc',
      lang: 'en',
      content_hash: 'deadbeef',
      data_version: 7,
      ...over,
    };
  }

  describe('bucketByR7', () => {
    it('groups records by their h3_r7 cell', () => {
      const a = rec({ record_uuid: 'a', h3_r7: 'cellA' });
      const b = rec({ record_uuid: 'b', h3_r7: 'cellA' });
      const c = rec({ record_uuid: 'c', h3_r7: 'cellB' });

      const buckets = bucketByR7([a, b, c]);

      expect(buckets.size).toBe(2);
      expect(buckets.get('cellA')!.map((r) => r.record_uuid)).toEqual(['a', 'b']);
      expect(buckets.get('cellB')!.map((r) => r.record_uuid)).toEqual(['c']);
    });

    it('returns an empty map for no records', () => {
      expect(bucketByR7([]).size).toBe(0);
    });
  });

  describe('buildGroupBlobs', () => {
    it('emits one blob per r7 cell at key groups/r7/<h3_r7>, stamped with data_version', () => {
      const a = rec({ record_uuid: 'a', h3_r7: 'cellA' });
      const b = rec({ record_uuid: 'b', h3_r7: 'cellA' });
      const c = rec({ record_uuid: 'c', h3_r7: 'cellB' });

      const blobs = buildGroupBlobs([a, b, c], 42);

      expect(blobs).toHaveLength(2);

      const byKey = new Map(blobs.map((bl) => [bl.key, bl]));
      expect([...byKey.keys()].sort()).toEqual(['groups/r7/cellA', 'groups/r7/cellB']);

      const blobA = JSON.parse(byKey.get('groups/r7/cellA')!.body);
      expect(blobA.h3_r7).toBe('cellA');
      expect(blobA.data_version).toBe(42);
      expect(blobA.records.map((r: TravelRecord) => r.record_uuid)).toEqual(['a', 'b']);
      // full snake_case record is preserved in the blob body
      expect(blobA.records[0].content_hash).toBe('deadbeef');
      expect(blobA.records[0].group_uuid).toBe('g-uuid');

      const blobB = JSON.parse(byKey.get('groups/r7/cellB')!.body);
      expect(blobB.data_version).toBe(42);
      expect(blobB.records).toHaveLength(1);
    });

    it('stamps the passed data_version, not the per-record one', () => {
      const a = rec({ record_uuid: 'a', h3_r7: 'cellA', data_version: 1 });
      const [blob] = buildGroupBlobs([a], 99);
      expect(JSON.parse(blob.body).data_version).toBe(99);
    });
  });
  ```

- [ ] **Step 2: Run the blob-builder test — expect FAIL**

  ```bash
  pnpm --filter @travel/pipeline-core test -- run test/serving/blob-builder.test.ts
  ```

  Expected: FAIL — `Cannot find module '../../src/serving/blob-builder.js'` (the file does not exist yet).

- [ ] **Step 3: Implement `blob-builder.ts`**

  Create `packages/pipeline-core/src/serving/blob-builder.ts`. Pure TS, imports `TravelRecord` from `../record.js` (single-ownership pin). Preserves insertion order in each bucket so blobs are deterministic.

  ```ts
  import type { TravelRecord } from '../record.js';

  /**
   * Bucket records by their r7 H3 cell (the blob/zone level).
   * Preserves input order within each bucket so blob bodies are deterministic.
   */
  export function bucketByR7(records: TravelRecord[]): Map<string, TravelRecord[]> {
    const buckets = new Map<string, TravelRecord[]>();
    for (const rec of records) {
      const existing = buckets.get(rec.h3_r7);
      if (existing) {
        existing.push(rec);
      } else {
        buckets.set(rec.h3_r7, [rec]);
      }
    }
    return buckets;
  }

  /**
   * Build one R2 cold-serving blob per r7 parent cell.
   * Key scheme: groups/r7/<h3_r7> (deterministic → Workflow-step retries overwrite,
   * never duplicate). Body is JSON stamped with the passed data_version plus the
   * full snake_case records under that cell.
   */
  export function buildGroupBlobs(
    records: TravelRecord[],
    dataVersion: number,
  ): { key: string; body: string }[] {
    const buckets = bucketByR7(records);
    const blobs: { key: string; body: string }[] = [];
    for (const [h3_r7, members] of buckets) {
      blobs.push({
        key: `groups/r7/${h3_r7}`,
        body: JSON.stringify({ h3_r7, data_version: dataVersion, records: members }),
      });
    }
    return blobs;
  }
  ```

- [ ] **Step 4: Run the blob-builder test — expect PASS**

  ```bash
  pnpm --filter @travel/pipeline-core test -- run test/serving/blob-builder.test.ts
  ```

  Expected: PASS — all `bucketByR7` and `buildGroupBlobs` cases green.

- [ ] **Step 5: Commit the blob builder**

  ```bash
  git add packages/pipeline-core/src/serving/blob-builder.ts packages/pipeline-core/test/serving/blob-builder.test.ts
  git commit -m "feat(pipeline-core): r7 blob builder (groups/r7/<h3_r7>, data_version stamp)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

- [ ] **Step 6: Define the `LakeWriter` interface**

  Create `packages/pipeline-core/src/lake/lake-writer.ts`. Pure interface, no test of its own (exercised via `NdjsonR2LakeWriter`). Imports `TravelRecord` from `../record.js`.

  ```ts
  import type { TravelRecord } from '../record.js';

  /**
   * Source-of-truth / analytics write tier (D3). v1 impl: NDJSON → R2.
   * Future impl: Iceberg/Pipelines (drop-in replacement).
   */
  export interface LakeWriter {
    append(
      records: TravelRecord[],
      opts: { source: string; region: string; dataVersion: number },
    ): Promise<void>;
  }
  ```

- [ ] **Step 7: Failing test for `NdjsonR2LakeWriter` (Miniflare R2 binding)**

  Create `packages/pipeline-core/test/lake/ndjson-r2.test.ts`. This touches an `R2Bucket` so it runs under the `@cloudflare/vitest-pool-workers` (Miniflare) project configured in Task 0's `vitest.config.ts`; the test file lives in the workers project glob and uses the `DATA` R2 binding from `env`. It decompresses the written object with `DecompressionStream` and asserts: exactly ONE object at the deterministic key, N NDJSON lines (one `JSON.stringify(record)` each), and that re-running `append` (retry) overwrites the SAME key rather than creating a second object.

  ```ts
  import { describe, it, expect } from 'vitest';
  import { env } from 'cloudflare:test';
  import type { TravelRecord } from '../../src/record.js';
  import { NdjsonR2LakeWriter } from '../../src/lake/ndjson-r2.js';

  interface TestEnv {
    DATA: R2Bucket;
  }
  const testEnv = env as unknown as TestEnv;

  function rec(over: Partial<TravelRecord>): TravelRecord {
    return {
      record_uuid: 'r-uuid',
      group_uuid: 'g-uuid',
      subject: 'poi',
      category: 'restaurant',
      name: 'Somewhere',
      lat: 1.3,
      lng: 103.8,
      h3_r5: '8565a9bffffffff',
      h3_r7: '8765a9b40ffffff',
      h3_r10: '8a65a9b40007fff',
      attributes: '{}',
      source: 'osm',
      source_id: 'node/1',
      source_url: '',
      raw_r2_key: 'raw/osm/abc',
      lang: 'en',
      content_hash: 'deadbeef',
      data_version: 5,
      ...over,
    };
  }

  async function readGzObject(key: string): Promise<string> {
    const obj = await testEnv.DATA.get(key);
    if (!obj) throw new Error(`no object at ${key}`);
    const decompressed = obj.body!.pipeThrough(new DecompressionStream('gzip'));
    return await new Response(decompressed).text();
  }

  describe('NdjsonR2LakeWriter', () => {
    it('writes ONE gz object at lake/<subject>/<region>/v<dataVersion>.ndjson.gz with N lines', async () => {
      const writer = new NdjsonR2LakeWriter(testEnv.DATA);
      const records = [
        rec({ record_uuid: 'a' }),
        rec({ record_uuid: 'b' }),
        rec({ record_uuid: 'c' }),
      ];

      await writer.append(records, { source: 'osm', region: 'georgetown', dataVersion: 5 });

      const key = 'lake/poi/georgetown/v5.ndjson.gz';
      const listed = await testEnv.DATA.list({ prefix: 'lake/' });
      expect(listed.objects.map((o) => o.key)).toEqual([key]);

      const text = await readGzObject(key);
      const lines = text.split('\n').filter((l) => l.length > 0);
      expect(lines).toHaveLength(3);
      const parsed = lines.map((l) => JSON.parse(l) as TravelRecord);
      expect(parsed.map((r) => r.record_uuid)).toEqual(['a', 'b', 'c']);
      // snake_case fields survive the NDJSON round-trip
      expect(parsed[0].content_hash).toBe('deadbeef');
      expect(parsed[0].group_uuid).toBe('g-uuid');
    });

    it('derives the key from subject of the first record (poi)', async () => {
      const writer = new NdjsonR2LakeWriter(testEnv.DATA);
      await writer.append([rec({ record_uuid: 'x' })], {
        source: 'osm',
        region: 'penang',
        dataVersion: 12,
      });
      const obj = await testEnv.DATA.get('lake/poi/penang/v12.ndjson.gz');
      expect(obj).not.toBeNull();
    });

    it('retry overwrites the SAME deterministic key (no duplicate object)', async () => {
      const writer = new NdjsonR2LakeWriter(testEnv.DATA);
      const opts = { source: 'osm', region: 'kl', dataVersion: 9 };

      await writer.append([rec({ record_uuid: 'a' }), rec({ record_uuid: 'b' })], opts);
      // simulate a Workflow-step retry with the same data_version
      await writer.append([rec({ record_uuid: 'a' }), rec({ record_uuid: 'b' })], opts);

      const listed = await testEnv.DATA.list({ prefix: 'lake/poi/kl/' });
      expect(listed.objects).toHaveLength(1);
      expect(listed.objects[0].key).toBe('lake/poi/kl/v9.ndjson.gz');

      const lines = (await readGzObject('lake/poi/kl/v9.ndjson.gz'))
        .split('\n')
        .filter((l) => l.length > 0);
      expect(lines).toHaveLength(2);
    });

    it('no-ops on empty input (writes nothing)', async () => {
      const writer = new NdjsonR2LakeWriter(testEnv.DATA);
      await writer.append([], { source: 'osm', region: 'empty', dataVersion: 1 });
      const listed = await testEnv.DATA.list({ prefix: 'lake/poi/empty/' });
      expect(listed.objects).toHaveLength(0);
    });
  });
  ```

- [ ] **Step 8: Run the lake-writer test — expect FAIL**

  ```bash
  pnpm --filter @travel/pipeline-core test -- run test/lake/ndjson-r2.test.ts
  ```

  Expected: FAIL — `Cannot find module '../../src/lake/ndjson-r2.js'` (the implementation does not exist yet).

- [ ] **Step 9: Implement `NdjsonR2LakeWriter`**

  Create `packages/pipeline-core/src/lake/ndjson-r2.ts`. Implements `LakeWriter`, gzips via `CompressionStream` (web standard, available in workerd and Node ≥22 — no external dep). Key is DETERMINISTIC from `data_version`: `lake/<subject>/<region>/v<dataVersion>.ndjson.gz` (no wall-clock → retries overwrite). Subject is taken from the first record (all records in one `append` share a subject in v1). Uses `toNdjsonLine` from `../record.js` per record. No-ops on empty input.

  ```ts
  import { toNdjsonLine, type TravelRecord } from '../record.js';
  import type { LakeWriter } from './lake-writer.js';

  /**
   * v1 SoT/analytics writer (D3): gzipped NDJSON → R2.
   *
   * Key scheme is DETERMINISTIC from data_version (NO wall-clock):
   *   lake/<subject>/<region>/v<dataVersion>.ndjson.gz
   * so a Workflow-step retry overwrites the same object and never duplicates.
   * DuckDB queries these gz NDJSON objects directly (zero egress).
   */
  export class NdjsonR2LakeWriter implements LakeWriter {
    constructor(private readonly bucket: R2Bucket) {}

    async append(
      records: TravelRecord[],
      opts: { source: string; region: string; dataVersion: number },
    ): Promise<void> {
      if (records.length === 0) return;

      const subject = records[0].subject;
      const key = `lake/${subject}/${opts.region}/v${opts.dataVersion}.ndjson.gz`;

      const ndjson = records.map(toNdjsonLine).join('\n') + '\n';
      const gz = await gzip(ndjson);

      await this.bucket.put(key, gz, {
        httpMetadata: { contentEncoding: 'gzip', contentType: 'application/x-ndjson' },
      });
    }
  }

  async function gzip(text: string): Promise<ArrayBuffer> {
    const stream = new Response(text).body!.pipeThrough(new CompressionStream('gzip'));
    return await new Response(stream).arrayBuffer();
  }
  ```

- [ ] **Step 10: Run the lake-writer test — expect PASS**

  ```bash
  pnpm --filter @travel/pipeline-core test -- run test/lake/ndjson-r2.test.ts
  ```

  Expected: PASS — one gz object at `lake/poi/<region>/v<n>.ndjson.gz`, N NDJSON lines, retry overwrites the same key, empty input writes nothing.

- [ ] **Step 11: Re-export from `index.ts`**

  Modify `packages/pipeline-core/src/index.ts` to add the new public exports (append these lines; do not remove existing re-exports owned by earlier tasks).

  ```ts
  export type { LakeWriter } from './lake/lake-writer.js';
  export { NdjsonR2LakeWriter } from './lake/ndjson-r2.js';
  export { bucketByR7, buildGroupBlobs } from './serving/blob-builder.js';
  ```

- [ ] **Step 12: Run the full pipeline-core suite + typecheck — expect PASS**

  ```bash
  pnpm --filter @travel/pipeline-core test -- run && pnpm --filter @travel/pipeline-core exec tsc --noEmit
  ```

  Expected: PASS — both Vitest projects (pure + workers-pool) green and no type errors. Confirms the new files compile under NodeNext ESM and the `index.ts` re-exports resolve.

- [ ] **Step 13: Commit the LakeWriter**

  ```bash
  git add packages/pipeline-core/src/lake/lake-writer.ts packages/pipeline-core/src/lake/ndjson-r2.ts packages/pipeline-core/test/lake/ndjson-r2.test.ts packages/pipeline-core/src/index.ts
  git commit -m "feat(pipeline-core): NdjsonR2LakeWriter (gzip NDJSON, deterministic lake/ key)

  Deterministic key lake/<subject>/<region>/v<dataVersion>.ndjson.gz so Workflow
  step retries overwrite, never duplicate. CompressionStream gzip; toNdjsonLine
  per snake_case record. Re-export LakeWriter + blob builder from index.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 8: Embed text + enrich consumer (Vectorize)

**Files:**
- Create: `packages/pipeline-core/src/embed/embed-text.ts`
- Create: `packages/pipeline-core/test/embed-text.test.ts`
- Modify: `packages/pipeline-core/src/index.ts` (re-export `composeEmbedText`)
- Create: `apps/data-pipeline/src/consumers/enrich.ts`
- Create: `apps/data-pipeline/test/enrich.test.ts`
- Create: `apps/data-pipeline/scripts/bootstrap-vectorize.ts`

> Pins honored: snake_case `TravelRecord` from `../record.js` (Task 1) is the only record type — no new record interface here. `recordMetadata(rec)` (Task 1) is the single source of Vectorize metadata. Enrich queue message is exactly `{ record_uuid: string; h3_r7: string; source: string }`. Consumer fetches the ONE blob `groups/r7/<h3_r7>` by key and picks the record by `record_uuid` — never `list()`. `composeEmbedText` parses `JSON.parse(rec.attributes).address` as an OBJECT. Vectorize is dims=1024 / cosine; the 6 string metadata indexes (`subject,category,group_uuid,h3_r5,h3_r7,h3_r10`) are created BEFORE any upsert. This task ONLY ADDS files (plus one re-export line in the pre-existing `index.ts`); it does NOT create/recreate any `package.json`, `tsconfig.json`, `vitest.config.ts`, or `wrangler.jsonc`.

- [ ] **Step 1: Failing test for `composeEmbedText` (address present)**
  Create `packages/pipeline-core/test/embed-text.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { composeEmbedText } from '../src/embed/embed-text.js';
  import type { TravelRecord } from '../src/record.js';

  function sample(overrides: Partial<TravelRecord> = {}): TravelRecord {
    return {
      record_uuid: 'r-1',
      group_uuid: 'g-1',
      subject: 'poi',
      category: 'restaurant',
      name: 'Joe Pizza',
      lat: 40.73,
      lng: -74.0,
      h3_r5: '8a2a1072b59ffff',
      h3_r7: '872a1072bffffff',
      h3_r10: '8a2a1072b597fff',
      attributes: JSON.stringify({
        address: { housenumber: '7', street: 'Carmine St', city: 'New York', postcode: '10014', country: 'US' },
        cuisine: 'pizza',
        opening_hours: 'Mo-Su 11:00-23:00',
      }),
      source: 'osm',
      source_id: 'node/123',
      source_url: '',
      raw_r2_key: 'raw/osm/abc',
      lang: 'en',
      content_hash: 'deadbeef',
      data_version: 7,
      ...overrides,
    };
  }

  describe('composeEmbedText', () => {
    it('includes name, category, and the formatted address (street, city)', () => {
      const text = composeEmbedText(sample());
      expect(text).toContain('Joe Pizza');
      expect(text).toContain('restaurant');
      expect(text).toContain('Carmine St, New York');
    });

    it('omits the address segment when attributes has no address object', () => {
      const text = composeEmbedText(sample({ attributes: JSON.stringify({ cuisine: 'pizza' }) }));
      expect(text).toContain('Joe Pizza');
      expect(text).toContain('restaurant');
      expect(text).not.toContain('undefined');
      expect(text.trim().endsWith(',')).toBe(false);
    });

    it('tolerates malformed attributes JSON without throwing', () => {
      const text = composeEmbedText(sample({ attributes: 'not-json' }));
      expect(text).toContain('Joe Pizza');
      expect(text).toContain('restaurant');
      expect(text).not.toContain('undefined');
    });

    it('formats address from street alone when city is absent', () => {
      const attrs = JSON.stringify({ address: { street: 'Carmine St' } });
      const text = composeEmbedText(sample({ attributes: attrs }));
      expect(text).toContain('Carmine St');
      expect(text).not.toContain('undefined');
    });
  });
  ```

- [ ] **Step 2: Run the test — expect FAIL**
  Run: `pnpm --filter @travel/pipeline-core test -- --run embed-text`
  Expected: FAIL — `Cannot find module '../src/embed/embed-text.js'` / `composeEmbedText is not a function` (file does not exist yet).

- [ ] **Step 3: Implement `composeEmbedText` (minimal real code)**
  Create `packages/pipeline-core/src/embed/embed-text.ts`:
  ```ts
  import type { TravelRecord } from '../record.js';

  interface Address {
    housenumber?: string;
    street?: string;
    city?: string;
    postcode?: string;
    country?: string;
  }

  function parseAddress(attributes: string): Address | undefined {
    try {
      const parsed = JSON.parse(attributes) as { address?: unknown };
      const addr = parsed?.address;
      if (addr && typeof addr === 'object') return addr as Address;
      return undefined;
    } catch {
      return undefined;
    }
  }

  function formatAddress(addr: Address | undefined): string {
    if (!addr) return '';
    const parts = [addr.street, addr.city].filter(
      (p): p is string => typeof p === 'string' && p.trim().length > 0,
    );
    return parts.join(', ');
  }

  /**
   * Compose the text embedded into Vectorize for a record:
   * "<name> <category> <street, city>" — address read from the
   * attributes.address OBJECT (snake_case TravelRecord). Empty/malformed
   * address contributes nothing (no "undefined", no trailing comma).
   */
  export function composeEmbedText(rec: TravelRecord): string {
    const address = formatAddress(parseAddress(rec.attributes));
    return [rec.name, rec.category, address]
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .join(' ');
  }
  ```

- [ ] **Step 4: Run the test — expect PASS**
  Run: `pnpm --filter @travel/pipeline-core test -- --run embed-text`
  Expected: PASS — all 4 `composeEmbedText` assertions green.

- [ ] **Step 5: Re-export `composeEmbedText` from pipeline-core index**
  Modify `packages/pipeline-core/src/index.ts` — ADD the line (keep all existing exports from earlier tasks):
  ```ts
  export { composeEmbedText } from './embed/embed-text.js';
  ```
  Run: `pnpm --filter @travel/pipeline-core build` (expected PASS — typechecks/compiles).
  Commit:
  ```
  git add packages/pipeline-core/src/embed/embed-text.ts packages/pipeline-core/test/embed-text.test.ts packages/pipeline-core/src/index.ts
  git commit -m "$(cat <<'EOF'
  feat(pipeline-core): composeEmbedText (name + category + formatted address)

  Reads attributes.address OBJECT off the snake_case TravelRecord; tolerates
  missing/malformed address with no "undefined"/trailing-comma artifacts.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

- [ ] **Step 6: Failing test for `enrichBatch` (upsert shape + idempotent ids + NonRetryableError)**
  Create `apps/data-pipeline/test/enrich.test.ts` (Vitest with Worker pool — uses real `NonRetryableError`, mocks for AI/Vectorize/R2):
  ```ts
  import { describe, it, expect, vi } from 'vitest';
  import { NonRetryableError } from 'cloudflare:workflows';
  import { enrichBatch } from '../src/consumers/enrich.js';
  import type { TravelRecord } from '@travel/pipeline-core';

  function rec(overrides: Partial<TravelRecord> = {}): TravelRecord {
    return {
      record_uuid: 'rec-1',
      group_uuid: 'grp-1',
      subject: 'poi',
      category: 'restaurant',
      name: 'Joe Pizza',
      lat: 40.73,
      lng: -74.0,
      h3_r5: '8a2a1072b59ffff',
      h3_r7: '872a1072bffffff',
      h3_r10: '8a2a1072b597fff',
      attributes: JSON.stringify({ address: { street: 'Carmine St', city: 'New York' } }),
      source: 'osm',
      source_id: 'node/1',
      source_url: '',
      raw_r2_key: 'raw/osm/abc',
      lang: 'en',
      content_hash: 'deadbeef',
      data_version: 7,
      ...overrides,
    };
  }

  function blobBody(records: TravelRecord[], dataVersion = 7): string {
    return JSON.stringify({ data_version: dataVersion, records });
  }

  function makeEnv(blobs: Record<string, string>) {
    const getCalls: string[] = [];
    const upserts: any[] = [];
    const aiCalls: any[] = [];
    const env = {
      DATA: {
        get: vi.fn(async (key: string) => {
          getCalls.push(key);
          const body = blobs[key];
          if (body === undefined) return null;
          return { text: async () => body } as unknown as R2ObjectBody;
        }),
      },
      AI: {
        run: vi.fn(async (_model: string, input: { text: string[] }) => {
          aiCalls.push(input);
          // bge-m3 returns 1024-dim vectors; one per input text.
          return { data: input.text.map(() => new Array(1024).fill(0.01)) };
        }),
      },
      VECTORIZE: {
        upsert: vi.fn(async (vectors: any[]) => {
          upserts.push(vectors);
          return { mutationId: 'm-1' };
        }),
      },
    };
    return { env, getCalls, upserts, aiCalls };
  }

  describe('enrichBatch', () => {
    it('embeds + upserts with id=record_uuid and recordMetadata, fetching the blob by key', async () => {
      const r = rec();
      const { env, getCalls, upserts, aiCalls } = makeEnv({
        'groups/r7/872a1072bffffff': blobBody([r]),
      });

      await enrichBatch([{ record_uuid: 'rec-1', h3_r7: '872a1072bffffff', source: 'osm' }], env as any);

      // Fetched the ONE blob by deterministic key (never list()).
      expect(getCalls).toEqual(['groups/r7/872a1072bffffff']);
      // bge-m3 invoked with the composed text.
      expect(env.AI.run).toHaveBeenCalledWith('@cf/baai/bge-m3', expect.anything());
      expect(aiCalls[0].text[0]).toContain('Joe Pizza');
      // Exactly one upsert batch, one vector.
      expect(upserts).toHaveLength(1);
      const v = upserts[0][0];
      expect(v.id).toBe('rec-1');
      expect(v.values).toHaveLength(1024);
      expect(v.metadata).toEqual({
        subject: 'poi',
        category: 'restaurant',
        group_uuid: 'grp-1',
        h3_r5: '8a2a1072b59ffff',
        h3_r7: '872a1072bffffff',
        h3_r10: '8a2a1072b597fff',
      });
    });

    it('dedupes on record_uuid (duplicate messages -> one vector)', async () => {
      const r = rec();
      const { env, upserts, aiCalls } = makeEnv({
        'groups/r7/872a1072bffffff': blobBody([r]),
      });

      await enrichBatch(
        [
          { record_uuid: 'rec-1', h3_r7: '872a1072bffffff', source: 'osm' },
          { record_uuid: 'rec-1', h3_r7: '872a1072bffffff', source: 'osm' },
        ],
        env as any,
      );

      const allVectors = upserts.flat();
      expect(allVectors.map((v: any) => v.id)).toEqual(['rec-1']);
      expect(aiCalls[0].text).toHaveLength(1);
    });

    it('throws NonRetryableError when the blob is missing (-> DLQ)', async () => {
      const { env } = makeEnv({}); // no blob
      await expect(
        enrichBatch([{ record_uuid: 'rec-1', h3_r7: '872a1072bffffff', source: 'osm' }], env as any),
      ).rejects.toBeInstanceOf(NonRetryableError);
      expect(env.VECTORIZE.upsert).not.toHaveBeenCalled();
    });

    it('throws NonRetryableError when the record_uuid is absent from the blob', async () => {
      const { env } = makeEnv({
        'groups/r7/872a1072bffffff': blobBody([rec({ record_uuid: 'other' })]),
      });
      await expect(
        enrichBatch([{ record_uuid: 'rec-1', h3_r7: '872a1072bffffff', source: 'osm' }], env as any),
      ).rejects.toBeInstanceOf(NonRetryableError);
    });

    it('throws NonRetryableError when the blob body is unparseable', async () => {
      const { env } = makeEnv({ 'groups/r7/872a1072bffffff': 'not-json' });
      await expect(
        enrichBatch([{ record_uuid: 'rec-1', h3_r7: '872a1072bffffff', source: 'osm' }], env as any),
      ).rejects.toBeInstanceOf(NonRetryableError);
    });
  });
  ```

- [ ] **Step 7: Run the test — expect FAIL**
  Run: `pnpm --filter @travel/data-pipeline test -- --run enrich`
  Expected: FAIL — `Cannot find module '../src/consumers/enrich.js'` / `enrichBatch is not a function` (file does not exist yet).

- [ ] **Step 8: Implement `enrichBatch` (minimal real code)**
  Create `apps/data-pipeline/src/consumers/enrich.ts`:
  ```ts
  import { NonRetryableError } from 'cloudflare:workflows';
  import { composeEmbedText, recordMetadata, type TravelRecord } from '@travel/pipeline-core';

  export interface EnrichMessage {
    record_uuid: string;
    h3_r7: string;
    source: string;
  }

  export interface EnrichEnv {
    DATA: R2Bucket;
    AI: Ai;
    VECTORIZE: VectorizeIndex;
  }

  const BGE_M3 = '@cf/baai/bge-m3';

  interface GroupBlob {
    data_version: number;
    records: TravelRecord[];
  }

  /** groups/r7/<h3_r7> — the ONE deterministic blob key for a record's r7 parent. */
  function blobKey(h3_r7: string): string {
    return `groups/r7/${h3_r7}`;
  }

  async function loadRecord(env: EnrichEnv, msg: EnrichMessage): Promise<TravelRecord> {
    const key = blobKey(msg.h3_r7);
    const obj = await env.DATA.get(key);
    if (obj === null) {
      throw new NonRetryableError(`enrich: blob missing at ${key} for record ${msg.record_uuid}`);
    }
    let blob: GroupBlob;
    try {
      blob = JSON.parse(await obj.text()) as GroupBlob;
    } catch (cause) {
      throw new NonRetryableError(`enrich: unparseable blob at ${key}: ${String(cause)}`);
    }
    const records = blob?.records;
    if (!Array.isArray(records)) {
      throw new NonRetryableError(`enrich: blob at ${key} has no records array`);
    }
    const rec = records.find((r) => r.record_uuid === msg.record_uuid);
    if (rec === undefined) {
      throw new NonRetryableError(`enrich: record ${msg.record_uuid} absent from blob ${key}`);
    }
    return rec;
  }

  /**
   * Enrich a batch of queue messages: fetch the ONE groups/r7/<h3_r7> blob by
   * key, pick the record by record_uuid, embed with bge-m3, and upsert into
   * Vectorize (id=record_uuid, metadata=recordMetadata). Idempotent: dedupes on
   * record_uuid. Unrecoverable input (missing/unparseable blob, absent record)
   * throws NonRetryableError so the message routes to the DLQ instead of looping.
   */
  export async function enrichBatch(msgs: EnrichMessage[], env: EnrichEnv): Promise<void> {
    // Dedupe on record_uuid (retries / fan-in can deliver duplicates).
    const unique = new Map<string, EnrichMessage>();
    for (const m of msgs) {
      if (!unique.has(m.record_uuid)) unique.set(m.record_uuid, m);
    }
    if (unique.size === 0) return;

    const records: TravelRecord[] = [];
    for (const m of unique.values()) {
      records.push(await loadRecord(env, m));
    }

    const texts = records.map(composeEmbedText);
    const embedding = (await env.AI.run(BGE_M3, { text: texts })) as { data: number[][] };
    const values = embedding?.data;
    if (!Array.isArray(values) || values.length !== records.length) {
      throw new NonRetryableError(
        `enrich: bge-m3 returned ${values?.length ?? 0} vectors for ${records.length} records`,
      );
    }

    const vectors = records.map((rec, i) => ({
      id: rec.record_uuid,
      values: values[i],
      metadata: recordMetadata(rec),
    }));

    await env.VECTORIZE.upsert(vectors);
  }
  ```

- [ ] **Step 9: Run the test — expect PASS**
  Run: `pnpm --filter @travel/data-pipeline test -- --run enrich`
  Expected: PASS — all 5 `enrichBatch` assertions green (upsert shape, dedupe, and the three NonRetryableError cases).

- [ ] **Step 10: Create the Vectorize bootstrap (6 metadata indexes BEFORE any upsert)**
  Create `apps/data-pipeline/scripts/bootstrap-vectorize.ts`. It is runnable (`tsx`/`node`) and also documents the exact `wrangler` commands; it shells out to `wrangler` so a single `pnpm` invocation provisions the index + all 6 string metadata indexes before any upsert ever runs.
  ```ts
  /**
   * Bootstrap the Vectorize index for the data pipeline.
   *
   * MUST run BEFORE any enrich upsert: metadata indexes can only be created on
   * an index that has no conflicting vectors, and queries filter on these
   * fields. bge-m3 emits 1024-dim vectors; metric cosine (spec §5.1).
   *
   * Run:  pnpm --filter @travel/data-pipeline bootstrap:vectorize
   * (add to apps/data-pipeline/package.json scripts in Task 9 wiring, or invoke
   *  the equivalent wrangler commands below by hand.)
   *
   * Equivalent manual wrangler commands (idempotent: re-running create on an
   * existing index/property errors harmlessly — safe to ignore "already exists"):
   *
   *   wrangler vectorize create travel-records --dimensions=1024 --metric=cosine
   *   wrangler vectorize create-metadata-index travel-records --property-name=subject    --type=string
   *   wrangler vectorize create-metadata-index travel-records --property-name=category   --type=string
   *   wrangler vectorize create-metadata-index travel-records --property-name=group_uuid --type=string
   *   wrangler vectorize create-metadata-index travel-records --property-name=h3_r5      --type=string
   *   wrangler vectorize create-metadata-index travel-records --property-name=h3_r7      --type=string
   *   wrangler vectorize create-metadata-index travel-records --property-name=h3_r10     --type=string
   */
  import { spawnSync } from 'node:child_process';

  const INDEX = 'travel-records';
  const DIMENSIONS = 1024;
  const METRIC = 'cosine';
  // The 6 string metadata indexes (pointers, not payload) — created BEFORE upsert.
  const METADATA_PROPERTIES = ['subject', 'category', 'group_uuid', 'h3_r5', 'h3_r7', 'h3_r10'] as const;

  function wrangler(args: string[]): void {
    const printable = ['wrangler', ...args].join(' ');
    console.log(`$ ${printable}`);
    const res = spawnSync('wrangler', args, { stdio: 'inherit' });
    if (res.error) throw res.error;
    // Exit code != 0 is tolerated for "already exists" idempotency; surface it.
    if (res.status !== 0) {
      console.warn(`  (exit ${res.status}) — continuing; treat "already exists" as OK`);
    }
  }

  function main(): void {
    wrangler(['vectorize', 'create', INDEX, `--dimensions=${DIMENSIONS}`, `--metric=${METRIC}`]);
    for (const property of METADATA_PROPERTIES) {
      wrangler(['vectorize', 'create-metadata-index', INDEX, `--property-name=${property}`, '--type=string']);
    }
    console.log(`Bootstrapped Vectorize index "${INDEX}" (${DIMENSIONS}d/${METRIC}) with ${METADATA_PROPERTIES.length} string metadata indexes.`);
  }

  main();
  ```

- [ ] **Step 11: Verify the bootstrap script typechecks**
  Run: `pnpm --filter @travel/data-pipeline exec tsc --noEmit scripts/bootstrap-vectorize.ts`
  Expected: PASS — no type errors (script compiles; `node:child_process` resolves under NodeNext).

- [ ] **Step 12: Commit the consumer + bootstrap**
  ```
  git add apps/data-pipeline/src/consumers/enrich.ts apps/data-pipeline/test/enrich.test.ts apps/data-pipeline/scripts/bootstrap-vectorize.ts
  git commit -m "$(cat <<'EOF'
  feat(data-pipeline): enrich consumer (bge-m3 -> Vectorize) + index bootstrap

  enrichBatch fetches the ONE groups/r7/<h3_r7> blob by key, picks the record
  by record_uuid, embeds via @cf/baai/bge-m3, and upserts id=record_uuid /
  metadata=recordMetadata. Dedupes on record_uuid; throws NonRetryableError on
  missing/unparseable blob or absent record so it routes to the DLQ.

  bootstrap-vectorize provisions the 1024d/cosine index and all 6 string
  metadata indexes (subject,category,group_uuid,h3_r5,h3_r7,h3_r10) BEFORE any
  upsert.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 9: IngestRegion Workflow + Worker + CLI + wrangler

Wires the v1 producer slice end-to-end inside `apps/data-pipeline`: the `IngestRegion` Workflow orchestrates fetch → raw → normalize + entity-resolution → LakeWriter → group blobs → enrich enqueue; the Worker `index.ts` exposes `{ fetch, scheduled, queue }` and re-exports `IngestRegion`; `cli.ts` runs the same logic locally; and a single `wrangler.jsonc` declares every binding. An integration smoke test (`@cloudflare/vitest-pool-workers`) drives the real `run()` against in-test bindings with the golden Overpass fixture and asserts the raw object, the deterministic lake object, the `groups/r7` blob, and the per-record queue messages.

All field access is snake_case `TravelRecord` (from `@travel/pipeline-core`). This task ONLY adds source/test files plus the one `wrangler.jsonc`; it does not recreate any `package.json` / `tsconfig.json` / `vitest.config.ts` (those are owned by Task 0).

**Files:**
- Create: `apps/data-pipeline/src/workflows/ingest-region.ts`
- Create: `apps/data-pipeline/src/index.ts`
- Create: `apps/data-pipeline/src/cli.ts`
- Create: `apps/data-pipeline/wrangler.jsonc`
- Create: `apps/data-pipeline/src/env.ts`
- Test: `apps/data-pipeline/test/ingest-region.integration.test.ts`
- Test: `apps/data-pipeline/test/fixtures/overpass-golden.json`

#### Steps

- [ ] **Step 1: Define the Worker `Env` binding contract (no test — shared type)**

  Create `apps/data-pipeline/src/env.ts`. This is the single typed view of every binding the Workflow, Worker, and tests share. Real code, no placeholders.

  ```ts
  import type { GroupRegistry } from '@travel/pipeline-core';

  export interface IngestParams {
    source: string;
    region: string;
    bbox: [number, number, number, number];
    dataVersion: number;
  }

  export interface EnrichMessage {
    record_uuid: string;
    h3_r7: string;
    source: string;
  }

  export interface Env {
    DATA: R2Bucket;
    GROUPS: D1Database;
    ENRICH: Queue<EnrichMessage>;
    VECTORIZE: VectorizeIndex;
    AI: Ai;
    INGEST: Workflow<IngestParams>;
    DATA_VERSION: string;
  }

  // Re-export so the registry impl (Task 8) and workflow share one symbol.
  export type { GroupRegistry };
  ```

  No test for a pure type module; the integration test in Step 9 is what exercises it.

- [ ] **Step 2: Write the failing integration smoke test (real code, golden fixture)**

  Create `apps/data-pipeline/test/fixtures/overpass-golden.json` — three Overpass elements: a node and a way (with `center`) that fall under the SAME r7 parent so they bucket into one `groups/r7` blob, plus one element with no name (dropped by `osmElementToRecord`). Coordinates are George Town, Penang.

  ```json
  {
    "elements": [
      {
        "type": "node",
        "id": 1001,
        "lat": 5.4141,
        "lon": 100.3288,
        "tags": {
          "amenity": "restaurant",
          "name": "Line Clear Nasi Kandar",
          "cuisine": "indian",
          "addr:housenumber": "163",
          "addr:street": "Jalan Penang",
          "addr:city": "George Town",
          "addr:postcode": "10000",
          "addr:country": "MY",
          "opening_hours": "24/7"
        }
      },
      {
        "type": "way",
        "id": 2002,
        "center": { "lat": 5.4148, "lon": 100.3295 },
        "tags": {
          "shop": "convenience",
          "name": "99 Speedmart",
          "brand": "99 Speedmart",
          "brand:wikidata": "Q49262346",
          "addr:city": "George Town"
        }
      },
      {
        "type": "node",
        "id": 3003,
        "lat": 5.4150,
        "lon": 100.3300,
        "tags": { "amenity": "bench" }
      }
    ]
  }
  ```

  Create `apps/data-pipeline/test/ingest-region.integration.test.ts`. It instantiates `IngestRegion` against the in-test Worker bindings (`env` from `cloudflare:test`), drives `run()` with a deterministic `step` stub (each `step.do` just awaits its callback; `step.sleep` is a no-op), stubs `globalThis.fetch` to return the golden fixture, applies the D1 migration, then asserts every produced artifact. The DLQ/Queue producer in tests is captured by reading what the workflow enqueued.

  ```ts
  import { describe, it, expect, beforeAll, vi } from 'vitest';
  import { env } from 'cloudflare:test';
  import { readFileSync } from 'node:fs';
  import { fileURLToPath } from 'node:url';
  import { IngestRegion } from '../src/index.js';
  import type { Env, IngestParams, EnrichMessage } from '../src/env.js';

  const fixture = readFileSync(
    fileURLToPath(new URL('./fixtures/overpass-golden.json', import.meta.url)),
    'utf8',
  );
  const migration = readFileSync(
    fileURLToPath(new URL('../migrations/0001_groups.sql', import.meta.url)),
    'utf8',
  );

  // Deterministic in-test WorkflowStep: run callbacks inline, no retries/sleep.
  function fakeStep() {
    return {
      do: async (_name: string, a: unknown, b?: unknown) => {
        const cb = (typeof a === 'function' ? a : b) as () => Promise<unknown>;
        return cb();
      },
      sleep: async () => {},
      sleepUntil: async () => {},
    };
  }

  // Capture ENRICH.send while delegating the rest of the bindings to real ones.
  function captureEnv(sink: EnrichMessage[]): Env {
    return {
      ...(env as unknown as Env),
      ENRICH: {
        send: async (msg: EnrichMessage) => { sink.push(msg); },
        sendBatch: async (msgs: { body: EnrichMessage }[]) => {
          for (const m of msgs) sink.push(m.body);
        },
      } as unknown as Env['ENRICH'],
    };
  }

  async function gunzipToText(body: ReadableStream | ArrayBuffer): Promise<string> {
    const stream =
      body instanceof ArrayBuffer
        ? new Response(body).body!
        : (body as ReadableStream);
    const ds = new DecompressionStream('gzip');
    const out = stream.pipeThrough(ds);
    return new Response(out).text();
  }

  describe('IngestRegion integration smoke', () => {
    beforeAll(async () => {
      for (const stmt of migration.split(';').map((s) => s.trim()).filter(Boolean)) {
        await env.GROUPS.exec(stmt);
      }
    });

    it('produces raw, lake, group blobs, and queue messages from the golden fixture', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(fixture, { status: 200 })),
      );

      const sent: EnrichMessage[] = [];
      const testEnv = captureEnv(sent);
      const params: IngestParams = {
        source: 'osm',
        region: 'penang',
        bbox: [100.32, 5.41, 100.34, 5.42],
        dataVersion: 7,
      };

      const wf = new IngestRegion(
        {} as unknown as ConstructorParameters<typeof IngestRegion>[0],
        testEnv,
      );
      const summary = await wf.run(
        { payload: params, timestamp: new Date(), instanceId: 't', workflowName: 'INGEST' } as any,
        fakeStep() as any,
      );

      // 2 usable records (bench element dropped: no name).
      expect(summary.recordCount).toBe(2);

      // (1) raw object written under raw/osm/<hash> before parsing.
      const rawList = await env.DATA.list({ prefix: 'raw/osm/' });
      expect(rawList.objects.length).toBe(1);
      expect(await (await env.DATA.get(rawList.objects[0].key))!.text()).toBe(fixture);

      // (2) lake object at the DETERMINISTIC key (no wall-clock).
      const lakeKey = 'lake/poi/penang/v7.ndjson.gz';
      const lakeObj = await env.DATA.get(lakeKey);
      expect(lakeObj).not.toBeNull();
      const ndjson = await gunzipToText(await lakeObj!.arrayBuffer());
      const lines = ndjson.trim().split('\n');
      expect(lines.length).toBe(2);
      const first = JSON.parse(lines[0]);
      // snake_case fields present; data_version stamped.
      expect(first.record_uuid).toMatch(/^[0-9a-f-]{36}$/);
      expect(first.data_version).toBe(7);
      expect(first.raw_r2_key.startsWith('raw/osm/')).toBe(true);

      // (3) groups/r7 blob — both records share one r7 parent -> one blob.
      const groupList = await env.DATA.list({ prefix: 'groups/r7/' });
      expect(groupList.objects.length).toBe(1);
      const blob = JSON.parse(await (await env.DATA.get(groupList.objects[0].key))!.text());
      expect(blob.data_version).toBe(7);
      expect(blob.records.length).toBe(2);
      expect(groupList.objects[0].key).toBe(`groups/r7/${blob.records[0].h3_r7}`);

      // (4) one enrich message per record, shape {record_uuid,h3_r7,source}.
      expect(sent.length).toBe(2);
      for (const m of sent) {
        expect(typeof m.record_uuid).toBe('string');
        expect(typeof m.h3_r7).toBe('string');
        expect(m.source).toBe('osm');
      }
      // group_uuid minted + persisted in D1 registry (ER ran).
      const groups = await env.GROUPS.prepare('SELECT COUNT(*) AS n FROM groups').first<{ n: number }>();
      expect(groups!.n).toBeGreaterThanOrEqual(2);

      // Spec §11 — re-run proves no dupes: identical inputs overwrite deterministic keys.
      const summary2 = await wf.run(
        { payload: params, timestamp: new Date(), instanceId: 't2', workflowName: 'INGEST' } as any,
        fakeStep() as any,
      );
      expect(summary2.recordCount).toBe(2);
      expect((await env.DATA.list({ prefix: 'raw/osm/' })).objects.length).toBe(1);
      expect((await env.DATA.list({ prefix: 'lake/poi/penang/' })).objects.length).toBe(1);
      expect((await env.DATA.list({ prefix: 'groups/r7/' })).objects.length).toBe(1);
      const groups2 = await env.GROUPS.prepare('SELECT COUNT(*) AS n FROM groups').first<{ n: number }>();
      expect(groups2!.n).toBe(groups!.n); // ER idempotent — no new groups on re-scrape
    });
  });
  ```

- [ ] **Step 3: Run the test — expect FAIL (module not found)**

  ```bash
  pnpm --filter @travel/data-pipeline exec vitest run test/ingest-region.integration.test.ts
  ```

  Expected: FAIL — `Cannot find module '../src/index.js'` (and `IngestRegion` undefined). This confirms the test imports the not-yet-written entrypoint.

- [ ] **Step 4: Implement the IngestRegion Workflow (real code)**

  Create `apps/data-pipeline/src/workflows/ingest-region.ts`. Steps mirror the spec §6 flow. Each `step.do` returns only tiny JSON (keys/counts); the large `OverpassElement[]`/`TravelRecord[]` values stay in the workflow closure (never returned from a step) so step return values stay under the size cap. Entity resolution uses `INSERT OR IGNORE` and the lake/blob keys are deterministic from `dataVersion`, so a step retry — or a full re-run — overwrites rather than duplicates.

  ```ts
  import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
  import {
    fetchOverpass,
    putRaw,
    osmElementToRecord,
    aliasFor,
    deriveCells,
    recordUuid,
    NdjsonR2LakeWriter,
    buildGroupBlobs,
    type TravelRecord,
    type OverpassElement,
  } from '@travel/pipeline-core';
  import { D1GroupRegistry } from '../registry-d1.js';
  import type { Env, IngestParams, EnrichMessage } from '../env.js';

  interface IngestSummary {
    rawKey: string;
    lakeKey: string;
    blobKeys: string[];
    recordCount: number;
  }

  export class IngestRegion extends WorkflowEntrypoint<Env, IngestParams> {
    async run(event: WorkflowEvent<IngestParams>, step: WorkflowStep): Promise<IngestSummary> {
      const { source, region, bbox, dataVersion } = event.payload;
      const stepCfg = { retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' as const }, timeout: '5 minutes' };

      // (1) Fetch Overpass -> land raw payload in R2 BEFORE parsing (replayable).
      const rawKey = await step.do('fetch-and-land-raw', stepCfg, async () => {
        const elements = await fetchOverpass({ bbox }, { fetch: globalThis.fetch });
        const payload = JSON.stringify({ elements });
        return putRaw(this.env.DATA, source, payload);
      });

      // (2)+(2a) Normalize + entity-resolution -> group_uuid, data_version, raw_r2_key.
      // Records are recomputed from the raw blob (deterministic); the step returns only counts.
      const records = await this.materializeRecords(rawKey, source, dataVersion);

      const recordCount = await step.do('normalize-and-resolve', stepCfg, async () => records.length);

      // (3) LakeWriter.append -> NDJSON->R2 at the DETERMINISTIC key.
      const lakeKey = await step.do('lake-append', stepCfg, async () => {
        const writer = new NdjsonR2LakeWriter(this.env.DATA);
        await writer.append(records, { source, region, dataVersion });
        return `lake/${records[0]?.subject ?? 'poi'}/${region}/v${dataVersion}.ndjson.gz`;
      });

      // (4) Build r7 group blobs -> R2 (deterministic groups/r7/<h3_r7> keys; retries overwrite).
      const blobKeys = await step.do('build-group-blobs', stepCfg, async () => {
        const blobs = buildGroupBlobs(records, dataVersion);
        await Promise.all(
          blobs.map((b) => this.env.DATA.put(b.key, b.body, { httpMetadata: { contentType: 'application/json' } })),
        );
        return blobs.map((b) => b.key);
      });

      // (5) Enqueue one enrich message per record {record_uuid,h3_r7,source}.
      await step.do('enqueue-enrich', stepCfg, async () => {
        const messages: { body: EnrichMessage }[] = records.map((r) => ({
          body: { record_uuid: r.record_uuid, h3_r7: r.h3_r7, source },
        }));
        // sendBatch caps at 100/batch; chunk defensively.
        for (let i = 0; i < messages.length; i += 100) {
          await this.env.ENRICH.sendBatch(messages.slice(i, i + 100));
        }
        return messages.length;
      });

      return { rawKey, lakeKey, blobKeys, recordCount };
    }

    // Deterministic normalize + ER. Re-reads the raw blob so each step can rebuild
    // identical records without passing big arrays through step return values.
    private async materializeRecords(rawKey: string, source: string, dataVersion: number): Promise<TravelRecord[]> {
      const rawObj = await this.env.DATA.get(rawKey);
      if (rawObj === null) throw new Error(`raw object missing at ${rawKey}`);
      const { elements } = JSON.parse(await rawObj.text()) as { elements: OverpassElement[] };

      const registry = new D1GroupRegistry(this.env.GROUPS);
      const out: TravelRecord[] = [];
      for (const el of elements) {
        const normalized = osmElementToRecord(el);
        if (normalized === null) continue;
        const { record, signals } = normalized;
        const alias = aliasFor(
          { subject: record.subject, category: record.category, name: record.name, record_uuid: record.record_uuid },
          signals,
        );
        const group_uuid = await registry.resolve(alias.key, {
          subject: record.subject,
          kind: alias.kind,
          canonical_name: alias.name,
        });
        out.push({ ...record, group_uuid, raw_r2_key: rawKey, data_version: dataVersion });
      }
      return out;
    }
  }
  ```

  Note: `recordUuid`/`deriveCells` are imported for parity with the core barrel even though `osmElementToRecord` already applies them internally; keep the import list aligned with `@travel/pipeline-core`'s public surface. If lint flags them as unused, drop the two names — they are not load-bearing here.

- [ ] **Step 5: Implement the Worker entrypoint (real code)**

  Create `apps/data-pipeline/src/index.ts`. Default export provides `fetch` (ad-hoc trigger + health), `scheduled` (cron re-ingest), and `queue` (delegates to `enrichBatch`). Re-exports `IngestRegion` so wrangler can bind the Workflow class.

  ```ts
  import { IngestRegion } from './workflows/ingest-region.js';
  import { enrichBatch } from './consumers/enrich.js';
  import type { Env, IngestParams, EnrichMessage } from './env.js';

  // Default region seeded for cron re-ingest; ad-hoc runs override via POST body.
  const CRON_REGIONS: IngestParams[] = [
    { source: 'osm', region: 'penang', bbox: [100.0, 5.2, 100.6, 5.6], dataVersion: 0 },
  ];

  export default {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === '/health') return new Response('ok');

      if (request.method === 'POST' && url.pathname === '/ingest') {
        const body = (await request.json()) as Partial<IngestParams>;
        if (!body.region || !Array.isArray(body.bbox) || body.bbox.length !== 4) {
          return new Response('bad request: require {region, bbox:[4]}', { status: 400 });
        }
        const params: IngestParams = {
          source: body.source ?? 'osm',
          region: body.region,
          bbox: body.bbox as [number, number, number, number],
          dataVersion: body.dataVersion ?? Number(env.DATA_VERSION),
        };
        const instance = await env.INGEST.create({ params });
        return Response.json({ id: instance.id, params });
      }

      return new Response('not found', { status: 404 });
    },

    async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
      const dataVersion = Number(env.DATA_VERSION);
      ctx.waitUntil(
        Promise.all(
          CRON_REGIONS.map((r) => env.INGEST.create({ params: { ...r, dataVersion } })),
        ).then(() => undefined),
      );
    },

    async queue(batch: MessageBatch<EnrichMessage>, env: Env): Promise<void> {
      // DLQ is triage-only: log the dead messages and ack them so they do NOT
      // re-run enrichBatch (which would just throw NonRetryableError again).
      if (batch.queue === 'travel-enrich-dlq') {
        for (const m of batch.messages) console.error('enrich DLQ', m.body);
        batch.ackAll();
        return;
      }
      await enrichBatch(batch.messages.map((m) => m.body), env);
    },
  };

  export { IngestRegion };
  ```

- [ ] **Step 6: Implement the CLI (real code)**

  Create `apps/data-pipeline/src/cli.ts`. Parses `ingest --source --region --bbox --data-version` and runs the SAME core flow locally against remote bindings via Wrangler's `getPlatformProxy`, so local and deployed paths share one implementation.

  ```ts
  import { getPlatformProxy } from 'wrangler';
  import { IngestRegion } from './workflows/ingest-region.js';
  import type { Env, IngestParams } from './env.js';

  function parseArgs(argv: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a.startsWith('--')) out[a.slice(2)] = argv[++i] ?? '';
    }
    return out;
  }

  // Local WorkflowStep: run inline, no durable retry semantics needed for the CLI.
  function localStep() {
    return {
      do: async (_name: string, a: unknown, b?: unknown) => {
        const cb = (typeof a === 'function' ? a : b) as () => Promise<unknown>;
        return cb();
      },
      sleep: async () => {},
      sleepUntil: async () => {},
    };
  }

  async function main(): Promise<void> {
    const [cmd, ...rest] = process.argv.slice(2);
    if (cmd !== 'ingest') {
      console.error('usage: ingest --source osm --region <id> --bbox a,b,c,d --data-version <n>');
      process.exit(1);
    }
    const args = parseArgs(rest);
    const bbox = args.bbox.split(',').map(Number) as [number, number, number, number];
    if (bbox.length !== 4 || bbox.some(Number.isNaN)) {
      console.error('--bbox must be 4 comma-separated numbers: a,b,c,d');
      process.exit(1);
    }
    const params: IngestParams = {
      source: args.source ?? 'osm',
      region: args.region,
      bbox,
      dataVersion: Number(args['data-version']),
    };
    if (!params.region || Number.isNaN(params.dataVersion)) {
      console.error('--region and --data-version are required');
      process.exit(1);
    }

    const { env, dispose } = await getPlatformProxy<Env>({ configPath: 'wrangler.jsonc' });
    try {
      const wf = new IngestRegion({} as unknown as ConstructorParameters<typeof IngestRegion>[0], env);
      const summary = await wf.run(
        { payload: params, timestamp: new Date(), instanceId: `cli-${Date.now()}`, workflowName: 'INGEST' } as never,
        localStep() as never,
      );
      console.log(JSON.stringify(summary, null, 2));
    } finally {
      await dispose();
    }
  }

  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
  ```

- [ ] **Step 7: Author the single `wrangler.jsonc` (real config)**

  Create `apps/data-pipeline/wrangler.jsonc` — the SOLE wrangler config for this app (single-ownership). Declares one R2 bucket `travel-data` bound as `DATA`, the D1 `GROUPS` registry, the `ENRICH` queue (producer + consumer) with DLQ `travel-enrich-dlq`, the DLQ queue itself (consumer so DLQ messages are observable but never auto-retried into the main loop), `VECTORIZE`, `AI`, the `INGEST` workflow, the `DATA_VERSION` var, and a daily re-ingest cron. `remote: true` notes are inline comments since R2/Vectorize/D1 must hit the real cloud under `wrangler dev`.

  ```jsonc
  {
    "$schema": "node_modules/wrangler/config-schema.json",
    "name": "travel-data-pipeline",
    "main": "src/index.ts",
    "compatibility_date": "2025-05-01",
    "compatibility_flags": ["nodejs_compat"],

    // Daily re-ingest of the seeded regions (scheduled handler in index.ts).
    "triggers": { "crons": ["0 3 * * *"] },

    "vars": { "DATA_VERSION": "1" },

    // SoT lake + raw landing + r7 cold blobs all live in ONE bucket.
    // `wrangler dev` must use remote:true so reads/writes hit real R2.
    "r2_buckets": [
      { "binding": "DATA", "bucket_name": "travel-data" /* remote: true under `wrangler dev` */ }
    ],

    // Program-owned group registry (write-side from v1). remote:true under dev.
    "d1_databases": [
      {
        "binding": "GROUPS",
        "database_name": "travel-groups",
        "database_id": "REPLACE_WITH_D1_ID",
        "migrations_dir": "migrations"
        /* remote: true under `wrangler dev` */
      }
    ],

    // Enrich pipeline: producer (workflow enqueues) + consumer (queue handler -> enrichBatch),
    // with a dead-letter queue for NonRetryableError / exhausted retries.
    "queues": {
      "producers": [{ "binding": "ENRICH", "queue": "travel-enrich" }],
      "consumers": [
        {
          "queue": "travel-enrich",
          "max_batch_size": 25,
          "max_batch_timeout": 10,
          "max_retries": 5,
          "dead_letter_queue": "travel-enrich-dlq"
        },
        // DLQ consumer: triage-only. Low throughput; messages land here after max_retries
        // or a NonRetryableError thrown by enrichBatch. No dead_letter_queue (terminal).
        {
          "queue": "travel-enrich-dlq",
          "max_batch_size": 10,
          "max_batch_timeout": 30,
          "max_retries": 1
        }
      ]
    },

    // Semantic front door. Index + 6 metadata indexes are created by the
    // bootstrap step BEFORE any upsert. remote:true under dev (no local Vectorize).
    "vectorize": [{ "binding": "VECTORIZE", "index_name": "travel-records" }],

    "ai": { "binding": "AI" },

    "workflows": [
      {
        "binding": "INGEST",
        "name": "ingest-region",
        "class_name": "IngestRegion"
      }
    ]
  }
  ```

  Note: `travel-enrich-dlq` is also declared as the DLQ in the producer flow's wrangler queue resource list implicitly by being a `dead_letter_queue` target; Cloudflare creates it on `wrangler deploy` if absent. The explicit DLQ consumer above makes triage observable. Replace `REPLACE_WITH_D1_ID` after `wrangler d1 create travel-groups`.

- [ ] **Step 8: Add a vitest-pool-workers config shim for bindings (Modify Task-0 file — no recreation)**

  Task 0 created `apps/data-pipeline/vitest.config.ts`. It must point the pool at `wrangler.jsonc` so `cloudflare:test`'s `env` exposes `DATA`, `GROUPS`, `VECTORIZE`, `AI`, and `ENRICH` to the integration test. If Task 0's config already references `wrangler.jsonc` via `poolOptions.workers.wrangler.configPath`, make NO change and skip to Step 9. Otherwise apply this minimal edit (do not recreate the file):

  ```ts
  // apps/data-pipeline/vitest.config.ts  (edit only the poolOptions block)
  import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

  export default defineWorkersConfig({
    test: {
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.jsonc' },
          miniflare: {
            // Vectorize/AI have no local sim; the smoke test does not assert on them.
            // R2, D1, and Queues run in Miniflare. The test stubs ENRICH.send to capture.
            compatibilityDate: '2025-05-01',
            compatibilityFlags: ['nodejs_compat'],
          },
        },
      },
    },
  });
  ```

  This is the one allowed touch of a Task-0 file because the test cannot resolve bindings without it; it ADDS the `configPath`/miniflare wiring and changes no ownership.

- [ ] **Step 9: Run the integration smoke test — expect PASS**

  ```bash
  pnpm --filter @travel/data-pipeline exec vitest run test/ingest-region.integration.test.ts
  ```

  Expected: PASS — all assertions green: 1 raw object equal to the fixture, lake object at `lake/poi/penang/v7.ndjson.gz` with 2 snake_case NDJSON lines each `data_version:7` and a `raw/osm/` prefixed `raw_r2_key`, exactly 1 `groups/r7/<h3_r7>` blob with `data_version:7` and 2 records, 2 captured enrich messages each `{record_uuid,h3_r7,source:'osm'}`, and at least 2 minted rows in the D1 `groups` registry.

- [ ] **Step 10: Typecheck the whole app builds against the bindings**

  ```bash
  pnpm --filter @travel/data-pipeline exec tsc --noEmit
  ```

  Expected: PASS — no type errors. `Env`, `IngestParams`, `EnrichMessage`, the Workflow generics, and the `@travel/pipeline-core` snake_case `TravelRecord` all resolve. (If `tsc` flags the two parity-only imports `recordUuid`/`deriveCells` in `ingest-region.ts` as unused, remove them per the Step-4 note and re-run.)

- [ ] **Step 11: Commit**

  ```bash
  git add apps/data-pipeline/src/workflows/ingest-region.ts \
          apps/data-pipeline/src/index.ts \
          apps/data-pipeline/src/cli.ts \
          apps/data-pipeline/src/env.ts \
          apps/data-pipeline/wrangler.jsonc \
          apps/data-pipeline/vitest.config.ts \
          apps/data-pipeline/test/ingest-region.integration.test.ts \
          apps/data-pipeline/test/fixtures/overpass-golden.json
  git commit -m "$(cat <<'EOF'
  feat(data-pipeline): IngestRegion workflow, worker entrypoint, CLI, wrangler

  Wire the v1 OSM producer slice: fetch->raw, normalize+ER->group_uuid, LakeWriter
  append at deterministic lake key, r7 group blobs, and per-record enrich enqueue.
  Worker exports {fetch,scheduled,queue} (queue->enrichBatch) and re-exports
  IngestRegion. CLI runs the same core locally via getPlatformProxy. Single
  wrangler.jsonc declares DATA(r2)/GROUPS(d1)/ENRICH(queue+DLQ)/VECTORIZE/AI/INGEST.
  Integration smoke (vitest-pool-workers) asserts raw, lake, group blob, and queue
  messages from the golden Overpass fixture.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 10: DuckDB analytics smoke (spec §11)

Proves the §11 "Analytics smoke" guarantee: after the v1 `NdjsonR2LakeWriter` writes a gzipped NDJSON lake object (`lake/<subject>/<region>/v<data_version>.ndjson.gz`), DuckDB can read the decompressed NDJSON via `read_json`/`read_ndjson` and return the **expected counts per category/region**. The test drives the *real* `NdjsonR2LakeWriter` against an in-memory R2 stub, pulls the bytes back out, gunzips them in Node (DuckDB-from-gz is awkward across versions, so we decompress first), writes a plain `.ndjson` to a temp dir, and runs `@duckdb/node-api` SQL over it. All field access is **snake_case** `TravelRecord` (`category`, the `region` is the LakeWriter `opts.region`, not a record field). This is pure-Node analytics tooling, so it runs under **plain Vitest** (no Worker pool) — it only touches the `NdjsonR2LakeWriter` class plus a hand-rolled `R2Bucket` stub, never a live binding.

**Files:**

- Create: `apps/data-pipeline/test/fixtures/r2-stub.ts` (in-memory `R2Bucket` test double — minimal, just what `NdjsonR2LakeWriter` calls)
- Create: `apps/data-pipeline/test/fixtures/sample-records.ts` (snake_case `TravelRecord[]` fixture with a known per-category distribution)
- Create: `apps/data-pipeline/test/analytics-smoke.test.ts` (the DuckDB smoke test)
- Modify: `apps/data-pipeline/package.json` (add `@duckdb/node-api` devDependency — via `pnpm add`, NOT by recreating the file; Task 0 owns its creation)

> Single-ownership note: Task 0 already created `apps/data-pipeline/{package.json,tsconfig.json,vitest.config.ts}` and `packages/pipeline-core/src/lake/ndjson-r2.ts` was authored in the LakeWriter task. This task **only adds** the devDependency (through `pnpm add`, which mutates but does not recreate the manifest) and **only adds** test + fixture files. It does not touch `wrangler.jsonc` (Task 9) or any `pipeline-core` source.

- [ ] **Step 1: Add the `@duckdb/node-api` devDependency to `@travel/data-pipeline`.**
  Run (adds to the existing manifest, respecting Task 0 single-ownership — does not recreate `package.json`):
  ```bash
  pnpm --filter @travel/data-pipeline add -D @duckdb/node-api@^1.3.0
  ```
  Expected: pnpm resolves and installs `@duckdb/node-api` (a `devDependencies` entry appears in `apps/data-pipeline/package.json`), and `pnpm-lock.yaml` updates. Verify it landed:
  ```bash
  node -e "const p=require('./apps/data-pipeline/package.json'); if(!p.devDependencies?.['@duckdb/node-api']) { console.error('MISSING @duckdb/node-api'); process.exit(1) } console.log('ok', p.devDependencies['@duckdb/node-api'])"
  ```
  Expected: prints `ok ^1.3.0`.
  Commit:
  ```bash
  git add apps/data-pipeline/package.json pnpm-lock.yaml
  git commit -m "build(data-pipeline): add @duckdb/node-api devDependency for analytics smoke

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

- [ ] **Step 2: Add the in-memory R2 stub the LakeWriter writes through.**
  The `NdjsonR2LakeWriter` calls `bucket.put(key, body)` and we need to read the stored bytes back as a gz `ArrayBuffer`. This stub implements only `put`/`get` over an in-memory `Map`, normalizing the body to `Uint8Array` so the test can gunzip it. Create `apps/data-pipeline/test/fixtures/r2-stub.ts`:
  ```ts
  // Minimal in-memory R2Bucket double for analytics-smoke (Task 10).
  // Implements only put/get; NdjsonR2LakeWriter writes gz NDJSON via put().

  export interface StoredObject {
    body: Uint8Array;
  }

  /** Coerce whatever NdjsonR2LakeWriter hands to put() into raw bytes. */
  async function toBytes(
    value: ReadableStream | ArrayBuffer | ArrayBufferView | Blob | string,
  ): Promise<Uint8Array> {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    if (typeof value === "string") return new TextEncoder().encode(value);
    if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
    // ReadableStream (e.g. gzip CompressionStream output)
    const reader = (value as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      chunks.push(chunk);
      total += chunk.byteLength;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  }

  export class InMemoryR2Bucket {
    readonly objects = new Map<string, StoredObject>();

    async put(
      key: string,
      value: ReadableStream | ArrayBuffer | ArrayBufferView | Blob | string,
    ): Promise<{ key: string }> {
      this.objects.set(key, { body: await toBytes(value) });
      return { key };
    }

    async get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> {
      const obj = this.objects.get(key);
      if (!obj) return null;
      const bytes = obj.body;
      return {
        async arrayBuffer() {
          return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer;
        },
      };
    }

    keys(): string[] {
      return [...this.objects.keys()];
    }
  }
  ```
  No test run yet (pure fixture); commit it together with the sample fixture in Step 3.

- [ ] **Step 3: Add the snake_case `TravelRecord` fixture with a known category/region distribution.**
  Records carry only the canonical snake_case fields (no `region` field — region is a LakeWriter `opts` value). The known distribution: subject `poi`, region `penang`, with category counts restaurant=3, cafe=2, hotel=1 (total 6). Create `apps/data-pipeline/test/fixtures/sample-records.ts`:
  ```ts
  import type { TravelRecord } from "@travel/pipeline-core";

  // Known distribution for the analytics smoke assertions:
  //   subject=poi, region=penang (a LakeWriter opt, NOT a record field)
  //   category: restaurant=3, cafe=2, hotel=1  (total 6)
  function rec(
    record_uuid: string,
    category: string,
    name: string,
    lat: number,
    lng: number,
  ): TravelRecord {
    return {
      record_uuid,
      group_uuid: `standalone:${record_uuid}`,
      subject: "poi",
      category,
      name,
      lat,
      lng,
      h3_r5: "85654c43fffffff",
      h3_r7: "87654c43fffffff",
      h3_r10: "8a654c43251ffff",
      attributes: JSON.stringify({
        address: { street: "Lebuh Chulia", city: "George Town" },
      }),
      source: "osm",
      source_id: `node/${record_uuid}`,
      source_url: "https://www.openstreetmap.org/",
      raw_r2_key: "raw/osm/deadbeef",
      lang: "en",
      content_hash: "00000000",
      data_version: 7,
    };
  }

  export const SAMPLE_REGION = "penang";
  export const SAMPLE_DATA_VERSION = 7;

  export const sampleRecords: TravelRecord[] = [
    rec("r1", "restaurant", "Auction Rooms", 5.4157, 100.3318),
    rec("r2", "restaurant", "Ichi Tong", 5.4131, 100.334),
    rec("r3", "restaurant", "Halab Penang", 5.4185, 100.3356),
    rec("r4", "cafe", "Kopi Cup", 5.42, 100.33),
    rec("r5", "cafe", "Mugshot", 5.421, 100.331),
    rec("r6", "hotel", "Eastern & Oriental", 5.4253, 100.3375),
  ];

  // Expected per-category counts the DuckDB query must reproduce.
  export const expectedCategoryCounts: Record<string, number> = {
    restaurant: 3,
    cafe: 2,
    hotel: 1,
  };
  ```
  Commit Steps 2+3:
  ```bash
  git add apps/data-pipeline/test/fixtures/r2-stub.ts apps/data-pipeline/test/fixtures/sample-records.ts
  git commit -m "test(data-pipeline): R2 stub + snake_case sample-records fixture for analytics smoke

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

- [ ] **Step 4: Write the failing analytics-smoke test (real DuckDB, real LakeWriter).**
  The test: (1) runs the real `NdjsonR2LakeWriter` against the R2 stub, (2) reads the gz bytes from the deterministic key `lake/poi/penang/v7.ndjson.gz`, (3) gunzips with Node's `zlib.gunzipSync`, (4) writes a plain `.ndjson` to an `mkdtemp` dir, (5) runs DuckDB `read_json` queries and asserts counts. DuckDB returns `count(*)` as `BigInt`, so we `Number(...)` every count. Create `apps/data-pipeline/test/analytics-smoke.test.ts`:
  ```ts
  import { mkdtemp, rm, writeFile } from "node:fs/promises";
  import { tmpdir } from "node:os";
  import { join } from "node:path";
  import { gunzipSync } from "node:zlib";
  import { DuckDBInstance } from "@duckdb/node-api";
  import { NdjsonR2LakeWriter } from "@travel/pipeline-core";
  import { afterEach, beforeEach, describe, expect, it } from "vitest";
  import { InMemoryR2Bucket } from "./fixtures/r2-stub.js";
  import {
    SAMPLE_DATA_VERSION,
    SAMPLE_REGION,
    expectedCategoryCounts,
    sampleRecords,
  } from "./fixtures/sample-records.js";

  describe("analytics smoke: DuckDB over lake NDJSON.gz (spec §11)", () => {
    let bucket: InMemoryR2Bucket;
    let workDir: string;
    let ndjsonPath: string;

    beforeEach(async () => {
      bucket = new InMemoryR2Bucket();
      workDir = await mkdtemp(join(tmpdir(), "lake-smoke-"));
      ndjsonPath = join(workDir, "lake.ndjson");

      // 1. Drive the REAL v1 LakeWriter against the R2 stub.
      const writer = new NdjsonR2LakeWriter(bucket as unknown as R2Bucket);
      await writer.append(sampleRecords, {
        source: "osm",
        region: SAMPLE_REGION,
        dataVersion: SAMPLE_DATA_VERSION,
      });

      // 2. Deterministic key — NO wall-clock (contract pin).
      const key = `lake/poi/${SAMPLE_REGION}/v${SAMPLE_DATA_VERSION}.ndjson.gz`;
      const obj = await bucket.get(key);
      expect(obj, `lake object missing at ${key}`).not.toBeNull();

      // 3. Decompress in the test (DuckDB-over-gz is awkward; gunzip first).
      const gz = new Uint8Array(await obj!.arrayBuffer());
      const ndjson = gunzipSync(gz).toString("utf8");

      // 4. Land the plain NDJSON for DuckDB to read.
      await writeFile(ndjsonPath, ndjson, "utf8");
    });

    afterEach(async () => {
      await rm(workDir, { recursive: true, force: true });
    });

    it("reads every record line back via read_json", async () => {
      const instance = await DuckDBInstance.create();
      const connection = await instance.connect();
      try {
        const reader = await connection.runAndReadAll(
          `select count(*) as n from read_json('${ndjsonPath}')`,
        );
        const [{ n }] = reader.getRowObjects();
        expect(Number(n)).toBe(sampleRecords.length); // 6
      } finally {
        connection.closeSync();
      }
    });

    it("returns expected counts per category for the region", async () => {
      const instance = await DuckDBInstance.create();
      const connection = await instance.connect();
      try {
        const reader = await connection.runAndReadAll(
          `select category, count(*) as n
             from read_json('${ndjsonPath}')
            where subject = 'poi'
            group by category
            order by category`,
        );
        const got = Object.fromEntries(
          reader
            .getRowObjects()
            .map((r) => [String(r.category), Number(r.n)]),
        );
        expect(got).toEqual(expectedCategoryCounts); // {restaurant:3,cafe:2,hotel:1}
      } finally {
        connection.closeSync();
      }
    });

    it("preserves the stamped data_version on every row", async () => {
      const instance = await DuckDBInstance.create();
      const connection = await instance.connect();
      try {
        const reader = await connection.runAndReadAll(
          `select distinct data_version from read_json('${ndjsonPath}')`,
        );
        const versions = reader
          .getRowObjects()
          .map((r) => Number(r.data_version));
        expect(versions).toEqual([SAMPLE_DATA_VERSION]); // [7]
      } finally {
        connection.closeSync();
      }
    });
  });
  ```
  Run (expected FAIL — `@duckdb/node-api` is installed but the test references the fixtures wired in this task; confirm it fails for the *intended* reason, e.g. an assertion or a not-yet-resolved import, NOT a missing-dependency crash):
  ```bash
  pnpm --filter @travel/data-pipeline exec vitest run test/analytics-smoke.test.ts
  ```
  Expected: the run executes and **fails** (red) — if the LakeWriter key scheme or the count assertions are off, you will see the mismatch here. (If it unexpectedly passes on first run, that is acceptable since this exercises pre-existing real code; proceed to Step 5 to confirm green.)

- [ ] **Step 5: Confirm green and lock the smoke in.**
  Run the focused test, then the package's whole suite to ensure no regression:
  ```bash
  pnpm --filter @travel/data-pipeline exec vitest run test/analytics-smoke.test.ts
  ```
  Expected: PASS — 3 tests (`reads every record line back`, `returns expected counts per category`, `preserves the stamped data_version`).
  Then:
  ```bash
  pnpm --filter @travel/data-pipeline exec vitest run
  ```
  Expected: the full `@travel/data-pipeline` suite passes, including this file.
  If a count is wrong, the failure is real signal: confirm `NdjsonR2LakeWriter` writes the deterministic key `lake/poi/penang/v7.ndjson.gz` and one `toNdjsonLine` per record — do **not** weaken the assertions to make them pass.
  Commit:
  ```bash
  git add apps/data-pipeline/test/analytics-smoke.test.ts
  git commit -m "test(data-pipeline): DuckDB analytics smoke over lake NDJSON.gz (spec §11)

Drives NdjsonR2LakeWriter -> R2 stub, gunzips the deterministic
lake/poi/penang/v7.ndjson.gz blob, and asserts per-category/region
counts via DuckDB read_json.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```
