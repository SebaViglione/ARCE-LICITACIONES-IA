import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import CountUp from '@/components/CountUp';
import { cn } from '@/lib/utils';

// Piezas chicas compartidas por las vistas de mercado.

export function Indicador({ valor, texto, etiqueta, ayuda, className }: { valor?: number | null; texto?: string; etiqueta: string; ayuda?: string; className?: string }) {
  const contenido = (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <span className="condensada text-[22px] leading-tight font-semibold tabular-nums">
        {texto !== undefined ? texto : valor === null || valor === undefined ? <span className="text-muted-foreground">—</span> : <CountUp to={valor} duration={0.8} separator="." />}
      </span>
      <span className="text-[12.5px] leading-snug text-muted-foreground">{etiqueta}</span>
    </div>
  );
  if (!ayuda) return contenido;
  return (
    <Tooltip>
      <TooltipTrigger render={<div className="min-w-0" />}>{contenido}</TooltipTrigger>
      <TooltipContent className="max-w-72">{ayuda}</TooltipContent>
    </Tooltip>
  );
}

export function Seccion({ titulo, nota, children, className }: { titulo: string; nota?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('mt-6', className)}>
      <h2 className="mb-2 flex items-baseline gap-2 text-[15px] font-semibold text-muted-foreground">
        {titulo}
        {nota && <span className="text-[12.5px] font-normal text-texto-3">{nota}</span>}
      </h2>
      {children}
    </section>
  );
}

/** Variación interanual con color: verde sube, rojo baja. */
export function Tendencia({ valor, className }: { valor: number | null | undefined; className?: string }) {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return <span className={cn('text-muted-foreground', className)}>—</span>;
  const v = Math.round(valor * 100);
  const color = v > 2 ? 'text-vidrio' : v < -2 ? 'text-rojo' : 'text-muted-foreground';
  return (
    <span className={cn('tabular-nums', color, className)}>
      {v > 0 ? '▲' : v < 0 ? '▼' : '■'} {Math.abs(v)} %
    </span>
  );
}

/** Barrita 0-1 para los componentes del índice de oportunidad. */
export function Barrita({ valor, etiqueta }: { valor: number | null | undefined; etiqueta: string }) {
  const v = valor === null || valor === undefined ? 0 : Math.max(0, Math.min(1, valor));
  return (
    <Tooltip>
      <TooltipTrigger render={<div className="flex min-w-0 items-center gap-1.5" />}>
        <span className="w-16 shrink-0 truncate text-[11.5px] text-muted-foreground">{etiqueta}</span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
          <span className="block h-full rounded-full bg-vidrio/80" style={{ width: `${v * 100}%` }} />
        </span>
        <span className="condensada w-7 text-right text-[11.5px] tabular-nums text-muted-foreground">{Math.round(v * 100)}</span>
      </TooltipTrigger>
      <TooltipContent>
        {etiqueta}: {Math.round(v * 100)} de 100
      </TooltipContent>
    </Tooltip>
  );
}

export function Pastilla({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[12.5px]', className)}>{children}</span>;
}
