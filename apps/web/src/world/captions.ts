/**
 * Live captions of your own speech using the browser's speech recognition
 * (Chrome and Edge). Finished phrases are handed to `onPhrase`, which shares
 * them as a caption bubble and a line in the chat for everyone nearby.
 */

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const captionsSupported = () => ctor() !== null;

export class Captioner {
  private rec: Recognition | null = null;
  private running = false;

  constructor(
    private onPhrase: (text: string) => void,
    private onError: (message: string) => void,
  ) {}

  start() {
    const Ctor = ctor();
    if (!Ctor) return this.onError('Live captions need Chrome or Edge.');
    if (this.running) return;
    this.running = true;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = navigator.language || 'en-GB';
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        const text = r[0].transcript.trim();
        if (r.isFinal && text) this.onPhrase(text);
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.running = false;
        this.onError('Captions need microphone permission.');
      }
    };
    // Recognition stops by itself after a pause; keep it going while enabled.
    rec.onend = () => {
      if (this.running) setTimeout(() => this.running && this.rec === rec && rec.start(), 250);
    };
    this.rec = rec;
    try {
      rec.start();
    } catch {
      /* already started */
    }
  }

  stop() {
    this.running = false;
    this.rec?.stop();
    this.rec = null;
  }
}
