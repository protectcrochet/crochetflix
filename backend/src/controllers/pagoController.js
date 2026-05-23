const { v4: uuidv4 } = require('uuid');
const db = require('../models');
const nowpayments = require('../services/nowpayments');

const IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

// Crear orden de pago
exports.crearPago = async (req, res) => {
  try {
    const userId = req.userId;
    const { plan = 'mensual' } = req.body;

    // Verificar si ya tiene suscripción activa
    const user = await new Promise((resolve, reject) => {
      db.get(
        'SELECT tier, subscription_expires_at FROM users WHERE id = ?',
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
      mensual: { amount: 4.99, description: 'CrochetFlix Premium - Suscripción mensual' },
      anual: { amount: 49.99, description: 'CrochetFlix Premium - Suscripción anual (2 meses gratis)' }
    };

    const planSeleccionado = precios[plan] || precios.mensual;
    const orderId = `CF-${uuidv4()}`;

    // Crear registro en DB
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO pagos (id, user_id, nowpayments_order_id, monto_usd, status)
         VALUES (?, ?, ?, ?, ?)`,
        [uuidv4(), userId, orderId, planSeleccionado.amount, 'pending'],
        function(err) {
          if (err) reject(err);
          resolve();
        }
      );
    });

    // Crear pago en NOWPayments
    const pago = await nowpayments.crearPago({
      price_amount: planSeleccionado.amount,
      price_currency: 'usd',
      pay_currency: 'usdttrc20',
      order_id: orderId,
      order_description: planSeleccionado.description,
      ipn_callback_url: `${BACKEND_URL}/api/pagos/webhook`,
      success_url: `${FRONTEND_URL}/perfil?pago=exitoso`,
      cancel_url: `${FRONTEND_URL}/perfil?pago=cancelado`
    });

    res.json({
      payment_url: pago.payment_url,
      order_id: orderId,
      amount: planSeleccionado.amount,
      currency: 'USD'
    });

  } catch (err) {
    console.error('Error crearPago:', err);
    res.status(500).json({ error: 'Error creando orden de pago' });
  }
};

// Webhook de NOWPayments (IPN)
exports.webhook = async (req, res) => {
  try {
    const signature = req.headers['x-nowpayments-sig'];
    const payload = req.body;

    // Verificar firma
    if (!IPN_SECRET) {
      console.error('IPN_SECRET no configurado');
      return res.status(500).send('Error');
    }

    const firmaValida = nowpayments.verificarFirmaIPN(payload, signature, IPN_SECRET);
    if (!firmaValida) {
      console.error('Firma IPN inválida');
      return res.status(400).send('Firma inválida');
    }

    const { payment_status, order_id, payment_id } = payload;

    // Actualizar estado del pago en DB
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE pagos SET status = ?, nowpayments_order_id = ? WHERE nowpayments_order_id = ?',
        [payment_status, payment_id, order_id],
        function(err) {
          if (err) reject(err);
          resolve();
        }
      );
    });

    // Si el pago está confirmado, activar premium
    if (payment_status === 'finished' || payment_status === 'confirmed') {
      // Buscar usuario por order_id
      const pago = await new Promise((resolve, reject) => {
        db.get(
          'SELECT user_id, monto_usd FROM pagos WHERE nowpayments_order_id = ?',
          [order_id],
          (err, row) => {
            if (err) reject(err);
            resolve(row);
          }
        );
      });

      if (pago) {
        // Determinar duración según monto
        let dias = 30; // mensual por defecto
        if (pago.monto_usd >= 40) dias = 365; // anual

        const fechaExpiracion = new Date();
        fechaExpiracion.setDate(fechaExpiracion.getDate() + dias);

        // Activar premium
        await new Promise((resolve, reject) => {
          db.run(
            `UPDATE users SET tier = ?, subscription_expires_at = ? WHERE id = ?`,
            ['premium', fechaExpiracion.toISOString(), pago.user_id],
            function(err) {
              if (err) reject(err);
              resolve();
            }
          );
        });

        console.log(`✅ Premium activado para usuario ${pago.user_id} hasta ${fechaExpiracion}`);
      }
    }

    // Responder a NOWPayments
    res.status(200).send('OK');

  } catch (err) {
    console.error('Error webhook:', err);
    res.status(500).send('Error');
  }
};

// Verificar estado de pago (para polling del frontend)
exports.verificarEstado = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.userId;

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

    // Si está pendiente, consultar NOWPayments
    if (pago.status === 'pending' && pago.nowpayments_order_id) {
      try {
        const estadoNP = await nowpayments.verificarPago(pago.nowpayments_order_id);

        // Actualizar si cambió
        if (estadoNP.payment_status !== pago.status) {
          await new Promise((resolve, reject) => {
            db.run(
              'UPDATE pagos SET status = ? WHERE id = ?',
              [estadoNP.payment_status, pago.id],
              function(err) {
                if (err) reject(err);
                resolve();
              }
            );
          });
          pago.status = estadoNP.payment_status;
        }
      } catch (err) {
        console.error('Error consultando NOWPayments:', err);
      }
    }

    res.json({
      order_id: pago.nowpayments_order_id,
      status: pago.status,
      amount: pago.monto_usd,
      created_at: pago.created_at
    });

  } catch (err) {
    console.error('Error verificarEstado:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};