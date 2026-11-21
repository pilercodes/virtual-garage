import { readFileSync, writeFileSync } from 'node:fs';
const path = 'drizzle/meta/_journal.json';
const journal = JSON.parse(readFileSync(path, 'utf8'));
for (const tag of process.argv.slice(2)) {
  if (journal.entries.some(entry => entry.tag === tag)) continue;
  journal.entries.push({ idx: journal.entries.length, version: '6', when: journal.entries.at(-1).when + 1000, tag, breakpoints: true });
}
writeFileSync(path, JSON.stringify(journal, null, 2) + '\n');
