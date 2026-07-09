#!/bin/bash
# CrochetFlix - Patch bots: loop + fecha inicio 15-Jun-2026 + procesamiento auto PDFs
set -e

PYTHON=/root/venv/bin/python3
FECHA_INICIO="2026-06-15T00:00:00+00:00"

echo "=== CrochetFlix Bot Patcher ==="
echo "Fecha de inicio: $FECHA_INICIO"
echo ""

# ── 1. Backup ─────────────────────────────────────────────────────────────────
echo "[1/4] Backup..."
cp /root/sync_patrones_vps.py /root/sync_patrones_vps.orig.bak 2>/dev/null || true
cp /root/sync_mermaid.py      /root/sync_mermaid.orig.bak      2>/dev/null || true
echo "    OK"

# ── 2. Fijar fecha en las BDs ─────────────────────────────────────────────────
echo "[2/4] Fijando fecha de inicio en las bases de datos..."
$PYTHON << 'PYEOF'
import sqlite3
FECHA = "2026-06-15T00:00:00+00:00"
for db in ['/root/crochetflix.db', '/root/mermaid.db']:
    try:
        conn = sqlite3.connect(db)
        conn.execute('''CREATE TABLE IF NOT EXISTS sync_log (
            id INTEGER PRIMARY KEY, ultima_fecha TEXT, total_descargados INTEGER)''')
        conn.execute('''INSERT INTO sync_log (id, ultima_fecha, total_descargados) VALUES (1,?,0)
            ON CONFLICT(id) DO UPDATE SET ultima_fecha=excluded.ultima_fecha''', (FECHA,))
        conn.commit()
        conn.close()
        print("    OK: " + db)
    except Exception as e:
        print("    ERROR " + db + ": " + str(e))
PYEOF

# ── 3. Parchar scripts usando Python con concatenacion de strings ──────────────
echo "[3/4] Aplicando parche (loop + procesamiento auto de PDFs)..."

$PYTHON << 'PYEOF'
import re

LOOP_VPS = (
    '\n\n'
    '# ============ LOOP PRINCIPAL ============\n'
    'import asyncio\n'
    'import sqlite3 as _sq3\n'
    'from datetime import datetime as _dt\n'
    'from datetime import timezone as _tz\n'
    'import glob as _glob\n'
    'try:\n'
    '    import requests as _req\n'
    'except ImportError:\n'
    '    _req = None\n'
    '\n'
    '# Nunca descargar patrones anteriores al 15 Jun 2026\n'
    'FECHA_MINIMA = _dt(2026, 6, 15, tzinfo=_tz.utc)\n'
    '\n'
    '_sq3.register_adapter(_dt, lambda x: x.isoformat())\n'
    "_sq3.register_converter('TIMESTAMP', lambda x: _dt.fromisoformat(x.decode()))\n"
    '\n'
    'def _obtener_fecha_inicio():\n'
    "    _c = _sq3.connect('/root/crochetflix.db', timeout=10)\n"
    "    _r = _c.execute('SELECT ultima_fecha FROM sync_log WHERE id=1').fetchone()\n"
    '    _c.close()\n'
    '    if _r and _r[0]:\n'
    '        _d = _dt.fromisoformat(_r[0])\n'
    '        return _d if _d.tzinfo else _d.replace(tzinfo=_tz.utc)\n'
    '    return FECHA_MINIMA\n'
    '\n'
    'def _leer_admin_secret():\n'
    '    try:\n'
    "        with open('/var/www/crochetflix-app/backend/.env') as _f:\n"
    '            for _line in _f:\n'
    "                if _line.startswith('ADMIN_SECRET='):\n"
    "                    return _line.strip().split('=', 1)[1]\n"
    '    except Exception:\n'
    '        pass\n'
    '    return None\n'
    '\n'
    'def procesar_pdfs_nuevos():\n'
    '    if _req is None:\n'
    "        print('[PROC] requests no disponible, omitir procesamiento')\n"
    '        return\n'
    '    _secret = _leer_admin_secret()\n'
    '    if not _secret:\n'
    "        print('[PROC] ADMIN_SECRET no encontrado')\n"
    '        return\n'
    "    _vps = '/var/www/crochetflix-app/backend/uploads/patrones/'\n"
    "    _pdfs = _glob.glob(_vps + '*.pdf')\n"
    '    if not _pdfs:\n'
    "        print('[PROC] Sin PDFs nuevos')\n"
    '        return\n'
    "    print('[PROC] ' + str(len(_pdfs)) + ' PDFs a procesar')\n"
    "    _h = {'x-admin-secret': _secret}\n"
    '    for _pdf in _pdfs:\n'
    '        try:\n'
    "            with open(_pdf, 'rb') as _f:\n"
    "                _r = _req.post('http://localhost:3001/api/admin/patrones/analizar',\n"
    "                    headers=_h, files={'pdf': (os.path.basename(_pdf), _f, 'application/pdf')},\n"
    '                    timeout=60)\n'
    '            if _r.status_code != 200:\n'
    "                print('[PROC] Error analisis ' + str(_r.status_code))\n"
    '                continue\n'
    '            _a = _r.json()\n'
    "            _dups = [d for d in _a.get('duplicados', []) if d.get('similitud', 0) >= 0.95]\n"
    '            if _dups:\n'
    "                print('[PROC] Duplicado: ' + os.path.basename(_pdf))\n"
    '                os.remove(_pdf)\n'
    '                continue\n'
    "            _titulo = _a.get('titulo') or os.path.basename(_pdf).replace('.pdf', '').replace('_', ' ')\n"
    "            _cat = _a.get('categoria') or 'otro'\n"
    "            _sub = _a.get('subcategoria') or ''\n"
    "            _lang = _a.get('idioma') or 'es'\n"
    "            _dis = _a.get('diseñadora') or ''\n"
    "            print('[PROC] Subiendo: ' + _titulo)\n"
    "            with open(_pdf, 'rb') as _f:\n"
    "                _r2 = _req.post('http://localhost:3001/api/admin/patrones',\n"
    "                    headers=_h, files={'pdf': (os.path.basename(_pdf), _f, 'application/pdf')},\n"
    "                    data={'titulo': _titulo, 'categoria': _cat, 'subcategoria': _sub,\n"
    "                          'idioma': _lang, 'diseñadora': _dis, 'dificultad': 'principiante'},\n"
    '                    timeout=120)\n'
    '            if _r2.status_code in (200, 409):\n'
    "                print('[PROC] OK: ' + _titulo)\n"
    '                os.remove(_pdf)\n'
    '            else:\n'
    "                print('[PROC] Error ' + str(_r2.status_code) + ': ' + _r2.text[:80])\n"
    '        except Exception as _e:\n'
    "            print('[PROC] Excepcion: ' + str(_e))\n"
    '\n'
    'async def main():\n'
    '    global client\n'
    '    while True:\n'
    "        print('[' + _dt.now().strftime('%Y-%m-%d %H:%M:%S') + '] Sincronizando...')\n"
    '        try:\n'
    "            client = TelegramClient('/root/crochetflix_session', api_id, api_hash)\n"
    '            async with client:\n'
    '                await sincronizar_patrones()\n'
    '        except Exception as e:\n'
    "            print('[ERROR] ' + str(e))\n"
    '        procesar_pdfs_nuevos()\n'
    "        print('Esperando 30 min...')\n"
    '        await asyncio.sleep(1800)\n'
    '\n'
    "if __name__ == '__main__':\n"
    '    asyncio.run(main())\n'
)

