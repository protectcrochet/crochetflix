import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { Upload, Trash2, Eye, EyeOff, Plus, FileText, Image, Loader, LogOut, Download, Sparkles, Star, Flame, Search, X, ExternalLink, LayoutGrid, List, ChevronLeft, ChevronRight, ShieldCheck } from 'lucide-react';

const CATEGORIAS = ['amigurumi', 'ropa', 'accesorios', 'decoracion', 'hogar', 'otro'];
const SUBCATEGORIAS_AMIGURUMI = ['animales', 'personas y muñecos', 'comida', 'plantas y flores', 'personajes y fantasía', 'navidad', 'otro'];
const DIFICULTADES = ['principiante', 'intermedio', 'avanzado'];
const IDIOMAS = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'Inglés' },
  { value: 'pt', label: 'Portugués' },
  { value: 'fr', label: 'Francés' },
  { value: 'de', label: 'Alemán' },
  { value: 'it', label: 'Italiano' },
  { value: 'otro', label: 'Otro' },
];

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
function VisorEditModal({ patron, idx, total, authHeader, onGuardado, onNext, onPrev, onJump, onClose }) {
  const [form, setForm] = useState({
    titulo: patron.titulo || '',
    diseñadora: patron.diseñadora || '',
    categoria: patron.categoria || 'amigurumi',
    subcategoria: patron.subcategoria || '',
    dificultad: patron.dificultad || 'principiante',
    idioma: patron.idioma || 'es',
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
      idioma: patron.idioma || 'es',
    });
  }, [patron.id]);

  const hayCambios = form.titulo !== (patron.titulo || '') ||
    form.diseñadora !== (patron.diseñadora || '') ||
    form.categoria !== (patron.categoria || 'amigurumi') ||
    form.subcategoria !== (patron.subcategoria || '') ||
    form.dificultad !== (patron.dificultad || 'principiante') ||
    form.idioma !== (patron.idioma || 'es');

  const guardar = useCallback(async (luego) => {
    if (hayCambios) {
      setGuardando(true);
      try {
        await api.patch(`/admin/patrones/${patron.id}`, form, { headers: authHeader });
        onGuardado(patron.id, form);
      } catch { alert('Error guardando'); setGuardando(false); return; }
      setGuardando(false);
    }
    if (luego === 'next') onNext();
    else if (luego === 'prev') onPrev();
    else onClose();
  }, [patron.id, form, hayCambios, authHeader, onGuardado, onNext, onPrev, onClose]);

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
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-700 shrink-0">
          <span className="text-xs text-gray-400 font-mono shrink-0">
            <input
              type="number" min={1} max={total}
              value={idx + 1}
              onChange={e => {
                const n = parseInt(e.target.value) - 1;
                if (!isNaN(n) && n >= 0 && n < total) onJump(n);
              }}
              className="w-14 bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-xs text-center focus:outline-none focus:border-crochet-primary"
            />
            <span className="ml-1">/ {total}</span>
          </span>
          <span className="text-xs text-gray-500 truncate flex-1 text-center">{patron.id}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-white shrink-0">✕</button>
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
            <div>
              <label className="text-xs text-gray-400 block mb-1">Idioma</label>
              <select value={form.idioma} onChange={e => setForm(f => ({ ...f, idioma: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none">
                {IDIOMAS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
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

const STATUS_LABELS = { pending: 'Pendiente', reviewing: 'En revisión', resolved: 'Resuelto', rejected: 'Rechazado' };
const STATUS_COLORS = { pending: 'bg-yellow-700', reviewing: 'bg-blue-700', resolved: 'bg-green-700', rejected: 'bg-gray-600' };

function DmcaClaimCard({ claim, authHeader, onUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState(claim.admin_notes || '');
  const [saving, setSaving] = useState(false);

  const update = async (status, restore_patron = false) => {
    setSaving(true);
    try {
      await api.patch(`/admin/dmca/${claim.id}`, { status, admin_notes: notes, restore_patron }, { headers: authHeader });
      onUpdate({ status, admin_notes: notes });
    } catch { alert('Error'); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 space-y-2">
      <div className="flex items-start justify-between gap-3 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded font-semibold ${STATUS_COLORS[claim.status] || 'bg-gray-600'}`}>
              {STATUS_LABELS[claim.status] || claim.status}
            </span>
            <span className="font-semibold text-sm truncate">{claim.claimant_name}</span>
            <span className="text-gray-400 text-xs">{claim.claimant_email}</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">{new Date(claim.created_at).toLocaleString('es-MX')}</p>
        </div>
        <span className="text-gray-400 text-xs mt-1">{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div className="space-y-3 pt-2 border-t border-gray-700 text-sm">
          {claim.claimant_company && <p><span className="text-gray-400">Empresa:</span> {claim.claimant_company}</p>}
          <div><p className="text-gray-400 text-xs mb-0.5">Obra reclamada:</p><p className="text-gray-200">{claim.work_description}</p></div>
          <div><p className="text-gray-400 text-xs mb-0.5">URLs infractoras:</p><p className="font-mono text-xs text-gray-300 whitespace-pre-wrap">{claim.infringing_urls}</p></div>
          {claim.patron_id && <p><span className="text-gray-400">Patrón ID:</span> <span className="font-mono text-xs">{claim.patron_id}</span></p>}
          {claim.registro_obra && <p><span className="text-gray-400">Registro (INDAUTOR/ISBN):</span> <span className="font-mono text-xs text-yellow-300">{claim.registro_obra}</span></p>}
          {claim.proof_url && <div><p className="text-gray-400 text-xs mb-0.5">Prueba de autoría:</p><a href={claim.proof_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline text-xs break-all">{claim.proof_url}</a></div>}
          <p><span className="text-gray-400">IP:</span> {claim.ip_address}</p>
          <p><span className="text-gray-400">Firma:</span> {claim.signature}</p>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Notas internas</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none" />
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => update('reviewing')} disabled={saving}
              className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 rounded text-xs font-semibold disabled:opacity-50">En revisión</button>
            <button onClick={() => update('resolved')} disabled={saving}
              className="px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded text-xs font-semibold disabled:opacity-50">Resuelto (retirar)</button>
            <button onClick={() => update('rejected', true)} disabled={saving}
              className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 rounded text-xs font-semibold disabled:opacity-50">Rechazar (restaurar patrón)</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Admin() {
  const [secret, setSecret] = useState(() => localStorage.getItem('admin_secret') || '');
  const [autenticado, setAutenticado] = useState(false);
  const [patrones, setPatrones] = useState([]);
  const [mostrando, setMostrando] = useState('lista'); // 'lista' | 'nuevo' | 'dmca' | 'analytics'
  const [dmcaClaims, setDmcaClaims] = useState([]);
  const [dmcaCargando, setDmcaCargando] = useState(false);
  const [analytics, setAnalytics] = useState(null);
  const [analyticsCargando, setAnalyticsCargando] = useState(false);
  const [usuarios, setUsuarios] = useState(null);
  const [usuariosCargando, setUsuariosCargando] = useState(false);
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
  const [usuarioDetalle, setUsuarioDetalle] = useState(null);
  const [usuarioDetalleCargando, setUsuarioDetalleCargando] = useState(false);

  const [form, setForm] = useState({
    titulo: '', descripcion: '', autor: '', diseñadora: '',
    categoria: 'amigurumi', subcategoria: 'animales', dificultad: 'principiante',
    idioma: 'es', tiempo_minutos: '', es_preview: false,
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

  useEffect(() => {
    if (!autenticado) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('share') !== '1') return;
    window.history.replaceState({}, '', '/admin');
    caches.open('crochetflix-share').then(cache => {
      cache.match('/shared-pdf').then(async response => {
        if (!response) return;
        const blob = await response.blob();
        const nombre = response.headers.get('X-Filename') || 'patron.pdf';
        const file = new File([blob], nombre, { type: 'application/pdf' });
        setArchivoPDF(file);
        setMostrando('nuevo');
        cache.delete('/shared-pdf');
        setMensaje({ tipo: 'ok', texto: `PDF "${nombre}" listo para subir` });
      });
    });
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

  const extraerGroq = async () => {
    try {
      const res = await api.post('/admin/patrones/extraer-metadatos-groq', {}, { headers: authHeader });
      setMensaje({ tipo: 'ok', texto: res.data.message });
      setTimeout(() => setMensaje(null), 4000);
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.response?.data?.error || 'Error' });
    }
  };

  const extraerOpenAI = async (force = false) => {
    if (force && !confirm('¿Limpiar títulos de TODOS los patrones con nombres sucios? Puede tardar horas y consumir créditos de OpenAI.')) return;
    try {
      const res = await api.post('/admin/patrones/extraer-metadatos-openai', { force }, { headers: authHeader });
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
      idioma: p.idioma || 'es',
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
      setForm({ titulo: '', descripcion: '', autor: '', diseñadora: '', categoria: 'amigurumi', subcategoria: 'animales', dificultad: 'principiante', idioma: 'es', tiempo_minutos: '', es_preview: false });
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
          <button onClick={extraerMetadatos} disabled={stats?.metadatosRunning} title="Extrae título, diseñadora e idioma con Claude Haiku (corre en el servidor)"
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-700 hover:bg-indigo-600 rounded text-sm text-white transition disabled:opacity-50">
            {stats?.metadatosRunning ? <Loader className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {stats?.metadatosRunning ? 'Extrayendo…' : 'Extraer datos PDF'}
          </button>
          <button onClick={extraerGroq} disabled={stats?.groqRunning} title="Extrae título, diseñadora e idioma con Groq/Llama (gratis)"
            className="flex items-center gap-1.5 px-3 py-2 bg-teal-700 hover:bg-teal-600 rounded text-sm text-white transition disabled:opacity-50">
            {stats?.groqRunning ? <Loader className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {stats?.groqRunning ? 'Groq…' : 'Groq ✨'}
          </button>
          <button onClick={() => extraerOpenAI(false)} disabled={stats?.openaiRunning} title="Extrae título y diseñadora con GPT-4o-mini (solo pendientes)"
            className="flex items-center gap-1.5 px-3 py-2 bg-green-700 hover:bg-green-600 rounded text-sm text-white transition disabled:opacity-50">
            {stats?.openaiRunning ? <Loader className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {stats?.openaiRunning ? 'OpenAI…' : 'OpenAI ⚡'}
          </button>
          <button onClick={() => extraerOpenAI(true)} disabled={stats?.openaiRunning} title="Limpia título y asigna diseñadora en TODOS los patrones que lo necesiten (~$0.75 USD)"
            className="flex items-center gap-1.5 px-3 py-2 bg-green-900 hover:bg-green-800 border border-green-600 rounded text-sm text-white transition disabled:opacity-50">
            {stats?.openaiRunning ? <Loader className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {stats?.openaiRunning ? 'Limpiando…' : 'Limpiar todos ⚡'}
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
          <button
            onClick={() => { setMostrando('lista'); setVisorIdx(v => v === null ? 0 : null); }}
            title="Modo visor: edita rápido mientras ves las imágenes"
            className={`flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium transition ${visorIdx !== null ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
            <LayoutGrid className="w-4 h-4" />
            Modo visor
          </button>
          <button
            onClick={async () => {
              setMostrando('dmca');
              if (dmcaClaims.length === 0) {
                setDmcaCargando(true);
                try {
                  const res = await api.get('/admin/dmca', { headers: authHeader });
                  setDmcaClaims(res.data);
                } catch { }
                finally { setDmcaCargando(false); }
              }
            }}
            className={`relative flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium transition ${mostrando === 'dmca' ? 'bg-red-700 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
            <ShieldCheck className="w-4 h-4" />
            DMCA
            {stats?.dmca_pendientes > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 leading-none">
                {stats.dmca_pendientes}
              </span>
            )}
          </button>
          <button
            onClick={async () => {
              setMostrando('usuarios');
              if (!usuarios) {
                setUsuariosCargando(true);
                try {
                  const res = await api.get('/admin/usuarios', { headers: authHeader });
                  setUsuarios(res.data.usuarios || []);
                } catch { }
                finally { setUsuariosCargando(false); }
              }
            }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium transition ${mostrando === 'usuarios' ? 'bg-blue-700 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
            👥 Usuarios
          </button>
          <button
            onClick={async () => {
              setMostrando('analytics');
              if (!analytics) {
                setAnalyticsCargando(true);
                try {
                  const res = await api.get('/admin/analytics', { headers: authHeader });
                  setAnalytics(res.data);
                } catch { }
                finally { setAnalyticsCargando(false); }
              }
            }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium transition ${mostrando === 'analytics' ? 'bg-green-700 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
            📊 Métricas
          </button>
          <button
            onClick={() => setMostrando('emails')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium transition ${mostrando === 'emails' ? 'bg-pink-700 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
            ✉️ Emails
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

      {stats?.groqRunning && (
        <div className="mb-4 px-4 py-3 rounded text-sm bg-teal-900/40 border border-teal-500 text-teal-200">
          <div className="flex items-center gap-2 mb-1">
            <Loader className="w-4 h-4 animate-spin" />
            <span className="font-semibold">Extrayendo metadatos con Groq en el servidor…</span>
          </div>
          <div className="flex gap-6 text-xs">
            <span>✅ Actualizados: <strong>{stats.groqProgreso?.actualizados ?? 0}</strong></span>
            <span>⏳ Pendientes: <strong>{stats.groqProgreso?.restantes ?? '...'}</strong></span>
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              <label className="block text-sm text-gray-400 mb-1">Idioma</label>
              <select value={form.idioma} onChange={e => setForm(f => ({ ...f, idioma: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-crochet-primary">
                {IDIOMAS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
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
                { key: 'sin_titulo', label: '? Sin título' },
                { key: 'sin_disenadora', label: '? Sin diseñadora' },
              ].map(f => (
                <button key={f.key} onClick={() => setFiltroAdmin(f.key)}
                  className={`px-3 py-1.5 rounded-full font-medium transition ${filtroAdmin === f.key ? (f.key === 'corruptos' ? 'bg-red-600 text-white' : 'bg-crochet-primary text-white') : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
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
                filtroAdmin === 'ocultos' ? !p.activo :
                filtroAdmin === 'corruptos' ? (p.pdf_corrupto === 1 && p.paginas === 0) :
                filtroAdmin === 'sin_titulo' ? (p.titulo === 'Sin título' || !p.titulo || p.titulo.length < 4) :
                filtroAdmin === 'sin_disenadora' ? (!p.diseñadora || p.diseñadora === 'Diseñadora' || p.diseñadora === 'N/A') : true;
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
                    {filtrados.length > 200 && (
                      <p className="text-xs text-yellow-500 mb-2">
                        Mostrando los primeros 200 de {filtrados.length}. Usa el buscador para filtrar.
                      </p>
                    )}
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                      {filtrados.slice(0, 200).map((p, i) => (
                        <button
                          key={p.id}
                          onClick={() => setVisorIdx(i)}
                          className={`relative w-full aspect-[3/4] rounded overflow-hidden bg-gray-800 focus:outline-none ring-2 transition ${i === visorIdx ? 'ring-crochet-primary' : 'ring-transparent hover:ring-gray-500'}`}
                        >
                          {p.thumbnail_path ? (
                            <img src={p.thumbnail_path} alt={p.titulo} className="absolute inset-0 w-full h-full object-cover" />
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
                      authHeader={authHeader}
                      onGuardado={(id, form) => setPatrones(prev => prev.map(p => p.id === id ? { ...p, ...form } : p))}
                      onNext={() => setVisorIdx(i => Math.min(filtrados.length - 1, i + 1))}
                      onPrev={() => setVisorIdx(i => Math.max(0, i - 1))}
                      onJump={n => setVisorIdx(n)}
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
                        <a href={`/patron/${p.id}`} target="_blank" rel="noopener noreferrer"
                          title="Ver en catálogo"
                          className="p-2 text-gray-400 hover:text-blue-400 transition flex items-center">
                          <ExternalLink className="w-4 h-4" />
                        </a>
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

      {/* Panel Usuarios */}
      {mostrando === 'usuarios' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">👥 Usuarios registrados</h2>
            <button onClick={async () => {
              setUsuariosCargando(true);
              try { const res = await api.get('/admin/usuarios', { headers: authHeader }); setUsuarios(res.data.usuarios || []); }
              catch { } finally { setUsuariosCargando(false); }
            }} className="text-xs text-gray-400 hover:text-white transition">↺ Actualizar</button>
          </div>

          {usuariosCargando ? (
            <div className="flex justify-center py-12"><Loader className="w-8 h-8 animate-spin text-crochet-primary" /></div>
          ) : !usuarios ? (
            <div className="text-center py-12 text-gray-500">No se pudieron cargar los usuarios.</div>
          ) : (
            <>
              {/* Resumen */}
              <div className="grid grid-cols-3 gap-3 mb-2">
                <div className="bg-gray-800 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-white">{usuarios.length}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Total</p>
                </div>
                <div className="bg-gray-800 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-gray-300">{usuarios.filter(u => u.tier === 'free').length}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Free</p>
                </div>
                <div className="bg-gray-800 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-yellow-400">{usuarios.filter(u => u.tier === 'premium').length}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Premium</p>
                </div>
              </div>

              {/* Tabla */}
              <div className="bg-gray-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-700 text-left">
                        <th className="px-4 py-3 text-xs text-gray-400 font-semibold">Email</th>
                        <th className="px-4 py-3 text-xs text-gray-400 font-semibold">Plan</th>
                        <th className="px-4 py-3 text-xs text-gray-400 font-semibold text-center">Patrones</th>
                        <th className="px-4 py-3 text-xs text-gray-400 font-semibold text-center">Lista</th>
                        <th className="px-4 py-3 text-xs text-gray-400 font-semibold">Registro</th>
                        <th className="px-4 py-3 text-xs text-gray-400 font-semibold">Última sesión</th>
                        <th className="px-4 py-3 text-xs text-gray-400 font-semibold text-center">Sesiones</th>
                        <th className="px-4 py-3 text-xs text-gray-400 font-semibold">Vence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usuarios.map((u, i) => (
                        <tr key={u.id} className={`border-b border-gray-700/50 hover:bg-gray-700/30 transition ${i % 2 === 0 ? '' : 'bg-gray-800/50'}`}>
                          <td className="px-4 py-2.5">
                            <button
                              onClick={async () => {
                                setUsuarioDetalleCargando(true);
                                try {
                                  const res = await api.get(`/admin/usuarios/${u.id}`, { headers: authHeader });
                                  setUsuarioDetalle({ ...res.data.usuario, patrones: res.data.patrones });
                                } catch { }
                                finally { setUsuarioDetalleCargando(false); }
                              }}
                              className="font-mono text-xs text-blue-400 hover:text-blue-200 hover:underline text-left"
                            >{u.email}</button>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`text-xs px-2 py-0.5 rounded font-semibold ${u.tier === 'premium' ? 'bg-yellow-600 text-white' : 'bg-gray-600 text-gray-300'}`}>
                              {u.tier}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`font-semibold ${u.patrones_abiertos >= 3 ? 'text-crochet-primary' : 'text-gray-300'}`}>
                              {u.patrones_abiertos}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-center text-gray-400">{u.en_lista}</td>
                          <td className="px-4 py-2.5 text-gray-400 text-xs">{new Date(u.created_at).toLocaleDateString('es-MX')}</td>
                          <td className="px-4 py-2.5 text-xs text-gray-400">{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : <span className="text-gray-600">—</span>}</td>
                          <td className="px-4 py-2.5 text-center text-gray-400">{u.login_count || 0}</td>
                          <td className="px-4 py-2.5 text-xs">
                            {u.subscription_expires_at
                              ? <span className={new Date(u.subscription_expires_at) > new Date() ? 'text-green-400' : 'text-red-400'}>
                                  {new Date(u.subscription_expires_at).toLocaleDateString('es-MX')}
                                </span>
                              : <span className="text-gray-600">—</span>
                            }
                          </td>
                          <td className="px-4 py-2.5 flex gap-1">
                            <button
                              onClick={async () => {
                                const nuevoTier = u.tier === 'premium' ? 'free' : 'premium';
                                const msg = nuevoTier === 'premium'
                                  ? `¿Activar Premium manual a ${u.email}? (30 días)`
                                  : `¿Quitar Premium a ${u.email}?`;
                                if (!confirm(msg)) return;
                                try {
                                  const res = await api.patch(`/admin/usuarios/${u.id}/tier`, { tier: nuevoTier }, { headers: authHeader });
                                  setUsuarios(prev => prev.map(x => x.id === u.id ? { ...x, tier: res.data.tier, subscription_expires_at: res.data.subscription_expires_at } : x));
                                } catch (err) { alert(err.response?.data?.error || 'Error'); }
                              }}
                              className={`transition p-1 text-sm ${u.tier === 'premium' ? 'text-yellow-500 hover:text-gray-400' : 'text-gray-600 hover:text-yellow-400'}`}
                              title={u.tier === 'premium' ? 'Quitar Premium' : 'Activar Premium'}
                            >{u.tier === 'premium' ? '⭐' : '☆'}</button>
                            <button
                              onClick={async () => {
                                if (!confirm(`¿Eliminar a ${u.email}? Se borrarán todos sus datos.`)) return;
                                try {
                                  await api.delete(`/admin/usuarios/${u.id}`, { headers: authHeader });
                                  setUsuarios(prev => prev.filter(x => x.id !== u.id));
                                } catch (err) { alert(err.response?.data?.error || 'Error'); }
                              }}
                              className="text-gray-600 hover:text-red-400 transition p-1"
                              title="Eliminar usuario"
                            >🗑</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Panel DMCA */}
      {mostrando === 'dmca' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-red-400" /> Reclamaciones DMCA</h2>
            <button onClick={async () => {
              setDmcaCargando(true);
              try { const res = await api.get('/admin/dmca', { headers: authHeader }); setDmcaClaims(res.data); }
              catch { } finally { setDmcaCargando(false); }
            }} className="text-xs text-gray-400 hover:text-white transition">↺ Actualizar</button>
          </div>
          {dmcaCargando ? (
            <div className="flex justify-center py-12"><Loader className="w-8 h-8 animate-spin text-crochet-primary" /></div>
          ) : dmcaClaims.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No hay reclamaciones registradas.</div>
          ) : (
            dmcaClaims.map(c => (
              <DmcaClaimCard key={c.id} claim={c} authHeader={authHeader}
                onUpdate={updated => setDmcaClaims(prev => prev.map(x => x.id === c.id ? { ...x, ...updated } : x))} />
            ))
          )}
        </div>
      )}

      {mostrando === 'analytics' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">📊 Métricas</h2>
            <button onClick={async () => {
              setAnalyticsCargando(true);
              try { const res = await api.get('/admin/analytics', { headers: authHeader }); setAnalytics(res.data); }
              catch { } finally { setAnalyticsCargando(false); }
            }} className="text-xs text-gray-400 hover:text-white transition">↺ Actualizar</button>
          </div>

          {analyticsCargando ? (
            <div className="flex justify-center py-12"><Loader className="w-8 h-8 animate-spin text-crochet-primary" /></div>
          ) : analytics ? (
            <>
              {/* Tarjetas principales */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'Aperturas hoy', value: analytics.visitasHoy, color: 'text-blue-400' },
                  { label: 'Usuarios únicos hoy', value: analytics.usuariosUnicosHoy, color: 'text-emerald-400' },
                  { label: 'Usuarios free', value: analytics.usuariosFree, color: 'text-gray-300' },
                  { label: 'Usuarios premium', value: analytics.usuariosPremium, color: 'text-yellow-400' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-gray-800 rounded-xl p-4 text-center">
                    <p className={`text-3xl font-bold ${color}`}>{value?.toLocaleString()}</p>
                    <p className="text-xs text-gray-400 mt-1">{label}</p>
                  </div>
                ))}
              </div>

              {/* Fila secundaria — semana */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'Aperturas esta semana', value: analytics.visitasSemana },
                  { label: 'Usuarios únicos semana', value: analytics.usuariosUnicosSemana },
                  { label: 'Registros hoy', value: analytics.registrosHoy },
                  { label: 'Registros esta semana', value: analytics.registrosSemana },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-gray-800/50 rounded-xl p-3 text-center">
                    <p className="text-xl font-bold text-white">{value?.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>

              {/* Fila mes + inactivos */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'Aperturas este mes', value: analytics.apertuasMes, color: 'text-violet-400' },
                  { label: 'Usuarios únicos este mes', value: analytics.usuariosUnicosMes, color: 'text-pink-400' },
                  { label: 'Free inactivos +5 días', value: analytics.inactivosFree, color: 'text-orange-400', hint: 'sin actividad en 5 días' },
                  { label: 'Premium inactivos +5 días', value: analytics.inactivosPremium, color: 'text-red-400', hint: 'sin actividad en 5 días' },
                ].map(({ label, value, color, hint }) => (
                  <div key={label} className="bg-gray-800/50 rounded-xl p-3 text-center" title={hint}>
                    <p className={`text-2xl font-bold ${color}`}>{value?.toLocaleString()}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>

              {/* Gráficas lado a lado */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Aperturas últimos 7 días */}
                {analytics.visitasPorDia?.length > 0 && (() => {
                  const ultimos7 = analytics.visitasPorDia.slice(-7);
                  const max = Math.max(...ultimos7.map(d => d.visitas), 1);
                  const MAX_PX = 80;
                  return (
                    <div className="bg-gray-800 rounded-xl p-4">
                      <h3 className="text-sm font-semibold text-gray-300 mb-4">📂 Aperturas últimos 7 días</h3>
                      <div className="flex items-end gap-1.5" style={{ height: `${MAX_PX + 32}px` }}>
                        {ultimos7.map(d => {
                          const px = Math.max(Math.round((d.visitas / max) * MAX_PX), d.visitas > 0 ? 4 : 0);
                          return (
                            <div key={d.dia} className="flex-1 flex flex-col items-center justify-end gap-1">
                              <span className="text-xs text-gray-400 font-medium">{d.visitas >= 1000 ? `${(d.visitas/1000).toFixed(1)}k` : d.visitas}</span>
                              <div className="w-full bg-crochet-primary rounded-t" style={{ height: `${px}px` }} title={`${d.dia}: ${d.visitas}`} />
                              <p className="text-xs text-gray-500">{d.dia.slice(5)}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Usuarios únicos últimos 7 días */}
                {analytics.usuariosPorDia?.length > 0 && (() => {
                  const ultimos7 = analytics.usuariosPorDia.slice(-7);
                  const max = Math.max(...ultimos7.map(d => d.usuarios), 1);
                  const MAX_PX = 80;
                  return (
                    <div className="bg-gray-800 rounded-xl p-4">
                      <h3 className="text-sm font-semibold text-gray-300 mb-4">👤 Usuarios únicos últimos 7 días</h3>
                      <div className="flex items-end gap-1.5" style={{ height: `${MAX_PX + 32}px` }}>
                        {ultimos7.map(d => {
                          const px = Math.max(Math.round((d.usuarios / max) * MAX_PX), d.usuarios > 0 ? 4 : 0);
                          return (
                            <div key={d.dia} className="flex-1 flex flex-col items-center justify-end gap-1">
                              <span className="text-xs text-emerald-400 font-medium">{d.usuarios}</span>
                              <div className="w-full bg-emerald-600 rounded-t" style={{ height: `${px}px` }} title={`${d.dia}: ${d.usuarios} usuarios`} />
                              <p className="text-xs text-gray-500">{d.dia.slice(5)}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Top patrones */}
                <div className="bg-gray-800 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-gray-300 mb-3">🔥 Top patrones más vistos</h3>
                  {analytics.topPatrones.length === 0 ? (
                    <p className="text-gray-500 text-sm">Sin datos aún</p>
                  ) : (
                    <div className="space-y-2">
                      {analytics.topPatrones.map((p, i) => (
                        <div key={p.patron_id} className="flex items-center gap-2 text-sm">
                          <span className="text-gray-500 w-5 text-right">{i + 1}.</span>
                          <span className="flex-1 truncate text-gray-200">{p.titulo || p.patron_id}</span>
                          <span className="text-crochet-primary font-semibold shrink-0">{p.visitas}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Países */}
                <div className="bg-gray-800 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-gray-300 mb-3">🌎 Países</h3>
                  {analytics.paises.length === 0 ? (
                    <p className="text-gray-500 text-sm">Sin datos aún</p>
                  ) : (
                    <div className="space-y-2">
                      {analytics.paises.map(p => (
                        <div key={p.pais} className="flex items-center gap-2 text-sm">
                          <span className="flex-1 text-gray-200">{p.pais}</span>
                          <span className="text-gray-400 font-semibold">{p.visitas}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-gray-500">No se pudieron cargar las métricas.</div>
          )}
        </div>
      )}

      {/* Panel detalle usuario */}
      {usuarioDetalle && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/60" onClick={() => setUsuarioDetalle(null)} />
          <div className="w-full max-w-sm bg-gray-900 border-l border-gray-700 flex flex-col overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
              <div>
                <p className="font-semibold text-sm">{usuarioDetalle.email}</p>
                <span className={`text-xs px-2 py-0.5 rounded font-semibold ${usuarioDetalle.tier === 'premium' ? 'bg-yellow-600 text-white' : 'bg-gray-600 text-gray-300'}`}>
                  {usuarioDetalle.tier}
                </span>
              </div>
              <button onClick={() => setUsuarioDetalle(null)} className="text-gray-400 hover:text-white p-1">✕</button>
            </div>
            <div className="px-4 py-3 text-xs text-gray-400 border-b border-gray-700 shrink-0 space-y-1">
              <p>Registro: {new Date(usuarioDetalle.created_at).toLocaleDateString('es-MX')}</p>
              {usuarioDetalle.subscription_expires_at && (
                <p>Suscripción vence: {new Date(usuarioDetalle.subscription_expires_at).toLocaleDateString('es-MX')}</p>
              )}
              <p>{usuarioDetalle.patrones?.length || 0} patrones abiertos</p>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-700/50">
              {usuarioDetalle.patrones?.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-8">Sin patrones abiertos aún</p>
              ) : (
                usuarioDetalle.patrones?.map(p => {
                  const pct = p.paginas > 0 ? Math.round((p.pagina_actual / p.paginas) * 100) : 0;
                  return (
                    <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="w-10 h-14 bg-gray-800 rounded overflow-hidden shrink-0">
                        {p.thumbnail_path
                          ? <img src={p.thumbnail_path} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-white font-medium line-clamp-2 leading-tight">{p.titulo}</p>
                        <div className="w-full h-1 bg-gray-700 rounded-full overflow-hidden mt-1.5">
                          <div className="h-full bg-crochet-primary rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="text-gray-500 text-xs mt-0.5">
                          {p.completado ? '✓ Completado' : `Pág. ${p.pagina_actual}${p.paginas > 0 ? ` / ${p.paginas}` : ''}`}
                          {p.ultimo_acceso ? ` · ${new Date(p.ultimo_acceso).toLocaleDateString('es-MX')}` : ''}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
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
              {!patronEditando.thumbnail_path && (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-2">
                  <span className="text-4xl text-gray-700">📄</span>
                  <span className="text-xs text-gray-600">Sin imagen aún</span>
                </div>
              )}
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
                <label className="block text-xs text-gray-400 mb-1">Idioma</label>
                <select value={editForm.idioma || 'es'} onChange={e => setEditForm(f => ({ ...f, idioma: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-crochet-primary">
                  {IDIOMAS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
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

      {/* Panel Emails */}
      {mostrando === 'emails' && (
        <EmailBlastPanel authHeader={authHeader} stats={stats} />
      )}
    </div>
  );
}

function EmailBlastPanel({ authHeader, stats }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState('');

  const PLANTILLAS = [
    {
      label: '50% OFF — Lanzamiento',
      subject: '🧶 Solo hasta el martes: 50% OFF en CrochetFlix',
      body: `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4e4e7">

  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#c026d3,#7c3aed);padding:24px 32px 20px;text-align:center">
    <p style="margin:0;font-size:24px;font-weight:900;color:#ffffff">🧶 CrochetFlix</p>
    <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.85)">Más de 8,000 patrones de crochet profesionales</p>
  </td></tr>

  <!-- Catalog grid — replaced by backend with 3 real pattern thumbnails -->
  {{PATRONES_GRID}}

  <!-- Offer banner -->
  <tr><td style="background:#7c3aed;padding:28px 32px 24px;text-align:center">
    <p style="margin:0 0 4px;font-size:11px;color:rgba(255,255,255,0.75);letter-spacing:3px;text-transform:uppercase">Oferta de lanzamiento</p>
    <p style="margin:0;font-size:88px;font-weight:900;color:#ffffff;line-height:0.9">50%</p>
    <p style="margin:8px 0 0;font-size:20px;font-weight:700;color:rgba(255,255,255,0.95)">de descuento en tu primer mes</p>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:32px">
    <p style="margin:0 0 20px;font-size:15px;color:#18181b;line-height:1.7;text-align:center">
      Solo hasta el <strong>martes 16 de junio</strong>.
    </p>

    <!-- Features -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf5ff;border-radius:12px;margin-bottom:24px">
    <tr><td style="padding:20px 24px">
      <p style="margin:0 0 10px;font-size:14px;color:#3b0764">✓ &nbsp;Acceso ilimitado a todos los patrones</p>
      <p style="margin:0 0 10px;font-size:14px;color:#3b0764">✓ &nbsp;Traduce los patrones a tu idioma automáticamente</p>
      <p style="margin:0 0 10px;font-size:14px;color:#3b0764">✓ &nbsp;Guarda tu progreso y favoritos</p>
      <p style="margin:0;font-size:14px;color:#3b0764">✓ &nbsp;Cancela cuando quieras</p>
    </td></tr></table>

    <!-- CTA -->
    <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <a href="https://crochetflix.app/perfil" style="display:inline-block;background:#c026d3;color:#ffffff;font-weight:700;font-size:16px;padding:16px 40px;border-radius:12px;text-decoration:none">
        Adquiere antes del 16 de junio →
      </a>
    </td></tr></table>

    <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa;text-align:center">
      Oferta válida solo hasta el 16 de junio de 2026.
    </p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f4f4f5;padding:20px 32px;text-align:center;border-top:1px solid #e4e4e7">
    <p style="margin:0;font-size:12px;color:#71717a">CrochetFlix · crochetflix.app</p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`,
    },
  ];

  const aplicarPlantilla = (p) => { setSubject(p.subject); setBody(p.body); setResultado(null); setError(''); };

  const enviar = async () => {
    if (!subject.trim() || !body.trim()) { setError('Completa el asunto y el mensaje'); return; }
    if (!window.confirm(`¿Enviar este email a ~${stats?.usuariosFree || '?'} usuarios free? Esta acción no se puede deshacer.`)) return;
    setEnviando(true); setError(''); setResultado(null);
    try {
      const res = await api.post('/admin/email-blast', { subject, html: body }, { headers: authHeader });
      setResultado(res.data);
    } catch (e) {
      setError(e.response?.data?.error || 'Error al enviar');
    } finally { setEnviando(false); }
  };

  return (
    <div className="max-w-2xl space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">✉️ Email a usuarios free</h2>
        {stats && <span className="text-sm text-gray-400">{stats.usuariosFree || '?'} destinatarios</span>}
      </div>

      <div className="flex gap-2 flex-wrap">
        {PLANTILLAS.map(p => (
          <button key={p.label} onClick={() => aplicarPlantilla(p)}
            className="px-3 py-1.5 bg-pink-900/50 hover:bg-pink-800 border border-pink-700 rounded-lg text-xs font-medium transition">
            {p.label}
          </button>
        ))}
      </div>

      <div>
        <label className="text-xs text-gray-400 block mb-1">Asunto</label>
        <input value={subject} onChange={e => setSubject(e.target.value)}
          placeholder="Ej: 🧶 Solo hasta el martes: 50% OFF"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-pink-500" />
      </div>

      <div>
        <label className="text-xs text-gray-400 block mb-1">Cuerpo HTML</label>
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={12}
          placeholder="<p>Tu mensaje aquí...</p>"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-pink-500" />
      </div>

      {body && (
        <div>
          <p className="text-xs text-gray-400 mb-2">Vista previa:</p>
          <div className="bg-white rounded-lg p-4 max-h-96 overflow-y-auto" dangerouslySetInnerHTML={{ __html: body.replace('{{PATRONES_GRID}}', '<tr><td style="padding:10px;text-align:center;background:#f0e6ff;border-top:2px dashed #c026d3"><p style="margin:0;font-size:11px;color:#7c3aed;font-family:monospace">🖼 Grid de 3 patrones del catálogo — se inserta al enviar</p></td></tr>') }} />
        </div>
      )}

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {resultado && (
        <div className="bg-green-900/40 border border-green-700 rounded-lg p-4 text-sm">
          ✅ Enviados: <strong>{resultado.enviados}</strong> · Errores: {resultado.errores} · Total: {resultado.total}
        </div>
      )}

      <button onClick={enviar} disabled={enviando}
        className="w-full py-3 bg-pink-700 hover:bg-pink-600 disabled:opacity-50 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transition">
        {enviando ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> Enviando...</> : `✉️ Enviar a usuarios free`}
      </button>

      <p className="text-xs text-gray-500">El link de cancelar suscripción se agrega automáticamente al final de cada email.</p>
    </div>
  );
}
