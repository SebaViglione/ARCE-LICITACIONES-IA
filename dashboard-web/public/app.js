// public/app.js

let llamados = [];
let filteredLlamados = [];

const cardsContainer = document.getElementById('cardsContainer');

const sumActivos = document.getElementById('sumActivos');
const sumProximos = document.getElementById('sumProximos');
const sumIARelevantes = document.getElementById('sumIARelevantes');
const sumHumanas = document.getElementById('sumHumanas');

const filterEstado = document.getElementById('filterEstado');
const filterRelevancia = document.getElementById('filterRelevancia');
const sortBy = document.getElementById('sortBy');
const searchInput = document.getElementById('searchInput');

const viewGridBtn = document.getElementById('viewGrid');
const viewListBtn = document.getElementById('viewList');

const modalOverlay = document.getElementById('modalOverlay');
const modalClose = document.getElementById('modalClose');

const modalTitulo = document.getElementById('modalTitulo');
const modalDescripcion = document.getElementById('modalDescripcion');
const modalFechaPub = document.getElementById('modalFechaPub');
const modalFechaApertura = document.getElementById('modalFechaApertura');
const modalDiasRestantes = document.getElementById('modalDiasRestantes');
const modalUrgencia = document.getElementById('modalUrgencia');
const modalEstado = document.getElementById('modalEstado');
const modalUrlDetalle = document.getElementById('modalUrlDetalle');
const modalAdjuntosList = document.getElementById('modalAdjuntosList');
const modalAclaracionesList = document.getElementById('modalAclaracionesList');
const modalIARelevante = document.getElementById('modalIARelevante');
const modalIAConfianza = document.getElementById('modalIAConfianza');
const modalIARazon = document.getElementById('modalIARazon');
const modalIAResumen = document.getElementById('modalIAResumen');
const modalIAMateriales = document.getElementById('modalIAMateriales');

// Ubicación y visita
const modalUbicacionObra = document.getElementById('modalUbicacionObra');
const modalRequiereVisita = document.getElementById('modalRequiereVisita');
const modalVisitaDetalles = document.getElementById('modalVisitaDetalles');
const modalUbicacionVisita = document.getElementById('modalUbicacionVisita');
const modalFechaVisita = document.getElementById('modalFechaVisita');

// Contacto
const modalContactoSection = document.getElementById('modalContactoSection');
const modalContactoNombre = document.getElementById('modalContactoNombre');
const modalContactoTelefono = document.getElementById('modalContactoTelefono');
const modalContactoCorreo = document.getElementById('modalContactoCorreo');

// Formularios
const modalFormulariosSection = document.getElementById('modalFormulariosSection');
const modalFormulariosList = document.getElementById('modalFormulariosList');

const feedbackForm = document.getElementById('feedbackForm');
const fbLlamadoId = document.getElementById('fbLlamadoId');
const fbEsRelevante = document.getElementById('fbEsRelevante');
const fbEstadoSeguimiento = document.getElementById('fbEstadoSeguimiento');
const fbComentario = document.getElementById('fbComentario');
const fbStatus = document.getElementById('fbStatus');

async function fetchLlamados() {
  const res = await fetch('/api/llamados');
  if (!res.ok) throw new Error('Error al cargar llamados');
  llamados = await res.json();
  filteredLlamados = [...llamados];
  updateSummary();
  renderCards();
}

function updateSummary() {
  const activos = llamados.length;

  const proximos = llamados.filter((l) => {
    if (l.dias_restantes == null) return false;
    return l.dias_restantes >= 0 && l.dias_restantes <= 5;
  }).length;

  const iaRelevantes = llamados.filter((l) => l.es_relevante === true).length;
  const revisadasHumanas = llamados.filter((l) => l.es_relevante_real !== null && l.es_relevante_real !== undefined).length;

  sumActivos.textContent = activos;
  sumProximos.textContent = proximos;
  sumIARelevantes.textContent = iaRelevantes;
  sumHumanas.textContent = revisadasHumanas;
}

