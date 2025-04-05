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
  // Limpiar todos los datos antes de mostrar el modal
  $('#tablaColaboradores').empty();
  $('#tablaVehiculos').empty();
  $('#colaboradoresId').text('');
  $('#colaboradoresEmpresa').text('');
  $('#colaboradoresContratista').text('');
  
  // Resetear filtros
  $('#filtroTipo').val('colaboradores');
  $('#filtroEstado').val('todos');
  
  // Mostrar contenedor de colaboradores por defecto
  $('#tablaColaboradoresContainer').show();
  $('#tablaVehiculosContainer').hide();
  $('#filtroEstadoContainer').show();

  // Agregar skeleton loader
  const skeletonRows = Array(3).fill().map(() => `
      <tr>
          <td><div class="skeleton-loader" style="width: 30px; height: 20px;"></div></td>
          <td><div class="skeleton-loader" style="width: 150px; height: 20px;"></div></td>
          <td><div class="skeleton-loader" style="width: 100px; height: 20px;"></div></td>
          <td><div class="skeleton-loader" style="width: 80px; height: 20px;"></div></td>
          <td><div class="skeleton-loader" style="width: 80px; height: 20px;"></div></td>
          <td><div class="skeleton-loader" style="width: 80px; height: 20px;"></div></td>
          <td><div class="skeleton-loader" style="width: 120px; height: 20px;"></div></td>
          <td><div class="skeleton-loader" style="width: 80px; height: 20px;"></div></td>
      </tr>
  `).join('');
  $('#tablaColaboradores').html(skeletonRows);

  // Mostrar el modal personalizado
  abrirModalColaboradores();

  // Obtener datos de la solicitud
  fetch(`/api/sst/solicitudes/${solicitudId}`)
      .then(response => response.json())
      .then(data => {
          $('#colaboradoresId').text(data.id);
          $('#colaboradoresEmpresa').text(data.empresa);
          $('#colaboradoresContratista').text(data.contratista);

          // Cargar colaboradores
          return fetch(`/api/sst/colaboradores/${solicitudId}`);
      })
      .then(response => response.json())
      .then(data => {
          $('#tablaColaboradores').empty();
          
          // Asegurarse de que colaboradores sea un array
          const colaboradores = Array.isArray(data) ? data : 
                              (data.colaboradores ? data.colaboradores : 
                              (data.data ? data.data : []));
          
          if (colaboradores.length === 0) {
              $('#tablaColaboradores').append('<tr><td colspan="8" class="text-center">No hay colaboradores registrados</td></tr>');
              return;
          }

          colaboradores.forEach(col => {
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
                  <td class="${cursoSisoClase}">${col.cursoSiso || 'No definido'}</td>
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
              $('#tablaColaboradores').append(row);
          });
      })
      .catch(error => {
          console.error('Error al cargar datos:', error);
          $('#tablaColaboradores').html('<tr><td colspan="8" class="text-center">Error al cargar los datos</td></tr>');
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
    
    // Limpiar ambas tablas antes de cambiar
    $('#tablaColaboradores').empty();
    $('#tablaVehiculos').empty();
    
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

  // Manejar cierre del modal
  $('#colaboradoresModal').on('hidden.bs.modal', function () {
    // Limpiar todas las tablas y contenedores
    $('#tablaColaboradores').empty();
    $('#tablaVehiculos').empty();
    $('#colaboradoresId').text('');
    $('#colaboradoresEmpresa').text('');
    $('#colaboradoresContratista').text('');
    
    // Resetear el filtro de tipo
    $('#filtroTipo').val('colaboradores');
    
    // Resetear el filtro de estado
    $('#filtroEstado').val('todos');
    
    // Mostrar contenedor de colaboradores por defecto
    $('#tablaColaboradoresContainer').show();
    $('#tablaVehiculosContainer').hide();
    $('#filtroEstadoContainer').show();
  });
});

// Exportar funciones para que estén disponibles globalmente
window.formatearFecha = formatearFecha;
window.verColaboradores = verColaboradores;
window.mostrarColaboradores = mostrarColaboradores;
window.verHistorial = verHistorial; 
window.definirPlantillaSS = definirPlantillaSS;

// Funciones globales para manejo de estados
window.getEstadoClase = function(estado) {
    return estado === 1 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
};

window.getEstadoTexto = function(estado) {
    return estado === 1 ? 'Habilitado' : 'Deshabilitado';
};

// Función para cargar los colaboradores
async function cargarColaboradores(solicitudId) {
    try {
        const response = await fetch(`/api/sst/colaboradores/${solicitudId}`);
        if (!response.ok) {
            throw new Error('Error al cargar los colaboradores');
        }
        const data = await response.json();
        
        // Asegurarse de que tenemos un array de colaboradores
        const colaboradores = Array.isArray(data) ? data : 
                            (data.colaboradores || data.data || []);
        
        const tbody = document.querySelector('#colaboradoresTable tbody');
        tbody.innerHTML = '';

        if (colaboradores.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center py-4">
                        No hay colaboradores registrados para esta solicitud
                    </td>
                </tr>
            `;
            return;
        }

        colaboradores.forEach(colaborador => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="px-6 py-4 whitespace-nowrap">
                    <div class="flex items-center">
                        <div class="flex-shrink-0 h-10 w-10">
                            <img class="h-10 w-10 rounded-full" src="${colaborador.foto || '/img/default-avatar.png'}" alt="">
                        </div>
                        <div class="ml-4">
                            <div class="text-sm font-medium text-gray-900">${colaborador.nombre}</div>
                            <div class="text-sm text-gray-500">${colaborador.cedula}</div>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${window.getEstadoClase(colaborador.estado)}">
                        ${window.getEstadoTexto(colaborador.estado)}
                    </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <button onclick="definirPlantilla(${colaborador.id})" class="text-indigo-600 hover:text-indigo-900">
                        Definir Plantilla
                    </button>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <button onclick="verHistorial(${colaborador.id})" class="text-indigo-600 hover:text-indigo-900">
                        Ver Historial
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) {
        console.error('Error al cargar datos:', error);
        const tbody = document.querySelector('#colaboradoresTable tbody');
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center py-4 text-red-600">
                    Error al cargar los colaboradores: ${error.message}
                </td>
            </tr>
        `;
    }
} 