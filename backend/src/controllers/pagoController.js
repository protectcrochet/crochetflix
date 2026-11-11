const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const https = require('https');
const http = require('http');
const db = require('../models');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// ============================================
// Precios locales por moneda (desde Stripe)
// ============================================
const PRECIOS_LOCALES = {
  USD: { unit_amount: 599,     monto: 5.99,     simbolo: '$',   moneda: 'USD', formato: '5.99' },
  MXN: { unit_amount: 10000,   monto: 100,      simbolo: '$',   moneda: 'MXN', formato: '100' },
  ARS: { unit_amount: 813039,  monto: 8130.39,  simbolo: '$',   moneda: 'ARS', formato: '8,130' },
  BRL: { unit_amount: 2921,    monto: 29.21,    simbolo: 'R$',  moneda: 'BRL', formato: '29.21' },
  CAD: { unit_amount: 797,     monto: 7.97,     simbolo: 'CA$', moneda: 'CAD', formato: '7.97' },
  CLP: { unit_amount: 5149,    monto: 5149,     simbolo: '$',   moneda: 'CLP', formato: '5,149', ceroDecimal: true },
  COP: { unit_amount: 2090830, monto: 20908.30, simbolo: '$',   moneda: 'COP', formato: '20,908' },
  EUR: { unit_amount: 495,     monto: 4.95,     simbolo: '€',   moneda: 'EUR', formato: '4.95' },
  GBP: { unit_amount: 429,     monto: 4.29,     simbolo: '£',   moneda: 'GBP', formato: '4.29' },
  GTQ: { unit_amount: 4390,    monto: 43.90,    simbolo: 'Q',   moneda: 'GTQ', formato: '43.90' },
  PEN: { unit_amount: 1965,    monto: 19.65,    simbolo: 'S/',  moneda: 'PEN', formato: '19.65' },
  DOP: { unit_amount: 34054,   monto: 340.54,   simbolo: 'RD$', moneda: 'DOP', formato: '340.54' },
  CRC: { unit_amount: 261019,  monto: 2610.19,  simbolo: '₡',  moneda: 'CRC', formato: '2,610' },
};

const PLANES = {
  mensual:    { mult: 1,   count: 1,  dias: 30,  label: 'Mensual' },
  trimestral: { mult: 2.5, count: 3,  dias: 90,  label: 'Trimestral' },
  anual:      { mult: 10,  count: 12, dias: 365, label: 'Anual' },
};

const PAIS_A_MONEDA = {
  US: 'USD', CA: 'CAD',
  MX: 'MXN',
  AR: 'ARS', BR: 'BRL', CO: 'COP', CL: 'CLP',
  PE: 'PEN', CR: 'CRC', GT: 'GTQ', DO: 'DOP',
  ES: 'EUR', FR: 'EUR', DE: 'EUR', IT: 'EUR', PT: 'EUR',
  NL: 'EUR', BE: 'EUR', AT: 'EUR', IE: 'EUR', FI: 'EUR',
  GB: 'GBP',
};

// ============================================
// Una sola suscripción por usuaria: Stripe es la fuente de verdad
// ============================================
const GRACIA_MS = 24 * 60 * 60 * 1000;

function inicioPeriodo(sub) {
  const t = sub.current_period_start || sub.items?.data?.[0]?.current_period_start;
  return t ? new Date(t * 1000) : null;
}

function finPeriodo(sub) {
  const t = sub.current_period_end || sub.items?.data?.[0]?.current_period_end;
  return t ? new Date(t * 1000) : null;
}

function diasDePeriodo(sub, porDefecto) {
  const ini = sub && inicioPeriodo(sub);
  const fin = sub && finPeriodo(sub);
  if (!ini || !fin) return porDefecto;
  return Math.max(1, Math.round((fin - ini) / 86400000));
}

// Sigue cobrando: activa, en prueba o con pago pendiente, y sin cancelación programada
function esViva(sub) {
  return ['active', 'trialing', 'past_due'].includes(sub.status) && !sub.cancel_at_period_end;
}

// Busca por el cliente guardado, por el id guardado y por email, porque los checkouts
// anteriores creaban un cliente de Stripe nuevo en cada pago.
async function suscripcionesVivas(stripe, user) {
  const clientes = new Set();
  if (user.stripe_customer_id) clientes.add(user.stripe_customer_id);
  if (user.email) {
    const porEmail = await stripe.customers.list({ email: user.email, limit: 100 });
    porEmail.data.forEach(c => clientes.add(c.id));
  }

  const vivas = new Map();
  for (const customer of clientes) {
    try {
      const subs = await stripe.subscriptions.list({ customer, status: 'all', limit: 100 });
      subs.data.filter(esViva).forEach(sub => vivas.set(sub.id, sub));
    } catch (e) {
      if (e.code !== 'resource_missing') throw e;
    }
  }

  if (user.stripe_subscription_id && !vivas.has(user.stripe_subscription_id)) {
    try {
      const sub = await stripe.subscriptions.retrieve(user.stripe_subscription_id);
      if (esViva(sub)) vivas.set(sub.id, sub);
    } catch (e) {
      if (e.code !== 'resource_missing') throw e;
    }
  }
  return [...vivas.values()];
}

