#!/bin/bash
# ============================================
# CrochetFlix — Setup SSL con Let's Encrypt
# Ejecutar DESPUÉS de que el dominio apunte al VPS
# ============================================

set -e

echo "🔒 Configurando SSL para crochetflix.app..."

# Instalar Certbot
if ! command -v certbot &> /dev/null; then
    echo "📦 Instalando Certbot..."
    apt-get update -qq
    apt-get install -y certbot python3-certbot-nginx -qq
fi

# Crear directorio para challenges
mkdir -p /var/www/certbot

# Obtener certificado
# Nota: El dominio debe apuntar al VPS ANTES de ejecutar esto
echo "📜 Solicitando certificado SSL..."
certbot --nginx -d crochetflix.app -d www.crochetflix.app     --non-interactive     --agree-tos     --email admin@crochetflix.app     --redirect     --hsts     --staple-ocsp     || {
        echo "❌ Error al obtener certificado. Verifica que el dominio apunte al VPS."
        echo "   Comando de diagnóstico: dig crochetflix.app +short"
        exit 1
    }

# Auto-renewal
systemctl enable certbot.timer
systemctl start certbot.timer

echo "✅ SSL configurado correctamente"
echo "   Certificado: /etc/letsencrypt/live/crochetflix.app/"
echo "   Renovación automática: activada"
