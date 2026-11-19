import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HttpError } from '../lib/errors.js';

export const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
export const MAX_DECK_BYTES = 40 * 1024 * 1024;
const TIMEOUT_MS = 90_000;

/** Only one conversion at a time per server: LibreOffice is heavy and single-profile. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Convert a PowerPoint deck to PDF with headless LibreOffice. Each run gets a
 * throwaway profile and working folder, macros stay disabled (LibreOffice's
 * default for headless conversion) and the process is killed if it hangs.
 */
export function convertDeckToPdf(deck: Buffer, soffice = 'soffice'): Promise<Buffer> {
  // Office files are zip archives (PK..); legacy .ppt is an OLE compound file.
  const zip = deck[0] === 0x50 && deck[1] === 0x4b;
  const ole = deck.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
  if (!zip && !ole) return Promise.reject(new HttpError(400, 'not_a_deck', 'That file is not a PowerPoint deck'));
  const run = queue.then(() => convert(deck, zip ? 'pptx' : 'ppt', soffice));
  queue = run.catch(() => {});
  return run;
}

async function convert(deck: Buffer, ext: string, soffice: string): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mingle-deck-'));
  try {
    const input = path.join(dir, `deck.${ext}`);
    await writeFile(input, deck);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        soffice,
        [`-env:UserInstallation=${pathToFileURL(path.join(dir, 'profile')).href}`, '--headless', '--norestore', '--nolockcheck', '--convert-to', 'pdf', '--outdir', dir, input],
        { stdio: 'ignore', env: { ...process.env, HOME: dir } },
      );
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new HttpError(504, 'conversion_timeout', 'That deck took too long to convert. Try exporting it as a PDF.'));
      }, TIMEOUT_MS);
      child.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        reject(
          err.code === 'ENOENT'
            ? new HttpError(501, 'conversion_unavailable', 'PowerPoint conversion is not installed on this server. Export your deck as a PDF and upload that instead.')
            : err,
        );
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new HttpError(422, 'conversion_failed', 'Could not read that deck. Try exporting it as a PDF.'));
      });
    });
    return await readFile(path.join(dir, 'deck.pdf'));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(422, 'conversion_failed', 'Could not read that deck. Try exporting it as a PDF.');
    throw err;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
