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

# Umbrales más estrictos para minimizar falsos positivos
UMBRAL_TITULO     = 0.92   # título muy similar
UMBRAL_DISENADORA = 0.70
UMBRAL_IMAGEN     = 2      # máximo 2 bits de diferencia (antes era 3)
MIN_TITULO_LEN    = 4      # ignorar títulos normalizados de menos de 4 chars


# ── Stop words (palabras que no aportan al matching) ──────────────────────────

_STOP = {
    # inglés
    'pdf', 'pattern', 'patterns', 'free', 'knit', 'knitting',
    # español
    'patron', 'patrones', 'crochet', 'gratis', 'tutorial', 'tutoriales',
    'amigurumi', 'tejido', 'tejidos', 'diseño', 'diseno',
    # artículos / preposiciones (causan falsos positivos masivos)
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
    'de', 'del', 'en', 'y', 'a', 'para', 'por', 'con', 'sin',
    'the', 'a', 'an', 'of', 'in', 'and', 'for', 'to',
}


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

def es_hash_blanco(h):
    """Hash de página en blanco tiende a ser 0 o muy alto (todos los bits iguales)."""
    bits = bin(h).count('1')
    return bits <= 2 or bits >= 62


# ── Normalización de texto ────────────────────────────────────────────────────

def normalizar(texto):
    if not texto:
        return ''
    t = texto.lower().strip()
    t = re.sub(r'[^\w\s]', ' ', t)
    t = re.sub(r'\s+', ' ', t)
    palabras = [p for p in t.split() if p not in _STOP and len(p) > 1]
    return ' '.join(palabras).strip()

def sim(a, b):
    """Similitud entre 0 y 1. Si alguno está vacío → 0 (no computable)."""
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

    result = []
    for pid, titulo, dis in rows:
        norm_t = normalizar(titulo)
        norm_d = normalizar(dis)
        # Saltar patrones sin título normalizable (principales fuente de falsos positivos)
        if len(norm_t) < MIN_TITULO_LEN:
            continue
        result.append({
            'id': pid,
            'titulo': titulo or '',
            'dis': dis or '',
            'norm_t': norm_t,
            'norm_d': norm_d,
        })
    return result


# ── Duplicados por título ─────────────────────────────────────────────────────

def duplicados_titulo(patrones):
    # Blocking por primera palabra significativa
    grupos = defaultdict(list)
    for p in patrones:
        palabras = p['norm_t'].split()
        # Usar las dos primeras palabras como clave para grupos más precisos
        if len(palabras) >= 2:
            clave = palabras[0] + '_' + palabras[1]
        else:
            clave = palabras[0]
        grupos[clave].append(p)

    encontrados = []
    vistos = set()
    total_grupos = sum(1 for g in grupos.values() if len(g) >= 2)
    procesados = 0
    grupos_grandes = 0

    for clave, grupo in grupos.items():
        if len(grupo) < 2:
            continue
        # Saltar grupos demasiado grandes (clave genérica = falsos positivos)
        if len(grupo) > 200:
            grupos_grandes += 1
            continue
        procesados += 1
        if procesados % 200 == 0:
            print(f"  Grupos: {procesados}/{total_grupos} — dups: {len(encontrados)}")

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
                # Ambos deben tener diseñadora, o ninguno la tiene
                ambos_tienen_dis = bool(p1['norm_d']) and bool(p2['norm_d'])
                if ambos_tienen_dis and sim_d < UMBRAL_DISENADORA:
                    continue

                vistos.add(par)
                encontrados.append({
                    'id1': p1['id'], 'titulo1': p1['titulo'], 'dis1': p1['dis'],
                    'id2': p2['id'], 'titulo2': p2['titulo'], 'dis2': p2['dis'],
                    'sim_titulo':  round(sim_t, 3),
                    'sim_dis':     round(sim_d, 3),
                    'dist_imagen': 99,
                    'tipo': 'titulo',
                })

    if grupos_grandes:
        print(f"  (Saltados {grupos_grandes} grupos con >200 patrones — clave demasiado genérica)")

    return encontrados, vistos


# ── Carga de hashes de imagen ─────────────────────────────────────────────────

