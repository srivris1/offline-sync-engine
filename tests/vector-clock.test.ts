import { describe, it, expect } from 'vitest';
import { createClock, increment, merge, compare, CausalOrder, serialize, deserialize, dominates, isDescendantOf } from '../src/core/vector-clock.js';

describe('VectorClock', () => {
  it('creates an empty clock', () => {
    expect(createClock()).toEqual({});
  });

  it('increments a device counter', () => {
    const c = increment(createClock(), 'deviceA');
    expect(c).toEqual({ deviceA: 1 });
  });

  it('increments existing counter', () => {
    const c1 = increment(createClock(), 'deviceA');
    const c2 = increment(c1, 'deviceA');
    expect(c2).toEqual({ deviceA: 2 });
  });

  it('increments different devices independently', () => {
    let c = createClock();
    c = increment(c, 'a');
    c = increment(c, 'b');
    c = increment(c, 'a');
    expect(c).toEqual({ a: 2, b: 1 });
  });

  it('merges two clocks taking max of each', () => {
    const a = { d1: 3, d2: 1 };
    const b = { d1: 1, d2: 5, d3: 2 };
    expect(merge(a, b)).toEqual({ d1: 3, d2: 5, d3: 2 });
  });

  it('compares EQUAL clocks', () => {
    expect(compare({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(CausalOrder.EQUAL);
  });

  it('compares BEFORE relationship', () => {
    expect(compare({ a: 1 }, { a: 2 })).toBe(CausalOrder.BEFORE);
    expect(compare({ a: 1 }, { a: 1, b: 1 })).toBe(CausalOrder.BEFORE);
  });

  it('compares AFTER relationship', () => {
    expect(compare({ a: 2 }, { a: 1 })).toBe(CausalOrder.AFTER);
  });

  it('detects CONCURRENT clocks', () => {
    expect(compare({ a: 2, b: 1 }, { a: 1, b: 2 })).toBe(CausalOrder.CONCURRENT);
  });

  it('handles empty clocks', () => {
    expect(compare({}, {})).toBe(CausalOrder.EQUAL);
    expect(compare({}, { a: 1 })).toBe(CausalOrder.BEFORE);
  });

  it('dominates correctly', () => {
    expect(dominates({ a: 2 }, { a: 1 })).toBe(true);
    expect(dominates({ a: 1 }, { a: 2 })).toBe(false);
    expect(dominates({ a: 2, b: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('checks descendant relationship', () => {
    expect(isDescendantOf({ a: 2, b: 1 }, { a: 1 })).toBe(true);
    expect(isDescendantOf({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('serializes and deserializes', () => {
    const clock = { b: 3, a: 1 };
    const str = serialize(clock);
    expect(str).toBe('a:1,b:3');
    expect(deserialize(str)).toEqual(clock);
  });

  it('deserializes empty string', () => {
    expect(deserialize('')).toEqual({});
  });
});
