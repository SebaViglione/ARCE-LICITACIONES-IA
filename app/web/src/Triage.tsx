import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type EstadoPipeline, type Llamado, type Metricas } from '@/lib/api';
import { Barra } from '@/components/Barra';
import { Bandeja, type Orden, type Vista } from '@/components/Bandeja';
import { Ficha } from '@/components/Ficha';

export function Triage() {
  const [llamados, setLlamados] = useState<Llamado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [seleccionado, setSeleccionado] = useState<string | null>(() => decodeURIComponent(location.hash.slice(1)) || null);
  const [verDetalle, setVerDetalle] = useState(() => location.hash.length > 1);
  const [vista, setVista] = useState<Vista>('todos');
  const [orden, setOrden] = useState<Orden>('plazo');
  const [busqueda, setBusqueda] = useState('');
  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [pipeline, setPipeline] = useState<EstadoPipeline | null>(null);
  const [rubro, setRubro] = useState('');
  const enCursoAntes = useRef(false);

  const cargarLlamados = useCallback(async () => {
    try {
      const rows = await api.llamados();
      setLlamados(rows);
      setErrorCarga(null);
    } catch (err) {
      setErrorCarga((err as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);

  const cargarMetricas = useCallback(() => {
    api.metricas().then(setMetricas).catch(() => undefined);
  }, []);

  const cargarPipeline = useCallback(async () => {
    try {
      const e = await api.pipelineEstado();
      setPipeline(e);
      if (enCursoAntes.current && !e.enCurso) {
        await cargarLlamados();
        cargarMetricas();
      }
      enCursoAntes.current = e.enCurso;
    } catch {
      /* se reintenta en el próximo tick */
    }
  }, [cargarLlamados, cargarMetricas]);

  useEffect(() => {
    void cargarLlamados();
    cargarMetricas();
    void cargarPipeline();
    api.rubros().then((r) => setRubro(r.actual)).catch(() => undefined);
  }, [cargarLlamados, cargarMetricas, cargarPipeline]);

  // Mientras corre el pipeline, se consulta el estado cada 5 s
  useEffect(() => {
    if (!pipeline?.enCurso) return;
    const t = setInterval(() => void cargarPipeline(), 5000);
    return () => clearInterval(t);
  }, [pipeline?.enCurso, cargarPipeline]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const dias = (l: Llamado) => (l.dias_restantes === null ? 9999 : l.dias_restantes);
    const filtrados = llamados.filter((l) => {
      if (vista === 'ia' && l.es_relevante !== true) return false;
      if (vista === 'sin_revisar' && l.es_relevante_real !== null) return false;
      if (vista === 'revisados' && l.es_relevante_real === null) return false;
      if (q) {
        const texto = `${l.titulo ?? ''} ${l.descripcion ?? ''} ${l.ai_descripcion ?? ''} ${l.razon ?? ''}`.toLowerCase();
        if (!texto.includes(q)) return false;
      }
      return true;
    });
    return filtrados.sort((a, b) => {
      if (orden === 'ia') {
        const ra = a.es_relevante === true ? 1 : 0;
        const rb = b.es_relevante === true ? 1 : 0;
        return rb - ra || (b.confianza ?? -1) - (a.confianza ?? -1) || dias(a) - dias(b);
      }
      if (orden === 'reciente') {
        return `${b.fecha_publicacion ?? ''}T${b.hora_publicacion ?? ''}`.localeCompare(`${a.fecha_publicacion ?? ''}T${a.hora_publicacion ?? ''}`);
      }
      return dias(a) - dias(b) || (b.es_relevante === true ? 1 : 0) - (a.es_relevante === true ? 1 : 0) || (b.confianza ?? 0) - (a.confianza ?? 0);
    });
  }, [llamados, vista, orden, busqueda]);

  // Selección inicial: el hash, o la primera fila en pantallas anchas
  useEffect(() => {
    if (cargando || llamados.length === 0) return;
    if (seleccionado && llamados.some((l) => l.llamado_id === seleccionado)) return;
    if (window.innerWidth > 768 && visibles[0]) setSeleccionado(visibles[0].llamado_id);
  }, [cargando, llamados, visibles, seleccionado]);

  useEffect(() => {
    if (seleccionado) history.replaceState(null, '', `#${encodeURIComponent(seleccionado)}`);
  }, [seleccionado]);

  const seleccionar = useCallback((id: string) => {
    setSeleccionado(id);
    setVerDetalle(true);
  }, []);

  // Flechas para moverse por la lista (salvo dentro de campos de texto)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag && ['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;
      if (!visibles.length) return;
      e.preventDefault();
      const idx = visibles.findIndex((l) => l.llamado_id === seleccionado);
      const next = e.key === 'ArrowDown' ? Math.min(idx + 1, visibles.length - 1) : Math.max(idx - 1, 0);
      const id = visibles[next]?.llamado_id;
      if (id) setSeleccionado(id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visibles, seleccionado]);

  const onFeedbackGuardado = useCallback(
    (actualizado: Pick<Llamado, 'llamado_id' | 'es_relevante_real' | 'estado_seguimiento' | 'comentario'>) => {
      setLlamados((prev) => prev.map((l) => (l.llamado_id === actualizado.llamado_id ? { ...l, ...actualizado } : l)));
      cargarMetricas();
    },
    [cargarMetricas],
  );

  const iniciarBusqueda = useCallback(async () => {
    try {
      await api.pipelineRun();
      enCursoAntes.current = true;
      setPipeline((p) => (p ? { ...p, enCurso: true, iniciadaEn: new Date().toISOString() } : p));
      setTimeout(() => void cargarPipeline(), 800);
    } catch (err) {
      setPipeline((p) => (p ? { ...p, enCurso: false } : p));
      throw err;
    }
  }, [cargarPipeline]);

  return (
    <div className="flex h-full flex-col">
      <Barra rubro={rubro} llamados={llamados} metricas={metricas} pipeline={pipeline} onBuscar={iniciarBusqueda} />
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[380px_minmax(0,1fr)] lg:grid-cols-[420px_minmax(0,1fr)]">
        <div className={`min-h-0 border-r border-border ${verDetalle ? 'hidden md:flex' : 'flex'} flex-col`}>
          <Bandeja
            llamados={llamados}
            visibles={visibles}
            seleccionado={seleccionado}
            cargando={cargando}
            error={errorCarga}
            vista={vista}
            orden={orden}
            busqueda={busqueda}
            onVista={setVista}
            onOrden={setOrden}
            onBusqueda={setBusqueda}
            onSeleccionar={seleccionar}
          />
        </div>
        <div id="detalle" className={`scroll-fino min-h-0 overflow-y-auto ${verDetalle ? 'block' : 'hidden md:block'}`}>
          <Ficha id={seleccionado} onVolver={() => setVerDetalle(false)} onFeedbackGuardado={onFeedbackGuardado} />
        </div>
      </div>
    </div>
  );
}
