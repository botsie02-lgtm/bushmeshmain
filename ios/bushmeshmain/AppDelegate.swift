import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@objc(BushMeshStorage)
class BushMeshStorage: NSObject, RCTBridgeModule {
  private let defaults = UserDefaults.standard
  private let keyPrefix = "bushmesh.storage."

  static func moduleName() -> String! {
    return "BushMeshStorage"
  }

  static func requiresMainQueueSetup() -> Bool {
    return false
  }

  private func namespacedKey(_ key: String) -> String {
    return keyPrefix + key
  }

  @objc(getItem:resolver:rejecter:)
  func getItem(
    _ key: String,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    resolve(defaults.string(forKey: namespacedKey(key)))
  }

  @objc(setItem:value:resolver:rejecter:)
  func setItem(
    _ key: String,
    value: String,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    defaults.set(value, forKey: namespacedKey(key))
    resolve(nil)
  }

  @objc(removeItem:resolver:rejecter:)
  func removeItem(
    _ key: String,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    defaults.removeObject(forKey: namespacedKey(key))
    resolve(nil)
  }
}

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "bushmeshmain",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