LOOP_MERMAID = (
    LOOP_VPS
    .replace('/root/crochetflix_session', '/root/mermaid_session')
    .replace("'/root/crochetflix.db'", "'/root/mermaid.db'")
)

pairs = [
    ('/root/sync_patrones_vps.py', LOOP_VPS),
    ('/root/sync_mermaid.py',      LOOP_MERMAID),
]

for path, loop in pairs:
    with open(path, 'r') as f:
        content = f.read()

    # Eliminar loop roto/anterior
    content = re.sub(r'\n# ============ LOOP PRINCIPAL.*', '', content, flags=re.DOTALL)
    # Eliminar bloque "with client:" original
    content = re.sub(r'\nwith client:.*', '', content, flags=re.DOTALL)
    # Eliminar conn.close() final si queda
    content = re.sub(r'\nconn\.close\(\)\s*$', '', content.rstrip())

    # Parchear obtener_ultima_fecha para que nunca devuelva antes de FECHA_MINIMA
    content = content.replace(
        '    return None\n',
        '    return FECHA_MINIMA\n',
        1
    )

    content = content.rstrip() + loop

    with open(path, 'w') as f:
        f.write(content)

    print('    OK: ' + path)
PYEOF

# ── 4. Reiniciar PM2 ──────────────────────────────────────────────────────────
echo "[4/4] Reiniciando bots en PM2..."
pm2 delete telegram-bot     2>/dev/null || true
pm2 delete telegram-mermaid 2>/dev/null || true

pm2 start /root/sync_patrones_vps.py \
    --name telegram-bot \
    --interpreter $PYTHON \
    --restart-delay 10000

pm2 start /root/sync_mermaid.py \
    --name telegram-mermaid \
    --interpreter $PYTHON \
    --restart-delay 10000

pm2 save

echo ""
echo "=============================="
echo "LISTO. Bots arrancados con procesamiento automatico."
echo "- Solo patrones del 15 Jun 2026 en adelante."
echo "- PDFs se convierten a imagenes y se registran en BD."
echo "=============================="
pm2 status
