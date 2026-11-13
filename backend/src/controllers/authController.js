const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const db = require('../models');
const { enviarVerificacion } = require('../services/email');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-cambia-en-prod';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

// Dominios bloqueados a mano (los que han aparecido en abusos del plan gratis)
const DOMINIOS_BLOQUEADOS = new Set([
  'chuwel.com', 'dreameg.com', 'duidir.com',
  'fazty.biz', 'gluad.biz', 'maomi.biz', 'kavio.org',
  'buloan.com', 'duvips.com',
  'fivejm.com', 'bncinema.com', 'lovadio.com', 'brixozu.com',
  'mails1.org', 'skkdke.com', 'ozsaip.com', 'necub.com',
  'wnbaldwy.com', 'lnovic.com', 'initwag.com', 'hoadkf.com',
  'bltiwd.com', 'asitrai.com', 'preparmy.com',
  'hidepost.net',
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', 'guerrillamail.net', 'guerrillamail.org',
  'guerrillamail.biz', 'guerrillamailblock.com', 'grr.la', 'sharklasers.com', 'pokemail.net',
  'spam4.me', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'tempmailo.com',
  'throwawaymail.com', 'yopmail.com', 'getnada.com', 'trashmail.com', 'maildrop.cc',
  'dispostable.com', 'fakeinbox.com', 'mailnesia.com', 'mohmal.com', 'emailondeck.com',
  'mailcatch.com', 'discard.email', '33mail.com', 'moakt.com', 'tmpmail.org',
  'mytemp.email', 'mail-temp.com', 'tempinbox.com', 'fakemail.net', 'spamgourmet.com', 'jetable.org'
]);

// Revisa el dominio y sus dominios padre (correo@sub.desechable.com también se bloquea)
function esDominioBloqueado(dominio) {
  if (!dominio) return false;
  const partes = dominio.split('.');
  for (let i = 0; i < partes.length - 1; i++) {
    const d = partes.slice(i).join('.');
    if (DOMINIOS_BLOQUEADOS.has(d)) return true;
  }
  return false;
}

