#!/bin/bash
# ============================================
#  CrochetFlix — Script de deploy local (Mac)
#  Uso: ./deploy/subir.sh IP_DEL_VPS
#  Ejemplo: ./deploy/subir.sh 185.123.456.78
# ============================================

set -e

VPS_IP=$1

if [ -z "$VPS_IP" ]; then
  echo "❌ Falta la IP del VPS"
  echo "   Uso: ./deploy/subir.sh IP_DEL_VPS"
  exit 1
fi

# Detectar directorio del proyecto
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ZIP_FILE="/tmp/crochetflix-deploy.zip"

echo ""
echo "🧶 CrochetFlix — Deploy a $VPS_IP"
echo "============================================"
echo "📁 Proyecto: $PROJECT_DIR"

# 1. Build del frontend
echo ""
echo "📦 [1/4] Construyendo frontend..."
cd "$PROJECT_DIR/frontend"
npm run build
echo "    ✅ Build listo en frontend/dist/"

# 2. Crear zip (sin node_modules, database, .git)
echo ""
echo "🗜️  [2/4] Empaquetando código..."
cd "$PROJECT_DIR"

# Verificar que estamos en el directorio correcto
if [ ! -f "backend/server.js" ] || [ ! -f "frontend/package.json" ]; then
    echo "❌ No se encontró estructura de CrochetFlix en $PROJECT_DIR"
    exit 1
fi

rm -f "$ZIP_FILE"
zip -r "$ZIP_FILE" .   -x "*/node_modules/*"   -x "*/.git/*"   -x "*/database/*.sqlite"   -x "*/database/*.sqlite3"   -x "*/backend/database/*.sqlite"   -x "*/backend/database/*.sqlite3"   -x "*/frontend/dist/*"   -x "*/.DS_Store"   -x "*/.env"   -x "*/.env.local"   -x "*/.vscode/*"   -x "*/.idea/*"   -q

echo "    ✅ Paquete listo: $ZIP_FILE"
echo "    📊 Tamaño: $(du -h $ZIP_FILE | cut -f1)"

# 3. Subir al VPS
echo ""
echo "📤 [3/4] Subiendo al VPS $VPS_IP..."
scp "$ZIP_FILE" root@$VPS_IP:/tmp/crochetflix-deploy.zip
echo "    ✅ Subida completada"

# 4. Ejecutar instalación remota
echo ""
echo "🚀 [4/4] Instalando en el VPS..."
ssh root@$VPS_IP "bash -s" < "$PROJECT_DIR/deploy/instalar_vps.sh"

echo ""
echo "============================================"
echo "✅ ¡Deploy completado!"
echo "🌐 Tu app está en: http://$VPS_IP"
echo "📡 API en:         http://$VPS_IP/api/health"
echo "============================================"
echo ""
echo "⚠️  SIGUIENTES PASOS:"
echo "   1. Apunta crochetflix.app al VPS en OrangeWebsite DNS"
echo "   2. SSH al VPS: ssh root@$VPS_IP"
echo "   3. Ejecuta:    ./deploy/setup_ssl.sh"
echo "   4. Cambia JWT_SECRET en /var/www/crochetflix/backend/.env"
echo ""
