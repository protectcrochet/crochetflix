# CrochetFlix — Deploy Guide

## Requisitos previos
- VPS con Ubuntu 22.04, 1 GB RAM, IP dedicada
- Dominio crochetflix.app apuntando al VPS
- SSH access como root

## Archivos de deploy

| Archivo | Propósito |
|---------|-----------|
| `subir.sh` | Script local (Mac) — build, zip, subir, instalar |
| `instalar_vps.sh` | Script remoto (VPS) — instalar dependencias, configurar |
| `setup_ssl.sh` | Script remoto (VPS) — SSL con Let's Encrypt |
| `ecosystem.config.js` | Config PM2 para Node.js |
| `nginx.conf` | Config Nginx (HTTP) |
| `nginx_ssl.conf` | Config Nginx (HTTPS) — se activa con SSL |

## Deploy paso a paso

### 1. Preparar .env
Copiar `backend/.env.example` a `backend/.env` y cambiar:
- `JWT_SECRET` — generar string aleatorio de 64+ caracteres
- `NOWPAYMENTS_IPN_SECRET` — ya está configurado

### 2. Ejecutar deploy
```bash
./deploy/subir.sh IP_DEL_VPS
```

### 3. Configurar SSL (después de apuntar dominio)
```bash
ssh root@IP_DEL_VPS
/var/www/crochetflix/deploy/setup_ssl.sh
```

### 4. Verificar
- https://crochetflix.app
- https://crochetflix.app/api/health
- Webhook NOWPayments: https://crochetflix.app/api/webhook/nowpayments

## Seguridad incluida
- UFW firewall (puertos 22, 80, 443)
- Fail2Ban (protección SSH brute force)
- Swap 2 GB (para 1 GB RAM)
- SQLite WAL mode
- PM2 con max_memory_restart: 350M
- Nginx con headers de seguridad

## Troubleshooting

### PM2 no inicia
```bash
pm2 logs crochetflix-api
```

### Nginx error
```bash
nginx -t
systemctl status nginx
```

### Base de datos
```bash
cd /var/www/crochetflix/backend
sqlite3 database/crochetflix.sqlite ".tables"
```
