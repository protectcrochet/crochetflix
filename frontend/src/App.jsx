import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import Layout from './components/Layout';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import Viewer from './pages/Viewer';
import MiLista from './pages/MiLista';
import Descargas from './pages/Descargas';
import Perfil from './pages/Perfil';
import Catalogo from './pages/Catalogo';
import Admin from './pages/Admin';
import VerificarEmail from './pages/VerificarEmail';

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route path="patron/:id" element={<Viewer />} />
          <Route path="mi-lista" element={<MiLista />} />
          <Route path="descargas" element={<Descargas />} />
          <Route path="perfil" element={<Perfil />} />
          <Route path="catalogo" element={<Catalogo />} />
          <Route path="verificar-email" element={<VerificarEmail />} />
        </Route>
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;