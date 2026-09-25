import { describe, it, expect } from 'vitest';
import { threeWayMerge, applyLWW, computeFieldDiff } from '../src/core/merger.js';

describe('ThreeWayMerge', () => {
  it('detects no changes when all versions are identical', () => {
    const ancestor = { title: 'Hello', status: 'draft' };
    const current = { title: 'Hello', status: 'draft' };
    const incoming = { title: 'Hello', status: 'draft' };
    const result = threeWayMerge(ancestor, current, incoming);
    expect(result.strategy).toBe('no_changes');
    expect(result.conflicts).toHaveLength(0);
    expect(result.autoMergedFields).toHaveLength(0);
  });

  it('auto-merges when only incoming changed a field', () => {
    const ancestor = { title: 'Hello', status: 'draft' };
    const current = { title: 'Hello', status: 'draft' };
    const incoming = { title: 'Hello', status: 'published' };
    const result = threeWayMerge(ancestor, current, incoming);
    expect(result.strategy).toBe('auto_merged');
    expect(result.autoMergedFields).toContain('status');
    expect(result.merged.status).toBe('published');
    expect(result.merged.title).toBe('Hello');
  });

  it('preserves current when only current changed a field', () => {
    const ancestor = { title: 'Hello', status: 'draft' };
    const current = { title: 'Updated', status: 'draft' };
    const incoming = { title: 'Hello', status: 'draft' };
    const result = threeWayMerge(ancestor, current, incoming);
    expect(result.strategy).toBe('no_changes');
    expect(result.merged.title).toBe('Updated');
  });

  it('auto-merges non-conflicting concurrent changes on different fields', () => {
    const ancestor = { title: 'Hello', status: 'draft', priority: 'low' };
    const current = { title: 'Updated Title', status: 'draft', priority: 'low' };
    const incoming = { title: 'Hello', status: 'published', priority: 'low' };
    const result = threeWayMerge(ancestor, current, incoming);
    expect(result.strategy).toBe('auto_merged');
    expect(result.merged.title).toBe('Updated Title');
    expect(result.merged.status).toBe('published');
    expect(result.autoMergedFields).toContain('status');
    expect(result.conflicts).toHaveLength(0);
  });

  it('detects true conflict when both modified the same field differently', () => {
    const ancestor = { title: 'Hello', status: 'draft' };
    const current = { title: 'Title from device A', status: 'draft' };
    const incoming = { title: 'Title from device B', status: 'draft' };
    const result = threeWayMerge(ancestor, current, incoming);
    expect(result.strategy).toBe('has_conflicts');
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].field).toBe('title');
    expect(result.conflicts[0].current).toBe('Title from device A');
    expect(result.conflicts[0].incoming).toBe('Title from device B');
  });

  it('handles mixed auto-merge and conflict', () => {
    const ancestor = { title: 'Hello', status: 'draft', notes: 'none' };
    const current = { title: 'A edit', status: 'published', notes: 'none' };
    const incoming = { title: 'B edit', status: 'draft', notes: 'updated notes' };
    const result = threeWayMerge(ancestor, current, incoming);
    expect(result.strategy).toBe('has_conflicts');
    expect(result.autoMergedFields).toContain('notes');
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].field).toBe('title');
    expect(result.merged.notes).toBe('updated notes');
  });

  it('no conflict when both make the same change', () => {
    const ancestor = { title: 'Hello' };
    const current = { title: 'Same Change' };
    const incoming = { title: 'Same Change' };
    const result = threeWayMerge(ancestor, current, incoming);
    expect(result.strategy).toBe('no_changes');
    expect(result.conflicts).toHaveLength(0);
  });

  it('handles new fields added by incoming', () => {
    const ancestor = { title: 'Hello' };
    const current = { title: 'Hello' };
    const incoming = { title: 'Hello', tags: 'important' };
    const result = threeWayMerge(ancestor, current, incoming);
    expect(result.strategy).toBe('auto_merged');
    expect(result.merged.tags).toBe('important');
  });

  it('handles field deletion by incoming', () => {
    const ancestor = { title: 'Hello', temp: 'data' };
    const current = { title: 'Hello', temp: 'data' };
    const incoming = { title: 'Hello' };
    const result = threeWayMerge(ancestor, current, incoming);
    expect(result.strategy).toBe('auto_merged');
    expect(result.merged.temp).toBeUndefined();
  });
});

describe('applyLWW', () => {
  it('applies last-write-wins on conflict fields', () => {
    const current = { title: 'A', status: 'draft' };
    const incoming = { title: 'B', status: 'published' };
    const result = applyLWW(current, incoming, ['title']);
    expect(result.title).toBe('B');
    expect(result.status).toBe('draft');
  });
});

describe('computeFieldDiff', () => {
  it('computes diff between two states', () => {
    const before = { title: 'Hello', status: 'draft' };
    const after = { title: 'Updated', status: 'draft', priority: 'high' };
    const diff = computeFieldDiff(before, after);
    expect(diff.title).toEqual({ from: 'Hello', to: 'Updated' });
    expect(diff.priority).toEqual({ from: undefined, to: 'high' });
    expect(diff.status).toBeUndefined();
  });
});