// Alinea el acceso local con una suscripción que Stripe sigue cobrando. Nunca acorta el acceso.
async function sincronizarAcceso(userId, expiraActual, sub) {
  let expira = finPeriodo(sub) ? new Date(finPeriodo(sub).getTime() + GRACIA_MS) : new Date(Date.now() + GRACIA_MS);
  const existente = expiraActual ? new Date(expiraActual) : null;
  if (existente && existente > expira) expira = existente;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  await new Promise((resolve, reject) => {
    db.run(
      `UPDATE users SET tier = 'premium', subscription_expires_at = ?, stripe_customer_id = ?,
         stripe_subscription_id = ?, renovacion_email_enviado = 0 WHERE id = ?`,
      [expira.toISOString(), customerId, sub.id, userId],
      function(err) { if (err) reject(err); else resolve(); }
    );
  });
  return expira;
}

function getCountryFromIP(ip) {
  return new Promise((resolve) => {
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168') || ip.startsWith('10.')) {
      return resolve('US');
    }
    const req = http.get(`http://ip-api.com/json/${ip}?fields=countryCode`, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const obj = JSON.parse(data);
          resolve((obj.countryCode || 'US').toUpperCase());
        } catch { resolve('US'); }
      });
    });
    req.on('error', () => resolve('US'));
    req.on('timeout', () => { req.destroy(); resolve('US'); });
  });
}

// ============================================
// Rate Limiters
// ============================================
const webhookRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: 'Too many webhook requests',
  standardHeaders: true,
  legacyHeaders: false
});

const crearPagoRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Demasiadas solicitudes de pago. Intenta más tarde.',
  standardHeaders: true,
  legacyHeaders: false
});

