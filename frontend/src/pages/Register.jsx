import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Eye, EyeOff, Mail } from 'lucide-react';
import { pixelLead } from '../lib/pixel';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [registrado, setRegistrado] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden');
      return;
    }

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres');
      return;
    }

    setLoading(true);

    try {
      const ref = localStorage.getItem('cf_ref') || undefined;
      await register(email, password, ref);
      localStorage.removeItem('cf_ref');
      pixelLead();
      setRegistrado(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al registrarse');
    } finally {
      setLoading(false);
    }
  };

  if (registrado) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="w-20 h-20 bg-crochet-primary/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <Mail className="w-10 h-10 text-crochet-primary" />
          </div>
          <h1 className="text-2xl font-bold mb-3">Revisa tu correo</h1>
          <p className="text-gray-300 mb-2">
            Enviamos un enlace de verificación a
          </p>
          <p className="text-white font-semibold text-lg mb-6">{email}</p>

          <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-xl px-5 py-4 mb-6 text-left">
            <p className="text-yellow-300 text-sm font-semibold mb-1">📬 ¿No lo ves?</p>
            <p className="text-yellow-200/80 text-sm leading-relaxed">
              Revisa tu carpeta de <strong>spam o correo no deseado</strong>. A veces los correos de verificación llegan ahí.
            </p>
          </div>

          <p className="text-gray-500 text-sm">
            Una vez que verifiques tu correo podrás acceder a CrochetFlix.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold mb-6 text-center">Crear cuenta</h1>

        {error && (
          <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-2 rounded mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-4 py-2 focus:outline-none focus:border-crochet-primary"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Contraseña</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-4 py-2 pr-10 focus:outline-none focus:border-crochet-primary"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 text-gray-500"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Confirmar contraseña</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-4 py-2 focus:outline-none focus:border-crochet-primary"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full btn-primary py-3 disabled:opacity-50"
          >
            {loading ? 'Creando cuenta...' : 'Crear cuenta'}
          </button>
        </form>

        <p className="text-center mt-4 text-gray-400">
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="text-crochet-primary hover:underline">Inicia sesión</Link>
        </p>
      </div>
    </div>
  );
}
