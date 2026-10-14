// Read-only public metadata queries. No credentials, logs, or local data are sent.
import { mkdir, writeFile } from 'node:fs/promises';

const records = [];
for (const url of [
  'https://registry.npmjs.org/loglens',
  'https://registry.npmjs.org/@thebraz%2floglens',
  'https://registry.npmjs.org/-/user/org.couchdb.user:thebraz',
  'https://api.github.com/repos/actions/checkout/git/ref/tags/v7',
  'https://api.github.com/repos/actions/setup-node/git/ref/tags/v7'
]) {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'LogLens-local-release-check' }, signal: AbortSignal.timeout(15000) });
    const body = await response.json();
    records.push({ url, httpStatus: response.status, name: body.name ?? null,
      version: body['dist-tags']?.latest ?? null, ref: body.ref ?? null, object: body.object ?? null });
  } catch { records.push({ url, status: 'NOT TESTED', reason: 'Public metadata request failed.' }); }
}
await mkdir('evidence/stage-4', { recursive: true });
await writeFile('evidence/stage-4/public-metadata.json', JSON.stringify({ checkedAt: new Date().toISOString(),
  ownerStatement: 'The user identifies thebraz as their npm and GitHub username; no authenticated ownership proof or name reservation.', records }, null, 2) + '\n');
process.stdout.write(JSON.stringify(records) + '\n');
