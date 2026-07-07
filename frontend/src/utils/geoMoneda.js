import api from '../services/api';

export const PRECIOS = {
  USD: { mensual: '$5.99',    anual: '$59.99' },
  MXN: { mensual: '$100',     anual: '$999' },
  ARS: { mensual: '$8,130',   anual: '$81,300' },
  BRL: { mensual: 'R$29.21',  anual: 'R$292' },
  CAD: { mensual: 'CA$7.97',  anual: 'CA$79.70' },
  CLP: { mensual: '$5,149',   anual: '$51,490' },
  COP: { mensual: '$20,908',  anual: '$209,080' },
  EUR: { mensual: '€4.95',    anual: '€49.50' },
  GBP: { mensual: '£4.29',    anual: '£42.90' },
  GTQ: { mensual: 'Q43.90',   anual: 'Q439' },
  PEN: { mensual: 'S/19.65',  anual: 'S/196.50' },
  DOP: { mensual: 'RD$340',   anual: 'RD$3,400' },
  CRC: { mensual: '₡2,610',  anual: '₡26,100' },
};

export async function detectarMoneda() {
  try {
    const res = await api.get('/pagos/precio-local');
    return res.data?.moneda || 'USD';
  } catch {
    return 'USD';
  }
}
