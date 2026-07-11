const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM_EMAIL || 'CrochetFlix <noreply@crochetflix.app>';
const FRONT_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

async function enviarVerificacion(email, token) {
  // El link apunta al backend directamente — verifica y redirige al frontend
  const link = `${FRONT_URL}/api/auth/verificar-email?token=${token}`;

  const { error } = await resend.emails.send({
    from: FROM,
    to: email,
    subject: 'Verifica tu correo — CrochetFlix',
    html: `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#111111;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:540px;margin:48px auto;padding:0 20px;">
    <div style="background:#1c1c1c;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.4);">

      <!-- Header -->
      <div style="background:#dc2626;padding:32px 40px;text-align:center;">
        <p style="margin:0;color:rgba(255,255,255,0.7);font-size:11px;letter-spacing:3px;text-transform:uppercase;margin-bottom:8px;">Bienvenida a</p>
        <h1 style="margin:0;color:#fff;font-size:32px;font-weight:800;letter-spacing:-1px;">CrochetFlix</h1>
      </div>

      <!-- Body -->
      <div style="padding:40px;">
        <h2 style="color:#ffffff;font-size:22px;font-weight:700;margin:0 0 14px;">Confirma tu correo electrónico</h2>
        <p style="color:#9ca3af;line-height:1.75;margin:0 0 32px;font-size:15px;">
          Ya casi está. Solo necesitamos confirmar que este correo te pertenece para que puedas acceder a todos los patrones de CrochetFlix.
        </p>

        <div style="text-align:center;margin-bottom:32px;">
          <a href="${link}"
             style="display:inline-block;background:#dc2626;color:#fff;text-decoration:none;padding:16px 44px;border-radius:50px;font-weight:700;font-size:16px;letter-spacing:0.3px;">
            Verificar mi correo
          </a>
        </div>

        <div style="border-top:1px solid #2d2d2d;padding-top:24px;">
          <p style="color:#6b7280;font-size:13px;text-align:center;margin:0;line-height:1.6;">
            El enlace expira en 48 horas.<br>
            Si no creaste esta cuenta, puedes ignorar este mensaje.
          </p>
        </div>
      </div>
    </div>

    <p style="color:#4b5563;font-size:11px;text-align:center;margin-top:20px;">
      © CrochetFlix · Todos los derechos reservados
    </p>
  </div>
</body>
</html>
    `.trim(),
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
}

async function enviarConfirmacionPago(email, fechaExpiracion) {
  const fecha = new Date(fechaExpiracion).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });

  const { error } = await resend.emails.send({
    from: FROM,
    to: email,
    subject: '¡Tu suscripción Premium está activa! — CrochetFlix',
    html: `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#111111;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:540px;margin:48px auto;padding:0 20px;">
    <div style="background:#1c1c1c;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.4);">

      <div style="background:#dc2626;padding:32px 40px;text-align:center;">
        <p style="margin:0;color:rgba(255,255,255,0.7);font-size:11px;letter-spacing:3px;text-transform:uppercase;margin-bottom:8px;">Bienvenida a</p>
        <h1 style="margin:0;color:#fff;font-size:32px;font-weight:800;letter-spacing:-1px;">CrochetFlix</h1>
      </div>

      <div style="padding:40px;">
        <h2 style="color:#ffffff;font-size:22px;font-weight:700;margin:0 0 14px;">¡Tu pago fue procesado! 🎉</h2>
        <p style="color:#9ca3af;line-height:1.75;margin:0 0 24px;font-size:15px;">
          Tu suscripción Premium está activa. Ya puedes acceder a todos los patrones de CrochetFlix sin límites.
        </p>

        <div style="background:#2d2d2d;border-radius:12px;padding:20px 24px;margin-bottom:32px;">
          <p style="color:#9ca3af;font-size:13px;margin:0 0 4px;">Tu acceso premium vence el</p>
          <p style="color:#ffffff;font-size:18px;font-weight:700;margin:0;">${fecha}</p>
        </div>

        <div style="text-align:center;margin-bottom:32px;">
          <a href="${FRONT_URL}"
             style="display:inline-block;background:#dc2626;color:#fff;text-decoration:none;padding:16px 44px;border-radius:50px;font-weight:700;font-size:16px;letter-spacing:0.3px;">
            Ir a CrochetFlix
          </a>
        </div>

        <div style="border-top:1px solid #2d2d2d;padding-top:24px;">
          <p style="color:#6b7280;font-size:13px;text-align:center;margin:0;line-height:1.6;">
            Si tienes alguna duda, responde a este correo y te ayudamos.
          </p>
        </div>
      </div>
    </div>

    <p style="color:#4b5563;font-size:11px;text-align:center;margin-top:20px;">
      © CrochetFlix · Todos los derechos reservados
    </p>
  </div>
</body>
</html>
    `.trim(),
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
}

module.exports = { enviarVerificacion, enviarConfirmacionPago };
