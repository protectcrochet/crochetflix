#!/usr/bin/env node
/**
 * renombrar-patrones.js
 *
 * Uso:
 *   node scripts/renombrar-patrones.js          → muestra stats y elimina duplicados
 *   node scripts/renombrar-patrones.js 0        → procesa lote 0 (primeros 50)
 *   node scripts/renombrar-patrones.js 1        → procesa lote 1 (siguientes 50)
 *   ...
 */

const sqlite3 = require('sqlite3').verbose();
const Groq = require('groq-sdk');
const fs = require('fs');
const path = require('path');
const https = require('https');

const DB_PATH = '/var/www/crochetflix-app/database/crochetflix.sqlite';
const SITE_URL = 'https://crochetflix.app';
const BATCH_SIZE = 50;
const DELAY_MS = 1200; // ~50 req/min, bien dentro del límite de Groq

const BATCH = process.argv[2] !== undefined ? parseInt(process.argv[2]) : null;

require('dotenv').config({ path: '/var/www/crochetflix-app/backend/.env' });

if (!process.env.GROQ_API_KEY) {
  console.error('❌ GROQ_API_KEY no encontrada en .env');
  process.exit(1);
}

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const db = new sqlite3.Database(DB_PATH);

const dbAll = (sql, p = []) => new Promise((res, rej) =>
  db.all(sql, p, (e, rows) => e ? rej(e) : res(rows)));

const dbRun = (sql, p = []) => new Promise((res, rej) =>
  db.run(sql, p, function(e) { e ? rej(e) : res(this); }));

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Patrón: título que empieza con hash hex (8+ chars hex) seguido de espacio o es todo hex
function tieneHashPrefix(titulo) {
  return /^[0-9a-fA-F]{8,}\s/.test(titulo || '') || /^[0-9a-fA-F]{16,}$/.test(titulo || '');
}

function fetchImageBase64(url) {
  return new Promise((resolve) => {
    https.get(url, { timeout: 8000 }, (res) => {
      if (res.statusCode !== 200) return resolve(null);
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
      res.on('error', () => resolve(null));
    }).on('error', () => resolve(null))
      .on('timeout', function() { this.destroy(); resolve(null); });
  });
}

async function analizarConGroq(patron, intento = 1) {
  try {
    const thumbnailUrl = patron.thumbnail_path
      ? (patron.thumbnail_path.startsWith('http')
          ? patron.thumbnail_path
          : `${SITE_URL}${patron.thumbnail_path}`)
      : null;

    const imageBase64 = thumbnailUrl ? await fetchImageBase64(thumbnailUrl) : null;

    const content = [];
    if (imageBase64) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${imageBase64}` }
      });
    }
    content.push({
      type: 'text',
      text: `Eres un experto en patrones de crochet y tejido. ${
        imageBase64
          ? 'Observa la imagen de este patrón y'
          : 'Basándote en el contexto,'
      } genera un título descriptivo y atractivo en español para este patrón de crochet/tejido que tiene ${patron.paginas || '?'} páginas.

Reglas:
- Máximo 70 caracteres
- En español
- Descriptivo del producto (ej: "Amigurumi Osito Polar", "Chaleco Bohemio con Flecos", "Bolso Tote a Crochet")
- Solo responde con el título, sin comillas ni puntuación al final`
    });

    const modelo = imageBase64
      ? 'meta-llama/llama-4-maverick-17b-128e-instruct-fp8'
      : 'llama3-8b-8192';

    const response = await groq.chat.completions.create({
      model: modelo,
      messages: [{ role: 'user', content }],
      max_tokens: 100,
      temperature: 0.4
    });

    const raw = response.choices[0]?.message?.content?.trim() || '';
    const titulo = raw
      .replace(/^["'`]|["'`]$/g, '')
      .replace(/\.$/,'')
      .slice(0, 80)
      .trim();

    return titulo || null;

  } catch (err) {
    if (err.status === 429 && intento <= 3) {
      const wait = intento * 30000;
      console.log(`\n  ⏳ Rate limit (intento ${intento}/3), esperando ${wait/1000}s...`);
      await sleep(wait);
      return analizarConGroq(patron, intento + 1);
    }
    console.error(`\n  ❌ Groq error: ${err.message}`);
    return null;
  }
}

