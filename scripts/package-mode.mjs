import assert from 'node:assert/strict';
import { gunzipSync, gzipSync } from 'node:zlib';

// Windows file modes do not carry POSIX executable bits. Normalize the final
// archive's bin header before it is hashed, installed and approved for release.
export function executableArchive(bytes) {
  const tar = gunzipSync(bytes, { maxOutputLength: 16 * 1024 ** 2 }); let found = 0;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512); if (header.every(value => value === 0)) break;
    const field = (start, length) => header.subarray(start, start + length).toString().replace(/\0.*$/s, '');
    const size = parseInt(field(124, 12), 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length);
    assert.equal([...header].reduce((sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value), 0), parseInt(field(148, 8), 8));
    if (field(0, 100) === 'package/dist/bin.js') {
      assert.equal(field(345, 155), ''); assert.ok(header[156] === 0 || header[156] === 48);
      found++; header.write('0000755\0', 100, 8, 'ascii'); header.fill(32, 148, 156);
      const checksum = [...header].reduce((sum, value) => sum + value, 0);
      header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(found, 1, 'Exactly one regular CLI bin entry is required'); return gzipSync(tar);
}
