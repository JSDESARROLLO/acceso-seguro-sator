/**
 * Funciones para la gestión de colaboradores - Vista SST
 */

// Función para formatear fechas en formato español
function formatearFecha(fecha) {
  if (!fecha) return 'No definido';
  const fechaObj = new Date(fecha);
  // Ajustar por la zona horaria
  fechaObj.setMinutes(fechaObj.getMinutes() + fechaObj.getTimezoneOffset());
  return fechaObj.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

// Función para ver colaboradores
function verColaboradores(solicitudId) {
  if (!solicitudId) {
    console.warn('No se proporcionó ID de solicitud');
    return;
  }

  // Mostrar el modal inmediatamente
  $('#colaboradoresModal').modal('show');

  // Limpiar y mostrar skeleton loader en la tabla
  const tbody = $('#tablaColaboradores');
  tbody.empty();
  
  // Agregar skeleton loader
  const skeletonRows = Array(5).fill().map(() => `
    <tr>
      <td><div class="skeleton-loader" style="width: 30px; height: 20px;"></div></td>
      <td><div class="skeleton-loader" style="width: 150px; height: 20px;"></div></td>
      <td><div class="skeleton-loader" style="width: 80px; height: 20px;"></div></td>
      <td><div class="skeleton-loader" style="width: 60px; height: 20px;"></div></td>
      <td><div class="skeleton-loader" style="width: 100px; height: 20px;"></div></td>
      <td><div class="skeleton-loader" style="width: 100px; height: 20px;"></div></td>
      <td><div class="skeleton-loader" style="width: 120px; height: 20px;"></div></td>
      <td><div class="skeleton-loader" style="width: 80px; height: 20px;"></div></td>
    </tr>
  `).join('');
  
  tbody.html(skeletonRows);

  // Obtener datos de la solicitud
  const solicitudRow = $(`tr[data-id="${solicitudId}"]`);
  const empresa = solicitudRow.find('td:eq(1)').text();
  const contratista = solicitudRow.find('td:eq(8)').text();

  // Actualizar información en el modal
  $('#colaboradoresId').text(solicitudId);
  $('#colaboradoresEmpresa').text(empresa);
  $('#colaboradoresContratista').text(contratista);

  // Cargar datos reales
  fetch(`/api/sst/colaboradores/${solicitudId}`)
    .then(response => {
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
      return response.json();
    })
    .then(data => {
      tbody.empty();
      if (data && data.colaboradores && data.colaboradores.length > 0) {
        data.colaboradores.forEach(colaborador => {
          // Determinar clases y estados para curso SISO
          let cursoSisoClase = '';
          let cursoSisoTexto = 'No definido';
          if (colaborador.cursoSiso === 'Vencido') {
            cursoSisoClase = 'vencido';
            cursoSisoTexto = 'Vencido';
          } else if (colaborador.cursoSiso === 'Aprobado') {
            cursoSisoClase = 'vigente';
            cursoSisoTexto = 'Aprobado';
          } else {
            cursoSisoClase = 'no-definido';
          }

          // Determinar clases y estados para plantilla SS
          let plantillaSSClase = 'no-definido';
          let plantillaSSTexto = 'No definida';
          if (colaborador.plantillaSS) {
            const fechaFin = new Date(colaborador.plantillaSS.fecha_fin);
            plantillaSSClase = fechaFin > new Date() ? 'vigente' : 'vencido';
            plantillaSSTexto = `${formatearFecha(colaborador.plantillaSS.fecha_inicio)} - ${formatearFecha(colaborador.plantillaSS.fecha_fin)}`;
          }
          
          const row = `
            <tr class="${colaborador.estado ? 'colaborador-habilitado' : 'colaborador-inhabilitado'}">
              <td>${colaborador.id}</td>
              <td>${colaborador.nombre}</td>
              <td>${colaborador.cedula}</td>
              <td>${colaborador.estado ? 'Habilitado' : 'Deshabilitado'}</td>
              <td><span class="${cursoSisoClase}">${cursoSisoTexto}</span></td>
              <td><span class="${plantillaSSClase}">${plantillaSSTexto}</span></td>
              <td>
                <button class="btn btn-sm btn-primary" 
                        onclick="definirPlantillaSS(${colaborador.id}, ${solicitudId}, '${colaborador.plantillaSS ? colaborador.plantillaSS.id : ''}')">
                  Definir
                </button>
              </td>
              <td>
                <button class="btn btn-sm btn-info" onclick="verHistorial(${colaborador.id})">
                  Ver Historial
                </button>
              </td>
            </tr>
          `;
          tbody.append(row);
        });
      } else {
        tbody.html('<tr><td colspan="8" class="text-center">No hay colaboradores asociados a esta solicitud</td></tr>');
      }
    })
    .catch(error => {
      console.error('Error al cargar colaboradores:', error);
      tbody.html('<tr><td colspan="8" class="text-danger text-center">Error al cargar los colaboradores: ' + error.message + '</td></tr>');
    });
}

// Función para mostrar colaboradores
function mostrarColaboradores(solicitudId) {
  if (!solicitudId) {
    console.warn('No se proporcionó ID de solicitud para mostrar colaboradores');
    return;
  }

  const tbody = $('#tablaColaboradores');
  tbody.empty();
  
  // Agregar skeleton loader
  const skeletonRows = Array(5).fill().map(() => `
    <tr>
      <td><div class="skeleton-loader" style="width: 30px; height: 20px;"></div></td>
      <td><div class="skeleton-loader" style="width: 150px; height: 20px;"></div></td>
      <td><div class="skeleton-loader" style="width: 80px; height: 20px;"></div></td>
      <td><div class="skeleton-loader" style="width: 60px; height: 20px;"></div></td>
      <td><div class="skeleton-loader" style="width: 100px; height: 20px;"></div></td>
      <td><div class="skeleton-loader" style="width: 100px; height: 20px;"></div></td>
      <td><div class="skeleton-loader" style="width: 120px; height: 20px;"></div></td>
      <td><div class="skeleton-loader" style="width: 80px; height: 20px;"></div></td>
    </tr>
  `).join('');
  
  tbody.html(skeletonRows);

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
                        onclick="definirPlantillaSS(${col.id}, ${solicitudId}, '${col.plantillaSS ? col.plantillaSS.id : ''}')">
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
async function definirPlantillaSS(colaboradorId, solicitudId, documentoId = '') {
  try {
    console.log('🔍 Abriendo modal de vigencia:', { colaboradorId, solicitudId, documentoId });
    
    // Limpiar formulario y ocultar mensajes de validación
    $('#plantillaSSForm').trigger('reset');
    $('#validacionFechasSS').hide();
    
    // Establecer valores en campos ocultos
    $('#colaboradorId').val(colaboradorId);
    $('#ssolicitudId').val(solicitudId);
    $('#documentoId').val(documentoId);
    
    // Actualizar título del modal
    $('#plantillaSSModalLabel').text('Definir Vigencia de Plantilla SS');
    
    // Si hay documentoId, cargar los datos existentes
    if (documentoId) {
      try {
        console.log('✅ Intentando cargar datos para documentoId:', documentoId);
        const response = await fetch(`/api/sst/plantilla-ss/${documentoId}`);
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.message || 'Error al cargar datos de la plantilla');
        }
        
        console.log('📦 Datos recibidos de la API:', data);
        
        if (data.success && data.plantilla) {
          // Convertir fechas al formato local
          const fechaInicio = new Date(data.plantilla.fecha_inicio);
          const fechaFin = new Date(data.plantilla.fecha_fin);
          
          // Ajustar por la zona horaria
          fechaInicio.setMinutes(fechaInicio.getMinutes() + fechaInicio.getTimezoneOffset());
          fechaFin.setMinutes(fechaFin.getMinutes() + fechaFin.getTimezoneOffset());
          
          const fechaInicioStr = fechaInicio.toISOString().split('T')[0];
          const fechaFinStr = fechaFin.toISOString().split('T')[0];
          
          console.log('📅 Fechas formateadas:', { fechaInicioStr, fechaFinStr });
          
          $('#fechaInicioSS').val(fechaInicioStr);
          $('#fechaFinSS').val(fechaFinStr);
        } else {
          console.log('❌ No se encontraron datos de plantilla');
          $('#fechaInicioSS').val('');
          $('#fechaFinSS').val('');
        }
      } catch (error) {
        console.error('❌ Error al cargar datos de la plantilla:', error);
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: error.message
        });
      }
    } else {
      // Limpiar fechas si no hay documentoId
      $('#fechaInicioSS').val('');
      $('#fechaFinSS').val('');
    }
    
    // Mostrar el modal
    $('#plantillaSSModal').modal('show');
  } catch (error) {
    console.error('❌ Error al abrir el modal:', error);
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: 'No se pudo abrir el modal: ' + error.message
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
  // Escuchar cambios en el filtro de estado de colaboradores
  $('#filtroEstado').on('change', function() {
    const solicitudId = $('#colaboradoresId').text();
    if (solicitudId) {
      mostrarColaboradores(solicitudId);
    }
  });
  
  // Escuchar cambios en el filtro de tipo (colaboradores/vehículos)
  $('#filtroTipo').on('change', function() {
    const tipo = $(this).val();
    const solicitudId = $('#colaboradoresId').text();
    
    if (tipo === 'colaboradores') {
      $('#tablaColaboradoresContainer').show();
      $('#tablaVehiculosContainer').hide();
      $('#filtroEstadoContainer').show();
      mostrarColaboradores(solicitudId);
    } else {
      $('#tablaColaboradoresContainer').hide();
      $('#tablaVehiculosContainer').show();
      $('#filtroEstadoContainer').hide();
      mostrarVehiculos(solicitudId);
    }
  });

  // Manejar cierre de modales sin actualizar
  $('#plantillaSSModal').on('hidden.bs.modal', function (e) {
    // Solo limpiar el formulario
    $(this).find('form').trigger('reset');
    $('#validacionFechasSS').hide();
  });

  // Manejar botones de cancelar
  $('.btn-secondary[data-dismiss="modal"]').on('click', function(e) {
    e.preventDefault();
    $(this).closest('.modal').modal('hide');
  });

  // Manejar el envío del formulario de plantilla SS
  $('#plantillaSSForm').on('submit', async function(e) {
    e.preventDefault();
    
    const colaboradorId = $('#colaboradorId').val();
    const solicitudId = $('#ssolicitudId').val();
    const documentoId = $('#documentoId').val();
    const fechaInicio = $('#fechaInicioSS').val();
    const fechaFin = $('#fechaFinSS').val();
    
    if (!fechaInicio || !fechaFin) {
      $('#validacionFechasSS').text('Por favor, ingrese ambas fechas').show();
      return;
    }
    
    if (new Date(fechaFin) <= new Date(fechaInicio)) {
      $('#validacionFechasSS').text('La fecha de fin debe ser posterior a la fecha de inicio').show();
      return;
    }
    
    try {
      console.log('Enviando datos:', { colaboradorId, solicitudId, documentoId, fechaInicio, fechaFin });
      
      const response = await fetch('/api/sst/plantilla-ss', {
        method: documentoId ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          colaboradorId,
          solicitudId,
          documentoId,
          fechaInicio,
          fechaFin
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Error al guardar la plantilla');
      }
      
      const data = await response.json();
      console.log('Respuesta del servidor:', data);
      
      $('#plantillaSSModal').modal('hide');
      
      await Swal.fire({
        icon: 'success',
        title: 'Éxito',
        text: data.message,
        timer: 1500
      });
      
      // Actualizar la tabla después de guardar
      mostrarColaboradores(solicitudId);
      
    } catch (error) {
      console.error('Error al guardar plantilla:', error);
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: error.message
      });
    }
  });
});

// Exportar funciones para que estén disponibles globalmente
window.formatearFecha = formatearFecha;
window.verColaboradores = verColaboradores;
window.mostrarColaboradores = mostrarColaboradores;
window.verHistorial = verHistorial; 
window.definirPlantillaSS = definirPlantillaSS; 