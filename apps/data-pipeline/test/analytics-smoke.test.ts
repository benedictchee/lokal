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
      const rows = reader.getRowObjects();
      expect(rows.length).toBeGreaterThan(0);
      const n = rows[0]!["n"];
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
