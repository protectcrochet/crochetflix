#!/bin/bash
# ============================================
#  CrochetFlix — Script que corre EN el VPS
#  Optimizado para: Ubuntu 22.04, 1 GB RAM, AbeloHost
# ============================================

set -e

APP_DIR="/var/www/crochetflix"
LOG_DIR="/var/log"

echo ""
echo "🧶 CrochetFlix Deploy — $(date)"
echo "============================================"

# ============================================
# 1. SISTEMA — Swap, updates básicos
# ============================================
echo ""
echo "[1/8] Configurando sistema..."

# Crear swap (2 GB) — CRÍTICO con 1 GB RAM
if [ ! -f /swapfile ]; then
    echo "💾 Creando swap de 2 GB..."
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "✅ Swap activado"
else
    echo "✅ Swap ya existe"
fi

# Update básico
apt-get update -qq

# ============================================
# 2. FIREWALL UFW
# ============================================
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

# Bloquear puerto 3001 (solo accesible via Nginx proxy)
# ufw deny 3001/tcp  # Opcional: si quieres ser estricto

ufw --force enable
echo "✅ Firewall activado (puertos 22, 80, 443 abiertos)"

# ============================================
# 3. FAIL2BAN (protección SSH brute force)
# ============================================
echo ""
echo "[3/8] Instalando Fail2Ban..."

if ! command -v fail2ban-client &> /dev/null; then
    apt-get install -y fail2ban -qq

    # Configuración básica
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

# ============================================
# 4. NODE.JS 20 LTS
# ============================================
echo ""
echo "[4/8] Instalando Node.js 20..."

