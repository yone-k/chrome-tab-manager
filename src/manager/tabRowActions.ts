type RemoveClickEvent = {
  stopPropagation: () => void;
};

type RowKeyDownEvent = {
  key: string;
  preventDefault: () => void;
};

type TabRowHandlers<T> = {
  onOpen: (item: T) => void;
  onRemove: (item: T) => void;
};

export function createTabRowActions<T>({ onOpen, onRemove }: TabRowHandlers<T>) {
  const handleRowClick = (item: T) => () => {
    onOpen(item);
  };

  const handleRowKeyDown = (item: T) => (event: RowKeyDownEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(item);
    }
  };

  const handleRemoveClick = (item: T) => (event: RemoveClickEvent) => {
    event.stopPropagation();
    onRemove(item);
  };

  return {
    handleRowClick,
    handleRowKeyDown,
    handleRemoveClick,
  };
}
