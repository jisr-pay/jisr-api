// Read-only consumer review of an SDK checkout; never loads it into the API.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const source = resolve(process.argv[2] ?? '../../lib/jisr-sdk');
const sdk = await import(pathToFileURL(join(source, 'src/index.ts')));
for (const name of ['parseAmountToStroops', 'fetchSettlement', 'isSavedTransfer', 'applySettlement']) {
  assert.equal(typeof sdk[name], 'function', `Missing export: ${name}`);
}
assert.equal(sdk.parseAmountToStroops('0.0000001'), 1n);
const hash = 'a'.repeat(64);
const settlement = await sdk.fetchSettlement('https://example.invalid', hash, async () =>
  new Response(JSON.stringify({ hash, successful: true, ledger: 1,
    fee_charged: '100', created_at: '2026-01-01T00:00:00Z' })));
assert.equal(settlement.feeCharged, '0.0000100 XLM');
assert.equal(await sdk.fetchSettlement('https://example.invalid', hash,
  async () => new Response(null, { status: 404 })), null);
console.log('Checkout exports and injected read-only settlement smoke checks passed.');

// An actual package directory (not a workspace symlink) exercises Node's
// node_modules TypeScript restriction without installing or changing the SDK.
const root = mkdtempSync(join(tmpdir(), 'jisr-sdk-consumer-'));
try {
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  const destination = join(root, 'node_modules', '@workspace', 'jisr-sdk');
  mkdirSync(join(destination, 'src'), { recursive: true });
  copyFileSync(join(source, 'package.json'), join(destination, 'package.json'));
  copyFileSync(join(source, 'src/amount.ts'), join(destination, 'src/amount.ts'));
  const probe = spawnSync(process.execPath,
    ['--input-type=module', '-e', `import('${manifest.name}/amount')`],
    { cwd: root, encoding: 'utf8' });
  if (probe.status !== 0) {
    console.error(probe.stderr);
    process.exitCode = 1;
  } else console.log('Installed amount entrypoint imports successfully.');
} finally {
  assert.ok(root.startsWith(resolve(tmpdir()) + sep) && root.includes('jisr-sdk-consumer-'));
  rmSync(root, { recursive: true, force: true });
}
