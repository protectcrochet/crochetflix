#!/bin/bash
set -e

VPS_IP=$1

if [ -z "$VPS_IP" ]; then
  echo "❌ Falta IP del VPS"
  echo "   Uso: ./deploy/subir.sh IP_DEL_VPS"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ZIP_FILE="/tmp/crochetflix-deploy.zip"

echo ""
echo "🧶 CrochetFlix — Deploy a $VPS_IP"
echo "============================================"

# Build frontend
echo ""
echo "📦 [1/4] Build frontend..."
cd "$PROJECT_DIR/frontend"
npm run build
echo "    ✅ dist/ listo"

# Zip
echo ""
echo "🗜️  [2/4] Empaquetando..."
cd "$PROJECT_DIR"
rm -f "$ZIP_FILE"
zip -r "$ZIP_FILE" . \
  -x "*/node_modules/*" \
  -x "*/.git/*" \
  -x "*/database/*.sqlite" \
  -x "*/database/*.sqlite3" \
  -x "*/backend/database/*.sqlite" \
  -x "*/backend/database/*.sqlite3" \
  -x "*/frontend/dist/*" \
  -x "*/.DS_Store" \
  -x "*/.env" \
  -x "*/.env.local" \
  -x "*/.vscode/*" \
  -x "*/.idea/*" \
  -q
echo "    ✅ $(du -h $ZIP_FILE | cut -f1)"

# Subir
echo ""
echo "📤 [3/4] Subiendo..."
scp "$ZIP_FILE" root@$VPS_IP:/tmp/crochetflix-deploy.zip
echo "    ✅ Subido"

# Instalar
echo ""
echo "🚀 [4/4] Instalando..."
ssh root@$VPS_IP "bash -s" < "$PROJECT_DIR/deploy/instalar_vps.sh"

echo ""
echo "============================================"
echo "✅ Deploy completado!"
echo "🌐 http://$VPS_IP"
echo "📡 API: http://$VPS_IP/api/health"
echo "============================================"
echo ""
echo "⚠️  SIGUIENTES PASOS:"
echo "   1. Apunta crochetflix.app al VPS"
echo "   2. SSH: ssh root@$VPS_IP"
echo "   3. SSL: /var/www/crochetflix/deploy/setup_ssl.sh"
echo ""