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
