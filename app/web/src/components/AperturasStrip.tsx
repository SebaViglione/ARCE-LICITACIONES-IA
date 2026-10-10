import { useId, useMemo, useState } from 'react';
import type { Llamado } from '@/lib/api';
import { fechaCorta, plural } from '@/lib/formato';

// Cuántas aperturas de ofertas caen en cada uno de los próximos 30 días.
// Una sola serie (magnitud por día) en un solo matiz: no hay paleta categórica que validar;
// el acento del tablero pasa el contraste 3:1 sobre la superficie oscura.
const DIAS = 30;
const ANCHO = 300;
const ALTO = 44;
const BASE = 34;
const GAP = 2;
const BARRA = ANCHO / DIAS - GAP;

interface Props {
  llamados: Llamado[];
}

export function AperturasStrip({ llamados }: Props) {
  const idTabla = useId();
  const [hover, setHover] = useState<number | null>(null);

  const dias = useMemo(() => {
    const cuentas = Array.from({ length: DIAS }, () => ({ total: 0, rubro: 0, fecha: null as string | null }));
    for (const l of llamados) {
      const d = l.dias_restantes;
      if (d === null || d < 0 || d >= DIAS) continue;
      const c = cuentas[d]!;
      c.total++;
      if (l.es_relevante === true) c.rubro++;
      c.fecha ??= l.fecha_apertura;
    }
    return cuentas;
  }, [llamados]);

  const max = Math.max(1, ...dias.map((d) => d.total));
  const conFecha = dias.filter((d) => d.total > 0).length;
  if (conFecha === 0) return null;

  const alturaDe = (n: number) => (n === 0 ? 0 : Math.max(4, Math.round((n / max) * (BASE - 8))));
  const h = hover !== null ? dias[hover] : null;

  return (
    <figure className="m-0">
      <figcaption className="angosta mb-1 flex items-baseline justify-between text-[12px] text-muted-foreground">
        <span>Aperturas en los próximos 30 días</span>
        {h && h.total > 0 ? (
          <span className="text-foreground">
            {fechaCorta(h.fecha) ?? `en ${hover} días`}: {plural(h.total, 'apertura', 'aperturas')}
            {h.rubro ? `, ${h.rubro} del rubro` : ''}
          </span>
        ) : (
          <span>pasá el mouse por una barra</span>
        )}
      </figcaption>
      <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} className="block h-11 w-full" role="img" aria-describedby={idTabla} onMouseLeave={() => setHover(null)}>
        <line x1={0} x2={ANCHO} y1={BASE + 0.5} y2={BASE + 0.5} className="stroke-border" strokeWidth={1} />
        {dias.map((d, i) => {
          const x = i * (ANCHO / DIAS);
          const alto = alturaDe(d.total);
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              {/* zona de hover más grande que la barra */}
              <rect x={x} y={0} width={ANCHO / DIAS} height={BASE} fill="transparent" />
              {alto > 0 && (
                <path
                  d={`M${x + 1},${BASE} v${-(alto - 3)} a3,3 0 0 1 3,-3 h${BARRA - 6} a3,3 0 0 1 3,3 v${alto - 3} z`}
                  className={hover === i ? 'fill-vidrio' : 'fill-vidrio/75'}
                />
              )}
            </g>
          );
        })}
        {[0, 7, 14, 21, 28].map((t) => (
          <text key={t} x={t * (ANCHO / DIAS) + 1} y={ALTO - 1} className="fill-muted-foreground" fontSize={8.5} fontFamily="inherit">
            {t === 0 ? 'hoy' : `+${t} d`}
          </text>
        ))}
      </svg>
      <table id={idTabla} className="sr-only">
        <caption>Aperturas por día</caption>
        <thead>
          <tr>
            <th>Día</th>
            <th>Aperturas</th>
            <th>Del rubro según la IA</th>
          </tr>
        </thead>
        <tbody>
          {dias.map((d, i) =>
            d.total ? (
              <tr key={i}>
                <td>{fechaCorta(d.fecha) ?? `en ${i} días`}</td>
                <td>{d.total}</td>
                <td>{d.rubro}</td>
              </tr>
            ) : null,
          )}
        </tbody>
      </table>
    </figure>
  );
}
