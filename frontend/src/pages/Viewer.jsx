import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../services/api';
import { 
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, 
  Hand, Download, Bookmark, Check, Lock,
  Plus, Minus
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
  const [error, setError] = useState('');
  const [tieneAcceso, setTieneAcceso] = useState(false);
  const [esPreview, setEsPreview] = useState(false);
  const [enMiLista, setEnMiLista] = useState(false);
  const [descargado, setDescargado] = useState(false);
  const [progreso, setProgreso] = useState({ pagina_actual: 1, completado: false });

  useEffect(() => {
    cargarPatron();
  }, [id]);

  useEffect(() => {
    if (tieneAcceso) {
      cargarPagina(paginaActual);
    }
  }, [paginaActual, tieneAcceso]);

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
    try {
      const res = await api.get(`/viewer/pagina/${id}/${numero}`, {
        responseType: 'blob'
      });

      const blob = new Blob([res.data], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);

      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
        }
      };
      img.src = url;

      // Guardar progreso
      api.post('/viewer/progreso', { patronId: id, paginaActual: numero });

    } catch (err) {
      console.error('Error cargando página:', err);
    }
  };

  const handleZoomIn = () => setZoom(z => Math.min(z + 0.25, 3));
  const handleZoomOut = () => setZoom(z => Math.max(z - 0.25, 0.5));

  const handlePanStart = (e) => {
    if (zoom > 1) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handlePanMove = (e) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    }
  };

  const handlePanEnd = () => setIsPanning(false);

  const toggleMiLista = async () => {
    try {
      const res = await api.post('/patrones/mi-lista', { patronId: id });
      setEnMiLista(res.data.agregado);
    } catch (err) {
      console.error('Error:', err);
    }
  };

  const toggleOffline = async () => {
    try {
      const res = await api.post('/viewer/offline', { patronId: id });
      setDescargado(res.data.descargado);
    } catch (err) {
      alert(err.response?.data?.error || 'Error');
    }
  };

  const marcarCompletado = async () => {
    try {
      await api.post('/viewer/completar', { patronId: id });
      setProgreso(p => ({ ...p, completado: true }));
    } catch (err) {
      console.error('Error:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-crochet-primary"></div>
      </div>
    );
  }

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

  if (!tieneAcceso) {
    return (
      <div className="flex flex-col items-center justify-center h-96 px-4">
        <Lock className="w-16 h-16 text-gray-600 mb-4" />
        <h2 className="text-xl font-bold mb-2">Crea una cuenta gratis</h2>
        <p className="text-gray-400 text-center mb-4">
          Regístrate gratis y accede a todos los patrones sin límites.
        </p>
        <div className="flex gap-3">
          <button onClick={() => navigate('/register')} className="btn-primary">
            Registrarme gratis
          </button>
          <button onClick={() => navigate('/login')} className="btn-secondary">
            Iniciar sesión
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header del viewer */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-400 hover:text-white">
          <ChevronLeft className="w-5 h-5" />
          <span className="hidden sm:inline">Volver</span>
        </button>

        <div className="text-center">
          <h1 className="font-semibold text-sm sm:text-base truncate max-w-xs sm:max-w-md">
            {patron?.titulo}
          </h1>
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
        className="flex-1 bg-gray-950 overflow-hidden relative cursor-grab active:cursor-grabbing"
        onMouseDown={handlePanStart}
        onMouseMove={handlePanMove}
        onMouseUp={handlePanEnd}
        onMouseLeave={handlePanEnd}
      >
        <canvas
          ref={canvasRef}
          className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"
          style={{
            transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            maxWidth: '100%',
            maxHeight: '100%'
          }}
        />
      </div>

      {/* Controles inferiores */}
      <div className="bg-gray-900 border-t border-gray-800 px-4 py-3">
        {/* Navegación páginas */}
        <div className="flex items-center justify-center gap-2 mb-3">
          <button 
            onClick={() => setPaginaActual(1)} 
            disabled={paginaActual === 1}
            className="p-1 hover:bg-gray-800 rounded disabled:opacity-30"
          >
            <ChevronLeft className="w-4 h-4" />
            <ChevronLeft className="w-4 h-4 -ml-2" />
          </button>
          <button 
            onClick={() => setPaginaActual(p => Math.max(1, p - 1))}
            disabled={paginaActual === 1}
            className="p-2 hover:bg-gray-800 rounded disabled:opacity-30"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="flex gap-1">
            {Array.from({ length: Math.min(7, totalPaginas) }, (_, i) => {
              const pageNum = Math.max(1, Math.min(totalPaginas - 6, paginaActual - 3)) + i;
              return (
                <button
                  key={pageNum}
                  onClick={() => setPaginaActual(pageNum)}
                  className={`w-8 h-8 rounded text-sm font-medium ${
                    pageNum === paginaActual 
                      ? 'bg-crochet-primary text-white' 
                      : 'hover:bg-gray-800'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
          </div>

          <button 
            onClick={() => setPaginaActual(p => Math.min(totalPaginas, p + 1))}
            disabled={paginaActual === totalPaginas}
            className="p-2 hover:bg-gray-800 rounded disabled:opacity-30"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setPaginaActual(totalPaginas)}
            disabled={paginaActual === totalPaginas}
            className="p-1 hover:bg-gray-800 rounded disabled:opacity-30"
          >
            <ChevronRight className="w-4 h-4" />
            <ChevronRight className="w-4 h-4 -ml-2" />
          </button>
        </div>

        {/* Zoom y herramientas */}
        <div className="flex items-center justify-center gap-4">
          <button onClick={handleZoomOut} className="p-2 hover:bg-gray-800 rounded">
            <ZoomOut className="w-5 h-5" />
          </button>
          <span className="text-sm text-gray-400 w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={handleZoomIn} className="p-2 hover:bg-gray-800 rounded">
            <ZoomIn className="w-5 h-5" />
          </button>

          <div className="w-px h-6 bg-gray-700 mx-2" />

          <button 
            onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
            className="p-2 hover:bg-gray-800 rounded text-sm"
          >
            Reset
          </button>

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
    </div>
  );
}