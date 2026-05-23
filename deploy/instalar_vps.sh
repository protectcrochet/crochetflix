#!/bin/bash
# ============================================================
#  CrochetFlix — Script que corre EN el VPS
#  Lo ejecuta subir.sh automáticamente via SSH
# ============================================================

set -e

APP_DIR="/var/www/crochetflix"

echo ""
echo "--- Instalando dependencias del sistema ---"

# Node.js 20
if ! command -v node &> /dev/null; then
  echo "📦 Instalando Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "✅ Node.js $(node -v) ya instalado"
fi

# PM2
if ! command -v pm2 &> /dev/null; then
  echo "📦 Instalando PM2..."
  npm install -g pm2 -q
else
  echo "✅ PM2 ya instalado"
fi

# Nginx
if ! command -v nginx &> /dev/null; then
  echo "📦 Instalando Nginx..."
  apt-get install -y nginx
  systemctl enable nginx
  systemctl start nginx
else
  echo "✅ Nginx ya instalado"
fi

# Unzip
apt-get install -y unzip -qq

echo ""
echo "--- Desplegando código ---"

# Limpiar y extraer
rm -rf "$APP_DIR"
mkdir -p /var/www
unzip -o /tmp/crochetflix-deploy.zip -d /var/www/ -q
mv /var/www/crochetflix "$APP_DIR" 2>/dev/null || true

# Instalar dependencias backend
echo "📦 Instalando dependencias backend..."
cd "$APP_DIR/backend"
npm install --production -q

# Base de datos (crear si no existe)
mkdir -p "$APP_DIR/backend/database"
if [ ! -f "$APP_DIR/backend/database/crochetflix.sqlite" ]; then
  echo "🗄️  Inicializando base de datos..."
  node src/models/index.js
  NODE_PATH="$APP_DIR/backend/node_modules" node "$APP_DIR/scripts/seed.js"
fi

# Actualizar BACKEND_URL en .env con IP real del servidor
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
sed -i "s|BACKEND_URL=.*|BACKEND_URL=http://$SERVER_IP:3001|g" "$APP_DIR/backend/.env"
sed -i "s|FRONTEND_URL=.*|FRONTEND_URL=http://$SERVER_IP|g" "$APP_DIR/backend/.env"
sed -i "s|NODE_ENV=development|NODE_ENV=production|g" "$APP_DIR/backend/.env"
echo "✅ .env actualizado con IP: $SERVER_IP"

echo ""
echo "--- Configurando Nginx ---"

# Copiar config de Nginx
cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/crochetflix
sed -i "s|VPS_IP|$SERVER_IP|g" /etc/nginx/sites-available/crochetflix

# Activar sitio
ln -sf /etc/nginx/sites-available/crochetflix /etc/nginx/sites-enabled/crochetflix
rm -f /etc/nginx/sites-enabled/default

# Verificar y recargar Nginx
nginx -t && systemctl reload nginx
echo "✅ Nginx configurado"

echo ""
echo "--- Iniciando backend con PM2 ---"

# Iniciar o reiniciar
pm2 delete crochetflix-api 2>/dev/null || true
pm2 start "$APP_DIR/deploy/ecosystem.config.js"
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash 2>/dev/null || true

echo "✅ Backend corriendo con PM2"

echo ""
echo "--- Verificando instalación ---"
sleep 2
STATUS=$(curl -s http://localhost:3001/api/health | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null || echo "error")
if [ "$STATUS" = "ok" ]; then
  echo "✅ API respondiendo correctamente"
else
  echo "⚠️  API no responde aún, revisa: pm2 logs crochetflix-api"
fi
