#!/usr/bin/env python3
"""
Detecta duplicados en el catálogo de CrochetFlix.
No modifica nada — genera reporte en /root/duplicados_reporte.db

Uso: python3 /root/detectar_duplicados.py
Ver resultados: sqlite3 /root/duplicados_reporte.db "SELECT * FROM duplicados LIMIT 20;"
"""

import sqlite3
import os
import re
from difflib import SequenceMatcher
from collections import defaultdict

MAIN_DB    = '/var/www/crochetflix-app/database/crochetflix.sqlite'
VPS_PATH   = '/var/www/crochetflix-app/backend/uploads/patrones'
BOT_DB     = '/root/crochetflix.db'
REPORTE_DB = '/root/duplicados_reporte.db'

UMBRAL_TITULO   = 0.85
UMBRAL_DISENADORA = 0.70
UMBRAL_IMAGEN   = 3   # bits de diferencia (Hamming)


# ── Hashing perceptual ────────────────────────────────────────────────────────

def _avg_hash(img, size=8):
    small = img.convert('L').resize((size, size))
    px = list(small.tobytes())
    avg = sum(px) / len(px)
    return sum(1 << i for i, p in enumerate(px) if p > avg)

def _hamming(h1, h2):
    return bin(h1 ^ h2).count('1')

def phash_thumbnail(ruta):
    try:
        from PIL import Image
        return _avg_hash(Image.open(ruta))
    except Exception:
        return None


# ── Normalización de texto ────────────────────────────────────────────────────

_STOP = {'pdf', 'pattern', 'patron', 'patrons', 'crochet', 'free', 'gratis',
         'amigurumi', 'tutorial', 'design', 'designs', 'knit', 'knitting'}

def normalizar(texto):
    if not texto:
        return ''
    t = texto.lower().strip()
    t = re.sub(r'[^\w\s]', ' ', t)
    t = re.sub(r'\s+', ' ', t)
    palabras = [p for p in t.split() if p not in _STOP]
    return ' '.join(palabras).strip()

def sim(a, b):
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


# ── Carga de patrones ─────────────────────────────────────────────────────────

def cargar_patrones():
    conn = sqlite3.connect(MAIN_DB, timeout=10)
    cols = [r[1] for r in conn.execute("PRAGMA table_info(patrones)").fetchall()]
    dis_col = next((c for c in cols if 'disen' in c.lower()), None)

    if dis_col:
        rows = conn.execute(
            f'SELECT id, titulo, "{dis_col}" FROM patrones WHERE activo=1'
        ).fetchall()
    else:
        rows = [(r[0], r[1], '') for r in
                conn.execute('SELECT id, titulo FROM patrones WHERE activo=1').fetchall()]
    conn.close()

    return [
        {
            'id': pid,
            'titulo': titulo or '',
            'dis': dis or '',
            'norm_t': normalizar(titulo),
            'norm_d': normalizar(dis),
        }
        for pid, titulo, dis in rows
    ]


# ── Duplicados por título ─────────────────────────────────────────────────────

def duplicados_titulo(patrones):
    grupos = defaultdict(list)
    for p in patrones:
        clave = p['norm_t'].split()[0] if p['norm_t'].split() else '__vacio__'
        grupos[clave].append(p)

    encontrados = []
    vistos = set()
    total_grupos = sum(1 for g in grupos.values() if len(g) >= 2)
    procesados = 0

    for clave, grupo in grupos.items():
        if len(grupo) < 2:
            continue
        procesados += 1
        if procesados % 200 == 0:
            print(f"  Grupos procesados: {procesados}/{total_grupos} — dups: {len(encontrados)}")

        for i in range(len(grupo)):
            for j in range(i + 1, len(grupo)):
                p1, p2 = grupo[i], grupo[j]
                par = frozenset([p1['id'], p2['id']])
                if par in vistos:
                    continue

                sim_t = sim(p1['norm_t'], p2['norm_t'])
                if sim_t < UMBRAL_TITULO:
                    continue

                sim_d = sim(p1['norm_d'], p2['norm_d'])
                if sim_d >= UMBRAL_DISENADORA or not p1['norm_d'] or not p2['norm_d']:
                    vistos.add(par)
                    encontrados.append({
                        'id1': p1['id'], 'titulo1': p1['titulo'], 'dis1': p1['dis'],
                        'id2': p2['id'], 'titulo2': p2['titulo'], 'dis2': p2['dis'],
                        'sim_titulo': round(sim_t, 3),
                        'sim_dis':    round(sim_d, 3),
                        'dist_imagen': 99,
                        'tipo': 'titulo',
                    })

    return encontrados, vistos


# ── Carga de hashes de imagen ─────────────────────────────────────────────────

