# CrochetFlix — Instrucciones para Claude

## Regla más importante: siempre pedir el archivo actual del servidor

**Antes de modificar cualquier archivo**, pedir al usuario que pegue el contenido actual del servidor. El servidor puede tener cambios que no están en GitHub. Si edito desde la versión de GitHub sin verificar, puedo sobreescribir funciones existentes.

Pregunta estándar antes de cada cambio:
> "Antes de modificar `[archivo]`, ¿puedes pegarme su contenido actual del servidor para no perder nada?"

## Repositorio

- **Repo:** `protectcrochet/crochetflix` — ÚNICO repo permitido
- **NUNCA** tocar `protectcrochet/kroshapatterns` (proyecto completamente separado)
- **Branch de desarrollo:** `claude/phone-number-search-weugcq`

## Servidor

- **IP:** 84.247.187.153
- **PM2 proceso:** `crochetflix-api` (id 13), puerto 3001
- **Frontend:** `/var/www/crochetflix-app/frontend/dist` (build de Vite, servido por nginx)
- **Backend:** `/var/www/crochetflix-app/backend/src/`
- **Nginx:** proxea `/api/` → `localhost:3001`; SPA fallback `try_files $uri $uri/ /index.html`

## Deploy (sin CI/CD — manual)

```bash
cd /var/www/crochetflix-app
git fetch origin claude/phone-number-search-weugcq
git checkout origin/claude/phone-number-search-weugcq -- <archivo1> <archivo2>
pm2 restart crochetflix-api          # solo si cambia backend
# Si cambia frontend: npm run build en frontend/ y copiar dist/
```

## Archivos que NO están en GitHub (solo en servidor)

| Archivo | Razón |
|---|---|
| `.env` | Claves secretas (Stripe, Resend, JWT, Groq, etc.) |
| Scripts de bots | Credenciales hardcodeadas |
| Base de datos SQLite | Datos de usuarios en producción |
| Uploads (PDFs, thumbnails) | Archivos binarios de patrones |

## Archivos críticos — pedir siempre antes de editar

- `frontend/src/pages/Admin.jsx` — tiene lógica de producción que puede diferir del repo
- `backend/src/controllers/pagoController.js` — integración Stripe
- `backend/src/controllers/patronController.js` — límites de traducción, lógica Groq
- `backend/src/controllers/authController.js` — registro, login, verificación email
- `backend/src/services/email.js` — templates de correo (Resend)
- `frontend/src/pages/Perfil.jsx` — suscripción, precios

## Seguridad — restricciones absolutas

- **NUNCA** commitear `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `JWT_SECRET` ni ninguna clave al repo
- **NUNCA** commitear scripts de bots (contienen credenciales)
- **NUNCA** reemplazar `Admin.jsx` del servidor con la versión de GitHub sin verificar primero
- **NUNCA** agregar notificaciones por correo a ProtectCrochet (proyecto no relacionado)

## Stack técnico

- **Backend:** Node.js + Express, SQLite (vía `db` en `models/index.js`)
- **Frontend:** React + Vite, TailwindCSS, React Router
- **Email:** Resend (`RESEND_API_KEY`), from `CrochetFlix <noreply@crochetflix.app>`
- **Pagos:** Stripe (checkout sessions)
- **IA:** Groq API (traducción de patrones, ~500k tokens/día, ~7300 tokens/página)
- **Frontend URL:** `https://crochetflix.app`

## Límites conocidos

- Groq: ~500k tokens/día → ~6-7 patrones de imágenes/día (7300 tokens/página × ~10 páginas)
- Traducciones: límite semanal de 5 patrones por usuario (lunes a domingo), tabla `traducciones_uso`
- Email verificación: link apunta a `/api/auth/verificar-email?token=...` → backend sirve HTML directo (no React, para compatibilidad con Yahoo Mail iOS)
