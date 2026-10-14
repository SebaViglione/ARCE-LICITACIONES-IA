import { lazy, Suspense } from 'react';
import { useRuta } from '@/lib/ruta';
import { Triage } from '@/Triage';

// Dos tableros sobre la misma API: la bandeja de licitaciones del rubro (/) y el de mercado (/mercado...).
// El de mercado trae los gráficos (recharts): se carga aparte para no pesar en la bandeja.
const Mercado = lazy(() => import('@/mercado/Mercado').then((m) => ({ default: m.Mercado })));

export default function App() {
  const ruta = useRuta();
  if (ruta.path === '/mercado' || ruta.path.startsWith('/mercado/')) {
    return (
      <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Cargando el tablero de mercado…</div>}>
        <Mercado ruta={ruta} />
      </Suspense>
    );
  }
  return <Triage />;
}
