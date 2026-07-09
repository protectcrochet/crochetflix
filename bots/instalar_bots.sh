#!/bin/bash
# CrochetFlix - Patch bots: loop + fecha inicio 15-Jun-2026
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
echo "[3/4] Aplicando parche (loop correcto)..."

$PYTHON << 'PYEOF'
import re

# Loop para sync_patrones_vps.py
LOOP_VPS = (
    '\n\n'
    '# ============ LOOP PRINCIPAL ============\n'
    'import asyncio\n'
    'import sqlite3 as _sq3\n'
    'from datetime import datetime as _dt\n'
    '\n'
    '_sq3.register_adapter(_dt, lambda x: x.isoformat())\n'
    "_sq3.register_converter('TIMESTAMP', lambda x: _dt.fromisoformat(x.decode()))\n"
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
    "        print('Esperando 30 min...')\n"
    '        await asyncio.sleep(1800)\n'
    '\n'
    "if __name__ == '__main__':\n"
    '    asyncio.run(main())\n'
)

LOOP_MERMAID = LOOP_VPS.replace('/root/crochetflix_session', '/root/mermaid_session')

pairs = [
    ('/root/sync_patrones_vps.py', LOOP_VPS),
    ('/root/sync_mermaid.py',      LOOP_MERMAID),
]

for path, loop in pairs:
    with open(path, 'r') as f:
        content = f.read()

    # Eliminar loop roto anterior (si ya se parcheó antes)
    content = re.sub(r'\n# ============ LOOP PRINCIPAL.*', '', content, flags=re.DOTALL)
    # Eliminar bloque "with client:" original
    content = re.sub(r'\nwith client:.*', '', content, flags=re.DOTALL)
    # Eliminar conn.close() final
    content = re.sub(r'\nconn\.close\(\)\s*$', '', content.rstrip())

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
echo "LISTO. Bots arrancados."
echo "Solo descargarán patrones del 15 Jun 2026 en adelante."
echo "=============================="
pm2 status
