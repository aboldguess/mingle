import { describe, expect, it } from 'vitest';
import { cropFor, HEAD_FREE, HEAD_MAX, stepBodyYaw, type TurnState, wrapAngle } from '../src/world/avatar';
import { PODIUM, PRESENTER_SPOT, STAGE, STAGE_APRON, zoneAt } from '../src/world/venue';

const run = (body: number, look: number, seconds: number, speed = 0, s: TurnState = { held: 0, catching: false }) => {
  for (let t = 0; t < seconds; t += 1 / 60) body = stepBodyYaw(body, look, speed, 1 / 60, s);
  return body;
};

describe('head and body turning', () => {
  it('lets a small glance or head shake move the head only', () => {
    const s = { held: 0, catching: false };
    let body = 0;
    for (let i = 0; i < 120; i++) body = stepBodyYaw(body, Math.sin(i / 6) * (HEAD_FREE - 0.05), 0, 1 / 60, s);
    expect(body).toBe(0);
  });

  it('has the body catch up after a longer look to the side', () => {
    expect(Math.abs(run(0, 0.9, 0.2))).toBeLessThan(0.01); // not straight away
    expect(run(0, 0.9, 2)).toBeCloseTo(0.9, 1); // but soon
  });

  it('never twists the neck past its limit', () => {
    const body = stepBodyYaw(0, 2.5, 0, 1 / 60, { held: 0, catching: false });
    expect(Math.abs(wrapAngle(2.5 - body))).toBeLessThanOrEqual(HEAD_MAX + 1e-9);
  });

  it('turns the body with you when walking', () => {
    expect(run(0, 0.3, 0.5, 4)).toBeCloseTo(0.3, 2);
  });

  it('turns the short way round across ±π', () => {
    const s = { held: 0, catching: false };
    let body = 2.8;
    for (let t = 0; t < 3; t += 1 / 60) {
      body = stepBodyYaw(body, -2.8, 0, 1 / 60, s);
      expect(Math.abs(body)).toBeGreaterThan(2.5); // never swings through the front
    }
    expect(Math.abs(wrapAngle(body - -2.8))).toBeLessThan(0.05);
  });
});

describe('webcam framing', () => {
  it('fills a 4:3 telly from a 16:9 camera by cropping the sides', () => {
    const c = cropFor(16 / 9, 4 / 3, { zoom: 1, x: 0.5, y: 0.5 });
    expect(c.repeat.x).toBeCloseTo(0.75);
    expect(c.repeat.y).toBe(1);
    expect(c.offset.x).toBeCloseTo(0.125);
  });

  it('zooms in on the framed face and keeps the crop inside the picture', () => {
    const c = cropFor(4 / 3, 4 / 3, { zoom: 2, x: 0.5, y: 0.25 });
    expect(c.repeat).toEqual({ x: 0.5, y: 0.5 });
    // y is measured from the top; texture v from the bottom.
    expect(c.offset.y).toBeCloseTo(0.5);
    const edge = cropFor(4 / 3, 4 / 3, { zoom: 2, x: 0, y: 1 });
    expect(edge.offset).toEqual({ x: 0, y: 0 });
  });
});

describe('podium', () => {
  it('puts the presenter spot on stage, right behind the podium', () => {
    expect(PRESENTER_SPOT.x).toBeGreaterThan(PODIUM.minX);
    expect(PRESENTER_SPOT.x).toBeLessThan(PODIUM.maxX);
    expect(PRESENTER_SPOT.y).toBeLessThan(PODIUM.minZ);
    expect(PODIUM.minZ - PRESENTER_SPOT.y).toBeLessThan(1);
    expect(zoneAt(PRESENTER_SPOT.x, PRESENTER_SPOT.y, STAGE.top)).toBe('stage');
  });

  it('ropes off the whole stage and its steps', () => {
    expect(STAGE_APRON.maxZ).toBeGreaterThan(STAGE.maxZ + 0.8); // steps stick out 0.8m
    expect(STAGE_APRON.maxZ).toBeLessThan(-20); // but the front row of seats stays open
  });
});
