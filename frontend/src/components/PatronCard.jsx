import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Star, Download, Flame, Pencil, X } from 'lucide-react';
import { useAdminMode } from '../context/AdminMode';
import api from '../services/api';

const CATEGORIAS = ['amigurumi','ropa','accesorios','decoracion','hogar','navidad','halloween','otro'];
const DIFICULTADES = ['principiante','intermedio','avanzado'];

function QuickEditModal({ patron, secret, onSave, onClose }) {
  const [form, setForm] = useState({
    titulo: patron.titulo || '',
    diseñadora: patron.diseñadora || patron.autor || '',
    categoria: patron.categoria || 'amigurumi',
    dificultad: patron.dificultad || 'principiante',
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/admin/patrones/${patron.id}`, form, { headers: { 'X-Admin-Secret': secret } });
      onSave(form);
    } catch { alert('Error guardando'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-[200] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-gray-900 rounded-xl w-full max-w-sm shadow-2xl border border-gray-700" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <span className="text-sm font-semibold text-white">Editar patrón</span>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Título</label>
            <input value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:border-crochet-primary focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Diseñadora</label>
            <input value={form.diseñadora} onChange={e => setForm(f => ({ ...f, diseñadora: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:border-crochet-primary focus:outline-none" />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-gray-400 block mb-1">Categoría</label>
              <select value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none">
                {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-400 block mb-1">Dificultad</label>
              <select value={form.dificultad} onChange={e => setForm(f => ({ ...f, dificultad: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none">
                {DIFICULTADES.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
          <button onClick={save} disabled={saving}
            className="w-full py-2 bg-crochet-primary rounded text-sm font-semibold disabled:opacity-50">
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PatronCard({ patron, onUpdate }) {
  const { adminMode, secret } = useAdminMode();
  const [local, setLocal] = useState({
    titulo: patron.titulo,
    diseñadora: patron.diseñadora,
    autor: patron.autor,
    destacado: patron.destacado,
    tendencia: patron.tendencia,
  });
  const [editOpen, setEditOpen] = useState(false);
  const [toggling, setToggling] = useState('');

  const toggle = async (tipo) => {
    setToggling(tipo);
    try {
      await api.patch(`/admin/patrones/${patron.id}/${tipo}`, {}, { headers: { 'X-Admin-Secret': secret } });
      setLocal(l => ({
        ...l,
        destacado: tipo === 'destacar' ? (l.destacado ? 0 : 1) : l.destacado,
        tendencia: tipo === 'tendencia' ? (l.tendencia ? 0 : 1) : l.tendencia,
      }));
    } catch { alert('Error'); }
    finally { setToggling(''); }
  };

  return (
    <>
      <Link to={`/patron/${patron.id}`} className="card-hover flex-shrink-0 w-40 sm:w-48">
        <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-gray-800">
          {patron.thumbnail_path ? (
            <img src={patron.thumbnail_path} alt={local.titulo}
              className="w-full h-full object-cover" loading="lazy"
              onError={e => { e.currentTarget.style.display = 'none'; }} />
          ) : null}

          {/* Badges */}
          <div className="absolute top-2 left-2 flex gap-1">
            {patron.es_preview === 1 && (
              <span className="bg-green-600 text-xs px-2 py-0.5 rounded font-bold">GRATIS</span>
            )}
            {patron.offline === 1 && (
              <span className="bg-blue-600 text-xs px-2 py-0.5 rounded">
                <Download className="w-3 h-3 inline" />
              </span>
            )}
          </div>

          {/* Admin overlay */}
          {adminMode && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center gap-2 opacity-0 hover:opacity-100 transition-opacity"
              onClick={e => e.preventDefault()}>
              <button onClick={() => toggle('destacar')} disabled={!!toggling}
                title={local.destacado ? 'Quitar de hero' : 'Poner en hero'}
                className={`p-2 rounded-full ${local.destacado ? 'bg-yellow-500 text-black' : 'bg-black/70 text-white hover:bg-yellow-500 hover:text-black'} transition`}>
                <Star className="w-4 h-4" fill={local.destacado ? 'currentColor' : 'none'} />
              </button>
              <button onClick={() => toggle('tendencia')} disabled={!!toggling}
                title={local.tendencia ? 'Quitar de tendencia' : 'Poner en tendencia'}
                className={`p-2 rounded-full ${local.tendencia ? 'bg-orange-500 text-white' : 'bg-black/70 text-white hover:bg-orange-500'} transition`}>
                <Flame className="w-4 h-4" fill={local.tendencia ? 'currentColor' : 'none'} />
              </button>
              <button onClick={() => setEditOpen(true)}
                title="Editar"
                className="p-2 rounded-full bg-black/70 text-white hover:bg-crochet-primary transition">
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          )}

          {patron.en_progreso === 1 && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-700">
              <div className="h-full bg-crochet-primary" style={{ width: '40%' }} />
            </div>
          )}
        </div>

        <div className="mt-2">
          <h3 className="font-semibold text-sm line-clamp-1">{local.titulo}</h3>
          <p className="text-gray-400 text-xs">{local.diseñadora || local.autor}</p>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
            <span className="flex items-center gap-0.5">
              <Star className="w-3 h-3" /> 4.8
            </span>
            <span className="flex items-center gap-0.5">
              <Clock className="w-3 h-3" /> {patron.tiempo_minutos}min
            </span>
          </div>
        </div>
      </Link>

      {editOpen && (
        <QuickEditModal
          patron={{ ...patron, ...local }}
          secret={secret}
          onSave={form => { setLocal(l => ({ ...l, ...form })); setEditOpen(false); onUpdate && onUpdate(patron.id, form); }}
          onClose={() => setEditOpen(false)}
        />
      )}
    </>
  );
}
