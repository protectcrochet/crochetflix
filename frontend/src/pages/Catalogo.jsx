import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { Search, X, ChevronLeft, Star, Flame, Pencil, Check } from 'lucide-react';

const CATEGORIAS = ['todas', 'amigurumi', 'ropa', 'accesorios', 'decoracion', 'hogar', 'navidad', 'halloween', 'animales', 'general', 'otro'];
const DIFICULTADES = ['todas', 'principiante', 'intermedio', 'avanzado'];
const IDIOMAS = [{ v: '', l: 'Todos' }, { v: 'es', l: '🇪🇸 Español' }, { v: 'en', l: '🇺🇸 Inglés' }, { v: 'pt', l: '🇧🇷 Portugués' }, { v: 'fr', l: '🇫🇷 Francés' }, { v: 'de', l: '🇩🇪 Alemán' }, { v: 'it', l: '🇮🇹 Italiano' }];
const ORDENES = [{ v: 'aleatorio', l: 'Descubrir' }, { v: 'recientes', l: 'Más recientes' }, { v: 'az', l: 'A–Z' }, { v: 'paginas', l: 'Más páginas' }];
const POR_PAGINA = 24;

function PatronCardGrid({ patron, isAdmin, onToggle, onEdit }) {
  const adminSecret = isAdmin ? localStorage.getItem('admin_secret') : null;
  const authHeader = adminSecret ? { 'X-Admin-Secret': adminSecret } : {};

  const toggle = async (e, tipo, campo) => {
    e.preventDefault();
    e.stopPropagation();
    await api.patch(`/admin/patrones/${patron.id}/${tipo}`, {}, { headers: authHeader });
    onToggle && onToggle(patron.id, campo);
  };

  return (
    <Link to={`/patron/${patron.id}`} className="group">
      <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-gray-800 flex items-center justify-center">
        <img
          src={patron.thumbnail_path || ''}
          alt={patron.titulo}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
          onError={e => { e.currentTarget.style.display = 'none'; }}
        />
        {patron.es_preview === 1 && (
          <div className="absolute top-2 left-2">
            <span className="bg-green-600 text-xs px-2 py-0.5 rounded font-bold">GRATIS</span>
          </div>
        )}
        {isAdmin && (
          <div className="absolute top-2 right-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={e => toggle(e, 'destacar', 'destacado')}
              className={`p-1.5 rounded-lg backdrop-blur-sm transition ${patron.destacado ? 'bg-yellow-500 text-black' : 'bg-black/60 text-gray-300 hover:bg-yellow-500 hover:text-black'}`}
              title="Destacar">
              <Star className="w-3.5 h-3.5" fill={patron.destacado ? 'currentColor' : 'none'} />
            </button>
            <button onClick={e => toggle(e, 'tendencia', 'tendencia')}
              className={`p-1.5 rounded-lg backdrop-blur-sm transition ${patron.tendencia ? 'bg-orange-500 text-white' : 'bg-black/60 text-gray-300 hover:bg-orange-500 hover:text-white'}`}
              title="Tendencia">
              <Flame className="w-3.5 h-3.5" fill={patron.tendencia ? 'currentColor' : 'none'} />
            </button>
            <button onClick={e => { e.preventDefault(); e.stopPropagation(); onEdit && onEdit(patron); }}
              className="p-1.5 rounded-lg backdrop-blur-sm bg-black/60 text-gray-300 hover:bg-blue-600 hover:text-white transition"
              title="Editar título y diseñadora">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
      </div>
      <div className="mt-2 px-0.5">
        <h3 className="font-semibold text-sm line-clamp-2 leading-tight">{patron.titulo}</h3>
        {(() => { const PLACEHOLDERS = ['Diseñadora','Diseñadora ','Telegram','N/A','']; const d = patron.diseñadora && !PLACEHOLDERS.includes(patron.diseñadora.trim()) ? patron.diseñadora : (patron.autor && !PLACEHOLDERS.includes(patron.autor.trim()) ? patron.autor : null); return d ? <p className="text-gray-400 text-xs mt-0.5 truncate">{d}</p> : null; })()}
        <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
          <span className="capitalize">{patron.dificultad}</span>
          <span>·</span>
          <span>{patron.paginas} págs.</span>
          {isAdmin && patron.destacado ? <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" /> : null}
          {isAdmin && patron.tendencia ? <Flame className="w-3 h-3 text-orange-400 fill-orange-400" /> : null}
        </div>
      </div>
    </Link>
  );
}

function EditModal({ patron, onClose, onSave }) {
  const [titulo, setTitulo] = useState(patron.titulo || '');
  const [disenadora, setDisenadora] = useState(patron.diseñadora || '');
  const [guardando, setGuardando] = useState(false);
  const adminSecret = localStorage.getItem('admin_secret');

  const guardar = async () => {
    setGuardando(true);
    try {
      await api.patch(`/admin/patrones/${patron.id}`, { titulo, diseñadora: disenadora }, { headers: { 'X-Admin-Secret': adminSecret } });
      onSave(patron.id, titulo, disenadora);
      onClose();
    } catch { setGuardando(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-sm">Editar patrón</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="mb-3">
          <label className="text-xs text-gray-400 mb-1 block">Título</label>
          <input value={titulo} onChange={e => setTitulo(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-crochet-primary"
            placeholder="Título del patrón" autoFocus />
        </div>
        <div className="mb-4">
          <label className="text-xs text-gray-400 mb-1 block">Diseñadora</label>
          <input value={disenadora} onChange={e => setDisenadora(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-crochet-primary"
            placeholder="Nombre de la diseñadora" />
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition">Cancelar</button>
          <button onClick={guardar} disabled={guardando}
            className="flex-1 py-2 bg-crochet-primary hover:opacity-90 rounded-lg text-sm font-semibold transition flex items-center justify-center gap-1 disabled:opacity-50">
            {guardando ? '...' : <><Check className="w-4 h-4" /> Guardar</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function PatronCardSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="aspect-[3/4] rounded-lg bg-gray-800" />
      <div className="mt-2 space-y-1.5 px-0.5">
        <div className="h-3 bg-gray-800 rounded w-3/4" />
        <div className="h-3 bg-gray-800 rounded w-1/2" />
        <div className="h-3 bg-gray-800 rounded w-1/3" />
      </div>
    </div>
  );
}

export default function Catalogo() {
  const isAdmin = !!localStorage.getItem('admin_secret');
  const [editando, setEditando] = useState(null);
  const [patrones, setPatrones] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [loading, setLoading] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);

  const [busqueda, setBusqueda] = useState('');
  const [busquedaFiltro, setBusquedaFiltro] = useState('');
  const debounceRef = useRef(null);

  const [categoria, setCategoria] = useState('todas');
  const [dificultad, setDificultad] = useState('todas');
  const [idioma, setIdioma] = useState('');
  const [orden, setOrden] = useState('aleatorio');

  const handleBusqueda = (valor) => {
    setBusqueda(valor);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setBusquedaFiltro(valor), 300);
  };

  useEffect(() => {
    setPatrones([]);
    setPage(1);
    cargar(1, true);
  }, [busquedaFiltro, categoria, dificultad, idioma, orden]);

  const cargar = async (pagina, resetear = false) => {
    if (pagina === 1) setLoading(true); else setCargandoMas(true);
    try {
      const params = { page: pagina, limit: POR_PAGINA };
      if (busquedaFiltro) params.search = busquedaFiltro;
      if (categoria !== 'todas') params.categoria = categoria;
      if (dificultad !== 'todas') params.dificultad = dificultad;
      if (idioma) params.idioma = idioma;
      if (orden !== 'recientes') params.orden = orden;

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
          onChange={e => handleBusqueda(e.target.value)}
          placeholder="Buscar por título, diseñadora..."
          className="w-full bg-gray-800 border border-gray-700 rounded-full px-10 py-2.5 text-sm focus:outline-none focus:border-crochet-primary"
        />
        {busqueda && (
          <button onClick={() => handleBusqueda('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Filtros */}
      <div className="flex gap-3 mb-6 flex-wrap items-center">
        <select value={orden} onChange={e => setOrden(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-full px-4 py-1.5 text-sm focus:outline-none focus:border-crochet-primary">
          {ORDENES.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
        <select value={dificultad} onChange={e => setDificultad(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-full px-4 py-1.5 text-sm focus:outline-none focus:border-crochet-primary capitalize">
          {DIFICULTADES.map(d => <option key={d} value={d}>{d === 'todas' ? 'Dificultad' : d}</option>)}
        </select>
        <select value={idioma} onChange={e => setIdioma(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-full px-4 py-1.5 text-sm focus:outline-none focus:border-crochet-primary">
          {IDIOMAS.map(i => <option key={i.v} value={i.v}>{i.l}</option>)}
        </select>
        <div className="flex gap-2 flex-wrap">
          {CATEGORIAS.map(cat => (
            <button key={cat} onClick={() => setCategoria(cat)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition capitalize ${categoria === cat ? 'bg-crochet-primary text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
              {cat === 'todas' ? 'Todas' : cat}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {Array.from({ length: POR_PAGINA }).map((_, i) => <PatronCardSkeleton key={i} />)}
        </div>
      ) : patrones.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <p className="text-lg">No encontramos patrones</p>
          <p className="text-sm mt-1">Intenta con otros filtros</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {patrones.map(p => <PatronCardGrid key={p.id} patron={p} isAdmin={isAdmin}
  onToggle={(id, campo) => setPatrones(prev => prev.map(x => x.id === id ? { ...x, [campo]: x[campo] ? 0 : 1 } : x))}
  onEdit={setEditando} />)}
{editando && <EditModal patron={editando} onClose={() => setEditando(null)}
  onSave={(id, titulo, disenadora) => setPatrones(prev => prev.map(x => x.id === id ? { ...x, titulo, diseñadora: disenadora } : x))} />}
          </div>
          {page < totalPaginas && (
            <div className="flex justify-center mt-10">
              <button onClick={cargarMas} disabled={cargandoMas}
                className="btn-secondary px-8 py-3 flex items-center gap-2">
                {cargandoMas
                  ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> Cargando...</>
                  : `Ver más (${total - patrones.length} restantes)`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
