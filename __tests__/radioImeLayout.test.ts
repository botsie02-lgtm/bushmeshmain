import {acceptsRadioImeGeometry, radioComposerKeyboardBudget} from '../src/screens/radioMessenger/useRadioImeLayout';

test('composer accessory budget uses remaining viewport, not full keyboard height', () => {
  expect(radioComposerKeyboardBudget(700, 350)).toEqual({accessoryMaxHeight: 105, inputMaxHeight: 84});
  expect(radioComposerKeyboardBudget(350, 0)).toEqual({accessoryMaxHeight: 105, inputMaxHeight: 84});
});

test('small viewport keeps an editable touch target and bounds the accessory scroll area', () => {
  expect(radioComposerKeyboardBudget(180, 60)).toEqual({accessoryMaxHeight: 36, inputMaxHeight: 50});
  expect(radioComposerKeyboardBudget(800, 0).inputMaxHeight).toBe(96);
});

test('IME geometry from a prior watch or conversation cannot alter the current room', () => {
  const event = {tag: 31, session: 4, visible: true, overlap: 200};
  expect(acceptsRadioImeGeometry(event, 31, 4, 4)).toBe(true);
  expect(acceptsRadioImeGeometry(event, 32, 4, 4)).toBe(false);
  expect(acceptsRadioImeGeometry(event, 31, 5, 5)).toBe(false);
  expect(acceptsRadioImeGeometry(event, 31, 4, null)).toBe(false);
  expect(acceptsRadioImeGeometry({...event, overlap: NaN}, 31, 4, 4)).toBe(false);
  expect(acceptsRadioImeGeometry({...event, overlap: -1}, 31, 4, 4)).toBe(false);
});
