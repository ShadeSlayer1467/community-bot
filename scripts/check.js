import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
let count = 0;
function check(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) check(file);
    else if (/\.(m?js)$/.test(file)) {
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if (result.status) {
        console.error(result.stderr);
        process.exit(1);
      }
      count++;
    }
  }
}
for (const folder of ['src', 'custom', 'scripts', 'test'])
  if (fs.existsSync(path.join(root, folder))) check(path.join(root, folder));
const { definitions, developerDefinitions } = await import('../src/commands/definitions.js');
const { defaults } = await import('../src/settings.js');
definitions(defaults);
developerDefinitions(defaults);
console.log(
  `Checked ${count} JavaScript modules and serialized slash command definitions. No transpilation needed.`,
);
