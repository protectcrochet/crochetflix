import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../services/api';
import { Crown } from 'lucide-react';
import {
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut,
  Download, Bookmark, Check, Lock, Loader, X as XIcon
} from 'lucide-react';

const IDIOMAS_TRAD = [
  { v: 'es', flag: '🇪🇸' },
  { v: 'en', flag: '🇺🇸' },
  { v: 'pt', flag: '🇧🇷' },
  { v: 'ru', flag: '🇷🇺' },
  { v: 'fr', flag: '🇫🇷' },
];
import { PRECIOS, detectarMoneda } from '../utils/geoMoneda';

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
  const [errorAcceso, setErrorAcceso] = useState(null);
  const [patronesUsados, setPatronesUsados] = useState(0);
  const [moneda, setMoneda] = useState('USD');
  const [suscLoading, setSuscLoading] = useState(false);
  const [referidos, setReferidos] = useState(null);
  const [copiado, setCopiado] = useState(false);
  const [esPreview, setEsPreview] = useState(false);
  const [enMiLista, setEnMiLista] = useState(false);
  const [descargado, setDescargado] = useState(false);
  const [progreso, setProgreso] = useState({ pagina_actual: 1, completado: false });

  const [tradPanel, setTradPanel] = useState(false);
  const [idiomaTraduccion, setIdiomaTraduccion] = useState('es');
  const [textoTraducido, setTextoTraducido] = useState('');
  const [traduciendo, setTraduciendo] = useState(false);
  const traduccionesCache = useRef({});

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
      setErrorAcceso(res.data.errorAcceso || null);
      setPatronesUsados(res.data.patronesUsados || 0);
      setEsPreview(res.data.esPreview);
      setProgreso(res.data.progreso);
      setPaginaActual(res.data.progreso.pagina_actual || 1);
      setEnMiLista(res.data.patron.en_mi_lista === 1);
      setDescargado(res.data.progreso.descargado_offline === 1);
      if (!res.data.tieneAcceso && res.data.errorAcceso === 'limite_free') {
        detectarMoneda().then(setMoneda);
        api.get('/auth/referidos').then(r => setReferidos(r.data)).catch(() => {});
      }
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

  const traducir = async (idioma) => {
    const key = `${id}_${idioma}`;
    if (traduccionesCache.current[key]) { setTextoTraducido(traduccionesCache.current[key]); return; }
    setTraduciendo(true);
    setTextoTraducido('');
    try {
      const res = await api.post(`/patrones/${id}/traducir`, { idioma });
      traduccionesCache.current[key] = res.data.texto;
      setTextoTraducido(res.data.texto);
    } catch (err) {
      setTextoTraducido(`Error: ${err.response?.data?.error || 'No se pudo traducir'}`);
    } finally {
      setTraduciendo(false);
    }
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

  if (!tieneAcceso && errorAcceso === 'sin_registro') return (
    <div className="flex flex-col items-center justify-center min-h-96 px-4 py-12 text-center">
      <Lock className="w-16 h-16 text-gray-600 mb-4" />
      <h2 className="text-xl font-bold mb-2">Crea una cuenta gratis</h2>
      <p className="text-gray-400 mb-1">Regístrate gratis: <strong className="text-white">3 patrones de prueba</strong> y luego <strong className="text-white">1 nuevo gratis cada mes</strong>.</p>
      <p className="text-gray-500 text-sm mb-6">No necesitas tarjeta de crédito.</p>
      <div className="flex gap-3 flex-wrap justify-center">
        <button onClick={() => navigate(`/register?redirect=/patron/${id}`)} className="btn-primary">Registrarme gratis</button>
        <button onClick={() => navigate(`/login?redirect=/patron/${id}`)} className="btn-secondary">Iniciar sesión</button>
      </div>
    </div>
  );

  if (!tieneAcceso && errorAcceso === 'limite_free') {
    const precio = PRECIOS[moneda] || PRECIOS['USD'];
    const now = new Date();
    const primeroDeSiguiente = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const diasFalta = Math.ceil((primeroDeSiguiente - now) / (1000 * 60 * 60 * 24));
    const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const suscribirse = async () => {
      setSuscLoading(true);
      try {
        const res = await api.post('/stripe/checkout', { plan: 'mensual' });
        window.location.href = res.data.checkout_url;
      } catch { setSuscLoading(false); }
    };
    return (
      <div className="flex flex-col items-center justify-center min-h-96 px-4 py-12 text-center max-w-md mx-auto">
        <Crown className="w-16 h-16 text-yellow-400 mb-4" />
        <h2 className="text-2xl font-bold mb-2">Ya usaste tu patrón gratis de este mes</h2>
        <p className="text-gray-400 mb-1">
          Con tu cuenta gratuita tienes <strong className="text-white">3 patrones de prueba</strong> y luego <strong className="text-white">1 patrón nuevo cada mes</strong>.
        </p>
        <p className="text-gray-500 text-sm mb-6">
          Tu próximo patrón gratis se desbloquea en <strong className="text-white">{diasFalta} {diasFalta === 1 ? 'día' : 'días'}</strong> (1 de {meses[primeroDeSiguiente.getMonth()]}).
        </p>

        <div className="w-full bg-gray-800 border border-yellow-600/40 rounded-2xl p-6 mb-6">
          <p className="text-xs text-yellow-400 font-semibold uppercase tracking-wide mb-1">Premium mensual</p>
          <p className="text-4xl font-bold text-white mb-1">{precio.mensual}</p>
          <p className="text-gray-500 text-sm mb-4">por mes · cancela cuando quieras</p>
          <ul className="text-left text-sm text-gray-300 space-y-2 mb-5">
            <li>✅ Acceso a <strong>todos los patrones</strong></li>
            <li>✅ Sin publicidad</li>
            <li>✅ Vista offline de tus patrones favoritos</li>
            <li>✅ Guarda tu progreso de lectura</li>
          </ul>
          <button onClick={suscribirse} disabled={suscLoading}
            className="w-full py-3 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-xl transition disabled:opacity-50">
            {suscLoading ? <Loader className="w-5 h-5 animate-spin inline" /> : `Suscribirme por ${precio.mensual}/mes`}
          </button>
        </div>

        {/* Referidos */}
        {referidos && (
          <div className="w-full bg-gray-800/60 border border-gray-700 rounded-2xl p-5 mb-4 text-left">
            <p className="font-semibold text-sm text-white mb-1">🎁 ¿No quieres pagar? Invita amigas</p>
            <p className="text-xs text-gray-400 mb-3">Por cada 3 amigas que se suscriban, ganas <strong className="text-white">1 mes Premium gratis</strong>.</p>
            <div className="flex gap-1.5 mb-2">
              {[1,2,3].map(n => (
                <div key={n} className={`flex-1 h-1.5 rounded-full ${referidos.convertidos >= n ? 'bg-yellow-400' : 'bg-gray-600'}`} />
              ))}
            </div>
            <p className="text-xs text-gray-500 mb-3">{referidos.convertidos}/3 amigas suscritas</p>
            <div className="flex gap-2">
              <div className="flex-1 bg-gray-700 rounded px-2 py-1.5 text-xs text-gray-300 font-mono truncate">
                {window.location.origin}/register?ref={referidos.codigo}
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/register?ref=${referidos.codigo}`);
                  setCopiado(true);
                  setTimeout(() => setCopiado(false), 2000);
                }}
                className={`px-3 py-1.5 rounded text-xs font-semibold transition shrink-0 ${copiado ? 'bg-green-600 text-white' : 'bg-crochet-primary hover:opacity-90 text-white'}`}>
                {copiado ? '¡Copiado!' : 'Copiar'}
              </button>
            </div>
          </div>
        )}

        <p className="text-xs text-gray-600 mb-2">¿Ya eres premium? <button onClick={() => navigate('/perfil')} className="text-crochet-primary hover:underline">Revisa tu cuenta</button></p>
        <button onClick={() => navigate(-1)} className="text-sm text-gray-500 hover:text-gray-300">← Volver al catálogo</button>
      </div>
    );
  }

  if (!tieneAcceso) return (
    <div className="flex flex-col items-center justify-center h-96 px-4">
      <Lock className="w-16 h-16 text-gray-600 mb-4" />
      <h2 className="text-xl font-bold mb-2">Acceso restringido</h2>
      <p className="text-gray-400 text-center mb-4">No tienes acceso a este patrón.</p>
      <button onClick={() => navigate('/perfil')} className="btn-primary">Ver mi suscripción</button>
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
            {(() => { const PLACEHOLDERS = ['Diseñadora','Diseñadora ','Telegram','N/A','']; const d = patron?.diseñadora && !PLACEHOLDERS.includes(patron.diseñadora.trim()) ? patron.diseñadora : (patron?.autor && !PLACEHOLDERS.includes(patron?.autor?.trim()) ? patron.autor : null); return d ? <span className="text-gray-400 mr-2">{d} ·</span> : null; })()}
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

          {user?.tier === 'premium' && (
            <>
              <div className="w-px h-6 bg-gray-700 mx-2" />
              <button onClick={() => { setTradPanel(v => !v); setTextoTraducido(''); }}
                className={`text-sm px-3 py-1 rounded-full border transition ${tradPanel ? 'border-crochet-primary text-crochet-primary' : 'border-gray-600 text-gray-400 hover:border-gray-400'}`}>
                Traducir
              </button>
            </>
          )}

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

      {/* Panel de traducción */}
      {tradPanel && (
        <div className="fixed inset-x-0 bottom-0 z-50 bg-gray-900 border-t border-gray-700 rounded-t-2xl shadow-2xl max-h-[60vh] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 shrink-0">
            <span className="text-sm font-semibold text-gray-300">Elige el idioma</span>
            <button onClick={() => setTradPanel(false)} className="p-1 hover:bg-gray-800 rounded">
              <XIcon className="w-4 h-4" />
            </button>
          </div>
          <div className="flex justify-center gap-5 px-4 pb-4 shrink-0">
            {IDIOMAS_TRAD.map(i => (
              <button key={i.v} onClick={() => { setIdiomaTraduccion(i.v); traducir(i.v); }}
                className={`text-3xl transition-transform hover:scale-110 active:scale-95 ${idiomaTraduccion === i.v && textoTraducido ? 'ring-2 ring-crochet-primary rounded-full' : ''}`}>
                {i.flag}
              </button>
            ))}
          </div>
          {(traduciendo || textoTraducido) && (
            <div className="flex-1 overflow-y-auto px-4 pb-4 text-sm text-gray-300 leading-relaxed whitespace-pre-wrap border-t border-gray-800 pt-3">
              {traduciendo
                ? <div className="flex items-center gap-2 text-gray-500 py-4 justify-center"><Loader className="w-4 h-4 animate-spin" /> Traduciendo...</div>
                : textoTraducido}
            </div>
          )}
        </div>
      )}

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
