import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { Upload, Trash2, Eye, EyeOff, Plus, FileText, Image, Loader, LogOut, Download, Sparkles, Star, Flame, Search, X, ExternalLink } from 'lucide-react';

const CATEGORIAS = ['amigurumi', 'ropa', 'accesorios', 'decoracion', 'hogar', 'otro'];
const SUBCATEGORIAS_AMIGURUMI = ['animales', 'personas y muñecos', 'comida', 'plantas y flores', 'personajes y fantasía', 'navidad', 'otro'];
const DIFICULTADES = ['principiante', 'intermedio', 'avanzado'];

function HeroCropModal({ patron, authHeader, onClose }) {
  const partes = (patron.hero_position || '50% 30% 1').split(' ');
  const [x, setX] = useState(() => parseInt(partes[0]) || 50);
  const [y, setY] = useState(() => parseInt(partes[1]) || 30);
  const [zoom, setZoom] = useState(() => parseFloat(partes[2]) || 1);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    setGuardando(true);
    try {
      await api.patch(`/admin/patrones/${patron.id}/hero-position`,
        { hero_position: `${x}% ${y}% ${zoom}` },
        { headers: authHeader }
      );
      onClose();
    } catch {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-xl p-4 w-full max-w-lg">
        <h3 className="font-bold text-base mb-1">Ajustar encuadre del hero</h3>
        <p className="text-gray-400 text-xs mb-3">El preview muestra exactamente cómo se verá en la portada.</p>

        {/* Preview */}
        <div className="relative rounded-lg overflow-hidden mb-4 bg-gray-800" style={{ aspectRatio: '16/7' }}>
          <img
            src={patron.thumbnail_path || ''}
            alt={patron.titulo}
            className="w-full h-full object-cover transition-all duration-150"
            style={{
              objectPosition: `${x}% ${y}%`,
              transform: `scale(${zoom})`,
              transformOrigin: `${x}% ${y}%`,
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
          <div className="absolute bottom-3 left-3 right-3 pointer-events-none">
            <p className="font-bold text-white">{patron.titulo}</p>
            <p className="text-gray-300 text-sm">{patron.diseñadora || patron.autor}</p>
          </div>
        </div>

        {/* Sliders */}
        <div className="space-y-3 mb-4">
          <div>
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>← Horizontal →</span><span>{x}%</span>
            </div>
            <input type="range" min="0" max="100" value={x} onChange={e => setX(+e.target.value)}
              className="w-full accent-red-500" />
          </div>
          <div>
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>↑ Vertical ↓</span><span>{y}%</span>
            </div>
            <input type="range" min="0" max="100" value={y} onChange={e => setY(+e.target.value)}
              className="w-full accent-red-500" />
          </div>
          <div>
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>🔍 Zoom (alejar ↔ acercar)</span><span>{Math.round(zoom * 100)}%</span>
            </div>
            <input type="range" min="0.5" max="2.5" step="0.05" value={zoom} onChange={e => setZoom(+e.target.value)}
              className="w-full accent-red-500" />
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg transition">Cancelar</button>
          <button onClick={guardar} disabled={guardando} className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 rounded-lg transition font-semibold disabled:opacity-50">
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Admin() {
  const [secret, setSecret] = useState(() => localStorage.getItem('admin_secret') || '');
  const [autenticado, setAutenticado] = useState(false);
  const [patrones, setPatrones] = useState([]);
  const [mostrando, setMostrando] = useState('lista'); // 'lista' | 'nuevo'
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState(null); // { tipo: 'ok'|'error', texto }
  const [busquedaAdmin, setBusquedaAdmin] = useState('');
  const [filtroAdmin, setFiltroAdmin] = useState('todos'); // todos|hero|tendencia|ocultos|gratis
  const [patronEditando, setPatronEditando] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [stats, setStats] = useState(null);
  const [heroCropPatron, setHeroCropPatron] = useState(null);

  const [form, setForm] = useState({
    titulo: '', descripcion: '', autor: '', diseñadora: '',
    categoria: 'amigurumi', subcategoria: 'animales', dificultad: 'principiante',
    tiempo_minutos: '', es_preview: false,
  });
  const [archivoPDF, setArchivoPDF] = useState(null);
  const [imagenesFiles, setImagenesFiles] = useState([]);
  const [modoSubida, setModoSubida] = useState('pdf'); // 'pdf' | 'imagenes'

  const pdfRef = useRef();
  const imgRef = useRef();

  const authHeader = { 'X-Admin-Secret': secret };

  const verificarAcceso = async () => {
    try {
      await api.get('/admin/patrones', { headers: authHeader });
      localStorage.setItem('admin_secret', secret);
      setAutenticado(true);
      cargarPatrones();
    } catch {
      setMensaje({ tipo: 'error', texto: 'Clave incorrecta' });
    }
  };

  const cargarPatrones = async () => {
    try {
      const [resP, resS] = await Promise.all([
        api.get('/admin/patrones', { headers: authHeader }),
        api.get('/admin/stats', { headers: authHeader }),
      ]);
      setPatrones(resP.data.patrones);
      setStats(resS.data);
    } catch {
      setMensaje({ tipo: 'error', texto: 'Error cargando patrones' });
    }
  };

  const cargarStats = async () => {
    try {
      const res = await api.get('/admin/stats', { headers: authHeader });
      setStats(res.data);
    } catch {}
  };

  useEffect(() => {
    if (!autenticado) return;
    const intervalo = setInterval(cargarStats, 10000);
    return () => clearInterval(intervalo);
  }, [autenticado]);

  const cerrarSesion = () => {
    localStorage.removeItem('admin_secret');
    setAutenticado(false);
    setSecret('');
  };

  const exportarCSV = async () => {
    const res = await fetch('/api/admin/patrones/exportar', { headers: authHeader });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'patrones.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const [progresoIA, setProgresoIA] = useState(null);
  const [progresoMeta, setProgresoMeta] = useState(null);

  const normalizarCategorias = async () => {
    setCargando(true);
    try {
      const res = await api.post('/admin/patrones/normalizar-categorias', {}, { headers: authHeader });
      setMensaje({ tipo: 'ok', texto: res.data.message });
      cargarPatrones();
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.response?.data?.error || 'Error normalizando' });
    } finally {
      setCargando(false);
    }
  };

  const extraerMetadatos = async () => {
    setCargando(true);
    setMensaje(null);
    setProgresoMeta(null);
    let totalActualizados = 0;
    try {
      while (true) {
        const res = await api.post('/admin/patrones/extraer-metadatos', {}, { headers: authHeader, timeout: 120000 });
        totalActualizados += res.data.actualizados || 0;
        setProgresoMeta({ actualizados: totalActualizados, restantes: res.data.restantes });
        if (!res.data.restantes || res.data.restantes === 0) break;
      }
      setMensaje({ tipo: 'ok', texto: `✅ ${totalActualizados} patrones actualizados con título, diseñadora e idioma` });
      cargarPatrones();
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.response?.data?.error || 'Error extrayendo metadatos' });
    } finally {
      setCargando(false);
      setProgresoMeta(null);
    }
  };

  const categorizarConIA = async () => {
    setCargando(true);
    setMensaje(null);
    setProgresoIA(null);
    let totalActualizados = 0;

    try {
      while (true) {
        const res = await api.post('/admin/patrones/categorizar', {}, { headers: authHeader, timeout: 120000 });
        totalActualizados += res.data.actualizados || 0;
        setProgresoIA({ actualizados: totalActualizados, restantes: res.data.restantes });

        if (!res.data.restantes || res.data.restantes === 0) break;
      }
      setMensaje({ tipo: 'ok', texto: `✅ ${totalActualizados} patrones categorizados con IA` });
      cargarPatrones();
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.response?.data?.error || 'Error categorizando' });
    } finally {
      setCargando(false);
      setProgresoIA(null);
    }
  };

  const sincronizarPDFs = async () => {
    setCargando(true);
    setMensaje(null);
    try {
      const res = await api.post('/admin/patrones/sincronizar', {}, { headers: authHeader });
      const extra = res.data.errores ? ` (${res.data.errores.length} errores)` : '';
      setMensaje({ tipo: 'ok', texto: res.data.message + extra });
      cargarPatrones();
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.response?.data?.error || 'Error sincronizando' });
    } finally {
      setCargando(false);
    }
  };

  const importarCSV = async (e) => {
    const archivo = e.target.files[0];
    if (!archivo) return;
    setCargando(true);
    setMensaje(null);
    const data = new FormData();
    data.append('csv', archivo);
    try {
      const res = await api.post('/admin/patrones/importar', data, {
        headers: { ...authHeader, 'Content-Type': 'multipart/form-data' },
      });
      setMensaje({ tipo: 'ok', texto: res.data.message });
      cargarPatrones();
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.response?.data?.error || 'Error importando CSV' });
    } finally {
      setCargando(false);
      e.target.value = '';
    }
  };

  const handleToggle = async (id) => {
    await api.patch(`/admin/patrones/${id}/toggle`, {}, { headers: authHeader });
    cargarPatrones();
  };

  const handleDestacar = async (id) => {
    try {
      const res = await api.patch(`/admin/patrones/${id}/destacar`, {}, { headers: authHeader });
      if (res.data.destacado) {
        const patron = patrones.find(p => p.id === id);
        if (patron) setHeroCropPatron(patron);
      }
      cargarPatrones();
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.response?.data?.error || 'Error' });
      setTimeout(() => setMensaje(null), 3000);
    }
  };

  const handleTendencia = async (id) => {
    await api.patch(`/admin/patrones/${id}/tendencia`, {}, { headers: authHeader });
    cargarPatrones();
  };

  const abrirEditor = (p) => {
    setPatronEditando(p);
    setEditForm({
      titulo: p.titulo || '',
      diseñadora: p.diseñadora || '',
      categoria: p.categoria || 'amigurumi',
      subcategoria: p.subcategoria || '',
      dificultad: p.dificultad || 'principiante',
      descripcion: p.descripcion || '',
    });
  };

  const guardarEdicion = async () => {
    setGuardando(true);
    try {
      await api.patch(`/admin/patrones/${patronEditando.id}`, editForm, { headers: authHeader });
      await cargarPatrones();
      setPatronEditando(prev => ({ ...prev, ...editForm }));
    } catch {
      alert('Error guardando');
    } finally {
      setGuardando(false);
    }
  };

  const handleVerificar = async (id) => {
    const res = await api.patch(`/admin/patrones/${id}/verificar`, {}, { headers: authHeader });
    cargarPatrones();
    if (patronEditando?.id === id) setPatronEditando(prev => ({ ...prev, verificado: res.data.verificado ? 1 : 0 }));
  };

  const handleEliminar = async (id, titulo) => {
    if (!confirm(`¿Eliminar "${titulo}"? Esta acción no se puede deshacer.`)) return;
    await api.delete(`/admin/patrones/${id}`, { headers: authHeader });
    cargarPatrones();
  };

  const handleSubir = async (e) => {
    e.preventDefault();
    setMensaje(null);

    if (!form.titulo) {
      setMensaje({ tipo: 'error', texto: 'El título es obligatorio' });
      return;
    }
    if (modoSubida === 'pdf' && !archivoPDF) {
      setMensaje({ tipo: 'error', texto: 'Selecciona un archivo PDF' });
      return;
    }
    if (modoSubida === 'imagenes' && imagenesFiles.length === 0) {
      setMensaje({ tipo: 'error', texto: 'Selecciona al menos una imagen' });
      return;
    }

    setCargando(true);
    const data = new FormData();
    Object.entries(form).forEach(([k, v]) => data.append(k, v));

    if (modoSubida === 'pdf') {
      data.append('pdf', archivoPDF);
    } else {
      imagenesFiles.forEach(img => data.append('imagenes', img));
    }

    try {
      const res = await api.post('/admin/patrones', data, {
        headers: { ...authHeader, 'Content-Type': 'multipart/form-data' },
        timeout: 180000,
      });
      setMensaje({ tipo: 'ok', texto: `"${res.data.patron.titulo}" creado con ${res.data.patron.paginas} páginas` });
      setForm({ titulo: '', descripcion: '', autor: '', categoria: 'amigurumi', dificultad: 'principiante', tiempo_minutos: '', es_preview: false });
      setArchivoPDF(null);
      setImagenesFiles([]);
      if (pdfRef.current) pdfRef.current.value = '';
      if (imgRef.current) imgRef.current.value = '';
      setMostrando('lista');
      cargarPatrones();
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.response?.data?.error || 'Error subiendo patrón' });
    } finally {
      setCargando(false);
    }
  };

  // Pantalla de login
  if (!autenticado) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-gray-800 rounded-xl p-8">
          <h1 className="text-2xl font-bold mb-1">Panel Admin</h1>
          <p className="text-gray-400 text-sm mb-6">Solo para administradores</p>
          {mensaje && (
            <p className="text-red-400 text-sm mb-4">{mensaje.texto}</p>
          )}
          <input
            type="password"
            placeholder="Clave de administrador"
            value={secret}
            onChange={e => setSecret(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && verificarAcceso()}
            className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-2 mb-4 focus:outline-none focus:border-crochet-primary"
          />
          <button onClick={verificarAcceso} className="w-full btn-primary py-2">
            Entrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 px-4 py-6 max-w-4xl mx-auto relative">
      {/* Modal ajuste posición hero */}
      {heroCropPatron && (
        <HeroCropModal
          patron={heroCropPatron}
          authHeader={authHeader}
          onClose={() => setHeroCropPatron(null)}
        />
      )}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Panel Admin</h1>
          <p className="text-gray-400 text-sm">{patrones.length} patrones en total</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {mostrando === 'lista' ? (
            <button onClick={() => { setMostrando('nuevo'); setMensaje(null); }} className="btn-primary flex items-center gap-2 text-sm">
              <Plus className="w-4 h-4" /> Nuevo patrón
            </button>
          ) : (
            <button onClick={() => { setMostrando('lista'); setMensaje(null); }} className="btn-secondary text-sm">
              Cancelar
            </button>
          )}
          <button onClick={exportarCSV} title="Exportar CSV para editar en Excel"
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-200 transition">
            <Download className="w-4 h-4" /> CSV
          </button>
          <label title="Importar CSV editado" className="flex items-center gap-1.5 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-200 transition cursor-pointer">
            <Upload className="w-4 h-4" /> Importar
            <input type="file" accept=".csv" onChange={importarCSV} className="hidden" />
          </label>
          <button onClick={extraerMetadatos} disabled={cargando} title="Extrae título, diseñadora e idioma leyendo el PDF con IA"
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-700 hover:bg-indigo-600 rounded text-sm text-white transition disabled:opacity-50">
            {cargando ? <Loader className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Extraer datos PDF
          </button>
          <button onClick={categorizarConIA} disabled={cargando} title="Categorizar patrones automáticamente con IA"
            className="flex items-center gap-1.5 px-3 py-2 bg-purple-700 hover:bg-purple-600 rounded text-sm text-white transition disabled:opacity-50">
            {cargando ? <Loader className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Categorizar IA
          </button>
          <button onClick={normalizarCategorias} disabled={cargando} title="Corrige mayúsculas en categorías"
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-600 hover:bg-gray-500 rounded text-sm text-white transition disabled:opacity-50">
            Fix categorías
          </button>
          <button onClick={sincronizarPDFs} disabled={cargando} title="Procesar PDFs nuevos subidos por el bot"
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-700 hover:bg-blue-600 rounded text-sm text-white transition disabled:opacity-50">
            {cargando ? <Loader className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            Sincronizar
          </button>
          <button onClick={cerrarSesion} className="text-gray-400 hover:text-white p-2">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>

      {progresoMeta && (
        <div className="mb-4 px-4 py-3 rounded text-sm bg-indigo-900/40 border border-indigo-500 text-indigo-200">
          <div className="flex items-center gap-2 mb-2">
            <Loader className="w-4 h-4 animate-spin" />
            <span className="font-semibold">Extrayendo datos del PDF...</span>
          </div>
          <div className="flex gap-6 text-xs">
            <span>✅ Actualizados: <strong>{progresoMeta.actualizados}</strong></span>
            <span>⏳ Pendientes: <strong>{progresoMeta.restantes ?? '...'}</strong></span>
          </div>
        </div>
      )}

      {progresoIA && (
        <div className="mb-4 px-4 py-3 rounded text-sm bg-purple-900/40 border border-purple-500 text-purple-200">
          <div className="flex items-center gap-2 mb-2">
            <Loader className="w-4 h-4 animate-spin" />
            <span className="font-semibold">Categorizando con IA...</span>
          </div>
          <div className="flex gap-6 text-xs">
            <span>✅ Categorizados: <strong>{progresoIA.actualizados}</strong></span>
            <span>⏳ Pendientes: <strong>{progresoIA.restantes ?? '...'}</strong></span>
          </div>
        </div>
      )}

      {mensaje && (
        <div className={`mb-4 px-4 py-3 rounded text-sm ${mensaje.tipo === 'ok' ? 'bg-green-900/50 border border-green-500 text-green-300' : 'bg-red-900/50 border border-red-500 text-red-300'}`}>
          {mensaje.texto}
        </div>
      )}

      {/* Panel de estadísticas */}
      {stats && mostrando === 'lista' && (
        <div className="mb-6 bg-gray-800 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-300 mb-3">📊 Estado de descargas y conversión</h2>

          {/* Barra de progreso conversión */}
          <div className="mb-3">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>PDFs convertidos a imágenes</span>
              <span className="font-semibold text-white">{stats.convertidos.toLocaleString()} / {stats.total.toLocaleString()}</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div
                className="bg-crochet-primary h-2 rounded-full transition-all"
                style={{ width: `${stats.total > 0 ? Math.round((stats.convertidos / stats.total) * 100) : 0}%` }}
              />
            </div>
            <div className="flex justify-between text-xs mt-1">
              <span className="text-gray-500">{stats.pendientes.toLocaleString()} pendientes de convertir</span>
              <span className="text-crochet-primary font-semibold">{stats.total > 0 ? Math.round((stats.convertidos / stats.total) * 100) : 0}%</span>
            </div>
          </div>

          {/* Chips de resumen */}
          <div className="flex flex-wrap gap-2 text-xs mb-3">
            <span className="bg-gray-700 px-2 py-1 rounded">📥 {stats.archivosBot.toLocaleString()} PDFs en disco</span>
            <span className="bg-gray-700 px-2 py-1 rounded">✔ {stats.verificados.toLocaleString()} verificados</span>
            <span className="bg-gray-700 px-2 py-1 rounded">⭐ {stats.heroes}/12 hero</span>
            <span className="bg-gray-700 px-2 py-1 rounded">🔥 {stats.tendencia} en tendencia</span>
          </div>

          {/* Por categoría */}
          <div className="flex flex-wrap gap-1.5">
            {stats.porCategoria.map(c => (
              <span key={c.categoria} className="bg-gray-700/60 text-gray-300 text-xs px-2 py-0.5 rounded capitalize">
                {c.categoria} <strong>{c.n}</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Formulario nuevo patrón */}
      {mostrando === 'nuevo' && (
        <form onSubmit={handleSubir} className="bg-gray-800 rounded-xl p-6 mb-6 space-y-4">
          <h2 className="text-lg font-semibold mb-2">Subir nuevo patrón</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Título *</label>
              <input value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-crochet-primary" required />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Diseñadora *</label>
              <input value={form.diseñadora} onChange={e => setForm(f => ({ ...f, diseñadora: e.target.value }))}
                placeholder="Nombre de quien diseñó el patrón"
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-crochet-primary" />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Autor / Fuente</label>
            <input value={form.autor} onChange={e => setForm(f => ({ ...f, autor: e.target.value }))}
              placeholder="Blog, tienda, usuario de Ravelry, etc."
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-crochet-primary" />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Descripción</label>
            <textarea value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
              rows={3} className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-crochet-primary resize-none" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Categoría</label>
              <select value={form.categoria}
                onChange={e => setForm(f => ({ ...f, categoria: e.target.value, subcategoria: e.target.value === 'amigurumi' ? 'animales' : '' }))}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-crochet-primary">
                {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Dificultad</label>
              <select value={form.dificultad} onChange={e => setForm(f => ({ ...f, dificultad: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-crochet-primary">
                {DIFICULTADES.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Tiempo (minutos)</label>
              <input type="number" min="0" value={form.tiempo_minutos} onChange={e => setForm(f => ({ ...f, tiempo_minutos: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-crochet-primary" />
            </div>
          </div>

          {form.categoria === 'amigurumi' && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">Subcategoría amigurumi</label>
              <div className="flex flex-wrap gap-2">
                {SUBCATEGORIAS_AMIGURUMI.map(sub => (
                  <button key={sub} type="button"
                    onClick={() => setForm(f => ({ ...f, subcategoria: sub }))}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${form.subcategoria === sub ? 'bg-crochet-primary text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                    {sub}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <input type="checkbox" id="esPreview" checked={form.es_preview}
              onChange={e => setForm(f => ({ ...f, es_preview: e.target.checked }))}
              className="w-4 h-4 accent-crochet-primary" />
            <label htmlFor="esPreview" className="text-sm text-gray-300">
              Patrón gratuito del mes (preview)
            </label>
          </div>

          {/* Modo de subida */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Tipo de archivo</label>
            <div className="flex gap-2 mb-3">
              <button type="button" onClick={() => setModoSubida('pdf')}
                className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition ${modoSubida === 'pdf' ? 'bg-crochet-primary text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                <FileText className="w-4 h-4" /> PDF
              </button>
              <button type="button" onClick={() => setModoSubida('imagenes')}
                className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition ${modoSubida === 'imagenes' ? 'bg-crochet-primary text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                <Image className="w-4 h-4" /> Imágenes por página
              </button>
            </div>

            {modoSubida === 'pdf' ? (
              <div>
                <input ref={pdfRef} type="file" accept=".pdf" onChange={e => setArchivoPDF(e.target.files[0])}
                  className="w-full text-sm text-gray-400 file:mr-3 file:py-2 file:px-4 file:rounded file:border-0 file:bg-crochet-primary file:text-white file:cursor-pointer" />
                {archivoPDF && <p className="text-xs text-green-400 mt-1">{archivoPDF.name} ({(archivoPDF.size / 1024 / 1024).toFixed(1)} MB)</p>}
                <p className="text-xs text-gray-500 mt-1">Máx. 100 MB. Cada página del PDF se convierte a imagen automáticamente.</p>
              </div>
            ) : (
              <div>
                <input ref={imgRef} type="file" accept=".jpg,.jpeg,.png,.webp" multiple
                  onChange={e => setImagenesFiles(Array.from(e.target.files))}
                  className="w-full text-sm text-gray-400 file:mr-3 file:py-2 file:px-4 file:rounded file:border-0 file:bg-crochet-primary file:text-white file:cursor-pointer" />
                {imagenesFiles.length > 0 && <p className="text-xs text-green-400 mt-1">{imagenesFiles.length} imagen(es) seleccionada(s)</p>}
                <p className="text-xs text-gray-500 mt-1">Selecciona todas las páginas. Se ordenarán alfabéticamente por nombre de archivo.</p>
              </div>
            )}
          </div>

          <button type="submit" disabled={cargando}
            className="w-full btn-primary py-3 flex items-center justify-center gap-2 disabled:opacity-50">
            {cargando ? (
              <><Loader className="w-5 h-5 animate-spin" /> Procesando{modoSubida === 'pdf' ? ' PDF' : ' imágenes'}...</>
            ) : (
              <><Upload className="w-5 h-5" /> Subir patrón</>
            )}
          </button>
        </form>
      )}

      {/* Lista de patrones */}
      {mostrando === 'lista' && (
        <div className="space-y-3">
          {/* Buscador y filtros */}
          <div className="flex flex-col gap-2 mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={busquedaAdmin}
                onChange={e => setBusquedaAdmin(e.target.value)}
                placeholder="Buscar por título, diseñadora..."
                className="w-full bg-gray-800 border border-gray-700 rounded-full px-10 py-2 text-sm focus:outline-none focus:border-crochet-primary"
              />
              {busquedaAdmin && (
                <button onClick={() => setBusquedaAdmin('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap text-xs">
              {(() => {
                const heroCount = patrones.filter(p => p.destacado === 1).length;
                return heroCount > 0 && (
                  <span className={`px-2 py-1 rounded font-semibold ${heroCount >= 12 ? 'bg-yellow-600 text-white' : 'bg-gray-700 text-yellow-400'}`}>
                    ⭐ {heroCount}/12 hero{heroCount >= 12 ? ' — límite alcanzado' : ''}
                  </span>
                );
              })()}
            </div>
            <div className="flex gap-2 flex-wrap text-xs">
              {[
                { key: 'todos', label: 'Todos' },
                { key: 'hero', label: '⭐ Hero' },
                { key: 'tendencia', label: '🔥 Tendencia' },
                { key: 'gratis', label: '🎁 Gratis' },
                { key: 'ocultos', label: '🙈 Ocultos' },
              ].map(f => (
                <button key={f.key} onClick={() => setFiltroAdmin(f.key)}
                  className={`px-3 py-1.5 rounded-full font-medium transition ${filtroAdmin === f.key ? 'bg-crochet-primary text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {(() => {
            const q = busquedaAdmin.toLowerCase();
            const filtrados = patrones.filter(p => {
              const matchBusqueda = !q || p.titulo?.toLowerCase().includes(q) || p.diseñadora?.toLowerCase().includes(q) || p.autor?.toLowerCase().includes(q);
              const matchFiltro =
                filtroAdmin === 'todos' ? true :
                filtroAdmin === 'hero' ? p.destacado === 1 :
                filtroAdmin === 'tendencia' ? p.tendencia === 1 :
                filtroAdmin === 'gratis' ? p.es_preview === 1 :
                filtroAdmin === 'ocultos' ? !p.activo : true;
              return matchBusqueda && matchFiltro;
            });

            if (filtrados.length === 0) return (
              <div className="text-center py-12 text-gray-500">
                <p>No hay patrones con ese filtro.</p>
              </div>
            );

            return (
              <>
                <p className="text-xs text-gray-500 mb-2">{filtrados.length} de {patrones.length} patrones</p>
                {filtrados.map(p => (
              <div key={p.id} onClick={() => abrirEditor(p)} className={`bg-gray-800 rounded-lg p-4 flex items-center gap-4 cursor-pointer hover:bg-gray-750 transition ${!p.activo ? 'opacity-50' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm truncate">{p.titulo}</span>
                    {p.verificado === 1 && <span title="Verificado" className="text-blue-400">✔</span>}
                    {p.destacado === 1 && <span className="bg-yellow-600 text-xs px-1.5 py-0.5 rounded">HERO</span>}
                    {p.tendencia === 1 && <span className="bg-orange-600 text-xs px-1.5 py-0.5 rounded">TREND</span>}
                    {p.es_preview === 1 && <span className="bg-green-700 text-xs px-1.5 py-0.5 rounded">GRATIS</span>}
                    {!p.activo && <span className="bg-gray-600 text-xs px-1.5 py-0.5 rounded">OCULTO</span>}
                  </div>
                  <p className="text-xs text-gray-400">
                    {p.diseñadora || p.autor || '—'} · {p.categoria}{p.subcategoria ? ` / ${p.subcategoria}` : ''} · {p.dificultad} · {p.paginas} págs.
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                  {(() => {
                    const heroCount = patrones.filter(x => x.destacado === 1).length;
                    const bloqueado = !p.destacado && heroCount >= 12;
                    return (
                      <button onClick={() => !bloqueado && handleDestacar(p.id)}
                        title={bloqueado ? 'Límite de 12 heroes alcanzado' : p.destacado ? 'Quitar del hero' : 'Poner en hero'}
                        className={`p-2 transition ${p.destacado ? 'text-yellow-400 hover:text-yellow-200' : bloqueado ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:text-yellow-400'}`}>
                        <Star className="w-4 h-4" fill={p.destacado ? 'currentColor' : 'none'} />
                      </button>
                    );
                  })()}
                  <button onClick={() => handleTendencia(p.id)} title={p.tendencia ? 'Quitar de tendencia' : 'Poner en tendencia'}
                    className={`p-2 transition ${p.tendencia ? 'text-orange-400 hover:text-orange-200' : 'text-gray-400 hover:text-orange-400'}`}>
                    <Flame className="w-4 h-4" fill={p.tendencia ? 'currentColor' : 'none'} />
                  </button>
                  <button onClick={() => handleToggle(p.id)} title={p.activo ? 'Ocultar' : 'Publicar'}
                    className="p-2 text-gray-400 hover:text-white transition">
                    {p.activo ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                  <button onClick={() => handleEliminar(p.id, p.titulo)} title="Eliminar"
                    className="p-2 text-gray-400 hover:text-red-400 transition">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
              </>
            );
          })()}
        </div>
      )}

      {/* Panel lateral de edición */}
      {patronEditando && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/60" onClick={() => setPatronEditando(null)} />
          <div className="w-full max-w-sm bg-gray-900 border-l border-gray-700 flex flex-col overflow-y-auto">
            {/* Thumbnail */}
            <div className="relative bg-gray-800 shrink-0 flex items-center justify-center" style={{ minHeight: '13rem' }}>
              <img
                src={patronEditando.thumbnail_path || ''}
                alt={patronEditando.titulo}
                className="w-full object-contain max-h-72"
                onError={e => { e.currentTarget.style.display = 'none'; }}
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-2">
                <span className="text-4xl text-gray-700">📄</span>
                <span className="text-xs text-gray-600">Sin imagen aún</span>
              </div>
              <button onClick={() => setPatronEditando(null)}
                className="absolute top-3 right-3 bg-black/60 rounded-full p-1.5 text-gray-300 hover:text-white">
                <X className="w-4 h-4" />
              </button>
              <Link to={`/patron/${patronEditando.id}`} target="_blank"
                className="absolute top-3 left-3 bg-black/60 rounded-full p-1.5 text-gray-300 hover:text-white"
                title="Ver patrón completo">
                <ExternalLink className="w-4 h-4" />
              </Link>
              {patronEditando.verificado === 1 && (
                <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-blue-600/90 px-2 py-1 rounded-full text-xs font-bold text-white">
                  ✔ Verificado
                </div>
              )}
            </div>

            <div className="p-4 flex flex-col gap-4 flex-1">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Título</label>
                <input value={editForm.titulo} onChange={e => setEditForm(f => ({ ...f, titulo: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-crochet-primary" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Diseñadora</label>
                <input value={editForm.diseñadora} onChange={e => setEditForm(f => ({ ...f, diseñadora: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-crochet-primary" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Categoría</label>
                <select value={editForm.categoria} onChange={e => setEditForm(f => ({ ...f, categoria: e.target.value, subcategoria: '' }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-crochet-primary">
                  {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {editForm.categoria === 'amigurumi' && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Subcategoría</label>
                  <select value={editForm.subcategoria} onChange={e => setEditForm(f => ({ ...f, subcategoria: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-crochet-primary">
                    <option value="">— ninguna —</option>
                    {SUBCATEGORIAS_AMIGURUMI.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Dificultad</label>
                <select value={editForm.dificultad} onChange={e => setEditForm(f => ({ ...f, dificultad: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-crochet-primary">
                  {DIFICULTADES.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Descripción</label>
                <textarea value={editForm.descripcion} onChange={e => setEditForm(f => ({ ...f, descripcion: e.target.value }))}
                  rows={3} className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-crochet-primary resize-none" />
              </div>

              <div className="flex gap-2 mt-auto pt-2">
                <button onClick={guardarEdicion} disabled={guardando}
                  className="flex-1 btn-primary py-2 text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                  {guardando ? <Loader className="w-4 h-4 animate-spin" /> : null}
                  {guardando ? 'Guardando...' : 'Guardar'}
                </button>
                <button onClick={() => handleVerificar(patronEditando.id)}
                  className={`px-4 py-2 rounded text-sm font-semibold transition flex items-center gap-1.5 ${patronEditando.verificado ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 hover:bg-blue-700 text-gray-200'}`}>
                  ✔ {patronEditando.verificado ? 'Verificado' : 'Verificar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
