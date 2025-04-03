/**
 * Funciones para la gestión de colaboradores - Vista SST
 */

// Función para formatear fechas en formato español
function formatearFecha(fecha) {
  if (!fecha) return 'No definido';
  const fechaObj = new Date(fecha);
  return fechaObj.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

// Función para ver colaboradores
async function verColaboradores(solicitudId) {
  try {
    // Limpiar datos anteriores
    $('#tablaColaboradores').empty();
    $('#tablaVehiculos').empty();

    // Restablecer filtros
    $('#filtroTipo').val('colaboradores');
    $('#filtroEstado').val('todos');
    
    // Obtener datos del backend
    const response = await fetch(`/api/sst/colaboradores/${solicitudId}`);
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    const data = await response.json();
    console.log('Datos recibidos para solicitud', solicitudId, data);

    // Actualizar información del modal
    $('#colaboradoresId').text(data.id);
    $('#colaboradoresEmpresa').text(data.empresa);
    $('#colaboradoresContratista').text(data.contratista);

    // Mostrar el modal
    $('#colaboradoresModal').modal('show');

    // Configurar visibilidad de los contenedores
    $('#tablaColaboradoresContainer').show();
    $('#tablaVehiculosContainer').hide();
    $('#filtroEstadoContainer').show();
    
    // Cargar datos iniciales
    mostrarColaboradores(solicitudId);
  } catch (error) {
    console.error('Error al cargar colaboradores y vehículos:', error);
    Swal.fire({ 
      icon: 'error', 
      title: 'Error', 
      text: 'No se pudieron cargar los datos: ' + error.message
    });
  }
}

// Función para mostrar colaboradores
function mostrarColaboradores(solicitudId) {
  if (!solicitudId) {
    console.warn('No se proporcionó ID de solicitud para mostrar colaboradores');
    return;
  }

  const tbody = $('#tablaColaboradores');
  tbody.empty();
  tbody.append('<tr><td colspan="8" class="text-center"><i class="fas fa-spinner fa-spin"></i> Cargando colaboradores...</td></tr>');

  const estadoFiltro = $('#filtroEstado').val();
  console.log('Filtrando colaboradores por estado:', estadoFiltro);

  // Construir URL con parámetros de filtro
  let url = `/api/sst/colaboradores/${solicitudId}`;
  if (estadoFiltro !== 'todos') {
    const estadoBoolean = estadoFiltro === 'habilitados';
    url += `?estado=${estadoBoolean}`;
  }

  fetch(url)
    .then(response => {
      if (!response.ok) {
        throw new Error(`Error HTTP: ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      tbody.empty();
      if (data && data.colaboradores && data.colaboradores.length > 0) {
        data.colaboradores.forEach(col => {
          // Determinar clases y valores para plantilla SS
          const plantillaSS = col.plantillaSS 
            ? `${formatearFecha(col.plantillaSS.fecha_inicio)} - ${formatearFecha(col.plantillaSS.fecha_fin)}` 
            : 'No definida';

          // Determinar si la plantilla está vigente
          let plantillaClase = 'no-definido';
          if (col.plantillaSS) {
            const fechaFin = new Date(col.plantillaSS.fecha_fin);
            plantillaClase = fechaFin > new Date() ? 'vigente' : 'vencido';
          }
          
          // Determinar clase para curso SISO
          let cursoSisoClase = '';
          if (col.cursoSiso === 'Vencido') {
            cursoSisoClase = 'vencido';
          } else if (col.cursoSiso === 'Aprobado') {
            cursoSisoClase = 'vigente';
          } else {
            cursoSisoClase = 'no-definido';
          }
          
          // Determinar clase para la fila según estado del colaborador
          const filaClase = col.estado ? 'colaborador-habilitado' : 'colaborador-inhabilitado';
          
          const row = `
            <tr data-estado="${col.estado ? 'habilitado' : 'inhabilitado'}" class="${filaClase}">
              <td>${col.id}</td>
              <td>${col.nombre}</td>
              <td>${col.cedula}</td>
              <td>${col.estado ? 'Habilitado' : 'Inhabilitado'}</td>
              <td class="${cursoSisoClase}">${col.cursoSiso}</td>
              <td class="${plantillaClase}">${plantillaSS}</td>
              <td>
                <button class="btn btn-sm btn-primary" 
                        onclick="definirPlantilla(${col.id}, ${solicitudId}, '${plantillaSS === 'No definida' ? '' : col.plantillaSS.id}')">
                  Definir
                </button>
              </td>
              <td>
                <button class="btn btn-sm btn-info" 
                        onclick="verHistorial(${col.id})">
                  Ver
                </button>
              </td>
            </tr>
          `;
          tbody.append(row);
        });
      } else {
        tbody.append('<tr><td colspan="8">No hay colaboradores que coincidan con el filtro</td></tr>');
      }
    })
    .catch(error => {
      console.error('Error al cargar colaboradores:', error);
      tbody.empty();
      tbody.append('<tr><td colspan="8" class="text-danger">Error al cargar los colaboradores: ' + error.message + '</td></tr>');
    });
}

// Definir Plantilla SS
async function definirPlantilla(colaboradorId, solicitudId, plantillaId) {
  try {
    // Limpiar formulario
    $('#colaboradorId').val(colaboradorId);
    $('#ssolicitudId').val(solicitudId);
    $('#plantillaId').val(plantillaId || '');
    
    // Limpiar fechas por defecto
    $('#fechaInicioSS').val('');
    $('#fechaFinSS').val('');
    
    // Actualizar título del modal
    $('#plantillaSSModalLabel').text(`Definir Plantilla de Seguridad Social`);
    
    // Mostrar indicador de carga si se está editando una plantilla existente
    if (plantillaId) {
      Swal.fire({
        title: 'Cargando...',
        allowOutsideClick: false,
        didOpen: () => {
          Swal.showLoading();
        }
      });
      
      // Obtener datos existentes
      const response = await fetch(`/api/sst/plantilla-ss/${colaboradorId}`);
      
      // Cerrar indicador de carga
      Swal.close();
      
      if (!response.ok) {
        throw new Error(`Error HTTP: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.plantilla) {
        // Establecer fechas en el formulario
        $('#fechaInicioSS').val(data.plantilla.fecha_inicio);
        $('#fechaFinSS').val(data.plantilla.fecha_fin);
      }
    }
    
    // Mostrar el modal
    $('#plantillaSSModal').modal('show');
  } catch (error) {
    console.error('Error al cargar datos de plantilla:', error);
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: 'No se pudieron cargar los datos de la plantilla: ' + error.message
    });
  }
}

