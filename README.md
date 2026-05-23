# 🧶 CrochetFlix

Netflix de patrones de crochet. Biblioteca digital con viewer protegido y acceso offline.

## Características

- 📚 Biblioteca de patrones estilo Netflix
- 🔒 Viewer canvas (sin descarga directa)
- 🆓 1 patrón gratuito al mes
- 💾 Descarga offline (hasta 5 patrones para suscriptoras)
- 📱 PWA (Progressive Web App)
- 💳 Pagos vía NOWPayments (MXN → crypto)

## Stack

**Backend:** Node.js + Express + SQLite
**Frontend:** React + Tailwind CSS + Vite
**Pagos:** NOWPayments API

## Instalación

### Backend
```bash
cd backend
cp .env.example .env
# Edita .env con tus credenciales
npm install
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Seed data (patrones de prueba)
```bash
cd backend
npm run seed
```

## Estructura

```
crochetflix/
├── backend/          # API REST
├── frontend/         # React app
├── database/         # SQLite
└── scripts/          # Utilidades
```

## Licencia

Privado - CrochetFlix