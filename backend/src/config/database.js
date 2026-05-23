const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = process.env.DATABASE_PATH || 
  path.join(__dirname, '../../../database/crochetflix.sqlite');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Error SQLite:', err);
  else console.log('✅ SQLite conectado');
});

module.exports = db;