// ============================================
// Precio local por IP
// ============================================
exports.precioLocal = async (req, res) => {
  try {
    const ip = (req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    const pais = await getCountryFromIP(ip);
    const moneda = PAIS_A_MONEDA[pais] || 'USD';
    const precio = PRECIOS_LOCALES[moneda] || PRECIOS_LOCALES.USD;
    res.json({ ...precio, pais });
  } catch (err) {
    res.json({ ...PRECIOS_LOCALES.USD, pais: 'US' });
  }
};

// ============================================
// Crear sesión de pago con Stripe
// ============================================
exports.crearPago = [crearPagoRateLimit, async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const userId = req.userId;
    const { plan = 'mensual' } = req.body;

    if (!PLANES[plan]) {
      return res.status(400).json({ error: 'Plan inválido.' });
    }
    const cfg = PLANES[plan];

    // Detectar moneda por IP del servidor (más confiable que geo del frontend)
    const ip = (req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || '').split(',')[0].trim();
    const pais = await getCountryFromIP(ip);
    const moneda = PAIS_A_MONEDA[pais] || 'USD';
    const precioData = PRECIOS_LOCALES[moneda] || PRECIOS_LOCALES.USD;

    const user = await new Promise((resolve, reject) => {
      db.get(
        'SELECT email, tier, subscription_expires_at, new_account_discount, trial_gratis_usado, stripe_subscription_id, stripe_customer_id FROM users WHERE id = ?',
        [userId],
        (err, row) => { if (err) reject(err); resolve(row); }
      );
    });

    if (user && user.tier === 'premium' && new Date(user.subscription_expires_at) > new Date() && user.stripe_subscription_id) {
      return res.status(400).json({ error: 'Ya tienes una suscripción activa' });
    }

    // El acceso local puede haber vencido aunque Stripe siga cobrando: se consulta Stripe
    // antes de abrir otro checkout para no crear una segunda suscripción.
    if (user) {
      let vivas;
      try {
        vivas = await suscripcionesVivas(stripe, user);
      } catch (e) {
        console.error('[crearPago] No se pudo consultar Stripe:', e.message);
        return res.status(503).json({ error: 'No pudimos verificar tu suscripción. Intenta de nuevo en unos minutos.' });
      }
      if (vivas.length) {
        const actual = vivas.find(v => v.status !== 'past_due') || vivas[0];
        if (actual.status === 'past_due') {
          let portal_url;
          try {
            const portal = await stripe.billingPortal.sessions.create({
              customer: typeof actual.customer === 'string' ? actual.customer : actual.customer.id,
              return_url: `${FRONTEND_URL}/perfil`
            });
            portal_url = portal.url;
          } catch (e) { console.error('[crearPago] portal:', e.message); }
          console.log(`[crearPago] bloqueado: ${user.email} ya tiene ${actual.id} con pago pendiente`);
          return res.status(409).json({
            error: 'Ya tienes una suscripción con un pago pendiente. Actualiza tu tarjeta para reactivarla; no necesitas pagar otra.',
            portal_url
          });
        }
        await sincronizarAcceso(userId, user.subscription_expires_at, actual);
        console.log(`[crearPago] bloqueado: ${user.email} ya tiene ${actual.id} (${actual.status}); acceso resincronizado`);
        return res.status(409).json({
          error: 'Ya tienes una suscripción activa. No se hizo ningún cargo nuevo.',
          ya_activa: true
        });
      }
    }

    const unit_amount = Math.round(precioData.unit_amount * cfg.mult);
    const montoRegistro = unit_amount / (precioData.ceroDecimal ? 1 : 100);
    const label = `CrochetFlix Premium — ${cfg.label}`;

    const orderId = `CF-${uuidv4()}`;
    const pagoId = uuidv4();

    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO pagos (id, user_id, order_id, monto_usd, status, plan, descuento_aplicado, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, datetime('now'))`,
        [pagoId, userId, orderId, montoRegistro, plan, 0],
        function(err) { if (err) reject(err); resolve(); }
      );
    });

    // Prueba gratis de 3 días solo para tráfico de campaña (llega con ?trial=3 desde el anuncio)
    const trialDias = (plan === 'mensual' && parseInt(req.body.trial, 10) === 3 && !(user && user.trial_gratis_usado)) ? 3 : 0;

    const subscriptionData = { metadata: { userId, orderId, plan } };
    if (trialDias > 0) subscriptionData.trial_period_days = trialDias;

    const sessionParams = {
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{
        price_data: {
          currency: precioData.moneda.toLowerCase(),
          product_data: { name: label },
          unit_amount,
          recurring: { interval: 'month', interval_count: cfg.count }
        },
        quantity: 1
      }],
      subscription_data: subscriptionData,
      metadata: { userId, orderId, plan, trial: trialDias },
      success_url: `${FRONTEND_URL}/perfil?pago=exitoso&order=${orderId}`,
      cancel_url: trialDias > 0 ? `${FRONTEND_URL}/verificar-email` : `${FRONTEND_URL}/perfil?pago=cancelado`
    };

    // Reutilizar siempre el mismo cliente de Stripe para que sus suscripciones queden juntas
    const emailCliente = (user && user.email) || req.userEmail || undefined;
    let session;
    if (user && user.stripe_customer_id) {
      try {
        session = await stripe.checkout.sessions.create({ ...sessionParams, customer: user.stripe_customer_id });
      } catch (e) {
        if (e.code !== 'resource_missing') throw e;
      }
    }
    if (!session) {
      session = await stripe.checkout.sessions.create({ ...sessionParams, customer_email: emailCliente });
    }

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE pagos SET stripe_session_id = ?, updated_at = datetime('now') WHERE id = ?`,
        [session.id, pagoId],
        function(err) { if (err) reject(err); resolve(); }
      );
    });

    res.json({
      payment_url: session.url,
      checkout_url: session.url,
      session_id: session.id,
      order_id: orderId,
      amount: montoRegistro,
      descuento_aplicado: false,
      currency: precioData.moneda,
      plan
    });

  } catch (err) {
    console.error('Error crearPago:', err);
    res.status(500).json({ error: err.message || 'Error creando sesión de pago' });
  }
}];

