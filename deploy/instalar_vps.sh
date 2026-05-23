#!/bin/bash
set -e

APP_DIR="/var/www/crochetflix"
LOG_DIR="/var/log"

echo ""
echo "🧶 CrochetFlix Deploy — $(date)"
echo "============================================"

# 1. SWAP
echo ""
echo "[1/8] Configurando swap..."
if [ ! -f /swapfile ]; then
    echo "💾 Creando swap 2GB..."
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "✅ Swap activado"
else
    echo "✅ Swap ya existe"
fi

# 2. FIREWALL
echo ""
echo "[2/8] Configurando firewall..."
if ! command -v ufw &> /dev/null; then
    apt-get install -y ufw -qq
fi
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable
echo "✅ Firewall activado"

# 3. FAIL2BAN
echo ""
echo "[3/8] Instalando Fail2Ban..."
if ! command -v fail2ban-client &> /dev/null; then
    apt-get install -y fail2ban -qq
    cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3
backend = systemd

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
EOF
    systemctl enable fail2ban
    systemctl start fail2ban
    echo "✅ Fail2Ban activado"
else
    echo "✅ Fail2Ban ya instalado"
fi

# 4. NODE.JS
echo ""
echo "[4/8] Instalando Node.js 20..."
if ! command -v node &> /dev/null || [ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" != "20" ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs -qq
    echo "✅ Node.js $(node -v)"
else
    echo "✅ Node.js $(node -v)"
fi

# 5. PM2
echo ""
echo "[5/8] Instalando PM2..."
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2 -q
    pm2 startup systemd -u root --hp /root | tail -1 | bash 2>/dev/null || true
    echo "✅ PM2 instalado"
else
    echo "✅ PM2 ya instalado"
fi

# 6. NGINX
echo ""
echo "[6/8] Instalando Nginx..."
if ! command -v nginx &> /dev/null; then
    apt-get install -y nginx -qq
    systemctl enable nginx
    systemctl start nginx
    echo "✅ Nginx instalado"
else
    echo "✅ Nginx ya instalado"
fi
rm -f /etc/nginx/sites-enabled/default

# 7. DESPLEGAR CÓDIGO
echo ""
echo "[7/8] Desplegando código..."
rm -rf "$APP_DIR"
mkdir -p /var/www

if [ ! -f /tmp/crochetflix-deploy.zip ]; then
    echo "❌ No se encontró /tmp/crochetflix-deploy.zip"
    exit 1
fi

unzip -o /tmp/crochetflix-deploy.zip -d /var/www/ -q

if [ -d "/var/www/crochetflix-main" ]; then
    mv /var/www/crochetflix-main "$APP_DIR"
elif [ -d "/var/www/crochetflix" ]; then
    mv /var/www/crochetflix "$APP_DIR"
else
    echo "❌ Estructura inesperada"
    ls -la /var/www/
    exit 1
fi

echo "✅ Código en $APP_DIR"

# Backend dependencies
echo "📦 Backend deps..."
cd "$APP_DIR/backend"
npm install --production -q

# Frontend build
echo "📦 Frontend build..."
cd "$APP_DIR/frontend"
npm install -q
npm run build

# 8. DATABASE + ENV
echo ""
echo "[8/8] Configurando DB y entorno..."
mkdir -p "$APP_DIR/backend/database"

if [ ! -f "$APP_DIR/backend/.env" ]; then
    echo "📝 Creando .env..."
    cat > "$APP_DIR/backend/.env" << 'EOF'
DATABASE_PATH=./database/crochetflix.sqlite
JWT_SECRET=CAMBIA_ESTO_POR_UN_STRING_LARGO_Y_ALEATORIO_DE_64_CHARS_MINIMO
JWT_EXPIRES_IN=7d
PORT=3001
NODE_ENV=production
FRONTEND_URL=https://crochetflix.app
BACKEND_URL=https://crochetflix.app/api
NOWPAYMENTS_API_URL=https://api.nowpayments.io/v1
NOWPAYMENTS_API_KEY=JWF7XRR-25V4ABS-NY7GEC9-R03FEGF
NOWPAYMENTS_IPN_SECRET=ub4G01ZbWcf55F9IY2h0NP5ubXv/YEhs
PAYMENT_CURRENCY=USD
PAYMENT_AMOUNT_MENSUAL=4.99
PAYMENT_AMOUNT_ANUAL=49.99
EOF
    echo "⚠️  IMPORTANTE: Cambia JWT_SECRET en $APP_DIR/backend/.env"
else
    echo "✅ .env existe"
fi

# Init DB
if [ ! -f "$APP_DIR/backend/database/crochetflix.sqlite" ]; then
    echo "🗄️  Inicializando DB..."
    cd "$APP_DIR/backend"
    node -e "require('sqlite3').verbose().Database('./database/crochetflix.sqlite').close()"
    if [ -f "$APP_DIR/scripts/seed.js" ]; then
        echo "🌱 Seed..."
        cd "$APP_DIR"
        NODE_PATH="$APP_DIR/backend/node_modules" node "$APP_DIR/scripts/seed.js"
    fi
    echo "✅ DB lista"
else