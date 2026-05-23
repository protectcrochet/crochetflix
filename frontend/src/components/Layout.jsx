import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Home, Bookmark, Download, User, LogOut, Search } from 'lucide-react';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-crochet-dark">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-crochet-dark/95 backdrop-blur border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="text-2xl font-bold text-crochet-primary">🧶 CrochetFlix</span>
          </Link>

          <div className="flex items-center gap-4">
            <button className="p-2 hover:bg-gray-800 rounded-full">
              <Search className="w-5 h-5" />
            </button>

            {user ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-400 hidden sm:block">{user.email}</span>
                <button onClick={handleLogout} className="p-2 hover:bg-gray-800 rounded-full">
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <Link to="/login" className="btn-primary text-sm">Iniciar sesión</Link>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="pb-20">
        <Outlet />
      </main>

      {/* Bottom Navigation (mobile) */}
      <nav className="fixed bottom-0 left-0 right-0 bg-crochet-dark/95 backdrop-blur border-t border-gray-800 md:hidden">
        <div className="flex justify-around py-2">
          <Link to="/" className="flex flex-col items-center p-2 text-gray-400 hover:text-white">
            <Home className="w-5 h-5" />
            <span className="text-xs mt-1">Inicio</span>
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