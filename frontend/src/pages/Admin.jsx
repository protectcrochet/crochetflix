import { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import { Upload, Trash2, Eye, EyeOff, Plus, FileText, Image, Loader, LogOut, Download, Sparkles } from 'lucide-react';

const CATEGORIAS = ['amigurumi', 'ropa', 'accesorios', 'decoracion', 'hogar', 'otro'];
const SUBCATEGORIAS_AMIGURUMI = ['animales', 'personas y muñecos', 'comida', 'plantas y flores', 'personajes y fantasía', 'navidad', 'otro'];
const DIFICULTADES = ['principiante', 'intermedio', 'avanzado'];

export default function Admin() {
  const [secret, setSecret] = useState(() => localStorage.getItem('admin_secret') || '');
  const [autenticado, setAutenticado] = useState(false);
  const [patrones, setPatrones] = useState([]);
  const [mostrando, setMostrando] = useState('lista'); // 'lista' | 'nuevo'
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState(null); // { tipo: 'ok'|'error', texto }

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
      const res = await api.get('/admin/patrones', { headers: authHeader });
      setPatrones(res.data.patrones);
    } catch {
      setMensaje({ tipo: 'error', texto: 'Error cargando patrones' });
    }
  };

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

  const categorizarConIA = async () => {
    setCargando(true);
    setMensaje(null);
    try {
      const res = await api.post('/admin/patrones/categorizar', {}, { headers: authHeader, timeout: 120000 });
      setMensaje({ tipo: 'ok', texto: res.data.message });
      cargarPatrones();
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.response?.data?.error || 'Error categorizando' });
    } finally {
      setCargando(false);
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
    <div className="min-h-screen bg-gray-950 px-4 py-6 max-w-4xl mx-auto">
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
          <button onClick={categorizarConIA} disabled={cargando} title="Categorizar patrones automáticamente con IA (lotes de 50)"
            className="flex items-center gap-1.5 px-3 py-2 bg-purple-700 hover:bg-purple-600 rounded text-sm text-white transition disabled:opacity-50">
            {cargando ? <Loader className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Categorizar IA
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

      {mensaje && (
        <div className={`mb-4 px-4 py-3 rounded text-sm ${mensaje.tipo === 'ok' ? 'bg-green-900/50 border border-green-500 text-green-300' : 'bg-red-900/50 border border-red-500 text-red-300'}`}>
          {mensaje.texto}
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
          {patrones.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <p>No hay patrones todavía.</p>
              <button onClick={() => setMostrando('nuevo')} className="btn-primary mt-4">Subir el primero</button>
            </div>
          ) : (
            patrones.map(p => (
              <div key={p.id} className={`bg-gray-800 rounded-lg p-4 flex items-center gap-4 ${!p.activo ? 'opacity-50' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm truncate">{p.titulo}</span>
                    {p.es_preview === 1 && <span className="bg-green-700 text-xs px-1.5 py-0.5 rounded">GRATIS</span>}
                    {!p.activo && <span className="bg-gray-600 text-xs px-1.5 py-0.5 rounded">OCULTO</span>}
                  </div>
                  <p className="text-xs text-gray-400">
                    {p.diseñadora || p.autor || '—'} · {p.categoria}{p.subcategoria ? ` / ${p.subcategoria}` : ''} · {p.dificultad} · {p.paginas} págs.
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
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
            ))
          )}
        </div>
      )}
    </div>
  );
}
