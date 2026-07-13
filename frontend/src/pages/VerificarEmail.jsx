import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle, XCircle, Loader, Mail } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../hooks/useAuth';

export default function VerificarEmail() {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const [estado, setEstado] = useState('cargando');
  const [reenviando, setReenviando] = useState(false);
  const [reenviado, setReenviado] = useState(false);

  const token = searchParams.get('token');
  const error = searchParams.get('error');

  useEffect(() => {
    if (token) {
      // Verificar el token directamente desde el frontend
      api.get(`/auth/verificar-email?token=${token}`)
        .then(() => setEstado('ok'))
        .catch(() => setEstado('error'));
    } else if (error) {
      setEstado('error');
    } else {
      setEstado('pendiente');
    }
  }, []);

  const reenviar = async () => {
    setReenviando(true);
    try {
      await api.post('/auth/reenviar-verificacion');
      setReenviado(true);
    } catch {
      // silencioso
    } finally {
      setReenviando(false);
    }
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">

        {estado === 'cargando' && (
          <>
            <Loader className="w-10 h-10 animate-spin mx-auto text-crochet-primary mb-4" />
            <p className="text-gray-400">Verificando tu correo...</p>
          </>
        )}

        {estado === 'ok' && (
          <>
            <div className="w-20 h-20 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-10 h-10 text-white" />
            </div>
            <p className="text-crochet-primary text-sm font-semibold tracking-widest uppercase mb-2">Bienvenida a</p>
            <h1 className="text-4xl font-extrabold mb-3 tracking-tight">CrochetFlix</h1>
            <p className="text-gray-400 mb-1">Tu correo ha sido verificado.</p>
            <p className="text-gray-500 text-sm mb-8">Ya puedes explorar cientos de patrones de crochet.</p>
            <button
              onClick={() => window.location.replace('/')}
              className="btn-primary px-10 py-3 text-base font-bold"
            >
              Entrar a CrochetFlix
            </button>
          </>
        )}

        {estado === 'error' && (
          <>
            <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">Enlace inválido</h1>
            <p className="text-gray-400 mb-6">
              El enlace expiró o ya fue usado. Solicita uno nuevo desde tu cuenta.
            </p>
            {user && !reenviado && (
              <button onClick={reenviar} disabled={reenviando} className="btn-primary px-8 py-3">
                {reenviando ? <Loader className="w-5 h-5 animate-spin inline" /> : 'Reenviar correo de verificación'}
              </button>
            )}
            {reenviado && <p className="text-green-400">¡Correo reenviado! Revisa tu bandeja.</p>}
            {!user && (
              <Link to="/login" className="btn-primary px-8 py-3 inline-block">Iniciar sesión</Link>
            )}
          </>
        )}

        {estado === 'pendiente' && (
          <>
            <Mail className="w-16 h-16 text-crochet-primary mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">Verifica tu correo</h1>
            <p className="text-gray-400 mb-2">
              Te enviamos un enlace de verificación a <strong className="text-white">{user?.email || 'tu correo'}</strong>.
            </p>
            <p className="text-gray-500 text-sm mb-6">Revisa tu bandeja de entrada y carpeta de spam.</p>
            {user && !reenviado && (
              <button onClick={reenviar} disabled={reenviando} className="text-crochet-primary text-sm underline">
                {reenviando ? 'Enviando...' : '¿No lo recibiste? Reenviar'}
              </button>
            )}
            {reenviado && <p className="text-green-400 text-sm">¡Correo reenviado!</p>}
          </>
        )}

      </div>
    </div>
  );
}
