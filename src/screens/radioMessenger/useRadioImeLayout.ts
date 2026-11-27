import {useCallback, useEffect, useRef, useState} from 'react';
import {DeviceEventEmitter, findNodeHandle, Keyboard, NativeModules, Platform, type LayoutChangeEvent, type View} from 'react-native';

type Geometry = {tag: number; session: number; visible: boolean; overlap: number};
let nextSession = 0;

/** Native callbacks may arrive after a room is hidden, remounted or rewatched. */
export function acceptsRadioImeGeometry(value: Geometry, tag: number, session: number, currentSession: number | null): boolean {
  return value.tag === tag && value.session === session && currentSession === session &&
    typeof value.visible === 'boolean' && Number.isFinite(value.overlap) && value.overlap >= 0;
}
type NativeIme = {
  watch: (tag: number, session: number) => void;
  unwatch: (tag: number, session: number) => void;
  reopenFocusedInput: (tag: number, session: number, inputTag: number) => void;
  reportLayout: (tag: number, session: number, visible: boolean, padding: number, height: number) => void;
};
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
  const sessionRef = useRef<number | null>(null);
  const native = NativeModules.BushMeshRadioIme as NativeIme | undefined;
  const modern = Platform.OS === 'android' && Number(Platform.Version) >= 30 && !!native;

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setHeight(event.nativeEvent.layout.height);
    if (modern && viewRef.current) setTag(findNodeHandle(viewRef.current));
  }, [modern]);

  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return;
    if (modern && native) {
      if (tag === null) return;
      const session = ++nextSession;
      sessionRef.current = session;
      const subscription = DeviceEventEmitter.addListener('BushMeshRadioImeGeometry', (value: Geometry) => {
        if (!acceptsRadioImeGeometry(value, tag, session, sessionRef.current)) return;
        const next = {visible: value.visible, overlap: value.visible ? value.overlap : 0};
        setGeometry(current => current.visible === next.visible && current.overlap === next.overlap ? current : next);
      });
      native.watch(tag, session);
      return () => {
        sessionRef.current = null;
        subscription.remove();
        native.unwatch(tag, session);
        setGeometry(CLOSED);
      };
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
  useEffect(() => {
    const session = sessionRef.current;
    if (visible && modern && native && tag !== null && session !== null) {
      native.reportLayout(tag, session, keyboardOpen, overlap, height);
    }
  }, [visible, modern, native, tag, keyboardOpen, overlap, height]);

  const reopenFocusedInput = useCallback((inputTag: number | null) => {
    const session = sessionRef.current;
    if (visible && modern && native && tag !== null && session !== null && inputTag !== null) {
      native.reopenFocusedInput(tag, session, inputTag);
    }
  }, [visible, modern, native, tag]);
  return {viewRef, onLayout, keyboardOpen, overlap, reopenFocusedInput,
    ...radioComposerKeyboardBudget(height, overlap)};
}