async function eliminarDuplicados(conHash) {
  const porTitulo = {};
  for (const p of conHash) {
    if (!porTitulo[p.titulo]) porTitulo[p.titulo] = [];
    porTitulo[p.titulo].push(p);
  }

  const grupos = Object.entries(porTitulo).filter(([, arr]) => arr.length > 1);
  if (grupos.length === 0) {
    console.log('  No se encontraron duplicados.\n');
    return 0;
  }

  let totalElim = 0;
  for (const [titulo, arr] of grupos) {
    // Ordenar por id (el más antiguo primero = mantener)
    arr.sort((a, b) => a.id < b.id ? -1 : 1);
    const mantener = arr[0];
    const eliminar = arr.slice(1);

    console.log(`  "${titulo.slice(0, 45)}..." → mantener ${mantener.id}, eliminar: ${eliminar.map(p=>p.id).join(', ')}`);

    for (const p of eliminar) {
      await dbRun('DELETE FROM progreso WHERE patron_id = ?', [p.id]);
      await dbRun('DELETE FROM mi_lista WHERE patron_id = ?', [p.id]);
      await dbRun('DELETE FROM preview_mensual WHERE patron_id = ?', [p.id]);
      await dbRun('UPDATE patrones SET activo = 0 WHERE id = ?', [p.id]);
      totalElim++;
    }
  }
  return totalElim;
}

async function main() {
  const todos = await dbAll(
    'SELECT id, titulo, thumbnail_path, paginas, created_at FROM patrones WHERE activo = 1 ORDER BY created_at DESC'
  );

  const conHash = todos.filter(p => tieneHashPrefix(p.titulo));

  console.log(`\n📊 Total patrones activos: ${todos.length}`);
  console.log(`🔍 Con título tipo hash: ${conHash.length}`);

  if (BATCH === null) {
    // Modo estadísticas + limpieza de duplicados
    console.log('\n=== ELIMINANDO DUPLICADOS ===');
    const eliminados = await eliminarDuplicados(conHash);
    console.log(`✅ ${eliminados} duplicados desactivados\n`);

    // Recalcular únicos tras dedup
    const porTitulo = {};
    for (const p of conHash) {
      if (!porTitulo[p.titulo]) porTitulo[p.titulo] = [];
      porTitulo[p.titulo].push(p);
    }
    const unicos = Object.values(porTitulo).map(arr => arr.sort((a,b)=>a.id<b.id?-1:1)[0]);

    console.log(`📝 Patrones únicos a renombrar: ${unicos.length}`);
    console.log(`📦 Lotes de ${BATCH_SIZE}: ${Math.ceil(unicos.length / BATCH_SIZE)} lotes\n`);

    for (let i = 0; i < Math.min(5, unicos.length); i++) {
      console.log(`  "${unicos[i].titulo.slice(0,50)}" [id:${unicos[i].id}]`);
    }
    if (unicos.length > 5) console.log(`  ... y ${unicos.length - 5} más`);

    console.log(`\n▶  Para empezar: node scripts/renombrar-patrones.js 0`);
    db.close();
    return;
  }

  // Modo procesamiento de lote
  const porTitulo = {};
  for (const p of conHash) {
    if (!porTitulo[p.titulo]) porTitulo[p.titulo] = [];
    porTitulo[p.titulo].push(p);
  }
  const unicos = Object.values(porTitulo)
    .map(arr => arr.sort((a,b)=>a.id<b.id?-1:1)[0]);

  const inicio = BATCH * BATCH_SIZE;
  const lote = unicos.slice(inicio, inicio + BATCH_SIZE);

  if (lote.length === 0) {
    console.log('\n✅ ¡Todos los lotes procesados! No quedan patrones con hash.\n');
    db.close();
    return;
  }

  const totalLotes = Math.ceil(unicos.length / BATCH_SIZE);
  console.log(`\n🚀 Lote ${BATCH + 1}/${totalLotes} — procesando ${lote.length} patrones\n`);

  let ok = 0, errores = 0;

  for (let i = 0; i < lote.length; i++) {
    const patron = lote[i];
    const tituloCorto = patron.titulo.slice(0, 35);
    process.stdout.write(`[${String(i+1).padStart(2)}/${lote.length}] "${tituloCorto}..." → `);

    const nuevoTitulo = await analizarConGroq(patron);

    if (nuevoTitulo) {
      await dbRun('UPDATE patrones SET titulo = ? WHERE id = ?', [nuevoTitulo, patron.id]);
      console.log(`"${nuevoTitulo}"`);
      ok++;
    } else {
      console.log('❌ sin resultado');
      errores++;
    }

    if (i < lote.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\n✅ ${ok} renombrados | ❌ ${errores} errores`);

  if (BATCH + 1 < totalLotes) {
    console.log(`\n▶  Siguiente lote: node scripts/renombrar-patrones.js ${BATCH + 1}\n`);
  } else {
    console.log('\n🎉 ¡Todos los lotes completados!\n');
  }

  db.close();
}

main().catch(err => {
  console.error('Error fatal:', err);
  db.close();
  process.exit(1);
});
