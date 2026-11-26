import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {Alert, Modal, TextInput} from 'react-native';
import {QuickMessageEditor} from '../src/radio/chatManagement/QuickMessageEditor';

jest.mock('react-native-safe-area-context', () => ({SafeAreaView: require('react-native').View}));

describe('full-screen quick message editor', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  const save = jest.fn(async (_values: string[]) => undefined);
  const close = jest.fn();
  const button = (label: string) => {
    const node = renderer.root.findAllByProps({accessibilityLabel: label}).find(n => typeof n.props.onPress === 'function');
    if (!node) throw new Error('Missing action ' + label);
    return node;
  };
  async function press(label: string) {await act(async () => {button(label).props.onPress();});}
  async function edit(index: number, text: string) {
    await act(async () => {
      const field = renderer.root.findAllByType(TextInput).find(n => n.props.accessibilityLabel === 'Template ' + index);
      if (!field) throw new Error('Missing template');
      field.props.onChangeText(text);
    });
  }
  beforeEach(async () => {
    save.mockReset(); save.mockResolvedValue(undefined); close.mockClear();
    await act(async () => {renderer = ReactTestRenderer.create(<QuickMessageEditor initial={['First', 'Second']} onSave={save} onClose={close}/>);});
  });
  afterEach(async () => {await act(async () => renderer.unmount()); jest.restoreAllMocks();});

  test('reorder, add, edit and delete are committed together only on Save', async () => {
    await press('Move up 2');
    await press('Add template');
    await edit(3, 'Third');
    await press('Delete 2');
    expect(save).not.toHaveBeenCalled();
    await press('Save');
    expect(save).toHaveBeenCalledWith(['Second', 'Third']);
    expect(close).toHaveBeenCalledTimes(1);
  });

  test('invalid UTF-8 disables Save; failed commit keeps editor open', async () => {
    await edit(1, '🚙'.repeat(34));
    expect(button('Save').props.disabled).toBe(true);
    await edit(1, '🚙'.repeat(33));
    expect(button('Save').props.disabled).toBe(false);
    save.mockRejectedValueOnce(new Error('storage unavailable'));
    await press('Save');
    expect(save).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(renderer.root.findAllByProps({accessibilityRole: 'alert'}).length).toBeGreaterThan(0);
  });

  test('Android Back asks before discarding edits and does not save', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await edit(1, 'Unsaved');
    await act(async () => renderer.root.findByType(Modal).props.onRequestClose());
    expect(close).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    const actions = alert.mock.calls[0][2];
    expect(actions?.some(b => b.text === 'Keep editing')).toBe(true);
    await act(async () => actions?.find(b => b.text === 'Discard')?.onPress?.());
    expect(close).toHaveBeenCalledTimes(1);
  });
});