function applyFilters() {
  const estado = filterEstado.value;
  const relevancia = filterRelevancia.value;
  const sort = sortBy.value;
  const search = (searchInput.value || '').toLowerCase();

  filteredLlamados = llamados.filter((l) => {
    if (estado) {
      const estHumano = l.estado_seguimiento || 'pendiente';
      if (estHumano !== estado) return false;
    }

    if (relevancia === 'solo_ia_relevante' && !l.es_relevante) return false;
    if (relevancia === 'solo_humano_relevante' && !l.es_relevante_real) return false;
    if (relevancia === 'proximos_7_dias') {
      if (l.dias_restantes == null || l.dias_restantes < 0 || l.dias_restantes > 7) return false;
    }

    if (search) {
      const text = `${l.titulo || ''} ${l.descripcion || ''} ${l.ai_descripcion || ''}`.toLowerCase();
      if (!text.includes(search)) return false;
    }

    return true;
  });

  // Ordenar según criterio seleccionado
  filteredLlamados.sort((a, b) => {
    switch (sort) {
      case 'dias_asc':
        return (a.dias_restantes ?? 999) - (b.dias_restantes ?? 999);
      case 'dias_desc':
        return (b.dias_restantes ?? -1) - (a.dias_restantes ?? -1);
      case 'confianza_desc':
        return (b.confianza ?? 0) - (a.confianza ?? 0);
      case 'confianza_asc':
        return (a.confianza ?? 0) - (b.confianza ?? 0);
      case 'fecha_pub_desc':
        return new Date(b.fecha_publicacion || 0) - new Date(a.fecha_publicacion || 0);
      case 'fecha_pub_asc':
        return new Date(a.fecha_publicacion || 0) - new Date(b.fecha_publicacion || 0);
      case 'titulo_asc':
        return (a.titulo || '').localeCompare(b.titulo || '');
      default:
        return 0;
    }
  });

  renderCards();
}

