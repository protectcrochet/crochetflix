import { Link } from 'react-router-dom';
import { Clock, Star, Download, Crown } from 'lucide-react';

export default function PatronCard({ patron }) {
  return (
    <Link to={`/patron/${patron.id}`} className="card-hover flex-shrink-0 w-40 sm:w-48">
      <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-gray-800">
        {/* Thumbnail */}
        <img 
          src={patron.thumbnail_path || '/placeholder-patron.jpg'} 
          alt={patron.titulo}
          className="w-full h-full object-cover"
          loading="lazy"
        />

        {/* Badges */}
        <div className="absolute top-2 left-2 flex gap-1">
          {patron.es_preview === 1 && (
            <span className="bg-green-600 text-xs px-2 py-0.5 rounded font-bold">GRATIS</span>
          )}
          {patron.es_solo_premium === 1 && (
            <span className="bg-yellow-500 text-black text-xs px-2 py-0.5 rounded font-bold flex items-center gap-0.5">
              <Crown className="w-3 h-3" /> PREMIUM
            </span>
          )}
          {patron.offline === 1 && (
            <span className="bg-blue-600 text-xs px-2 py-0.5 rounded">
              <Download className="w-3 h-3 inline" />
            </span>
          )}
        </div>

        {/* Progreso */}
        {patron.en_progreso === 1 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-700">
            <div className="h-full bg-crochet-primary" style={{ width: '40%' }} />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="mt-2">
        <h3 className="font-semibold text-sm line-clamp-1">{patron.titulo}</h3>
        <p className="text-gray-400 text-xs">{patron.diseñadora || patron.autor}</p>
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
  );
}