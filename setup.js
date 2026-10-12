'use strict';
// One-time setup: creates restaurant_db, the 7 tables, and sample data.
// Safe to run again - nothing is deleted or duplicated.
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { pool, config, seedIfEmpty } = require('./db');

function explain(err) {
  if (err.code === 'ECONNREFUSED') return 'MySQL is not running. Open Windows "Services", find MySQL80 and click Start.';
  if (err.code === 'ER_ACCESS_DENIED_ERROR') return 'Wrong MySQL password. Check DB_PASSWORD in the .env file.';
  return err.message;
}

(async () => {
  try {
    const conn = await mysql.createConnection({ ...config, multipleStatements: true });
    await conn.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    await conn.end();
    await seedIfEmpty();
    console.log('Setup complete: database restaurant_db is ready.');
    await pool.end();
  } catch (err) {
    console.error('Setup failed: ' + explain(err));
    process.exit(1);
  }
})();
