#!/usr/bin/env python3
"""
Re-extrae título, diseñadora, categoría y dificultad de los patrones
que tienen "sin título" o título nulo usando Cerebras + pdftotext/fitz.

Uso: python3 /root/retitular_patrones.py
Log: /root/retitular_log.txt
"""

import sqlite3
import os
import json
import time
import subprocess
import re
import urllib.request

MAIN_DB      = '/var/www/crochetflix-app/database/crochetflix.sqlite'
UPLOADS      = '/var/www/crochetflix-app/backend/uploads/patrones'
BOT_SCRIPT   = '/root/sync_patrones_vps.py'
LOG          = '/root/retitular_log.txt'
CATEGORIAS   = {'amigurumi', 'ropa', 'accesorios', 'hogar', 'navidad', 'otro'}
DIFICULTADES = {'principiante', 'intermedio', 'avanzado'}


# ── Leer API key del bot (nunca va al repo) ───────────────────────────────────

def leer_api_key():
    key = os.environ.get('CEREBRAS_KEY')
    if key:
        return key
    try:
        for line in open(BOT_SCRIPT):
            m = re.search(r"CEREBRAS_API_KEY_BOT\s*=\s*'([^']+)'", line)
            if m:
                return m.group(1)
    except Exception:
        pass
    raise RuntimeError('No se encontró CEREBRAS_KEY. Exporta: export CEREBRAS_KEY="csk-..."')


# ── Extracción de texto del PDF ───────────────────────────────────────────────

def extraer_texto_pdf(ruta_pdf):
    try:
        texto = subprocess.check_output(
            ['pdftotext', '-f', '1', '-l', '3', ruta_pdf, '-'],
            timeout=15, stderr=subprocess.DEVNULL
        ).decode('utf-8', errors='ignore').strip()
        if len(texto) >= 80:
            return texto[:4000]
    except Exception:
        pass
    try:
        import fitz
        doc = fitz.open(ruta_pdf)
        texto = ''.join(doc[i].get_text() for i in range(min(3, len(doc)))).strip()
        doc.close()
        if len(texto) >= 80:
            return texto[:4000]
    except Exception:
        pass
    return ''


def encontrar_pdf(patron_id):
    d = os.path.join(UPLOADS, patron_id)
    if not os.path.isdir(d):
        return None
    for f in os.listdir(d):
        if f.lower().endswith('.pdf'):
            return os.path.join(d, f)
    return None


# ── Llamada a Cerebras ────────────────────────────────────────────────────────

def cerebras_extraer(contenido, es_nombre=False, api_key=''):
    if es_nombre:
        ctx = f'Nombre del archivo: "{contenido}"'
    else:
        ctx = f'Texto del patrón:\n{contenido}'

    prompt = f"""Analiza este patrón de crochet y extrae la información.

{ctx}

Devuelve SOLO un JSON válido con estos campos:
{{
  "titulo": "nombre del patrón (sin palabras como pdf, crochet, patron al inicio)",
  "diseñadora": "nombre del autor/diseñadora, o null si no se menciona",
  "categoria": "amigurumi|ropa|accesorios|hogar|navidad|otro",
  "dificultad": "principiante|intermedio|avanzado"
}}

Responde ÚNICAMENTE con el JSON."""

    payload = json.dumps({
        'model': 'llama-3.3-70b',
        'messages': [{'role': 'user', 'content': prompt}],
        'temperature': 0.1,
        'max_tokens': 200,
    }).encode()

    req = urllib.request.Request(
        'https://api.cerebras.ai/v1/chat/completions',
        data=payload,
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
        }
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
    return data['choices'][0]['message']['content'].strip()


