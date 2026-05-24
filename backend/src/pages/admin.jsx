import { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export default function Admin() {
  const [adminSecret, setAdminSecret] = useState(localStorage.getItem('adminSecret') || '');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [patrones, setPatrones] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const [form, setForm] = useState({
    titulo: '',
    descripcion: '',
    categoria: 'amigurumi',
    esPremium: false
  });
  const [pdfFile, setPdfFile] = useState(null);

  const categorias = [
    'amigurumi', 'ropa', 'decoracion', 'accesorios', 
    'mantas', 'juguetes', 'navidad', 'otros'
  ];

  useEffect(() => {
    if (isAuthenticated) {
      fetchPatrones();
      fetchStats();
    }
  }, [isAuthenticated]);

  const login = () => {
    localStorage.setItem('adminSecret', adminSecret);
    setIsAuthenticated(true);
  };

  const fetchPatrones = async () => {
    try {
      const res = await axios.get(`${API_URL}/admin/patrones`, {
        headers: { 'x-admin-secret': adminSecret }
      });
      setPatrones(res.data.patrones);
    } catch (err) {
      setMessage('Error cargando patrones');
    }
  };

  const fetchStats = async () => {
    try {
      const res = await axios.get(`${API_URL}/admin/stats`, {
        headers: { 'x-admin-secret': adminSecret }
      });
      setStats(res.data);
    } catch (err) {
      console.error('Error stats:', err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!pdfFile) {
      setMessage('Selecciona un PDF');
      return;
    }

    setLoading(true);
    setMessage('');

    const formData = new FormData();
    formData.append('pdf', pdfFile);
    formData.append('titulo', form.titulo);
    formData.append('descripcion', form.descripcion);
    formData.append('categoria', form.categoria);
    formData.append('esPremium', form.esPremium);
    formData.append('adminSecret', adminSecret);

    try {
      const res = await axios.post(`${API_URL}/admin/patrones`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setMessage('✅ Patrón subido exitosamente');
      setForm({ titulo: '', descripcion: '', categoria: 'amigurumi', esPremium: false });
      setPdfFile(null);
      fetchPatrones();
      fetchStats();
    } catch (err) {
      setMessage('❌ Error: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const eliminarPatron = async (id) => {
    if (!confirm('¿Eliminar este patrón permanentemente?')) return;

    try {
      await axios.delete(`${API_URL}/admin/patrones/${id}`, {
        headers: { 'x-admin-secret': adminSecret }
      });
      setMessage('✅ Patrón eliminado');
      fetchPatrones();
      fetchStats();
    } catch (err) {
      setMessage('❌ Error eliminando');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="bg-gray-800 p-8 rounded-lg shadow-lg max-w-md w-full">
          <h1 className="text-2xl font-bold text-white mb-6 text-center">🔐 Admin Panel</h1>
          <input
            type="password"
            placeholder="Admin Secret"
            value={adminSecret}
            onChange={(e) => setAdminSecret(e.target.value)}
            className="w-full p-3 rounded bg-gray-700 text-white border border-gray-600 focus:border-orange-500 focus:outline-none"
          />
          <button
            onClick={login}
            className="w-full mt-4 p-3 bg-orange-500 hover:bg-orange-600 text-white rounded font-semibold transition"
          >
            Acceder
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">🧶 CrochetFlix Admin</h1>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-800 p-4 rounded-lg">
            <div className="text-2xl font-bold text-orange-400">{stats.total_users || 0}</div>
            <div className="text-sm text-gray-400">Usuarios</div>
          </div>
          <div className="bg-gray-800 p-4 rounded-lg">
            <div className="text-2xl font-bold text-green-400">{stats.premium_users || 0}</div>
            <div className="text-sm text-gray-400">Premium</div>
          </div>
          <div className="bg-gray-800 p-4 rounded-lg">
            <div className="text-2xl font-bold text-blue-400">{stats.total_patrones || 0}</div>
            <div className="text-sm text-gray-400">Patrones</div>
          </div>
          <div className="bg-gray-800 p-4 rounded-lg">
            <div className="text-2xl font-bold text-purple-400">{stats.pagos_completados || 0}</div>
            <div className="text-sm text-gray-400">Pagos</div>
          </div>
        </div>

        {/* Formulario */}
        <div className="bg-gray-800 p-6 rounded-lg mb-8">
          <h2 className="text-xl font-semibold mb-4">📤 Subir Nuevo Patrón</h2>
          
          {message && (
            <div className={`p-3 rounded mb-4 ${message.includes('✅') ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Título *</label>
              <input
                type="text"
                value={form.titulo}
                onChange={(e) => setForm({...form, titulo: e.target.value})}
                className="w-full p-3 rounded bg-gray-700 border border-gray-600 focus:border-orange-500 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Descripción</label>
              <textarea
                value={form.descripcion}
                onChange={(e) => setForm({...form, descripcion: e.target.value})}
                className="w-full p-3 rounded bg-gray-700 border border-gray-600 focus:border-orange-500 focus:outline-none h-24"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Categoría *</label>
                <select
                  value={form.categoria}
                  onChange={(e) => setForm({...form, categoria: e.target.value})}
                  className="w-full p-3 rounded bg-gray-700 border border-gray-600 focus:border-orange-500 focus:outline-none"
                >
                  {categorias.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="premium"
                  checked={form.esPremium}
                  onChange={(e) => setForm({...form, esPremium: e.target.checked})}
                  className="w-5 h-5 mr-2"
                />
                <label htmlFor="premium" className="text-sm">Premium (solo suscriptores)</label>
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">PDF del patrón *</label>
              <input
                type="file"
                accept=".pdf"
                onChange={(e) => setPdfFile(e.target.files[0])}
                className="w-full p-3 rounded bg-gray-700 border border-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-orange-500 file:text-white"
                required
              />
              {pdfFile && <p className="text-sm text-gray-400 mt-1">{pdfFile.name} ({(pdfFile.size/1024/1024).toFixed(2)} MB)</p>}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full p-3 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-600 text-white rounded font-semibold transition"
            >
              {loading ? '⏳ Procesando PDF...' : '📤 Subir Patrón'}
            </button>
          </form>
        </div>

        {/* Lista de patrones */}
        <div className="bg-gray-800 p-6 rounded-lg">
          <h2 className="text-xl font-semibold mb-4">📚 Patrones ({patrones.length})</h2>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="pb-2">Título</th>
                  <th className="pb-2">Categoría</th>
                  <th className="pb-2">Páginas</th>
                  <th className="pb-2">Tipo</th>
                  <th className="pb-2">Fecha</th>
                  <th className="pb-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {patrones.map(p => (
                  <tr key={p.id} className="border-b border-gray-700">
                    <td className="py-3">{p.titulo}</td>
                    <td className="py-3"><span className="bg-gray-700 px-2 py-1 rounded text-sm">{p.categoria}</span></td>
                    <td className="py-3">{p.total_paginas}</td>
                    <td className="py-3">
                      {p.es_premium ? 
                        <span className="text-orange-400">⭐ Premium</span> : 
                        <span className="text-green-400">🆓 Gratis</span>
                      }
                    </td>
                    <td className="py-3 text-gray-400">{new Date(p.created_at).toLocaleDateString()}</td>
                    <td className="py-3">
                      <button
                        onClick={() => eliminarPatron(p.id)}
                        className="text-red-400 hover:text-red-300 text-sm"
                      >
                        🗑️ Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}