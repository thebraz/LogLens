import { createHash } from 'node:crypto';
import { AppError, addCount, limits } from '../contracts/model.js';
import type { Line } from '../contracts/model.js';

export interface ReadProgress { bytesRead: number; physicalLines: number }

export async function* frameLines(chunks: AsyncIterable<Uint8Array>, progress: ReadProgress, signal: AbortSignal, run?: { bytesRead: number }): AsyncGenerator<Line> {
  let retained = Buffer.allocUnsafe(1024); let retainedBytes = 0; let contentBytes = 0; let start = 0;
  let lastByte = -1; let hash = createHash('sha256'); let oversized = false;
  let invalid = false; let decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let first: number[] = [];
  const consume = (bytes: Buffer): void => {
    hash.update(bytes);
    contentBytes = addCount(contentBytes, bytes.length);
    try { decoder.decode(bytes, { stream: true }); } catch { invalid = true; decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }); }
    if (contentBytes > limits.line + 1 && !oversized) {
      oversized = true; retained = Buffer.from(retained.subarray(0, Math.min(retainedBytes, limits.prefix)));
      retainedBytes = Math.min(retainedBytes, limits.prefix);
    }
    const cap = oversized ? limits.prefix : limits.line + 1;
    const take = Math.min(bytes.length, cap - retainedBytes);
    if (take > 0) {
      if (retainedBytes + take > retained.length) {
        const expanded = Buffer.allocUnsafe(Math.min(cap, Math.max(retainedBytes + take, retained.length * 2)));
        retained.copy(expanded, 0, 0, retainedBytes); retained = expanded;
      }
      bytes.copy(retained, retainedBytes, 0, take); retainedBytes += take;
    }
    if (bytes.length) lastByte = bytes[bytes.length - 1] ?? -1;
  };
  const finish = (separator: boolean): Line => {
    try { decoder.decode(); } catch { invalid = true; }
    const crlf = separator && lastByte === 13;
    const actualContent = contentBytes - (crlf ? 1 : 0);
    const complete = actualContent <= limits.line;
    let buffer = retained.subarray(0, retainedBytes);
    if (!complete) buffer = buffer.subarray(0, limits.prefix);
    else if (crlf) buffer = buffer.subarray(0, buffer.length - 1);
    // A capped prefix may end inside a valid UTF-8 character; omit that partial character.
    if (!complete) {
      for (let drop = 0; drop < 4; drop++) {
        try { new TextDecoder('utf-8', { fatal: true }).decode(buffer); break; }
        catch { if (invalid) break; buffer = buffer.subarray(0, buffer.length - 1); }
      }
    }
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(buffer);
    const lineNumber = addCount(progress.physicalLines); progress.physicalLines = lineNumber;
    const end = addCount(start, contentBytes + (separator ? 1 : 0));
    const line: Line = {
      text: start === 0 && text.startsWith('\uFEFF') ? text.slice(1) : text,
      position: { lineStart: lineNumber, lineEnd: lineNumber, byteStart: start, byteEnd: end },
      byteLength: end - start, sha256: hash.digest('hex'), complete, invalidUtf8: invalid
    };
    if (complete) line.bytes = separator ? Buffer.concat([retained.subarray(0, retainedBytes), Buffer.from([10])]) : Buffer.from(retained.subarray(0, retainedBytes));
    retainedBytes = 0; contentBytes = 0; start = end; lastByte = -1;
    oversized = false; invalid = false; hash = createHash('sha256'); decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    return line;
  };
  try { for await (const input of chunks) {
    signal.throwIfAborted();
    const chunk = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    progress.bytesRead = addCount(progress.bytesRead, chunk.length);
    if (run) { run.bytesRead = addCount(run.bytesRead, chunk.length); if (run.bytesRead > limits.runBytes) throw new AppError('RUN_BYTE_LIMIT'); }
    if (progress.bytesRead > limits.sourceBytes) throw new AppError('SOURCE_BYTE_LIMIT');
    // Only a four-byte probe is retained before encoding/gzip recognition, even for one-byte chunks.
    let offset = 0;
    if (first.length < 4) {
      while (first.length < 4 && offset < chunk.length) { first.push(chunk[offset] ?? 0); offset++; }
      if (first.length >= 2) {
        if ((first[0] === 255 && first[1] === 254) || (first[0] === 254 && first[1] === 255)) throw new AppError('UNSUPPORTED_ENCODING');
      }
      if (first.length < 4) continue;
      if (first[0] === 0 && first[1] === 0 && first[2] === 254 && first[3] === 255) throw new AppError('UNSUPPORTED_ENCODING');
      const probe = Buffer.from(first); first = [0, 0, 0, 0, 0];
      for (let p = 0; p < probe.length; p++) {
        if (probe[p] === 10) { hash.update(Buffer.from([10])); yield finish(true); }
        else consume(probe.subarray(p, p + 1));
      }
    }
    while (offset < chunk.length) {
      signal.throwIfAborted();
      const newline = chunk.indexOf(10, offset);
      if (newline < 0) { consume(chunk.subarray(offset)); break; }
      consume(chunk.subarray(offset, newline)); hash.update(Buffer.from([10])); yield finish(true); offset = newline + 1;
    }
  } } catch (error) {
    if (error instanceof AppError && error.consumedBytes > 0) {
      progress.bytesRead = addCount(progress.bytesRead, error.consumedBytes);
      if (run) run.bytesRead = addCount(run.bytesRead, error.consumedBytes);
      if (progress.bytesRead > limits.sourceBytes) error = new AppError('SOURCE_BYTE_LIMIT');
      if (run && run.bytesRead > limits.runBytes) error = new AppError('RUN_BYTE_LIMIT');
    }
    if (!signal.aborted && error instanceof AppError &&
      (error.code === 'SOURCE_TRUNCATED' || error.code === 'INPUT_READ' || error.code === 'INPUT_PERMISSION' || error.code === 'SOURCE_BYTE_LIMIT' || error.code === 'GZIP_INVALID' || error.code === 'GZIP_RATIO_LIMIT' || error.code === 'RUN_BYTE_LIMIT')) {
      if (first.length > 0 && first.length < 4) for (const byte of first) {
        if (byte === 10) { hash.update(Buffer.from([10])); yield finish(true); }
        else consume(Buffer.from([byte]));
      }
      if (contentBytes > 0) yield { ...finish(false), sourceTruncated: true };
    }
    throw error;
  }
  signal.throwIfAborted();
  if (first.length > 0 && first.length < 4) {
    for (const byte of first) {
      if (byte === 10) { hash.update(Buffer.from([10])); yield finish(true); }
      else consume(Buffer.from([byte]));
    }
  }
  if (contentBytes > 0) yield finish(false);
}
