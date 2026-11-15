import { describe, expect, it } from 'vitest';
import { buildIcs } from '../src/api';

describe('buildIcs', () => {
  it('produces a calendar event with the join link and escaped text', () => {
    const ics = buildIcs({
      code: 'abc-defg-hij',
      title: 'Plan, review; ship',
      description: 'Line one\nLine two',
      scheduledStart: '2026-01-05T15:00:00.000Z',
      durationMinutes: 45,
      joinUrl: 'https://mingle.example/m/abc-defg-hij',
    });
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('DTSTART:20260105T150000Z');
    expect(ics).toContain('DTEND:20260105T154500Z');
    expect(ics).toContain(String.raw`SUMMARY:Plan\, review\; ship`);
    expect(ics).toContain('Line one\\nLine two');
    expect(ics).toContain('URL:https://mingle.example/m/abc-defg-hij');
    expect(ics.split('\r\n').length).toBeGreaterThan(10);
  });
});
