import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/account-ui.js': ['account-ui.js', 'text/javascript; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/vehicles.webp': ['vehicles.webp', 'image/webp']
};
const contents = {};
for (const [route, [file, type]] of Object.entries(assets)) {
  contents[route] = { type, body: (await readFile(new URL('../src/public/' + file, import.meta.url))).toString('base64') };
}
const worker = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
const model = await readFile(new URL('../src/model.js', import.meta.url), 'utf8');
const modelImport = /^import \{ vehicles, cleanVehicle, cleanService \} from '\.\/model\.js';$/m;
if (!modelImport.test(worker)) throw new Error('Worker model import changed. Update the build entrypoint.');
const accounts = await readFile(new URL('../src/accounts.js', import.meta.url), 'utf8');
const accountImport = /^import \{ accountGarage, handleAccount \} from '\.\/accounts\.js';$/m;
if (!accountImport.test(worker)) throw new Error('Worker accounts import changed. Update the build entrypoint.');
await mkdir('dist/.openai', { recursive: true });
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
await mkdir('dist/server', { recursive: true });
await writeFile('dist/server/index.js', 'const assets = ' + JSON.stringify(contents) + ';\n' +
  worker.replace(modelImport, () => model.replace(/^export /gm, ''))
    .replace(accountImport, () => accounts.replace(/^export /gm, '')));
