const axios = require('axios');

const API_URL = process.env.NOWPAYMENTS_API_URL || 'https://api.nowpayments.io/v1';
const API_KEY = process.env.NOWPAYMENTS_API_KEY;

const nowpaymentsClient = axios.create({
  baseURL: API_URL,
  headers: {
    'x-api-key': API_KEY,
    'Content-Type': 'application/json'
  }
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
    // Normalizar: devolver invoice_url como payment_url para compatibilidad
    const data = response.data;
    return { ...data, payment_url: data.invoice_url };
  } catch (err) {
    console.error('Error creando pago NOWPayments:', err.response?.data || err.message);
    throw err;
  }
}

// Verificar estado de pago
async function verificarPago(payment_id) {
  try {
    const response = await nowpaymentsClient.get(`/payment/${payment_id}`);
    return response.data;
  } catch (err) {
    console.error('Error verificando pago:', err.response?.data || err.message);
    throw err;
  }
}

// Obtener mínimo de pago para una moneda
async function obtenerMinimoPago(currency) {
  try {
    const response = await nowpaymentsClient.get(`/min-amount?currency_from=${currency}&currency_to=usdttrc20`);
    return response.data;
  } catch (err) {
    console.error('Error obteniendo mínimo:', err.response?.data || err.message);
    throw err;
  }
}

// Verificar firma de webhook (IPN)
function verificarFirmaIPN(payload, signature, ipnSecret) {
  const crypto = require('crypto');

  // NOWPayments usa HMAC-SHA512
  const hmac = crypto.createHmac('sha512', ipnSecret);
  hmac.update(JSON.stringify(payload));
  const expectedSignature = hmac.digest('hex');

  return signature === expectedSignature;
}

module.exports = {
  crearPago,
  verificarPago,
  obtenerMinimoPago,
  verificarFirmaIPN
};