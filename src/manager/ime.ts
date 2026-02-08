type ImeAwareEnterEvent = {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
  which?: number;
  nativeEvent?: {
    isComposing?: boolean;
    keyCode?: number;
    which?: number;
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
  const which = event.which ?? event.nativeEvent?.which;

  return keyCode === 229 || which === 229;
}
