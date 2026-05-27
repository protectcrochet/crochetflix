import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../services/api';
import {
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut,
  Download, Bookmark, Check, Lock, Loader
} from 'lucide-react';

export default function Viewer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canvasRef = useRef(null);

  const [patron, setPatron] = useState(null);
  const [paginaActual, setPaginaActual] = useState(1);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingPagina, setLoadingPagina] = useState(false);
  const [error, setError] = useState('');
  const [paginaError, setPaginaError] = useState('');
  const [tieneAcceso, setTieneAcceso] = useState(false);
  const [esPreview, setEsPreview] = useState(false);
  const [enMiLista, setEnMiLista] = useState(false);
  const [descargado, setDescargado] = useState(false);
  const [progreso, setProgreso] = useState({ pagina_actual: 1, completado: false });

  // Touch refs
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);
  const lastPinchDist = useRef(null);
  const panStartTouch = useRef({ x: 0, y: 0 });

  useEffect(() => { cargarPatron(); }, [id]);

  useEffect(() => {
    if (tieneAcceso) cargarPagina(paginaActual);
  }, [paginaActual, tieneAcceso]);

  // Teclado: flechas + zoom + bloquear Ctrl+P/S/U
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && ['p', 's', 'u'].includes(e.key)) {
        e.preventDefault(); e.stopPropagation(); return;
      }
      if (!tieneAcceso) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        setPaginaActual(p => Math.min(totalPaginas, p + 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        setPaginaActual(p => Math.max(1, p - 1));
      } else if (e.key === '+' || e.key === '=') {
        setZoom(z => Math.min(3, z + 0.25));
      } else if (e.key === '-') {
        setZoom(z => Math.max(0.5, z - 0.25));
      } else if (e.key === '0') {
        setZoom(1); setPan({ x: 0, y: 0 });
      }
    };
    const bloquearImprimir = (e) => e.preventDefault();
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('beforeprint', bloquearImprimir);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('beforeprint', bloquearImprimir);
    };
  }, [tieneAcceso, totalPaginas]);

  const cargarPatron = async () => {
    try {
      const res = await api.get(`/patrones/${id}`);
      setPatron(res.data.patron);
      setTotalPaginas(res.data.patron.paginas);
      setTieneAcceso(res.data.tieneAcceso);
      setEsPreview(res.data.esPreview);
      setProgreso(res.data.progreso);
      setPaginaActual(res.data.progreso.pagina_actual || 1);
      setEnMiLista(res.data.patron.en_mi_lista === 1);
      setDescargado(res.data.progreso.descargado_offline === 1);
    } catch (err) {
      setError(err.response?.data?.error || 'Error cargando patrón');
    } finally {
      setLoading(false);
    }
  };

  const cargarPagina = async (numero) => {
    setLoadingPagina(true);
    setPaginaError('');
    setPan({ x: 0, y: 0 }); // reset pan al cambiar página
    try {
      const res = await api.get(`/viewer/pagina/${id}/${numero}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'image/jpeg' }));
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = img.width;
          canvas.height = img.height;
          canvas.getContext('2d').drawImage(img, 0, 0);
        }
        URL.revokeObjectURL(url);
        setLoadingPagina(false);
      };
      img.onerror = () => { setPaginaError('No se pudo cargar la imagen'); setLoadingPagina(false); };
      img.src = url;
      api.post('/viewer/progreso', { patronId: id, paginaActual: numero });
    } catch (err) {
      setPaginaError(err.response?.data?.error || `Error ${err.response?.status || ''}: ${err.message}`);
      setLoadingPagina(false);
    }
  };

  // Mouse pan
  const handlePanStart = (e) => {
    if (zoom > 1) { setIsPanning(true); setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y }); }
  };
  const handlePanMove = (e) => {
    if (isPanning) setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
  };
  const handlePanEnd = () => setIsPanning(false);

  // Touch: swipe para páginas, pinch para zoom, pan con un dedo si zoom>1
  const handleTouchStart = (e) => {
    if (e.touches.length === 1) {
      touchStartX.current = e.touches[0].clientX;
      touchStartY.current = e.touches[0].clientY;
      if (zoom > 1) panStartTouch.current = { x: e.touches[0].clientX - pan.x, y: e.touches[0].clientY - pan.y };
      lastPinchDist.current = null;
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist.current = Math.sqrt(dx * dx + dy * dy);
      touchStartX.current = null;
    }
  };

  const handleTouchMove = (e) => {
    if (e.touches.length === 2 && lastPinchDist.current) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      setZoom(z => Math.min(3, Math.max(0.5, z * (dist / lastPinchDist.current))));
      lastPinchDist.current = dist;
    } else if (e.touches.length === 1 && zoom > 1 && touchStartX.current !== null) {
      setPan({ x: e.touches[0].clientX - panStartTouch.current.x, y: e.touches[0].clientY - panStartTouch.current.y });
    }
  };

  const handleTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (zoom <= 1 && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
      if (dx < 0) setPaginaActual(p => Math.min(totalPaginas, p + 1));
      else setPaginaActual(p => Math.max(1, p - 1));
    }
    touchStartX.current = null;
  };

  const toggleMiLista = async () => {
    try { const res = await api.post('/patrones/mi-lista', { patronId: id }); setEnMiLista(res.data.agregado); }
    catch (err) { console.error('Error:', err); }
  };

  const toggleOffline = async () => {
    try { const res = await api.post('/viewer/offline', { patronId: id }); setDescargado(res.data.descargado); }
    catch (err) { alert(err.response?.data?.error || 'Error'); }
  };

  const marcarCompletado = async () => {
    try { await api.post('/viewer/completar', { patronId: id }); setProgreso(p => ({ ...p, completado: true })); }
    catch (err) { console.error('Error:', err); }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-96">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-crochet-primary" />
    </div>
  );

  if (error) {
    const destino = user ? '/perfil' : '/login?redirect=/perfil';
    return (
      <div className="flex flex-col items-center justify-center h-96 px-4">
        <Lock className="w-16 h-16 text-gray-600 mb-4" />
        <h2 className="text-xl font-bold mb-2">Acceso restringido</h2>
        <p className="text-gray-400 text-center mb-4">{error}</p>
        <button onClick={() => navigate(destino)} className="btn-primary">
          {user ? 'Suscribirme ahora' : 'Iniciar sesión'}
        </button>
      </div>
    );
  }

  if (!tieneAcceso) return (
    <div className="flex flex-col items-center justify-center h-96 px-4">
      <Lock className="w-16 h-16 text-gray-600 mb-4" />
      <h2 className="text-xl font-bold mb-2">Crea una cuenta gratis</h2>
      <p className="text-gray-400 text-center mb-4">Regístrate gratis y accede a todos los patrones sin límites.</p>
      <div className="flex gap-3">
        <button onClick={() => navigate('/register')} className="btn-primary">Registrarme gratis</button>
        <button onClick={() => navigate('/login')} className="btn-secondary">Iniciar sesión</button>
      </div>
    </div>
  );

  return (
    <div className="h-screen flex flex-col select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800 shrink-0">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-400 hover:text-white">
          <ChevronLeft className="w-5 h-5" />
          <span className="hidden sm:inline">Volver</span>
        </button>
        <div className="text-center">
          <h1 className="font-semibold text-sm sm:text-base truncate max-w-xs sm:max-w-md">{patron?.titulo}</h1>
          <p className="text-xs text-gray-500">
            Página {paginaActual} de {totalPaginas}
            {esPreview && <span className="text-green-400 ml-2">GRATIS</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleMiLista} className="p-2 hover:bg-gray-800 rounded">
            <Bookmark className={`w-5 h-5 ${enMiLista ? 'fill-crochet-primary text-crochet-primary' : ''}`} />
          </button>
          <button onClick={toggleOffline} className="p-2 hover:bg-gray-800 rounded">
            <Download className={`w-5 h-5 ${descargado ? 'text-green-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        className={`flex-1 bg-gray-950 overflow-hidden relative ${zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
        onMouseDown={handlePanStart}
        onMouseMove={handlePanMove}
        onMouseUp={handlePanEnd}
        onMouseLeave={handlePanEnd}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {loadingPagina && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-gray-950/60">
            <Loader className="w-10 h-10 text-crochet-primary animate-spin" />
          </div>
        )}
        {paginaError && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="bg-red-900/80 text-red-200 px-6 py-4 rounded-lg text-center max-w-sm">
              <p className="font-bold mb-1">Error cargando página</p>
              <p className="text-sm">{paginaError}</p>
            </div>
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="absolute top-1/2 left-1/2"
          style={{
            transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            maxWidth: '100%',
            maxHeight: '100%',
            WebkitUserDrag: 'none',
            pointerEvents: 'none',
          }}
          onContextMenu={(e) => e.preventDefault()}
        />

        {/* Flechas laterales (solo desktop, siempre visibles) */}
        <button
          onClick={() => setPaginaActual(p => Math.max(1, p - 1))}
          disabled={paginaActual === 1}
          className="absolute left-2 top-1/2 -translate-y-1/2 hidden sm:flex items-center justify-center w-10 h-10 bg-black/40 hover:bg-black/70 rounded-full text-white disabled:opacity-20 transition z-20"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <button
          onClick={() => setPaginaActual(p => Math.min(totalPaginas, p + 1))}
          disabled={paginaActual === totalPaginas}
          className="absolute right-2 top-1/2 -translate-y-1/2 hidden sm:flex items-center justify-center w-10 h-10 bg-black/40 hover:bg-black/70 rounded-full text-white disabled:opacity-20 transition z-20"
        >
          <ChevronRight className="w-6 h-6" />
        </button>

        {/* Hint swipe en móvil (solo primera vez) */}
        {totalPaginas > 1 && (
          <p className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs text-gray-600 sm:hidden pointer-events-none">
            ← desliza para cambiar página →
          </p>
        )}
      </div>

      {/* Controles inferiores */}
      <div className="bg-gray-900 border-t border-gray-800 px-4 py-3 shrink-0">
        {/* Navegación páginas */}
        <div className="flex items-center justify-center gap-2 mb-3">
          <button onClick={() => setPaginaActual(1)} disabled={paginaActual === 1}
            className="p-1 hover:bg-gray-800 rounded disabled:opacity-30 flex">
            <ChevronLeft className="w-4 h-4" /><ChevronLeft className="w-4 h-4 -ml-2" />
          </button>
          <button onClick={() => setPaginaActual(p => Math.max(1, p - 1))} disabled={paginaActual === 1}
            className="p-2 hover:bg-gray-800 rounded disabled:opacity-30">
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="flex gap-1">
            {Array.from({ length: Math.min(7, totalPaginas) }, (_, i) => {
              const pageNum = Math.max(1, Math.min(totalPaginas - 6, paginaActual - 3)) + i;
              return (
                <button key={pageNum} onClick={() => setPaginaActual(pageNum)}
                  className={`w-8 h-8 rounded text-sm font-medium transition ${pageNum === paginaActual ? 'bg-crochet-primary text-white' : 'hover:bg-gray-800'}`}>
                  {pageNum}
                </button>
              );
            })}
          </div>

          <button onClick={() => setPaginaActual(p => Math.min(totalPaginas, p + 1))} disabled={paginaActual === totalPaginas}
            className="p-2 hover:bg-gray-800 rounded disabled:opacity-30">
            <ChevronRight className="w-5 h-5" />
          </button>
          <button onClick={() => setPaginaActual(totalPaginas)} disabled={paginaActual === totalPaginas}
            className="p-1 hover:bg-gray-800 rounded disabled:opacity-30 flex">
            <ChevronRight className="w-4 h-4" /><ChevronRight className="w-4 h-4 -ml-2" />
          </button>
        </div>

        {/* Zoom */}
        <div className="flex items-center justify-center gap-4">
          <button onClick={() => setZoom(z => Math.max(0.5, z - 0.25))} className="p-2 hover:bg-gray-800 rounded">
            <ZoomOut className="w-5 h-5" />
          </button>
          <span className="text-sm text-gray-400 w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(3, z + 0.25))} className="p-2 hover:bg-gray-800 rounded">
            <ZoomIn className="w-5 h-5" />
          </button>
          <div className="w-px h-6 bg-gray-700 mx-2" />
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
            className="p-2 hover:bg-gray-800 rounded text-sm text-gray-400">Reset</button>

          {paginaActual === totalPaginas && !progreso.completado && (
            <>
              <div className="w-px h-6 bg-gray-700 mx-2" />
              <button onClick={marcarCompletado} className="btn-primary text-sm flex items-center gap-1">
                <Check className="w-4 h-4" /> Completar
              </button>
            </>
          )}
        </div>
      </div>

      {/* Enlace DMCA flotante derecho */}
      <a
        href={`/dmca?patron_id=${id}&url=${encodeURIComponent(window.location.href)}`}
        className="fixed bottom-32 right-4 z-40 text-[10px] text-gray-500 hover:text-gray-300 transition md:bottom-14"
        title="Reclamar derechos de autor"
      >
        DMCA
      </a>
    </div>
  );
}