def cargar_hashes(patrones):
    hashes = {}

    # 1. Leer desde thumb_cache del bot
    try:
        conn = sqlite3.connect(BOT_DB, timeout=5)
        for patron_dir, phash_str in conn.execute(
            'SELECT patron_dir, phash FROM thumb_cache WHERE phash IS NOT NULL'
        ).fetchall():
            hashes[patron_dir] = int(phash_str)
        conn.close()
        print(f"  Hashes desde cache: {len(hashes)}")
    except Exception as e:
        print(f"  Cache no disponible: {e}")

    # 2. Computar los que faltan
    nuevos = 0
    conn_bot = None
    try:
        conn_bot = sqlite3.connect(BOT_DB, timeout=5)
        conn_bot.execute(
            'CREATE TABLE IF NOT EXISTS thumb_cache (patron_dir TEXT PRIMARY KEY, phash TEXT)'
        )
    except Exception:
        pass

    for p in patrones:
        pid = p['id']
        if pid in hashes:
            continue
        patron_dir = os.path.join(VPS_PATH, pid)
        thumb = None
        for fname in ['pagina_1.jpg', 'pagina.1.jpeg']:
            c = os.path.join(patron_dir, fname)
            if os.path.exists(c):
                thumb = c
                break
        if not thumb:
            continue
        h = phash_thumbnail(thumb)
        if h is None:
            continue
        hashes[pid] = h
        nuevos += 1
        if conn_bot:
            try:
                conn_bot.execute(
                    'INSERT OR REPLACE INTO thumb_cache (patron_dir, phash) VALUES (?,?)',
                    (pid, str(h))
                )
                if nuevos % 500 == 0:
                    conn_bot.commit()
                    print(f"  Hashes computados: {nuevos}...")
            except Exception:
                pass

    if conn_bot:
        try:
            conn_bot.commit()
            conn_bot.close()
        except Exception:
            pass

    print(f"  Hashes nuevos: {nuevos} | Total: {len(hashes)}")
    return hashes


# ── Duplicados por imagen ─────────────────────────────────────────────────────

def duplicados_imagen(patrones, hashes, vistos_titulo):
    con_hash = [p for p in patrones if p['id'] in hashes]
    print(f"  Patrones con hash: {len(con_hash)}")

    encontrados = []
    total = len(con_hash)

    for i in range(total):
        if i % 1000 == 0 and i > 0:
            print(f"  Imagen {i}/{total} — dups imagen: {len(encontrados)}")
        p1 = con_hash[i]
        h1 = hashes[p1['id']]
        for j in range(i + 1, total):
            p2 = con_hash[j]
            dist = _hamming(h1, hashes[p2['id']])
            if dist > UMBRAL_IMAGEN:
                continue
            par = frozenset([p1['id'], p2['id']])
            if par in vistos_titulo:
                continue
            vistos_titulo.add(par)
            encontrados.append({
                'id1': p1['id'], 'titulo1': p1['titulo'], 'dis1': p1['dis'],
                'id2': p2['id'], 'titulo2': p2['titulo'], 'dis2': p2['dis'],
                'sim_titulo':  round(sim(p1['norm_t'], p2['norm_t']), 3),
                'sim_dis':     round(sim(p1['norm_d'], p2['norm_d']), 3),
                'dist_imagen': dist,
                'tipo': 'imagen',
            })

    return encontrados


# ── Guardar reporte ───────────────────────────────────────────────────────────

def guardar_reporte(duplicados):
    conn = sqlite3.connect(REPORTE_DB)
    conn.execute('DROP TABLE IF EXISTS duplicados')
    conn.execute('''
        CREATE TABLE duplicados (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo          TEXT,
            id1           TEXT, titulo1 TEXT, dis1 TEXT,
            id2           TEXT, titulo2 TEXT, dis2 TEXT,
            sim_titulo    REAL,
            sim_dis       REAL,
            dist_imagen   INTEGER,
            accion        TEXT DEFAULT NULL
        )
    ''')
    conn.executemany(
        '''INSERT INTO duplicados
           (tipo, id1, titulo1, dis1, id2, titulo2, dis2, sim_titulo, sim_dis, dist_imagen)
           VALUES (:tipo,:id1,:titulo1,:dis1,:id2,:titulo2,:dis2,:sim_titulo,:sim_dis,:dist_imagen)''',
        duplicados
    )
    conn.commit()
    conn.close()


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=== Detector de duplicados CrochetFlix ===\n")

    print("1. Cargando patrones...")
    patrones = cargar_patrones()
    print(f"   {len(patrones)} patrones activos\n")

    print("2. Buscando duplicados por título+diseñadora...")
    dups_t, vistos = duplicados_titulo(patrones)
    print(f"   Encontrados: {len(dups_t)}\n")

    print("3. Cargando hashes de imagen...")
    hashes = cargar_hashes(patrones)
    print()

    print("4. Buscando duplicados por imagen...")
    dups_i = duplicados_imagen(patrones, hashes, vistos)
    print(f"   Encontrados adicionales: {len(dups_i)}\n")

    todos = dups_t + dups_i
    print(f"5. Guardando reporte en {REPORTE_DB}...")
    guardar_reporte(todos)

    print(f"\n✓ Listo — {len(todos)} pares sospechosos\n")
    print("── Comandos para revisar ──────────────────────────────────────────")
    print(f"sqlite3 {REPORTE_DB} \"SELECT tipo, COUNT(*) FROM duplicados GROUP BY tipo;\"")
    print(f"sqlite3 {REPORTE_DB} \"SELECT titulo1, dis1, titulo2, dis2, sim_titulo, dist_imagen, tipo FROM duplicados ORDER BY sim_titulo DESC LIMIT 30;\"")
    print()
    print("── Para desactivar duplicados confirmados (REVISAR PRIMERO) ───────")
    print(f"sqlite3 {REPORTE_DB} \"UPDATE duplicados SET accion='desactivar_id2' WHERE sim_titulo > 0.95;\"")
    print(f"-- Luego aplicar en main DB:")
    print(f"-- sqlite3 {MAIN_DB} \"UPDATE patrones SET activo=0 WHERE id IN (SELECT id2 FROM duplicados WHERE accion='desactivar_id2');\"")


if __name__ == '__main__':
    main()
