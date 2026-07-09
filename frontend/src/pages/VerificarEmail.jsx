import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle, XCircle, Loader, Mail } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../hooks/useAuth';

export default function VerificarEmail() {
  const [searchParams] = useSearchParams();
  const { user, login } = useAuth();
  const [estado, setEstado] = useState('cargando'); // cargando | ok | error | pendiente
  const [reenviando, setReenviando] = useState(false);
  const [reenviado, setReenviado] = useState(false);

  const success = searchParams.get('success');
  const error = searchParams.get('error');
  const token = searchParams.get('token');

  useEffect(() => {
    if (token) {
      setEstado('cargando');
      fetch(`/api/auth/verificar-email?token=${encodeURIComponent(token)}`)
        .then(async res => {
          // Intentar parsear JSON, pero no fallar si es HTML
          try {
            const data = await res.json();
            if (data.success) {
              setEstado('ok');
              setTimeout(() => window.location.replace('/'), 2000);
              return;
            }
          } catch {}
          // Si falló el parse o no era success, verificar si el usuario ya está verificado en el server
          const meRes = await fetch('/api/auth/me', {
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
          });
          if (meRes.ok) {
            const me = await meRes.json();
            if (me.user?.email_verified === 1) {
              setEstado('ok');
              setTimeout(() => window.location.replace('/'), 2000);
              return;
            }
          }
          setEstado('error');
        })
        .catch(() => setEstado('error'));
    } else if (success === '1') {
      setEstado('ok');
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

        {estado === 'ok' && (
          <>
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">¡Correo verificado!</h1>
            <p className="text-gray-400 mb-6">Ya puedes disfrutar de todos los patrones de CrochetFlix.</p>
            <Link to="/" className="btn-primary px-8 py-3 inline-block">Ir al inicio</Link>
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

        {estado === 'cargando' && (
          <Loader className="w-10 h-10 animate-spin mx-auto text-crochet-primary" />
        )}

      </div>
    </div>
  );
}
