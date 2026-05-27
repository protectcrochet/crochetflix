import { createContext, useContext, useState } from 'react';
import { useAuth } from '../hooks/useAuth';

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || '';

const Ctx = createContext({ adminMode: false, toggle: () => {}, secret: '' });

export function AdminModeProvider({ children }) {
  const { user } = useAuth();
  const secret = localStorage.getItem('admin_secret') || '';
  const [adminMode, setAdminMode] = useState(false);

  const esAdmin = secret && ADMIN_EMAIL && user?.email === ADMIN_EMAIL;

  if (!esAdmin) return <Ctx.Provider value={{ adminMode: false, toggle: () => {}, secret: '' }}>{children}</Ctx.Provider>;
  return (
    <Ctx.Provider value={{ adminMode, toggle: () => setAdminMode(v => !v), secret }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAdminMode() { return useContext(Ctx); }
