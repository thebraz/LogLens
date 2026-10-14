import { createRequire } from 'node:module';
import { read, write, fsync } from 'node:fs';
import { AppError } from '../contracts/model.js';
interface Lease { fd: number; size: number; token: unknown }
export type AuditHook = (stage: string, component: string) => void;
interface Backend {
  openInput(target: string, audit?: AuditHook): Lease;
  createOutput(target: string, temporary: string, audit?: AuditHook): Lease;
  commit(token: unknown, audit?: AuditHook): void;
  close(token: unknown, audit?: AuditHook): void;
}
function backend(): Backend {
  try {
    const value: unknown = createRequire(import.meta.url)(`../../native/${process.platform}-${process.arch}/loglens_fs.node`);
    if (typeof value !== 'object' || value === null ||
        !['openInput', 'createOutput', 'commit', 'close'].every(key => key in value && typeof Reflect.get(value, key) === 'function')) throw new Error();
    return value as Backend;
  } catch { throw new AppError('NOT_AVAILABLE'); }
}
export function nativeInput(target: string, audit?: AuditHook) { const api = backend(); return { lease: audit ? api.openInput(target, audit) : api.openInput(target), api }; }
export function nativeOutput(target: string, temporary: string, audit?: AuditHook) { const api = backend(); return { lease: audit ? api.createOutput(target, temporary, audit) : api.createOutput(target, temporary), api }; }
export function readDescriptor(fd: number, buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }> {
  return new Promise((resolve, reject) => { read(fd, buffer, offset, length, position, (error, bytesRead) => error ? reject(error) : resolve({ bytesRead })); });
}
export function writeDescriptor(fd: number, buffer: Buffer, offset: number, length: number): Promise<{ bytesWritten: number }> {
  return new Promise((resolve, reject) => { write(fd, buffer, offset, length, null, (error, bytesWritten) => error ? reject(error) : resolve({ bytesWritten })); });
}
export function syncDescriptor(fd: number): Promise<void> {
  return new Promise((resolve, reject) => { fsync(fd, error => error ? reject(error) : resolve()); });
}
