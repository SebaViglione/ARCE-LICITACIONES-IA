import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Categoria, Rango, ResumenMercado } from '@/lib/mercadoApi';
import { mercadoApi } from '@/lib/mercadoApi';
import { conParams, navegar, type Ruta } from '@/lib/ruta';
import { BarraMercado } from '@/mercado/BarraMercado';
import { Listas, type Tab } from '@/mercado/Listas';
import { FichaProducto } from '@/mercado/FichaProducto';
import { FichaProveedor } from '@/mercado/FichaProveedor';
import { Panorama } from '@/mercado/Panorama';
import { VacioMercado } from '@/mercado/VacioMercado';

// Tablero de inteligencia de mercado sobre el histórico de ARCE: qué se compra, a qué precio, quién gana.
// Estado en la URL: /mercado?tab=&desde=&hasta=&q=&categoria=  ·  /mercado/productos/:id  ·  /mercado/proveedores/:id

export interface Seleccion {
  tipo: 'productos' | 'proveedores';
  id: number;
}

export function Mercado({ ruta }: { ruta: Ruta }) {
  const params = ruta.params;
  const tab = (params.get('tab') as Tab | null) ?? 'oportunidades';
  const rango = useMemo<Rango>(() => ({ desde: params.get('desde'), hasta: params.get('hasta') }), [params]);
  const q = params.get('q') ?? '';
  const categoria = params.get('categoria') ? Number(params.get('categoria')) : null;

  const [resumen, setResumen] = useState<ResumenMercado | null>(null);
  const [errorResumen, setErrorResumen] = useState<string | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [refrescando, setRefrescando] = useState(false);
  const [version, setVersion] = useState(0); // sube cuando termina un refresco: las listas se recargan

  const cargarResumen = useCallback(async () => {
    try {
      const r = await mercadoApi.resumen();
      setResumen(r);
      setErrorResumen(null);
      return r;
    } catch (err) {
      setErrorResumen((err as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    void cargarResumen();
  }, [cargarResumen]);

  useEffect(() => {
    mercadoApi
      .categorias(rango)
      .then(setCategorias)
      .catch(() => setCategorias([]));
  }, [rango, version]);

  // Mientras se recalculan las vistas, se consulta el estado cada 3 s
  useEffect(() => {
    if (!refrescando) return;
    const t = setInterval(async () => {
      try {
        const e = await mercadoApi.estado();
        if (!e.refresco_en_curso) {
          setRefrescando(false);
          await cargarResumen();
          setVersion((v) => v + 1);
        }
      } catch {
        /* se reintenta */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [refrescando, cargarResumen]);

  const refrescar = useCallback(async () => {
    setRefrescando(true);
    try {
      await mercadoApi.refrescar();
    } catch (err) {
      setRefrescando(false);
      throw err;
    }
  }, []);

  const seleccion = useMemo<Seleccion | null>(() => {
    const m = /^\/mercado\/(productos|proveedores)\/(\d+)$/.exec(ruta.path);
    return m ? { tipo: m[1] as Seleccion['tipo'], id: Number(m[2]) } : null;
  }, [ruta.path]);

  const cambiarParams = useCallback((cambios: Record<string, string | null | undefined>) => navegar(location.pathname, conParams(new URLSearchParams(location.search), cambios), { reemplazar: true }), []);
  const abrirProducto = useCallback((id: number) => navegar(`/mercado/productos/${id}`, new URLSearchParams(location.search)), []);
  const abrirProveedor = useCallback((id: number) => navegar(`/mercado/proveedores/${id}`, new URLSearchParams(location.search)), []);
  const volver = useCallback(() => navegar('/mercado', new URLSearchParams(location.search)), []);

  const vacio = resumen !== null && resumen.hechos === 0;

  return (
    <div className="flex h-full flex-col">
      <BarraMercado resumen={resumen} error={errorResumen} rango={rango} q={q} categoria={categoria} categorias={categorias} refrescando={refrescando} onCambio={cambiarParams} onRefrescar={refrescar} />
      {vacio ? (
        <VacioMercado resumen={resumen} />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,11fr)_minmax(0,10fr)]">
          <div className={`scroll-fino min-h-0 overflow-y-auto border-r border-border ${seleccion ? 'hidden lg:block' : 'block'}`}>
            <Listas tab={tab} onTab={(t) => cambiarParams({ tab: t })} rango={rango} q={q} categoria={categoria} version={version} seleccion={seleccion} onProducto={abrirProducto} onProveedor={abrirProveedor} />
          </div>
          <div id="detalle-mercado" className={`scroll-fino min-h-0 overflow-y-auto ${seleccion ? 'block' : 'hidden lg:block'}`}>
            {seleccion?.tipo === 'productos' ? (
              <FichaProducto key={seleccion.id} id={seleccion.id} rango={rango} version={version} onVolver={volver} onProveedor={abrirProveedor} />
            ) : seleccion?.tipo === 'proveedores' ? (
              <FichaProveedor key={seleccion.id} id={seleccion.id} rango={rango} version={version} onVolver={volver} onProducto={abrirProducto} onProveedor={abrirProveedor} />
            ) : (
              <Panorama resumen={resumen} rango={rango} categoria={categoria} version={version} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