def parsear(texto):
    try:
        m = re.search(r'\{.*\}', texto, re.DOTALL)
        if not m:
            return None
        d = json.loads(m.group())
        titulo = re.sub(r'(?i)\b(pdf|crochet|patron|patrón|pattern)\b', '', d.get('titulo') or '').strip(' -_')
        titulo = re.sub(r'\s+', ' ', titulo).strip()
        if len(titulo) < 2:
            return None
        dis = (d.get('diseñadora') or '').strip() or None
        cat = (d.get('categoria') or 'otro').lower()
        dif = (d.get('dificultad') or 'intermedio').lower()
        return {
            'titulo': titulo,
            'diseñadora': dis,
            'categoria': cat if cat in CATEGORIAS else 'otro',
            'dificultad': dif if dif in DIFICULTADES else 'intermedio',
        }
    except Exception:
        return None


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    api_key = leer_api_key()
    print(f'API key: {api_key[:12]}...')

    conn = sqlite3.connect(MAIN_DB, timeout=15)
    c = conn.cursor()

    cols = [r[1] for r in c.execute('PRAGMA table_info(patrones)').fetchall()]
    dis_col = next((col for col in cols if 'disen' in col.lower()), None)

    sin_titulo = c.execute("""
        SELECT id FROM patrones
        WHERE activo=1 AND (
            titulo IS NULL OR TRIM(titulo) = '' OR
            LOWER(TRIM(titulo)) IN (
                'sin titulo','sin título','sin titulo ','sin título ',
                'sin_titulo','null','none','untitled'
            )
        )
        ORDER BY created_at ASC
    """).fetchall()

    total = len(sin_titulo)
    print(f'Patrones a retitular: {total}\n')

    actualizados = sin_pdf = fallidos = 0
    log = open(LOG, 'w', buffering=1)
    log.write(f'Total: {total}\n\n')

    for idx, (patron_id,) in enumerate(sin_titulo, 1):
        print(f'[{idx}/{total}] {patron_id}', end=' ... ', flush=True)

        pdf = encontrar_pdf(patron_id)
        if not pdf:
            print('sin PDF')
            log.write(f'[{idx}] {patron_id} — sin PDF\n')
            sin_pdf += 1
            continue

        texto = extraer_texto_pdf(pdf)
        nombre = os.path.basename(pdf).replace('.pdf', '').replace('_', ' ').replace('-', ' ')

        datos = None
        for intento in range(3):
            try:
                raw = cerebras_extraer(texto if texto else nombre, es_nombre=not texto, api_key=api_key)
                datos = parsear(raw)
                break
            except Exception as e:
                if intento < 2:
                    time.sleep(2 ** intento)
                else:
                    log.write(f'[{idx}] {patron_id} — error: {e}\n')

        if not datos:
            print('sin datos')
            fallidos += 1
            continue

        try:
            if dis_col:
                c.execute(
                    f'UPDATE patrones SET titulo=?, "{dis_col}"=?, categoria=?, dificultad=? WHERE id=?',
                    (datos['titulo'], datos['diseñadora'], datos['categoria'], datos['dificultad'], patron_id)
                )
            else:
                c.execute(
                    'UPDATE patrones SET titulo=?, categoria=?, dificultad=? WHERE id=?',
                    (datos['titulo'], datos['categoria'], datos['dificultad'], patron_id)
                )
            conn.commit()
            actualizados += 1
            print(f"→ {datos['titulo']} / {datos['diseñadora'] or '—'} [{datos['categoria']}]")
            log.write(f"[{idx}] OK → {datos['titulo']} / {datos['diseñadora'] or '—'} [{datos['categoria']}]\n")
        except Exception as e:
            conn.rollback()
            print(f'error DB: {e}')
            fallidos += 1
            log.write(f'[{idx}] {patron_id} — error DB: {e}\n')

        time.sleep(0.3)

    conn.close()
    log.write(f'\n--- Actualizados: {actualizados} | Sin PDF: {sin_pdf} | Fallidos: {fallidos} ---\n')
    log.close()

    print(f'\n✓ Actualizados: {actualizados} | Sin PDF: {sin_pdf} | Fallidos: {fallidos}')
    print(f'Log completo: {LOG}')


if __name__ == '__main__':
    main()
