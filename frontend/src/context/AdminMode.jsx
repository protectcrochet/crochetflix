import { createContext, useContext, useState } from 'react';
import { useAuth } from '../hooks/useAuth';

const Ctx = createContext({ adminMode: false, toggle: () => {}, secret: '' });

export function AdminModeProvider({ children }) {
  const { user, adminSecret } = useAuth();
  const [adminMode, setAdminMode] = useState(false);

  const esAdmin = !!(user?.is_admin && adminSecret);

  if (!esAdmin) return <Ctx.Provider value={{ adminMode: false, toggle: () => {}, secret: '' }}>{children}</Ctx.Provider>;
  return (
    <Ctx.Provider value={{ adminMode, toggle: () => setAdminMode(v => !v), secret: adminSecret }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAdminMode() { return useContext(Ctx); }