// ============================================
// Webhook de Stripe
// ============================================
exports.webhook = [webhookRateLimit, async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const signature = req.headers['stripe-signature'];
    const rawBody = req.rawBody;

    if (!rawBody || !signature) {
      return res.status(400).send('Missing body or signature');
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('Firma Stripe inválida:', err.message);
      return res.status(400).send(`Webhook error: ${err.message}`);
    }

    console.log(`[webhook] Evento: ${event.type} id=${event.id}`);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const { orderId, plan, trial } = session.metadata || {};
      console.log(`[webhook] session.completed mode=${session.mode} payment_status=${session.payment_status} orderId=${orderId} trial=${trial}`);

      if (session.mode === 'subscription') {
        // Suscripción real: guarda IDs de Stripe y concede acceso inicial (trial o primer periodo)
        await activarSuscripcionStripe(stripe, session, orderId, plan || 'mensual', parseInt(trial, 10) || 0);
      } else if (session.payment_status === 'paid') {
        // Ruta legada: pago único (compatibilidad con checkouts antiguos)
        const paymentIntentId = session.payment_intent;
        if (orderId) {
          await new Promise((resolve, reject) => {
            db.run(
              `UPDATE pagos SET status = 'paid', stripe_payment_intent_id = ?, updated_at = datetime('now') WHERE order_id = ?`,
              [paymentIntentId, orderId],
              function(err) { if (err) reject(err); resolve(); }
            );
          });
          await activarPremium(orderId, plan || 'mensual');
        } else {
          console.warn(`[webhook] Sin orderId en metadata — activando por email: ${session.customer_email}`);
          await activarPremiumPorEmail(session.customer_email, paymentIntentId, plan || 'mensual');
        }
      }
    }

    // Renovación automática mensual + primer cobro tras la prueba.
    // 'subscription_create' se maneja en checkout.session.completed; aquí solo el cobro recurrente
    // ('subscription_cycle' incluye el primer cargo real cuando termina el trial de 3 días).
    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object;
      if (invoice.billing_reason === 'subscription_cycle') {
        const subId = invoice.subscription || invoice.parent?.subscription_details?.subscription;
        console.log(`[webhook] invoice.paid customer=${invoice.customer} sub=${subId} reason=${invoice.billing_reason}`);
        await renovarPremiumPorStripe(stripe, invoice.customer, subId, invoice.id);
      }
    }

    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      console.log(`[webhook] payment_failed customer=${invoice.customer} sub=${invoice.subscription}`);
      await avisarPagoFallido(invoice.customer);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Error webhook Stripe:', err);
    res.status(500).send('Error interno');
  }
}];

// ============================================
// Referidos: al pagar por primera vez una usuaria referida, marcarla como
// convertida y, cada 3 conversiones, regalar 1 mes a quien la invitó.
// Idempotente: solo actúa sobre referidos con convertido = 0.
// ============================================
async function procesarReferido(userId) {
  try {
    const ref = await new Promise((resolve, reject) => {
      db.get('SELECT id, referrer_id, convertido FROM referidos WHERE referido_id = ?', [userId],
        (err, row) => { if (err) reject(err); else resolve(row); });
    });
    if (!ref) return;

    // Acumular la comision de este pago (33% = $33 MXN), hasta 3 meses por referida.
    await acumularComision(ref.referrer_id, userId);

    // Marcar la conversion la primera vez (para el tracking del panel).
    if (!ref.convertido) {
      await new Promise((resolve, reject) => {
        db.run('UPDATE referidos SET convertido = 1 WHERE id = ?', [ref.id],
          (err) => { if (err) reject(err); else resolve(); });
      });
    }
  } catch (err) {
    console.error('[referido] Error procesarReferido:', err);
  }
}

// Abona la comision de afiliada por un pago real de la referida: $30 MXN (30% del
// mensual), hasta 3 meses por referida. Idempotente por UNIQUE(referido_id, mes_num).
async function acumularComision(referrerId, referidoId) {
  try {
    if (!referrerId || referrerId === referidoId) return; // sin auto-referido
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) AS n FROM comisiones WHERE referido_id = ?', [referidoId],
        (err, r) => { if (err) reject(err); else resolve(r); });
    });
    const ya = row?.n || 0;
    if (ya >= 3) return; // ya cobro sus 3 meses
    const mesNum = ya + 1;
    await new Promise((resolve, reject) => {
      db.run(
        "INSERT OR IGNORE INTO comisiones (id, referrer_id, referido_id, monto_mxn, mes_num, estado, created_at) VALUES (?, ?, ?, 30, ?, 'disponible', datetime('now'))",
        [uuidv4(), referrerId, referidoId, mesNum],
        (err) => { if (err) reject(err); else resolve(); });
    });
    console.log(`[comision] +$30 MXN a ${referrerId} por ${referidoId} (mes ${mesNum})`);
  } catch (err) {
    console.error('[comision] Error acumularComision:', err);
  }
}