def cargar_hashes(patrones_ids):
    hashes = {}

    try:
        conn = sqlite3.connect(BOT_DB, timeout=5)
        for patron_dir, phash_str in conn.execute(
            'SELECT patron_dir, phash FROM thumb_cache WHERE phash IS NOT NULL'
        ).fetchall():
            h = int(phash_str)
            if not es_hash_blanco(h):
                hashes[patron_dir] = h
        conn.close()
        print(f"  Hashes desde cache (sin blancos): {len(hashes)}")
    except Exception as e:
        print(f"  Cache no disponible: {e}")

    nuevos = 0
    conn_bot = None
    try:
        conn_bot = sqlite3.connect(BOT_DB, timeout=5)
        conn_bot.execute(
            'CREATE TABLE IF NOT EXISTS thumb_cache (patron_dir TEXT PRIMARY KEY, phash TEXT)'
        )
    except Exception:
        pass

    for pid in patrones_ids:
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
        if h is None or es_hash_blanco(h):
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

    print(f"  Hashes nuevos: {nuevos} | Total útiles: {len(hashes)}")
    return hashes


# ── Duplicados por imagen ─────────────────────────────────────────────────────

def duplicados_imagen(patrones, hashes, vistos_titulo):
    con_hash = [p for p in patrones if p['id'] in hashes]
    print(f"  Patrones con hash no-blanco: {len(con_hash)}")

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
           (tipo,id1,titulo1,dis1,id2,titulo2,dis2,sim_titulo,sim_dis,dist_imagen)
           VALUES (:tipo,:id1,:titulo1,:dis1,:id2,:titulo2,:dis2,:sim_titulo,:sim_dis,:dist_imagen)''',
        duplicados
    )
    conn.commit()
    conn.close()


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=== Detector de duplicados CrochetFlix ===\n")

    print("1. Cargando patrones con título válido...")
    patrones = cargar_patrones()
    print(f"   {len(patrones)} patrones con título normalizable\n")

    print("2. Buscando duplicados por título+diseñadora (umbral 0.92)...")
    dups_t, vistos = duplicados_titulo(patrones)
    print(f"   Encontrados: {len(dups_t)}\n")

    print("3. Cargando hashes de imagen (excluyendo páginas en blanco)...")
    ids = [p['id'] for p in patrones]
    hashes = cargar_hashes(ids)
    print()

    print("4. Buscando duplicados por imagen (umbral ≤2 bits)...")
    dups_i = duplicados_imagen(patrones, hashes, vistos)
    print(f"   Encontrados adicionales: {len(dups_i)}\n")

    todos = dups_t + dups_i
    print(f"5. Guardando reporte en {REPORTE_DB}...")
    guardar_reporte(todos)

    print(f"\n✓ Listo — {len(todos)} pares sospechosos\n")
    print("── Ver resumen ────────────────────────────────────────────────────")
    print(f'sqlite3 {REPORTE_DB} "SELECT tipo, COUNT(*) FROM duplicados GROUP BY tipo;"')
    print()
    print("── Ver duplicados de título (más confiables) ──────────────────────")
    print(f'sqlite3 {REPORTE_DB} "SELECT titulo1,dis1,titulo2,dis2,sim_titulo FROM duplicados WHERE tipo=\'titulo\' ORDER BY sim_titulo DESC LIMIT 30;"')
    print()
    print("── Ver duplicados de imagen (dist=0 = idénticos) ──────────────────")
    print(f'sqlite3 {REPORTE_DB} "SELECT titulo1,dis1,titulo2,dis2,dist_imagen FROM duplicados WHERE tipo=\'imagen\' ORDER BY dist_imagen LIMIT 30;"')
    print()
    print("── Desactivar duplicados de título con >97% similitud (REVISAR) ───")
    print(f'sqlite3 {REPORTE_DB} "UPDATE duplicados SET accion=\'desactivar_id2\' WHERE sim_titulo >= 0.97;"')
    print(f'-- Aplicar: sqlite3 {MAIN_DB} "UPDATE patrones SET activo=0 WHERE id IN (SELECT id2 FROM duplicados WHERE accion=\'desactivar_id2\');"')


if __name__ == '__main__':
    main()
