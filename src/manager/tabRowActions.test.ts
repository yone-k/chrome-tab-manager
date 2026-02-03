import { describe, expect, it, vi } from 'vitest';

import { createTabRowActions } from './tabRowActions';

describe('createTabRowActions', () => {
  it('opens when the row is clicked', () => {
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    const actions = createTabRowActions({ onOpen, onRemove });
    const item = { id: 1 };

    actions.handleRowClick(item)();

    expect(onOpen).toHaveBeenCalledWith(item);
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('stops propagation and removes when remove is clicked', () => {
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    const actions = createTabRowActions({ onOpen, onRemove });
    const item = { id: 1 };
    const stopPropagation = vi.fn();

    actions.handleRemoveClick(item)({ stopPropagation });

    expect(stopPropagation).toHaveBeenCalled();
    expect(onRemove).toHaveBeenCalledWith(item);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens on Enter or Space keydown', () => {
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    const actions = createTabRowActions({ onOpen, onRemove });
    const item = { id: 1 };
    const preventDefault = vi.fn();

    actions.handleRowKeyDown(item)({ key: 'Enter', preventDefault });
    actions.handleRowKeyDown(item)({ key: ' ', preventDefault });
    actions.handleRowKeyDown(item)({ key: 'Escape', preventDefault });

    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(onRemove).not.toHaveBeenCalled();
  });
});
