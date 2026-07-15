#!/usr/bin/env python3
"""
Re-extrae título, diseñadora, categoría y dificultad de los patrones
con "sin título" usando Groq Vision sobre pagina.1.jpeg / pagina_1.jpg.

Uso: python3 /root/retitular_patrones.py
Log: /root/retitular_log.txt
"""

import sqlite3
import os
import json
import time
import re
import base64
import urllib.request
import urllib.error

MAIN_DB      = '/var/www/crochetflix-app/database/crochetflix.sqlite'
UPLOADS      = '/var/www/crochetflix-app/backend/uploads/patrones'
ENV_FILE     = '/var/www/crochetflix-app/backend/.env'
LOG          = '/root/retitular_log.txt'
CATEGORIAS   = {'amigurumi', 'ropa', 'accesorios', 'hogar', 'navidad', 'otro'}
DIFICULTADES = {'principiante', 'intermedio', 'avanzado'}
GROQ_MODEL   = 'meta-llama/llama-4-scout-17b-16e-instruct'


# ── Leer claves Groq del .env ─────────────────────────────────────────────────

def leer_groq_keys():
    keys = []
    try:
        for line in open(ENV_FILE):
            line = line.strip()
            m = re.match(r'GROQ_API_KEY\w*\s*=\s*(.+)', line)
            if m:
                k = m.group(1).strip().strip('"\'')
                if k and k not in keys:
                    keys.append(k)
    except Exception as e:
        print(f'No se pudo leer {ENV_FILE}: {e}')
    if not keys:
        raise RuntimeError(f'No se encontraron claves GROQ en {ENV_FILE}')
    print(f'Claves Groq encontradas: {len(keys)}')
    return keys


# ── Encontrar primera página ──────────────────────────────────────────────────

def encontrar_pagina1(patron_id):
    d = os.path.join(UPLOADS, patron_id)
    if not os.path.isdir(d):
        return None
    for fname in ['pagina_1.jpg', 'pagina.1.jpeg', 'pagina.1.jpg', 'pagina_1.jpeg']:
        p = os.path.join(d, fname)
        if os.path.exists(p):
            return p
    return None


def imagen_a_base64(ruta, max_kb=150):
    """Redimensiona la imagen si es muy grande y la convierte a base64."""
    try:
        from PIL import Image
        import io
        img = Image.open(ruta)
        # Redimensionar a max 600px de ancho para ahorrar tokens
        if img.width > 600:
            ratio = 600 / img.width
            img = img.resize((600, int(img.height * ratio)), Image.LANCZOS)
        buf = io.BytesIO()
        img.convert('RGB').save(buf, format='JPEG', quality=70)
        data = buf.getvalue()
        # Si sigue siendo grande, reducir más
        if len(data) > max_kb * 1024:
            buf = io.BytesIO()
            img_small = img.resize((400, int(img.height * 400 / img.width)), Image.LANCZOS)
            img_small.convert('RGB').save(buf, format='JPEG', quality=60)
            data = buf.getvalue()
        return base64.b64encode(data).decode()
    except Exception:
        # Sin PIL: leer el archivo directo
        with open(ruta, 'rb') as f:
            return base64.b64encode(f.read()).decode()


# ── Llamada a Groq Vision ─────────────────────────────────────────────────────

_key_idx = 0

def groq_vision(img_b64, keys):
    global _key_idx
    prompt = """Analiza esta portada de patrón de crochet y extrae la información.
Devuelve SOLO un JSON válido con estos campos exactos:
{
  "titulo": "nombre del patrón (sin palabras como pdf, crochet, patron al inicio)",
  "diseñadora": "nombre del autor/diseñadora o null si no aparece",
  "categoria": "amigurumi|ropa|accesorios|hogar|navidad|otro",
  "dificultad": "principiante|intermedio|avanzado"
}
Responde ÚNICAMENTE con el JSON, sin explicaciones."""

    for intento in range(len(keys) * 2):
        key = keys[_key_idx % len(keys)]
        payload = json.dumps({
            'model': GROQ_MODEL,
            'messages': [{
                'role': 'user',
                'content': [
                    {'type': 'text', 'text': prompt},
                    {'type': 'image_url', 'image_url': {'url': f'data:image/jpeg;base64,{img_b64}'}},
                ]
            }],
            'temperature': 0.1,
            'max_tokens': 200,
        }).encode()

        req = urllib.request.Request(
            'https://api.groq.com/openai/v1/chat/completions',
            data=payload,
            headers={
                'Authorization': f'Bearer {key}',
                'Content-Type': 'application/json',
                'User-Agent': 'groq-python/0.11.0',
            }
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read())
            return data['choices'][0]['message']['content'].strip()
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='ignore')
            if e.code == 429:
                _key_idx += 1
                time.sleep(15)  # esperar antes de intentar siguiente key
                continue
            raise RuntimeError(f'HTTP {e.code}: {body[:300]}')
        except Exception:
            raise

    raise RuntimeError('Todos los keys de Groq agotados')


def parsear(texto):
    try:
        m = re.search(r'\{.*\}', texto, re.DOTALL)
        if not m:
            return None
        d = json.loads(m.group())
        titulo = re.sub(r'(?i)\b(pdf|crochet|patron|patrón|pattern)\b', '', d.get('titulo') or '').strip()
        titulo = re.sub(r'\s+', ' ', titulo).strip(' -_')
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
    keys = leer_groq_keys()

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

    actualizados = sin_img = fallidos = 0
    log = open(LOG, 'w', buffering=1)
    log.write(f'Total: {total}\n\n')

    for idx, (patron_id,) in enumerate(sin_titulo, 1):
        print(f'[{idx}/{total}] {patron_id}', end=' ... ', flush=True)

        img_path = encontrar_pagina1(patron_id)
        if not img_path:
            print('sin imagen')
            log.write(f'[{idx}] {patron_id} — sin imagen\n')
            sin_img += 1
            continue

        try:
            img_b64 = imagen_a_base64(img_path)
        except Exception as e:
            print(f'error imagen: {e}')
            fallidos += 1
            continue

        datos = None
        raw = None
        for intento in range(3):
            try:
                raw = groq_vision(img_b64, keys)
                datos = parsear(raw)
                break
            except Exception as e:
                err_msg = f'error Groq intento {intento+1}: {e}'
                print(err_msg)
                log.write(f'[{idx}] {patron_id} — {err_msg}\n')
                if intento < 2:
                    time.sleep(30)  # espera larga para que los keys se recuperen

        if not datos:
            if raw:
                print(f'sin datos (raw: {raw[:200]!r})')
                log.write(f'[{idx}] {patron_id} — sin datos, raw={raw[:200]}\n')
            else:
                print('sin datos (sin respuesta)')
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

        # 2s entre requests = ~30 RPM total con 2 keys (límite Groq ~30 RPM/key)
        time.sleep(2)

    conn.close()
    resumen = f'Actualizados: {actualizados} | Sin imagen: {sin_img} | Fallidos: {fallidos}'
    log.write(f'\n--- {resumen} ---\n')
    log.close()

    print(f'\n✓ {resumen}')
    print(f'Log completo: {LOG}')


if __name__ == '__main__':
    main()
