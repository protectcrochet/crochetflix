import { useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import PatronCard from './PatronCard';

export default function Carrusel({ titulo, patrones, loop = false, autoScroll = false, onUpdate }) {
  const scrollRef = useRef(null);
  const pausadoRef = useRef(false);

  const scroll = (direction) => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -300 : 300,
      behavior: 'smooth',
    });
  };

  useEffect(() => {
    if (!autoScroll) return;
    const intervalo = setInterval(() => {
      if (pausadoRef.current || !scrollRef.current) return;
      const el = scrollRef.current;
      if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 10) {
        el.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        el.scrollBy({ left: 300, behavior: 'smooth' });
      }
    }, 3000);
    return () => clearInterval(intervalo);
  }, [autoScroll]);

  if (!patrones || patrones.length === 0) return null;

  const items = loop ? [...patrones, ...patrones] : patrones;

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

      <div
        ref={scrollRef}
        className="carrusel-container px-4"
        onMouseEnter={() => { pausadoRef.current = true; }}
        onMouseLeave={() => { pausadoRef.current = false; }}
        onTouchStart={() => { pausadoRef.current = true; }}
        onTouchEnd={() => { pausadoRef.current = false; }}
      >
        {items.map((patron, i) => (
          <PatronCard key={`${patron.id}-${i}`} patron={patron} onUpdate={onUpdate} />
        ))}
      </div>
    </section>
  );
}
