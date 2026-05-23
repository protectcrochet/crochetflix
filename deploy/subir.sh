#!/bin/bash
# ============================================================
#  CrochetFlix — Script de deploy local
#  Uso: ./deploy/subir.sh IP_DEL_VPS
#  Ejemplo: ./deploy/subir.sh 45.33.12.100
# ============================================================

set -e

VPS_IP=$1

if [ -z "$VPS_IP" ]; then
  echo "❌ Falta la IP del VPS"
  echo "   Uso: ./deploy/subir.sh IP_DEL_VPS"
  exit 1
fi

PROJECT_DIR="/Users/jennifergarcia/Desktop/flix/crochetflix"
ZIP_FILE="/tmp/crochetflix-deploy.zip"

echo ""
echo "🧶 CrochetFlix — Deploy a $VPS_IP"
echo "============================================"

# 1. Build del frontend
echo ""
echo "📦 [1/4] Construyendo frontend..."
cd "$PROJECT_DIR/frontend"
npm run build
echo "    ✅ Build listo en frontend/dist/"

# 2. Crear zip (sin node_modules ni database)
echo ""
echo "🗜️  [2/4] Empaquetando código..."
cd "$PROJECT_DIR/.."
zip -r "$ZIP_FILE" crochetflix \
  --exclude "crochetflix/backend/node_modules/*" \
  --exclude "crochetflix/frontend/node_modules/*" \
  --exclude "crochetflix/database/*.sqlite" \
  --exclude "crochetflix/.git/*" \
  --exclude "crochetflix/backend/database/*.sqlite" \
  -q
echo "    ✅ Paquete listo: $ZIP_FILE"

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
