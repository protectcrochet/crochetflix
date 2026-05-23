const axios = require('axios');
const crypto = require('crypto');

const API_URL = process.env.NOWPAYMENTS_API_URL || 'https://api.nowpayments.io/v1';
const API_KEY = process.env.NOWPAYMENTS_API_KEY;

if (!API_KEY) {
  console.error('⚠️  NOWPAYMENTS_API_KEY no está configurado');
}

const nowpaymentsClient = axios.create({
  baseURL: API_URL,
  headers: {
    'x-api-key': API_KEY,
    'Content-Type': 'application/json'
  },
  timeout: 10000 // 10 segundos timeout
});

// Crear orden de pago (usa /invoice para obtener hosted checkout URL)
async function crearPago({ price_amount, price_currency, pay_currency, order_id, order_description, ipn_callback_url, success_url, cancel_url }) {
  try {
    const response = await nowpaymentsClient.post('/invoice', {
      price_amount,
      price_currency,
      order_id,
      order_description,
      ipn_callback_url,
      success_url,
      cancel_url
    });

    const data = response.data;

    // Validar respuesta
    if (!data.invoice_url) {
      throw new Error('NOWPayments no devolvió invoice_url');
    }

    return { 
      ...data, 
      payment_url: data.invoice_url 
    };
  } catch (err) {
    console.error('❌ Error creando pago NOWPayments:', err.response?.data || err.message);
    throw new Error(err.response?.data?.message || 'Error creando orden de pago');
  }
}

// Verificar estado de pago
async function verificarPago(payment_id) {
  try {
    const response = await nowpaymentsClient.get(`/payment/${payment_id}`);
    return response.data;
  } catch (err) {
    console.error('❌ Error verificando pago:', err.response?.data || err.message);
    throw err;
  }
}

// Obtener mínimo de pago para una moneda
async function obtenerMinimoPago(currency) {
  try {
    const response = await nowpaymentsClient.get(`/min-amount?currency_from=${currency}&currency_to=usdttrc20`);
    return response.data;
  } catch (err) {
    console.error('❌ Error obteniendo mínimo:', err.response?.data || err.message);
    throw err;
  }
}

// ============================================
// Verificar firma de webhook (IPN) — CORREGIDO
// ============================================
// NOWPayments envía el payload como JSON string raw
// El HMAC se calcula sobre el body raw, NO sobre JSON.stringify()
// 
// IMPORTANTE: Este middleware requiere rawBody.js configurado
// en server.js ANTES de express.json()
// ============================================

function verificarFirmaIPN(rawBody, signature, ipnSecret) {
  if (!signature || !ipnSecret || !rawBody) {
    console.error('❌ Faltan parámetros para verificar firma');
    return false;
  }

  try {
    // NOWPayments usa HMAC-SHA512 sobre el body raw (string)
    const hmac = crypto.createHmac('sha512', ipnSecret);
    hmac.update(rawBody);
    const expectedSignature = hmac.digest('hex');

    // Comparación segura contra timing attacks
    const sigBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (sigBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  } catch (err) {
    console.error('❌ Error verificando firma:', err.message);
    return false;
  }
}

module.exports = {
  crearPago,
  verificarPago,
  obtenerMinimoPago,
  verificarFirmaIPN
};
