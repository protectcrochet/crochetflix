import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { Crown, Check, Clock, Loader, CreditCard, Calendar, Star, History } from 'lucide-react';
import { pixelPurchase, pixelInitCheckout, pixelStartTrial } from '../lib/pixel';

const PRECIOS_GEO = {
  MX: { moneda: 'MXN', simbolo: '$', mensual: 100,   anual: 1000,  locale: 'es-MX' },
  US: { moneda: 'USD', simbolo: '$', mensual: 5.99,  anual: 59.99, locale: 'en-US' },
  CA: { moneda: 'CAD', simbolo: '$', mensual: 7.99,  anual: 79.99, locale: 'en-CA' },
  CO: { moneda: 'COP', simbolo: '$', mensual: 25000, anual: 250000,locale: 'es-CO' },
  AR: { moneda: 'ARS', simbolo: '$', mensual: 5000,  anual: 50000, locale: 'es-AR' },
  PE: { moneda: 'PEN', simbolo: 'S/', mensual: 22,   anual: 220,   locale: 'es-PE' },
  CL: { moneda: 'CLP', simbolo: '$', mensual: 5500,  anual: 55000, locale: 'es-CL' },
  ES: { moneda: 'EUR', simbolo: '€', mensual: 5.49,  anual: 54.99, locale: 'es-ES' },
  DEFAULT: { moneda: 'USD', simbolo: '$', mensual: 5.99, anual: 59.99, locale: 'en-US' },
};

function formatPrecio(monto, geo) {
  return new Intl.NumberFormat(geo.locale, {
    style: 'currency', currency: geo.moneda, maximumFractionDigits: monto >= 100 ? 0 : 2
  }).format(monto);
}

