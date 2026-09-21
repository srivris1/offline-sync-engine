export type VectorClock = Record<string, number>;

export function createClock(): VectorClock {
  return {};
}

export function increment(clock: VectorClock, deviceId: string): VectorClock {
  return { ...clock, [deviceId]: (clock[deviceId] || 0) + 1 };
}

export function merge(a: VectorClock, b: VectorClock): VectorClock {
  const result: VectorClock = { ...a };
  for (const [device, counter] of Object.entries(b)) {
    result[device] = Math.max(result[device] || 0, counter);
  }
  return result;
}

export enum CausalOrder {
  BEFORE = 'BEFORE',
  AFTER = 'AFTER',
  CONCURRENT = 'CONCURRENT',
  EQUAL = 'EQUAL',
}

export function compare(a: VectorClock, b: VectorClock): CausalOrder {
  const allDevices = new Set([...Object.keys(a), ...Object.keys(b)]);

  let aBeforeB = false;
  let bBeforeA = false;

  for (const device of allDevices) {
    const va = a[device] || 0;
    const vb = b[device] || 0;

    if (va < vb) aBeforeB = true;
    if (va > vb) bBeforeA = true;
  }

  if (!aBeforeB && !bBeforeA) return CausalOrder.EQUAL;
  if (aBeforeB && !bBeforeA) return CausalOrder.BEFORE;
  if (!aBeforeB && bBeforeA) return CausalOrder.AFTER;
  return CausalOrder.CONCURRENT;
}

export function dominates(a: VectorClock, b: VectorClock): boolean {
  return compare(a, b) === CausalOrder.AFTER;
}

export function isDescendantOf(child: VectorClock, parent: VectorClock): boolean {
  const order = compare(parent, child);
  return order === CausalOrder.BEFORE || order === CausalOrder.EQUAL;
}

export function serialize(clock: VectorClock): string {
  const sorted = Object.entries(clock).sort(([a], [b]) => a.localeCompare(b));
  return sorted.map(([d, v]) => `${d}:${v}`).join(',');
}

export function deserialize(str: string): VectorClock {
  if (!str || str.trim() === '') return {};
  const clock: VectorClock = {};
  for (const pair of str.split(',')) {
    const [device, count] = pair.split(':');
    clock[device.trim()] = parseInt(count.trim(), 10);
  }
  return clock;
}
