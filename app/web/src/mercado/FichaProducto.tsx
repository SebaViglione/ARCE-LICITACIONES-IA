import { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import AnimatedContent from '@/components/AnimatedContent';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { mercadoApi, type FichaProducto as Ficha, type Rango } from '@/lib/mercadoApi';
import { fechaCorta } from '@/lib/formato';
import { entero, mesLargo, montoUyu, porcentaje, precioUyu, TIPOS_COMPRA, unidadLegible } from '@/lib/numeros';
import { BarrasHorizontales, MontoMensual, PrecioMensual, RangoPrecios, Vacio } from '@/mercado/Graficos';
import { Barrita, Indicador, Pastilla, Seccion, Tendencia } from '@/mercado/comunes';

interface Props {
  id: number;
  rango: Rango;
  version: number;
  onVolver: () => void;
  onProveedor: (id: number) => void;
}

function describirPeriodo(r: Rango): string {
  if (!r.desde && !r.hasta) return 'todo el histórico';
  if (r.desde && r.hasta) return `${mesLargo(r.desde)} a ${mesLargo(r.hasta)}`;
  return r.desde ? `desde ${mesLargo(r.desde)}` : `hasta ${mesLargo(r.hasta)}`;
}

export function FichaProducto({ id, rango, version, onVolver, onProveedor }: Props) {
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    setError(null);
    mercadoApi
      .producto(id, rango)
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

  if (error) return <p className="p-8 text-sm text-rojo">No se pudo cargar el producto: {error}</p>;
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

  const unidad = unidadLegible(ficha.unidad_principal);
  const r = ficha.rango;
  const periodo = describirPeriodo(rango);
  const conOportunidad = ficha.indice_oportunidad !== null && ficha.indice_oportunidad !== undefined;
  const totalTipos = ficha.tipos_compra.reduce((s, t) => s + t.adjudicaciones, 0);

  return (
    <AnimatedContent key={id} container="#detalle-mercado" distance={18} duration={0.45} ease="power3.out" initialOpacity={0} animateOpacity threshold={0} className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-5 pt-5 pb-10 md:px-8 md:pt-6">
      <Button variant="ghost" size="sm" onClick={onVolver} className="mb-3 w-fit lg:hidden">
        <ArrowLeft /> Volver a la lista
      </Button>

      <p className="text-[13px] text-muted-foreground">{ficha.categoria ?? 'Sin categoría'}</p>
      <h1 className="mt-0.5 max-w-[32ch] text-[25px] leading-[1.22] font-semibold tracking-tight">{ficha.nombre}</h1>
      <p className="mt-1 text-[13.5px] text-muted-foreground">
        {ficha.codigo ? `Código ${ficha.codigo} · ` : ''}se compra por {unidad}
        {ficha.unidades.length > 1 ? ` (también ${ficha.unidades.filter((u) => u.unidad !== ficha.unidad_principal).map((u) => unidadLegible(u.unidad)).join(', ')})` : ''}
        {ficha.primera_fecha ? ` · datos de ${mesLargo(ficha.primera_fecha)} a ${mesLargo(ficha.ultima_fecha)}` : ''}
      </p>

      {conOportunidad && (
        <div className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex flex-col items-center">
            <span className="condensada text-[40px] leading-none font-semibold tabular-nums text-vidrio">{ficha.indice_oportunidad}</span>
            <span className="mt-1 text-[11.5px] text-muted-foreground">oportunidad</span>
          </div>
          <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            <Barrita valor={ficha.comp_volumen} etiqueta="volumen" />
            <Barrita valor={ficha.comp_recurrencia} etiqueta="frecuencia" />
            <Barrita valor={ficha.comp_amplitud} etiqueta="amplitud" />
            <Barrita valor={ficha.comp_apertura} etiqueta="apertura" />
            <p className="col-span-full text-[12.5px] text-muted-foreground">
              Sobre los últimos 24 meses de datos: {montoUyu(ficha.monto_uyu_12m)} adjudicados en los últimos 12 ({<Tendencia valor={ficha.variacion_12m} />} interanual), {ficha.llamados_24m} llamados, {ficha.organismos_24m} compradores, {ficha.proveedores_24m} proveedores
              {ficha.hhi_24m !== null && ficha.hhi_24m !== undefined ? `, concentración HHI ${Math.round(ficha.hhi_24m * 100) / 100}` : ''}.
            </p>
          </div>
        </div>
      )}

      <dl className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-x-5 gap-y-3 border-y border-border py-3.5">
        <Indicador texto={montoUyu(r.monto_uyu)} etiqueta={`adjudicado, ${periodo}`} />
        <Indicador valor={r.adjudicaciones} etiqueta={`adjudicaciones en ${r.llamados} ${r.llamados === 1 ? 'llamado' : 'llamados'}`} />
        <Indicador valor={r.organismos} etiqueta={r.organismos === 1 ? 'organismo comprador' : 'organismos compradores'} />
        <Indicador valor={r.proveedores} etiqueta={r.proveedores === 1 ? 'proveedor ganó' : 'proveedores ganaron'} />
        <Indicador texto={r.cantidad !== null ? `${entero(Math.round(r.cantidad))}` : '—'} etiqueta={`${unidad}${r.cantidad !== null && r.cantidad !== 1 && !unidad.endsWith('s') ? 's' : ''} adjudicados`} />
      </dl>

      <Seccion titulo="A qué precio se gana" nota={`${r.con_precio} de ${r.adjudicaciones} con precio comparable`}>
        <RangoPrecios p10={r.precio_p10_uyu} p25={r.precio_p25_uyu} mediana={r.precio_mediano_uyu} p75={r.precio_p75_uyu} p90={r.precio_p90_uyu} unidad={unidad} />
        <div className="mt-4">
          <p className="mb-1 flex items-baseline justify-between text-[12.5px] text-muted-foreground">
            <span>Precio mediano por mes</span>
            {ficha.variacion_precio_12m !== null && ficha.variacion_precio_12m !== undefined && (
              <span>
                últimos 12 m vs. anteriores: <Tendencia valor={ficha.variacion_precio_12m} />
              </span>
            )}
          </p>
          <PrecioMensual datos={ficha.serie} unidad={unidad} />
        </div>
        {ficha.competencia.length > 0 && (
          <div className="mt-4">
            <p className="mb-1 text-[12.5px] text-muted-foreground">Cuando hubo cuadro comparativo: cuánto más barata fue la oferta ganadora que la mediana de las perdedoras.</p>
            <Table className="text-[13px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Año</TableHead>
                  <TableHead className="text-right">Ítems</TableHead>
                  <TableHead className="text-right">Oferentes</TableHead>
                  <TableHead className="text-right">Ganador</TableHead>
                  <TableHead className="text-right">Perdedores</TableHead>
                  <TableHead className="text-right">Diferencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ficha.competencia.map((c) => (
                  <TableRow key={c.anio} className="hover:bg-transparent">
                    <TableCell className="condensada tabular-nums">{c.anio}</TableCell>
                    <TableCell className="condensada text-right tabular-nums">{c.items_con_cuadro}</TableCell>
                    <TableCell className="condensada text-right tabular-nums">{c.oferentes_promedio !== null ? c.oferentes_promedio.toFixed(1) : '—'}</TableCell>
                    <TableCell className="condensada text-right tabular-nums">{precioUyu(c.precio_ganador_mediano)}</TableCell>
                    <TableCell className="condensada text-right tabular-nums">{precioUyu(c.precio_perdedor_mediano)}</TableCell>
                    <TableCell className="condensada text-right tabular-nums">{c.descuento_mediano !== null ? `${c.descuento_mediano > 0 ? '+' : ''}${Math.round(c.descuento_mediano * 100)} %` : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Seccion>

      <Seccion titulo="Cuánto se compra" nota="monto adjudicado por mes, en pesos">
        <MontoMensual datos={ficha.serie} />
      </Seccion>

      <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
        <Seccion titulo="Quién gana" nota="cuota del monto">
          <BarrasHorizontales
            datos={ficha.proveedores.map((p) => ({
              clave: p.proveedor_id,
              etiqueta: p.nombre,
              detalle: `${p.adjudicaciones} adj.${p.precio_mediano_uyu !== null && p.precio_mediano_uyu !== undefined ? ` · ${precioUyu(p.precio_mediano_uyu)}` : ''}`,
              valor: p.monto_uyu,
              share: p.share,
              onClick: () => onProveedor(p.proveedor_id),
            }))}
            maxFilas={10}
            vacio="Sin adjudicaciones con monto en el período."
          />
        </Seccion>
        <Seccion titulo="Quién compra" nota="cuota del monto">
          <BarrasHorizontales
            datos={ficha.organismos.map((o) => ({
              clave: o.organismo_id ?? 'sin',
              etiqueta: o.inciso ?? 'Sin organismo',
              detalle: o.unidad_ejecutora ?? undefined,
              valor: o.monto_uyu,
              share: o.share,
            }))}
            maxFilas={10}
          />
        </Seccion>
      </div>

      <Seccion titulo="Cómo se compra">
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
                <TableHead>Comprador</TableHead>
                <TableHead>Ganador</TableHead>
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
                  <TableCell className="max-w-[20ch] truncate" title={`${a.inciso ?? ''} ${a.unidad_ejecutora ?? ''}`}>
                    {a.inciso ?? '—'}
                  </TableCell>
                  <TableCell className="max-w-[20ch] truncate">
                    {a.proveedor_id ? (
                      <button type="button" onClick={() => onProveedor(a.proveedor_id!)} className="truncate hover:underline">
                        {a.proveedor}
                      </button>
                    ) : (
                      a.proveedor
                    )}
                  </TableCell>
                  <TableCell className="condensada text-right whitespace-nowrap tabular-nums">
                    {a.cantidad !== null ? entero(a.cantidad) : '—'} <span className="text-muted-foreground">{unidadLegible(a.unidad)}</span>
                  </TableCell>
                  <TableCell className="condensada text-right whitespace-nowrap tabular-nums" title={a.moneda !== 'UYU' && a.precio_unitario !== null ? `${a.precio_unitario} ${a.moneda}` : undefined}>
                    {a.precio_base_uyu !== null ? precioUyu(a.precio_base_uyu) : a.precio_unitario !== null ? `${a.precio_unitario} ${a.moneda}` : '—'}
                  </TableCell>
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
