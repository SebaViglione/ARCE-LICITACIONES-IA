import { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import AnimatedContent from '@/components/AnimatedContent';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Veredicto } from '@/components/Veredicto';
import { Decision } from '@/components/Decision';
import { api, type Detalle, type Llamado } from '@/lib/api';
import { decisionTexto, fechaCorta, fechaHora, horaCorta, partesTitulo, plazoDe, plural, textoPlazo, tituloLlamado } from '@/lib/formato';
import { cn } from '@/lib/utils';

interface Props {
  id: string | null;
  onVolver: () => void;
  onFeedbackGuardado: (l: Pick<Llamado, 'llamado_id' | 'es_relevante_real' | 'estado_seguimiento' | 'comentario'>) => void;
}

const COLOR_PLAZO = { urgente: 'text-rojo', proximo: 'text-ambar', normal: '', sin: 'text-muted-foreground' } as const;

function Dato({ etiqueta, children, className }: { etiqueta: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[13px] text-muted-foreground">{etiqueta}</dt>
      <dd className={cn('m-0 font-medium', className)}>{children}</dd>
    </div>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[15px] font-semibold text-muted-foreground">{titulo}</h2>
      {children}
    </section>
  );
}

function Visita({ l }: { l: Llamado }) {
  if (!l.requiere_visita) return <p className="text-sm text-muted-foreground">El pliego no pide visita técnica.</p>;
  const cuando = l.fecha_visita_especifica ? fechaCorta(l.fecha_visita_especifica) : l.coordina_visita ? 'A coordinar con el contacto' : 'No especifica fecha';
  const contacto = [l.contacto_visita_nombre, l.contacto_visita_telefono, l.contacto_visita_correo].filter(Boolean) as string[];
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-6 gap-y-2.5 rounded-lg border-l-[3px] border-ambar bg-card px-3.5 py-3">
      <Dato etiqueta="Lugar">{l.ubicacion_visita || l.ubicacion_obra || 'No especifica'}</Dato>
      <Dato etiqueta="Cuándo">{cuando}</Dato>
      <Dato etiqueta="Contacto">{contacto.length ? contacto.map((c, i) => <span key={i} className="block">{c}</span>) : 'No figura'}</Dato>
    </dl>
  );
}

