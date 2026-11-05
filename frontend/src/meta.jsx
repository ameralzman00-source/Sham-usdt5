import React, { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";

const MetaCtx = createContext({
  assets: [],
  fiats: [],
  paymentTypes: [],
  settings: {},
  payName: (id) => id,
  reload: () => {}
});

export function MetaProvider({ children }) {
  const [meta, setMeta] = useState({ assets: [], fiats: [], paymentTypes: [], settings: {} });

  async function reload() {
    try {
      const d = await api("/api/meta");
      setMeta(d);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    reload();
    const t = setInterval(reload, 15000);
    return () => clearInterval(t);
  }, []);

  function payName(id) {
    const p = (meta.paymentTypes || []).find((x) => x.id === id);
    return p ? p.name : id;
  }

  return <MetaCtx.Provider value={{ ...meta, payName, reload }}>{children}</MetaCtx.Provider>;
}

export function useMeta() {
  return useContext(MetaCtx);
}
