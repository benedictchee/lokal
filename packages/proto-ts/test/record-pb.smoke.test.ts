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
