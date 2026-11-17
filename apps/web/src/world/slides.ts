/**
 * Slide decks on the big screen. PDFs render in the browser with pdf.js;
 * PowerPoint decks are turned into PDFs by the server first.
 *
 * The deck is painted into a 1920x1080 canvas. In a live event that canvas is
 * published as the presenter's screen share, so everyone (including late
 * arrivals and the front-row view) sees exactly the presenter's slide with no
 * extra syncing.
 */

export const SLIDE_W = 1920;
export const SLIDE_H = 1080;
export const DECK_ACCEPT = '.pdf,.pptx,.ppt,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint';
const MAX_BYTES = 40 * 1024 * 1024;

type PdfDoc = import('pdfjs-dist').PDFDocumentProxy;

let pdfjsReady: Promise<typeof import('pdfjs-dist')> | null = null;
function loadPdfjs() {
  // Loaded on first use so pdf.js stays out of the main bundle.
  pdfjsReady ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  return pdfjsReady;
}

export function isPowerPoint(file: File) {
  return /\.pptx?$/i.test(file.name) || /powerpoint|presentationml/.test(file.type);
}

/** Ask the server to turn a PowerPoint deck into a PDF. */
export async function convertDeck(file: File, meetingCode?: string): Promise<ArrayBuffer> {
  const url = meetingCode ? `/api/meetings/${meetingCode}/slides/convert` : '/api/slides/convert';
  const res = await fetch(url, { method: 'POST', body: file, headers: { 'content-type': 'application/octet-stream' }, credentials: 'same-origin' });
  if (!res.ok) {
    let message = `Could not convert that deck (${res.status}). Try exporting it as a PDF.`;
    try {
      message = (await res.json()).error?.message ?? message;
    } catch {
      /* not JSON */
    }
    if (res.status === 401) message = 'Sign in to convert PowerPoint decks in the demo, or export your deck as a PDF.';
    if (res.status === 429) message = 'Too many decks converted just now. Wait a few minutes, or upload a PDF.';
    throw new Error(message);
  }
  return res.arrayBuffer();
}

export class SlideDeck {
  readonly canvas = document.createElement('canvas');
  index = 0;
  private cache = new Map<number, ImageBitmap | HTMLCanvasElement>();
  private rendering = new Map<number, Promise<ImageBitmap | HTMLCanvasElement>>();
  private disposed = false;
  onChange?: () => void;

  private constructor(
    private doc: PdfDoc,
    readonly name: string,
  ) {
    this.canvas.width = SLIDE_W;
    this.canvas.height = SLIDE_H;
  }

  /** Open a PDF or PowerPoint file. `convert` turns PowerPoint into PDF bytes. */
  static async open(file: File, convert: (f: File) => Promise<ArrayBuffer>): Promise<SlideDeck> {
    if (file.size > MAX_BYTES) throw new Error('That deck is over 40 MB. Try compressing its images or exporting a smaller PDF.');
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    if (!isPdf && !isPowerPoint(file)) throw new Error('Pick a PDF or PowerPoint (.pptx) file.');
    const [pdfjs, data] = await Promise.all([loadPdfjs(), isPdf ? file.arrayBuffer() : convert(file)]);
    const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
    if (doc.numPages < 1) throw new Error('That deck has no slides.');
    const deck = new SlideDeck(doc, file.name.replace(/\.(pdf|pptx?)$/i, ''));
    await deck.go(0);
    return deck;
  }

  get count() {
    return this.doc.numPages;
  }

  next() {
    return this.go(this.index + 1);
  }

  prev() {
    return this.go(this.index - 1);
  }

  async go(i: number) {
    const target = Math.max(0, Math.min(this.count - 1, i));
    this.index = target;
    const img = await this.render(target);
    if (this.disposed || this.index !== target) return;
    this.paint(img);
    this.onChange?.();
    // Warm up the neighbours so flicking through is instant.
    void this.render(target + 1).catch(() => {});
    void this.render(target - 1).catch(() => {});
  }

  /** Paint the current slide again (keeps a live video track ticking). */
  repaint() {
    const img = this.cache.get(this.index);
    if (img) this.paint(img);
  }

  /** A small copy of a slide, for the presenter's controls. */
  thumbnail(i = this.index): ImageBitmap | HTMLCanvasElement | undefined {
    return this.cache.get(i);
  }

  private paint(img: ImageBitmap | HTMLCanvasElement) {
    const ctx = this.canvas.getContext('2d')!;
    ctx.fillStyle = '#111317';
    ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);
    const s = Math.min(SLIDE_W / img.width, SLIDE_H / img.height);
    const w = img.width * s;
    const h = img.height * s;
    ctx.drawImage(img, (SLIDE_W - w) / 2, (SLIDE_H - h) / 2, w, h);
  }

  private render(i: number): Promise<ImageBitmap | HTMLCanvasElement> {
    if (i < 0 || i >= this.count) return Promise.reject(new Error('no such slide'));
    const done = this.cache.get(i);
    if (done) return Promise.resolve(done);
    let p = this.rendering.get(i);
    if (p) return p;
    p = (async () => {
      const page = await this.doc.getPage(i + 1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(SLIDE_W / base.width, SLIDE_H / base.height) });
      const c = document.createElement('canvas');
      c.width = Math.round(viewport.width);
      c.height = Math.round(viewport.height);
      await page.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport }).promise;
      const img = typeof createImageBitmap === 'function' ? await createImageBitmap(c) : c;
      this.cache.set(i, img);
      // Keep memory in check on long decks.
      for (const k of this.cache.keys()) if (Math.abs(k - this.index) > 6) {
        const old = this.cache.get(k);
        if (old && 'close' in old) old.close();
        this.cache.delete(k);
      }
      return img;
    })().finally(() => this.rendering.delete(i));
    this.rendering.set(i, p);
    return p;
  }

  dispose() {
    this.disposed = true;
    for (const img of this.cache.values()) if ('close' in img) img.close();
    this.cache.clear();
    void this.doc.loadingTask.destroy();
  }
}
