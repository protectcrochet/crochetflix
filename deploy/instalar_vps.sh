#!/bin/bash
set -e

APP_DIR="/var/www/crochetflix"
REPO="https://github.com/protectcrochet/crochetflix.git"
BRANCH="claude/project-review-w1Vqc"
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || echo "TU_IP")

echo ""
echo "🧶 CrochetFlix Deploy — $(date)"
echo "============================================"

# 1. SWAP
echo ""
echo "[1/9] Configurando swap..."
if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "✅ Swap 2GB activado"
else
    echo "✅ Swap ya existe"
fi

# 2. PAQUETES BASE
echo ""
echo "[2/9] Instalando paquetes..."
apt-get update -qq
apt-get install -y git curl ufw fail2ban nginx poppler-utils unzip -qq
echo "✅ Paquetes instalados"

# 3. FIREWALL
echo ""
echo "[3/9] Configurando firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable
echo "✅ Firewall activado (22, 80, 443)"

# 4. FAIL2BAN
echo ""
echo "[4/9] Configurando Fail2Ban..."
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3

[sshd]
enabled = true
EOF
systemctl enable fail2ban
systemctl restart fail2ban
echo "✅ Fail2Ban activo"

# 5. NODE.JS 20
echo ""
echo "[5/9] Instalando Node.js 20..."
if ! command -v node &> /dev/null || [ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" != "20" ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - -qq
    apt-get install -y nodejs -qq
fi
echo "✅ Node.js $(node -v)"

# 6. PM2
echo ""
echo "[6/9] Instalando PM2..."
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2 -q
fi
pm2 startup systemd -u root --hp /root 2>/dev/null | grep "^sudo" | bash 2>/dev/null || true
echo "✅ PM2 listo"

# 7. CLONAR CÓDIGO
echo ""
echo "[7/9] Descargando código desde GitHub..."
rm -rf "$APP_DIR"
git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
echo "✅ Código en $APP_DIR"

# Backend
echo "📦 Instalando dependencias backend..."
cd "$APP_DIR/backend"
npm install --production -q

# Frontend build
echo "📦 Compilando frontend..."
cd "$APP_DIR/frontend"
npm install -q
npm run build
echo "✅ Build listo"

# 8. ENV + DB
echo ""
echo "[8/9] Configurando entorno..."
mkdir -p "$APP_DIR/backend/database"
mkdir -p "$APP_DIR/backend/uploads/patrones"

if [ ! -f "$APP_DIR/backend/.env" ]; then
    JWT=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
    cat > "$APP_DIR/backend/.env" << EOF
DATABASE_PATH=./database/crochetflix.sqlite
JWT_SECRET=$JWT
JWT_EXPIRES_IN=7d
PORT=3001
NODE_ENV=production
FRONTEND_URL=http://$SERVER_IP
BACKEND_URL=http://$SERVER_IP
ADMIN_SECRET=CAMBIA_ESTO_POR_TU_CLAVE_ADMIN
NOWPAYMENTS_API_URL=https://api.nowpayments.io/v1
NOWPAYMENTS_API_KEY=JWF7XRR-25V4ABS-NY7GEC9-R03FEGF
NOWPAYMENTS_IPN_SECRET=ub4G01ZbWcf55F9IY2h0NP5ubXv/YEhs
PAYMENT_CURRENCY=USD
PAYMENT_AMOUNT_MENSUAL=4.99
PAYMENT_AMOUNT_ANUAL=49.99
EOF
    echo "✅ .env creado (JWT generado automáticamente)"
    echo "⚠️  Cambia ADMIN_SECRET en $APP_DIR/backend/.env"
else
    echo "✅ .env ya existe"
fi

# 9. NGINX + PM2
echo ""
echo "[9/9] Configurando Nginx y PM2..."

# Nginx config para IP (sin dominio)
cat > /etc/nginx/sites-available/crochetflix << EOF
server {
    listen 80;
    server_name $SERVER_IP _;

    root $APP_DIR/frontend/dist;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2)$ {
        expires 6M;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files \$uri \$uri/ /index.html;
        add_header Cache-Control "no-cache";
    }

    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 120s;
        client_max_body_size 150M;
    }

    location /uploads {
        alias $APP_DIR/backend/uploads;
        expires 7d;
        add_header Cache-Control "public";
        autoindex off;
    }

    access_log /var/log/nginx/crochetflix.log;
    error_log /var/log/nginx/crochetflix-error.log;
}
EOF

ln -sf /etc/nginx/sites-available/crochetflix /etc/nginx/sites-enabled/crochetflix
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx
echo "✅ Nginx activo"

# PM2
cd "$APP_DIR/backend"
pm2 delete crochetflix-api 2>/dev/null || true
pm2 start server.js --name crochetflix-api
pm2 save
echo "✅ Backend corriendo con PM2"

echo ""
echo "============================================"
echo "✅ CrochetFlix desplegado correctamente"
echo ""
echo "  App:   http://$SERVER_IP"
echo "  Admin: http://$SERVER_IP/admin"
echo "  API:   http://$SERVER_IP/api/health"
echo ""
echo "⚠️  PENDIENTE:"
echo "  1. Edita ADMIN_SECRET: nano $APP_DIR/backend/.env"
echo "  2. Reinicia backend: pm2 restart crochetflix-api"
echo "  3. Sube tus primeros patrones en /admin"
echo "============================================"
