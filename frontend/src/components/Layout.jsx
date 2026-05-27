import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useAdminMode } from '../context/AdminMode';
import { Home, Bookmark, Download, User, LogOut, LayoutGrid, Pencil } from 'lucide-react';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { adminMode, toggle: toggleAdmin, secret: adminSecret } = useAdminMode();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-crochet-dark">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-crochet-dark/95 backdrop-blur border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-6">
          <Link to="/" className="flex items-center">
            <span className="text-2xl font-bold text-crochet-primary">CrochetFlix</span>
          </Link>

          <Link to="/catalogo" className="hidden sm:flex items-center gap-1.5 text-sm text-gray-300 hover:text-white transition">
            <LayoutGrid className="w-4 h-4" /> Catálogo
          </Link>

          <div className="flex-1" />

          {user ? (
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-400 hidden sm:block">{user.email}</span>
              <button onClick={handleLogout} className="p-2 hover:bg-gray-800 rounded-full">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <Link to="/login" className="btn-primary text-sm">Iniciar sesión</Link>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="pb-20">
        <Outlet />
      </main>

      {/* Botón flotante modo admin */}
      {adminSecret && (
        <button
          onClick={toggleAdmin}
          title={adminMode ? 'Desactivar modo admin' : 'Activar modo admin'}
          className={`fixed bottom-24 right-4 z-50 flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold shadow-lg transition md:bottom-6 ${adminMode ? 'bg-yellow-500 text-black' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
          <Pencil className="w-3.5 h-3.5" />
          {adminMode ? 'Admin ON' : 'Admin'}
        </button>
      )}

      {/* Footer */}
      <footer className="hidden md:block border-t border-gray-800 py-4 text-center text-xs text-gray-600">
        <Link to="/dmca" className="hover:text-gray-400 transition">Derechos de Autor / DMCA</Link>
        <span className="mx-2">·</span>
        <span>© {new Date().getFullYear()} CrochetFlix</span>
      </footer>

      {/* Bottom Navigation (mobile) */}
      <nav className="fixed bottom-0 left-0 right-0 bg-crochet-dark/95 backdrop-blur border-t border-gray-800 md:hidden">
        <div className="flex justify-around py-2">
          <Link to="/" className="flex flex-col items-center p-2 text-gray-400 hover:text-white">
            <Home className="w-5 h-5" />
            <span className="text-xs mt-1">Inicio</span>
          </Link>
          <Link to="/catalogo" className="flex flex-col items-center p-2 text-gray-400 hover:text-white">
            <LayoutGrid className="w-5 h-5" />
            <span className="text-xs mt-1">Catálogo</span>
          </Link>
          <Link to="/mi-lista" className="flex flex-col items-center p-2 text-gray-400 hover:text-white">
            <Bookmark className="w-5 h-5" />
            <span className="text-xs mt-1">Mi lista</span>
          </Link>
          <Link to="/descargas" className="flex flex-col items-center p-2 text-gray-400 hover:text-white">
            <Download className="w-5 h-5" />
            <span className="text-xs mt-1">Descargas</span>
          </Link>
          <Link to="/perfil" className="flex flex-col items-center p-2 text-gray-400 hover:text-white">
            <User className="w-5 h-5" />
            <span className="text-xs mt-1">Perfil</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}