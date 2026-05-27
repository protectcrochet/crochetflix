import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import { AdminModeProvider } from './context/AdminMode';
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

function App() {
  return (
    <AuthProvider>
      <AdminModeProvider>
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
            <Route path="dmca" element={<DMCA />} />
          </Route>
        </Routes>
      </AdminModeProvider>
    </AuthProvider>
  );
}

export default App;