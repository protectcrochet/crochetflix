#!/bin/bash
# ============================================
# CrochetFlix — Backup automático de SQLite
# Se ejecuta diariamente via cron
# ============================================

set -e

APP_DIR="/var/www/crochetflix"
DB_PATH="$APP_DIR/backend/database/crochetflix.sqlite"
BACKUP_DIR="/var/backups/crochetflix"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=7

# Crear directorio de backups
mkdir -p "$BACKUP_DIR"

# Verificar que la BD existe
if [ ! -f "$DB_PATH" ]; then
    echo "❌ Base de datos no encontrada: $DB_PATH"
    exit 1
fi

# Backup con SQLite (copia consistente)
echo "💾 Creando backup: $DATE"
sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/crochetflix_$DATE.sqlite'"

# Comprimir
gzip -f "$BACKUP_DIR/crochetflix_$DATE.sqlite"
echo "✅ Backup creado: crochetflix_$DATE.sqlite.gz"

# Backup de uploads (patrones)
if [ -d "$APP_DIR/backend/uploads" ]; then
    tar -czf "$BACKUP_DIR/uploads_$DATE.tar.gz" -C "$APP_DIR/backend" uploads/
    echo "✅ Uploads backup: uploads_$DATE.tar.gz"
fi

# Limpiar backups antiguos (> 7 días)
echo "🧹 Limpiando backups antiguos..."
find "$BACKUP_DIR" -name "crochetflix_*.sqlite.gz" -mtime +$RETENTION_DAYS -delete
find "$BACKUP_DIR" -name "uploads_*.tar.gz" -mtime +$RETENTION_DAYS -delete
echo "✅ Limpieza completada"

# Mostrar espacio usado
echo ""
echo "📊 Uso de backup:"
du -sh "$BACKUP_DIR"

echo ""
echo "============================================"
echo "✅ Backup completado: $(date)"
echo "============================================"