exports.register = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    const dominio = email.split('@')[1]?.trim().toLowerCase();
    if (esDominioBloqueado(dominio)) {
      console.log(`[registro] bloqueado por dominio: ${dominio}`);
      return res.status(400).json({ error: 'Usa un correo electrónico válido para registrarte' });
    }

    const existingUser = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM users WHERE email = ?', [email], (err, row) => {
        if (err) reject(err);
        resolve(row);
      });
    });

    if (existingUser) {
      return res.status(409).json({ error: 'Email ya registrado' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const userId = uuidv4();
    const verToken = crypto.randomBytes(32).toString('hex');
    const esCampana = parseInt(req.body.trial, 10) === 3;
    // Opción A: usuario de campaña recibe premium 24h al registrarse (sin esperar verificación)
    const trialExpira = esCampana ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null;
    const tierInicial = esCampana ? 'premium' : 'free';
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO users (id, email, password_hash, tier, new_account_discount, email_verified, email_verification_token, trial_campana, subscription_expires_at, trial_gratis_usado, trial_gratis_expira, trial_gratis_email_enviado, trial_gratis_recordatorio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [userId, email, passwordHash, tierInicial, 1, 0, verToken, esCampana ? 1 : 0, trialExpira, esCampana ? 1 : 0, trialExpira, 0, 0],
        function(err) {
          if (err) reject(err);
          resolve();
        }
      );
    });

    // Registrar el referido si llegó con ?ref=CÓDIGO (no bloquea el registro si falla)
    const refCode = (req.body.ref || '').trim().toUpperCase();
    if (refCode) {
      try {
        const referrer = await new Promise((resolve, reject) => {
          db.get('SELECT id FROM users WHERE referral_code = ?', [refCode],
            (err, r) => { if (err) reject(err); else resolve(r); });
        });
        if (referrer && referrer.id !== userId) {
          await new Promise((resolve, reject) => {
            db.run('UPDATE users SET referred_by = ? WHERE id = ?', [referrer.id, userId],
              (err) => { if (err) reject(err); else resolve(); });
          });
          await new Promise((resolve, reject) => {
            db.run(
              "INSERT INTO referidos (id, referrer_id, referido_id, convertido, created_at) VALUES (?, ?, ?, 0, datetime('now'))",
              [uuidv4(), referrer.id, userId],
              (err) => { if (err) reject(err); else resolve(); });
          });
          console.log(`[referido] ${email} referida por ${referrer.id}`);
        }
      } catch (e) {
        console.error('[referido] no se pudo registrar ref:', e.message);
      }
    }

    // Enviar email de verificación — loguear resultado para debug
    enviarVerificacion(email, verToken)
      .then(() => console.log('[email-ver] enviado a', email))
      .catch(e => console.error('[email-ver] ERROR:', e.message));

    const token = jwt.sign(
      { userId, email, tier: tierInicial },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.status(201).json({
      message: 'Usuario creado',
      token,
      user: { id: userId, email, tier: tierInicial, new_account_discount: 1, email_verified: 0 }
    });

  } catch (err) {
    console.error('Error registro:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    const user = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
        if (err) reject(err);
        resolve(row);
      });
    });

    if (!user) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Registrar último acceso (para panel admin)
    db.run('UPDATE users SET last_login_at = CURRENT_TIMESTAMP, login_count = COALESCE(login_count, 0) + 1 WHERE id = ?', [user.id], () => {});

    const token = jwt.sign(
      { userId: user.id, email: user.email, tier: user.tier },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        tier: user.tier,
        subscription_expires_at: user.subscription_expires_at,
        new_account_discount: user.new_account_discount || 0,
        email_verified: user.email_verified || 0
      }
    });

  } catch (err) {
    console.error('Error login:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

exports.historial = async (req, res) => {
  try {
    const patrones = await new Promise((resolve, reject) => {
      db.all(`
        SELECT pr.patron_id as id, pat.titulo, pat.thumbnail_path, pat.paginas,
               pat.autor, pat.categoria,
               pr.pagina_actual, pr.completado, pr.ultimo_acceso
        FROM progreso pr
        JOIN patrones pat ON pat.id = pr.patron_id
        WHERE pr.user_id = ? AND pat.activo = 1
        ORDER BY pr.ultimo_acceso DESC
        LIMIT 12
      `, [req.userId], (err, rows) => { if (err) reject(err); else resolve(rows || []); });
    });
    res.json({ patrones });
  } catch (err) {
    console.error('Error historial:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

// Genera un código de referido corto y sin caracteres ambiguos (sin 0/O/1/I/L)
function generarCodigoReferido() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) code += abc[bytes[i] % abc.length];
  return code;
}

exports.referidos = async (req, res) => {
  try {
    const userId = req.userId;

    // Obtener (o crear) el código de referido de la usuaria
    let row = await new Promise((resolve, reject) => {
      db.get('SELECT referral_code FROM users WHERE id = ?', [userId],
        (err, r) => { if (err) reject(err); else resolve(r); });
    });

    let codigo = row?.referral_code;
    if (!codigo) {
      for (let i = 0; i < 6; i++) {
        const cand = generarCodigoReferido();
        const clash = await new Promise((resolve, reject) => {
          db.get('SELECT id FROM users WHERE referral_code = ?', [cand],
            (err, r) => { if (err) reject(err); else resolve(r); });
        });
        if (!clash) { codigo = cand; break; }
      }
      await new Promise((resolve, reject) => {
        db.run('UPDATE users SET referral_code = ? WHERE id = ?', [codigo, userId],
          (err) => { if (err) reject(err); else resolve(); });
      });
    }

    // Contar amigas referidas que ya se suscribieron (convertido = 1)
    const cnt = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) AS total FROM referidos WHERE referrer_id = ? AND convertido = 1', [userId],
        (err, r) => { if (err) reject(err); else resolve(r); });
    });
    const totalConvertidas = cnt?.total || 0;

    // Saldo de comisiones (afiliadas): comisiones - canjes
    const sumC = await new Promise((resolve, reject) => {
      db.get('SELECT COALESCE(SUM(monto_mxn),0) AS s FROM comisiones WHERE referrer_id = ?', [userId],
        (err, r) => { if (err) reject(err); else resolve(r); });
    });
    const sumK = await new Promise((resolve, reject) => {
      db.get('SELECT COALESCE(SUM(monto_usado),0) AS s FROM canjes WHERE referrer_id = ?', [userId],
        (err, r) => { if (err) reject(err); else resolve(r); });
    });
    const saldo = (sumC?.s || 0) - (sumK?.s || 0);
    const nivel = totalConvertidas >= 11 ? 3 : (totalConvertidas >= 4 ? 2 : 1);

    res.json({
      codigo,
      convertidos: totalConvertidas % 3,
      total: totalConvertidas,
      meses_ganados: Math.floor(totalConvertidas / 3),
      saldo,
      nivel,
      referidas_pagadas: totalConvertidas,
      meses_canjeables: Math.floor(saldo / 90),
      efectivo_desbloqueado: nivel >= 2,
      min_efectivo: 210,
      puede_cobrar: nivel >= 2 && saldo >= 210
    });
  } catch (err) {
    console.error('Error referidos:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

// Canjear saldo por meses Premium ($90 = 1 mes), todos los niveles.
exports.canjearPremium = async (req, res) => {
  try {
    const userId = req.userId;
    const sumC = await new Promise((resolve, reject) => {
      db.get('SELECT COALESCE(SUM(monto_mxn),0) AS s FROM comisiones WHERE referrer_id = ?', [userId],
        (err, r) => { if (err) reject(err); else resolve(r); });
    });
    const sumK = await new Promise((resolve, reject) => {
      db.get('SELECT COALESCE(SUM(monto_usado),0) AS s FROM canjes WHERE referrer_id = ?', [userId],
        (err, r) => { if (err) reject(err); else resolve(r); });
    });
    const saldo = (sumC?.s || 0) - (sumK?.s || 0);
    const meses = Math.floor(saldo / 90);
    if (meses < 1) return res.status(400).json({ error: 'Necesitas al menos $90 de saldo para canjear 1 mes.' });
    const montoUsado = meses * 90;
    const u = await new Promise((resolve, reject) => {
      db.get('SELECT tier, subscription_expires_at FROM users WHERE id = ?', [userId],
        (err, r) => { if (err) reject(err); else resolve(r); });
    });
    let base = new Date();
    if (u && u.tier === 'premium' && u.subscription_expires_at && new Date(u.subscription_expires_at) > base) {
      base = new Date(u.subscription_expires_at);
    }
    base.setDate(base.getDate() + meses * 30);
    const nuevaExpira = base.toISOString();
    await new Promise((resolve, reject) => {
      db.run("UPDATE users SET tier = 'premium', subscription_expires_at = ? WHERE id = ?", [nuevaExpira, userId],
        (err) => { if (err) reject(err); else resolve(); });
    });
    await new Promise((resolve, reject) => {
      db.run("INSERT INTO canjes (id, referrer_id, tipo, meses, monto_usado, created_at) VALUES (?, ?, 'premium', ?, ?, datetime('now'))",
        [uuidv4(), userId, meses, montoUsado],
        (err) => { if (err) reject(err); else resolve(); });
    });
    res.json({ ok: true, meses, monto_usado: montoUsado, saldo_restante: saldo - montoUsado, premium_hasta: nuevaExpira });
  } catch (err) {
    console.error('Error canjearPremium:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

function renderVerificacionHTML(success, trialOtorgado) {
  const FRONT_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
  const styles = `*{margin:0;padding:0;box-sizing:border-box}body{background:#111;font-family:'Helvetica Neue',Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.card{background:#1c1c1c;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.4);max-width:480px;width:100%}.hdr{background:#dc2626;padding:32px 40px;text-align:center}.hdr .eyebrow{color:rgba(255,255,255,.7);font-size:11px;letter-spacing:3px;text-transform:uppercase;margin-bottom:8px}.hdr h1{color:#fff;font-size:32px;font-weight:800;letter-spacing:-1px}.bod{padding:40px;text-align:center}.icon{width:80px;height:80px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 24px}.icon.ok{background:#16a34a}.icon.err{background:#7f1d1d}h2{color:#fff;font-size:22px;font-weight:700;margin-bottom:12px}p{color:#9ca3af;font-size:15px;line-height:1.75;margin-bottom:32px}.btn{display:inline-block;background:#dc2626;color:#fff;text-decoration:none;padding:16px 44px;border-radius:50px;font-weight:700;font-size:16px}.foot{color:#4b5563;font-size:11px;text-align:center;margin-top:20px}`;
  if (success) {
    return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CrochetFlix — Correo verificado</title><style>${styles}</style></head><body><div style="width:100%;max-width:480px"><div class="card"><div class="hdr"><p class="eyebrow">Bienvenida a</p><h1>CrochetFlix</h1></div><div class="bod"><div class="icon ok"><svg width="40" height="40" fill="none" stroke="#fff" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg></div><h2>${trialOtorgado ? '¡Tienes 24h Premium gratis! 🎉' : '¡Correo verificado!'}</h2><p>${trialOtorgado ? 'Confirmaste tu correo y activamos tu acceso Premium por 24 horas. Explora TODOS los patrones sin límite.' : 'Tu cuenta está lista. Ya puedes explorar cientos de patrones de crochet.'}</p><a href="${FRONT_URL}" class="btn">Entrar a CrochetFlix</a></div></div><p class="foot">© CrochetFlix · Todos los derechos reservados</p></div></body></html>`;
  }
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CrochetFlix — Enlace inválido</title><style>${styles}</style></head><body><div style="width:100%;max-width:480px"><div class="card"><div class="hdr"><p class="eyebrow">Bienvenida a</p><h1>CrochetFlix</h1></div><div class="bod"><div class="icon err"><svg width="40" height="40" fill="none" stroke="#fff" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></div><h2>Enlace inválido o expirado</h2><p>El enlace expiró o ya fue usado. Inicia sesión y solicita un nuevo correo desde tu perfil.</p><a href="${FRONT_URL}/login" class="btn">Iniciar sesión</a></div></div><p class="foot">© CrochetFlix · Todos los derechos reservados</p></div></body></html>`;
}

exports.verificarEmail = async (req, res) => {
  const { token } = req.query;

  if (!token) return res.send(renderVerificacionHTML(false));

  try {
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT id, tier, subscription_expires_at, trial_campana, trial_gratis_usado FROM users WHERE email_verification_token = ?', [token], (err, row) => {
        if (err) reject(err); else resolve(row);
      });
    });

    if (!user) return res.send(renderVerificacionHTML(false));

    const yaPremium = user.tier === 'premium' && user.subscription_expires_at && new Date(user.subscription_expires_at) > new Date();
    let trialOtorgado = false;
    if (user.trial_campana === 1 && !user.trial_gratis_usado && !yaPremium) {
      const expira = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await new Promise((resolve, reject) => {
        db.run(
          "UPDATE users SET email_verified = 1, email_verification_token = NULL, tier = 'premium', subscription_expires_at = ?, trial_gratis_usado = 1, trial_gratis_expira = ?, trial_gratis_email_enviado = 0, trial_gratis_recordatorio = 0 WHERE id = ?",
          [expira, expira, user.id],
          function(err) { if (err) reject(err); else resolve(); }
        );
      });
      trialOtorgado = true;
    } else {
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE users SET email_verified = 1, email_verification_token = NULL WHERE id = ?',
          [user.id],
          function(err) { if (err) reject(err); else resolve(); }
        );
      });
    }

    res.send(renderVerificacionHTML(true, trialOtorgado));
  } catch (err) {
    console.error('Error verificar email:', err);
    res.send(renderVerificacionHTML(false));
  }
};

exports.reenviarVerificacion = async (req, res) => {
  const userId = req.userId;
  try {
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT email, email_verified FROM users WHERE id = ?', [userId], (err, row) => {
        if (err) reject(err); else resolve(row);
      });
    });

    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (user.email_verified) return res.json({ message: 'El correo ya está verificado' });

    const newToken = crypto.randomBytes(32).toString('hex');
    await new Promise((resolve, reject) => {
      db.run('UPDATE users SET email_verification_token = ? WHERE id = ?', [newToken, userId],
        function(err) { if (err) reject(err); else resolve(); });
    });

    await enviarVerificacion(user.email, newToken);
    res.json({ message: 'Correo de verificación reenviado' });
  } catch (err) {
    console.error('Error reenviar verificación:', err);
    res.status(500).json({ error: 'No se pudo reenviar el correo' });
  }
};

exports.me = async (req, res) => {
  try {
    const user = await new Promise((resolve, reject) => {
      db.get(
        'SELECT id, email, tier, subscription_expires_at, new_account_discount, email_verified FROM users WHERE id = ?',
        [req.userId],
        (err, row) => {
          if (err) reject(err);
          resolve(row);
        }
      );
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({ user });

  } catch (err) {
    console.error('Error me:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};
