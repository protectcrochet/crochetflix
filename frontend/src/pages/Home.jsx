import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import api from '../services/api';
import Carrusel from '../components/Carrusel';
import PatronCard from '../components/PatronCard';
import { Play, Crown, Search, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PRECIOS, detectarMoneda } from '../utils/geoMoneda';

function HeroCarrusel({ patrones }) {
  const [idx, setIdx] = useState(0);
  const timerRef = useRef(null);

  const reiniciarTimer = (i) => {
    clearInterval(timerRef.current);
    setIdx((i + patrones.length) % patrones.length);
    timerRef.current = setInterval(() => setIdx(p => (p + 1) % patrones.length), 12000);
  };

  useEffect(() => {
    if (patrones.length <= 1) return;
    timerRef.current = setInterval(() => setIdx(p => (p + 1) % patrones.length), 12000);
    return () => clearInterval(timerRef.current);
  }, [patrones.length]);

  const actual = patrones[idx];

  return (
    <section className="relative h-[52vh] sm:h-[62vh] overflow-hidden">
      {patrones.map((p, i) => (
        <div key={p.id} className={`absolute inset-0 transition-opacity duration-700 ${i === idx ? 'opacity-100' : 'opacity-0'}`}>
          {(() => {
            const partes = (p.hero_position || '').split(' ');
            if (partes.length >= 4) {
              const xP = parseFloat(partes[0]) || 0, yP = parseFloat(partes[1]) || 0;
              const wP = parseFloat(partes[2]) || 100, hP = parseFloat(partes[3]) || 100;
              const bsX = wP > 0 ? 100 / wP * 100 : 100;
              const bsY = hP > 0 ? 100 / hP * 100 : 100;
              const bpX = wP < 100 ? xP / (100 - wP) * 100 : 0;
              const bpY = hP < 100 ? yP / (100 - hP) * 100 : 0;
              return (
                <div className="w-full h-full" style={{
                  backgroundImage: `url(${p.thumbnail_path || ''})`,
                  backgroundSize: `${bsX}% ${bsY}%`,
                  backgroundPosition: `${bpX}% ${bpY}%`,
                  backgroundRepeat: 'no-repeat',
                }} />
              );
            }
            const pos = partes.length >= 2 ? `${partes[0]} ${partes[1]}` : '50% 30%';
            const zoom = parseFloat(partes[2]) || 1;
            return (
              <img
                src={p.thumbnail_path || ''}
                alt={p.titulo}
                className="w-full h-full object-cover"
                style={{ objectPosition: pos, transform: `scale(${zoom})`, transformOrigin: pos }}
              />
            );
          })()}
        </div>
      ))}
      <div className="absolute inset-0 bg-gradient-to-t from-crochet-dark via-crochet-dark/40 to-transparent" />

      {/* Info */}
      <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-10">
        <div className="max-w-2xl">
          {actual.es_preview === 1 && (
            <span className="bg-green-600 text-xs font-bold px-2 py-1 rounded mb-2 inline-block">GRATIS ESTE MES</span>
          )}
          <h1 className="text-2xl sm:text-4xl font-bold mb-1 line-clamp-2">{actual.titulo}</h1>
          <p className="text-gray-300 text-sm mb-1">por {actual.diseñadora || actual.autor}</p>
          <p className="text-gray-400 text-xs mb-4 line-clamp-1">{actual.descripcion}</p>
          <Link to={`/patron/${actual.id}`} className="btn-primary flex items-center gap-2 w-fit">
            <Play className="w-4 h-4" /> Ver patrón
          </Link>
        </div>
      </div>

      {/* Flechas */}
      {patrones.length > 1 && (
        <>
          <button onClick={() => reiniciarTimer(idx - 1)}
            className="absolute left-3 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/70 rounded-full p-2 transition">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button onClick={() => reiniciarTimer(idx + 1)}
            className="absolute right-3 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/70 rounded-full p-2 transition">
            <ChevronRight className="w-5 h-5" />
          </button>
        </>
      )}

      {/* Puntos */}
      {patrones.length > 1 && (
        <div className="absolute bottom-4 right-6 flex gap-1.5">
          {patrones.map((_, i) => (
            <button key={i} onClick={() => reiniciarTimer(i)}
              className={`rounded-full transition-all ${i === idx ? 'w-4 h-2 bg-white' : 'w-2 h-2 bg-white/40 hover:bg-white/70'}`} />
          ))}
        </div>
      )}
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
  const [continua, setContinua] = useState([]);
  const [patronesAleatorios, setPatronesAleatorios] = useState([]);
  const [popupOferta, setPopupOferta] = useState(false);
  const [moneda, setMoneda] = useState('USD');

  useEffect(() => { cargarPatrones(); cargarAleatorios(); detectarMoneda().then(setMoneda); }, []);

  useEffect(() => {
    if (!user || user.tier === 'premium') return;
    if (!sessionStorage.getItem('popup_oferta_visto')) {
      setTimeout(() => setPopupOferta(true), 1200);
    }
  }, [user]);

  useEffect(() => {
    if (!user) { setContinua([]); return; }
    api.get('/auth/historial').then(r => setContinua(r.data.patrones || [])).catch(() => {});
  }, [user]);

  const cargarAleatorios = async () => {
    const horaKey = `aleatorio_${new Date().toISOString().slice(0, 13)}`;
    const cached = sessionStorage.getItem(horaKey);
    if (cached) { setPatronesAleatorios(JSON.parse(cached)); return; }
    try {
      const res = await api.get('/patrones', { params: { orden: 'aleatorio', limit: 20 } });
      const data = res.data.patrones || [];
      sessionStorage.setItem(horaKey, JSON.stringify(data));
      setPatronesAleatorios(data);
    } catch {}
  };

  const cargarPatrones = async () => {
    try {
      const [resAll, resDestacados, resTendencia] = await Promise.all([
        api.get('/patrones'),
        api.get('/patrones', { params: { destacado: '1', limit: 12 } }),
        api.get('/patrones', { params: { tendencia: '1', limit: 16 } }),
      ]);
      const data = resAll.data.patrones || [];
      const dest = resDestacados.data.patrones || [];
      const trend = resTendencia.data.patrones || [];
      setPatrones(data);
      setTotalPatrones(resAll.data.total || data.length);
      setHeroPatrones(dest.length > 0 ? dest : data.slice(0, 1));
      setPatronesTendencia(trend.length > 0 ? trend : [...data].sort(() => Math.random() - 0.5).slice(0, 10));
    } catch (err) {
      console.error('Error cargando patrones:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePatronUpdate = useCallback((id, form) => {
    const update = arr => arr.map(p => p.id === id ? { ...p, ...form } : p);
    setPatrones(update);
    setHeroPatrones(update);
    setPatronesTendencia(update);
    setPatronesAleatorios(update);
    setResultados(prev => prev ? update(prev) : prev);
  }, []);

  const buscar = useCallback(async (termino) => {
    if (!termino.trim()) { setResultados(null); return; }
    setBuscando(true);
    try {
      const res = await api.get('/patrones', { params: { search: termino.trim() } });
      setResultados(res.data.patrones || []);
    } catch { } finally {
      setBuscando(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => buscar(busqueda), 400);
    return () => clearTimeout(timer);
  }, [busqueda, buscar]);

  const patronesPreview = patrones.filter(p => p.es_preview === 1);

  if (loading) return (
    <div className="flex items-center justify-center h-96">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-crochet-primary" />
    </div>
  );

  return (
    <div>
      {/* Búsqueda */}
      <div className="px-4 pt-6 pb-2">
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
            <button onClick={() => { setBusqueda(''); setResultados(null); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Resultados búsqueda */}
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
                  {resultados.map(p => <PatronCard key={p.id} patron={p} onUpdate={handlePatronUpdate} />)}
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* Contenido principal */}
      {!busqueda && (
        <>
          {heroPatrones.length > 0 && <HeroCarrusel patrones={heroPatrones} />}

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

          {continua.length > 0 && (
            <section className="px-4 pt-6 pb-2">
              <h2 className="text-base font-semibold mb-3 text-white">Continúa leyendo</h2>
              <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
                {continua.map(p => {
                  const pct = p.paginas > 0 ? Math.round((p.pagina_actual / p.paginas) * 100) : 0;
                  return (
                    <Link key={p.id} to={`/patron/${p.id}`}
                      className="flex-none w-36 group relative rounded-lg overflow-hidden bg-gray-800">
                      <div className="relative w-full h-24 overflow-hidden">
                        {p.thumbnail_path ? (
                          <img src={p.thumbnail_path} alt={p.titulo}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                        ) : (
                          <div className="w-full h-full bg-gray-700" />
                        )}
                        {p.completado ? (
                          <div className="absolute top-1 right-1 bg-green-600 rounded-full w-5 h-5 flex items-center justify-center text-xs">✓</div>
                        ) : null}
                      </div>
                      <div className="p-2">
                        <p className="text-xs text-white font-medium line-clamp-2 leading-tight mb-1">{p.titulo}</p>
                        <div className="w-full h-1 bg-gray-600 rounded-full overflow-hidden">
                          <div className="h-full bg-crochet-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="text-gray-400 text-xs mt-1">{p.completado ? 'Completado' : `Pág. ${p.pagina_actual}${p.paginas > 0 ? ` / ${p.paginas}` : ''}`}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          <Carrusel titulo="🔥 Tendencia" patrones={patronesTendencia} loop autoScroll onUpdate={handlePatronUpdate} />
          <Carrusel titulo="🆕 Nuevos patrones" patrones={patronesAleatorios} onUpdate={handlePatronUpdate} />
          <Carrusel titulo="🎁 Gratis este mes" patrones={patronesPreview} onUpdate={handlePatronUpdate} />

          {(!user || user.tier === 'free') && (
            <section className="px-4 py-8">
              <div className="max-w-2xl mx-auto text-center bg-gradient-to-r from-crochet-primary/20 to-purple-900/20 rounded-2xl p-8">
                <h2 className="text-2xl font-bold mb-2">Desbloquea todo el catálogo</h2>
                <p className="text-gray-400 mb-4">Más de {totalPatrones.toLocaleString()} patrones profesionales por solo {PRECIOS[moneda]?.mensual}/mes</p>
                <ul className="text-left text-sm text-gray-300 mb-6 space-y-2 max-w-md mx-auto">
                  <li>✓ Acceso ilimitado a todos los patrones</li>
                  <li>✓ Traducción de patrones al idioma que elijas (5 por semana)</li>
                  <li>✓ Vista offline de tus patrones favoritos</li>
                  <li>✓ Nuevos patrones cada semana</li>
                  <li>✓ Guarda tu progreso y favoritos</li>
                </ul>
                <Link to="/perfil" className="btn-primary text-lg px-8">Suscribirme ahora</Link>
              </div>
            </section>
          )}
        </>
      )}

      {/* Banner oferta de lanzamiento */}
      {popupOferta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm">
          <div className="relative w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl">
            {/* Fondo degradado */}
            <div className="absolute inset-0 bg-gradient-to-br from-pink-600 via-crochet-primary to-purple-700" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(255,255,255,0.15),_transparent_60%)]" />

            <div className="relative p-7">
              <button
                onClick={() => { setPopupOferta(false); sessionStorage.setItem('popup_oferta_visto', '1'); }}
                className="absolute top-4 right-4 text-white/60 hover:text-white transition">
                <X className="w-5 h-5" />
              </button>

              {/* Badge */}
              <div className="inline-flex items-center gap-1.5 bg-white/20 backdrop-blur-sm rounded-full px-3 py-1 text-xs font-bold text-white mb-4">
                🧶 OFERTA DE LANZAMIENTO
              </div>

              {/* Precio grande */}
              <div className="mb-1">
                <span className="text-8xl font-black text-white leading-none">50</span>
                <span className="text-4xl font-black text-white">%</span>
              </div>
              <p className="text-white/90 text-xl font-bold mb-1">en tu primer mes</p>
              <p className="text-white/70 text-sm mb-5">
                Accede a +8,000 patrones por solo{' '}
                <span className="text-white font-bold">{PRECIOS[moneda]?.mensual}</span>/mes
              </p>

              {/* Deadline */}
              <div className="flex items-center gap-2 bg-white/15 rounded-xl px-4 py-2.5 mb-5">
                <span className="text-lg">⏰</span>
                <div>
                  <p className="text-white text-xs font-bold">Solo hasta el martes 16 de junio</p>
                  <p className="text-white/60 text-xs">Después el precio vuelve a ser normal</p>
                </div>
              </div>

              {/* Beneficios */}
              <ul className="text-white/80 text-xs space-y-1 mb-6">
                <li>✓ Acceso ilimitado a todos los patrones</li>
                <li>✓ Traducción automática a tu idioma</li>
                <li>✓ Guarda progreso y favoritos</li>
                <li>✓ Cancela cuando quieras</li>
              </ul>

              <Link to="/perfil"
                onClick={() => { setPopupOferta(false); sessionStorage.setItem('popup_oferta_visto', '1'); }}
                className="block w-full bg-white text-crochet-primary font-black text-center py-3.5 rounded-2xl text-base hover:bg-gray-100 transition shadow-lg">
                ¡Quiero el 50% OFF →
              </Link>

              <button
                onClick={() => { setPopupOferta(false); sessionStorage.setItem('popup_oferta_visto', '1'); }}
                className="w-full text-center text-xs text-white/40 hover:text-white/70 mt-3 transition">
                No me interesa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
