#!/usr/bin/env python3
"""
Enriquecer patrones existentes sin título o diseñadora
usando Groq visión sobre las imágenes ya convertidas.

Uso:
    python3 enriquecer_patrones.py              # todos
    python3 enriquecer_patrones.py --limit 100  # solo 100
"""

import sqlite3
import os
import sys
import base64
import json
import time

try:
    import requests as _req
except ImportError:
    _req = None

ENV_PATH   = '/var/www/crochetflix-app/backend/.env'
UPLOADS    = '/var/www/crochetflix-app/backend/uploads/patrones/'
DB_RUTAS   = [
    '/var/www/crochetflix-app/database/crochetflix.sqlite',
    '/var/www/crochetflix-app/backend/database/crochetflix.sqlite',
    '/var/www/crochetflix-app/backend/crochetflix.db',
    '/var/www/crochetflix-app/backend/database.sqlite',
]


def leer_groq_key():
    try:
        with open(ENV_PATH) as f:
            for line in f:
                if line.strip().startswith('GROQ_API_KEY='):
                    return line.strip().split('=', 1)[1]
    except Exception as e:
        print('Error leyendo .env:', e)
    return None


def encontrar_db():
    for p in DB_RUTAS:
        if os.path.exists(p):
            return p
    return None


def b64(path):
    try:
        with open(path, 'rb') as f:
            return base64.b64encode(f.read()).decode()
    except Exception:
        return None


VISION_MODELS = [
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'llama-3.2-90b-vision-preview',
    'llama-3.2-11b-vision-preview',
]


def groq_vision(api_key, imagenes):
    if _req is None:
        print('    [error] requests no instalado')
        return None

    contenido = [{'type': 'text', 'text': (
        'Estas son páginas de un patrón de crochet. '
        'Extrae: 1) Título exacto del patrón 2) Nombre del/la diseñador/a. '
        'Si no encuentras alguno pon null. '
        'Responde SOLO con JSON válido: {"titulo": "...", "diseñadora": "..."}'
    )}]
    for img in imagenes:
        contenido.append({
            'type': 'image_url',
            'image_url': {'url': 'data:image/jpeg;base64,' + img}
        })

    for modelo in VISION_MODELS:
        try:
            resp = _req.post(
                'https://api.groq.com/openai/v1/chat/completions',
                headers={
                    'Authorization': 'Bearer ' + api_key,
                    'Content-Type': 'application/json',
                },
                json={
                    'model': modelo,
                    'messages': [{'role': 'user', 'content': contenido}],
                    'temperature': 0.1,
                    'max_tokens': 150,
                },
                timeout=40
            )
            if resp.status_code != 200:
                print(f'    [Groq {modelo} → {resp.status_code}]', resp.text[:150])
                continue
            texto = resp.json()['choices'][0]['message']['content'].strip()
            i = texto.find('{')
            j = texto.rfind('}') + 1
            if i >= 0 and j > i:
                return json.loads(texto[i:j])
        except Exception as e:
            print(f'    [Groq {modelo} error]', e)

    return None


def primeras_paginas(patron_id, n=3):
    d = os.path.join(UPLOADS, patron_id)
    if not os.path.isdir(d):
        return []
    imgs = []
    for k in range(1, n + 1):
        data = b64(os.path.join(d, f'pagina_{k}.jpg'))
        if data:
            imgs.append(data)
        else:
            break
    return imgs


def ultimas_paginas(patron_id, n=2):
    d = os.path.join(UPLOADS, patron_id)
    if not os.path.isdir(d):
        return []
    archivos = sorted(
        [f for f in os.listdir(d) if f.startswith('pagina_') and f.endswith('.jpg')],
        key=lambda x: int(x.replace('pagina_', '').replace('.jpg', ''))
    )
    imgs = []
    for f in archivos[-n:]:
        data = b64(os.path.join(d, f))
        if data:
            imgs.append(data)
    return imgs


def main():
    limite = None
    if '--limit' in sys.argv:
        idx = sys.argv.index('--limit')
        if idx + 1 < len(sys.argv):
            limite = int(sys.argv[idx + 1])

    api_key = leer_groq_key()
    if not api_key:
        print('ERROR: GROQ_API_KEY no encontrado en', ENV_PATH)
        return

    db_path = encontrar_db()
    if not db_path:
        print('ERROR: No se encontró la base de datos. Busca con:')
        print('  find /var/www -name "*.sqlite" -o -name "*.db" 2>/dev/null | grep -v node_modules')
        return

    print('Base de datos:', db_path)
    conn = sqlite3.connect(db_path)
    cur  = conn.cursor()

    cur.execute("""
        SELECT id, titulo, diseñadora FROM patrones
        WHERE activo = 1
          AND (titulo IS NULL OR titulo = ''
               OR diseñadora IS NULL OR diseñadora = '')
        ORDER BY created_at DESC
    """)
    todos = cur.fetchall()
    if limite:
        todos = todos[:limite]

    total = len(todos)
    print(f'Patrones a enriquecer: {total}')
    if total > 200:
        print(f'Tiempo estimado: ~{total * 2 // 60} min (2 s/patrón)')
    print()

    actualizados  = 0
    sin_imagenes  = 0

    for i, (pid, titulo, dis) in enumerate(todos, 1):
        print(f'[{i}/{total}] {pid}')
        print(f'  titulo={titulo or "(vacío)"}  diseñadora={dis or "(vacío)"}')

        imgs = primeras_paginas(pid, n=3)
        if not imgs:
            print('  → sin imágenes, saltando')
            sin_imagenes += 1
            continue

        res = groq_vision(api_key, imgs)
        time.sleep(1)

        # Si faltan datos, probar últimas páginas
        if res and (not res.get('titulo') or not res.get('diseñadora')):
            imgs_fin = ultimas_paginas(pid, n=2)
            if imgs_fin:
                res2 = groq_vision(api_key, imgs_fin)
                time.sleep(1)
                if res2:
                    if not res.get('titulo') and res2.get('titulo'):
                        res['titulo'] = res2['titulo']
                    if not res.get('diseñadora') and res2.get('diseñadora'):
                        res['diseñadora'] = res2['diseñadora']

        if not res:
            print('  → Groq sin respuesta')
            continue

        nuevo_titulo = res.get('titulo')
        nueva_dis    = res.get('diseñadora')
        print(f'  → titulo="{nuevo_titulo}"  diseñadora="{nueva_dis}"')

        campos, vals = [], []
        if nuevo_titulo and not titulo:
            campos.append('titulo = ?')
            vals.append(nuevo_titulo)
        if nueva_dis and not dis:
            campos.append('diseñadora = ?')
            vals.append(nueva_dis)

        if campos:
            vals.append(pid)
            cur.execute(f'UPDATE patrones SET {", ".join(campos)} WHERE id = ?', vals)
            conn.commit()
            actualizados += 1
            print('  ✅ actualizado')
        else:
            print('  — sin cambios')

    conn.close()
    print(f'\n{"="*50}')
    print(f'Procesados : {total}')
    print(f'Actualizados: {actualizados}')
    print(f'Sin imágenes: {sin_imagenes}')
    print('='*50)


if __name__ == '__main__':
    main()
