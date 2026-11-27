import {radioComposerKeyboardBudget} from '../src/screens/radioMessenger/useRadioImeLayout';

test('composer accessory budget uses remaining viewport, not full keyboard height', () => {
  expect(radioComposerKeyboardBudget(700, 350)).toEqual({accessoryMaxHeight: 105, inputMaxHeight: 84});
  expect(radioComposerKeyboardBudget(350, 0)).toEqual({accessoryMaxHeight: 105, inputMaxHeight: 84});
});

test('small viewport keeps an editable touch target and bounds the accessory scroll area', () => {
  expect(radioComposerKeyboardBudget(180, 60)).toEqual({accessoryMaxHeight: 36, inputMaxHeight: 50});
  expect(radioComposerKeyboardBudget(800, 0).inputMaxHeight).toBe(96);
});
