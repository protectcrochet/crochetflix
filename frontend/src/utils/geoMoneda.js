export const PRECIOS = {
  MXN: { mensual: '$100',      anual: '$999',        label: 'MXN' },
  ARS: { mensual: '$8,130',    anual: '$81,209',     label: 'ARS' },
  BRL: { mensual: 'R$29.21',   anual: 'R$291.99',    label: 'BRL' },
  BYN: { mensual: 'Br15.91',   anual: 'Br158.99',    label: 'BYN' },
  CAD: { mensual: 'CA$7.97',   anual: 'CA$79.62',    label: 'CAD' },
  CLP: { mensual: '$5,149',    anual: '$51,424',     label: 'CLP' },
  COP: { mensual: '$20,908',   anual: '$208,731',    label: 'COP' },
  CRC: { mensual: '₡2,610',    anual: '₡26,071',     label: 'CRC' },
  DOP: { mensual: 'RD$341',    anual: 'RD$3,401',    label: 'DOP' },
  EUR: { mensual: '€4.95',     anual: '€49.48',      label: 'EUR' },
  GBP: { mensual: '£4.29',     anual: '£42.87',      label: 'GBP' },
  GTQ: { mensual: 'Q43.90',    anual: 'Q438.52',     label: 'GTQ' },
  PEN: { mensual: 'S/19.65',   anual: 'S/196.99',    label: 'PEN' },
  RUB: { mensual: '₽408',      anual: '₽4,076',      label: 'RUB' },
  USD: { mensual: 'US$5.99',   anual: 'US$57.50',    label: 'USD' },
};

const PAIS_MONEDA = {
  MX:'MXN', AR:'ARS', BR:'BRL', BY:'BYN', CA:'CAD', CL:'CLP', CO:'COP',
  CR:'CRC', DO:'DOP', GT:'GTQ', PE:'PEN', RU:'RUB', US:'USD', GB:'GBP',
  DE:'EUR', FR:'EUR', ES:'EUR', IT:'EUR', PT:'EUR', NL:'EUR', AT:'EUR',
  BE:'EUR', FI:'EUR', GR:'EUR', IE:'EUR', LU:'EUR', SK:'EUR', SI:'EUR',
  EE:'EUR', LV:'EUR', LT:'EUR', MT:'EUR', CY:'EUR',
};

export async function detectarMoneda() {
  const cached = sessionStorage.getItem('cf_moneda');
  if (cached) return cached;
  try {
    const res = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    const moneda = PAIS_MONEDA[data.country_code] || 'USD';
    sessionStorage.setItem('cf_moneda', moneda);
    return moneda;
  } catch {
    return 'USD';
  }
}