export default function Perfil() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [portalUrl, setPortalUrl] = useState('');
  const [suscInfo, setSuscInfo] = useState(null);
  const [geo, setGeo] = useState(PRECIOS_GEO.DEFAULT);
  const [afil, setAfil] = useState(null);
  const [canjeando, setCanjeando] = useState(false);
  const [canjeMsg, setCanjeMsg] = useState('');
  const conTrial = typeof window !== 'undefined' && localStorage.getItem('cf_trial') === '3';

  const esPremium = user?.tier === 'premium';
  const expira = user?.subscription_expires_at
    ? new Date(user.subscription_expires_at).toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' })
    : null;

  useEffect(() => {
    if (searchParams.get('pago') === 'exitoso') {
      // Con prueba de 3 días aún no hay cobro → StartTrial. Sin prueba → Purchase.
      if (localStorage.getItem('cf_trial') === '3') {
        pixelStartTrial(geo.mensual, geo.moneda);
      } else {
        pixelPurchase(geo.mensual, geo.moneda);
      }
      localStorage.removeItem('cf_trial');
    }
  }, []);

  useEffect(() => {
    api.get('/pagos/precio-local')
      .then(res => {
        const { monto, moneda } = res.data;
        const geoEntry = Object.values(PRECIOS_GEO).find(g => g.moneda === moneda);
        if (geoEntry) setGeo({ ...geoEntry, mensual: monto });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!esPremium) return;
    api.get('/auth/mi-suscripcion')
      .then(res => setSuscInfo(res.data))
      .catch(() => {});
  }, [esPremium]);

  const handlePortal = async () => {
    try {
      const res = await api.post('/pagos/portal');
      if (res.data.url) window.location.href = res.data.url;
    } catch {
      // Silencioso: no queremos llamar la atención sobre la gestión de la suscripción
    }
  };

  const handleSuscribir = async (plan) => {
    pixelInitCheckout();
    setLoading(true);
    setError('');
    setPortalUrl('');

    try {
      const trial = localStorage.getItem('cf_trial') === '3' ? 3 : undefined;
      const res = await api.post('/pagos/crear', { plan, trial });

      const redirectUrl = res.data.payment_url || res.data.checkout_url;
      if (redirectUrl) {
        window.location.href = redirectUrl;
      } else {
        setError('No se recibió URL de pago. Intenta de nuevo.');
      }
    } catch (err) {
      const data = err.response?.data;
      setError(data?.error || 'Error procesando pago');
      if (data?.portal_url) setPortalUrl(data.portal_url);
      // Ya estaba suscrita: el backend reactivó su acceso, se recarga para mostrarlo
      if (data?.ya_activa) setTimeout(() => window.location.reload(), 3000);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    api.get('/auth/referidos').then(r => setAfil(r.data)).catch(() => {});
  }, []);

  const canjearMisPremium = async () => {
    setCanjeando(true); setCanjeMsg('');
    try {
      const res = await api.post('/auth/canjear-premium');
      setCanjeMsg('¡Listo! Canjeaste ' + res.data.meses + ' mes(es) Premium.');
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      setCanjeMsg(e.response?.data?.error || 'No se pudo canjear.');
      setCanjeando(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-6">Perfil</h1>


      {/* Info usuario */}
      <div className="bg-gray-800 rounded-lg p-6 mb-6">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-16 h-16 bg-crochet-primary rounded-full flex items-center justify-center text-2xl font-bold">
            {user?.email?.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-semibold">{user?.email}</p>
            <div className="flex items-center gap-2 mt-1">
              {esPremium ? (
                <span className="bg-crochet-primary text-xs px-2 py-1 rounded flex items-center gap-1">
                  <Crown className="w-3 h-3" /> Premium
                </span>
              ) : (
                <span className="bg-gray-600 text-xs px-2 py-1 rounded">Gratis</span>
              )}
            </div>
          </div>
        </div>

        {esPremium && expira && (
          <p className="text-sm text-gray-400 flex items-center gap-1">
            <Clock className="w-4 h-4" /> Próxima renovación: <strong className="text-white ml-1">{expira}</strong>
          </p>
        )}
        {esPremium && (
          <button
            onClick={handlePortal}
            className="text-xs text-gray-600 hover:text-gray-400 underline mt-3 transition"
          >
            Gestionar suscripción
          </button>
        )}
      </div>

      {/* Detalles de suscripción (solo premium) */}
      {afil && (
        <div className="bg-gray-800 rounded-lg p-6 mb-6 border border-yellow-500/30">
          <h2 className="text-lg font-semibold mb-1">🎁 Gana compartiendo</h2>
          <p className="text-sm text-gray-400 mb-4">Comparte CrochetFlix. Cada amiga que se suscribe con tu link te da comisión.</p>
          <div className="flex items-center justify-between bg-gray-700/50 rounded-lg p-3 mb-3">
            <div>
              <p className="text-xs text-gray-400">Tu nivel</p>
              <p className="font-bold text-yellow-400">{afil.nivel === 3 ? '🥇 Socia' : afil.nivel === 2 ? '🥈 Embajadora' : '🥉 Tejedora'}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400">Referidas que pagaron</p>
              <p className="font-bold text-white">{afil.referidas_pagadas}</p>
            </div>
          </div>
          <div className="bg-gray-700/50 rounded-lg p-3 mb-3">
            <p className="text-xs text-gray-400">Saldo acumulado</p>
            <p className="text-2xl font-bold text-white">${afil.saldo} <span className="text-sm text-gray-400 font-normal">MXN</span></p>
          </div>
          {afil.meses_canjeables >= 1 ? (
            <button onClick={canjearMisPremium} disabled={canjeando}
              className="w-full py-3 bg-crochet-primary hover:opacity-90 text-white font-semibold rounded-lg mb-2 disabled:opacity-60">
              {canjeando ? 'Canjeando…' : ('Canjear ' + afil.meses_canjeables + ' mes(es) Premium (-$' + (afil.meses_canjeables*90) + ')')}
            </button>
          ) : (
            <p className="text-xs text-gray-500 mb-2 text-center">Junta $90 para canjear tu primer mes Premium.</p>
          )}
          {canjeMsg && <p className="text-xs text-center text-yellow-300 mb-2">{canjeMsg}</p>}
          <div className="text-xs text-center text-gray-400 mb-4">
            {afil.efectivo_desbloqueado
              ? <span>💵 Efectivo desbloqueado (mínimo $210 para cobrar)</span>
              : <span>🔒 Efectivo se desbloquea en Nivel 2 (4 referidas que paguen)</span>}
          </div>
          <p className="text-xs text-gray-400 mb-1">Tu link:</p>
          <div className="flex gap-2">
            <div className="flex-1 bg-gray-700 rounded px-2 py-1.5 text-xs text-gray-300 font-mono truncate">
              {window.location.origin}/register?ref={afil.codigo}
            </div>
            <button onClick={() => { navigator.clipboard.writeText(window.location.origin + "/register?ref=" + afil.codigo); setCanjeMsg("¡Link copiado!"); setTimeout(() => setCanjeMsg(""), 1500); }}
              className="px-3 py-1.5 rounded text-xs font-semibold bg-crochet-primary hover:opacity-90 text-white shrink-0">Copiar</button>
          </div>
        </div>
      )}

      {esPremium && suscInfo && (
        <div className="bg-gray-800 rounded-lg p-6 mb-6 border border-crochet-primary/30">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Crown className="w-5 h-5 text-crochet-primary" /> Mi suscripción
          </h2>

          <div className="grid grid-cols-2 gap-4 mb-5">
            <div className="bg-gray-700/50 rounded-lg p-3">
              <p className="text-xs text-gray-400 flex items-center gap-1 mb-1">
                <Calendar className="w-3 h-3" /> Suscrita desde
              </p>
              <p className="font-semibold text-white">
                {suscInfo.primerPago
                  ? new Date(suscInfo.primerPago).toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' })
                  : '—'}
              </p>
            </div>

            <div className="bg-gray-700/50 rounded-lg p-3">
              <p className="text-xs text-gray-400 flex items-center gap-1 mb-1">
                <Clock className="w-3 h-3" /> Meses activos
              </p>
              <p className="font-semibold text-white">
                {suscInfo.mesesActivos ?? '—'}
              </p>
            </div>

            <div className="bg-gray-700/50 rounded-lg p-3">
              <p className="text-xs text-gray-400 flex items-center gap-1 mb-1">
                <Star className="w-3 h-3" /> Plan
              </p>
              <p className="font-semibold text-white flex items-center gap-1">
                {suscInfo.conDescuento
                  ? <><span className="bg-green-600 text-white text-xs px-1.5 py-0.5 rounded">25% OFF</span> con descuento</>
                  : 'Precio estándar'}
              </p>
            </div>

            <div className="bg-gray-700/50 rounded-lg p-3">
              <p className="text-xs text-gray-400 flex items-center gap-1 mb-1">
                <CreditCard className="w-3 h-3" /> Total pagos
              </p>
              <p className="font-semibold text-white">
                {suscInfo.totalPagos ?? '—'}
              </p>
            </div>
          </div>

          {suscInfo.historial && suscInfo.historial.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 flex items-center gap-1 mb-2">
                <History className="w-3 h-3" /> Historial de pagos
              </p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {suscInfo.historial.map((p, i) => (
                  <div key={i} className="flex justify-between text-sm bg-gray-700/40 rounded px-3 py-1.5">
                    <span className="text-gray-300">
                      {new Date(p.fecha).toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' })}
                    </span>
                    <span className="text-green-400 font-medium">
                      ${p.monto} {p.moneda?.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-2 rounded mb-4">
          {error}
          {portalUrl && (
            <a href={portalUrl} className="block mt-2 font-semibold underline text-white">
              Actualizar mi tarjeta
            </a>
          )}
        </div>
      )}

      {/* Planes */}
      {!esPremium && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold">Elige tu plan</h2>

          {/* Plan Gratis */}
          <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Gratis</h3>
              <span className="text-2xl font-bold">$0</span>
            </div>
            <ul className="space-y-2 text-sm text-gray-400 mb-4">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-400" /> 1 patrón gratuito al mes
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-400" /> Vista previa de patrones
              </li>
            </ul>
            <button className="w-full btn-secondary" disabled>
              Plan actual
            </button>
          </div>

          {/* Plan Mensual */}
          <div className="bg-gradient-to-r from-crochet-primary/20 to-purple-900/20 rounded-lg p-6 border border-crochet-primary">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold">Premium Mensual</h3>
                <span className="text-xs text-crochet-primary">Flexibilidad total</span>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold">{formatPrecio(geo.mensual, geo)}</div>
                <div className="text-xs text-gray-400">{geo.moneda}/mes</div>
              </div>
            </div>
            <ul className="space-y-2 text-sm text-gray-300 mb-4">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-crochet-primary" /> Acceso ilimitado a todos los patrones
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-crochet-primary" /> Descarga hasta 5 patrones offline
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-crochet-primary" /> Nuevos patrones semanales
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-crochet-primary" /> Guarda progreso y favoritos
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-crochet-primary" /> Sin anuncios
              </li>
            </ul>
            <button
              onClick={() => handleSuscribir('mensual')}
              disabled={loading}
              className="w-full btn-primary py-3 flex items-center justify-center gap-2"
            >
              {loading ? <Loader className="w-5 h-5 animate-spin" /> : <CreditCard className="w-5 h-5" />}
              {loading
                ? 'Procesando...'
                : `Suscribirme — ${formatPrecio(geo.mensual, geo)}/mes`}
            </button>
            <p className="text-xs text-gray-500 text-center mt-2">
              Pago seguro vía Stripe.
            </p>
          </div>

          {/* Plan Trimestral */}
          <div className="bg-gradient-to-r from-blue-900/20 to-crochet-primary/20 rounded-lg p-6 border border-blue-500">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold">Premium Trimestral</h3>
                <span className="text-xs text-blue-400">Ahorra vs. mensual</span>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold">{formatPrecio(Math.round(geo.mensual * 2.5), geo)}</div>
                <div className="text-xs text-gray-400">{geo.moneda}/trimestre</div>
              </div>
            </div>
            <ul className="space-y-2 text-sm text-gray-300 mb-4">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-blue-400" /> Todo lo del plan mensual
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-blue-400" /> <strong>3 meses</strong> por menos
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-blue-400" /> Ideal si tienes varios proyectos
              </li>
            </ul>
            <button
              onClick={() => handleSuscribir('trimestral')}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded font-bold flex items-center justify-center gap-2 transition"
            >
              {loading ? <Loader className="w-5 h-5 animate-spin" /> : <CreditCard className="w-5 h-5" />}
              {loading ? 'Procesando...' : `Suscribirme — ${formatPrecio(Math.round(geo.mensual * 2.5), geo)}/trimestre`}
            </button>
            <p className="text-xs text-gray-500 text-center mt-2">
              Pago seguro vía Stripe.
            </p>
          </div>

          {/* Plan Anual */}
          <div className="bg-gradient-to-r from-purple-900/20 to-crochet-primary/20 rounded-lg p-6 border border-purple-500">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold">Premium Anual</h3>
                <span className="text-xs text-purple-400">Ahorra 2 meses</span>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold">{formatPrecio(geo.anual, geo)}</div>
                <div className="text-xs text-gray-400">{geo.moneda}/año</div>
              </div>
            </div>
            <ul className="space-y-2 text-sm text-gray-300 mb-4">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-purple-400" /> Todo lo del plan mensual
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-purple-400" /> <strong>2 meses gratis</strong> vs. mensual
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-purple-400" /> Badge "Anual" exclusivo
              </li>
            </ul>
            <button 
              onClick={() => handleSuscribir('anual')}
              disabled={loading}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white py-3 rounded font-bold flex items-center justify-center gap-2 transition"
            >
              {loading ? <Loader className="w-5 h-5 animate-spin" /> : <CreditCard className="w-5 h-5" />}
              {loading ? 'Procesando...' : `Suscribirme — ${formatPrecio(geo.anual, geo)}/año`}
            </button>
            <p className="text-xs text-gray-500 text-center mt-2">
              Pago seguro vía Stripe. Cancela en cualquier momento.
            </p>
          </div>
        </div>
      )}

      {/* Estadísticas (solo para premium) */}
      {esPremium && (
        <div className="bg-gray-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Tu actividad</h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-crochet-primary">12</p>
              <p className="text-xs text-gray-400">Patrones vistos</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-crochet-primary">3</p>
              <p className="text-xs text-gray-400">Completados</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-crochet-primary">5</p>
              <p className="text-xs text-gray-400">En mi lista</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
