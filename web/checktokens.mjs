/** Guards against renamed CSS custom properties silently falling back to black. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync('web/src/styles.css', 'utf8');
const defined = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]));

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(tsx?|css)$/.test(entry)) files.push(full);
  }
})('web/src');

const missing = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/var\((--[a-z0-9-]+)/g)) {
    if (!defined.has(m[1])) missing.push(`${file}: ${m[1]}`);
  }
}

if (missing.length) {
  console.error('Undefined CSS variables (these render as black):');
  for (const m of new Set(missing)) console.error('  ' + m);
  process.exit(1);
}
console.log(`css tokens ok (${defined.size} defined)`);