// ============================================
// Activar suscripción real de Stripe (guarda IDs + concede acceso inicial)
// ============================================
exports.trialGratisSinTarjeta = async (req, res) => {
  try {
    const userId = req.userId;
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT id, email, tier, subscription_expires_at, trial_gratis_usado FROM users WHERE id = ?', [userId],
        (err, row) => { if (err) reject(err); else resolve(row); });
    });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (user.tier === 'premium' && user.subscription_expires_at && new Date(user.subscription_expires_at) > new Date()) {
      return res.status(400).json({ error: 'Ya tienes acceso Premium activo' });
    }
    if (user.trial_gratis_usado) {
      return res.status(400).json({ error: 'Ya usaste tu dia gratis sin tarjeta' });
    }
    const expira = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await new Promise((resolve, reject) => {
      db.run(
        "UPDATE users SET tier = 'premium', subscription_expires_at = ?, trial_gratis_usado = 1, trial_gratis_expira = ?, trial_gratis_email_enviado = 0 WHERE id = ?",
        [expira.toISOString(), expira.toISOString(), userId],
        function (err) { if (err) reject(err); else resolve(); });
    });
    console.log(`[trial-gratis] ${user.email} -> 1 dia premium sin tarjeta, expira ${expira.toISOString()}`);
    res.json({ ok: true, expira: expira.toISOString() });
  } catch (err) {
    console.error('[trial-gratis] error:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
};

exports.procesarTrialsGratisVencidos = async () => {
  try {
    const ahora = new Date().toISOString();

    // Recordatorio ~4h antes de terminar (a quien sigue en prueba y no se ha suscrito)
    const en4h = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    const porTerminar = await new Promise((resolve) => {
      db.all(
        `SELECT id, email FROM users
         WHERE trial_gratis_usado = 1
           AND trial_gratis_recordatorio = 0
           AND trial_gratis_expira IS NOT NULL
           AND trial_gratis_expira > ?
           AND trial_gratis_expira <= ?
           AND stripe_subscription_id IS NULL`,
        [ahora, en4h],
        (err, rows) => resolve(err ? [] : (rows || [])));
    });
    if (porTerminar.length) {
      const { enviarRecordatorioTrial } = require('../services/email');
      for (const u of porTerminar) {
        try { await enviarRecordatorioTrial(u.email); } catch (e) { console.error('[trial-recordatorio email]', e.message); }
        await new Promise((resolve) => {
          db.run('UPDATE users SET trial_gratis_recordatorio = 1 WHERE id = ?', [u.id], () => resolve());
        });
        console.log(`[trial-gratis] recordatorio enviado: ${u.email}`);
      }
    }

    const users = await new Promise((resolve) => {
      db.all(
        `SELECT id, email FROM users
         WHERE trial_gratis_usado = 1
           AND trial_gratis_email_enviado = 0
           AND trial_gratis_expira IS NOT NULL
           AND trial_gratis_expira < ?
           AND stripe_subscription_id IS NULL
           AND (subscription_expires_at IS NULL OR subscription_expires_at < ?)`,
        [ahora, ahora],
        (err, rows) => resolve(err ? [] : (rows || [])));
    });
    if (!users.length) return;
    const { enviarConversionSinTarjeta } = require('../services/email');
    for (const u of users) {
      try { await enviarConversionSinTarjeta(u.email); } catch (e) { console.error('[trial-gratis email]', e.message); }
      await new Promise((resolve) => {
        db.run("UPDATE users SET tier = 'free', trial_gratis_email_enviado = 1 WHERE id = ?", [u.id], () => resolve());
      });
      console.log(`[trial-gratis] vencido -> email + downgrade: ${u.email}`);
    }
  } catch (err) {
    console.error('[trial-gratis cron] error:', err.message);
  }
};

async function activarSuscripcionStripe(stripe, session, orderId, plan, trialDias) {
  try {
    const customerId = session.customer;
    const subscriptionId = session.subscription;

    // Ubicar al usuario por el pago pendiente (orderId) o por email
    let user = null;
    if (orderId) {
      user = await new Promise((resolve, reject) => {
        db.get(
          `SELECT u.id, u.email, u.tier, u.subscription_expires_at, u.stripe_customer_id, u.stripe_subscription_id
           FROM pagos p JOIN users u ON p.user_id = u.id
           WHERE p.order_id = ?`,
          [orderId],
          (err, row) => { if (err) reject(err); resolve(row); }
        );
      });
    }
    if (!user && session.customer_email) {
      user = await new Promise((resolve, reject) => {
        db.get('SELECT id, email, tier, subscription_expires_at, stripe_customer_id, stripe_subscription_id FROM users WHERE email = ?',
          [session.customer_email], (err, row) => { if (err) reject(err); resolve(row); });
      });
    }
    if (!user) { console.warn(`[webhook] suscripción: usuario no encontrado order=${orderId}`); return; }

    // 1) LO CRÍTICO PRIMERO: conceder acceso por el periodo real que cobra Stripe (un mes
    // de calendario tiene 28-31 días) más un día de gracia, para que el acceso local no
    // venza antes de que llegue la renovación. Las renovaciones extienden vía
    // invoice.payment_succeeded.
    let subStripe = null;
    try { subStripe = await stripe.subscriptions.retrieve(subscriptionId); }
    catch (e) { console.error('[webhook] no se pudo leer la suscripción:', e.message); }

    const dias = trialDias > 0 ? trialDias : diasDePeriodo(subStripe, PLANES[plan] ? PLANES[plan].dias : 30);
    let fechaExpiracion = new Date();
    if (user.tier === 'premium' && user.subscription_expires_at) {
      const existente = new Date(user.subscription_expires_at);
      if (existente > fechaExpiracion) fechaExpiracion = existente;
    }
    fechaExpiracion = new Date(fechaExpiracion.getTime() + dias * 86400000 + GRACIA_MS);

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE users SET tier = 'premium', subscription_expires_at = ?, new_account_discount = 0 WHERE id = ?`,
        [fechaExpiracion.toISOString(), user.id],
        function(err) { if (err) reject(err); resolve(); }
      );
    });

    if (trialDias > 0) {
      await new Promise((resolve) => {
        db.run('UPDATE users SET trial_gratis_usado = 1 WHERE id = ?', [user.id], () => resolve());
      });
    }

    if (orderId) {
      await new Promise((resolve) => {
        db.run(`UPDATE pagos SET status = 'paid', updated_at = datetime('now') WHERE order_id = ?`,
          [orderId], () => resolve());
      });
    }

    console.log(`[webhook] Suscripción activada: ${user.email}, trial=${trialDias}d, acceso hasta ${fechaExpiracion.toISOString()}`);

    // Conversión de referido SOLO si hubo pago real. Con prueba de 3 días aún no
    // hay cobro → se contará en el primer invoice (renovarPremiumPorStripe).
    if (trialDias === 0) await procesarReferido(user.id);

    // 2) Guardar IDs de Stripe para renovaciones futuras. Aislado: si las columnas no
    // existen todavía, esto falla SIN afectar el acceso ya concedido arriba.
    try {
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE users SET stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?`,
          [customerId, subscriptionId, user.id],
          function(err) { if (err) reject(err); resolve(); }
        );
      });
    } catch (idErr) {
      console.error(`[webhook] No se pudieron guardar IDs Stripe (¿faltan columnas?): ${idErr.message}`);
    }

    // 3) Red de seguridad: si aun así quedó otra suscripción cobrando (dos pestañas de pago
    // abiertas a la vez), se cancela la anterior. El tiempo ya pagado se conserva porque el
    // acceso de arriba se sumó sobre la fecha de vencimiento existente.
    try {
      const otras = (await suscripcionesVivas(stripe, user)).filter(s => s.id !== subscriptionId);
      for (const otra of otras) {
        await stripe.subscriptions.cancel(otra.id);
        console.warn(`[webhook] Suscripción duplicada cancelada: ${otra.id} de ${user.email} (queda ${subscriptionId})`);
      }
    } catch (dupErr) {
      console.error(`[webhook] No se pudo revisar duplicadas de ${user.email}: ${dupErr.message}`);
    }
  } catch (err) {
    console.error('[webhook] Error activarSuscripcionStripe:', err);
  }
}

