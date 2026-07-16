import { Routes, Route, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { AuthProvider } from './hooks/useAuth';
import { AdminModeProvider } from './context/AdminMode';
import { pixelPageView } from './lib/pixel';
import Layout from './components/Layout';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import Viewer from './pages/Viewer';
import MiLista from './pages/MiLista';
import Descargas from './pages/Descargas';
import Perfil from './pages/Perfil';
import Admin from './pages/Admin';
import Catalogo from './pages/Catalogo';
import DMCA from './pages/DMCA';
import DerechosDeAutor from './pages/DerechosDeAutor';
import Coleccion from './pages/Coleccion';
import VerificarEmail from './pages/VerificarEmail';

function PageViewTracker() {
  const location = useLocation();
  useEffect(() => { pixelPageView(); }, [location.pathname]);
  return null;
}

// Captura el flag de prueba gratis del anuncio (?trial=3) y lo persiste
// hasta que el usuario complete el checkout en /perfil.
function TrialCapture() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('trial') === '3') {
      localStorage.setItem('cf_trial', '3');
    }
  }, []);
  return null;
}

function App() {
  return (
    <AuthProvider>
      <AdminModeProvider>
        <PageViewTracker />
        <TrialCapture />
        <Routes>
          <Route path="/admin" element={<Admin />} />
          <Route path="/" element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="login" element={<Login />} />
            <Route path="register" element={<Register />} />
            <Route path="patron/:id" element={<Viewer />} />
            <Route path="catalogo" element={<Catalogo />} />
            <Route path="mi-lista" element={<MiLista />} />
            <Route path="descargas" element={<Descargas />} />
            <Route path="perfil" element={<Perfil />} />
            <Route path="verificar-email" element={<VerificarEmail />} />
            <Route path="dmca" element={<DMCA />} />
            <Route path="derechos-de-autor" element={<DerechosDeAutor />} />
            <Route path="colecciones/:id" element={<Coleccion />} />
          </Route>
        </Routes>
      </AdminModeProvider>
    </AuthProvider>
  );
}

export default App;
