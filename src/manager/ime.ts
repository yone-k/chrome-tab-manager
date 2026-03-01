type ImeAwareEnterEvent = {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: {
    isComposing?: boolean;
    keyCode?: number;
  };
};

export function shouldIgnoreEnterForIme(event: ImeAwareEnterEvent) {
  if (event.key !== 'Enter') {
    return false;
  }

  if (event.isComposing || event.nativeEvent?.isComposing) {
    return true;
  }

  const keyCode = event.keyCode ?? event.nativeEvent?.keyCode;

  return keyCode === 229;
}
