const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const db = require('../models');
const nowpayments = require('../services/nowpayments');

const IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

// ============================================
// Rate Limiter para webhooks
// ============================================
const webhookRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: 'Too many webhook requests',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false
});

// ============================================
// Rate Limiter para crear pagos
// ============================================
const crearPagoRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Demasiadas solicitudes de pago. Intenta más tarde.',
  standardHeaders: true,
  legacyHeaders: false
});

// ============================================
// Estados de pago de NOWPayments
// ============================================
const ESTADOS_PAGO = {
  PENDIENTES: ['waiting', 'confirming', 'sending', 'partially_paid'],
  EXITOSOS: ['finished', 'confirmed'],
  FALLIDOS: ['failed', 'refunded', 'expired']
};

// ============================================
// Crear orden de pago
// ============================================
exports.crearPago = [crearPagoRateLimit, async (req, res) => {
  try {
    const userId = req.userId;
    const { plan = 'mensual' } = req.body;

    // Validar plan
    const planesValidos = ['mensual', 'anual'];
    if (!planesValidos.includes(plan)) {
      return res.status(400).json({ error: 'Plan inválido. Use mensual o anual.' });
    }

    // Verificar usuario: suscripción activa y descuento
    const user = await new Promise((resolve, reject) => {
      db.get(
        'SELECT tier, subscription_expires_at, new_account_discount FROM users WHERE id = ?',
        [userId],
        (err, row) => {
          if (err) reject(err);
          resolve(row);
        }
      );
    });

    if (user && user.tier === 'premium' && new Date(user.subscription_expires_at) > new Date()) {
      return res.status(400).json({ error: 'Ya tienes una suscripción activa' });
    }

    // Configurar precio según plan
    const precios = {
      mensual: { amount: 4.99, description: 'CrochetFlix Premium - Suscripción mensual', dias: 30 },
      anual: { amount: 49.99, description: 'CrochetFlix Premium - Suscripción anual (2 meses gratis)', dias: 365 }
    };

    const planSeleccionado = precios[plan];
    const montoOriginal = planSeleccionado.amount;

    // Aplicar descuento del 25% para cuentas nuevas (una sola vez)
    const tieneDescuento = user?.new_account_discount === 1;
    const monto = tieneDescuento
      ? Math.round(montoOriginal * 0.75 * 100) / 100
      : montoOriginal;

    const orderId = `CF-${uuidv4()}`;
    const pagoId = uuidv4();

    // Crear registro en DB
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO pagos (id, user_id, nowpayments_order_id, monto_usd, status, plan, descuento_aplicado, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [pagoId, userId, orderId, monto, 'pending', plan, tieneDescuento ? 1 : 0],
        function(err) {
          if (err) reject(err);
          resolve();
        }
      );
    });

    const description = tieneDescuento
      ? `${planSeleccionado.description} (25% descuento cuenta nueva)`
      : planSeleccionado.description;

    // Crear pago en NOWPayments
    const pago = await nowpayments.crearPago({
      price_amount: monto,
      price_currency: 'usd',
      pay_currency: 'usdttrc20',
      order_id: orderId,
      order_description: description,
      ipn_callback_url: `${BACKEND_URL}/api/pagos/webhook`,
      success_url: `${FRONTEND_URL}/perfil?pago=exitoso&order=${orderId}`,
      cancel_url: `${FRONTEND_URL}/perfil?pago=cancelado&order=${orderId}`
    });

    res.json({
      payment_url: pago.payment_url,
      order_id: orderId,
      amount: monto,
      original_amount: montoOriginal,
      descuento_aplicado: tieneDescuento,
      currency: 'USD',
      plan: plan
    });

  } catch (err) {
    console.error('❌ Error crearPago:', err);
    res.status(500).json({ error: err.message || 'Error creando orden de pago' });
  }
}];

