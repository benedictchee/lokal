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
