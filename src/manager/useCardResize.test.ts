import { describe, expect, it } from 'vitest';

import { clampCardHeight } from '../tab-manager/storage';

describe('clampCardHeight', () => {
  it('範囲内の値はそのまま返す', () => {
    expect(clampCardHeight(500)).toBe(500);
  });

  it('最小値未満はクランプする', () => {
    expect(clampCardHeight(100)).toBe(360);
  });

  it('最大値超はクランプする', () => {
    expect(clampCardHeight(2000)).toBe(1080);
  });

  it('小数は整数に丸める', () => {
    expect(clampCardHeight(500.4)).toBe(500);
    expect(clampCardHeight(500.5)).toBe(501);
  });

  it('非数値は null を返す', () => {
    expect(clampCardHeight('abc')).toBeNull();
    expect(clampCardHeight(undefined)).toBeNull();
    expect(clampCardHeight(null)).toBeNull();
  });

  it('NaN は null を返す', () => {
    expect(clampCardHeight(NaN)).toBeNull();
  });

  it('Infinity は null を返す', () => {
    expect(clampCardHeight(Infinity)).toBeNull();
    expect(clampCardHeight(-Infinity)).toBeNull();
  });

  it('最小値ちょうどは保持する', () => {
    expect(clampCardHeight(360)).toBe(360);
  });

  it('最大値ちょうどは保持する', () => {
    expect(clampCardHeight(1080)).toBe(1080);
  });
});