// ============================================
// Activar suscripción premium
// ============================================
async function activarPremium(orderId, plan) {
  try {
    const pago = await new Promise((resolve, reject) => {
      db.get(
        `SELECT p.user_id, p.plan, u.tier, u.subscription_expires_at
         FROM pagos p JOIN users u ON p.user_id = u.id
         WHERE p.order_id = ?`,
        [orderId],
        (err, row) => { if (err) reject(err); resolve(row); }
      );
    });

    if (!pago) { console.error('Pago no encontrado para order:', orderId); return; }

    const dias = PLANES[pago.plan] ? PLANES[pago.plan].dias : 30;
    let fechaExpiracion = new Date();
    if (pago.tier === 'premium' && pago.subscription_expires_at) {
      const existente = new Date(pago.subscription_expires_at);
      if (existente > fechaExpiracion) fechaExpiracion = existente;
    }
    fechaExpiracion.setDate(fechaExpiracion.getDate() + dias);

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE users SET tier = 'premium', subscription_expires_at = ?, new_account_discount = 0 WHERE id = ?`,
        [fechaExpiracion.toISOString(), pago.user_id],
        function(err) { if (err) reject(err); resolve(); }
      );
    });

    console.log(`Premium activado: usuario ${pago.user_id}, expira ${fechaExpiracion.toISOString()}`);

    await procesarReferido(pago.user_id);

    // Notificar al usuario por correo
    try {
      const { enviarConfirmacionPago } = require('../services/email');
      const usuario = await new Promise((resolve, reject) => {
        db.get('SELECT email FROM users WHERE id = ?', [pago.user_id], (err, row) => { if (err) reject(err); else resolve(row); });
      });
      if (usuario?.email) await enviarConfirmacionPago(usuario.email, fechaExpiracion.toISOString());
    } catch (emailErr) {
      console.error('Error enviando email confirmación pago:', emailErr.message);
    }
  } catch (err) {
    console.error('Error activando premium:', err);
    throw err;
  }
}

// Fallback: activar premium buscando usuario por email (cuando falta orderId en metadata)
async function activarPremiumPorEmail(email, paymentIntentId, plan) {
  if (!email) { console.error('[webhook] activarPremiumPorEmail: sin email'); return; }
  try {
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT id, tier, subscription_expires_at FROM users WHERE email = ?', [email],
        (err, row) => { if (err) reject(err); resolve(row); });
    });
    if (!user) { console.error(`[webhook] Usuario no encontrado por email: ${email}`); return; }

    const dias = PLANES[plan] ? PLANES[plan].dias : 30;
    let fechaExpiracion = new Date();
    if (user.tier === 'premium' && user.subscription_expires_at) {
      const existente = new Date(user.subscription_expires_at);
      if (existente > fechaExpiracion) fechaExpiracion = existente;
    }
    fechaExpiracion.setDate(fechaExpiracion.getDate() + dias);

    const pagoId = uuidv4();
    const orderId = `CF-auto-${pagoId.slice(0, 8)}`;
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO pagos (id, user_id, order_id, monto_usd, status, plan, descuento_aplicado, stripe_payment_intent_id, created_at, updated_at)
         VALUES (?, ?, ?, 0, 'paid', ?, 0, ?, datetime('now'), datetime('now'))`,
        [pagoId, user.id, orderId, plan, paymentIntentId],
        function(err) { if (err) reject(err); resolve(); }
      );
    });

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE users SET tier = 'premium', subscription_expires_at = ?, new_account_discount = 0 WHERE id = ?`,
        [fechaExpiracion.toISOString(), user.id],
        function(err) { if (err) reject(err); resolve(); }
      );
    });

    console.log(`[webhook] Premium activado por email: ${email}, expira ${fechaExpiracion.toISOString()}`);

    await procesarReferido(user.id);

    try {
      const { enviarConfirmacionPago } = require('../services/email');
      await enviarConfirmacionPago(email, fechaExpiracion.toISOString());
    } catch (emailErr) {
      console.error('Error enviando email confirmación pago:', emailErr.message);
    }
  } catch (err) {
    console.error('[webhook] Error activarPremiumPorEmail:', err);
  }
}

// Renovar premium por renovación automática de suscripción Stripe
async function avisarPagoFallido(customerId) {
  try {
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT id, email, renovacion_email_enviado FROM users WHERE stripe_customer_id = ?', [customerId],
        (err, row) => { if (err) reject(err); else resolve(row); });
    });
    if (!user || user.renovacion_email_enviado) return;
    const { enviarRenovacionPremium } = require('../services/email');
    try { await enviarRenovacionPremium(user.email); } catch (e) { console.error('[pago-fallido email]', e.message); }
    db.run('UPDATE users SET renovacion_email_enviado = 1 WHERE id = ?', [user.id], () => {});
    console.log(`[pago-fallido] aviso enviado: ${user.email}`);
  } catch (err) {
    console.error('[avisarPagoFallido] error:', err.message);
  }
}

exports.procesarPremiumsVencidos = async () => {
  try {
    const users = await new Promise((resolve) => {
      db.all(
        `SELECT id, email, subscription_expires_at, stripe_subscription_id FROM users
         WHERE stripe_subscription_id IS NOT NULL
           AND subscription_expires_at IS NOT NULL
           AND datetime(subscription_expires_at) < datetime('now', '-12 hours')
           AND renovacion_email_enviado = 0`,
        [],
        (err, rows) => resolve(err ? [] : (rows || [])));
    });
    if (!users.length) return;
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const { enviarRenovacionPremium } = require('../services/email');
    for (const u of users) {
      // Si Stripe sigue cobrando y el periodo pagado no ha terminado, la clienta está al
      // corriente: no se le quita el acceso ni se le pide que renueve.
      try {
        const sub = await stripe.subscriptions.retrieve(u.stripe_subscription_id);
        const fin = finPeriodo(sub);
        if (['active', 'trialing'].includes(sub.status) && fin && fin > new Date()) {
          const expira = await sincronizarAcceso(u.id, u.subscription_expires_at, sub);
          console.log(`[premium-vencido] ${u.email} sigue al corriente en Stripe; acceso hasta ${expira.toISOString()}`);
          continue;
        }
      } catch (e) {
        if (e.code !== 'resource_missing') {
          console.error(`[premium-vencido] no se pudo consultar Stripe para ${u.email}: ${e.message}`);
          continue;
        }
      }
      try { await enviarRenovacionPremium(u.email); } catch (e) { console.error('[premium-vencido email]', e.message); }
      await new Promise((resolve) => {
        db.run("UPDATE users SET renovacion_email_enviado = 1, tier = 'free' WHERE id = ?", [u.id], () => resolve());
      });
      console.log(`[premium-vencido] aviso + downgrade: ${u.email}`);
    }
  } catch (err) {
    console.error('[premium-vencido cron] error:', err.message);
  }
};

async function renovarPremiumPorStripe(stripe, customerId, subscriptionId, invoiceId) {
  try {
    const user = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id, email, tier, subscription_expires_at FROM users
         WHERE stripe_customer_id = ? OR stripe_subscription_id = ?`,
        [customerId, subscriptionId],
        (err, row) => { if (err) reject(err); resolve(row); }
      );
    });

    if (!user) {
      console.warn(`[webhook] renovar: usuario no encontrado customer=${customerId}`);
      return;
    }

    // Evitar procesar el mismo invoice dos veces
    const yaExiste = await new Promise((resolve, reject) => {
      db.get('SELECT id FROM pagos WHERE stripe_payment_intent_id = ?', [invoiceId],
        (err, row) => { if (err) reject(err); resolve(row); });
    });
    if (yaExiste) {
      console.log(`[webhook] renovar: invoice ${invoiceId} ya procesado`);
      return;
    }

    let fechaExpiracion = new Date();
    if (user.tier === 'premium' && user.subscription_expires_at) {
      const existente = new Date(user.subscription_expires_at);
      if (existente > fechaExpiracion) fechaExpiracion = existente;
    }
    let diasRenov = 30;
    let finStripe = null;
    try {
      const subInfo = await stripe.subscriptions.retrieve(subscriptionId);
      const rec = subInfo.items && subInfo.items.data && subInfo.items.data[0] && subInfo.items.data[0].price && subInfo.items.data[0].price.recurring;
      if (rec) diasRenov = rec.interval === 'year' ? 365 : (rec.interval_count || 1) * 30;
      diasRenov = diasDePeriodo(subInfo, diasRenov);
      finStripe = finPeriodo(subInfo);
    } catch (e) { console.error('[renovar] no se pudo leer intervalo:', e.message); }
    fechaExpiracion = new Date(fechaExpiracion.getTime() + diasRenov * 86400000);
    // Nunca dejar el acceso por detrás del periodo que Stripe acaba de cobrar
    if (finStripe && fechaExpiracion < new Date(finStripe.getTime() + GRACIA_MS)) {
      fechaExpiracion = new Date(finStripe.getTime() + GRACIA_MS);
    }

    const pagoId = uuidv4();
    const orderId = `CF-sub-${pagoId.slice(0, 8)}`;
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO pagos (id, user_id, order_id, monto_usd, status, plan, descuento_aplicado, stripe_payment_intent_id, created_at, updated_at)
         VALUES (?, ?, ?, 0, 'paid', 'mensual', 0, ?, datetime('now'), datetime('now'))`,
        [pagoId, user.id, orderId, invoiceId],
        function(err) { if (err) reject(err); resolve(); }
      );
    });

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE users SET tier = 'premium', subscription_expires_at = ?, renovacion_email_enviado = 0 WHERE id = ?`,
        [fechaExpiracion.toISOString(), user.id],
        function(err) { if (err) reject(err); resolve(); }
      );
    });

    console.log(`[webhook] Renovación premium: ${user.email}, expira ${fechaExpiracion.toISOString()}`);

    await procesarReferido(user.id);
  } catch (err) {
    console.error('[webhook] Error renovarPremiumPorStripe:', err);
  }
}

