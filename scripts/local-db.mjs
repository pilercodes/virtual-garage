import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';

export function localDatabase(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE IF NOT EXISTS applied_migrations (file TEXT PRIMARY KEY)');
  const directory = new URL('../drizzle/', import.meta.url);
  for (const file of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
    if (db.prepare('SELECT file FROM applied_migrations WHERE file = ?').get(file)) continue;
    db.exec('BEGIN');
    try {
      db.exec(readFileSync(new URL(file, directory), 'utf8'));
      db.prepare('INSERT INTO applied_migrations VALUES (?)').run(file);
      db.exec('COMMIT');
    } catch (cause) {
      db.exec('ROLLBACK');
      throw cause;
    }
  }
  return {
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        db.exec('COMMIT');
        return results;
      } catch (cause) {
        db.exec('ROLLBACK');
        throw cause;
      }
    },
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        bind(...args) {
          return {
            all: async () => ({ results: statement.all(...args) }),
            first: async () => statement.get(...args) ?? null,
            run: async () => ({ meta: statement.run(...args) })
          };
        }
      };
    },
    close: () => db.close()
  };
}
