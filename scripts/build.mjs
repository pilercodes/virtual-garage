import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/account-ui.js': ['account-ui.js', 'text/javascript; charset=utf-8'],
  '/workshop-export.js': ['workshop-export.js', 'text/javascript; charset=utf-8'],
  '/workshop-model.js': ['workshop-model.js', 'text/javascript; charset=utf-8'],
  '/workshop-ui.js': ['workshop-ui.js', 'text/javascript; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/vehicles.webp': ['vehicles.webp', 'image/webp']
};
const contents = {};
for (const [route, [file, type]] of Object.entries(assets)) {
  const source = new URL('../src/public/' + file, import.meta.url);
  if (type.startsWith('text/javascript')) execFileSync(process.execPath, ['--check', fileURLToPath(source)], { stdio: 'inherit' });
  contents[route] = { type, body: (await readFile(source)).toString('base64') };
}
const worker = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
const model = await readFile(new URL('../src/model.js', import.meta.url), 'utf8');
const modelImport = /^import \{ vehicles, cleanVehicle, cleanService \} from '\.\/model\.js';$/m;
if (!modelImport.test(worker)) throw new Error('Worker model import changed. Update the build entrypoint.');
const accounts = await readFile(new URL('../src/accounts.js', import.meta.url), 'utf8');
const accountImport = /^import \{ accountGarage, handleAccount \} from '\.\/accounts\.js';$/m;
if (!accountImport.test(worker)) throw new Error('Worker accounts import changed. Update the build entrypoint.');
const workshop = await readFile(new URL('../src/workshop.js', import.meta.url), 'utf8');
const workshopImport = "import { handleWorkshop } from './workshop.js';";
if (!worker.includes(workshopImport)) throw new Error('Worker workshop import changed.');
await mkdir('dist/.openai', { recursive: true });
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
await mkdir('dist/server', { recursive: true });
await writeFile('dist/server/index.js', 'const assets = ' + JSON.stringify(contents) + ';\n' +
  worker.replace(modelImport, () => model.replace(/^export /gm, ''))
    .replace(accountImport, () => accounts.replace(/^export /gm, ''))
    .replace(workshopImport, () => workshop.replace(/^export /gm, '')));