// Ver Historial de Cursos
async function verHistorial(colaboradorId) {
  try {
    const response = await fetch(`/api/sst/historial-cursos/${colaboradorId}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Error al obtener historial');

    const tbody = $('#tablaHistorial');
    tbody.empty();
    data.historial.forEach(h => {
      tbody.append(`
        <tr>
          <td>${h.nombre}</td>
          <td>${h.estado}</td>
          <td>${h.puntaje_obtenido}</td>
          <td>${new Date(h.fecha_vencimiento).toLocaleDateString()}</td>
        </tr>
      `);
    });

    $('#historialModal').modal('show');
  } catch (error) {
    Swal.fire({ 
      icon: 'error', 
      title: 'Error', 
      text: error.message || 'No se pudo cargar el historial.' 
    });
  }
}

// Inicialización cuando el DOM está listo
$(document).ready(function() {
  // Manejador del formulario de plantilla SS
  $('#plantillaSSForm').on('submit', async function(e) {
    e.preventDefault();
    
    // Obtener valores del formulario
    const colaboradorId = $('#colaboradorId').val();
    const solicitudId = $('#ssolicitudId').val();
    const fechaInicio = $('#fechaInicioSS').val();
    const fechaFin = $('#fechaFinSS').val();
    
    // Validar fechas
    if (new Date(fechaFin) <= new Date(fechaInicio)) {
      $('#validacionFechasSS').show();
      return;
    }
    
    // Ocultar mensaje de validación
    $('#validacionFechasSS').hide();
    
    try {
      // Mostrar indicador de carga
      Swal.fire({
        title: 'Guardando...',
        allowOutsideClick: false,
        didOpen: () => {
          Swal.showLoading();
        }
      });
      
      // Enviar datos al servidor
      const response = await fetch('/api/sst/plantilla-ss', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          colaboradorId,
          solicitudId,
          fechaInicio,
          fechaFin
        })
      });
      
      // Cerrar indicador de carga
      Swal.close();
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Error al guardar la plantilla');
      }
      
      const data = await response.json();
      
      // Mostrar mensaje de éxito
      Swal.fire({
        icon: 'success',
        title: 'Éxito',
        text: data.message,
        timer: 1500
      });
      
      // Cerrar modal y actualizar datos
      $('#plantillaSSModal').modal('hide');
      mostrarColaboradores(solicitudId);
    } catch (error) {
      console.error('Error al guardar plantilla:', error);
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: error.message || 'Error al guardar la plantilla'
      });
    }
  });

  // Validar fechas al cambiar
  $('#fechaInicioSS, #fechaFinSS').on('change', function() {
    const fechaInicio = $('#fechaInicioSS').val();
    const fechaFin = $('#fechaFinSS').val();
    
    if (fechaInicio && fechaFin) {
      if (new Date(fechaFin) <= new Date(fechaInicio)) {
        $('#validacionFechasSS').show();
      } else {
        $('#validacionFechasSS').hide();
      }
    }
  });
});

// Exportar funciones para que estén disponibles globalmente
window.formatearFecha = formatearFecha;
window.verColaboradores = verColaboradores;
window.mostrarColaboradores = mostrarColaboradores;
window.definirPlantilla = definirPlantilla;
window.verHistorial = verHistorial; 