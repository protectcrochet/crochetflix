import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { Upload, Trash2, Eye, EyeOff, Plus, FileText, Image, Loader, LogOut, Download, Sparkles, Star, Flame, Search, X, ExternalLink, LayoutGrid, List, ChevronLeft, ChevronRight } from 'lucide-react';

const CATEGORIAS = ['amigurumi', 'ropa', 'accesorios', 'decoracion', 'hogar', 'otro'];
const SUBCATEGORIAS_AMIGURUMI = ['animales', 'personas y muñecos', 'comida', 'plantas y flores', 'personajes y fantasía', 'navidad', 'otro'];
const DIFICULTADES = ['principiante', 'intermedio', 'avanzado'];

const HANDLES = [
  { type: 'NW', cursor: 'nw-resize', style: { top: -6, left: -6 } },
  { type: 'N',  cursor: 'n-resize',  style: { top: -6, left: '50%', marginLeft: -6 } },
  { type: 'NE', cursor: 'ne-resize', style: { top: -6, right: -6 } },
  { type: 'W',  cursor: 'w-resize',  style: { top: '50%', left: -6, marginTop: -6 } },
  { type: 'E',  cursor: 'e-resize',  style: { top: '50%', right: -6, marginTop: -6 } },
  { type: 'SW', cursor: 'sw-resize', style: { bottom: -6, left: -6 } },
  { type: 'S',  cursor: 's-resize',  style: { bottom: -6, left: '50%', marginLeft: -6 } },
  { type: 'SE', cursor: 'se-resize', style: { bottom: -6, right: -6 } },
];

