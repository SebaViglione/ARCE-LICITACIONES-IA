import { useEffect, useState } from 'react';

// Router mínimo por pathname + query string. El servidor devuelve index.html para cualquier ruta sin extensión.

export interface Ruta {
  path: string;
  params: URLSearchParams;
}

function leer(): Ruta {
  return { path: location.pathname.replace(/\/+$/, '') || '/', params: new URLSearchParams(location.search) };
}

export function useRuta(): Ruta {
  const [ruta, setRuta] = useState<Ruta>(leer);
  useEffect(() => {
    const onCambio = () => setRuta(leer());
    window.addEventListener('popstate', onCambio);
    return () => window.removeEventListener('popstate', onCambio);
  }, []);
  return ruta;
}

export function navegar(path: string, params?: URLSearchParams | Record<string, string | null | undefined>, opciones: { reemplazar?: boolean } = {}): void {
  let qs = '';
  if (params instanceof URLSearchParams) qs = params.toString();
  else if (params) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') p.set(k, v);
    qs = p.toString();
  }
  const url = qs ? `${path}?${qs}` : path;
  if (opciones.reemplazar) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** Copia de los params con cambios aplicados (null borra la clave). */
export function conParams(base: URLSearchParams, cambios: Record<string, string | null | undefined>): URLSearchParams {
  const p = new URLSearchParams(base);
  for (const [k, v] of Object.entries(cambios)) {
    if (v === null || v === undefined || v === '') p.delete(k);
    else p.set(k, v);
  }
  return p;
}
