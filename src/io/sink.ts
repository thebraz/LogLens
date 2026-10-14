import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Writable } from 'node:stream';
import { AppError } from '../contracts/model.js';
import { systemCode } from './paths.js';
import { nativeOutput, writeDescriptor, syncDescriptor } from './native.js';
import type { AuditHook } from './native.js';

export async function writeStream(writer: Writable, text: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new AppError('INTERRUPTED')); };
    const fail = (error: unknown) => { cleanup(); reject(new AppError(systemCode(error) === 'EPIPE' ? 'EPIPE' : 'OUTPUT_WRITE')); };
    const closed = () => fail(new AppError('OUTPUT_WRITE'));
    const cleanup = () => {
      signal.removeEventListener('abort', abort); writer.removeListener('error', fail); writer.removeListener('close', closed);
    };
    signal.addEventListener('abort', abort, { once: true }); writer.once('error', fail); writer.once('close', closed);
    try {
      writer.write(text, 'utf8', (error?: Error | null) => {
        if (error) {
          signal.removeEventListener('abort', abort);
          // Writable emits error after its callback; keep that listener until the event arrives.
          reject(new AppError(systemCode(error) === 'EPIPE' ? 'EPIPE' : 'OUTPUT_WRITE')); return;
        }
        cleanup(); resolve();
      });
    } catch (error) { fail(error); }
  });
}
export interface FileSink { write(text: string, signal: AbortSignal): Promise<void>; commit(signal: AbortSignal): Promise<void>; discard(): Promise<void> }
export async function createFileSink(destination: string, input: string | string[], audit?: { create?: AuditHook; commit?: AuditHook; discard?: AuditHook }): Promise<FileSink> {
  const target = path.resolve(destination);
  const normalized = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
  if ((typeof input === 'string' ? [input] : input).some(value => value !== '-' && normalized(target) === normalized(path.resolve(value)))) throw new AppError('UNSAFE_OUTPUT');
  const { lease, api } = (() => {
    try { return nativeOutput(target, `.loglens-${randomUUID()}.tmp`, audit?.create); }
    catch (error) {
      const code = systemCode(error);
      throw new AppError(code === 'OUTPUT_EXISTS' ? code : code === 'NOT_AVAILABLE' ? code : 'UNSAFE_OUTPUT');
    }
  })();
  let closed = false; let committed = false;
  const close = () => {
    if (closed) return;
    try { if (audit?.discard) api.close(lease.token, audit.discard); else api.close(lease.token); }
    catch (error) { api.close(lease.token); throw error; }
    finally { closed = true; }
  };
  return {
    async write(text, signal) {
      if (closed || committed) throw new AppError('OUTPUT_WRITE');
      try {
        const buffer = Buffer.from(text); let offset = 0;
        while (offset < buffer.length) {
          signal.throwIfAborted();
          const { bytesWritten } = await writeDescriptor(lease.fd, buffer, offset, Math.min(64 * 1024, buffer.length - offset));
          if (!bytesWritten) throw new AppError('OUTPUT_WRITE'); offset += bytesWritten;
        }
        signal.throwIfAborted();
      } catch { throw new AppError(signal.aborted ? 'INTERRUPTED' : 'OUTPUT_WRITE'); }
    },
    async commit(signal) {
      if (closed || committed) throw new AppError('UNSAFE_OUTPUT');
      try {
        signal.throwIfAborted(); await syncDescriptor(lease.fd); signal.throwIfAborted();
        if (audit?.commit) api.commit(lease.token, audit.commit); else api.commit(lease.token);
        committed = true; close();
      } catch (error) {
        const code = systemCode(error);
        throw new AppError(signal.aborted ? 'INTERRUPTED' : code === 'OUTPUT_EXISTS' ? code : 'UNSAFE_OUTPUT');
      }
    },
    async discard() { close(); }
  };
}
