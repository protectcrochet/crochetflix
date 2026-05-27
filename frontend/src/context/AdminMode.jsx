import { createContext, useContext, useState } from 'react';

const Ctx = createContext({ adminMode: false, toggle: () => {}, secret: '' });

export function AdminModeProvider({ children }) {
  const secret = localStorage.getItem('admin_secret') || '';
  const [adminMode, setAdminMode] = useState(false);
  if (!secret) return <Ctx.Provider value={{ adminMode: false, toggle: () => {}, secret: '' }}>{children}</Ctx.Provider>;
  return (
    <Ctx.Provider value={{ adminMode, toggle: () => setAdminMode(v => !v), secret }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAdminMode() { return useContext(Ctx); }
