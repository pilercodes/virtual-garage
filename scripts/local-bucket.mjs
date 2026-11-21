import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export function localBucket(root) {
  const file = key => resolve(root, encodeURIComponent(key));
  return {
    async put(key, bytes) {
      await mkdir(root, { recursive: true });
      const temporary = file(key) + '.' + crypto.randomUUID();
      await writeFile(temporary, new Uint8Array(bytes));
      await rename(temporary, file(key));
    },
    async get(key) {
      try {
        return { body: await readFile(file(key)) };
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return null;
      }
    },
    async delete(key) {
      await rm(file(key), { force: true });
    }
  };
}
