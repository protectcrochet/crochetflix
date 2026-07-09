import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import api from '../services/api';
import { Crown, Check, Clock, Loader, CreditCard, Tag, Calendar, Star, History } from 'lucide-react';

export default function Perfil() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [suscInfo, setSuscInfo] = useState(null);

  const esPremium = user?.tier === 'premium';
  const tieneDescuento = user?.new_account_discount === 1;
  const expira = user?.subscription_expires_at 
    ? new Date(user.subscription_expires_at).toLocaleDateString('es-MX')
    : null;

  // Precios con descuento del 25%
  const precios = {
    mensual: { original: 5.99, descuento: 4.49 },
    anual:   { original: 59.99, descuento: 44.99 }
  };

  useEffect(() => {
    if (!esPremium) return;
    api.get('/auth/mi-suscripcion')
      .then(res => setSuscInfo(res.data))
      .catch(() => {});
  }, [esPremium]);

  const handleSuscribir = async (plan) => {
    setLoading(true);
    setError('');

    try {
      const res = await api.post('/pagos/crear', { plan });

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

      {/* Banner descuento cuenta nueva */}
      {tieneDescuento && !esPremium && (
        <div className="bg-gradient-to-r from-crochet-primary/30 to-purple-900/30 border border-crochet-primary rounded-lg p-4 mb-6 flex items-center gap-3">
          <Tag className="w-5 h-5 text-crochet-primary flex-shrink-0" />
          <div>
            <p className="font-bold text-crochet-primary">¡25% de descuento por ser cuenta nueva!</p>
            <p className="text-sm text-gray-300">Este descuento se aplica automáticamente en tu primera suscripción.</p>
          </div>
        </div>
      )}

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
      </div>

      {/* Detalles de suscripción (solo premium) */}
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
                  ? new Date(suscInfo.primerPago).toLocaleDateString('es-MX')
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
                      {new Date(p.fecha).toLocaleDateString('es-MX')}
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
                {tieneDescuento && (
                  <div className="text-sm text-gray-400 line-through">${precios.mensual.original} USD</div>
                )}
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold">
                    ${tieneDescuento ? precios.mensual.descuento : precios.mensual.original}
                  </span>
                  <span className="text-sm text-gray-400">USD/mes</span>
                </div>
                {tieneDescuento && (
                  <span className="inline-block bg-green-600 text-white text-xs font-bold px-2 py-0.5 rounded mt-1">
                    25% OFF
                  </span>
                )}
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
              {loading ? 'Procesando...' : tieneDescuento ? 'Suscribirme — $4.49 USD/mes' : 'Suscribirme mensual'}
            </button>
            <p className="text-xs text-gray-500 text-center mt-2">
              Pago seguro vía Stripe. Cancela en cualquier momento.
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
                {tieneDescuento && (
                  <div className="text-sm text-gray-400 line-through">${precios.anual.original} USD</div>
                )}
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold">
                    ${tieneDescuento ? precios.anual.descuento : precios.anual.original}
                  </span>
                  <span className="text-sm text-gray-400">USD/año</span>
                </div>
                {tieneDescuento && (
                  <span className="inline-block bg-green-600 text-white text-xs font-bold px-2 py-0.5 rounded mt-1">
                    25% OFF
                  </span>
                )}
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
              {loading ? 'Procesando...' : tieneDescuento ? 'Suscribirme — $44.99 USD/año' : 'Suscribirme anual'}
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
