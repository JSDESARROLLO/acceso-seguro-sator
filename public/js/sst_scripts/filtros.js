/**
 * Funciones para filtrado de solicitudes - Vista SST
 */

// Función para filtrar solicitudes
async function filtrarSolicitudes(event) {
  if (event) event.preventDefault();

  try {
    // Obtener valores de los filtros
    const filtros = {
      id: $('#idSolicitud').val(),
      empresa: $('#empresa').val(),
      nit: $('#nit').val(),
      estado: $('#estado').val(),
      fechaInicio: $('#fechaInicio').val(),
      fechaFin: $('#fechaFin').val(),
      lugar: $('#lugar').val(),
      cedula: $('#cedula').val(),
      placa: $('#placa').val(),
      interventor: $('#interventor').val(),
      vigencia: $('#vigencia').val(),
      colaboradorId: $('#colaboradorId').val(),
      vehiculoId: $('#vehiculoId').val()
    };
    
    // Mostrar indicador de carga
    Swal.fire({
      title: 'Filtrando...',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    console.log('Filtrando con los siguientes criterios:', filtros);
    
    // Realizar petición al servidor
    const response = await fetch('/api/filtrar-solicitudes-sst', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(filtros)
    });
    
    Swal.close();

    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }

    const solicitudes = await response.json();

    // Actualizar la tabla con los resultados
    actualizarTablaSolicitudes(solicitudes);
  } catch (error) {
    console.error('[SST] Error al filtrar solicitudes:', error);
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: error.message || 'No se pudieron filtrar las solicitudes.'
    });
  }
}

// Función para actualizar la tabla con los datos filtrados
function actualizarTablaSolicitudes(solicitudes) {
  const tbody = $('#tablaSolicitudes');
  tbody.empty();

  if (solicitudes.length === 0) {
    Swal.fire({
      icon: 'info',
      title: 'Sin resultados',
      text: 'No se encontraron solicitudes con los criterios especificados'
    });
    return;
  }

  solicitudes.forEach(solicitud => {
    const estadoClass = solicitud.solicitud_estado === 'negada' ? 'badge-danger' : 'badge-success';
    const estadoTexto = solicitud.solicitud_estado === 'negada' ? 'Negada' : 'Aprobado';

    const row = `
      <tr class="solicitud-item" data-id="${solicitud.solicitud_id}">
        <td>${solicitud.solicitud_id}</td>
        <td>${solicitud.empresa}</td>
        <td>${solicitud.nit}</td>
        <td>${solicitud.inicio_obra}</td>
        <td>${solicitud.fin_obra}</td>
        <td>${solicitud.dias_trabajo || '-'}</td>
        <td>${solicitud.lugar}</td>
        <td>${solicitud.labor || '-'}</td>
        <td>${solicitud.interventor}</td>
        <td>
          ${solicitud.url_documento ? 
            `<button class="btn btn-success btn-sm descargar-btn" data-url="${solicitud.url_documento}">Descargar Documentos</button>` : 
            `<button class="btn btn-info btn-sm generar-btn" data-id="${solicitud.solicitud_id}">Generar Documentos</button>`}
        </td>
        <td>
          <button class="btn btn-info btn-sm" onclick="verColaboradores('${solicitud.solicitud_id}')">Ver Colaboradores</button>
        </td>
        <td>
          ${solicitud.solicitud_estado === 'pendiente' ? `
            <form action="/aprobar-solicitud/${solicitud.solicitud_id}" method="POST" style="display:inline;">
              <button type="submit" class="btn btn-success btn-sm" id="aprobarBtn-${solicitud.solicitud_id}">Aprobar</button>
            </form>
            <button class="btn btn-danger btn-sm" data-toggle="modal" data-target="#modalNegar" 
                    data-id="${solicitud.solicitud_id}" data-empresa="${solicitud.empresa}" data-nit="${solicitud.nit}">
              Negar
            </button>
          ` : `<span class="badge ${estadoClass}">${estadoTexto}</span>`}
        </td>
        <td>
          <button class="btn btn-primary btn-sm ml-2 open-chat-btn" data-solicitud-id="${solicitud.solicitud_id}">
            Conversar <span class="badge badge-light unread-count" data-solicitud-id="${solicitud.solicitud_id}">0</span>
          </button>
        </td>
      </tr>
    `;
    tbody.append(row);
  });

  // Reasignar eventos a los botones dinámicos
  $('.descargar-btn').off('click').on('click', function() {
    const url = $(this).data('url');
    descargarArchivo(url);
  });

  $('.generar-btn').off('click').on('click', function() {
    const id = $(this).data('id');
    generarDocumento(id);
  });

  // Reasignar eventos de chat
  $('.open-chat-btn').off('click').on('click', function() {
    const solicitudId = $(this).data('solicitud-id');
    openChatModalSST(solicitudId);
  });

  // Reinicializar los badges de notificación
  updateSSTNotificationBadges();
}

// Inicialización cuando el DOM está listo
$(document).ready(function() {
  // Asignar el manejador de eventos al formulario de filtro
  $('#filterForm, #formFiltro').on('submit', filtrarSolicitudes);

  // Manejar el botón de limpiar filtros
  $('#limpiarFiltros').on('click', function() {
    // Limpiar todos los campos del formulario
    $('#formFiltro input, #formFiltro select').val('');
    
    // Opcionalmente, recargar todas las solicitudes
    filtrarSolicitudes();
  });

  // Corregir el error del toggle de filtros
  const toggleButton = document.getElementById('toggleFilters');
  if (toggleButton) {
    const toggleText = document.getElementById('toggleText');
    const filtrosContent = document.getElementById('filtrosCollapse');
    let filtrosVisible = true;

    toggleButton.addEventListener('click', function() {
      filtrosVisible = !filtrosVisible;
      
      if (filtrosVisible) {
        filtrosContent.style.display = 'block';
        if (toggleText) toggleText.textContent = 'Ocultar filtros';
      } else {
        filtrosContent.style.display = 'none';
        if (toggleText) toggleText.textContent = 'Mostrar filtros';
      }
    });
  }
});

// Exportar funciones para que estén disponibles globalmente
window.filtrarSolicitudes = filtrarSolicitudes;
window.actualizarTablaSolicitudes = actualizarTablaSolicitudes; 