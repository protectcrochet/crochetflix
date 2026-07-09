const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../../database/crochetflix.sqlite');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error al conectar con SQLite:', err);
  } else {
    console.log('✅ Conectado a SQLite');
    initTables();
  }
});

function initTables() {
  db.serialize(() => {
    // Usuarias
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      tier TEXT DEFAULT 'free',
      subscription_expires_at TIMESTAMP,
      new_account_discount INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Migración: columna descuento cuenta nueva
    db.run(`ALTER TABLE users ADD COLUMN new_account_discount INTEGER DEFAULT 0`, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error migrando new_account_discount:', err.message);
      }
    });

    // Patrones
    db.run(`CREATE TABLE IF NOT EXISTS patrones (
      id TEXT PRIMARY KEY,
      titulo TEXT NOT NULL,
      descripcion TEXT,
      autor TEXT,
      categoria TEXT,
      dificultad TEXT,
      tiempo_minutos INTEGER,
      paginas INTEGER DEFAULT 0,
      thumbnail_path TEXT,
      activo BOOLEAN DEFAULT 1,
      es_preview BOOLEAN DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Páginas de patrones
    db.run(`CREATE TABLE IF NOT EXISTS paginas (
      id TEXT PRIMARY KEY,
      patron_id TEXT NOT NULL,
      numero INTEGER NOT NULL,
      archivo_path TEXT NOT NULL,
      FOREIGN KEY (patron_id) REFERENCES patrones(id)
    )`);

    // Progreso de usuaria
    db.run(`CREATE TABLE IF NOT EXISTS progreso (
      user_id TEXT NOT NULL,
      patron_id TEXT NOT NULL,
      pagina_actual INTEGER DEFAULT 1,
      completado BOOLEAN DEFAULT 0,
      ultimo_acceso TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      descargado_offline BOOLEAN DEFAULT 0,
      PRIMARY KEY (user_id, patron_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (patron_id) REFERENCES patrones(id)
    )`);

    // Mi Lista
    db.run(`CREATE TABLE IF NOT EXISTS mi_lista (
      user_id TEXT NOT NULL,
      patron_id TEXT NOT NULL,
      agregado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, patron_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (patron_id) REFERENCES patrones(id)
    )`);

    // Pagos (Stripe)
    db.run(`CREATE TABLE IF NOT EXISTS pagos (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      stripe_session_id TEXT,
      stripe_payment_intent_id TEXT,
      order_id TEXT,
      monto_usd REAL,
      status TEXT DEFAULT 'pending',
      plan TEXT,
      descuento_aplicado INTEGER DEFAULT 0,
      updated_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // Preview gratis mensual
    db.run(`CREATE TABLE IF NOT EXISTS preview_mensual (
      user_id TEXT PRIMARY KEY,
      patron_id TEXT NOT NULL,
      mes_anio TEXT NOT NULL,
      usado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (patron_id) REFERENCES patrones(id)
    )`);

    // Migraciones adicionales de patrones
    const patronMigraciones = [
      `ALTER TABLE patrones ADD COLUMN pdf_hash TEXT`,
      `ALTER TABLE patrones ADD COLUMN es_solo_premium INTEGER DEFAULT 0`,
      `ALTER TABLE patrones ADD COLUMN diseñadora TEXT`,
      `ALTER TABLE patrones ADD COLUMN subcategoria TEXT`,
      `ALTER TABLE patrones ADD COLUMN idioma TEXT DEFAULT 'es'`,
      `ALTER TABLE patrones ADD COLUMN destacado INTEGER DEFAULT 0`,
      `ALTER TABLE patrones ADD COLUMN tendencia INTEGER DEFAULT 0`,
      `ALTER TABLE patrones ADD COLUMN verificado INTEGER DEFAULT 0`,
      `ALTER TABLE patrones ADD COLUMN pdf_corrupto INTEGER DEFAULT 0`,
      `ALTER TABLE patrones ADD COLUMN hero_position TEXT`,
    ];
    patronMigraciones.forEach(sql => {
      db.run(sql, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error migración:', err.message);
        }
      });
    });

    // Migraciones adicionales de users
    const userMigraciones = [
      `ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP`,
      `ALTER TABLE users ADD COLUMN login_count INTEGER DEFAULT 0`,
    ];
    userMigraciones.forEach(sql => {
      db.run(sql, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('Error migración users:', err.message);
        }
      });
    });

    console.log('✅ Tablas inicializadas');
  });
}

module.exports = db;
