#!/usr/bin/env node
/**
 * renombrar-patrones.js
 *
 * Uso:
 *   node scripts/renombrar-patrones.js          → muestra stats y elimina duplicados
 *   node scripts/renombrar-patrones.js 0        → procesa lote 0 (primeros 50)
 *   node scripts/renombrar-patrones.js 1        → procesa lote 1 (siguientes 50)
 *   ...
 *
 * Estrategia:
 *   1. Si el título tiene texto legible tras el hash → limpiarlo directamente (sin Groq)
 *   2. Si solo tiene números/basura → usar Groq Vision con la thumbnail
 */

const sqlite3 = require('sqlite3').verbose();
const Groq = require('groq-sdk');
const https = require('https');

const DB_PATH = '/var/www/crochetflix-app/database/crochetflix.sqlite';
const SITE_URL = 'https://crochetflix.app';
const BATCH_SIZE = 50;
const DELAY_GROQ_MS = 1200;

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

function tieneHashPrefix(titulo) {
  return /^[0-9a-fA-F]{8,}\s/.test(titulo || '') || /^[0-9a-fA-F]{16,}$/.test(titulo || '');
}

/**
 * Intenta limpiar el título extrayendo el texto real tras el hash.
 * Devuelve null si lo que queda son solo números/basura.
 */