function HeroCropModal({ patron, authHeader, onClose }) {
  const imgRef = useRef(null);
  const dragRef = useRef(null);
  const dimsRef = useRef({ w: 0, h: 0 });
  const cropRef = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const [crop, _setCrop] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [guardando, setGuardando] = useState(false);
  const MIN = 40;

  const setCrop = useCallback((v) => {
    const next = typeof v === 'function' ? v(cropRef.current) : v;
    cropRef.current = next;
    _setCrop(next);
  }, []);

  const clamp = useCallback((c) => {
    const { w: dw, h: dh } = dimsRef.current;
    const x = Math.max(0, Math.min(dw - MIN, c.x));
    const y = Math.max(0, Math.min(dh - MIN, c.y));
    return { x, y, w: Math.max(MIN, Math.min(dw - x, c.w)), h: Math.max(MIN, Math.min(dh - y, c.h)) };
  }, []);

  const onImgLoad = useCallback(() => {
    if (!imgRef.current) return;
    const r = imgRef.current.getBoundingClientRect();
    const w = r.width, h = r.height;
    dimsRef.current = { w, h };
    setDims({ w, h });
    const parts = (patron.hero_position || '').split(' ');
    if (parts.length >= 4) {
      setCrop({
        x: parseFloat(parts[0]) / 100 * w,
        y: parseFloat(parts[1]) / 100 * h,
        w: parseFloat(parts[2]) / 100 * w,
        h: parseFloat(parts[3]) / 100 * h,
      });
    } else {
      const cw = w * 0.85, ch = cw / (16 / 7);
      setCrop({ x: (w - cw) / 2, y: Math.max(0, (h - ch) / 2), w: cw, h: Math.min(ch, h) });
    }
  }, [patron.hero_position, setCrop]);

  const startDrag = useCallback((type) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    dragRef.current = { type, sx: cx, sy: cy, sc: { ...cropRef.current } };
  }, []);

  const onMove = useCallback((e) => {
    if (!dragRef.current) return;
    if (e.cancelable) e.preventDefault();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    const dx = cx - dragRef.current.sx, dy = cy - dragRef.current.sy;
    const { type, sc } = dragRef.current;
    let n = { ...sc };
    if (type === 'move') { n.x = sc.x + dx; n.y = sc.y + dy; }
    else {
      if (type.includes('W')) { n.x = sc.x + dx; n.w = sc.w - dx; }
      if (type.includes('E')) { n.w = sc.w + dx; }
      if (type.includes('N')) { n.y = sc.y + dy; n.h = sc.h - dy; }
      if (type.includes('S')) { n.h = sc.h + dy; }
    }
    setCrop(clamp(n));
  }, [clamp, setCrop]);

  const stopDrag = useCallback(() => { dragRef.current = null; }, []);

  useEffect(() => {
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', stopDrag);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', stopDrag);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', stopDrag);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', stopDrag);
    };
  }, [onMove, stopDrag]);

  const xPct = dims.w > 0 ? Math.round(crop.x / dims.w * 100) : 0;
  const yPct = dims.h > 0 ? Math.round(crop.y / dims.h * 100) : 0;
  const wPct = dims.w > 0 ? Math.round(crop.w / dims.w * 100) : 100;
  const hPct = dims.h > 0 ? Math.round(crop.h / dims.h * 100) : 100;

  // Preview background: scale image so crop fills container, offset to crop origin
  const bsX = wPct > 0 ? 100 / wPct * 100 : 100;
  const bsY = hPct > 0 ? 100 / hPct * 100 : 100;
  const bpX = wPct < 100 ? xPct / (100 - wPct) * 100 : 0;
  const bpY = hPct < 100 ? yPct / (100 - hPct) * 100 : 0;

  const guardar = async () => {
    setGuardando(true);
    try {
      await api.patch(`/admin/patrones/${patron.id}/hero-position`,
        { hero_position: `${xPct} ${yPct} ${wPct} ${hPct}` }, { headers: authHeader });
      onClose();
    } catch { setGuardando(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex flex-col" style={{ touchAction: 'none' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700 shrink-0">
        <div>
          <p className="font-bold text-sm">Encuadrar en el hero</p>
          <p className="text-gray-400 text-xs">Arrastra el recuadro · usa los handles de esquina para redimensionar</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl w-10 h-10 flex items-center justify-center">✕</button>
      </div>

      {/* Dos paneles */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">

        {/* Panel izquierdo — imagen con crop handles (scrollable) */}
        <div className="h-[55vh] lg:h-auto lg:flex-1 overflow-y-auto overflow-x-hidden bg-black">
          <div className="relative select-none">
            <img
              ref={imgRef}
              src={patron.thumbnail_path || ''}
              alt={patron.titulo}
              className="w-full h-auto block"
              onLoad={onImgLoad}
              draggable={false}
            />

            {/* Overlay exterior al crop (4 barras) — no sangra fuera del panel */}
            {dims.w > 0 && (
              <>
                <div className="absolute pointer-events-none bg-black/55"
                  style={{ left: 0, top: 0, right: 0, height: crop.y }} />
                <div className="absolute pointer-events-none bg-black/55"
                  style={{ left: 0, top: crop.y + crop.h, right: 0, bottom: 0 }} />
                <div className="absolute pointer-events-none bg-black/55"
                  style={{ left: 0, top: crop.y, width: crop.x, height: crop.h }} />
                <div className="absolute pointer-events-none bg-black/55"
                  style={{ left: crop.x + crop.w, top: crop.y, right: 0, height: crop.h }} />
              </>
            )}

            {/* Recuadro de crop */}
            {dims.w > 0 && (
              <div
                className="absolute border-2 border-white cursor-move"
                style={{ left: crop.x, top: crop.y, width: crop.w, height: crop.h, touchAction: 'none' }}
                onMouseDown={startDrag('move')}
                onTouchStart={startDrag('move')}
              >
                {/* Guías de tercios */}
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute left-1/3 top-0 bottom-0 border-l border-white/25" />
                  <div className="absolute left-2/3 top-0 bottom-0 border-l border-white/25" />
                  <div className="absolute top-1/3 left-0 right-0 border-t border-white/25" />
                  <div className="absolute top-2/3 left-0 right-0 border-t border-white/25" />
                </div>
                {/* Handles */}
                {HANDLES.map(({ type, cursor, style }) => (
                  <div
                    key={type}
                    className="absolute w-4 h-4 bg-white rounded-sm z-10"
                    style={{ ...style, cursor, touchAction: 'none', position: 'absolute',
                      boxShadow: '0 0 0 1px rgba(0,0,0,0.5)' }}
                    onMouseDown={startDrag(type)}
                    onTouchStart={startDrag(type)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Panel derecho — preview + sliders + botones */}
        <div className="flex-1 lg:flex-none lg:w-80 bg-gray-900 border-t lg:border-t-0 lg:border-l border-gray-700 flex flex-col gap-3 p-3 overflow-y-auto shrink-0">
          <p className="text-xs font-semibold text-gray-300 shrink-0">Vista previa hero:</p>

          {/* Preview */}
          <div
            className="relative rounded overflow-hidden bg-gray-800 shrink-0"
            style={{
              aspectRatio: '16/7',
              backgroundImage: `url(${patron.thumbnail_path || ''})`,
              backgroundSize: `${bsX}% ${bsY}%`,
              backgroundPosition: `${bpX}% ${bpY}%`,
              backgroundRepeat: 'no-repeat',
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
            <div className="absolute bottom-1.5 left-3 pointer-events-none">
              <p className="font-bold text-white text-xs">{patron.titulo}</p>
            </div>
          </div>

          {/* Sliders para ajuste fino */}
          {dims.w > 0 && (
            <div className="space-y-2 shrink-0">
              <p className="text-xs text-gray-500">Ajuste fino:</p>
              {[
                { label: '← X →', min: 0, max: Math.max(1, dims.w - crop.w), val: crop.x, key: 'x' },
                { label: '↑ Y ↓', min: 0, max: Math.max(1, dims.h - crop.h), val: crop.y, key: 'y' },
                { label: '↔ Ancho', min: MIN, max: dims.w, val: crop.w, key: 'w' },
                { label: '↕ Alto',  min: MIN, max: dims.h, val: crop.h, key: 'h' },
              ].map(({ label, min, max, val, key }) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-14 shrink-0">{label}</span>
                  <input
                    type="range" min={min} max={max} step="1"
                    value={Math.round(val)}
                    onChange={e => setCrop(c => clamp({ ...c, [key]: +e.target.value }))}
                    className="flex-1 accent-red-500"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Botones */}
          <div className="flex gap-2 justify-end mt-auto shrink-0">
            <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg transition">Cancelar</button>
            <button onClick={guardar} disabled={guardando}
              className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 rounded-lg transition font-semibold disabled:opacity-50">
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Modo Visor: edición rápida ──────────────────────────────────────────────
function VisorEditModal({ patron, idx, total, authHeader, onGuardado, onNext, onPrev, onClose }) {
  const [form, setForm] = useState({
    titulo: patron.titulo || '',
    diseñadora: patron.diseñadora || '',
    categoria: patron.categoria || 'amigurumi',
    subcategoria: patron.subcategoria || '',
    dificultad: patron.dificultad || 'principiante',
  });
  const [guardando, setGuardando] = useState(false);

  // Sync form when patron changes (next/prev)
  useEffect(() => {
    setForm({
      titulo: patron.titulo || '',
      diseñadora: patron.diseñadora || '',
      categoria: patron.categoria || 'amigurumi',
      subcategoria: patron.subcategoria || '',
      dificultad: patron.dificultad || 'principiante',
    });
  }, [patron.id]);

  const guardar = useCallback(async (luego) => {
    setGuardando(true);
    try {
      await api.patch(`/admin/patrones/${patron.id}`, form, { headers: authHeader });
      onGuardado(patron.id, form);
      if (luego === 'next') onNext();
      else if (luego === 'prev') onPrev();
      else onClose();
    } catch { alert('Error guardando'); }
    finally { setGuardando(false); }
  }, [patron.id, form, authHeader, onGuardado, onNext, onPrev, onClose]);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); guardar('next'); }
      if (e.key === 'ArrowRight' && !e.target.matches('input,select,textarea')) guardar('next');
      if (e.key === 'ArrowLeft'  && !e.target.matches('input,select,textarea')) guardar('prev');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [guardar, onClose]);

  return (
    <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-3">
      <div className="bg-gray-900 rounded-xl w-full max-w-2xl flex flex-col overflow-hidden shadow-2xl"
        style={{ maxHeight: '95vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700 shrink-0">
          <span className="text-xs text-gray-400 font-mono">{idx + 1} / {total}</span>
          <span className="text-xs text-gray-500 truncate max-w-xs">{patron.id}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-white ml-2">✕</button>
        </div>

        {/* Imagen + Formulario */}
        <div className="flex flex-1 min-h-0">
          {/* Imagen */}
          <div className="w-1/2 bg-black flex items-center justify-center overflow-hidden shrink-0">
            {patron.thumbnail_path
              ? <img src={patron.thumbnail_path} alt="" className="max-w-full max-h-full object-contain" />
              : <span className="text-gray-600 text-sm">Sin imagen</span>}
          </div>

          {/* Form */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Título</label>
              <input value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:border-crochet-primary focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Diseñadora</label>
              <input value={form.diseñadora} onChange={e => setForm(f => ({ ...f, diseñadora: e.target.value }))}
                placeholder="Diseñadora"
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:border-crochet-primary focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Categoría</label>
              <select value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value, subcategoria: '' }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none">
                {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {form.categoria === 'amigurumi' && (
              <div>
                <label className="text-xs text-gray-400 block mb-1">Subcategoría</label>
                <select value={form.subcategoria} onChange={e => setForm(f => ({ ...f, subcategoria: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none">
                  <option value="">— ninguna —</option>
                  {SUBCATEGORIAS_AMIGURUMI.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="text-xs text-gray-400 block mb-1">Dificultad</label>
              <select value={form.dificultad} onChange={e => setForm(f => ({ ...f, dificultad: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none">
                {DIFICULTADES.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <p className="text-xs text-gray-600 pt-1">Ctrl+S / → Guardar y siguiente · Esc Cerrar</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-4 py-3 border-t border-gray-700 shrink-0">
          <button onClick={() => guardar('prev')} disabled={guardando || idx === 0}
            className="flex items-center gap-1 px-3 py-2 text-sm bg-gray-800 hover:bg-gray-700 rounded transition disabled:opacity-30">
            <ChevronLeft className="w-4 h-4" /> Anterior
          </button>
          <button onClick={() => guardar(null)} disabled={guardando}
            className="flex-1 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded transition">
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
          <button onClick={() => guardar('next')} disabled={guardando || idx === total - 1}
            className="flex items-center gap-1 px-3 py-2 text-sm bg-crochet-primary hover:opacity-90 rounded transition font-semibold disabled:opacity-30">
            Siguiente <ChevronRight className="w-4 h-4" />
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
  const [visorIdx, setVisorIdx] = useState(null); // null = visor cerrado, number = índice abierto

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
    try {
      const res = await api.post('/admin/patrones/extraer-metadatos-fondo', {}, { headers: authHeader });
      setMensaje({ tipo: 'ok', texto: res.data.message });
      setTimeout(() => setMensaje(null), 4000);
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.response?.data?.error || 'Error' });
    }
  };

  const categorizarConIA = async () => {
    try {
      const res = await api.post('/admin/patrones/categorizar-fondo', {}, { headers: authHeader });
      setMensaje({ tipo: 'ok', texto: res.data.message });
      setTimeout(() => setMensaje(null), 4000);
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.response?.data?.error || 'Error' });
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

  const handleCorrupto = async (id) => {
    await api.patch(`/admin/patrones/${id}/corrupto`, {}, { headers: authHeader });
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
          <button onClick={extraerMetadatos} disabled={stats?.metadatosRunning} title="Extrae título, diseñadora e idioma con IA (corre en el servidor)"
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-700 hover:bg-indigo-600 rounded text-sm text-white transition disabled:opacity-50">
            {stats?.metadatosRunning ? <Loader className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {stats?.metadatosRunning ? 'Extrayendo…' : 'Extraer datos PDF'}
          </button>
          <button onClick={categorizarConIA} disabled={stats?.categoriasRunning} title="Categorizar patrones con IA (corre en el servidor)"
            className="flex items-center gap-1.5 px-3 py-2 bg-purple-700 hover:bg-purple-600 rounded text-sm text-white transition disabled:opacity-50">
            {stats?.categoriasRunning ? <Loader className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {stats?.categoriasRunning ? 'Categorizando…' : 'Categorizar IA'}
          </button>
          <button onClick={async () => {
              setCargando(true);
              try {
                const res = await api.post('/admin/patrones/reparar-thumbnails', {}, { headers: authHeader });
                setMensaje({ tipo: 'ok', texto: res.data.message });
                cargarPatrones();
              } catch (err) {
                setMensaje({ tipo: 'error', texto: err.response?.data?.error || 'Error' });
              } finally { setCargando(false); }
            }} disabled={cargando} title="Busca thumbnails rotos y los repara automáticamente"
            className="flex items-center gap-1.5 px-3 py-2 bg-orange-700 hover:bg-orange-600 rounded text-sm text-white transition disabled:opacity-50">
            {cargando ? <Loader className="w-4 h-4 animate-spin" /> : <Image className="w-4 h-4" />}
            Reparar imágenes
          </button>
          <button onClick={normalizarCategorias} disabled={cargando} title="Corrige mayúsculas en categorías"
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-600 hover:bg-gray-500 rounded text-sm text-white transition disabled:opacity-50">
            Fix categorías
          </button>
          <button onClick={async () => {
              setCargando(true);
              try {
                const res = await api.post('/admin/patrones/fix-autor', {}, { headers: authHeader });
                setMensaje({ tipo: 'ok', texto: res.data.message });
                cargarPatrones();
              } catch (err) {
                setMensaje({ tipo: 'error', texto: err.response?.data?.error || 'Error' });
              } finally { setCargando(false); }
            }} disabled={cargando} title='Cambia "Telegram" → "Diseñadora" y "N/A" → "Diseñadora"'
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-600 hover:bg-gray-500 rounded text-sm text-white transition disabled:opacity-50">
            Fix autor
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

      {stats?.metadatosRunning && (
        <div className="mb-4 px-4 py-3 rounded text-sm bg-indigo-900/40 border border-indigo-500 text-indigo-200">
          <div className="flex items-center gap-2 mb-1">
            <Loader className="w-4 h-4 animate-spin" />
            <span className="font-semibold">Extrayendo datos PDF en el servidor…</span>
          </div>
          <div className="flex gap-6 text-xs">
            <span>✅ Actualizados: <strong>{stats.metadatosProgreso?.actualizados ?? 0}</strong></span>
            <span>⏳ Pendientes: <strong>{stats.metadatosProgreso?.restantes ?? '...'}</strong></span>
          </div>
        </div>
      )}

      {stats?.categoriasRunning && (
        <div className="mb-4 px-4 py-3 rounded text-sm bg-purple-900/40 border border-purple-500 text-purple-200">
          <div className="flex items-center gap-2 mb-1">
            <Loader className="w-4 h-4 animate-spin" />
            <span className="font-semibold">Categorizando con IA en el servidor…</span>
          </div>
          <div className="flex gap-6 text-xs">
            <span>✅ Categorizados: <strong>{stats.categoriasProgreso?.actualizados ?? 0}</strong></span>
            <span>⏳ Pendientes: <strong>{stats.categoriasProgreso?.restantes ?? '...'}</strong></span>
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
              <span className="text-gray-500">
                {stats.pendientes.toLocaleString()} pendientes
                {stats.corruptos > 0 && <span className="text-red-400 ml-2">· {stats.corruptos} con error (PDF dañado)</span>}
              </span>
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
                { key: 'corruptos', label: '⚠ Con error' },
              ].map(f => (
                <button key={f.key} onClick={() => setFiltroAdmin(f.key)}
                  className={`px-3 py-1.5 rounded-full font-medium transition ${filtroAdmin === f.key ? (f.key === 'corruptos' ? 'bg-red-600 text-white' : 'bg-crochet-primary text-white') : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setVisorIdx(visorIdx === null ? 0 : null)}
                title="Modo visor: edita rápido mientras ves las imágenes"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition ${visorIdx !== null ? 'bg-crochet-primary text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
                <LayoutGrid className="w-3.5 h-3.5" />
                Modo visor
              </button>
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
                filtroAdmin === 'ocultos' ? !p.activo :
                filtroAdmin === 'corruptos' ? (p.pdf_corrupto === 1 && p.paginas === 0) : true;
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

                {visorIdx !== null ? (
                  /* ── MODO VISOR: cuadrícula de miniaturas ── */
                  <>
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                      {filtrados.map((p, i) => (
                        <button
                          key={p.id}
                          onClick={() => setVisorIdx(i)}
                          className={`relative aspect-[3/4] rounded overflow-hidden bg-gray-800 focus:outline-none ring-2 transition ${i === visorIdx ? 'ring-crochet-primary' : 'ring-transparent hover:ring-gray-500'}`}
                        >
                          {p.thumbnail_path ? (
                            <img src={p.thumbnail_path} alt={p.titulo} className="w-full h-full object-cover" loading="lazy"
                              onError={e => { e.currentTarget.style.display = 'none'; }} />
                          ) : (
                            <span className="absolute inset-0 flex items-center justify-center text-2xl text-gray-600">📄</span>
                          )}
                          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-1">
                            <p className="text-white text-[10px] leading-tight line-clamp-2">{p.titulo}</p>
                          </div>
                          {!p.activo && <div className="absolute inset-0 bg-black/50" />}
                          {p.pdf_corrupto === 1 && p.paginas === 0 && (
                            <span className="absolute top-1 right-1 bg-red-700 text-white text-[9px] px-1 rounded">ERR</span>
                          )}
                        </button>
                      ))}
                    </div>

                    <VisorEditModal
                      patron={filtrados[Math.min(visorIdx, filtrados.length - 1)]}
                      idx={Math.min(visorIdx, filtrados.length - 1)}
                      total={filtrados.length}
                      authHeader={{ 'x-admin-secret': adminSecret }}
                      onGuardado={(id, form) => setPatrones(prev => prev.map(p => p.id === id ? { ...p, ...form } : p))}
                      onNext={() => setVisorIdx(i => Math.min(filtrados.length - 1, i + 1))}
                      onPrev={() => setVisorIdx(i => Math.max(0, i - 1))}
                      onClose={() => setVisorIdx(null)}
                    />
                  </>
                ) : (
                  /* ── MODO LISTA: vista normal ── */
                  filtrados.map(p => (
                    <div key={p.id} onClick={() => abrirEditor(p)} className={`bg-gray-800 rounded-lg p-4 flex items-center gap-4 cursor-pointer hover:bg-gray-750 transition ${!p.activo ? 'opacity-50' : ''}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm truncate">{p.titulo}</span>
                          {p.verificado === 1 && <span title="Verificado" className="text-blue-400">✔</span>}
                          {p.destacado === 1 && <span className="bg-yellow-600 text-xs px-1.5 py-0.5 rounded">HERO</span>}
                          {p.tendencia === 1 && <span className="bg-orange-600 text-xs px-1.5 py-0.5 rounded">TREND</span>}
                          {p.es_preview === 1 && <span className="bg-green-700 text-xs px-1.5 py-0.5 rounded">GRATIS</span>}
                          {!p.activo && <span className="bg-gray-600 text-xs px-1.5 py-0.5 rounded">OCULTO</span>}
                          {p.pdf_corrupto === 1 && p.paginas === 0 && <span className="bg-red-800 text-xs px-1.5 py-0.5 rounded" title={`${p.conversion_intentos} intentos fallidos`}>ERROR PDF</span>}
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
                        {p.pdf_corrupto === 1 && p.paginas === 0 && (
                          <button onClick={() => handleCorrupto(p.id)} title="Reintentar conversión"
                            className="p-2 text-red-400 hover:text-green-400 transition text-xs font-bold">↺</button>
                        )}
                        <button onClick={() => handleEliminar(p.id, p.titulo)} title="Eliminar"
                          className="p-2 text-gray-400 hover:text-red-400 transition">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
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
