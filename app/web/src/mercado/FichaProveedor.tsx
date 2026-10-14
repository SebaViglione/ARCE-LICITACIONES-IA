import { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import AnimatedContent from '@/components/AnimatedContent';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { mercadoApi, type FichaProveedor as Ficha, type Rango } from '@/lib/mercadoApi';
import { fechaCorta } from '@/lib/formato';
import { entero, mesLargo, montoUyu, porcentaje, precioUyu, TIPOS_COMPRA, unidadLegible } from '@/lib/numeros';
import { BarrasHorizontales, MontoMensual, Vacio } from '@/mercado/Graficos';
import { Indicador, Pastilla, Seccion, Tendencia } from '@/mercado/comunes';

interface Props {
  id: number;
  rango: Rango;
  version: number;
  onVolver: () => void;
  onProducto: (id: number) => void;
  onProveedor: (id: number) => void;
}

export function FichaProveedor({ id, rango, version, onVolver, onProducto, onProveedor }: Props) {
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    setError(null);
    mercadoApi
      .proveedor(id, rango)
      .then((f) => {
        if (!vigente) return;
        setFicha(f);
        document.getElementById('detalle-mercado')?.scrollTo({ top: 0 });
      })
      .catch((err) => vigente && setError((err as Error).message));
    return () => {
      vigente = false;
    };
  }, [id, rango, version]);

  if (error) return <p className="p-8 text-sm text-rojo">No se pudo cargar el proveedor: {error}</p>;
  if (!ficha) {
    return (
      <div className="mx-auto w-full max-w-[880px] px-8 py-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="mt-3 h-5 w-1/3" />
        <Skeleton className="mt-6 h-20 w-full" />
        <Skeleton className="mt-6 h-40 w-full" />
      </div>
    );
  }

  const r = ficha.rango;
  const totalTipos = ficha.tipos_compra.reduce((s, t) => s + t.adjudicaciones, 0);
  const periodo = !rango.desde && !rango.hasta ? 'todo el histórico' : `${rango.desde ? mesLargo(rango.desde) : '…'} a ${rango.hasta ? mesLargo(rango.hasta) : '…'}`;

  return (
    <AnimatedContent key={id} container="#detalle-mercado" distance={18} duration={0.45} ease="power3.out" initialOpacity={0} animateOpacity threshold={0} className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-5 pt-5 pb-10 md:px-8 md:pt-6">
      <Button variant="ghost" size="sm" onClick={onVolver} className="mb-3 w-fit lg:hidden">
        <ArrowLeft /> Volver a la lista
      </Button>

      <p className="text-[13px] text-muted-foreground">Proveedor{ficha.rut ? ` · RUT ${ficha.rut}` : ' · sin RUT'}</p>
      <h1 className="mt-0.5 max-w-[32ch] text-[25px] leading-[1.22] font-semibold tracking-tight">{ficha.nombre}</h1>
      <p className="mt-1 text-[13.5px] text-muted-foreground">
        {ficha.principal_articulo ? `Sobre todo vende ${ficha.principal_articulo.toLowerCase()}` : 'Sin adjudicaciones registradas'}
        {ficha.primera_fecha ? ` · gana desde ${mesLargo(ficha.primera_fecha)} hasta ${mesLargo(ficha.ultima_fecha)}` : ''}
        {ficha.variacion_12m !== null && ficha.variacion_12m !== undefined ? (
          <>
            {' '}
            · últimos 12 meses <Tendencia valor={ficha.variacion_12m} />
          </>
        ) : null}
      </p>

      <dl className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-x-5 gap-y-3 border-y border-border py-3.5">
        <Indicador texto={montoUyu(r.monto_uyu)} etiqueta={`ganado, ${periodo}`} />
        <Indicador valor={r.adjudicaciones} etiqueta={`adjudicaciones en ${r.llamados} ${r.llamados === 1 ? 'llamado' : 'llamados'}`} />
        <Indicador valor={r.articulos} etiqueta={r.articulos === 1 ? 'producto distinto' : 'productos distintos'} />
        <Indicador valor={r.organismos} etiqueta={r.organismos === 1 ? 'organismo le compra' : 'organismos le compran'} />
        <Indicador
          texto={ficha.tasa_exito !== null && ficha.tasa_exito !== undefined ? porcentaje(ficha.tasa_exito) : '—'}
          etiqueta={ficha.ofertas_presentadas ? `de éxito en ${ficha.ofertas_presentadas} ofertas` : 'sin cuadros comparativos'}
          ayuda="Ofertas ganadas sobre ofertas presentadas, en los ítems donde el portal publicó el cuadro comparativo (todo el histórico)."
        />
      </dl>

      <Seccion titulo="Cuánto gana" nota="monto adjudicado por mes, en pesos">
        <MontoMensual datos={ficha.serie} />
      </Seccion>

      <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
        <Seccion titulo="Qué vende" nota="cuota del monto">
          <BarrasHorizontales
            datos={ficha.productos.map((p) => ({
              clave: p.articulo_id,
              etiqueta: p.nombre,
              detalle: `${p.adjudicaciones} adj.${p.precio_mediano_uyu !== null && p.precio_mediano_uyu !== undefined ? ` · ${precioUyu(p.precio_mediano_uyu)}/${unidadLegible(p.unidad)}` : ''}`,
              valor: p.monto_uyu,
              share: p.share,
              onClick: () => onProducto(p.articulo_id),
            }))}
            maxFilas={12}
          />
        </Seccion>
        <Seccion titulo="A quién le vende" nota="cuota del monto">
          <BarrasHorizontales
            datos={ficha.organismos.map((o) => ({
              clave: o.organismo_id ?? 'sin',
              etiqueta: o.inciso ?? 'Sin organismo',
              detalle: o.unidad_ejecutora ?? undefined,
              valor: o.monto_uyu,
              share: o.share,
            }))}
            maxFilas={12}
          />
        </Seccion>
      </div>

      <Seccion titulo="Contra quién compite" nota="quiénes ganan los mismos productos">
        {ficha.competidores.length === 0 ? (
          <Vacio texto="Nadie más gana sus productos en el período." />
        ) : (
          <ul className="flex flex-col">
            {ficha.competidores.map((c) => (
              <li key={c.proveedor_id} className="flex flex-wrap items-baseline gap-x-3 border-t border-border/60 py-1.5 first:border-t-0">
                <button type="button" onClick={() => onProveedor(c.proveedor_id)} className="font-medium hover:underline">
                  {c.nombre}
                </button>
                <span className="text-[12.5px] text-muted-foreground">
                  {c.productos_en_comun} {c.productos_en_comun === 1 ? 'producto en común' : 'productos en común'} · {c.adjudicaciones} adj. · {montoUyu(c.monto_uyu)}
                  {c.ejemplos?.length ? ` · ${c.ejemplos.map((e) => e.toLowerCase()).join(', ')}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Seccion>

      <Seccion titulo="Cómo gana">
        {ficha.tipos_compra.length === 0 ? (
          <Vacio texto="Sin datos." />
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {ficha.tipos_compra.map((t) => (
              <li key={t.tipo_compra}>
                <Pastilla>
                  {TIPOS_COMPRA[t.tipo_compra] ?? t.tipo_compra} <span className="ml-1 text-muted-foreground">{porcentaje(totalTipos ? t.adjudicaciones / totalTipos : null)}</span>
                </Pastilla>
              </li>
            ))}
          </ul>
        )}
      </Seccion>

      <Seccion titulo="Últimas adjudicaciones" nota={ficha.ultimas.length === 25 ? 'las 25 más recientes' : undefined}>
        {ficha.ultimas.length === 0 ? (
          <Vacio texto="Sin adjudicaciones en el período." />
        ) : (
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Fecha</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead>Comprador</TableHead>
                <TableHead className="text-right">Cant.</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead className="text-right">Monto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ficha.ultimas.map((a) => (
                <TableRow key={a.adjudicacion_id} className="hover:bg-transparent">
                  <TableCell className="condensada whitespace-nowrap tabular-nums">
                    {a.url ? (
                      <a href={a.url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-azul hover:underline" title={a.objeto ?? a.arce_id}>
                        {fechaCorta(a.fecha)} <ExternalLink className="size-3" aria-hidden />
                      </a>
                    ) : (
                      fechaCorta(a.fecha)
                    )}
                  </TableCell>
                  <TableCell className="max-w-[22ch] truncate">
                    {a.articulo_id ? (
                      <button type="button" onClick={() => onProducto(a.articulo_id!)} className="truncate hover:underline">
                        {a.articulo}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">{a.objeto ?? 'sin artículo'}</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[18ch] truncate" title={`${a.inciso ?? ''} ${a.unidad_ejecutora ?? ''}`}>
                    {a.inciso ?? '—'}
                  </TableCell>
                  <TableCell className="condensada text-right whitespace-nowrap tabular-nums">
                    {a.cantidad !== null ? entero(a.cantidad) : '—'} <span className="text-muted-foreground">{unidadLegible(a.unidad)}</span>
                  </TableCell>
                  <TableCell className="condensada text-right whitespace-nowrap tabular-nums">{a.precio_base_uyu !== null ? precioUyu(a.precio_base_uyu) : a.precio_unitario !== null ? `${a.precio_unitario} ${a.moneda}` : '—'}</TableCell>
                  <TableCell className="condensada text-right tabular-nums">{montoUyu(a.monto_uyu)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Seccion>
    </AnimatedContent>
  );
}
