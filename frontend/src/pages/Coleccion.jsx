import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../services/api';
import PatronCard from '../components/PatronCard';
import { ChevronLeft } from 'lucide-react';

export default function Coleccion() {
  const { id } = useParams();
  const [coleccion, setColeccion] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/colecciones/${id}`)
      .then(r => setColeccion(r.data))
      .catch(() => setColeccion(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div className="flex items-center justify-center h-96">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-crochet-primary" />
    </div>
  );

  if (!coleccion) return (
    <div className="text-center py-20 text-gray-400">
      <p>Colección no encontrada</p>
      <Link to="/" className="text-crochet-primary mt-4 inline-block">Volver al inicio</Link>
    </div>
  );

  return (
    <div className="pb-10">
      <div className="px-4 pt-6 pb-4">
        <Link to="/" className="flex items-center gap-1 text-gray-400 hover:text-white text-sm mb-4 transition">
          <ChevronLeft className="w-4 h-4" /> Inicio
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-4xl">{coleccion.emoji || '🧶'}</span>
          <div>
            <h1 className="text-2xl font-bold">{coleccion.nombre}</h1>
            {coleccion.descripcion && <p className="text-gray-400 text-sm mt-1">{coleccion.descripcion}</p>}
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-2">{coleccion.patrones?.length || 0} patrones</p>
      </div>

      <div className="px-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {(coleccion.patrones || []).map(patron => (
          <PatronCard key={patron.id} patron={patron} />
        ))}
      </div>

      {(!coleccion.patrones || coleccion.patrones.length === 0) && (
        <p className="text-center text-gray-500 py-12">Esta colección aún no tiene patrones.</p>
      )}
    </div>
  );
}
