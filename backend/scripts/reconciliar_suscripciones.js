// Compara las suscripciones de Stripe con el acceso guardado en la base.
//
//   node scripts/reconciliar_suscripciones.js            solo informe, no cambia nada
//   node scripts/reconciliar_suscripciones.js --aplicar  además devuelve el acceso premium a
//                                                        quien Stripe sigue cobrando
//
// Nunca cancela ni reembolsa nada en Stripe: las duplicadas se resuelven a mano en el panel.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../src/models');
const { suscripcionesVivas, sincronizarAcceso, finPeriodo } = require('../src/controllers/pagoController');

const aplicar = process.argv.includes('--aplicar');
const fecha = d => (d ? d.toISOString().slice(0, 10) : '?');

function describir(sub) {
  const rec = sub.items?.data?.[0]?.price?.recurring;
  const cada = rec ? `cada ${rec.interval_count || 1} ${rec.interval}` : 'intervalo ?';
  return `${sub.id}  ${sub.status}  ${cada}  próximo cobro ${fecha(finPeriodo(sub))}`;
}

async function main() {
  await new Promise(r => setTimeout(r, 1000));
  const users = await new Promise((resolve, reject) => {
    db.all(
      `SELECT id, email, tier, subscription_expires_at, stripe_customer_id, stripe_subscription_id
       FROM users WHERE stripe_customer_id IS NOT NULL OR stripe_subscription_id IS NOT NULL`,
      [], (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
  console.log(`Revisando ${users.length} usuarias con historial en Stripe...\n`);

  let duplicadas = 0, desfasadas = 0, errores = 0;
  for (const u of users) {
    let vivas;
    try {
      vivas = await suscripcionesVivas(stripe, u);
    } catch (e) {
      errores++;
      console.log(`ERROR ${u.email}: ${e.message}`);
      continue;
    }

    if (vivas.length > 1) {
      duplicadas++;
      console.log(`DUPLICADA ${u.email} tiene ${vivas.length} suscripciones cobrando:`);
      vivas.forEach(s => console.log(`    ${describir(s)}`));
    }

    const alCorriente = vivas.find(s => ['active', 'trialing'].includes(s.status));
    if (!alCorriente) continue;
    const fin = finPeriodo(alCorriente);
    const expira = u.subscription_expires_at ? new Date(u.subscription_expires_at) : null;
    if (u.tier !== 'premium' || !expira || (fin && expira < fin)) {
      desfasadas++;
      console.log(`DESFASE ${u.email}: paga en Stripe hasta ${fecha(fin)} pero aquí está como ${u.tier}, vence ${fecha(expira)}`);
      if (aplicar) {
        const nueva = await sincronizarAcceso(u.id, u.subscription_expires_at, alCorriente);
        console.log(`    corregido: premium hasta ${fecha(nueva)}`);
      }
    }
  }

  console.log(`\nResumen: ${duplicadas} con suscripción duplicada, ${desfasadas} con acceso desfasado, ${errores} errores.`);
  if (desfasadas && !aplicar) console.log('Para corregir los desfases: node scripts/reconciliar_suscripciones.js --aplicar');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
