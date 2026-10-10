import { Fragment } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { FilaLlamado } from '@/components/FilaLlamado';
import { AperturasStrip } from '@/components/AperturasStrip';
import type { Llamado } from '@/lib/api';
import { grupoDe, plural } from '@/lib/formato';

export type Vista = 'todos' | 'ia' | 'sin_revisar' | 'revisados';
export type Orden = 'plazo' | 'ia' | 'reciente';

const ORDENES: Record<Orden, string> = { plazo: 'plazo de apertura', ia: 'confianza de la IA', reciente: 'publicación más reciente' };

interface Props {
  llamados: Llamado[];
  visibles: Llamado[];
  seleccionado: string | null;
  cargando: boolean;
  error: string | null;
  vista: Vista;
  orden: Orden;
  busqueda: string;
  onVista: (v: Vista) => void;
  onOrden: (o: Orden) => void;
  onBusqueda: (q: string) => void;
  onSeleccionar: (id: string) => void;
}

const COLOR_PLAZO = { urgente: 'text-rojo', proximo: 'text-ambar', normal: 'text-muted-foreground', sin: 'text-muted-foreground' } as const;

export function Bandeja({ llamados, visibles, seleccionado, cargando, error, vista, orden, busqueda, onVista, onOrden, onBusqueda, onSeleccionar }: Props) {
  const total = llamados.length;
  const ia = llamados.filter((l) => l.es_relevante === true).length;
  const revisados = llamados.filter((l) => l.es_relevante_real !== null).length;

  let grupoActual: string | null = null;

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Llamados">
      <div className="flex flex-col gap-2.5 border-b border-border/60 px-4 pt-3 pb-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busqueda} onChange={(e) => onBusqueda(e.target.value)} placeholder="Buscar por título, organismo o descripción" className="h-9 bg-background pl-8" aria-label="Buscar" />
        </div>
        <Tabs value={vista} onValueChange={(v) => onVista(v as Vista)}>
          <TabsList className="h-auto flex-wrap justify-start gap-0.5 bg-transparent p-0">
            <TabsTrigger value="todos" className="rounded-full px-2.5 py-1 text-[13px]">
              Todos
            </TabsTrigger>
            <TabsTrigger value="ia" className="rounded-full px-2.5 py-1 text-[13px]">
              Del rubro según la IA
            </TabsTrigger>
            <TabsTrigger value="sin_revisar" className="rounded-full px-2.5 py-1 text-[13px]">
              Sin revisar
            </TabsTrigger>
            <TabsTrigger value="revisados" className="rounded-full px-2.5 py-1 text-[13px]">
              Revisados
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
            Ordenar por
            <Select value={orden} onValueChange={(v) => onOrden(v as Orden)} items={ORDENES}>
              <SelectTrigger size="sm" className="border-transparent bg-transparent px-1 text-foreground dark:bg-transparent" aria-label="Ordenar por">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ORDENES) as Orden[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {ORDENES[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        <AperturasStrip llamados={visibles} />
      </div>

      <p className="angosta px-4 py-2 text-[12.5px] text-texto-3">
        {visibles.length !== total ? `Mostrando ${visibles.length} de ${total}. ` : ''}
        {plural(total, 'llamado activo', 'llamados activos')}, {ia} que la IA marca del rubro, {plural(revisados, 'revisado', 'revisados')}.
      </p>

      <ol className="scroll-fino min-h-0 flex-1 overflow-y-auto pb-6" role="listbox" aria-label="Lista de llamados">
        {cargando && (
          <li className="flex flex-col gap-3 px-4 py-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-9 w-12" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-11/12" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </li>
        )}
        {!cargando && error && <li className="px-4 py-8 text-sm text-rojo">No se pudieron cargar los llamados: {error}</li>}
        {!cargando && !error && visibles.length === 0 && (
          <li className="px-4 py-8 text-sm text-muted-foreground">
            {total === 0 ? 'Todavía no hay llamados. Tocá "Buscar licitaciones nuevas" para traer los últimos 60 días del portal.' : 'Ningún llamado coincide con este filtro.'}
          </li>
        )}
        {!cargando &&
          !error &&
          visibles.map((l) => {
            const g = grupoDe(l.dias_restantes);
            const titulo = orden === 'plazo' && g.clave !== grupoActual ? ((grupoActual = g.clave), g.titulo) : null;
            return (
              <Fragment key={l.llamado_id}>
                {titulo && (
                  <li role="presentation" className={`sticky top-0 z-10 border-b border-border/60 bg-background px-4 pt-2.5 pb-1.5 text-[13px] font-medium ${COLOR_PLAZO[g.plazo]}`}>
                    {titulo}
                  </li>
                )}
                <FilaLlamado llamado={l} seleccionado={l.llamado_id === seleccionado} onClick={() => onSeleccionar(l.llamado_id)} />
              </Fragment>
            );
          })}
      </ol>
    </section>
  );
}
