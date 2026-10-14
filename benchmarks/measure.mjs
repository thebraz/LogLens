// Measure the actual compiled entry point; maxRSS is supplied by the OS through libuv.
import { writeFile } from 'node:fs/promises';
const [metrics, bin, ...args] = process.argv.slice(2);
if (!metrics || !bin) throw new Error('Missing benchmark arguments');
process.argv = [process.execPath, bin, ...args];
await import(new URL('../dist/bin.js', import.meta.url));
await writeFile(metrics, JSON.stringify({ maxRssKiB: process.resourceUsage().maxRSS, exitCode: process.exitCode ?? 0 }) + '\n', { flag: 'wx' });
