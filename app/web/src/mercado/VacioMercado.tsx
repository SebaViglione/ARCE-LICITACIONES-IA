import { useEffect, useState } from 'react';
import { mercadoApi, type Lote, type ResumenMercado } from '@/lib/mercadoApi';
import { haceCuanto } from '@/lib/formato';
import { entero } from '@/lib/numeros';

// Estado vacío: todavía no llegó el histórico. Explica cómo alimentar el tablero y muestra si algo falló al ingresar.

export function VacioMercado({ resumen }: { resumen: ResumenMercado | null }) {
  const [lotes, setLotes] = useState<Lote[]>([]);
  useEffect(() => {
    mercadoApi
      .estado()
      .then((e) => setLotes(e.lotes))
      .catch(() => setLotes([]));
  }, []);
  const conRechazos = lotes.filter((l) => l.rechazados > 0);
  const hayLlamados = (resumen?.llamados ?? 0) > 0;

  return (
    <div className="scroll-fino min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[72ch] px-6 py-10">
        <p className="text-[13px] text-muted-foreground">Todo listo, falta el histórico</p>
        <h1 className="mt-1 text-[26px] leading-tight font-semibold tracking-tight">El tablero se llena solo cuando el scraper empiece a mandar llamados</h1>
        <p className="mt-3 text-[15px] text-muted-foreground">
          {hayLlamados
            ? `Hay ${entero(resumen!.llamados)} llamados cargados pero ninguna adjudicación con fecha: las estadísticas se calculan sobre lo adjudicado. Cuando lleguen llamados adjudicados (o se recalculen las vistas) aparecen los rankings.`
            : 'Cada lote que llega a la API se guarda crudo, se normaliza (organismos, proveedores por RUT, artículos del catálogo, monedas y unidades) y dispara el recálculo de las estadísticas. No hay nada que configurar del lado del tablero.'}
        </p>

        <ol className="mt-6 flex flex-col gap-4 text-[14.5px]">
          <li className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="font-medium">1. Definir el token de ingesta</p>
            <p className="mt-1 text-muted-foreground">
              <code className="rounded bg-secondary px-1.5 py-0.5 text-[13px]">INGESTA_TOKEN=$(openssl rand -hex 32)</code> en el <code className="text-[13px]">.env</code> y reiniciar la app. Sin token, la ingesta responde 503.
            </p>
          </li>
          <li className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="font-medium">2. Mandar los llamados en lotes</p>
            <p className="mt-1 text-muted-foreground">
              <code className="rounded bg-secondary px-1.5 py-0.5 text-[13px]">POST /api/ingesta/llamados</code> con <code className="text-[13px]">Authorization: Bearer &lt;token&gt;</code>, hasta 500 llamados por lote, cada uno con sus ítems, ofertas y adjudicaciones. El contrato completo (JSON Schema) está en{' '}
              <a href="/api/ingesta/esquema" target="_blank" rel="noopener" className="text-azul hover:underline">
                /api/ingesta/esquema
              </a>{' '}
              y explicado en <code className="text-[13px]">docs/MERCADO.md</code>. Las cotizaciones del dólar y la UI van a <code className="text-[13px]">/api/ingesta/cotizaciones</code>.
            </p>
          </li>
          <li className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="font-medium">3. Ver el tablero con datos de prueba mientras tanto</p>
            <p className="mt-1 text-muted-foreground">
              <code className="rounded bg-secondary px-1.5 py-0.5 text-[13px]">cd app && npm run mercado:demo</code> genera tres años de compras sintéticas (claramente marcadas como fuente <code className="text-[13px]">demo-sintetico</code>) y las manda por la misma API. Se borran con <code className="text-[13px]">npm run mercado:demo -- --limpiar</code>.
            </p>
          </li>
        </ol>

        {lotes.length > 0 && (
          <section className="mt-8">
            <h2 className="text-[15px] font-semibold text-muted-foreground">Lotes recibidos</h2>
            <ul className="mt-2 flex flex-col text-[13.5px]">
              {lotes.slice(0, 10).map((l) => (
                <li key={l.id} className="flex flex-wrap items-baseline gap-x-3 border-t border-border/60 py-1.5">
                  <span className="text-muted-foreground">{haceCuanto(l.finalizado_en ?? l.recibido_en)}</span>
                  <span>
                    {l.tipo} · {l.fuente}
                  </span>
                  <span className="text-muted-foreground">
                    {l.recibidos} recibidos, {l.insertados} nuevos, {l.actualizados} actualizados, {l.sin_cambios} sin cambios{l.rechazados ? `, ${l.rechazados} rechazados` : ''}
                  </span>
                </li>
              ))}
            </ul>
            {conRechazos.length > 0 && (
              <div className="mt-3 rounded-lg border border-rojo/40 bg-rojo/10 px-4 py-3 text-[13.5px]">
                <p className="font-medium text-rojo">Hubo llamados rechazados</p>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {conRechazos
                    .flatMap((l) => (l.errores ?? []).slice(0, 5).map((e) => ({ lote: l.id, ...e })))
                    .slice(0, 8)
                    .map((e, i) => (
                      <li key={i}>
                        lote {e.lote}, {e.clave}: {e.error}
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