// ============================================
// Webhook de NOWPayments (IPN)
// CRÍTICO: Siempre responder 200
// ============================================
exports.webhook = [webhookRateLimit, async (req, res) => {
  res.status(200).send('OK');

  try {
    const signature = req.headers['x-nowpayments-sig'];
    const rawBody = req.rawBody;

    if (!IPN_SECRET) {
      console.error('❌ IPN_SECRET no configurado');
      return;
    }

    if (!signature || !rawBody) {
      console.error('❌ Falta firma o body en webhook');
      return;
    }

    const firmaValida = nowpayments.verificarFirmaIPN(rawBody, signature, IPN_SECRET);
    if (!firmaValida) {
      console.error('❌ Firma IPN inválida');
      return;
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (err) {
      console.error('❌ Error parseando payload:', err.message);
      return;
    }

    const { payment_status, order_id, payment_id, actually_paid, pay_currency } = payload;

    console.log('📨 Webhook recibido:', {
      order_id,
      payment_status,
      payment_id: payment_id?.substring(0, 10) + '...',
      actually_paid,
      pay_currency
    });

    if (!order_id || !order_id.startsWith('CF-')) {
      console.error('❌ order_id inválido:', order_id);
      return;
    }

    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE pagos 
         SET status = ?, nowpayments_payment_id = ?, actually_paid = ?, pay_currency = ?, updated_at = datetime('now')
         WHERE nowpayments_order_id = ?`,
        [payment_status, payment_id, actually_paid, pay_currency, order_id],
        function(err) {
          if (err) reject(err);
          resolve();
        }
      );
    });

    if (ESTADOS_PAGO.EXITOSOS.includes(payment_status)) {
      await activarPremium(order_id, payment_status);
    } else if (ESTADOS_PAGO.FALLIDOS.includes(payment_status)) {
      await desactivarPremium(order_id, payment_status);
    } else {
      console.log(`⏳ Pago ${order_id} en estado: ${payment_status}`);
    }

  } catch (err) {
    console.error('❌ Error procesando webhook:', err);
  }
}];

// ============================================
// Activar suscripción premium
// ============================================
async function activarPremium(orderId, status) {
  try {
    const pago = await new Promise((resolve, reject) => {
      db.get(
        `SELECT p.user_id, p.monto_usd, p.plan, u.tier, u.subscription_expires_at
         FROM pagos p
         JOIN users u ON p.user_id = u.id
         WHERE p.nowpayments_order_id = ?`,
        [orderId],
        (err, row) => {
          if (err) reject(err);
          resolve(row);
        }
      );
    });

    if (!pago) {
      console.error('❌ No se encontró pago para order:', orderId);
      return;
    }

    let dias = 30;
    if (pago.plan === 'anual' || pago.monto_usd >= 40) {
      dias = 365;
    }

    let fechaExpiracion = new Date();
    if (pago.tier === 'premium' && pago.subscription_expires_at) {
      const fechaExistente = new Date(pago.subscription_expires_at);
      if (fechaExistente > fechaExpiracion) {
        fechaExpiracion = fechaExistente;
      }
    }
    fechaExpiracion.setDate(fechaExpiracion.getDate() + dias);

    // Activar premium y consumir el descuento de cuenta nueva
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE users SET tier = ?, subscription_expires_at = ?, new_account_discount = 0 WHERE id = ?`,
        ['premium', fechaExpiracion.toISOString(), pago.user_id],
        function(err) {
          if (err) reject(err);
          resolve();
        }
      );
    });

    console.log(`✅ Premium activado para usuario ${pago.user_id}`);
    console.log(`   Expira: ${fechaExpiracion.toISOString()}`);
    console.log(`   Estado pago: ${status}`);

  } catch (err) {
    console.error('❌ Error activando premium:', err);
    throw err;
  }
}

// ============================================
// Desactivar premium
// ============================================
async function desactivarPremium(orderId, status) {
  try {
    const pago = await new Promise((resolve, reject) => {
      db.get(
        'SELECT user_id FROM pagos WHERE nowpayments_order_id = ?',
        [orderId],
        (err, row) => {
          if (err) reject(err);
          resolve(row);
        }
      );
    });

    if (!pago) return;

    const user = await new Promise((resolve, reject) => {
      db.get(
        'SELECT tier, subscription_expires_at FROM users WHERE id = ?',
        [pago.user_id],
        (err, row) => {
          if (err) reject(err);
          resolve(row);
        }
      );
    });

    if (user && user.tier === 'premium' && new Date(user.subscription_expires_at) <= new Date()) {
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE users SET tier = ? WHERE id = ?',
          ['free', pago.user_id],
          function(err) {
            if (err) reject(err);
            resolve();
          }
        );
      });
      console.log(`⚠️  Suscripción expirada para usuario ${pago.user_id}`);
    }

  } catch (err) {
    console.error('❌ Error desactivando premium:', err);
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
        'SELECT * FROM pagos WHERE nowpayments_order_id = ? AND user_id = ?',
        [orderId, userId],
        (err, row) => {
          if (err) reject(err);
          resolve(row);
        }
      );
    });

    if (!pago) {
      return res.status(404).json({ error: 'Pago no encontrado' });
    }

    if (ESTADOS_PAGO.PENDIENTES.includes(pago.status) && pago.nowpayments_payment_id) {
      try {
        const estadoNP = await nowpayments.verificarPago(pago.nowpayments_payment_id);

        if (estadoNP.payment_status && estadoNP.payment_status !== pago.status) {
          await new Promise((resolve, reject) => {
            db.run(
              `UPDATE pagos SET status = ?, updated_at = datetime('now') WHERE id = ?`,
              [estadoNP.payment_status, pago.id],
              function(err) {
                if (err) reject(err);
                resolve();
              }
            );
          });
          pago.status = estadoNP.payment_status;

          if (ESTADOS_PAGO.EXITOSOS.includes(estadoNP.payment_status)) {
            await activarPremium(orderId, estadoNP.payment_status);
          }
        }
      } catch (err) {
        console.error('❌ Error consultando NOWPayments:', err.message);
      }
    }

    res.json({
      order_id: pago.nowpayments_order_id,
      status: pago.status,
      amount: pago.monto_usd,
      plan: pago.plan,
      created_at: pago.created_at,
      updated_at: pago.updated_at
    });

  } catch (err) {
    console.error('❌ Error verificarEstado:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

module.exports.webhookRateLimit = webhookRateLimit;
module.exports.crearPagoRateLimit = crearPagoRateLimit;