function limpiarTitulo(titulo) {
  // Quitar hash hex del inicio (16 chars + espacio)
  let limpio = titulo.replace(/^[0-9a-fA-F]{8,}\s+/, '').trim();

  // Quitar sufijos comunes de archivos
  limpio = limpio
    .replace(/[\s_-]?pdf$/i, '')
    .replace(/[\s_-]?Pdf$/i, '')
    .replace(/\.pdf$/i, '')
    .trim();

  // Quitar sufijos como "1Pdf", "2Pdf", " 1", " 2" al final
  limpio = limpio.replace(/\s*\d+pdf$/i, '').trim();
  limpio = limpio.replace(/\s+\d+$/, '').trim();

  // Quitar IDs numéricos largos de TikTok/redes (10+ dígitos)
  limpio = limpio.replace(/\d{10,}/g, '').trim();

  // Quitar prefijos numéricos solos: "2 5", "1 5", etc.
  limpio = limpio.replace(/^\d+\s+\d*\s*/, '').trim();

  // Limpiar dobles espacios
  limpio = limpio.replace(/\s{2,}/g, ' ').trim();

  // Si lo que queda es muy corto o son puro números/símbolos → necesita Groq
  if (!limpio || limpio.length < 3 || /^[\d\s._\-]+$/.test(limpio)) {
    return null;
  }

  // Capitalizar primera letra si está en minúsculas
  if (limpio[0] === limpio[0].toLowerCase()) {
    limpio = limpio[0].toUpperCase() + limpio.slice(1);
  }

  return limpio.slice(0, 80);
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

    // Intentar primero con vision, si falla usar solo texto
    const MODELOS_VISION = [
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'llama-4-scout-17b-16e-instruct',
    ];

    let response = null;

    if (imageBase64) {
      for (const modelo of MODELOS_VISION) {
        try {
          response = await groq.chat.completions.create({
            model: modelo,
            messages: [{ role: 'user', content }],
            max_tokens: 100,
            temperature: 0.4
          });
          break; // Si funcionó, salir del loop
        } catch (vErr) {
          if (vErr.status === 404) continue; // Probar siguiente modelo
          throw vErr; // Otro error, propagar
        }
      }
    }

    // Fallback: texto sin imagen
    if (!response) {
      const contentTexto = [{
        type: 'text',
        text: `Genera un título creativo y descriptivo en español para un patrón de crochet/amigurumi que tiene ${patron.paginas || '?'} páginas. Puede ser un personaje, animal, muñeco u objeto tejido a crochet. Solo el título (máximo 60 caracteres), sin comillas ni puntuación al final.`
      }];
      response = await groq.chat.completions.create({
        model: 'llama3-8b-8192',
        messages: [{ role: 'user', content: contentTexto }],
        max_tokens: 80,
        temperature: 0.7
      });
    }

    const raw = response.choices[0]?.message?.content?.trim() || '';
    const titulo = raw
      .replace(/^["'`]|["'`]$/g, '')
      .replace(/\.$/, '')
      .slice(0, 80)
      .trim();

    return titulo || null;

  } catch (err) {
    if (err.status === 429 && intento <= 3) {
      const wait = intento * 30000;
      console.log(`\n  ⏳ Rate limit (intento ${intento}/3), esperando ${wait / 1000}s...`);
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
    arr.sort((a, b) => a.id < b.id ? -1 : 1);
    const mantener = arr[0];
    const eliminar = arr.slice(1);
    console.log(`  "${titulo.slice(0, 45)}..." → mantener ${mantener.id}, eliminar: ${eliminar.map(p => p.id).join(', ')}`);
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

function getUnicos(conHash) {
  const porTitulo = {};
  for (const p of conHash) {
    if (!porTitulo[p.titulo]) porTitulo[p.titulo] = [];
    porTitulo[p.titulo].push(p);
  }
  return Object.values(porTitulo).map(arr => arr.sort((a, b) => a.id < b.id ? -1 : 1)[0]);
}

async function main() {
  const todos = await dbAll(
    'SELECT id, titulo, thumbnail_path, paginas, created_at FROM patrones WHERE activo = 1 ORDER BY created_at DESC'
  );

  const conHash = todos.filter(p => tieneHashPrefix(p.titulo));

  console.log(`\n📊 Total patrones activos: ${todos.length}`);
  console.log(`🔍 Con título tipo hash: ${conHash.length}`);

  if (BATCH === null) {
    console.log('\n=== ELIMINANDO DUPLICADOS ===');
    const eliminados = await eliminarDuplicados(conHash);
    console.log(`✅ ${eliminados} duplicados desactivados\n`);

    const unicos = getUnicos(conHash);
    const limpiables = unicos.filter(p => limpiarTitulo(p.titulo) !== null);
    const necesitanGroq = unicos.filter(p => limpiarTitulo(p.titulo) === null);

    console.log(`📝 Patrones únicos a renombrar: ${unicos.length}`);
    console.log(`  ✂️  Limpieza directa (sin Groq): ${limpiables.length}`);
    console.log(`  🤖 Necesitan Groq Vision:        ${necesitanGroq.length}`);
    console.log(`📦 Lotes de ${BATCH_SIZE}: ${Math.ceil(unicos.length / BATCH_SIZE)} lotes\n`);

    for (let i = 0; i < Math.min(5, unicos.length); i++) {
      const t = limpiarTitulo(unicos[i].titulo);
      console.log(`  "${unicos[i].titulo.slice(0, 45)}" → ${t ? `"${t}"` : '🤖 Groq'}`);
    }
    if (unicos.length > 5) console.log(`  ... y ${unicos.length - 5} más`);

    console.log(`\n▶  Para empezar: node scripts/renombrar-patrones.js 0`);
    db.close();
    return;
  }

  // Modo procesamiento de lote
  const unicos = getUnicos(conHash);
  const inicio = BATCH * BATCH_SIZE;
  const lote = unicos.slice(inicio, inicio + BATCH_SIZE);
  const totalLotes = Math.ceil(unicos.length / BATCH_SIZE);

  if (lote.length === 0) {
    console.log('\n✅ ¡Todos los lotes procesados!\n');
    db.close();
    return;
  }

  console.log(`\n🚀 Lote ${BATCH + 1}/${totalLotes} — procesando ${lote.length} patrones\n`);

  let okDirecto = 0, okGroq = 0, errores = 0;

  for (let i = 0; i < lote.length; i++) {
    const patron = lote[i];
    const tituloCorto = patron.titulo.slice(0, 32);
    process.stdout.write(`[${String(i + 1).padStart(2)}/${lote.length}] "${tituloCorto}..." → `);

    // Intentar limpieza directa primero
    const tituloDirecto = limpiarTitulo(patron.titulo);

    if (tituloDirecto) {
      await dbRun('UPDATE patrones SET titulo = ? WHERE id = ?', [tituloDirecto, patron.id]);
      console.log(`✂️  "${tituloDirecto}"`);
      okDirecto++;
    } else {
      // Necesita Groq
      process.stdout.write('🤖 ');
      const tituloGroq = await analizarConGroq(patron);
      if (tituloGroq) {
        await dbRun('UPDATE patrones SET titulo = ? WHERE id = ?', [tituloGroq, patron.id]);
        console.log(`"${tituloGroq}"`);
        okGroq++;
        await sleep(DELAY_GROQ_MS);
      } else {
        console.log('❌ sin resultado');
        errores++;
      }
    }
  }

  console.log(`\n✅ ${okDirecto} por limpieza directa | 🤖 ${okGroq} por Groq | ❌ ${errores} errores`);

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
