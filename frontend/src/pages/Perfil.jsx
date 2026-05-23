import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import api from '../services/api';
import { Crown, Check, Clock, Loader, CreditCard } from 'lucide-react';

export default function Perfil() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (user) {
      api.get('/auth/stats')
        .then(res => setStats(res.data))
        .catch(() => {});
    }
  }, [user]);

  const esPremium = user?.tier === 'premium';
  const expira = user?.subscription_expires_at 
    ? new Date(user.subscription_expires_at).toLocaleDateString('es-MX')
    : null;

  const handleSuscribir = async (plan) => {
    setLoading(true);
    setError('');

    try {
      const res = await api.post('/pagos/crear', { plan });

      // Redirigir a NOWPayments checkout
      if (res.data.payment_url) {
        window.location.href = res.data.payment_url;
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Error procesando pago');
    } finally {
      setLoading(false);
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
            <Clock className="w-4 h-4" /> Suscripción activa hasta: {expira}
          </p>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-2 rounded mb-4">
          {error}
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
                <span className="text-2xl font-bold">$4.99</span>
                <span className="text-sm text-gray-400"> USD/mes</span>
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
              {loading ? 'Procesando...' : 'Suscribirme mensual'}
            </button>
            <p className="text-xs text-gray-500 text-center mt-2">
              Pago seguro vía NOWPayments. Puedes cancelar en cualquier momento.
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
                <span className="text-2xl font-bold">$49.99</span>
                <span className="text-sm text-gray-400"> USD/año</span>
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
              {loading ? 'Procesando...' : 'Suscribirme anual'}
            </button>
          </div>
        </div>
      )}

      {/* Estadísticas para todos los usuarios */}
      {stats && (
        <div className="bg-gray-800 rounded-lg p-6">
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