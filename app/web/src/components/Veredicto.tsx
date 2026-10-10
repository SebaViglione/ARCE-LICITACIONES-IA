import SpotlightCard from '@/components/SpotlightCard';
import type { AnalisisResumen, Llamado } from '@/lib/api';
import { haceCuanto } from '@/lib/formato';
import { cn } from '@/lib/utils';

interface Props {
  llamado: Llamado;
  analisis: AnalisisResumen[];
}

export function Veredicto({ llamado: l, analisis }: Props) {
  const principal = analisis.find((a) => a.es_relevante !== null);
  const sinAnalisis = l.es_relevante === null;
  const si = l.es_relevante === true;
  const fuente =
    l.archivo_analizado === 'METADATA_FALLBACK' ? 'solo con el título, la descripción y los ítems (no había pliego legible)' : `a partir de ${l.archivo_analizado ?? 'los adjuntos'}`;
  const cuando = haceCuanto(principal?.analizado_en ?? l.analizado_en);

  return (
    <SpotlightCard
      theme="dark"
      spotlightColor={si ? 'rgba(92, 195, 169, 0.28)' : 'rgba(230, 234, 238, 0.14)'}
      className={cn(
        'rounded-lg! p-4! [background-color:var(--card)]! border-l-4',
        sinAnalisis ? 'border-l-ambar' : si ? 'border-l-vidrio [background-color:color-mix(in_oklab,var(--vidrio)_12%,var(--card))]!' : 'border-l-texto-3',
      )}
    >
      <div className={cn('text-[15px] font-semibold', si && 'text-vidrio')}>
        {sinAnalisis ? 'La IA todavía no analizó este llamado' : si ? `Es del rubro según la IA, con ${l.confianza} % de confianza` : `No parece del rubro según la IA (${l.confianza} % de confianza)`}
      </div>
      {sinAnalisis ? (
        <p className="mt-1 text-sm text-muted-foreground">Se analiza en la próxima corrida; mientras tanto podés leer el pliego en los adjuntos.</p>
      ) : (
        <>
          {l.razon && <p className="mt-1 max-w-[80ch] text-sm text-muted-foreground">{l.razon}</p>}
          <p className="angosta mt-1.5 text-[12.5px] text-texto-3">
            Analizado con {l.modelo ?? 'modelo desconocido'} {fuente}
            {cuando ? `, ${cuando}` : ''}
          </p>
        </>
      )}
    </SpotlightCard>
  );
}
