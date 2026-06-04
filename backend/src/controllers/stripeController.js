const stripe = require('../services/stripe');
const db = require('../models');

const FRONTEND = process.env.FRONTEND_URL || 'https://crochetflix.app';

const PLANES = () => ({
  mensual: process.env.STRIPE_PRICE_MENSUAL,
  anual: process.env.STRIPE_PRICE_ANUAL,
});

function dbGet(sql, params) {
  return new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row))
  );
}
function dbRun(sql, params) {
  return new Promise((resolve, reject) =>
    db.run(sql, params, (err) => err ? reject(err) : resolve())
  );
}

async function getOrCreateCustomer(userId) {
  const user = await dbGet('SELECT email, stripe_customer_id FROM users WHERE id = ?', [userId]);
  if (user?.stripe_customer_id) return user.stripe_customer_id;

  const customer = await stripe.customers.create({ email: user.email, metadata: { userId } });
  await dbRun('UPDATE users SET stripe_customer_id = ? WHERE id = ?', [customer.id, userId]);
  return customer.id;
}

async function activarPremium(userId, subscriptionId, periodEnd) {
  const expiresAt = periodEnd
    ? new Date(periodEnd * 1000).toISOString()
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await dbRun(
    `UPDATE users SET tier = 'premium', stripe_subscription_id = ?, subscription_expires_at = ? WHERE id = ?`,
    [subscriptionId, expiresAt, userId]
  );
  console.log(`[stripe] Premium activado para ${userId} hasta ${expiresAt}`);
}

async function desactivarPremium(userId) {
  await dbRun(
    `UPDATE users SET tier = 'free', stripe_subscription_id = NULL WHERE id = ?`,
    [userId]
  );
  console.log(`[stripe] Premium desactivado para ${userId}`);
}

async function userIdDeCustomer(customerId) {
  const row = await dbGet('SELECT id FROM users WHERE stripe_customer_id = ?', [customerId]);
  return row?.id || null;
}

async function verificarRecompensaReferido(userId) {
  try {
    const referido = await new Promise(r =>
      db.get('SELECT * FROM referidos WHERE referido_id = ? AND convertido = 0', [userId], (_, row) => r(row))
    );
    if (!referido) return;
    await new Promise(r => db.run('UPDATE referidos SET convertido = 1 WHERE id = ?', [referido.id], () => r()));
    const { n } = await new Promise(r =>
      db.get('SELECT COUNT(*) as n FROM referidos WHERE referrer_id = ? AND convertido = 1', [referido.referrer_id], (_, row) => r(row || { n: 0 }))
    );
    if (n > 0 && n % 3 === 0) {
      await new Promise(r =>
        db.run(
          `UPDATE users SET tier = 'premium', subscription_expires_at = datetime(COALESCE(subscription_expires_at, datetime('now')), '+30 days') WHERE id = ?`,
          [referido.referrer_id], () => r()
        )
      );
      console.log(`[referidos] Recompensa: 1 mes gratis para ${referido.referrer_id} (${n} referidos convertidos)`);
    }
  } catch (e) {
    console.error('[referidos] Error verificando recompensa:', e.message);
  }
}

// POST /api/stripe/checkout
exports.crearCheckout = async (req, res) => {
  try {
    const { plan } = req.body;
    const userId = req.userId;
    const precios = PLANES();

    if (!precios[plan]) return res.status(400).json({ error: 'Plan no válido. Usa "mensual" o "anual".' });

    const customerId = await getOrCreateCustomer(userId);

    // Evitar doble suscripción activa
    const subs = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 1 });
    if (subs.data.length > 0) {
      return res.status(400).json({ error: 'Ya tienes una suscripción activa. Usa "Gestionar suscripción" para cambiar tu plan.' });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: precios[plan], quantity: 1 }],
      mode: 'subscription',
      success_url: `${FRONTEND}/perfil?pago=exitoso`,
      cancel_url: `${FRONTEND}/perfil?pago=cancelado`,
      subscription_data: { metadata: { userId, plan } },
      metadata: { userId, plan },
      locale: 'es',
      allow_promotion_codes: true,
    });

    res.json({ checkout_url: session.url });
  } catch (err) {
    console.error('[stripe] Error en checkout:', err.message);
    res.status(500).json({ error: 'Error creando sesión de pago. Intenta de nuevo.' });
  }
};

// POST /api/stripe/webhook  (sin auth — verificado por firma Stripe)
exports.webhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).json({ error: 'Falta la firma Stripe' });

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe] Firma inválida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[stripe] Evento: ${event.type}`);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode !== 'subscription') break;
        const userId = session.metadata?.userId;
        if (!userId) { console.log('[stripe] checkout.session.completed sin userId en metadata'); break; }
        console.log(`[stripe] session.subscription=${session.subscription}`);
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        console.log(`[stripe] sub.status=${sub.status} sub.current_period_end=${sub.current_period_end}`);
        await activarPremium(userId, sub.id, sub.current_period_end);
        await verificarRecompensaReferido(userId);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        // subscription_create ya está manejado en checkout.session.completed
        if (invoice.billing_reason === 'subscription_create') break;
        if (!invoice.subscription) break;
        const userId = await userIdDeCustomer(invoice.customer);
        if (!userId) break;
        const sub = await stripe.subscriptions.retrieve(invoice.subscription);
        await activarPremium(userId, sub.id, sub.current_period_end);
        console.log(`[stripe] Suscripción renovada para ${userId}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const userId = await userIdDeCustomer(sub.customer);
        if (userId) await desactivarPremium(userId);
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const userId = await userIdDeCustomer(sub.customer);
        if (!userId) break;
        if (sub.status === 'active') {
          await activarPremium(userId, sub.id, sub.current_period_end);
        } else if (['canceled', 'unpaid', 'paused'].includes(sub.status)) {
          await desactivarPremium(userId);
        }
        break;
      }
    }
  } catch (err) {
    console.error(`[stripe] Error procesando ${event.type}:`, err.message);
  }

  res.json({ received: true });
};

// POST /api/stripe/portal  — Customer Portal para gestionar/cancelar
exports.portal = async (req, res) => {
  try {
    const user = await dbGet('SELECT stripe_customer_id FROM users WHERE id = ?', [req.userId]);
    if (!user?.stripe_customer_id) {
      return res.status(400).json({ error: 'No tienes una suscripción activa con Stripe.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${FRONTEND}/perfil`,
    });

    res.json({ portal_url: session.url });
  } catch (err) {
    console.error('[stripe] Error en portal:', err.message);
    res.status(500).json({ error: 'Error abriendo el portal de gestión.' });
  }
};
