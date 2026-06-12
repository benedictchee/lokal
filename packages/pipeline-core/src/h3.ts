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