if ! command -v node &> /dev/null || [ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" != "20" ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs -qq
    echo "✅ Node.js $(node -v) instalado"
else
    echo "✅ Node.js $(node -v) ya instalado"
fi

# ============================================
# 5. PM2
# ============================================
echo ""
echo "[5/8] Instalando PM2..."

if ! command -v pm2 &> /dev/null; then
    npm install -g pm2 -q
    pm2 startup systemd -u root --hp /root | tail -1 | bash 2>/dev/null || true
    echo "✅ PM2 instalado"
else
    echo "✅ PM2 ya instalado"
fi

# ============================================
# 6. NGINX
# ============================================
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

# Limpiar default site
rm -f /etc/nginx/sites-enabled/default

# ============================================
# 7. DESPLEGAR CÓDIGO
# ============================================
echo ""
echo "[7/8] Desplegando CrochetFlix..."

# Limpiar y extraer
rm -rf "$APP_DIR"
mkdir -p /var/www

# Verificar que el zip existe
if [ ! -f /tmp/crochetflix-deploy.zip ]; then
    echo "❌ No se encontró /tmp/crochetflix-deploy.zip"
    echo "   Ejecuta primero subir.sh desde tu Mac"
    exit 1
fi

unzip -o /tmp/crochetflix-deploy.zip -d /var/www/ -q

# Asegurar estructura correcta
if [ -d "/var/www/crochetflix-main" ]; then
    mv /var/www/crochetflix-main "$APP_DIR"
elif [ -d "/var/www/crochetflix" ]; then
    mv /var/www/crochetflix "$APP_DIR"
else
    echo "❌ Estructura de carpetas inesperada"
    ls -la /var/www/
    exit 1
fi

echo "✅ Código desplegado en $APP_DIR"

# Instalar dependencias backend
echo "📦 Instalando dependencias backend..."
cd "$APP_DIR/backend"
npm install --production -q

# Instalar dependencias frontend y build
echo "📦 Instalando dependencias frontend..."
cd "$APP_DIR/frontend"
npm install -q
echo "🔨 Build del frontend..."
npm run build

# ============================================
# 8. BASE DE DATOS + ENV
# ============================================
echo ""
echo "[8/8] Configurando base de datos y entorno..."

mkdir -p "$APP_DIR/backend/database"

# Crear .env de producción si no existe
if [ ! -f "$APP_DIR/backend/.env" ]; then
    echo "📝 Creando .env de producción..."
    cat > "$APP_DIR/backend/.env" << 'EOF'
# Database
DATABASE_PATH=./database/crochetflix.sqlite

# JWT (CAMBIAR ESTO — generar string aleatorio de 64+ chars)
JWT_SECRET=3a05a57f3c047753bdd0f2fe23b9a74e2b4c7399f67953b7d0621a55d97f5f84846afa14c8b26266694a1c31238d2f7d
JWT_EXPIRES_IN=7d

# Server
PORT=3001
NODE_ENV=production

# Frontend URL (actualizar con dominio real)
FRONTEND_URL=https://crochetflix.app
BACKEND_URL=https://crochetflix.app/api

# NOWPayments
NOWPAYMENTS_API_URL=https://api.nowpayments.io/v1
NOWPAYMENTS_API_KEY=JWF7XRR-25V4ABS-NY7GEC9-R03FEGF
NOWPAYMENTS_IPN_SECRET=ub4G01ZbWcf55F9IY2h0NP5ubXv/YEhs

# Pago
PAYMENT_CURRENCY=USD
PAYMENT_AMOUNT_MENSUAL=4.99
PAYMENT_AMOUNT_ANUAL=49.99
EOF
    echo "⚠️  IMPORTANTE: Edita $APP_DIR/backend/.env y cambia JWT_SECRET"
else
    echo "✅ .env ya existe"
fi

# Inicializar base de datos si no existe
if [ ! -f "$APP_DIR/backend/database/crochetflix.sqlite" ]; then
    echo "🗄️  Inicializando base de datos..."
    cd "$APP_DIR/backend"
    node -e "
        const sqlite3 = require('sqlite3').verbose();
        const path = require('path');
        const dbPath = path.join(__dirname, 'database', 'crochetflix.sqlite');
        const db = new sqlite3.Database(dbPath);
        db.close();
        console.log('Database created');
    "

    # Ejecutar seed si existe
    if [ -f "$APP_DIR/scripts/seed.js" ]; then
        echo "🌱 Ejecutando seed..."
        cd "$APP_DIR"
        NODE_PATH="$APP_DIR/backend/node_modules" node "$APP_DIR/scripts/seed.js"
    fi
    echo "✅ Base de datos inicializada"
else
    echo "✅ Base de datos ya existe"
fi

# Activar SQLite WAL mode (mejor concurrencia)
echo "🔄 Activando WAL mode..."
cd "$APP_DIR/backend"
node -e "
    const sqlite3 = require('sqlite3').verbose();
    const path = require('path');
    const dbPath = path.join(__dirname, 'database', 'crochetflix.sqlite');
    const db = new sqlite3.Database(dbPath);
    db.run('PRAGMA journal_mode = WAL;', (err) => {
        if (err) console.error('WAL error:', err);
        else console.log('WAL mode enabled');
        db.close();
    });
"

# ============================================
# 9. CONFIGURAR NGINX
# ============================================
echo ""
echo "🔧 Configurando Nginx..."

# Copiar config (sin SSL primero — se activa con setup_ssl.sh)
cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/crochetflix

# Activar sitio
ln -sf /etc/nginx/sites-available/crochetflix /etc/nginx/sites-enabled/crochetflix

# Verificar y recargar
nginx -t && systemctl reload nginx
echo "✅ Nginx configurado (HTTP)"

# ============================================
# 10. INICIAR BACKEND CON PM2
# ============================================
echo ""
echo "🚀 Iniciando backend con PM2..."

pm2 delete crochetflix-api 2>/dev/null || true
pm2 start "$APP_DIR/deploy/ecosystem.config.js"
pm2 save

echo "✅ Backend corriendo con PM2"

# ============================================
# 11. VERIFICACIÓN
# ============================================
echo ""
echo "============================================"
echo "✅ Deploy completado!"
echo "============================================"
echo ""
echo "🌐 Acceso:"
echo "   HTTP:  http://$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
echo "   (HTTPS se activa con ./deploy/setup_ssl.sh después de apuntar el dominio)"
echo ""
echo "📡 API Health: http://localhost:3001/api/health"
echo ""
echo "⚠️  ACCIONES PENDIENTES:"
echo "   1. Cambiar JWT_SECRET en $APP_DIR/backend/.env"
echo "   2. Apuntar crochetflix.app al VPS en OrangeWebsite DNS"
echo "   3. Ejecutar: ./deploy/setup_ssl.sh"
echo "   4. Verificar webhook NOWPayments apunta a: https://crochetflix.app/api/webhook/nowpayments"
echo ""
echo "📊 Recursos:"
free -h
echo ""
echo "🔒 Seguridad:"
ufw status verbose
echo ""
