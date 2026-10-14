import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Sparkles } from 'lucide-react';
import SpotlightCard from '@/components/SpotlightCard';
import ShinyText from '@/components/ShinyText';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { analistaApi, type AnalisisProducto, type EstadoAnalisis, type InformeIa, type InformeMercado, type Rango, type RespuestaPregunta } from '@/lib/mercadoApi';
import { haceCuanto } from '@/lib/formato';
import { precioUyu, unidadLegible } from '@/lib/numeros';
import { Seccion } from '@/mercado/comunes';
import { navegar } from '@/lib/ruta';
import { cn } from '@/lib/utils';

// La IA que lee las estadísticas: informe del mercado, veredicto por producto y preguntas libres.
// Los análisis pueden tardar minutos con un modelo local: se piden, se consulta el estado cada 4 s y se muestran al llegar.

function useAnalisis<T>(cargar: () => Promise<EstadoAnalisis<T>>, generar: () => Promise<unknown>, deps: unknown[]) {
  const [estado, setEstado] = useState<EstadoAnalisis<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lanzando, setLanzando] = useState(false);

  const recargar = useCallback(async () => {
    try {
      setEstado(await cargar());
    } catch (err) {
      setError((err as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    setEstado(null);
    setError(null);
    void recargar();
  }, [recargar]);

  useEffect(() => {
    if (!estado?.en_curso) return;
    const t = setInterval(() => void recargar(), 4000);
    return () => clearInterval(t);
  }, [estado?.en_curso, recargar]);

  const pedir = async () => {
    setLanzando(true);
    setError(null);
    try {
      await generar();
      await recargar();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLanzando(false);
    }
  };

  return { estado, error, pedir, lanzando };
}

function Pie({ informe }: { informe: InformeIa<unknown> }) {
  return (
    <p className="angosta mt-3 text-[12.5px] text-texto-3">
      Generado {haceCuanto(informe.creado_en)} con {informe.modelo ?? 'modelo desconocido'}
      {informe.duracion_ms ? ` en ${Math.round(informe.duracion_ms / 1000)} s` : ''}
      {informe.prompt_tokens ? ` · ${informe.prompt_tokens.toLocaleString('es-UY')} tokens de datos` : ''}. Todo lo que dice sale de las estadísticas del tablero; los datos que leyó quedan guardados con el informe.
    </p>
  );
}

function Lista({ titulo, items, className }: { titulo: string; items: string[]; className?: string }) {
  if (!items.length) return null;
  return (
    <div className={className}>
      <h3 className="mb-1 text-[13px] font-semibold text-muted-foreground">{titulo}</h3>
      <ul className="flex list-disc flex-col gap-1 pl-4 text-[13.5px]">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

function BotonPedir({ hayInforme, enCurso, lanzando, onClick, texto }: { hayInforme: boolean; enCurso: boolean; lanzando: boolean; onClick: () => void; texto: string }) {
  return (
    <Button variant={hayInforme ? 'outline' : 'default'} size="sm" onClick={onClick} disabled={enCurso || lanzando} className="shrink-0 font-semibold">
      <Sparkles className={enCurso || lanzando ? 'animate-pulse' : ''} />
      {enCurso ? 'Analizando…' : hayInforme ? 'Analizar de nuevo' : texto}
    </Button>
  );
}

function Esperando({ texto }: { texto: string }) {
  return (
    <p className="mt-2 text-[13.5px]" aria-live="polite">
      <ShinyText text={texto} color="#9aa4af" shineColor="#e6eaee" speed={3} />
    </p>
  );
}

const PRIORIDAD = { alta: 'bg-vidrio/15 text-vidrio', media: 'bg-ambar/15 text-ambar', baja: 'bg-secondary text-muted-foreground' } as const;

// --- Informe del mercado -----------------------------------------------------

export function AnalisisMercado({ rango, categoria, version }: { rango: Rango; categoria: number | null; version: number }) {
  const filtros = { desde: rango.desde, hasta: rango.hasta, categoria };
  const { estado, error, pedir, lanzando } = useAnalisis(() => analistaApi.analisis(filtros), () => analistaApi.generarAnalisis(filtros), [rango.desde, rango.hasta, categoria, version]);
  const informe = estado?.informe ?? null;
  const enCurso = estado?.en_curso ?? false;

  return (
    <SpotlightCard id="informe-ia" theme="dark" spotlightColor="rgba(92, 195, 169, 0.2)" className="rounded-lg! p-4! [background-color:var(--card)]! mt-5 border-l-4 border-l-vidrio">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-vidrio">Lo que dice la IA del mercado</h2>
          <p className="mt-0.5 max-w-[70ch] text-[13px] text-muted-foreground">Un modelo de lenguaje lee las oportunidades, los precios, los proveedores y los compradores del período y escribe el informe para la dirección.</p>
        </div>
        <BotonPedir hayInforme={!!informe} enCurso={enCurso} lanzando={lanzando} onClick={() => void pedir()} texto="Pedir el informe" />
      </div>
      {enCurso && <Esperando texto="La IA está leyendo las estadísticas y escribiendo el informe. Con un modelo local tarda entre uno y tres minutos; se muestra solo al terminar." />}
      {(error || estado?.error) && <p className="mt-2 text-[13.5px] text-rojo">No se pudo generar el informe: {error ?? estado?.error}</p>}
      {informe && (
        <div className="mt-3">
          <p className="max-w-[80ch] text-[14.5px] leading-relaxed">{informe.informe.resumen_ejecutivo}</p>
          {informe.informe.oportunidades.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1.5 text-[13px] font-semibold text-muted-foreground">Qué atacar, en orden</h3>
              <ol className="flex flex-col gap-2">
                {informe.informe.oportunidades.map((o, i) => (
                  <li key={i} className="rounded-md border border-border/70 bg-background/40 px-3 py-2">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="condensada text-[13px] text-texto-3 tabular-nums">{i + 1}</span>
                      {o.articulo_id ? (
                        <button type="button" onClick={() => navegar(`/mercado/productos/${o.articulo_id}`, new URLSearchParams(location.search))} className="text-[14.5px] font-medium hover:underline">
                          {o.producto}
                        </button>
                      ) : (
                        <span className="text-[14.5px] font-medium">{o.producto}</span>
                      )}
                      <span className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-medium', PRIORIDAD[o.prioridad])}>prioridad {o.prioridad}</span>
                    </div>
                    <p className="mt-1 max-w-[80ch] text-[13.5px]">{o.por_que}</p>
                    <p className="mt-1 text-[13px] text-muted-foreground">
                      {o.precio_de_entrada && <span className="mr-3 text-foreground">Precio de entrada: {o.precio_de_entrada}.</span>}
                      {o.competidores_a_vigilar.length > 0 && <span className="mr-3">Vigilar a {o.competidores_a_vigilar.join(', ')}.</span>}
                      {o.riesgos && <span className="text-ambar">Riesgo: {o.riesgos}</span>}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
            <Lista titulo="Tendencias" items={informe.informe.tendencias} />
            <Lista titulo="Competencia" items={informe.informe.competencia} />
            <Lista titulo="Compradores clave" items={informe.informe.compradores_clave} />
            <Lista titulo="Preguntas abiertas" items={informe.informe.preguntas_abiertas} />
            <Lista titulo="Alertas sobre los datos" items={informe.informe.alertas_de_datos} className="text-ambar md:col-span-2" />
          </div>
          <Pie informe={informe} />
        </div>
      )}
    </SpotlightCard>
  );
}

// --- Veredicto por producto ---------------------------------------------------

const VEREDICTO = {
  entrar: { texto: 'Conviene entrar', color: 'text-vidrio', borde: 'border-l-vidrio', fondo: '[background-color:color-mix(in_oklab,var(--vidrio)_12%,var(--card))]!' },
  explorar: { texto: 'Vale la pena explorar', color: 'text-ambar', borde: 'border-l-ambar', fondo: '' },
  evitar: { texto: 'Mejor evitar', color: 'text-rojo', borde: 'border-l-rojo', fondo: '' },
} as const;

export function AnalisisProductoIa({ id, rango, version }: { id: number; rango: Rango; version: number }) {
  const { estado, error, pedir, lanzando } = useAnalisis(() => analistaApi.analisisProducto(id, rango), () => analistaApi.generarAnalisisProducto(id, rango), [id, rango.desde, rango.hasta, version]);
  const informe = estado?.informe ?? null;
  const a = informe?.informe ?? null;
  const enCurso = estado?.en_curso ?? false;
  const v = a ? VEREDICTO[a.veredicto] : null;
  const unidad = a ? unidadLegible(a.precio_recomendado.unidad) : '';

  return (
    <SpotlightCard id="veredicto-ia" theme="dark" spotlightColor="rgba(92, 195, 169, 0.22)" className={cn('rounded-lg! p-4! [background-color:var(--card)]! mt-5 border-l-4', v ? `${v.borde} ${v.fondo}` : 'border-l-texto-3')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className={cn('text-[15px] font-semibold', v?.color)}>{a && v ? `${v.texto}, según la IA (${a.confianza} % de confianza)` : '¿Conviene entrar? Veredicto de la IA'}</h2>
          {!a && <p className="mt-0.5 max-w-[70ch] text-[13px] text-muted-foreground">La IA lee los precios, los ganadores, los compradores y los cuadros comparativos de este producto y recomienda si entrar, a qué precio y cómo.</p>}
        </div>
        <BotonPedir hayInforme={!!a} enCurso={enCurso} lanzando={lanzando} onClick={() => void pedir()} texto="Pedir el veredicto" />
      </div>
      {enCurso && <Esperando texto="La IA está evaluando el producto. Con un modelo local tarda alrededor de un minuto." />}
      {(error || estado?.error) && <p className="mt-2 text-[13.5px] text-rojo">No se pudo generar el veredicto: {error ?? estado?.error}</p>}
      {a && informe && (
        <div className="mt-2">
          <p className="max-w-[80ch] text-[14px] leading-relaxed">{a.resumen}</p>
          <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
            <div>
              <dt className="text-[13px] font-semibold text-muted-foreground">Precio de entrada</dt>
              <dd className="m-0 text-[14px]">
                {a.precio_recomendado.desde !== null || a.precio_recomendado.hasta !== null ? (
                  <span className="condensada text-[18px] font-semibold tabular-nums">
                    {a.precio_recomendado.desde !== null ? precioUyu(a.precio_recomendado.desde) : '…'} a {a.precio_recomendado.hasta !== null ? precioUyu(a.precio_recomendado.hasta) : '…'} <span className="text-[13px] font-normal text-muted-foreground">por {unidad}, sin impuestos</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">sin recomendación</span>
                )}
                <span className="mt-0.5 block text-[13px] text-muted-foreground">{a.precio_recomendado.justificacion}</span>
              </dd>
            </div>
            {a.competidores.length > 0 && (
              <div>
                <dt className="text-[13px] font-semibold text-muted-foreground">Competidores que importan</dt>
                <dd className="m-0">
                  <ul className="flex flex-col gap-0.5 text-[13.5px]">
                    {a.competidores.map((c, i) => (
                      <li key={i}>
                        <span className="font-medium">{c.nombre}</span> <span className="text-muted-foreground">{c.por_que_importa}</span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
          </dl>
          <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
            <Lista titulo="A quién venderle primero" items={a.a_quien_venderle} />
            <Lista titulo="Cómo ganar" items={a.como_ganar} />
            <Lista titulo="Riesgos" items={a.riesgos} />
            <Lista titulo="Datos que faltan" items={a.datos_faltantes} className="text-muted-foreground" />
          </div>
          <Pie informe={informe} />
        </div>
      )}
    </SpotlightCard>
  );
}

// --- Preguntale al mercado --------------------------------------------------

export function PreguntarMercado() {
  const [pregunta, setPregunta] = useState('');
  const [respuesta, setRespuesta] = useState<InformeIa<RespuestaPregunta> | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recientes, setRecientes] = useState<InformeIa<RespuestaPregunta>[]>([]);

  useEffect(() => {
    analistaApi
      .preguntas(6)
      .then(setRecientes)
      .catch(() => setRecientes([]));
  }, [respuesta]);

  const enviar = async (e?: FormEvent, texto?: string) => {
    e?.preventDefault();
    const q = (texto ?? pregunta).trim();
    if (q.length < 5) return;
    setPregunta(q);
    setCargando(true);
    setError(null);
    try {
      setRespuesta(await analistaApi.preguntar(q));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCargando(false);
    }
  };

  return (
    <Seccion titulo="Preguntale al mercado" nota="la IA responde con los datos del tablero">
      <form onSubmit={(e) => void enviar(e)} className="flex flex-wrap gap-2">
        <Input value={pregunta} onChange={(e) => setPregunta(e.target.value)} placeholder="¿Quién gana las licitaciones de gasoil y a qué precio?" maxLength={500} className="h-9 min-w-64 flex-1 bg-background" aria-label="Pregunta" disabled={cargando} />
        <Button type="submit" disabled={cargando || pregunta.trim().length < 5} className="font-semibold">
          <Sparkles className={cargando ? 'animate-pulse' : ''} /> Preguntar
        </Button>
      </form>
      {recientes.length > 0 && !respuesta && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {recientes.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => void enviar(undefined, r.pregunta ?? '')} className="rounded-full bg-secondary px-2.5 py-0.5 text-[12.5px] text-muted-foreground hover:text-foreground">
                {r.pregunta}
              </button>
            </li>
          ))}
        </ul>
      )}
      {cargando && <Esperando texto="Buscando los datos relacionados y pidiéndole la respuesta a la IA…" />}
      {error && <p className="mt-2 text-[13.5px] text-rojo">{error}</p>}
      {respuesta && !cargando && (
        <div className="mt-3 rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-[13px] text-muted-foreground">{respuesta.pregunta}</p>
          {respuesta.informe.respuesta.split(/\n+/).map((p, i) => (
            <p key={i} className="mt-1.5 max-w-[80ch] text-[14.5px] leading-relaxed">
              {p}
            </p>
          ))}
          <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-3">
            <Lista titulo="Datos usados" items={respuesta.informe.datos_usados} className="text-[13px] text-muted-foreground" />
            <Lista titulo="Limitaciones" items={respuesta.informe.limitaciones} className="text-[13px] text-muted-foreground" />
            <Lista titulo="Para seguir mirando" items={respuesta.informe.sugerencias} className="text-[13px] text-muted-foreground" />
          </div>
          <Pie informe={respuesta} />
        </div>
      )}
    </Seccion>
  );
}

export type { AnalisisProducto, InformeMercado };