export function Ficha({ id, onVolver, onFeedbackGuardado }: Props) {
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!id) {
      setDetalle(null);
      return;
    }
    let vigente = true;
    setCargando(true);
    setError(null);
    api
      .detalle(id)
      .then((d) => {
        if (!vigente) return;
        setDetalle(d);
        document.getElementById('detalle')?.scrollTo({ top: 0 });
      })
      .catch((err) => vigente && setError((err as Error).message))
      .finally(() => vigente && setCargando(false));
    return () => {
      vigente = false;
    };
  }, [id]);

  if (!id) {
    return (
      <div className="mx-auto flex h-full max-w-[36ch] flex-col items-center justify-center px-6 text-center text-muted-foreground">
        <p>Elegí un llamado de la lista para ver qué piden, qué dice la IA y dejar tu decisión.</p>
        <p className="mt-2 text-[13.5px] text-texto-3">Podés moverte con las flechas del teclado.</p>
      </div>
    );
  }

  if (error) {
    return <p className="p-8 text-sm text-rojo">No se pudo cargar el llamado: {error}</p>;
  }

  if (!detalle || detalle.llamado.llamado_id !== id) {
    return (
      <div className="mx-auto w-full max-w-[880px] px-8 py-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="mt-6 h-8 w-3/4" />
        <Skeleton className="mt-2 h-8 w-1/2" />
        <Skeleton className="mt-6 h-16 w-full" />
        {cargando && <span className="sr-only">Cargando</span>}
      </div>
    );
  }

  const l = detalle.llamado;
  const { tipo, organismo } = partesTitulo(l.titulo);
  const plazo = plazoDe(l.dias_restantes);
  const materiales = l.materiales_detectados ?? [];
  const formularios = l.formularios_requeridos ?? [];
  const analisisPorArchivo = new Map(detalle.analisis.map((a) => [a.archivo_analizado, a]));
  const resumen = l.resumen_trabajo ?? '';
  const descripcionDistinta = !!l.descripcion && !resumen.includes(l.descripcion.slice(0, 40));

  return (
    <AnimatedContent key={id} container="#detalle" distance={18} duration={0.45} ease="power3.out" initialOpacity={0} animateOpacity threshold={0} className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-5 pt-5 md:px-8 md:pt-6">
      <Button variant="ghost" size="sm" onClick={onVolver} className="mb-3 w-fit md:hidden">
        <ArrowLeft /> Volver a la lista
      </Button>

      <Veredicto llamado={l} analisis={detalle.analisis} />

      <h1 className="mt-6 mb-1.5 max-w-[32ch] text-[25px] leading-[1.22] font-semibold tracking-tight">{tituloLlamado(l)}</h1>
      <p className="text-[14.5px] text-muted-foreground">
        {tipo}
        {organismo ? ` de ${organismo}` : ''}
        {l.url_detalle && (
          <a href={l.url_detalle} target="_blank" rel="noopener" className="ml-2 inline-flex items-center gap-1 whitespace-nowrap text-azul hover:underline">
            Ver en Compras Estatales <ExternalLink className="size-3.5" aria-hidden />
          </a>
        )}
      </p>

      <dl className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-6 gap-y-3 border-y border-border py-3.5">
        <Dato etiqueta="Apertura de ofertas" className={COLOR_PLAZO[plazo]}>
          {fechaHora(l.fecha_apertura, l.hora_apertura) ?? 'Sin fecha'}
        </Dato>
        <Dato etiqueta="Plazo" className={COLOR_PLAZO[plazo]}>
          {textoPlazo(l.dias_restantes)}
        </Dato>
        <Dato etiqueta="Publicado">{fechaHora(l.fecha_publicacion, l.hora_publicacion) ?? '—'}</Dato>
        <Dato etiqueta="Archivos">
          {plural(detalle.adjuntos.length, 'adjunto', 'adjuntos')}, {plural(l.archivos_analizados ?? 0, 'analizado', 'analizados')}
        </Dato>
        <Dato etiqueta="Nuestra decisión">{decisionTexto(l)}</Dato>
      </dl>

      <Seccion titulo="Qué piden">
        {resumen ? <p className="max-w-[70ch]">{resumen}</p> : <p className="text-sm text-muted-foreground">La IA no resumió el trabajo todavía.</p>}
        {descripcionDistinta && <p className="mt-2 max-w-[70ch] text-sm text-muted-foreground">Descripción publicada: {l.descripcion}</p>}
        {detalle.items.length > 0 && (
          <ul className="mt-2 max-w-[70ch] list-disc pl-5">
            {detalle.items.map((i, k) => (
              <li key={k} className="my-1">
                {i}
              </li>
            ))}
          </ul>
        )}
      </Seccion>

      {materiales.length > 0 && (
        <Seccion titulo="Materiales detectados">
          <ul className="flex flex-wrap gap-1.5">
            {materiales.map((m) => (
              <li key={m} className="rounded-full bg-secondary px-2.5 py-0.5 text-[13.5px]">
                {m}
              </li>
            ))}
          </ul>
        </Seccion>
      )}

      <Seccion titulo="Visita técnica">
        <Visita l={l} />
      </Seccion>

      {formularios.length > 0 && (
        <Seccion titulo="Formularios a presentar">
          <ul className="max-w-[70ch] list-disc pl-5">
            {formularios.map((f, k) => (
              <li key={k} className="my-1">
                {f.nombre}
                {f.obligatorio ? ' (obligatorio)' : ' (opcional)'}
                {f.seccion ? `, ${f.seccion}` : ''}
              </li>
            ))}
          </ul>
        </Seccion>
      )}

      <Seccion titulo="Adjuntos">
        {detalle.adjuntos.length === 0 ? (
          <p className="text-sm text-muted-foreground">El llamado no tiene archivos adjuntos.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {detalle.adjuntos.map((a) => {
              const an = analisisPorArchivo.get(a.nombre ?? '');
              const estadoTxt = an?.es_relevante === true ? `analizado, del rubro ${an.confianza} %` : an?.es_relevante === false ? 'analizado, no es del rubro' : an?.errores_extraccion ? 'no se pudo leer' : '';
              return (
                <li key={a.id} className="flex flex-wrap items-baseline gap-2.5">
                  <span className="condensada min-w-10 text-[12.5px] text-texto-3">{(a.tipo ?? 'archivo').toUpperCase()}</span>
                  <a href={a.archivo_url} target="_blank" rel="noopener" className="text-azul hover:underline">
                    {a.nombre || a.archivo_url}
                  </a>
                  {estadoTxt && <span className="text-[12.5px] text-texto-3">{estadoTxt}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </Seccion>

      <Seccion titulo="Aclaraciones">
        {detalle.aclaraciones.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin aclaraciones publicadas.</p>
        ) : (
          <ul className="flex flex-col">
            {detalle.aclaraciones.map((a) => (
              <li key={a.id} className="border-t border-border/60 py-2">
                {a.fecha && (
                  <time className="mr-2 text-[13px] text-muted-foreground">
                    {fechaCorta(a.fecha)}
                    {a.hora ? ` ${horaCorta(a.hora)}` : ''}
                  </time>
                )}
                {a.texto}
                {a.archivo_url && (
                  <a href={a.archivo_url} target="_blank" rel="noopener" className="ml-2 text-azul hover:underline">
                    Ver archivo
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Seccion>

      <div className="sticky bottom-0 mt-auto bg-gradient-to-b from-transparent via-background to-background pt-5 pb-5">
        <Decision llamado={l} onGuardado={onFeedbackGuardado} />
      </div>
    </AnimatedContent>
  );
}
