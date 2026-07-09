#!/usr/bin/env python3
"""
Limpia títulos y diseñadoras con valor 'Telegram' u otros placeholders.
Pone NULL para que el script de enriquecimiento los rellene correctamente.

Uso:
    python3 limpiar_telegram.py
"""

import sqlite3
import os

DB_RUTAS = [
    '/var/www/crochetflix-app/database/crochetflix.sqlite',
    '/var/www/crochetflix-app/backend/database/crochetflix.sqlite',
    '/var/www/crochetflix-app/backend/crochetflix.db',
    '/var/www/crochetflix-app/backend/database.sqlite',
]

TITULOS_MALOS = (
    'telegram', 'sin título', 'sin titulo', 'untitled',
    'pattern', 'crochet', 'amigurumi', 'patron', 'n/a',
    'diseñadora', 'autor', 'autora', 'file', 'pdf',
)

DIS_MALAS = (
    'telegram', 'diseñadora', 'autor', 'autora', 'desconocida',
    'unknown', 'n/a', 'sin nombre', 'file', 'pdf',
)


def encontrar_db():
    for p in DB_RUTAS:
        if os.path.exists(p):
            return p
    return None


def main():
    db_path = encontrar_db()
    if not db_path:
        print('ERROR: No se encontró la base de datos.')
        return

    print('Base de datos:', db_path)
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    placeholders_t = ','.join('?' * len(TITULOS_MALOS))
    placeholders_d = ','.join('?' * len(DIS_MALAS))

    # Limpiar títulos malos
    cur.execute(
        f"UPDATE patrones SET titulo = NULL WHERE activo = 1 AND LOWER(titulo) IN ({placeholders_t})",
        TITULOS_MALOS
    )
    titulos_limpiados = cur.rowcount
    print(f'Títulos limpiados (→ NULL): {titulos_limpiados}')

    # Limpiar diseñadoras malas
    cur.execute(
        f"UPDATE patrones SET diseñadora = NULL WHERE activo = 1 AND LOWER(diseñadora) IN ({placeholders_d})",
        DIS_MALAS
    )
    dis_limpiadas = cur.rowcount
    print(f'Diseñadoras limpiadas (→ NULL): {dis_limpiadas}')

    conn.commit()
    conn.close()

    print()
    print('✅ Listo. Ahora ejecuta:')
    print('   python3 enriquecer_patrones.py &')


if __name__ == '__main__':
    main()
