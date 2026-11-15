'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createDatabasePool } = require('./database');

async function migrate(pool) {
  const [db] = await pool.query('SELECT DATABASE() AS name');
  if (db[0]?.name !== 'E-Teczka') throw new Error('Odmowa migracji: wybrana baza nie jest bazą E-Teczka.');
  const [tables] = await pool.query('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
  if (tables.length) throw new Error('Odmowa migracji: baza nie jest pusta. Żadne tabele nie zostały zmienione.');
  const source = fs.readFileSync(path.join(__dirname, '001_accounts.sql'), 'utf8');
  const statements = source.split(/;\s*(?:\r?\n|$)/).map(s => s.trim()).filter(Boolean);
  for (const statement of statements) await pool.query(statement);
  return statements.length;
}

if (require.main === module) {
  (async () => {
    const pool = createDatabasePool();
    try { const count = await migrate(pool); console.log(`Utworzono schemat kont (${count} tabel).`); }
    finally { await pool.end(); }
  })().catch(error => { console.error(`Nie udało się utworzyć tabel: ${error.code || error.message}`); process.exitCode = 1; });
}
module.exports = { migrate };
