import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { api, ESTADOS_SEGUIMIENTO, type EstadoSeguimiento, type Llamado } from '@/lib/api';

interface Props {
  llamado: Llamado;
  onGuardado: (l: Pick<Llamado, 'llamado_id' | 'es_relevante_real' | 'estado_seguimiento' | 'comentario'>) => void;
}

export function Decision({ llamado: l, onGuardado }: Props) {
  const [relevante, setRelevante] = useState<boolean | null>(l.es_relevante_real);
  const [estado, setEstado] = useState<EstadoSeguimiento>((l.estado_seguimiento as EstadoSeguimiento) || 'pendiente');
  const [nota, setNota] = useState(l.comentario ?? '');
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error' | 'info'; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    setRelevante(l.es_relevante_real);
    setEstado((l.estado_seguimiento as EstadoSeguimiento) || 'pendiente');
    setNota(l.comentario ?? '');
    setAviso(null);
  }, [l.llamado_id, l.es_relevante_real, l.estado_seguimiento, l.comentario]);

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    setAviso({ tipo: 'info', texto: 'Guardando…' });
    try {
      const r = await api.feedback({ llamado_id: l.llamado_id, es_relevante_real: relevante, estado_seguimiento: estado, comentario: nota.trim() || null });
      onGuardado({ llamado_id: r.llamado_id, es_relevante_real: r.es_relevante_real, estado_seguimiento: r.estado_seguimiento, comentario: r.comentario });
      setAviso({ tipo: 'ok', texto: relevante === null ? 'Guardado sin decisión de relevancia.' : 'Decisión guardada.' });
    } catch (err) {
      setAviso({ tipo: 'error', texto: `No se pudo guardar: ${(err as Error).message}` });
    } finally {
      setGuardando(false);
    }
  };

  const valorToggle = relevante === null ? [] : [relevante ? 'si' : 'no'];

  return (
    <form onSubmit={guardar} className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-[15px] font-semibold">
        Nuestra decisión <span className="ml-2 font-normal text-muted-foreground">cada decisión mide a la IA</span>
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup value={valorToggle} onValueChange={(v) => setRelevante(v.length === 0 ? null : v[0] === 'si')} variant="outline" aria-label="¿Es para nosotros?">
          <ToggleGroupItem value="si" className="data-[pressed]:bg-vidrio/15 data-[pressed]:text-vidrio" aria-label="Es para nosotros">
            Es para nosotros
          </ToggleGroupItem>
          <ToggleGroupItem value="no" aria-label="No es para nosotros">
            No es para nosotros
          </ToggleGroupItem>
        </ToggleGroup>
        <Select value={estado} onValueChange={(v) => setEstado(v as EstadoSeguimiento)} items={ESTADOS_SEGUIMIENTO}>
          <SelectTrigger className="h-8 min-w-36" aria-label="Estado de seguimiento">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ESTADOS_SEGUIMIENTO) as EstadoSeguimiento[]).map((k) => (
              <SelectItem key={k} value={k}>
                {ESTADOS_SEGUIMIENTO[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota para el equipo (opcional)" maxLength={5000} className="h-8 min-w-48 flex-1" aria-label="Nota" />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className={`min-h-5 text-[13px] ${aviso?.tipo === 'ok' ? 'text-vidrio' : aviso?.tipo === 'error' ? 'text-rojo' : 'text-muted-foreground'}`} aria-live="polite">
          {aviso?.texto ?? ''}
        </p>
        <Button type="submit" disabled={guardando} className="font-semibold">
          Guardar decisión
        </Button>
      </div>
    </form>
  );
}
