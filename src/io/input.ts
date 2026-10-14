import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { AppError, addCount, limits } from '../contracts/model.js';
import { openInput, inputError } from './paths.js';

async function* readRaw(target: string, stdin: Readable, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  if (signal.aborted) { if (target === '-') stdin.destroy(); throw new AppError('INTERRUPTED'); }
  if (target === '-') {
    const abort = () => stdin.destroy(new AppError('INTERRUPTED'));
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      for await (const chunk of stdin) {
        signal.throwIfAborted();
        if (!(chunk instanceof Uint8Array)) throw new AppError('INPUT_READ');
        // Custom injected readers can deliver larger chunks; the downstream contract stays bounded.
        for (let offset = 0; offset < chunk.length; offset += limits.chunk) yield chunk.subarray(offset, offset + limits.chunk);
      }
    } catch (error) { if (signal.aborted) throw new AppError('INTERRUPTED'); throw inputError(error); }
    finally { signal.removeEventListener('abort', abort); }
    return;
  }
  const { handle, size } = await openInput(target);
  try {
    let position = 0;
    while (position < size) {
      signal.throwIfAborted();
      const buffer = Buffer.allocUnsafe(Math.min(limits.chunk, size - position));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) throw new AppError('SOURCE_TRUNCATED');
      position += bytesRead; yield buffer.subarray(0, bytesRead);
    }
  } catch (error) { if (signal.aborted) throw new AppError('INTERRUPTED'); throw inputError(error); }
  finally { await handle.close(); }
}

export async function* readInput(target: string, stdin: Readable, signal: AbortSignal,
  encodedRun?: { bytesRead: number }, compressedLimit: number = limits.sourceBytes): AsyncGenerator<Uint8Array> {
  const local = new AbortController();
  const iterator = readRaw(target, stdin, AbortSignal.any([signal, local.signal]));
  const probe: Uint8Array[] = []; let length = 0;
  try {
    while (length < 2) { const next = await iterator.next(); if (next.done) break; probe.push(next.value); length += next.value.length; }
    const first = Buffer.concat(probe);
    const gzip = first[0] === 31 && first[1] === 139;
    if (!gzip && target !== '-' && target.toLowerCase().endsWith('.gz')) throw new AppError('GZIP_INVALID');
    if (!gzip) { for (let offset = 0; offset < first.length; offset += limits.chunk) yield first.subarray(offset, offset + limits.chunk); yield* iterator; return; }
    let compressedBytes = 0;
    const accountCompressed = (bytes: number) => {
      compressedBytes = addCount(compressedBytes, bytes);
      if (encodedRun) {
        encodedRun.bytesRead = addCount(encodedRun.bytesRead, bytes);
        if (encodedRun.bytesRead > limits.runBytes) throw new AppError('RUN_BYTE_LIMIT');
      }
      if (compressedBytes > compressedLimit) throw new AppError('SOURCE_BYTE_LIMIT');
    };
    async function* compressed() {
      accountCompressed(first.length); yield first;
      for await (const chunk of iterator) { accountCompressed(chunk.length); yield chunk; }
    }
    const input = Readable.from(compressed(), { objectMode: false, highWaterMark: limits.chunk });
    const unzip = createGunzip({ chunkSize: limits.chunk });
    let failure: unknown = null; let decompressed = 0;
    const pumping = pipeline(input, unzip, { signal }).catch((error: unknown) => { failure = error; });
    try {
      for await (const chunk of unzip) {
        if (!(chunk instanceof Uint8Array)) throw new AppError('GZIP_INVALID');
        decompressed += chunk.length;
        if (decompressed > limits.line && decompressed > unzip.bytesWritten * 200) throw new AppError('GZIP_RATIO_LIMIT', chunk.length);
        yield chunk;
      }
      await pumping; if (failure !== null) throw failure;
      // zlib accepts trailing zero padding; V1 requires every compressed byte to belong to a gzip member.
      if (unzip.bytesWritten !== compressedBytes) throw new AppError('GZIP_INVALID');
    } catch (error) {
      if (signal.aborted) throw new AppError('INTERRUPTED');
      if (error instanceof AppError) throw error;
      throw new AppError('GZIP_INVALID');
    } finally { local.abort(); input.destroy(); unzip.destroy(); await pumping; }
  } finally { local.abort(); await iterator.return(undefined); }
}
