import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import type { PuntoMes } from '@/lib/mercadoApi';
import { compacto, mesCorto, mesLargo, montoUyu, precioUyu } from '@/lib/numeros';
import { cn } from '@/lib/utils';

// Gráficos del tablero de mercado. Una sola serie por gráfico, un solo matiz (el acento del tablero):
// no hay paleta categórica que validar. Dos medidas de distinta escala van en dos gráficos, nunca en dos ejes.

const CONFIG_MONTO: ChartConfig = { monto_uyu: { label: 'Monto adjudicado', color: 'var(--vidrio)' } };
const CONFIG_PRECIO: ChartConfig = { precio_mediano_uyu: { label: 'Precio mediano', color: 'var(--vidrio)' } };
const CONFIG_ADJ: ChartConfig = { adjudicaciones: { label: 'Adjudicaciones', color: 'var(--vidrio)' } };

interface SerieProps {
  datos: PuntoMes[];
  className?: string;
  alto?: number;
}

/** Barras mensuales del monto adjudicado (UYU). */
export function MontoMensual({ datos, className, alto = 150 }: SerieProps) {
  if (datos.length === 0) return <Vacio texto="Sin adjudicaciones con monto en el período." />;
  return (
    <ChartContainer config={CONFIG_MONTO} className={cn('aspect-auto w-full', className)} style={{ height: alto }}>
      <BarChart data={datos} margin={{ top: 6, right: 4, left: 4, bottom: 0 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis dataKey="mes" tickLine={false} axisLine={false} minTickGap={28} tickFormatter={mesCorto} fontSize={11} />
        <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => compacto(v)} fontSize={11} />
        <ChartTooltip cursor={{ fill: 'var(--superficie-3)' }} content={<ChartTooltipContent labelFormatter={(v) => mesLargo(String(v))} formatter={(v) => <span className="tabular-nums">{montoUyu(Number(v))}</span>} />} />
        <Bar dataKey="monto_uyu" fill="var(--color-monto_uyu)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

/** Barras mensuales de cantidad de adjudicaciones. */
export function AdjudicacionesMensuales({ datos, className, alto = 120 }: SerieProps) {
  if (datos.length === 0) return <Vacio texto="Sin adjudicaciones en el período." />;
  return (
    <ChartContainer config={CONFIG_ADJ} className={cn('aspect-auto w-full', className)} style={{ height: alto }}>
      <BarChart data={datos} margin={{ top: 6, right: 4, left: 4, bottom: 0 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis dataKey="mes" tickLine={false} axisLine={false} minTickGap={28} tickFormatter={mesCorto} fontSize={11} />
        <YAxis tickLine={false} axisLine={false} width={36} fontSize={11} allowDecimals={false} />
        <ChartTooltip cursor={{ fill: 'var(--superficie-3)' }} content={<ChartTooltipContent labelFormatter={(v) => mesLargo(String(v))} />} />
        <Bar dataKey="adjudicaciones" fill="var(--color-adjudicaciones)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

/** Línea del precio unitario mediano por mes (UYU sin impuestos). Los meses sin precio se saltan. */
export function PrecioMensual({ datos, unidad, className, alto = 150 }: SerieProps & { unidad: string }) {
  const conPrecio = datos.filter((d) => d.precio_mediano_uyu !== null && d.precio_mediano_uyu !== undefined);
  if (conPrecio.length < 2) return <Vacio texto="No hay suficientes meses con precio comparable para dibujar la tendencia." />;
  return (
    <ChartContainer config={CONFIG_PRECIO} className={cn('aspect-auto w-full', className)} style={{ height: alto }}>
      <LineChart data={conPrecio} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis dataKey="mes" tickLine={false} axisLine={false} minTickGap={28} tickFormatter={mesCorto} fontSize={11} />
        <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => compacto(v)} fontSize={11} domain={['auto', 'auto']} />
        <ChartTooltip
          cursor={{ stroke: 'var(--border)' }}
          content={
            <ChartTooltipContent
              labelFormatter={(v) => mesLargo(String(v))}
              formatter={(v, _n, item) => {
                const p = item.payload as PuntoMes;
                return (
                  <span className="tabular-nums">
                    {precioUyu(Number(v))} por {unidad}
                    <span className="ml-1.5 text-muted-foreground">({p.con_precio} con precio)</span>
                  </span>
                );
              }}
            />
          }
        />
        <Line type="monotone" dataKey="precio_mediano_uyu" stroke="var(--color-precio_mediano_uyu)" strokeWidth={2} dot={conPrecio.length <= 18 ? { r: 3, strokeWidth: 0, fill: 'var(--vidrio)' } : false} activeDot={{ r: 4 }} connectNulls />
      </LineChart>
    </ChartContainer>
  );
}

export interface BarraDato {
  clave: string | number;
  etiqueta: string;
  detalle?: string;
  valor: number | null;
  share?: number | null;
  onClick?: () => void;
}

/** Barras horizontales con etiqueta directa: cuota de cada participante sobre el total. */
export function BarrasHorizontales({ datos, formato = montoUyu, maxFilas = 8, vacio = 'Sin datos en el período.' }: { datos: BarraDato[]; formato?: (n: number | null) => string; maxFilas?: number; vacio?: string }) {
  const visibles = datos.filter((d) => d.valor !== null).slice(0, maxFilas);
  if (visibles.length === 0) return <Vacio texto={vacio} />;
  const max = Math.max(...visibles.map((d) => d.valor ?? 0), 1);
  return (
    <ol className="flex flex-col gap-1.5">
      {visibles.map((d) => {
        const ancho = Math.max(1.5, ((d.valor ?? 0) / max) * 100);
        const Fila = d.onClick ? 'button' : 'div';
        return (
          <li key={d.clave}>
            <Fila
              type={d.onClick ? 'button' : undefined}
              onClick={d.onClick}
              className={cn('grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-sm text-left', d.onClick && 'cursor-pointer hover:bg-secondary/60')}
            >
              <span className="truncate text-[13.5px]">
                {d.etiqueta}
                {d.detalle && <span className="ml-1.5 text-[12px] text-muted-foreground">{d.detalle}</span>}
              </span>
              <span className="condensada text-[13px] tabular-nums">
                {formato(d.valor)}
                {d.share !== null && d.share !== undefined && <span className="ml-1.5 text-muted-foreground">{Math.round(d.share * 100)} %</span>}
              </span>
              <span className="col-span-2 block h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <span className="block h-full rounded-full bg-vidrio/80" style={{ width: `${ancho}%` }} />
              </span>
            </Fila>
          </li>
        );
      })}
    </ol>
  );
}

/** Franja de distribución de precios: p10 · p25 · mediana · p75 · p90 */
export function RangoPrecios({ p10, p25, mediana, p75, p90, unidad }: { p10: number | null; p25: number | null; mediana: number | null; p75: number | null; p90: number | null; unidad: string }) {
  if (mediana === null || p10 === null || p90 === null || p25 === null || p75 === null) return <Vacio texto="Sin precios comparables en el período." />;
  const min = p10;
  const span = Math.max(p90 - p10, mediana * 0.01, 0.01);
  const pos = (v: number) => `${Math.min(100, Math.max(0, ((v - min) / span) * 100))}%`;
  return (
    <figure className="m-0">
      <div className="relative mt-5 h-2 rounded-full bg-secondary">
        <div className="absolute top-0 h-2 rounded-full bg-vidrio/50" style={{ left: pos(p25), width: `calc(${pos(p75)} - ${pos(p25)})` }} />
        <div className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-vidrio" style={{ left: pos(mediana) }} />
        <span className="condensada absolute -top-5 -translate-x-1/2 text-[12.5px] font-semibold tabular-nums" style={{ left: pos(mediana) }}>
          {precioUyu(mediana)}
        </span>
      </div>
      <figcaption className="angosta mt-1.5 flex justify-between text-[11.5px] text-muted-foreground tabular-nums">
        <span>p10 {precioUyu(p10)}</span>
        <span>p25 {precioUyu(p25)}</span>
        <span>p75 {precioUyu(p75)}</span>
        <span>p90 {precioUyu(p90)}</span>
      </figcaption>
      <p className="mt-1 text-[12.5px] text-muted-foreground">Precio unitario por {unidad}, en pesos sin impuestos. La franja clara es donde cae la mitad de las adjudicaciones.</p>
    </figure>
  );
}

export function Vacio({ texto }: { texto: string }) {
  return <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[13px] text-muted-foreground">{texto}</p>;
}
