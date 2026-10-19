import {
  BushMeshCompressionProfile,
  compareDictionaryCompression,
  encodeSemanticMessage,
  tryParseSemanticText,
} from '../protocol';

export type BushMeshSpeechRecognitionResult = {
  text: string;
  confidence?: number;
};

export type BushMeshSpeechRecognizer = {
  recognizeOnce: () => Promise<BushMeshSpeechRecognitionResult>;
};

export type BushMeshSpeechSynthesizer = {
  speak: (text: string) => Promise<void>;
  stop?: () => Promise<void> | void;
};

export type BushMeshVoiceTextSender = {
  sendText: (
    channelIndex: number,
    text: string,
    destinationNodeId?: number,
  ) => Promise<unknown>;
};

export type BushMeshVoiceEncodingPreview = {
  transcript: string;
  suggestedProfile: BushMeshCompressionProfile;
  rawBytes: number;
  encodedPayloadBytes: number;
  semantic: boolean;
};

export class BushMeshVoicePipeline {
  constructor(
    private readonly recognizer: BushMeshSpeechRecognizer,
    private readonly synthesizer: BushMeshSpeechSynthesizer,
    private readonly sender: BushMeshVoiceTextSender,
  ) {}

  preview(text: string): BushMeshVoiceEncodingPreview {
    const transcript = text.trim();
    const dictionary = compareDictionaryCompression(transcript);
    const semantic = tryParseSemanticText(transcript);

    if (semantic) {
      const semanticBytes = encodeSemanticMessage(semantic);
      const bestTextBytes = dictionary.useDictionary
        ? dictionary.dictionaryBytes.length
        : dictionary.rawBytes.length;

      if (semanticBytes.length < bestTextBytes) {
        return {
          transcript,
          suggestedProfile: BushMeshCompressionProfile.Semantic,
          rawBytes: dictionary.rawBytes.length,
          encodedPayloadBytes: semanticBytes.length,
          semantic: true,
        };
      }
    }

    if (dictionary.useDictionary) {
      return {
        transcript,
        suggestedProfile: BushMeshCompressionProfile.TextDictionary,
        rawBytes: dictionary.rawBytes.length,
        encodedPayloadBytes: dictionary.dictionaryBytes.length,
        semantic: false,
      };
    }

    return {
      transcript,
      suggestedProfile: BushMeshCompressionProfile.Raw,
      rawBytes: dictionary.rawBytes.length,
      encodedPayloadBytes: dictionary.rawBytes.length,
      semantic: false,
    };
  }

  async captureAndSend(
    channelIndex: number,
    destinationNodeId?: number,
  ): Promise<{
    recognition: BushMeshSpeechRecognitionResult;
    preview: BushMeshVoiceEncodingPreview;
  }> {
    const recognition = await this.recognizer.recognizeOnce();
    const text = recognition.text.trim();

    if (!text) {
      throw new Error('Speech recognition returned an empty transcript.');
    }

    const preview = this.preview(text);
    await this.sender.sendText(channelIndex, text, destinationNodeId);
    return {recognition: {...recognition, text}, preview};
  }

  async speakReceived(
    text: string,
    options?: {senderLabel?: string},
  ): Promise<void> {
    const cleanText = text.trim();
    if (!cleanText) {
      return;
    }

    const spoken = options?.senderLabel
      ? `${options.senderLabel} says: ${cleanText}`
      : cleanText;
    await this.synthesizer.speak(spoken);
  }

  async stopSpeaking(): Promise<void> {
    await this.synthesizer.stop?.();
  }
}
