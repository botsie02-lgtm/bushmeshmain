import {useCallback, useEffect, useRef, useState} from 'react';
import {DeviceEventEmitter, findNodeHandle, Keyboard, NativeModules, Platform, type LayoutChangeEvent, type View} from 'react-native';

type Geometry = {tag: number; visible: boolean; overlap: number};
const CLOSED = {visible: false, overlap: 0};

/** Bounded accessory area leaves the editable row outside its scroll region. */
export function radioComposerKeyboardBudget(height: number, overlap: number) {
  const available = Math.max(0, height - overlap);
  return {
    accessoryMaxHeight: Math.floor(available * 0.30),
    inputMaxHeight: Math.max(50, Math.min(96, Math.floor(available * 0.24))),
  };
}

export function useRadioImeLayout(visible: boolean) {
  const viewRef = useRef<View>(null);
  const [tag, setTag] = useState<number | null>(null);
  const [height, setHeight] = useState(0);
  const [geometry, setGeometry] = useState(CLOSED);
  const native = NativeModules.BushMeshRadioIme as {watch: (id: number) => void; unwatch: (id: number) => void} | undefined;
  const modern = Platform.OS === 'android' && Number(Platform.Version) >= 30 && !!native;

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setHeight(event.nativeEvent.layout.height);
    if (modern && viewRef.current) setTag(findNodeHandle(viewRef.current));
  }, [modern]);

  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return;
    if (modern && native) {
      if (tag === null) return;
      const subscription = DeviceEventEmitter.addListener('BushMeshRadioImeGeometry', (value: Geometry) => {
        if (value.tag !== tag || typeof value.visible !== 'boolean' ||
            !Number.isFinite(value.overlap) || value.overlap < 0) return;
        setGeometry({visible: value.visible, overlap: value.visible ? value.overlap : 0});
      });
      native.watch(tag);
      return () => {subscription.remove(); native.unwatch(tag); setGeometry(CLOSED);};
    }
    // Older Android relies on the existing adjustResize. Never add an
    // estimated keyboard height on top of a system-resized window.
    const show = Keyboard.addListener('keyboardDidShow', () => setGeometry({visible: true, overlap: 0}));
    const hide = Keyboard.addListener('keyboardDidHide', () => setGeometry(CLOSED));
    setGeometry({visible: Keyboard.isVisible(), overlap: 0});
    return () => {show.remove(); hide.remove(); setGeometry(CLOSED);};
  }, [visible, modern, native, tag]);

  const keyboardOpen = visible && Platform.OS === 'android' && geometry.visible;
  const overlap = keyboardOpen ? Math.min(height, geometry.overlap) : 0;
  return {viewRef, onLayout, keyboardOpen, overlap,
    ...radioComposerKeyboardBudget(height, overlap)};
}