// ============================================
// Verificar estado de pago
// ============================================
exports.verificarEstado = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.userId;

    if (!orderId || !orderId.startsWith('CF-')) {
      return res.status(400).json({ error: 'Order ID inválido' });
    }

    const pago = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM pagos WHERE order_id = ? AND user_id = ?',
        [orderId, userId],
        (err, row) => { if (err) reject(err); resolve(row); }
      );
    });

    if (!pago) return res.status(404).json({ error: 'Pago no encontrado' });

    res.json({
      order_id: pago.order_id,
      status: pago.status,
      amount: pago.monto_usd,
      plan: pago.plan,
      descuento_aplicado: pago.descuento_aplicado === 1,
      created_at: pago.created_at,
      updated_at: pago.updated_at
    });
  } catch (err) {
    console.error('Error verificarEstado:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

// ============================================
// Portal de Cliente de Stripe (gestionar/cancelar suscripción)
// ============================================
exports.portalCliente = async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const userId = req.userId;

    const user = await new Promise((resolve, reject) => {
      db.get('SELECT stripe_customer_id FROM users WHERE id = ?', [userId],
        (err, row) => { if (err) reject(err); resolve(row); });
    });

    if (!user || !user.stripe_customer_id) {
      return res.status(404).json({ error: 'No tienes una suscripción gestionable.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${FRONTEND_URL}/perfil`
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Error portalCliente:', err);
    res.status(500).json({ error: 'No se pudo abrir el portal de gestión.' });
  }
};

module.exports.webhookRateLimit = webhookRateLimit;
module.exports.crearPagoRateLimit = crearPagoRateLimit;
module.exports.suscripcionesVivas = suscripcionesVivas;
module.exports.sincronizarAcceso = sincronizarAcceso;
module.exports.finPeriodo = finPeriodo;
