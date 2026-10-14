import { useMemo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import type { Rango, ResumenMercado } from '@/lib/mercadoApi';
import { haceCuanto, plural } from '@/lib/formato';
import { entero, ESTADOS_LLAMADO, mesLargo, montoUyu, porcentaje, TIPOS_COMPRA } from '@/lib/numeros';
import { AdjudicacionesMensuales, BarrasHorizontales, MontoMensual } from '@/mercado/Graficos';
import { Pastilla, Seccion } from '@/mercado/comunes';

// Vista por defecto del panel derecho: el mercado entero en el período, más la salud de los datos.

export function Panorama({ resumen, rango }: { resumen: ResumenMercado | null; rango: Rango }) {
  const serie = useMemo(
    () => (resumen ? resumen.por_mes.filter((m) => (!rango.desde || m.mes.slice(0, 7) >= rango.desde) && (!rango.hasta || m.mes.slice(0, 7) <= rango.hasta)) : []),
    [resumen, rango],
  );
  if (!resumen) {
    return (
      <div className="mx-auto w-full max-w-[880px] px-8 py-6">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="mt-6 h-40 w-full" />
        <Skeleton className="mt-6 h-40 w-full" />
      </div>
    );
  }
  const totalEstados = resumen.estados.reduce((s, e) => s + e.llamados, 0);
  const periodo = !rango.desde && !rango.hasta ? 'todo el histórico' : `${rango.desde ? mesLargo(rango.desde) : mesLargo(resumen.primera_fecha)} a ${rango.hasta ? mesLargo(rango.hasta) : mesLargo(resumen.ultima_fecha)}`;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-5 pt-5 pb-10 md:px-8 md:pt-6">
      <p className="text-[13px] text-muted-foreground">Panorama</p>
      <h1 className="mt-0.5 text-[25px] leading-[1.22] font-semibold tracking-tight">Todo el mercado, {periodo}</h1>
      <p className="mt-1 max-w-[70ch] text-[13.5px] text-muted-foreground">Elegí un producto, un competidor o un comprador a la izquierda para ver su detalle. Acá se ve el conjunto: cuánto se adjudica por mes, cómo se compra y qué tan completos son los datos.</p>

      <Seccion titulo="Monto adjudicado por mes" nota="pesos sin impuestos">
        <MontoMensual datos={serie} alto={170} />
      </Seccion>

      <Seccion titulo="Adjudicaciones por mes">
        <AdjudicacionesMensuales datos={serie} />
      </Seccion>

      <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
        <Seccion titulo="Cómo se compra" nota="por monto, todo el histórico">
          <BarrasHorizontales datos={resumen.tipos_compra.map((t) => ({ clave: t.tipo_compra, etiqueta: TIPOS_COMPRA[t.tipo_compra] ?? t.tipo_compra, detalle: `${t.adjudicaciones} adj.`, valor: t.monto_uyu }))} />
        </Seccion>
        <Seccion titulo="Estado de los llamados" nota="todo el histórico">
          <ul className="flex flex-wrap gap-1.5">
            {resumen.estados.map((e) => (
              <li key={e.estado}>
                <Pastilla>
                  {ESTADOS_LLAMADO[e.estado] ?? e.estado} <span className="ml-1 text-muted-foreground">{entero(e.llamados)}</span>
                  {totalEstados ? <span className="ml-1 text-texto-3">{porcentaje(e.llamados / totalEstados)}</span> : null}
                </Pastilla>
              </li>
            ))}
          </ul>
          {resumen.monedas.length > 0 && (
            <p className="mt-3 text-[12.5px] text-muted-foreground">
              Monedas: {resumen.monedas.map((m) => `${m.moneda} ${entero(m.adjudicaciones)}`).join(' · ')}. {plural(resumen.cotizaciones, 'cotización cargada', 'cotizaciones cargadas')}.
            </p>
          )}
        </Seccion>
      </div>

      <Seccion titulo="Salud de los datos" nota="qué entra y qué queda afuera de las estadísticas">
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-6 gap-y-3 rounded-lg border border-border bg-card px-4 py-3 text-[13.5px]">
          <Dato etiqueta="Adjudicaciones en las estadísticas">
            {entero(resumen.hechos)} de {entero(resumen.adjudicaciones)}
            {resumen.adjudicaciones_excluidas > 0 ? <span className="block text-[12.5px] text-muted-foreground">{entero(resumen.adjudicaciones_excluidas)} excluidas: llamados anulados o sin efecto, o sin fecha</span> : null}
          </Dato>
          <Dato etiqueta="Con monto en pesos">
            {porcentaje(resumen.cobertura_monto)}
            <span className="block text-[12.5px] text-muted-foreground">{montoUyu(resumen.monto_uyu_total)} en total; falta cotización en {entero(resumen.hechos - resumen.con_cotizacion)}</span>
          </Dato>
          <Dato etiqueta="Con precio comparable">
            {porcentaje(resumen.cobertura_precio)}
            <span className="block text-[12.5px] text-muted-foreground">precio unitario sin impuestos y en pesos</span>
          </Dato>
          <Dato etiqueta="Ítems sin artículo de catálogo">
            {entero(resumen.items_sin_articulo)} de {entero(resumen.items)}
            <span className="block text-[12.5px] text-muted-foreground">cuentan en montos, no en el ranking de productos</span>
          </Dato>
          <Dato etiqueta="Cuadros comparativos">
            {entero(resumen.ofertas)} ofertas
            <span className="block text-[12.5px] text-muted-foreground">alimentan la tasa de éxito y el precio ganador vs. perdedor</span>
          </Dato>
          <Dato etiqueta="Última ingesta">
            {resumen.ultima_ingesta ? (
              <>
                {haceCuanto(resumen.ultima_ingesta.finalizado_en ?? resumen.ultima_ingesta.recibido_en)} · {resumen.ultima_ingesta.fuente}
                <span className="block text-[12.5px] text-muted-foreground">
                  {resumen.ultima_ingesta.insertados} nuevos, {resumen.ultima_ingesta.actualizados} actualizados, {resumen.ultima_ingesta.sin_cambios} sin cambios, {resumen.ultima_ingesta.rechazados} rechazados
                </span>
              </>
            ) : (
              'todavía no llegó ningún lote'
            )}
          </Dato>
          <Dato etiqueta="Estadísticas calculadas">
            {resumen.ultimo_refresco?.finalizado_en ? (
              <>
                {haceCuanto(resumen.ultimo_refresco.finalizado_en)}
                <span className="block text-[12.5px] text-muted-foreground">
                  {resumen.ultimo_refresco.estado === 'ok' ? `en ${Math.round((resumen.ultimo_refresco.duracion_ms ?? 0) / 1000)} s` : `con error (${resumen.ultimo_refresco.estado})`} · origen {resumen.ultimo_refresco.origen}
                </span>
              </>
            ) : (
              'nunca'
            )}
          </Dato>
        </dl>
      </Seccion>
    </div>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[12.5px] text-muted-foreground">{etiqueta}</dt>
      <dd className="m-0 font-medium">{children}</dd>
    </div>
  );
}
