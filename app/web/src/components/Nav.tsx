import { navegar } from '@/lib/ruta';
import { cn } from '@/lib/utils';

// Navegación entre los dos tableros: la bandeja de licitaciones del rubro y la inteligencia de mercado.

const SECCIONES = [
  { clave: 'licitaciones', etiqueta: 'Licitaciones', path: '/' },
  { clave: 'mercado', etiqueta: 'Mercado', path: '/mercado' },
] as const;

export type Seccion = (typeof SECCIONES)[number]['clave'];

export function Nav({ actual }: { actual: Seccion }) {
  return (
    <nav aria-label="Secciones" className="flex items-center gap-0.5 rounded-md bg-background p-0.5">
      {SECCIONES.map((s) => (
        <a
          key={s.clave}
          href={s.path}
          aria-current={s.clave === actual ? 'page' : undefined}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey) return;
            e.preventDefault();
            if (s.clave !== actual) navegar(s.path);
          }}
          className={cn(
            'rounded-[5px] px-2.5 py-1 text-[13px] font-medium transition-colors',
            s.clave === actual ? 'bg-secondary text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {s.etiqueta}
        </a>
      ))}
    </nav>
  );
}
