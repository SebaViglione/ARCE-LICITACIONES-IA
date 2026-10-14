import { useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import ShinyText from '@/components/ShinyText';
import { Nav } from '@/components/Nav';
import type { Categoria, Rango, ResumenMercado } from '@/lib/mercadoApi';
import { haceCuanto, plural } from '@/lib/formato';
import { mesLargo, montoUyu, porcentaje, restarMeses } from '@/lib/numeros';
import { Indicador } from '@/mercado/comunes';
import { cn } from '@/lib/utils';

interface Props {
  resumen: ResumenMercado | null;
  error: string | null;
  rango: Rango;
  q: string;
  categoria: number | null;
  categorias: Categoria[];
  refrescando: boolean;
  onCambio: (cambios: Record<string, string | null | undefined>) => void;
  onRefrescar: () => Promise<void>;
}

const PRESETS = [
  { clave: '12', etiqueta: '12 meses', meses: 12 },
  { clave: '24', etiqueta: '24 meses', meses: 24 },
  { clave: '60', etiqueta: '5 años', meses: 60 },
  { clave: 'todo', etiqueta: 'Todo', meses: 0 },
] as const;

function describirDatos(r: ResumenMercado | null): string {
  if (!r) return 'Cargando el estado de los datos…';
  if (r.hechos === 0) return 'Todavía no hay adjudicaciones cargadas.';
  const ingesta = r.ultima_ingesta ? `último lote ${haceCuanto(r.ultima_ingesta.finalizado_en ?? r.ultima_ingesta.recibido_en)} (${r.ultima_ingesta.fuente})` : 'sin lotes de ingesta';
  const refresco = r.ultimo_refresco?.finalizado_en ? `estadísticas calculadas ${haceCuanto(r.ultimo_refresco.finalizado_en)}` : 'estadísticas sin calcular';
  return `${plural(r.llamados, 'llamado', 'llamados')} de ${mesLargo(r.primera_fecha)} a ${mesLargo(r.ultima_fecha)} · ${ingesta} · ${refresco}.`;
}

export function BarraMercado({ resumen, error, rango, q, categoria, categorias, refrescando, onCambio, onRefrescar }: Props) {
  const [busqueda, setBusqueda] = useState(q);
  const [errorRefresco, setErrorRefresco] = useState<string | null>(null);
  const ultimoMes = resumen?.ultima_fecha?.slice(0, 7) ?? new Date().toISOString().slice(0, 7);

  const presetActivo = useMemo(() => {
    if (!rango.desde && !rango.hasta) return 'todo';
    for (const p of PRESETS) if (p.meses && rango.hasta === ultimoMes && rango.desde === restarMeses(ultimoMes, p.meses - 1)) return p.clave;
    return null;
  }, [rango, ultimoMes]);

  const aplicarPreset = (clave: string) => {
    const p = PRESETS.find((x) => x.clave === clave)!;
    if (!p.meses) onCambio({ desde: null, hasta: null });
    else onCambio({ desde: restarMeses(ultimoMes, p.meses - 1), hasta: ultimoMes });
  };

  // KPIs del período a partir de la serie mensual (totales exactos); productos/proveedores/compradores son del histórico completo.
  const kpis = useMemo(() => {
    if (!resumen) return null;
    const enRango = resumen.por_mes.filter((m) => (!rango.desde || m.mes.slice(0, 7) >= rango.desde) && (!rango.hasta || m.mes.slice(0, 7) <= rango.hasta));
    return {
      monto: enRango.reduce((s, m) => s + (m.monto_uyu ?? 0), 0),
      adjudicaciones: enRango.reduce((s, m) => s + m.adjudicaciones, 0),
      llamados: enRango.reduce((s, m) => s + m.llamados, 0),
    };
  }, [resumen, rango]);

  const refrescar = async () => {
    setErrorRefresco(null);
    try {
      await onRefrescar();
    } catch (err) {
      setErrorRefresco((err as Error).message);
    }
  };

  const itemsCategoria = useMemo(() => ({ todas: 'Todas las categorías', ...Object.fromEntries(categorias.map((c) => [String(c.id), c.nombre])) }), [categorias]);

  return (
    <header className="border-b border-border bg-card">
      <div className="flex min-h-14 flex-wrap items-center gap-x-5 gap-y-2 px-5 py-2">
        <Nav actual="mercado" />
        <div className="flex items-baseline gap-2.5 whitespace-nowrap">
          <span className="text-[17px] font-semibold tracking-tight">Mercado de compras estatales</span>
        </div>
        <p className="angosta min-w-0 flex-1 truncate text-[13.5px] text-muted-foreground" aria-live="polite">
          {refrescando ? (
            <ShinyText text="Recalculando las estadísticas a partir del histórico. Puede tardar unos minutos con millones de filas." color="#9aa4af" shineColor="#e6eaee" speed={3} />
          ) : error ? (
            <span className="text-rojo">No se pudo cargar el resumen: {error}</span>
          ) : errorRefresco ? (
            <span className="text-rojo">No se pudo iniciar el recálculo: {errorRefresco}</span>
          ) : (
            describirDatos(resumen)
          )}
        </p>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="outline" onClick={refrescar} disabled={refrescando} className="font-semibold">
                <RefreshCw className={refrescando ? 'animate-spin' : ''} />
                {refrescando ? 'Recalculando…' : 'Recalcular estadísticas'}
              </Button>
            }
          />
          <TooltipContent>Vuelve a construir las vistas materializadas. Se hace solo después de cada lote de ingesta y todas las noches; esto es por si querés verlo ya.</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/60 px-5 py-2">
        <div role="group" aria-label="Período" className="flex items-center gap-0.5 rounded-md bg-background p-0.5">
          {PRESETS.map((p) => (
            <button
              key={p.clave}
              type="button"
              onClick={() => aplicarPreset(p.clave)}
              aria-pressed={presetActivo === p.clave}
              className={cn('rounded-[5px] px-2.5 py-1 text-[13px] transition-colors', presetActivo === p.clave ? 'bg-secondary font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}
            >
              {p.etiqueta}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          de
          <input type="month" value={rango.desde ?? ''} max={rango.hasta ?? undefined} onChange={(e) => onCambio({ desde: e.target.value || null })} className="h-8 rounded-md border border-input bg-background px-2 text-[13px] text-foreground [color-scheme:dark]" aria-label="Desde" />
          a
          <input type="month" value={rango.hasta ?? ''} min={rango.desde ?? undefined} onChange={(e) => onCambio({ hasta: e.target.value || null })} className="h-8 rounded-md border border-input bg-background px-2 text-[13px] text-foreground [color-scheme:dark]" aria-label="Hasta" />
        </label>
        <Select value={categoria ? String(categoria) : 'todas'} onValueChange={(v) => onCambio({ categoria: v === 'todas' ? null : v })} items={itemsCategoria}>
          <SelectTrigger size="sm" className="min-w-44 bg-background" aria-label="Categoría">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las categorías</SelectItem>
            {categorias.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <form
          className="relative min-w-56 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            onCambio({ q: busqueda.trim() || null });
          }}
        >
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} onBlur={() => busqueda.trim() !== q && onCambio({ q: busqueda.trim() || null })} placeholder="Buscar producto, proveedor u organismo" className="h-8 bg-background pl-8" aria-label="Buscar" />
        </form>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border/60 px-5 py-2">
        <Indicador texto={kpis ? montoUyu(kpis.monto) : undefined} valor={kpis ? undefined : null} etiqueta="adjudicados en el período" ayuda="Suma de las adjudicaciones con monto conocido, en pesos uruguayos sin impuestos (las monedas extranjeras se convierten con la cotización del día)." />
        <Separator orientation="vertical" className="hidden h-6 sm:block" />
        <Indicador valor={kpis?.adjudicaciones ?? null} etiqueta="adjudicaciones" />
        <Separator orientation="vertical" className="hidden h-6 sm:block" />
        <Indicador valor={kpis?.llamados ?? null} etiqueta="llamados con adjudicación" />
        <Separator orientation="vertical" className="hidden h-6 sm:block" />
        <Indicador valor={resumen?.productos ?? null} etiqueta="productos" ayuda="Artículos distintos con al menos una adjudicación en todo el histórico." />
        <Separator orientation="vertical" className="hidden h-6 sm:block" />
        <Indicador valor={resumen?.proveedores ?? null} etiqueta="proveedores" />
        <Separator orientation="vertical" className="hidden h-6 sm:block" />
        <Indicador valor={resumen?.organismos ?? null} etiqueta="compradores" />
        <Separator orientation="vertical" className="hidden h-6 sm:block" />
        <Indicador texto={resumen ? porcentaje(resumen.cobertura_precio) : undefined} valor={resumen ? undefined : null} etiqueta="con precio comparable" ayuda="Adjudicaciones con precio unitario en pesos sin impuestos. Las demás cuentan para los volúmenes pero no para las estadísticas de precio." />
      </div>
    </header>
  );
}
