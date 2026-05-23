import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import PatronCard from './PatronCard';

export default function Carrusel({ titulo, patrones }) {
  const scrollRef = useRef(null);

  const scroll = (direction) => {
    if (scrollRef.current) {
      const scrollAmount = 300;
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  if (!patrones || patrones.length === 0) return null;

  return (
    <section className="py-4">
      <div className="flex items-center justify-between px-4 mb-3">
        <h2 className="text-lg font-bold">{titulo}</h2>
        <div className="flex gap-1">
          <button onClick={() => scroll('left')} className="p-1 hover:bg-gray-800 rounded">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button onClick={() => scroll('right')} className="p-1 hover:bg-gray-800 rounded">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="carrusel-container px-4">
        {patrones.map(patron => (
          <PatronCard key={patron.id} patron={patron} />
        ))}
      </div>
    </section>
  );
}