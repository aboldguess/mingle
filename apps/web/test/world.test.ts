import { describe, expect, it } from 'vitest';
import { blocked, groundAt, STAGE, zoneAt, type Box } from '../src/world/venue';

const wall: Box = { minX: 5, maxX: 6, minZ: -10, maxZ: 10, top: 100 };
const step: Box = { minX: -2, maxX: 2, minZ: 0, maxZ: 1, top: 0.5 };

describe('venue physics', () => {
  it('blocks walls but lets you step onto low things', () => {
    expect(blocked([wall], 4.8, 0, 0, 0.35, 0.6)).toBe(true);
    expect(blocked([wall], 4.5, 0, 0, 0.35, 0.6)).toBe(false);
    expect(blocked([step], 0, 0.5, 0, 0.35, 0.6)).toBe(false);
    expect(groundAt([step], 0, 0.5, 0, 0.35, 0.6)).toBe(0.5);
  });

  it('does not let you climb things taller than a step', () => {
    const table: Box = { minX: -1, maxX: 1, minZ: -1, maxZ: 1, top: 1.1 };
    expect(blocked([table], 0, 1.2, 0, 0.35, 0.6)).toBe(true);
    // ...unless you jumped high enough to land on it.
    expect(blocked([table], 0, 1.2, 0.6, 0.35, 0.6)).toBe(false);
    expect(groundAt([table], 0, 0, 0.6, 0.35, 0.6)).toBe(1.1);
  });

  it('knows the lobby, auditorium and stage apart', () => {
    expect(zoneAt(0, 10, 0)).toBe('lobby');
    expect(zoneAt(0, -10, 0)).toBe('auditorium');
    expect(zoneAt(0, -28, STAGE.top)).toBe('stage');
    // Standing in front of the stage at floor level is not presenting.
    expect(zoneAt(0, -28, 0)).toBe('auditorium');
  });
});
