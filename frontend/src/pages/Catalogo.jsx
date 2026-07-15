import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import PatronCard from '../components/PatronCard';
import { Search, X, SlidersHorizontal } from 'lucide-react';

const CATEGORIAS = ['todos', 'amigurumi', 'ropa', 'accesorios', 'hogar', 'navidad', 'otro'];
const DIFICULTADES = ['todos', 'principiante', 'intermedio', 'avanzado'];
const PAGE_SIZE = 60;

export default function Catalogo() {
  const [patrones, setPatrones] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [categoria, setCategoria] = useState('todos');
  const [dificultad, setDificultad] = useState('todos');
  const [mostrarFiltros, setMostrarFiltros] = useState(false);
  const offsetRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef(null);
  const hayMas = patrones.length < total;

  const cargar = useCallback(async (reset = true) => {
    if (!reset && loadingMoreRef.current) return;

    if (reset) {
      setLoading(true);
      offsetRef.current = 0;
    } else {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    }

    try {
      const params = { limit: PAGE_SIZE, offset: offsetRef.current };
      if (busqueda.trim()) params.search = busqueda.trim();
      if (categoria !== 'todos') params.categoria = categoria;
      if (dificultad !== 'todos') params.dificultad = dificultad;

      const res = await api.get('/patrones', { params });
      const nuevos = res.data.patrones || [];

      if (reset) {
        setPatrones(nuevos);
      } else {
        setPatrones(prev => [...prev, ...nuevos]);
      }
      setTotal(res.data.total || 0);
      offsetRef.current += nuevos.length;
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [busqueda, categoria, dificultad]);

  useEffect(() => {
    const timer = setTimeout(() => cargar(true), busqueda ? 400 : 0);
    return () => clearTimeout(timer);
  }, [cargar]);

  // Infinite scroll — hayMas en deps para que se adjunte cuando aparece el sentinel
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) cargar(false); },
      { rootMargin: '400px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [cargar, hayMas]);

  const limpiarFiltros = () => {
    setBusqueda('');
    setCategoria('todos');
    setDificultad('todos');
  };

  const hayFiltros = busqueda || categoria !== 'todos' || dificultad !== 'todos';

  return (
    <div className="px-4 py-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">Catálogo</h1>
          {!loading && <p className="text-xs text-gray-500">{patrones.length} de {total} patrones</p>}
        </div>
        <button
          onClick={() => setMostrarFiltros(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition ${mostrarFiltros ? 'bg-crochet-primary text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
          <SlidersHorizontal className="w-4 h-4" />
          Filtros
          {hayFiltros && <span className="w-2 h-2 rounded-full bg-yellow-400 ml-0.5" />}
        </button>
      </div>

      {/* Buscador */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar patrones, autores, diseñadoras..."
          className="w-full bg-gray-800 border border-gray-700 rounded-full px-10 py-2.5 text-sm focus:outline-none focus:border-crochet-primary"
        />
        {busqueda && (
          <button onClick={() => setBusqueda('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Filtros */}
      {mostrarFiltros && (
        <div className="bg-gray-800/60 rounded-xl p-4 mb-4 space-y-3">
          <div>
            <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Categoría</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORIAS.map(c => (
                <button key={c} onClick={() => setCategoria(c)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition capitalize ${categoria === c ? 'bg-crochet-primary text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                  {c === 'todos' ? 'Todos' : c}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Dificultad</p>
            <div className="flex flex-wrap gap-2">
              {DIFICULTADES.map(d => (
                <button key={d} onClick={() => setDificultad(d)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition capitalize ${dificultad === d ? 'bg-crochet-primary text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                  {d === 'todos' ? 'Todas' : d}
                </button>
              ))}
            </div>
          </div>
          {hayFiltros && (
            <button onClick={limpiarFiltros} className="text-xs text-gray-400 hover:text-white underline">
              Limpiar filtros
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-crochet-primary" />
        </div>
      ) : patrones.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg mb-2">No se encontraron patrones</p>
          {hayFiltros && (
            <button onClick={limpiarFiltros} className="text-crochet-primary hover:underline text-sm">
              Limpiar filtros
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {patrones.map(p => <PatronCard key={p.id} patron={p} />)}
          </div>

          {/* Sentinel para infinite scroll */}
          {hayMas && <div ref={sentinelRef} className="h-4" />}

          {loadingMore && (
            <div className="flex justify-center py-6">
              <div className="w-7 h-7 border-2 border-crochet-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!hayMas && patrones.length > 0 && (
            <p className="text-center text-xs text-gray-600 py-6">
              {total} patrones cargados
            </p>
          )}
        </>
      )}
    </div>
  );
}
