class BleManager {
  startDeviceScan() {}
  stopDeviceScan() {}
  connectToDevice() {
    return Promise.reject(new Error('BLE is mocked in Jest.'));
  }
  cancelDeviceConnection() {
    return Promise.resolve();
  }
  monitorCharacteristicForDevice() {
    return {remove() {}};
  }
  writeCharacteristicWithResponseForDevice() {
    return Promise.resolve({});
  }
  destroy() {}
}

class Device {}

module.exports = {
  BleManager,
  Device,
};
