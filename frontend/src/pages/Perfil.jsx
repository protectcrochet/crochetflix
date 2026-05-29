import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../services/api';
import { Crown, Check, Clock, Loader, CreditCard, Settings, CheckCircle, XCircle } from 'lucide-react';
import { PRECIOS, detectarMoneda } from '../utils/geoMoneda';

export default function Perfil() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [moneda, setMoneda] = useState('USD');
  const [loading, setLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [error, setError] = useState('');
  const [stats, setStats] = useState(null);

  const pagoParam = searchParams.get('pago');

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/login?redirect=/perfil', { replace: true });
    }
  }, [user, authLoading]);

  useEffect(() => {
    if (user) {
      api.get('/auth/stats').then(res => setStats(res.data)).catch(() => {});
    }
  }, [user]);

  useEffect(() => {
    detectarMoneda().then(setMoneda);
  }, []);

  const esPremium = user?.tier === 'premium';
  const expira = user?.subscription_expires_at
    ? new Date(user.subscription_expires_at).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  const handleSuscribir = async (plan) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/stripe/checkout', { plan });
      if (res.data.checkout_url) {
        window.location.href = res.data.checkout_url;
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Error procesando pago. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const handlePortal = async () => {
    setPortalLoading(true);
    setError('');
    try {
      const res = await api.post('/stripe/portal');
      if (res.data.portal_url) {
        window.location.href = res.data.portal_url;
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Error abriendo el portal de gestión.');
    } finally {
      setPortalLoading(false);
    }
  };

  if (authLoading) return (
    <div className="flex justify-center items-center min-h-screen">
      <Loader className="w-8 h-8 animate-spin text-crochet-primary" />
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-6">Perfil</h1>

      {/* Banner resultado de pago */}
      {pagoParam === 'exitoso' && (
        <div className="flex items-start gap-3 bg-green-900/40 border border-green-600 rounded-xl p-4 mb-6">
          <CheckCircle className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-green-300">¡Pago procesado con éxito!</p>
            <p className="text-sm text-green-400 mt-0.5">
              Tu suscripción Premium está activa. Si el badge no aparece aún, espera unos segundos y recarga la página.
            </p>
          </div>
        </div>
      )}
      {pagoParam === 'cancelado' && (
        <div className="flex items-start gap-3 bg-gray-800 border border-gray-600 rounded-xl p-4 mb-6">
          <XCircle className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
          <p className="text-sm text-gray-300">Pago cancelado. Puedes intentarlo de nuevo cuando quieras.</p>
        </div>
      )}

      {/* Info usuario */}
      <div className="bg-gray-800 rounded-xl p-6 mb-6">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-16 h-16 bg-crochet-primary rounded-full flex items-center justify-center text-2xl font-bold shrink-0">
            {user?.email?.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate">{user?.email}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
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

        {esPremium && (
          <div className="space-y-3">
            {expira && (
              <p className="text-sm text-gray-400 flex items-center gap-1.5">
                <Clock className="w-4 h-4 shrink-0" />
                Próxima renovación: <strong className="text-white">{expira}</strong>
              </p>
            )}
            <button
              onClick={handlePortal}
              disabled={portalLoading}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition disabled:opacity-50"
            >
              {portalLoading ? <Loader className="w-4 h-4 animate-spin" /> : <Settings className="w-4 h-4" />}
              {portalLoading ? 'Cargando…' : 'Gestionar suscripción'}
            </button>
            <p className="text-xs text-gray-500">
              Desde el portal puedes cambiar tu método de pago o cancelar tu suscripción.
            </p>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-900/40 border border-red-500 text-red-200 px-4 py-3 rounded-lg mb-4 text-sm">
          {error}
        </div>
      )}

      {/* Planes (solo si no es premium) */}
      {!esPremium && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold">Elige tu plan</h2>

          {/* Plan Gratis */}
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Gratis</h3>
              <span className="text-2xl font-bold">$0</span>
            </div>
            <ul className="space-y-2 text-sm text-gray-400 mb-4">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-400 shrink-0" /> 1 patrón gratuito al mes
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-400 shrink-0" /> Vista previa de patrones
              </li>
            </ul>
            <button className="w-full btn-secondary" disabled>Plan actual</button>
          </div>

          {/* Plan Mensual */}
          <div className="bg-gradient-to-r from-crochet-primary/20 to-purple-900/20 rounded-xl p-6 border border-crochet-primary">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-semibold">Premium Mensual</h3>
              <div className="text-right">
                <span className="text-2xl font-bold">{PRECIOS[moneda]?.mensual}</span>
                <span className="text-sm text-gray-400"> {moneda}/mes</span>
              </div>
            </div>
            <p className="text-xs text-crochet-primary mb-4">Flexibilidad total · cancela cuando quieras</p>
            <ul className="space-y-2 text-sm text-gray-300 mb-5">
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-crochet-primary shrink-0" /> Acceso ilimitado a todos los patrones</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-crochet-primary shrink-0" /> Descarga hasta 5 patrones offline</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-crochet-primary shrink-0" /> Nuevos patrones semanales</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-crochet-primary shrink-0" /> Guarda progreso y favoritos</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-crochet-primary shrink-0" /> Sin anuncios</li>
            </ul>
            <button
              onClick={() => handleSuscribir('mensual')}
              disabled={loading}
              className="w-full btn-primary py-3 flex items-center justify-center gap-2"
            >
              {loading ? <Loader className="w-5 h-5 animate-spin" /> : <CreditCard className="w-5 h-5" />}
              {loading ? 'Redirigiendo a pago…' : 'Suscribirme mensual'}
            </button>
            <p className="text-xs text-gray-500 text-center mt-2">
              Pago seguro con tarjeta vía Stripe. Se renueva automáticamente cada mes.
            </p>
          </div>

          {/* Plan Anual */}
          <div className="bg-gradient-to-r from-purple-900/20 to-crochet-primary/20 rounded-xl p-6 border border-purple-500">
            <div className="flex items-center justify-between mb-1">
              <div>
                <h3 className="text-lg font-semibold">Premium Anual</h3>
              </div>
              <div className="text-right">
                <span className="text-2xl font-bold">{PRECIOS[moneda]?.anual}</span>
                <span className="text-sm text-gray-400"> {moneda}/año</span>
              </div>
            </div>
            <p className="text-xs text-purple-400 mb-4">Ahorra ~2 meses vs. mensual</p>
            <ul className="space-y-2 text-sm text-gray-300 mb-5">
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-purple-400 shrink-0" /> Todo lo del plan mensual</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-purple-400 shrink-0" /><strong>2 meses gratis</strong> vs. mensual</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-purple-400 shrink-0" /> Badge "Anual" exclusivo</li>
            </ul>
            <button
              onClick={() => handleSuscribir('anual')}
              disabled={loading}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 transition disabled:opacity-50"
            >
              {loading ? <Loader className="w-5 h-5 animate-spin" /> : <CreditCard className="w-5 h-5" />}
              {loading ? 'Redirigiendo a pago…' : 'Suscribirme anual'}
            </button>
            <p className="text-xs text-gray-500 text-center mt-2">
              Pago seguro con tarjeta vía Stripe. Se renueva automáticamente cada año.
            </p>
          </div>
          <p className="text-xs text-gray-600 text-center">
            Precios aproximados en {moneda}. El monto exacto se confirma en la página de pago de Stripe.
          </p>
        </div>
      )}

      {/* Estadísticas */}
      {stats && (
        <div className="bg-gray-800 rounded-xl p-6 mt-6">
          <h2 className="text-lg font-semibold mb-4">Tu actividad</h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-crochet-primary">{stats.vistos}</p>
              <p className="text-xs text-gray-400">Patrones vistos</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-crochet-primary">{stats.completados}</p>
              <p className="text-xs text-gray-400">Completados</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-crochet-primary">{stats.enLista}</p>
              <p className="text-xs text-gray-400">En mi lista</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
