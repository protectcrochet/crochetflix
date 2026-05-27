import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import api from '../services/api';
import Carrusel from '../components/Carrusel';
import PatronCard from '../components/PatronCard';
import { Play, Crown, Search, X } from 'lucide-react';
import { Link } from 'react-router-dom';

function HeroBanners({ patrones }) {
  const items = patrones.slice(0, 3);
  if (items.length === 0) return null;

  return (
    <section className="px-4 py-4 space-y-3">
      {items.map((p) => (
        <Link
          key={p.id}
          to={`/patron/${p.id}`}
          className="flex gap-0 bg-gray-800/50 hover:bg-gray-800 rounded-xl overflow-hidden transition-colors group"
        >
          {/* Texto */}
          <div className="flex-1 p-4 flex flex-col justify-between min-w-0">
            <div>
              <div className="flex items-center gap-2 mb-2">
                {p.es_preview === 1 && (
                  <span className="bg-green-600 text-xs font-bold px-2 py-0.5 rounded">GRATIS</span>
                )}
                {p.destacado === 1 && (
                  <span className="bg-crochet-primary/80 text-xs px-2 py-0.5 rounded">DESTACADO</span>
                )}
              </div>
              <h2 className="font-bold text-base sm:text-lg leading-tight line-clamp-2 mb-1">{p.titulo}</h2>
              <p className="text-gray-400 text-xs mb-1">por {p.diseñadora || p.autor}</p>
              <p className="text-gray-500 text-xs line-clamp-2 hidden sm:block">{p.descripcion}</p>
            </div>
            <div className="flex items-center gap-3 mt-3">
              <span className="text-crochet-primary text-sm font-semibold flex items-center gap-1.5 group-hover:gap-2.5 transition-all duration-200">
                <Play className="w-3.5 h-3.5 fill-current" /> Ver patrón
              </span>
              {p.paginas > 0 && (
                <span className="text-gray-600 text-xs">{p.paginas} págs.</span>
              )}
            </div>
          </div>
          {/* Imagen */}
          <div className="w-28 sm:w-36 flex-shrink-0 relative overflow-hidden">
            <img
              src={p.thumbnail_path || ''}
              alt={p.titulo}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              onError={e => { e.currentTarget.style.display = 'none'; }}
            />
            <div className="absolute inset-0 bg-gradient-to-r from-gray-800/40 to-transparent pointer-events-none" />
          </div>
        </Link>
      ))}
    </section>
  );
}

export default function Home() {
  const { user } = useAuth();
  const [patrones, setPatrones] = useState([]);
  const [totalPatrones, setTotalPatrones] = useState(0);
  const [heroPatrones, setHeroPatrones] = useState([]);
  const [patronesTendencia, setPatronesTendencia] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState(null);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    cargarPatrones();
  }, []);

  const cargarPatrones = async () => {
    try {
      const [resAll, resDestacados, resTendencia] = await Promise.all([
        api.get('/patrones'),
        api.get('/patrones', { params: { destacado: '1', limit: 10 } }),
        api.get('/patrones', { params: { tendencia: '1', limit: 16 } }),
      ]);
      const data = resAll.data.patrones || [];
      const dest = resDestacados.data.patrones || [];
      const trend = resTendencia.data.patrones || [];
      setPatrones(data);
      setTotalPatrones(resAll.data.total || data.length);
      setHeroPatrones(dest.length > 0 ? dest : data.slice(0, 3));
      setPatronesTendencia(trend.length > 0 ? trend : [...data].sort(() => Math.random() - 0.5).slice(0, 10));
    } catch (err) {
      console.error('Error cargando patrones:', err);
    } finally {
      setLoading(false);
    }
  };

  const buscar = useCallback(async (termino) => {
    if (!termino.trim()) { setResultados(null); return; }
    setBuscando(true);
    try {
      const res = await api.get('/patrones', { params: { search: termino.trim() } });
      setResultados(res.data.patrones || []);
    } catch (err) {
      console.error('Error buscando:', err);
    } finally {
      setBuscando(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => buscar(busqueda), 400);
    return () => clearTimeout(timer);
  }, [busqueda, buscar]);

  const patronesNuevos = patrones.filter(p => p.es_preview === 0).slice(0, 10);
  const patronesPreview = patrones.filter(p => p.es_preview === 1);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-crochet-primary" />
      </div>
    );
  }

  return (
    <div>
      {/* Barra de búsqueda */}
      <div className="px-4 pt-4">
        <div className="relative max-w-xl mx-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar patrones, autores..."
            className="w-full bg-gray-800 border border-gray-700 rounded-full px-10 py-2 text-sm focus:outline-none focus:border-crochet-primary"
          />
          {busqueda && (
            <button onClick={() => { setBusqueda(''); setResultados(null); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Resultados de búsqueda */}
      {(busqueda || resultados) && (
        <div className="px-4 py-4">
          {buscando ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-crochet-primary" />
            </div>
          ) : resultados !== null ? (
            <>
              <p className="text-sm text-gray-400 mb-3">
                {resultados.length} {resultados.length === 1 ? 'resultado' : 'resultados'} para "{busqueda}"
              </p>
              {resultados.length === 0 ? (
                <p className="text-center text-gray-500 py-8">No encontramos patrones con ese término.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {resultados.map(p => <PatronCard key={p.id} patron={p} />)}
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* Contenido principal */}
      {!busqueda && (
        <>
          {heroPatrones.length > 0 && <HeroBanners patrones={heroPatrones} />}

          {patronesPreview.length > 0 && (
            <div className="px-4 py-2">
              <div className="bg-gradient-to-r from-green-900/50 to-green-800/30 rounded-lg p-4 flex items-center gap-3">
                <Crown className="w-6 h-6 text-green-400" />
                <div>
                  <p className="font-semibold text-green-400">Patrón gratuito del mes</p>
                  <p className="text-sm text-gray-400">1 patrón completo gratis cada mes. No necesitas suscripción.</p>
                </div>
              </div>
            </div>
          )}

          <Carrusel titulo="🔥 Tendencia" patrones={patronesTendencia} loop autoScroll />
          <Carrusel titulo="🆕 Nuevos patrones" patrones={patronesNuevos} />
          <Carrusel titulo="🎁 Gratis este mes" patrones={patronesPreview} />

          {(!user || user.tier === 'free') && (
            <section className="px-4 py-8">
              <div className="max-w-2xl mx-auto text-center bg-gradient-to-r from-crochet-primary/20 to-purple-900/20 rounded-2xl p-8">
                <h2 className="text-2xl font-bold mb-2">Desbloquea todo el catálogo</h2>
                <p className="text-gray-400 mb-4">Más de {totalPatrones.toLocaleString()} patrones profesionales por solo $100 MXN/mes</p>
                <ul className="text-left text-sm text-gray-300 mb-6 space-y-2 max-w-md mx-auto">
                  <li>✓ Acceso ilimitado a todos los patrones</li>
                  <li>✓ Descarga hasta 5 patrones para ver offline</li>
                  <li>✓ Nuevos patrones cada semana</li>
                  <li>✓ Guarda tu progreso y favoritos</li>
                </ul>
                <Link to="/perfil" className="btn-primary text-lg px-8">Suscribirme ahora</Link>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
