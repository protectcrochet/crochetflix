import { useState, useEffect } from 'react';
import api from '../services/api';
import PatronCard from '../components/PatronCard';
import { BookmarkX } from 'lucide-react';

export default function MiLista() {
  const [patrones, setPatrones] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    cargarMiLista();
  }, []);

  const cargarMiLista = async () => {
    try {
      const res = await api.get('/patrones', { params: { mi_lista: '1', limit: 500 } });
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
        <BookmarkX className="w-16 h-16 text-gray-600 mb-4" />
        <h2 className="text-xl font-bold mb-2">Tu lista está vacía</h2>
        <p className="text-gray-400 text-center">
          Guarda patrones que quieras ver después presionando el ícono de bookmark
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 py-6">
      <h1 className="text-2xl font-bold mb-6">Mi Lista</h1>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {patrones.map(patron => (
          <PatronCard key={patron.id} patron={patron} />
        ))}
      </div>
    </div>
  );
}