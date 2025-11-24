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
const searchInput = document.getElementById('searchInput');

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
  const search = (searchInput.value || '').toLowerCase();

  filteredLlamados = llamados.filter((l) => {
    if (estado) {
      const estHumano = l.estado_seguimiento || 'pendiente';
      if (estHumano !== estado) return false;
    }

    if (relevancia === 'solo_ia_relevante' && !l.es_relevante) return false;
    if (relevancia === 'solo_humano_relevante' && !l.es_relevante_real) return false;

    if (search) {
      const text = `${l.titulo || ''} ${l.descripcion || ''}`.toLowerCase();
      if (!text.includes(search)) return false;
    }

    return true;
  });

  renderCards();
}

function renderCards() {
  cardsContainer.innerHTML = '';

  if (filteredLlamados.length === 0) {
    cardsContainer.innerHTML =
      '<p style="font-size:13px;color:#9ca3af;">No se encontraron llamados con esos filtros.</p>';
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

    card.innerHTML = `
      <h3 class="card-title">${escapeHtml(l.titulo || '')}</h3>
      <div class="card-subtitle">
        Apertura: ${formatFechaHora(l.fecha_apertura, l.hora_apertura)} ·
        Publicado: ${formatFechaHora(l.fecha_publicacion, l.hora_publicacion)}
      </div>
      <div class="card-meta-row">
        <span>Días restantes: ${dias == null ? '—' : dias}</span>
        <span>Urgencia: ${l.urgencia || '—'}</span>
      </div>
      <div class="card-meta-row">
        <span>IA relevancia: ${
          l.es_relevante === true
            ? `${l.confianza ?? 0}%`
            : l.es_relevante === false
            ? 'No relevante'
            : '—'
        }</span>
        <span>Archivos: ${l.total_archivos ?? 0}</span>
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
  let f = fecha;
  if (typeof fecha === 'string') {
    f = fecha;
  }
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

    // IA
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
    // opcional: snapshot de IA (podrías enviarlo desde l.* si lo necesitas)
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
searchInput.addEventListener('input', () => {
  applyFilters();
});

fetchLlamados().catch((err) => {
  console.error(err);
  cardsContainer.innerHTML =
    '<p style="font-size:13px;color:#fca5a5;">Error al cargar los datos del servidor.</p>';
});
