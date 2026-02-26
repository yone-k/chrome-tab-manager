import { describe, expect, it } from 'vitest';
import { resolveCardClassName } from './cardClass';

describe('resolveCardClassName', () => {
  it('returns base class by default', () => {
    expect(resolveCardClassName(false, false)).toBe('manager__card');
  });

  it('appends --dragging when isDragging is true', () => {
    expect(resolveCardClassName(true, false)).toBe('manager__card manager__card--dragging');
  });

  it('appends --linked when isBoundCurrent is true', () => {
    expect(resolveCardClassName(false, true)).toBe('manager__card manager__card--linked');
  });

  it('appends both --dragging and --linked when both are true', () => {
    expect(resolveCardClassName(true, true)).toBe(
      'manager__card manager__card--dragging manager__card--linked',
    );
  });
});
