import fs from 'node:fs';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
if (!scripts.length) throw new Error('No inline script found');
fs.writeFileSync('/tmp/futstats-inline.js', scripts.at(-1));
console.log(`Extracted ${scripts.at(-1).length} characters`);