function renderCards() {
  cardsContainer.innerHTML = '';

  if (filteredLlamados.length === 0) {
    cardsContainer.innerHTML =
      '<p style="font-size:13px;color:#9ca3af;text-align:center;padding:48px;">No se encontraron llamados con esos filtros.</p>';
    return;
  }

  filteredLlamados.forEach((l) => {
    const card = document.createElement('article');
    card.className = 'card';

    const dias = l.dias_restantes;
    let urgBadgeClass = '';
    if (dias != null) {
      if (dias <= 2) urgBadgeClass = 'badge-urgente';
      else if (dias <= 5) urgBadgeClass = 'badge-proximo';
    }

    // Usar ai_descripcion si existe, sino el título original
    const tituloDisplay = l.ai_descripcion || l.titulo || 'Sin título';

    card.innerHTML = `
      <h3 class="card-title">${escapeHtml(tituloDisplay)}</h3>
      <div class="card-subtitle">
        Apertura: ${formatFechaHora(l.fecha_apertura, l.hora_apertura)} ·
        Publicado: ${formatFechaHora(l.fecha_publicacion, l.hora_publicacion)}
      </div>
      <div class="card-meta-row">
        <span>Días restantes: <strong>${dias == null ? '—' : dias}</strong></span>
        <span>Urgencia: <strong>${l.urgencia || '—'}</strong></span>
      </div>
      <div class="card-meta-row">
        <span>IA relevancia: <strong>${
          l.es_relevante === true
            ? `${l.confianza ?? 0}%`
            : l.es_relevante === false
            ? 'No relevante'
            : '—'
        }</strong></span>
        <span>Archivos: <strong>${l.total_archivos ?? 0}</strong></span>
      </div>
      <div class="badges-row">
        ${
          urgBadgeClass
            ? `<span class="badge ${urgBadgeClass}">${
                dias != null && dias <= 2 ? 'Muy urgente' : 'Próximo'
              }</span>`
            : ''
        }
        ${
          l.es_relevante
            ? '<span class="badge badge-ia">IA: relevante</span>'
            : ''
        }
        ${
          l.es_relevante_real === true
            ? '<span class="badge badge-humano">Humano: relevante</span>'
            : ''
        }
      </div>
    `;

    card.addEventListener('click', () => openModal(l.llamado_id));
    cardsContainer.appendChild(card);
  });
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatFechaHora(fecha, hora) {
  if (!fecha) return '—';

  // Parsear fecha ISO (2025-11-18T00:00:00.000Z) a formato legible (18/11/2025)
  let f = fecha;
  if (typeof fecha === 'string') {
    // Si es formato ISO, extraer solo la parte de fecha
    if (fecha.includes('T')) {
      const dateObj = new Date(fecha);
      const day = String(dateObj.getDate()).padStart(2, '0');
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const year = dateObj.getFullYear();
      f = `${day}/${month}/${year}`;
    } else if (fecha.match(/^\d{4}-\d{2}-\d{2}$/)) {
      // Formato YYYY-MM-DD -> DD/MM/YYYY
      const parts = fecha.split('-');
      f = `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
  }

  // Formatear hora (HH:MM:SS -> HH:MM)
  const h = hora ? hora.substring(0, 5) : '';
  return h ? `${f} ${h}` : f;
}

async function openModal(llamadoId) {
  fbStatus.textContent = '';
  fbStatus.className = 'fb-status';

  try {
    const res = await fetch(`/api/llamados/${encodeURIComponent(llamadoId)}`);
    if (!res.ok) throw new Error('No se pudo cargar el detalle');
    const data = await res.json();

    const l = data.llamado;

    modalTitulo.textContent = l.titulo || '';
    modalDescripcion.textContent = l.descripcion || '';
    modalFechaPub.textContent = formatFechaHora(l.fecha_publicacion, l.hora_publicacion);
    modalFechaApertura.textContent = formatFechaHora(l.fecha_apertura, l.hora_apertura);
    modalDiasRestantes.textContent =
      l.dias_restantes == null ? '—' : l.dias_restantes;
    modalUrgencia.textContent = l.urgencia || '—';
    modalEstado.textContent = l.estado || '—';
    modalUrlDetalle.href = l.url_detalle || '#';

    // IA - Análisis principal
    modalIARelevante.textContent =
      l.es_relevante === true
        ? 'Sí'
        : l.es_relevante === false
        ? 'No'
        : 'Sin dato';
    modalIAConfianza.textContent =
      l.confianza != null ? `${l.confianza}%` : '—';
    modalIARazon.textContent = l.razon || '—';
    modalIAResumen.textContent = l.resumen_trabajo || '—';

    // Materiales detectados
    if (l.materiales_detectados && l.materiales_detectados.length > 0) {
      modalIAMateriales.textContent = l.materiales_detectados.join(', ');
    } else {
      modalIAMateriales.textContent = '—';
    }

    // Ubicación y visita técnica
    modalUbicacionObra.textContent = l.ubicacion_obra || '—';
    modalRequiereVisita.textContent = l.requiere_visita ? 'Sí' : 'No';

    if (l.requiere_visita) {
      modalVisitaDetalles.style.display = 'block';
      modalUbicacionVisita.textContent = l.ubicacion_visita || '—';

      // Determinar texto de fecha de visita
      // Si coordina_visita es true y no hay fecha específica, mostrar "A coordinar"
      if (l.coordina_visita && !l.fecha_visita_especifica) {
        modalFechaVisita.textContent = 'A coordinar por teléfono';
      } else if (l.fecha_visita_especifica) {
        modalFechaVisita.textContent = l.fecha_visita_especifica;
      } else {
        modalFechaVisita.textContent = '—';
      }
    } else {
      modalVisitaDetalles.style.display = 'none';
    }

    // Contacto para visita
    const tieneContacto = l.contacto_visita_nombre || l.contacto_visita_telefono || l.contacto_visita_correo;
    if (tieneContacto) {
      modalContactoSection.style.display = 'block';
      modalContactoNombre.textContent = l.contacto_visita_nombre || '—';
      modalContactoTelefono.textContent = l.contacto_visita_telefono || '—';
      modalContactoCorreo.textContent = l.contacto_visita_correo || '—';
    } else {
      modalContactoSection.style.display = 'none';
    }

    // Formularios requeridos
    modalFormulariosList.innerHTML = '';
    if (l.formularios_requeridos && l.formularios_requeridos.length > 0) {
      modalFormulariosSection.style.display = 'block';
      l.formularios_requeridos.forEach((f) => {
        const li = document.createElement('li');
        const obligatorio = f.obligatorio ? '(Obligatorio)' : '(Opcional)';
        const seccion = f.seccion ? ` - ${f.seccion}` : '';
        li.textContent = `${f.nombre} ${obligatorio}${seccion}`;
        modalFormulariosList.appendChild(li);
      });
    } else {
      modalFormulariosSection.style.display = 'none';
    }

    // Adjuntos
    modalAdjuntosList.innerHTML = '';
    data.adjuntos.forEach((a) => {
      const li = document.createElement('li');
      li.innerHTML = `<a href="${a.archivo_url}" target="_blank">${escapeHtml(
        a.nombre || a.archivo_url
      )}</a>`;
      modalAdjuntosList.appendChild(li);
    });
    if (data.adjuntos.length === 0) {
      modalAdjuntosList.innerHTML =
        '<li class="text-muted">Sin archivos adjuntos registrados.</li>';
    }

    // Aclaraciones
    modalAclaracionesList.innerHTML = '';
    data.aclaraciones.forEach((ac) => {
      const li = document.createElement('li');
      const fecha = ac.fecha || '';
      const hora = ac.hora ? ac.hora.substring(0, 5) : '';
      const cabecera = `${fecha} ${hora}`.trim();
      li.innerHTML = `
        <div><strong>${cabecera}</strong></div>
        <div>${escapeHtml(ac.texto || '')}</div>
        ${
          ac.archivo_url
            ? `<div><a href="${ac.archivo_url}" target="_blank">Ver archivo</a></div>`
            : ''
        }
      `;
      modalAclaracionesList.appendChild(li);
    });
    if (data.aclaraciones.length === 0) {
      modalAclaracionesList.innerHTML =
        '<li class="text-muted">Sin aclaraciones registradas.</li>';
    }

    // Feedback humano
    fbLlamadoId.value = llamadoId;
    fbEsRelevante.checked = l.es_relevante_real === true;
    fbEstadoSeguimiento.value = l.estado_seguimiento || 'pendiente';
    fbComentario.value = l.comentario || '';

    modalOverlay.classList.remove('hidden');
  } catch (err) {
    console.error(err);
    alert('Error al abrir el llamado');
  }
}

function closeModal() {
  modalOverlay.classList.add('hidden');
}

modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

feedbackForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  fbStatus.textContent = 'Guardando...';
  fbStatus.className = 'fb-status';

  const payload = {
    llamado_id: fbLlamadoId.value,
    es_relevante_real: fbEsRelevante.checked,
    estado_seguimiento: fbEstadoSeguimiento.value,
    comentario: fbComentario.value || null,
    ia_es_relevante: null,
    ia_confianza: null,
    ia_razon: null,
  };

  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error('Error en guardar feedback');

    const saved = await res.json();
    fbStatus.textContent = 'Feedback guardado';
    fbStatus.classList.add('ok');

    const idx = llamados.findIndex((l) => l.llamado_id === saved.llamado_id);
    if (idx !== -1) {
      llamados[idx].es_relevante_real = saved.es_relevante_real;
      llamados[idx].estado_seguimiento = saved.estado_seguimiento;
      llamados[idx].comentario = saved.comentario;
      applyFilters();
      updateSummary();
    }
  } catch (err) {
    console.error(err);
    fbStatus.textContent = 'Error al guardar';
    fbStatus.classList.add('error');
  }
});

filterEstado.addEventListener('change', applyFilters);
filterRelevancia.addEventListener('change', applyFilters);
sortBy.addEventListener('change', applyFilters);
searchInput.addEventListener('input', () => {
  applyFilters();
});

// View toggle handlers
viewGridBtn.addEventListener('click', () => {
  cardsContainer.classList.remove('list-view');
  viewGridBtn.classList.add('active');
  viewListBtn.classList.remove('active');
});

viewListBtn.addEventListener('click', () => {
  cardsContainer.classList.add('list-view');
  viewListBtn.classList.add('active');
  viewGridBtn.classList.remove('active');
});

fetchLlamados().catch((err) => {
  console.error(err);
  cardsContainer.innerHTML =
    '<p style="font-size:13px;color:#fca5a5;text-align:center;padding:48px;">Error al cargar los datos del servidor.</p>';
});
