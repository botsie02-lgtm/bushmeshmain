/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

jest.mock('react-native-ble-plx', () => ({
  BleManager: jest.fn().mockImplementation(() => ({
    startDeviceScan: jest.fn(),
    stopDeviceScan: jest.fn(),
    connectToDevice: jest.fn(),
    discoverAllServicesAndCharacteristicsForDevice: jest.fn(),
    monitorCharacteristicForDevice: jest.fn(),
    writeCharacteristicWithResponseForDevice: jest.fn(),
    destroy: jest.fn(),
  })),
}));

import App from '../App';

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});
