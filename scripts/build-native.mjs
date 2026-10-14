import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, copyFile, cp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const hash = async name => createHash('sha256').update(await readFile(path.join(root, name))).digest('hex');
const sourceBefore = await hash('native/filesystem.cc'); const configBefore = await hash('binding.gyp');
const args = [createRequire(import.meta.url).resolve('node-gyp/bin/node-gyp.js'), 'rebuild'];
if (process.env.LOGLENS_NODE_HEADERS) {
  // node-gyp's explicit SDK layout differs from its download cache on Windows.
  const sdk = path.join(root, 'build-sdk');
  await mkdir(path.join(sdk, 'include'), { recursive: true });
  await cp(path.join(process.env.LOGLENS_NODE_HEADERS, 'include/node'), path.join(sdk, 'include/node'), { recursive: true });
  if (process.platform === 'win32') {
    await mkdir(path.join(sdk, 'Release'), { recursive: true });
    await copyFile(process.env.LOGLENS_NODE_LIB ?? path.join(process.env.LOGLENS_NODE_HEADERS, process.arch, 'node.lib'), path.join(sdk, 'Release/node.lib'));
  }
  args.push('--nodedir=' + sdk);
}
const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', timeout: 180000 });
if (result.error || result.status !== 0) process.exit(result.status || 1);
const destination = path.join(root, 'native', process.platform + '-' + process.arch);
await mkdir(destination, { recursive: true });
await copyFile(path.join(root, 'build/Release/loglens_fs.node'), path.join(destination, 'loglens_fs.node'));
assert.equal(await hash('native/filesystem.cc'), sourceBefore, 'Native source changed while building; rebuild the controlled snapshot.');
assert.equal(await hash('binding.gyp'), configBefore, 'Native build configuration changed while building.');
await writeFile(path.join(destination, 'manifest.json'), JSON.stringify({ platform: process.platform, arch: process.arch,
  nodeApi: 8, node: process.version, sourceSha256: await hash('native/filesystem.cc'),
  buildConfigSha256: configBefore,
  binarySha256: await hash('native/' + process.platform + '-' + process.arch + '/loglens_fs.node') }, null, 2) + '\n');
