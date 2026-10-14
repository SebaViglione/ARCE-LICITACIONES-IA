import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import CountUp from '@/components/CountUp';
import ShinyText from '@/components/ShinyText';
import { Nav } from '@/components/Nav';
import type { Corrida, EstadoPipeline, Llamado, Metricas } from '@/lib/api';
import { plural } from '@/lib/formato';

interface Props {
  rubro: string;
  llamados: Llamado[];
  metricas: Metricas | null;
  pipeline: EstadoPipeline | null;
  onBuscar: () => Promise<void>;
}

function describirCorrida(c: Corrida | null | undefined): string {
  if (!c) return 'Todavía no se buscaron licitaciones.';
  const fin = c.finalizada_en ? new Date(c.finalizada_en) : null;
  const cuando = fin ? `a las ${fin.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}` : '';
  if (c.estado !== 'ok') return `La última búsqueda ${cuando} terminó con errores. Revisá los logs de la app.`;
  const analizados = c.analizados ?? 0;
  const cola = analizados === 0 ? 'nada nuevo para analizar' : plural(analizados, 'pliego analizado', 'pliegos analizados');
  return `Última búsqueda ${cuando}: ${c.rss_total ?? 0} publicaciones leídas, ${c.candidatos ?? 0} candidatas, ${cola}.`;
}

function Indicador({ valor, etiqueta, sufijo = '', vacio }: { valor: number | null; etiqueta: string; sufijo?: string; vacio?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      {valor === null ? (
        <span className="condensada text-2xl font-semibold text-muted-foreground">—</span>
      ) : (
        <span className="condensada text-2xl font-semibold tabular-nums">
          <CountUp to={valor} duration={0.9} />
          {sufijo}
        </span>
      )}
      <span className="text-[13px] text-muted-foreground">{valor === null && vacio ? vacio : etiqueta}</span>
    </div>
  );
}

export function Barra({ rubro, llamados, metricas, pipeline, onBuscar }: Props) {
  const [iniciando, setIniciando] = useState(false);
  const [errorInicio, setErrorInicio] = useState<string | null>(null);
  const enCurso = pipeline?.enCurso ?? false;
  const minutos = pipeline?.iniciadaEn ? Math.max(0, Math.round((Date.now() - new Date(pipeline.iniciadaEn).getTime()) / 60000)) : 0;

  const activos = llamados.length;
  const ia = llamados.filter((l) => l.es_relevante === true).length;
  const revisados = llamados.filter((l) => l.es_relevante_real !== null).length;
  const precision = metricas?.precision === null || metricas?.precision === undefined ? null : Math.round(metricas.precision * 100);

  const buscar = async () => {
    setIniciando(true);
    setErrorInicio(null);
    try {
      await onBuscar();
    } catch (err) {
      setErrorInicio((err as Error).message);
    } finally {
      setIniciando(false);
    }
  };

  return (
    <header className="border-b border-border bg-card">
      <div className="flex min-h-14 flex-wrap items-center gap-x-5 gap-y-2 px-5 py-2">
        <Nav actual="licitaciones" />
        <div className="flex items-baseline gap-2.5 whitespace-nowrap">
          <span className="text-[17px] font-semibold tracking-tight">Licitaciones ARCE</span>
          {rubro && <span className="text-sm text-muted-foreground">rubro {rubro}</span>}
        </div>
        <p className="angosta min-w-0 flex-1 truncate text-[13.5px] text-muted-foreground" aria-live="polite">
          {enCurso ? (
            <ShinyText
              text={`Buscando y analizando licitaciones (${minutos} min). Cada pliego tarda entre 1 y 10 minutos; la lista se actualiza sola al terminar.`}
              color="#9aa4af"
              shineColor="#e6eaee"
              speed={3}
            />
          ) : errorInicio ? (
            <span className="text-rojo">No se pudo iniciar la búsqueda: {errorInicio}</span>
          ) : (
            describirCorrida(pipeline?.ultimaCorrida ?? pipeline?.corridas?.[0])
          )}
        </p>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button onClick={buscar} disabled={enCurso || iniciando} className="font-semibold">
                <RefreshCw className={enCurso || iniciando ? 'animate-spin' : ''} />
                {enCurso ? 'Buscando…' : iniciando ? 'Iniciando…' : 'Buscar licitaciones nuevas'}
              </Button>
            }
          />
          <TooltipContent>Lee el RSS del portal, scrapea los candidatos nuevos y los analiza con la IA</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border/60 px-5 py-2">
        <Indicador valor={activos} etiqueta={activos === 1 ? 'llamado activo' : 'llamados activos'} />
        <Separator orientation="vertical" className="hidden h-5 sm:block" />
        <Indicador valor={ia} etiqueta="que la IA marca del rubro" />
        <Separator orientation="vertical" className="hidden h-5 sm:block" />
        <Indicador valor={revisados} etiqueta={revisados === 1 ? 'revisado por nosotros' : 'revisados por nosotros'} />
        <Separator orientation="vertical" className="hidden h-5 sm:block" />
        <Tooltip>
          <TooltipTrigger render={<div />}>
            <Indicador
              valor={precision}
              sufijo=" %"
              etiqueta={`de precisión de la IA${metricas?.recall !== null && metricas?.recall !== undefined ? `, recall ${Math.round(metricas.recall * 100)} %` : ''}`}
              vacio={metricas?.revisados ? `${plural(metricas.revisados, 'decisión', 'decisiones')}, sin positivos aún` : 'sin decisiones todavía para medir a la IA'}
            />
          </TooltipTrigger>
          <TooltipContent>Aciertos de la IA entre los llamados que marcó como del rubro, según las decisiones que guardamos</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
