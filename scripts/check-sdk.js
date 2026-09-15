import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

// npm run supplies its portable CLI entrypoint, avoiding shell command quoting.
if (!process.env.npm_execpath) throw new Error('Run with npm run check:sdk.');
const root = mkdtempSync(join(tmpdir(), 'jisr-sdk-consumer-'));
try {
  mkdirSync(join(root, 'vendor'));
  for (const file of ['package.json', 'package-lock.json', 'vendor/workspace-jisr-sdk-0.3.0.tgz']) {
    copyFileSync(resolve(file), join(root, file));
  }
  const install = spawnSync(process.execPath, [process.env.npm_execpath, 'ci', '--ignore-scripts', '--offline', '--no-audit', '--no-fund'],
    { cwd: root, encoding: 'utf8' });
  if (install.status !== 0) throw new Error(install.stderr || 'Isolated installation failed. Run npm ci first to populate cache.');
  const probe = `
    import assert from 'node:assert/strict';
    import { readFileSync, lstatSync } from 'node:fs';
    import { parseAmountToStroops } from '@workspace/jisr-sdk/amount';
    import { fetchSettlement } from '@workspace/jisr-sdk/settlement';
    import { isSavedTransfer, applySettlement } from '@workspace/jisr-sdk/transfer-history';
    const manifest = JSON.parse(readFileSync('node_modules/@workspace/jisr-sdk/package.json', 'utf8'));
    assert.equal(manifest.version, '0.3.0');
    assert.equal(lstatSync('node_modules/@workspace/jisr-sdk').isSymbolicLink(), false);
    for (const entry of Object.values(manifest.exports)) {
      if (typeof entry === 'string') continue;
      assert.ok(entry.default.endsWith('.js'));
      assert.ok(readFileSync('node_modules/@workspace/jisr-sdk/' + entry.types).length);
    }
    assert.equal(typeof isSavedTransfer, 'function');
    assert.equal(typeof applySettlement, 'function');
    assert.equal(parseAmountToStroops('0.0000001'), 1n);
    assert.equal(parseAmountToStroops('90000000000'), 900000000000000000n);
    assert.throws(() => parseAmountToStroops('90000000000.0000001'));
    const hash = 'a'.repeat(64);
    const settled = await fetchSettlement('https://example.invalid', hash, async () => new Response(JSON.stringify({
      hash, successful: true, ledger: 1, fee_charged: '100', created_at: '2026-01-01T00:00:00Z'
    })));
    assert.equal(settled.feeCharged, '0.0000100 XLM');
    assert.equal(await fetchSettlement('https://example.invalid', hash, async () => new Response(null, {status: 404})), null);
    console.log('Isolated installed SDK: compiled imports, declarations, exact amounts and read-only settlement passed.');
  `;
  writeFileSync(join(root, 'probe.mjs'), probe);
  const result = spawnSync(process.execPath, ['probe.mjs'], { cwd: root, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } });
  if (result.status !== 0) throw new Error(result.stderr || 'SDK consumer probe failed.');
  console.log(result.stdout.trim());
} finally {
  assert.ok(root.startsWith(resolve(tmpdir()) + sep) && root.includes('jisr-sdk-consumer-'));
  rmSync(root, { recursive: true, force: true });
}
