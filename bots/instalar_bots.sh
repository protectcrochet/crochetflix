#!/bin/bash
# CrochetFlix - Patch bots: loop + fecha inicio 15-Jun-2026
# Los scripts originales deben existir en /root/ (ya tienen las credenciales)
set -e

PYTHON=/root/venv/bin/python3
FECHA_INICIO="2026-06-15T00:00:00+00:00"

echo "=== CrochetFlix Bot Patcher ==="
echo "Fecha de inicio: $FECHA_INICIO"
echo ""

# ── 1. Backup ─────────────────────────────────────────────────────────────────
echo "[1/4] Backup..."
cp /root/sync_patrones_vps.py /root/sync_patrones_vps.py.bak
cp /root/sync_mermaid.py      /root/sync_mermaid.py.bak
echo "    OK: backups en *.bak"

# ── 2. Fijar fecha en las BDs ─────────────────────────────────────────────────
echo "[2/4] Fijando fecha de inicio en las bases de datos..."
$PYTHON - << 'PYEOF'
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

# ── 3. Agregar loop a los scripts ─────────────────────────────────────────────
echo "[3/4] Aplicando parche (loop + fix Python 3.12)..."

patch_script() {
    local FILE=$1
    local SESSION=$2

    # Quitar el bloque final original y agregar el nuevo loop
    $PYTHON - << PYEOF
import re, sys

path = "$FILE"
session = "$SESSION"

with open(path, 'r') as f:
    content = f.read()

# Eliminar el bloque final original (from "with client:" al final)
content = re.sub(r'\nwith client:.*', '', content, flags=re.DOTALL)
content = content.rstrip() + '''

# ============ LOOP PRINCIPAL ============
import asyncio
import sqlite3 as _sq3
from datetime import datetime as _dt

_sq3.register_adapter(_dt, lambda x: x.isoformat())
_sq3.register_converter('TIMESTAMP', lambda x: _dt.fromisoformat(x.decode()))

async def main():
    while True:
        print('\\n[' + _dt.now().strftime('%Y-%m-%d %H:%M:%S') + '] Sincronizando...')
        try:
            cli = TelegramClient('$session', api_id, api_hash)
            async with cli:
                await sincronizar_patrones()
        except Exception as e:
            print('[ERROR] ' + str(e))
        print('Esperando 30 min...\\n')
        await asyncio.sleep(1800)

if __name__ == '__main__':
    asyncio.run(main())
'''

with open(path, 'w') as f:
    f.write(content)

print("    OK: " + path)
PYEOF
}

patch_script /root/sync_patrones_vps.py crochetflix_session
patch_script /root/sync_mermaid.py      mermaid_session

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
