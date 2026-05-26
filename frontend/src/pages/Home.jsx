import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import api from '../services/api';
import Carrusel from '../components/Carrusel';
import PatronCard from '../components/PatronCard';
import { Play, Info, Crown, Search, X } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Home() {
  const { user } = useAuth();
  const [patrones, setPatrones] = useState([]);
  const [destacado, setDestacado] = useState(null);
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
        api.get('/patrones', { params: { destacado: '1', limit: 5 } }),
        api.get('/patrones', { params: { tendencia: '1', limit: 20 } }),
      ]);
      const data = resAll.data.patrones || [];
      const dest = resDestacados.data.patrones || [];
      const trend = resTendencia.data.patrones || [];
      setPatrones(data);
      setDestacado(dest[0] || data[0] || null);
      setPatronesTendencia(trend.length > 0 ? trend : [...data].sort(() => Math.random() - 0.5).slice(0, 10));
    } catch (err) {
      console.error('Error cargando patrones:', err);
    } finally {
      setLoading(false);
    }
  };

  const buscar = useCallback(async (termino) => {
    if (!termino.trim()) {
      setResultados(null);
      return;
    }
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

  const limpiarBusqueda = () => {
    setBusqueda('');
    setResultados(null);
  };

  const patronesNuevos = patrones.filter(p => p.es_preview === 0).slice(0, 10);
  const patronesPreview = patrones.filter(p => p.es_preview === 1);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-crochet-primary"></div>
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
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar patrones, autores..."
            className="w-full bg-gray-800 border border-gray-700 rounded-full px-10 py-2 text-sm focus:outline-none focus:border-crochet-primary"
          />
          {busqueda && (
            <button onClick={limpiarBusqueda} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
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

      {/* Contenido principal (oculto durante búsqueda activa) */}
      {!busqueda && (
        <>
      {/* Hero Section */}
      {destacado && (
        <section className="relative h-[50vh] sm:h-[60vh]">
          <img 
            src={destacado.thumbnail_path || '/placeholder-hero.jpg'}
            alt={destacado.titulo}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-crochet-dark via-crochet-dark/50 to-transparent" />

          <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-10">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 mb-2">
                <span className="bg-crochet-primary text-xs font-bold px-2 py-1 rounded">NUEVO</span>
                {destacado.es_preview === 1 && (
                  <span className="bg-green-600 text-xs font-bold px-2 py-1 rounded">GRATIS ESTE MES</span>
                )}
              </div>
              <h1 className="text-3xl sm:text-5xl font-bold mb-2">{destacado.titulo}</h1>
              <p className="text-gray-300 mb-1">por {destacado.autor}</p>
              <p className="text-gray-400 text-sm mb-4 line-clamp-2">{destacado.descripcion}</p>

              <div className="flex gap-3">
                <Link to={`/patron/${destacado.id}`} className="btn-primary flex items-center gap-2">
                  <Play className="w-5 h-5" /> Ver patrón
                </Link>
                <button className="btn-secondary flex items-center gap-2">
                  <Info className="w-5 h-5" /> Más info
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Preview Gratuito */}
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

      {/* Carruseles */}
      <Carrusel titulo="🔥 Tendencia" patrones={patronesTendencia} />
      <Carrusel titulo="🆕 Nuevos patrones" patrones={patronesNuevos} />
      <Carrusel titulo="🎁 Gratis este mes" patrones={patronesPreview} />

      {/* CTA Suscripción */}
      {!user || user.tier === 'free' ? (
        <section className="px-4 py-8">
          <div className="max-w-2xl mx-auto text-center bg-gradient-to-r from-crochet-primary/20 to-purple-900/20 rounded-2xl p-8">
            <h2 className="text-2xl font-bold mb-2">Desbloquea todo el catálogo</h2>
            <p className="text-gray-400 mb-4">Más de {patrones.length} patrones profesionales por solo $100 MXN/mes</p>
            <ul className="text-left text-sm text-gray-300 mb-6 space-y-2 max-w-md mx-auto">
              <li>✓ Acceso ilimitado a todos los patrones</li>
              <li>✓ Descarga hasta 5 patrones para ver offline</li>
              <li>✓ Nuevos patrones cada semana</li>
              <li>✓ Guarda tu progreso y favoritos</li>
            </ul>
            <Link to="/perfil" className="btn-primary text-lg px-8">Suscribirme ahora</Link>
          </div>
        </section>
      ) : null}
        </>
      )}
    </div>
  );
}