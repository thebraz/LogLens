import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../contracts/model.js';
import { nativeInput, readDescriptor } from './native.js';
import type { AuditHook } from './native.js';

export function systemCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : null;
}
export function inputError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const code = systemCode(error);
  if (code === 'UNSAFE_PATH' || code === 'NOT_AVAILABLE' || code === 'SOURCE_BYTE_LIMIT' || code === 'INPUT_PERMISSION' || code === 'INPUT_NOT_FOUND') return new AppError(code);
  return new AppError(code === 'ENOENT' ? 'INPUT_NOT_FOUND' : code === 'EACCES' || code === 'EPERM' ? 'INPUT_PERMISSION' : 'INPUT_READ');
}
export async function checkComponents(target: string): Promise<void> {
  const absolute = path.resolve(target); const root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && current !== absolute)) throw new AppError('UNSAFE_PATH');
    // Node exposes junctions as symbolic links. Canonical-path comparison also rejects redirecting aliases.
    const actual = await realpath(current);
    if ((process.platform === 'win32' ? actual.toLowerCase() : actual) !==
        (process.platform === 'win32' ? current.toLowerCase() : current)) throw new AppError('UNSAFE_PATH');
  }
}
export async function openInput(target: string, audit?: AuditHook) {
  try {
    const { lease, api } = nativeInput(path.resolve(target), audit); let closed = false;
    const handle = {
      async read(buffer: Buffer, offset: number, length: number, position: number) {
        if (closed) throw new AppError('INPUT_READ');
        return readDescriptor(lease.fd, buffer, offset, length, position);
      },
      async close() { if (!closed) { closed = true; api.close(lease.token); } }
    };
    return { handle, size: lease.size };
  } catch (error) { throw inputError(error); }
}
