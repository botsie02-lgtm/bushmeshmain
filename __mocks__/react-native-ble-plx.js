class BleManager {
  startDeviceScan() {}
  stopDeviceScan() {}
  connectToDevice() {
    return Promise.reject(new Error('BLE is mocked in Jest.'));
  }
  cancelDeviceConnection() {
    return Promise.resolve();
  }
  requestMTUForDevice() {
    return Promise.resolve({mtu: 185});
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
