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
    subject: 'Verifica tu correo — CrochetFlix 🧶',
    html: `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:Arial,sans-serif;">
  <div style="max-width:520px;margin:40px auto;padding:0 16px;">
    <div style="background:#1a1a1a;border-radius:16px;overflow:hidden;">
      <div style="background:#e85d04;padding:24px 32px;text-align:center;">
        <h1 style="margin:0;color:#fff;font-size:26px;letter-spacing:-0.5px;">🧶 CrochetFlix</h1>
      </div>
      <div style="padding:32px;">
        <h2 style="color:#fff;font-size:20px;margin:0 0 12px;">Verifica tu correo electrónico</h2>
        <p style="color:#9ca3af;line-height:1.7;margin:0 0 28px;">
          Gracias por registrarte. Para acceder a todos los patrones, confirma que este correo te pertenece haciendo clic en el botón de abajo.
        </p>
        <div style="text-align:center;margin-bottom:28px;">
          <a href="${link}"
             style="display:inline-block;background:#e85d04;color:#fff;text-decoration:none;padding:14px 36px;border-radius:50px;font-weight:bold;font-size:16px;">
            Verificar mi correo
          </a>
        </div>
        <p style="color:#6b7280;font-size:12px;text-align:center;margin:0;">
          El enlace expira en 48 horas.<br>
          Si no creaste esta cuenta, ignora este correo.
        </p>
      </div>
    </div>
    <p style="color:#4b5563;font-size:11px;text-align:center;margin-top:16px;">
      © CrochetFlix — El Netflix del crochet
    </p>
  </div>
</body>
</html>
    `.trim(),
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
}

module.exports = { enviarVerificacion };
