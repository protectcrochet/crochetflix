import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { Search, X, ChevronLeft } from 'lucide-react';

const CATEGORIAS = ['todas', 'amigurumi', 'ropa', 'accesorios', 'decoracion', 'hogar', 'navidad', 'halloween', 'animales', 'general', 'otro'];
const DIFICULTADES = ['todas', 'principiante', 'intermedio', 'avanzado'];
const POR_PAGINA = 24;

function PatronCardGrid({ patron }) {
  return (
    <Link to={`/patron/${patron.id}`} className="group">
      <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-gray-800">
        <img
          src={patron.thumbnail_path || '/placeholder-patron.jpg'}
          alt={patron.titulo}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute top-2 left-2 flex gap-1">
          {patron.es_preview === 1 && (
            <span className="bg-green-600 text-xs px-2 py-0.5 rounded font-bold">GRATIS</span>
          )}
        </div>
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
      </div>
      <div className="mt-2 px-0.5">
        <h3 className="font-semibold text-sm line-clamp-2 leading-tight">{patron.titulo}</h3>
        <p className="text-gray-400 text-xs mt-0.5 truncate">{patron.diseñadora || patron.autor}</p>
        <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
          <span className="capitalize">{patron.dificultad}</span>
          <span>·</span>
          <span>{patron.paginas} págs.</span>
        </div>
      </div>
    </Link>
  );
}

export default function Catalogo() {
  const [patrones, setPatrones] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [loading, setLoading] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [categoria, setCategoria] = useState('todas');
  const [dificultad, setDificultad] = useState('todas');

  useEffect(() => {
    setPatrones([]);
    setPage(1);
    cargar(1, true);
  }, [busqueda, categoria, dificultad]);

  const cargar = async (pagina, resetear = false) => {
    if (pagina === 1) setLoading(true); else setCargandoMas(true);
    try {
      const params = { page: pagina, limit: POR_PAGINA };
      if (busqueda) params.search = busqueda;
      if (categoria !== 'todas') params.categoria = categoria;
      if (dificultad !== 'todas') params.dificultad = dificultad;

      const res = await api.get('/patrones', { params });
      const nuevos = res.data.patrones || [];
      setPatrones(prev => resetear ? nuevos : [...prev, ...nuevos]);
      setTotal(res.data.total || 0);
      setTotalPaginas(res.data.totalPaginas || 1);
    } catch (err) {
      console.error('Error cargando catálogo:', err);
    } finally {
      setLoading(false);
      setCargandoMas(false);
    }
  };

  const cargarMas = () => {
    const siguiente = page + 1;
    setPage(siguiente);
    cargar(siguiente);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Cabecera */}
      <div className="flex items-center gap-3 mb-6">
        <Link to="/" className="flex items-center gap-1 text-gray-400 hover:text-white transition text-sm">
          <ChevronLeft className="w-4 h-4" /> Inicio
        </Link>
        <span className="text-gray-700">|</span>
        <div>
          <h1 className="text-2xl font-bold">Catálogo</h1>
          {!loading && <p className="text-gray-400 text-sm">{total.toLocaleString()} patrones disponibles</p>}
        </div>
      </div>

      {/* Búsqueda */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por título, diseñadora..."
          className="w-full bg-gray-800 border border-gray-700 rounded-full px-10 py-2.5 text-sm focus:outline-none focus:border-crochet-primary"
        />
        {busqueda && (
          <button onClick={() => setBusqueda('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Filtros */}
      <div className="flex gap-3 mb-6 flex-wrap">
        {/* Dificultad */}
        <select
          value={dificultad}
          onChange={e => setDificultad(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-full px-4 py-1.5 text-sm focus:outline-none focus:border-crochet-primary capitalize"
        >
          {DIFICULTADES.map(d => (
            <option key={d} value={d}>{d === 'todas' ? 'Dificultad' : d}</option>
          ))}
        </select>

        {/* Categorías */}
        <div className="flex gap-2 flex-wrap">
          {CATEGORIAS.map(cat => (
            <button
              key={cat}
              onClick={() => setCategoria(cat)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition capitalize ${
                categoria === cat
                  ? 'bg-crochet-primary text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              {cat === 'todas' ? 'Todas' : cat}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-crochet-primary" />
        </div>
      ) : patrones.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <p className="text-lg">No encontramos patrones</p>
          <p className="text-sm mt-1">Intenta con otros filtros</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {patrones.map(p => <PatronCardGrid key={p.id} patron={p} />)}
          </div>

          {page < totalPaginas && (
            <div className="flex justify-center mt-10">
              <button
                onClick={cargarMas}
                disabled={cargandoMas}
                className="btn-secondary px-8 py-3 flex items-center gap-2"
              >
                {cargandoMas ? (
                  <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> Cargando...</>
                ) : (
                  `Ver más (${total - patrones.length} restantes)`
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
