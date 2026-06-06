import { useState, useEffect } from 'react';
import api from '../services/api';
import PatronCard from '../components/PatronCard';
import { WifiOff, Trash2 } from 'lucide-react';

export default function Descargas() {
  const [patrones, setPatrones] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    cargarDescargas();
  }, []);

  const cargarDescargas = async () => {
    try {
      const res = await api.get('/patrones', { params: { offline: '1', limit: 500 } });
      setPatrones(res.data.patrones || []);
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-crochet-primary"></div>
      </div>
    );
  }

  if (patrones.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 px-4">
        <WifiOff className="w-16 h-16 text-gray-600 mb-4" />
        <h2 className="text-xl font-bold mb-2">Sin descargas</h2>
        <p className="text-gray-400 text-center mb-4">
          Descarga hasta 5 patrones para verlos sin conexión
        </p>
        <p className="text-sm text-gray-500">
          Solo disponible para suscriptoras premium
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Descargas</h1>
        <span className="text-sm text-gray-400">
          {patrones.length}/5 patrones
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {patrones.map(patron => (
          <div key={patron.id} className="relative">
            <PatronCard patron={patron} />
            <div className="absolute top-2 right-2">
              <span className="bg-blue-600 text-xs px-2 py-1 rounded flex items-center gap-1">
                <WifiOff className="w-3 h-3" /> Offline
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}