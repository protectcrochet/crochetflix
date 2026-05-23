#!/bin/bash
set -e

echo "🔒 Configurando SSL para crochetflix.app..."

if ! command -v certbot &> /dev/null; then
    echo "📦 Instalando Certbot..."
    apt-get update -qq
    apt-get install -y certbot python3-certbot-nginx -qq
fi

mkdir -p /var/www/certbot

echo "📜 Solicitando certificado..."
certbot --nginx -d crochetflix.app -d www.crochetflix.app \
    --non-interactive \
    --agree-tos \
    --email admin@crochetflix.app \
    --redirect \
    --hsts \
    --staple-ocsp \
    || {
        echo "❌ Error. Verifica: dig crochetflix.app +short"
        exit 1
    }

systemctl enable certbot.timer
systemctl start certbot.timer

echo "✅ SSL configurado"