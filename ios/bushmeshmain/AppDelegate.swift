import UIKit
import AVFoundation
import Speech
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

@objc(BushMeshVoice)
class BushMeshVoice: NSObject, RCTBridgeModule, AVSpeechSynthesizerDelegate {
  private let audioEngine = AVAudioEngine()
  private let synthesizer = AVSpeechSynthesizer()
  private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
  private var recognitionTask: SFSpeechRecognitionTask?
  private var recognitionResolve: RCTPromiseResolveBlock?
  private var recognitionReject: RCTPromiseRejectBlock?

  override init() {
    super.init()
    synthesizer.delegate = self
  }

  static func moduleName() -> String! {
    return "BushMeshVoice"
  }

  static func requiresMainQueueSetup() -> Bool {
    return true
  }

  @objc(recognizeOnce:rejecter:)
  func recognizeOnce(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      guard self.recognitionTask == nil else {
        reject("VOICE_BUSY", "BushMesh speech recognition is already active.", nil)
        return
      }

      self.requestPermissions { granted, message in
        DispatchQueue.main.async {
          guard granted else {
            reject("VOICE_PERMISSION", message ?? "Speech recognition permission was denied.", nil)
            return
          }

          self.beginRecognition(resolve: resolve, reject: reject)
        }
      }
    }
  }

  @objc(cancelRecognition:rejecter:)
  func cancelRecognition(
    _ resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      self.finishRecognition(
        errorCode: "VOICE_CANCELLED",
        errorMessage: "Speech recognition was cancelled."
      )
      resolve(nil)
    }
  }

  @objc(speak:resolver:rejecter:)
  func speak(
    _ text: String,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !clean.isEmpty else {
      resolve(nil)
      return
    }

    DispatchQueue.main.async {
      let utterance = AVSpeechUtterance(string: clean)
      utterance.voice = AVSpeechSynthesisVoice(language: Locale.current.identifier)
      utterance.rate = AVSpeechUtteranceDefaultSpeechRate
      self.synthesizer.stopSpeaking(at: .immediate)
      self.synthesizer.speak(utterance)
      resolve(nil)
    }
  }

  @objc(stopSpeaking:rejecter:)
  func stopSpeaking(
    _ resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      self.synthesizer.stopSpeaking(at: .immediate)
      resolve(nil)
    }
  }

  private func requestPermissions(
    completion: @escaping (Bool, String?) -> Void
  ) {
    let requestSpeechPermission: () -> Void = {
      let status = SFSpeechRecognizer.authorizationStatus()
      switch status {
      case .authorized:
        completion(true, nil)
      case .denied, .restricted:
        completion(false, "Speech recognition permission is required for BushMesh voice messaging.")
      case .notDetermined:
        SFSpeechRecognizer.requestAuthorization { nextStatus in
          completion(
            nextStatus == .authorized,
            nextStatus == .authorized
              ? nil
              : "Speech recognition permission is required for BushMesh voice messaging."
          )
        }
      @unknown default:
        completion(false, "Speech recognition permission is unavailable.")
      }
    }

    AVAudioSession.sharedInstance().requestRecordPermission { granted in
      if granted {
        requestSpeechPermission()
      } else {
        completion(false, "Microphone permission is required for BushMesh speech-to-text.")
      }
    }
  }

  private func beginRecognition(
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let recognizer = SFSpeechRecognizer(locale: Locale.current), recognizer.isAvailable else {
      reject("VOICE_UNAVAILABLE", "Speech recognition is not available on this iOS device.", nil)
      return
    }

    do {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
      try session.setActive(true, options: .notifyOthersOnDeactivation)
    } catch {
      reject("VOICE_AUDIO_SESSION", "Unable to start the microphone audio session.", error)
      return
    }

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = false
    request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition

    recognitionRequest = request
    recognitionResolve = resolve
    recognitionReject = reject

    let inputNode = audioEngine.inputNode
    let format = inputNode.outputFormat(forBus: 0)
    inputNode.removeTap(onBus: 0)
    inputNode.installTap(
      onBus: 0,
      bufferSize: 1024,
      format: format
    ) { buffer, _ in
      request.append(buffer)
    }

    audioEngine.prepare()

    do {
      try audioEngine.start()
    } catch {
      cleanupRecognitionAudio()
      recognitionResolve = nil
      recognitionReject = nil
      reject("VOICE_AUDIO_START", "Unable to start microphone capture.", error)
      return
    }

    recognitionTask = recognizer.recognitionTask(with: request) { result, error in
      if let result = result, result.isFinal {
        let transcript = result.bestTranscription.formattedString
          .trimmingCharacters(in: .whitespacesAndNewlines)

        guard !transcript.isEmpty else {
          self.finishRecognition(
            errorCode: "VOICE_EMPTY",
            errorMessage: "Speech recognition did not return a transcript."
          )
          return
        }

        let confidenceValues = result.bestTranscription.segments.map { $0.confidence }
        let confidence: Double? = confidenceValues.isEmpty
          ? nil
          : Double(confidenceValues.reduce(0, +) / Float(confidenceValues.count))
        let response: [String: Any] = confidence == nil
          ? ["text": transcript]
          : ["text": transcript, "confidence": confidence!]

        let pendingResolve = self.recognitionResolve
        self.recognitionResolve = nil
        self.recognitionReject = nil
        self.cleanupRecognitionAudio()
        pendingResolve?(response)
        return
      }

      if let error = error {
        self.finishRecognition(
          errorCode: "VOICE_RECOGNITION_ERROR",
          errorMessage: error.localizedDescription,
          underlyingError: error
        )
      }
    }
  }

  private func finishRecognition(
    errorCode: String,
    errorMessage: String,
    underlyingError: Error? = nil
  ) {
    let pendingReject = recognitionReject
    recognitionResolve = nil
    recognitionReject = nil
    cleanupRecognitionAudio()
    pendingReject?(errorCode, errorMessage, underlyingError)
  }

  private func cleanupRecognitionAudio() {
    recognitionTask?.cancel()
    recognitionTask = nil
    recognitionRequest?.endAudio()
    recognitionRequest = nil

    if audioEngine.isRunning {
      audioEngine.stop()
    }
    audioEngine.inputNode.removeTap(onBus: 0)

    do {
      try AVAudioSession.sharedInstance().setActive(
        false,
        options: .notifyOthersOnDeactivation
      )
    } catch {
      // Cleanup should never turn a completed transcript into an application error.
    }
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
