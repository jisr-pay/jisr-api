import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
for (const directory of ['src', 'scripts', 'test']) {
  for (const name of readdirSync(directory).filter(name => name.endsWith('.js'))) {
    const result = spawnSync(process.execPath, ['--check', `${directory}/${name}`], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
JSON.parse(readFileSync('openapi.json', 'utf8'));
console.log('JavaScript syntax and OpenAPI JSON checks passed; no compilation required.');
