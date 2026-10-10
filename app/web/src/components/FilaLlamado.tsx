import { memo } from 'react';
import { MapPin } from 'lucide-react';
import type { Llamado } from '@/lib/api';
import { decisionTexto, partesTitulo, plazoDe, textoDias, tituloLlamado } from '@/lib/formato';
import { cn } from '@/lib/utils';

interface Props {
  llamado: Llamado;
  seleccionado: boolean;
  onClick: () => void;
}

const COLOR_DIAS = { urgente: 'text-rojo', proximo: 'text-ambar', normal: 'text-foreground', sin: 'text-muted-foreground' } as const;

export const FilaLlamado = memo(function FilaLlamado({ llamado: l, seleccionado, onClick }: Props) {
  const d = textoDias(l.dias_restantes);
  const plazo = plazoDe(l.dias_restantes);
  const { tipo, organismo } = partesTitulo(l.titulo);
  const iaSi = l.es_relevante === true;

  return (
    <li
      role="option"
      aria-selected={seleccionado}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      tabIndex={0}
      className={cn(
        'grid cursor-pointer grid-cols-[52px_minmax(0,1fr)] gap-x-2.5 border-b border-border/60 border-l-[3px] border-l-transparent px-4 py-2.5 pl-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset',
        seleccionado ? (iaSi ? 'border-l-vidrio bg-secondary' : 'border-l-foreground bg-secondary') : 'hover:bg-card',
      )}
    >
      <div className={cn('condensada flex flex-col items-end pt-0.5 leading-none', COLOR_DIAS[plazo])}>
        <b className="text-[22px] font-semibold tracking-tight tabular-nums">{d.numero}</b>
        <span className="mt-1 text-[11px] text-muted-foreground">{d.etiqueta}</span>
      </div>
      <div className="min-w-0">
        <div className="line-clamp-2 text-[15px] leading-[1.3] font-medium">{tituloLlamado(l)}</div>
        <div className="angosta mt-0.5 truncate text-[13px] text-muted-foreground">
          {tipo}
          {organismo ? `, ${organismo}` : ''}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12.5px] leading-[1.4]">
          {iaSi ? (
            <span className="rounded bg-vidrio/15 px-1.5 text-vidrio">IA: del rubro, {l.confianza ?? '–'} %</span>
          ) : l.es_relevante === false ? (
            <span className="rounded border border-border/60 px-1.5 text-texto-3">IA: no es del rubro</span>
          ) : (
            <span className="rounded bg-secondary px-1.5 text-muted-foreground">Sin analizar aún</span>
          )}
          {l.es_relevante_real === true && <span className="rounded border border-vidrio px-1.5 text-vidrio">{decisionTexto(l)}</span>}
          {l.es_relevante_real === false && <span className="rounded border border-border px-1.5 text-muted-foreground">Descartado por nosotros</span>}
          {l.requiere_visita && (
            <span className="inline-flex items-center gap-1 rounded bg-ambar/15 px-1.5 text-ambar">
              <MapPin className="size-3" aria-hidden /> Visita técnica
            </span>
          )}
        </div>
        {l.confianza !== null && l.es_relevante !== null && (
          <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-border/50" aria-hidden>
            <div className={cn('h-full rounded-full', iaSi ? 'bg-vidrio' : 'bg-texto-3')} style={{ width: `${Math.max(2, Math.min(100, l.confianza))}%` }} />
          </div>
        )}
      </div>
    </li>
  );
});
