import { useEffect, useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { mercadoApi, type Oportunidad, type OrdenProductos, type OrdenProveedores, type OrganismoFila, type ProductoFila, type ProveedorFila, type Rango } from '@/lib/mercadoApi';
import { mesLargo, montoUyu, porcentaje, precioUyu, unidadLegible } from '@/lib/numeros';
import type { Seleccion } from '@/mercado/Mercado';
import { Barrita, Tendencia } from '@/mercado/comunes';
import { cn } from '@/lib/utils';

export type Tab = 'oportunidades' | 'productos' | 'proveedores' | 'organismos';

interface Props {
  tab: Tab;
  onTab: (t: Tab) => void;
  rango: Rango;
  q: string;
  categoria: number | null;
  version: number;
  seleccion: Seleccion | null;
  onProducto: (id: number) => void;
  onProveedor: (id: number) => void;
}

const TABS: Array<{ clave: Tab; etiqueta: string }> = [
  { clave: 'oportunidades', etiqueta: 'Qué vender' },
  { clave: 'productos', etiqueta: 'Productos' },
  { clave: 'proveedores', etiqueta: 'Competidores' },
  { clave: 'organismos', etiqueta: 'Compradores' },
];

export function Listas({ tab, onTab, rango, q, categoria, version, seleccion, onProducto, onProveedor }: Props) {
  return (
    <section className="flex flex-col px-4 pt-3 pb-6" aria-label="Rankings">
      <Tabs value={tab} onValueChange={(v) => onTab(v as Tab)}>
        <TabsList className="scroll-fino h-auto w-full justify-start gap-0.5 overflow-x-auto bg-transparent p-0">
          {TABS.map((t) => (
            <TabsTrigger key={t.clave} value={t.clave} className="rounded-full px-2.5 py-1 text-[13px]">
              {t.etiqueta}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="mt-3">
        {tab === 'oportunidades' && <Oportunidades q={q} categoria={categoria} version={version} seleccion={seleccion} onProducto={onProducto} />}
        {tab === 'productos' && <Productos rango={rango} q={q} categoria={categoria} version={version} seleccion={seleccion} onProducto={onProducto} />}
        {tab === 'proveedores' && <Proveedores rango={rango} q={q} version={version} seleccion={seleccion} onProveedor={onProveedor} />}
        {tab === 'organismos' && <Organismos rango={rango} q={q} version={version} />}
      </div>
    </section>
  );
}

function Cargando() {
  return (
    <div className="flex flex-col gap-2 pt-2">
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

function Error_({ texto }: { texto: string }) {
  return <p className="py-4 text-sm text-rojo">No se pudo cargar la lista: {texto}</p>;
}

function SinFilas({ texto }: { texto: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{texto}</p>;
}

function useCarga<T>(cargar: () => Promise<T>, deps: unknown[]): { datos: T | null; error: string | null } {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let vigente = true;
    setError(null);
    cargar()
      .then((d) => vigente && setDatos(d))
      .catch((err) => vigente && setError((err as Error).message));
    return () => {
      vigente = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { datos, error };
}

const filaClase = (activa: boolean) => cn('cursor-pointer', activa && 'bg-secondary/70 hover:bg-secondary/70');

// --- Qué vender ------------------------------------------------------------

function Oportunidades({ q, categoria, version, seleccion, onProducto }: { q: string; categoria: number | null; version: number; seleccion: Seleccion | null; onProducto: (id: number) => void }) {
  const { datos, error } = useCarga(() => mercadoApi.oportunidades(categoria, 40), [categoria, version]);
  if (error) return <Error_ texto={error} />;
  if (!datos) return <Cargando />;
  const filtro = q.trim().toLowerCase();
  const filas = filtro ? datos.filter((o) => `${o.nombre} ${o.categoria ?? ''} ${o.lider ?? ''}`.toLowerCase().includes(filtro)) : datos;
  if (filas.length === 0) return <SinFilas texto="Ningún producto tiene todavía 3 adjudicaciones en los últimos 24 meses de datos (hace falta más histórico)." />;
  const ref = filas[0]?.fecha_referencia;
  return (
    <div>
      <p className="mb-2 text-[12.5px] text-muted-foreground">
        Índice de oportunidad (0-100) sobre los últimos 24 meses de datos{ref ? ` (hasta ${mesLargo(ref)})` : ''}: cuánto se compra, cuán seguido, cuántos organismos lo piden y qué tan repartido está entre proveedores. No depende del período elegido arriba.
      </p>
      <ol className="flex flex-col gap-1.5">
        {filas.map((o, i) => (
          <OportunidadFila key={o.articulo_id} o={o} posicion={i + 1} activa={seleccion?.tipo === 'productos' && seleccion.id === o.articulo_id} onClick={() => onProducto(o.articulo_id)} />
        ))}
      </ol>
    </div>
  );
}

function OportunidadFila({ o, posicion, activa, onClick }: { o: Oportunidad; posicion: number; activa: boolean; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} aria-current={activa ? 'true' : undefined} className={cn('grid w-full grid-cols-[2ch_minmax(0,1fr)_auto] items-start gap-x-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-secondary/60', activa && 'bg-secondary/70')}>
        <span className="condensada pt-0.5 text-[13px] text-texto-3 tabular-nums">{posicion}</span>
        <span className="min-w-0">
          <span className="block truncate text-[14.5px] font-medium">{o.nombre}</span>
          <span className="block truncate text-[12.5px] text-muted-foreground">
            {o.categoria ?? 'Sin categoría'} · {montoUyu(o.monto_uyu_24m)} en 24 m · {o.organismos_24m} {o.organismos_24m === 1 ? 'comprador' : 'compradores'} · {o.proveedores_24m} {o.proveedores_24m === 1 ? 'proveedor' : 'proveedores'}
            {o.lider && o.lider_share_24m !== null ? ` · líder ${o.lider} (${porcentaje(o.lider_share_24m)})` : ''}
          </span>
          <span className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <Barrita valor={o.comp_volumen} etiqueta="volumen" />
            <Barrita valor={o.comp_recurrencia} etiqueta="frecuencia" />
            <Barrita valor={o.comp_amplitud} etiqueta="amplitud" />
            <Barrita valor={o.comp_apertura} etiqueta="apertura" />
          </span>
        </span>
        <span className="flex flex-col items-end">
          <span className="condensada text-[24px] leading-none font-semibold tabular-nums text-vidrio">{o.indice_oportunidad}</span>
          <span className="mt-1 text-[11.5px] text-muted-foreground">
            {o.precio_mediano_uyu_12m !== null ? `${precioUyu(o.precio_mediano_uyu_12m)}/${unidadLegible(o.unidad)}` : 'sin precio'}
          </span>
        </span>
      </button>
    </li>
  );
}

// --- Productos -------------------------------------------------------------

const ORDENES_PRODUCTOS: Record<OrdenProductos, string> = { monto: 'monto adjudicado', adjudicaciones: 'cantidad de adjudicaciones', organismos: 'cantidad de compradores', oportunidad: 'índice de oportunidad', crecimiento: 'crecimiento interanual', precio: 'precio mediano' };

function Productos({ rango, q, categoria, version, seleccion, onProducto }: { rango: Rango; q: string; categoria: number | null; version: number; seleccion: Seleccion | null; onProducto: (id: number) => void }) {
  const [orden, setOrden] = useState<OrdenProductos>('monto');
  const { datos, error } = useCarga(() => mercadoApi.productos(rango, { q: q || null, categoria, orden, limit: 100 }), [rango.desde, rango.hasta, q, categoria, orden, version]);
  if (error) return <Error_ texto={error} />;
  return (
    <div>
      <OrdenSelector valor={orden} opciones={ORDENES_PRODUCTOS} onCambio={(v) => setOrden(v as OrdenProductos)} total={datos?.total} mostrados={datos?.filas.length} />
      {!datos ? (
        <Cargando />
      ) : datos.filas.length === 0 ? (
        <SinFilas texto="No hay productos con adjudicaciones para ese período, categoría o búsqueda." />
      ) : (
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Producto</TableHead>
              <TableHead className="text-right">Monto</TableHead>
              <TableHead className="text-right">Adjud.</TableHead>
              <TableHead className="text-right">Compr.</TableHead>
              <TableHead className="text-right">Precio mediano</TableHead>
              <TableHead>Líder</TableHead>
              <TableHead className="text-right whitespace-nowrap">Últ. 12 m</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {datos.filas.map((p: ProductoFila) => (
              <TableRow key={p.articulo_id} onClick={() => onProducto(p.articulo_id)} className={filaClase(seleccion?.tipo === 'productos' && seleccion.id === p.articulo_id)}>
                <TableCell className="max-w-[26ch]">
                  <span className="block truncate font-medium">{p.nombre}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">{p.categoria ?? (p.codigo ? `código ${p.codigo}` : 'sin categoría')}</span>
                </TableCell>
                <TableCell className="condensada text-right tabular-nums">{montoUyu(p.monto_uyu)}</TableCell>
                <TableCell className="condensada text-right tabular-nums">{p.adjudicaciones}</TableCell>
                <TableCell className="condensada text-right tabular-nums">{p.organismos}</TableCell>
                <TableCell className="condensada text-right whitespace-nowrap tabular-nums">
                  {p.precio_mediano_uyu !== null ? (
                    <>
                      {precioUyu(p.precio_mediano_uyu)}
                      <span className="text-muted-foreground">/{unidadLegible(p.unidad)}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="max-w-[18ch]">
                  {p.lider ? (
                    <>
                      <span className="block truncate">{p.lider}</span>
                      <span className="text-[12px] text-muted-foreground">{porcentaje(p.lider_share_24m)} en 24 m</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="condensada text-right">
                  <Tendencia valor={p.variacion_12m} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function OrdenSelector({ valor, opciones, onCambio, total, mostrados }: { valor: string; opciones: Record<string, string>; onCambio: (v: string) => void; total?: number; mostrados?: number }) {
  return (
    <div className="mb-1 flex items-center justify-between gap-3">
      <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
        Ordenar por
        <Select value={valor} onValueChange={(v) => v !== null && onCambio(v)} items={opciones}>
          <SelectTrigger size="sm" className="border-transparent bg-transparent px-1 text-foreground dark:bg-transparent" aria-label="Ordenar por">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(opciones).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {total !== undefined && (
        <span className="text-[12.5px] text-muted-foreground tabular-nums">
          {mostrados !== undefined && mostrados < total ? `${mostrados} de ${total}` : total}
        </span>
      )}
    </div>
  );
}

// --- Competidores ------------------------------------------------------------

const ORDENES_PROVEEDORES: Record<OrdenProveedores, string> = { monto: 'monto adjudicado', adjudicaciones: 'cantidad de adjudicaciones', articulos: 'cantidad de productos', organismos: 'cantidad de compradores', exito: 'tasa de éxito', crecimiento: 'crecimiento interanual' };

function Proveedores({ rango, q, version, seleccion, onProveedor }: { rango: Rango; q: string; version: number; seleccion: Seleccion | null; onProveedor: (id: number) => void }) {
  const [orden, setOrden] = useState<OrdenProveedores>('monto');
  const { datos, error } = useCarga(() => mercadoApi.proveedores(rango, { q: q || null, orden, limit: 100 }), [rango.desde, rango.hasta, q, orden, version]);
  if (error) return <Error_ texto={error} />;
  return (
    <div>
      <OrdenSelector valor={orden} opciones={ORDENES_PROVEEDORES} onCambio={(v) => setOrden(v as OrdenProveedores)} total={datos?.total} mostrados={datos?.filas.length} />
      {!datos ? (
        <Cargando />
      ) : datos.filas.length === 0 ? (
        <SinFilas texto="No hay proveedores con adjudicaciones para ese período o búsqueda." />
      ) : (
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Proveedor</TableHead>
              <TableHead className="text-right">Monto</TableHead>
              <TableHead className="text-right">Adjud.</TableHead>
              <TableHead className="text-right">Prod.</TableHead>
              <TableHead className="text-right">Compr.</TableHead>
              <TableHead className="text-right">Éxito</TableHead>
              <TableHead className="text-right whitespace-nowrap">Últ. 12 m</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {datos.filas.map((p: ProveedorFila) => (
              <TableRow key={p.proveedor_id} onClick={() => onProveedor(p.proveedor_id)} className={filaClase(seleccion?.tipo === 'proveedores' && seleccion.id === p.proveedor_id)}>
                <TableCell className="max-w-[28ch]">
                  <span className="block truncate font-medium">{p.nombre}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">{p.principal_articulo ? `sobre todo ${p.principal_articulo.toLowerCase()}` : p.rut ? `RUT ${p.rut}` : 'sin RUT'}</span>
                </TableCell>
                <TableCell className="condensada text-right tabular-nums">{montoUyu(p.monto_uyu)}</TableCell>
                <TableCell className="condensada text-right tabular-nums">{p.adjudicaciones}</TableCell>
                <TableCell className="condensada text-right tabular-nums">{p.articulos}</TableCell>
                <TableCell className="condensada text-right tabular-nums">{p.organismos}</TableCell>
                <TableCell className="condensada text-right tabular-nums">
                  {p.tasa_exito !== null ? (
                    <span title={`${p.ofertas_ganadas} ganadas de ${p.ofertas_presentadas} ofertas con cuadro comparativo`}>{porcentaje(p.tasa_exito)}</span>
                  ) : (
                    <span className="text-muted-foreground" title="Sin cuadros comparativos cargados">
                      —
                    </span>
                  )}
                </TableCell>
                <TableCell className="condensada text-right">
                  <Tendencia valor={p.variacion_12m} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// --- Compradores -------------------------------------------------------------

function Organismos({ rango, q, version }: { rango: Rango; q: string; version: number }) {
  const { datos, error } = useCarga(() => mercadoApi.organismos(rango, { q: q || null, limit: 100 }), [rango.desde, rango.hasta, q, version]);
  if (error) return <Error_ texto={error} />;
  if (!datos) return <Cargando />;
  if (datos.filas.length === 0) return <SinFilas texto="No hay organismos con adjudicaciones para ese período o búsqueda." />;
  return (
    <Table className="text-[13px]">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Organismo</TableHead>
          <TableHead className="text-right">Monto</TableHead>
          <TableHead className="text-right">Llamados</TableHead>
          <TableHead className="text-right">Prov.</TableHead>
          <TableHead>Qué más compra</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {datos.filas.map((o: OrganismoFila) => (
          <TableRow key={o.organismo_id} className="hover:bg-transparent">
            <TableCell className="max-w-[26ch]">
              <span className="block truncate font-medium">{o.inciso}</span>
              {o.unidad_ejecutora && <span className="block truncate text-[12px] text-muted-foreground">{o.unidad_ejecutora}</span>}
            </TableCell>
            <TableCell className="condensada text-right tabular-nums">{montoUyu(o.monto_uyu)}</TableCell>
            <TableCell className="condensada text-right tabular-nums">{o.llamados}</TableCell>
            <TableCell className="condensada text-right tabular-nums">{o.proveedores}</TableCell>
            <TableCell className="max-w-[30ch] truncate text-[12.5px] text-muted-foreground">{(o.principales ?? []).map((n) => n.toLowerCase()).join(', ') || '—'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
