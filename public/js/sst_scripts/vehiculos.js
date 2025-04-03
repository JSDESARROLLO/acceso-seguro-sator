/**
 * Funciones para la gestión de vehículos - Vista SST
 */

// Función para formatear fechas
function formatearFecha(fecha) {
  if (!fecha) return '';
  const d = new Date(fecha);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Función para mostrar vehículos de una solicitud
function mostrarVehiculos(solicitudId) {
  if (!solicitudId) {
    console.warn('No se proporcionó ID de solicitud para mostrar vehículos');
    return;
  }

  const tbody = $('#tablaVehiculos');
  tbody.empty();
  
  // Agregar skeleton loader
  const skeletonRows = Array(3).fill().map(() => `
    <tr>
      <td><div class="skeleton-loader" style="width: 30px; height: 20px;"></div></td>
      <td><div class="skeleton-loader" style="width: 80px; height: 20px;"></div></td>
      <td><div class="skeleton-loader" style="width: 60px; height: 20px;"></div></td>
      <td><div class="skeleton-loader" style="width: 150px; height: 20px;"></div></td>
      <td><div class="skeleton-loader" style="width: 150px; height: 20px;"></div></td>
      <td><div class="skeleton-loader" style="width: 100px; height: 20px;"></div></td>
      <td><div class="skeleton-loader" style="width: 100px; height: 20px;"></div></td>
    </tr>
  `).join('');
  
  tbody.html(skeletonRows);

  fetch(`/api/sst/colaboradores/${solicitudId}`)
    .then(response => {
      if (!response.ok) {
        throw new Error(`Error HTTP: ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      tbody.empty();
      if (data && data.vehiculos && data.vehiculos.length > 0) {
        data.vehiculos.forEach(vehiculo => {
          // Determinar clases y valores para SOAT
          let soatTexto = 'No definido';
          let soatClase = 'no-definido';
          if (vehiculo.soat) {
            soatTexto = `${formatearFecha(vehiculo.soat.fecha_inicio)} - ${formatearFecha(vehiculo.soat.fecha_fin)}`;
            const fechaFin = new Date(vehiculo.soat.fecha_fin);
            soatClase = fechaFin > new Date() ? 'vigente' : 'vencido';
          }
          
          // Determinar clases y valores para Tecnomecánica
          let tecnoTexto = 'No definido';
          let tecnoClase = 'no-definido';
          if (vehiculo.tecnomecanica) {
            tecnoTexto = `${formatearFecha(vehiculo.tecnomecanica.fecha_inicio)} - ${formatearFecha(vehiculo.tecnomecanica.fecha_fin)}`;
            const fechaFin = new Date(vehiculo.tecnomecanica.fecha_fin);
            tecnoClase = fechaFin > new Date() ? 'vigente' : 'vencido';
          }
          
          // Determinar textos para los botones de licencias
          const textoBtnConduccion = vehiculo.licencia_conduccion ? 'Cancelar Aprobación' : 'Aprobar';
          const textoBtnTransito = vehiculo.licencia_transito ? 'Cancelar Aprobación' : 'Aprobar';
          
          // Determinar clases para los botones
          const claseBtnConduccion = vehiculo.licencia_conduccion ? 'btn-danger' : 'btn-success';
          const claseBtnTransito = vehiculo.licencia_transito ? 'btn-danger' : 'btn-success';
          
          // Determinar clase para la fila según estado del vehículo
          const filaClase = vehiculo.estado ? 'colaborador-habilitado' : 'colaborador-inhabilitado';
          
          const row = `
            <tr class="${filaClase}">
              <td>${vehiculo.id}</td>
              <td>${vehiculo.placa}</td>
              <td>${vehiculo.estado ? 'Activo' : 'Inactivo'}</td>
              <td>
                <span class="${soatClase}" id="estado-soat-${vehiculo.id}">${soatTexto}</span>
                <button class="btn btn-sm btn-primary ml-2" 
                        onclick="definirSoat(${vehiculo.id}, ${solicitudId}, '${vehiculo.soat ? vehiculo.soat.id : ''}')">
                  Definir
                </button>
              </td>
              <td>
                <span class="${tecnoClase}" id="estado-tecnomecanica-${vehiculo.id}">${tecnoTexto}</span>
                <button class="btn btn-sm btn-primary ml-2" 
                        onclick="definirTecnomecanica(${vehiculo.id}, ${solicitudId}, '${vehiculo.tecnomecanica ? vehiculo.tecnomecanica.id : ''}')">
                  Definir
                </button>
              </td>
              <td>
                <button class="btn btn-sm ${claseBtnConduccion}" 
                        onclick="alternarEstadoLicencia(${vehiculo.id}, ${solicitudId}, 'conduccion', ${!vehiculo.licencia_conduccion})">
                  ${textoBtnConduccion}
                </button>
              </td>
              <td>
                <button class="btn btn-sm ${claseBtnTransito}" 
                        onclick="alternarEstadoLicencia(${vehiculo.id}, ${solicitudId}, 'transito', ${!vehiculo.licencia_transito})">
                  ${textoBtnTransito}
                </button>
              </td>
            </tr>
          `;
          tbody.append(row);
        });
      } else {
        tbody.append('<tr><td colspan="7" class="text-center">No hay vehículos asociados a esta solicitud</td></tr>');
      }
    })
    .catch(error => {
      console.error('Error al cargar vehículos:', error);
      tbody.empty();
      tbody.append('<tr><td colspan="7" class="text-danger">Error al cargar los vehículos: ' + error.message + '</td></tr>');
    });
}

// Función para alternar estado de licencia
function alternarEstadoLicencia(vehiculoId, solicitudId, tipoLicencia, activar) {
  console.log('Alternando licencia:', { vehiculoId, solicitudId, tipoLicencia, activar });
  
  if (tipoLicencia !== 'conduccion' && tipoLicencia !== 'transito') {
    console.error('Tipo de licencia inválido:', tipoLicencia);
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: 'Tipo de licencia inválido'
    });
    return;
  }
  
  const tipoCompleto = `licencia_${tipoLicencia}`;
  toggleLicencia(vehiculoId, solicitudId, tipoCompleto, activar);
}

// Función para enviar la petición al servidor
async function toggleLicencia(vehiculoId, solicitudId, tipoLicencia, activar) {
  try {
    console.log('Enviando petición:', { vehiculoId, solicitudId, tipoLicencia, activar });
    
    const response = await fetch('/api/sst/toggle-licencia', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        vehiculoId,
        solicitudId,
        tipoLicencia,
        activar
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Error al actualizar la licencia');
    }

    const data = await response.json();
    if (data.success) {
      Swal.fire({
        icon: 'success',
        title: 'Éxito',
        text: data.message,
        timer: 1500
      });
      mostrarVehiculos(solicitudId);
    } else {
      throw new Error(data.message);
    }
  } catch (error) {
    console.error('Error al actualizar licencia:', error);
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: error.message || 'Error al actualizar el estado de la licencia'
    });
  }
}

// Función para mostrar el modal de SOAT
function definirSoat(vehiculoId, solicitudId, documentoId = '') {
  console.log('🔍 Abriendo modal de SOAT:', { vehiculoId, solicitudId, documentoId });

  try {
    // Asignar valores a los campos ocultos
    document.getElementById('vehiculoIdSoat').value = vehiculoId;
    document.getElementById('solicitudIdSoat').value = solicitudId;
    document.getElementById('documentoIdSoat').value = documentoId;

    // Limpiar fechas solo si no hay documentoId
    if (!documentoId) {
      document.getElementById('fechaInicioSoat').value = '';
      document.getElementById('fechaFinSoat').value = '';
    }
    
    // Mostrar el modal
    const modal = $('#definirSoatModal');
    modal.modal('show');
    
    // Agregar manejador para cuando se cierre el modal
    modal.off('hidden.bs.modal').on('hidden.bs.modal', function () {
      mostrarVehiculos(solicitudId);
    });
    
    // Cargar datos del documento siempre
    cargarDatosDocumento(vehiculoId, 'soat');
  } catch (error) {
    console.error('❌ Error al abrir el modal de SOAT:', error);
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: 'Error al abrir el formulario de SOAT: ' + error.message
    });
  }
}

// Función para mostrar el modal de Tecnomecánica
function definirTecnomecanica(vehiculoId, solicitudId, documentoId = '') {
  console.log('🔍 Abriendo modal de Tecnomecánica:', { vehiculoId, solicitudId, documentoId });

  try {
    // Asignar valores a los campos ocultos
    document.getElementById('vehiculoIdTecno').value = vehiculoId;
    document.getElementById('solicitudIdTecno').value = solicitudId;
    document.getElementById('documentoIdTecno').value = documentoId;

    // Limpiar fechas solo si no hay documentoId
    if (!documentoId) {
      document.getElementById('fechaInicioTecno').value = '';
      document.getElementById('fechaFinTecno').value = '';
    }
    
    // Mostrar el modal
    const modal = $('#definirTecnomecanicaModal');
    modal.modal('show');
    
    // Agregar manejador para cuando se cierre el modal
    modal.off('hidden.bs.modal').on('hidden.bs.modal', function () {
      mostrarVehiculos(solicitudId);
    });
    
    // Cargar datos del documento siempre
    cargarDatosDocumento(vehiculoId, 'tecnomecanica');
  } catch (error) {
    console.error('❌ Error al abrir el modal de Tecnomecánica:', error);
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: 'Error al abrir el formulario de Tecnomecánica: ' + error.message
    });
  }
}

// Función para cargar datos de un documento específico
async function cargarDatosDocumento(vehiculoId, tipoDocumento) {
  console.log('🔄 Cargando datos del documento:', { vehiculoId, tipoDocumento });
  
  try {
    const response = await fetch(`/api/sst/vehiculo-documento/${vehiculoId}/${tipoDocumento}`, {
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    const data = await response.json();
    console.log('📄 Datos recibidos del documento:', data);

    if (!data.success) {
      throw new Error(data.message || 'Error al cargar los datos del documento');
    }

    const doc = data.documento;
    
    // Formatear fechas correctamente
    const formatearFecha = (fechaStr) => {
      if (!fechaStr) return '';
      const fecha = new Date(fechaStr);
      return fecha.toISOString().split('T')[0];
    };

    // Asignar valores según el tipo de documento
    if (tipoDocumento === 'soat') {
      if (doc) {
        document.getElementById('vehiculoIdSoat').value = vehiculoId;
        document.getElementById('documentoIdSoat').value = doc.id || '';
        document.getElementById('fechaInicioSoat').value = formatearFecha(doc.fecha_inicio);
        document.getElementById('fechaFinSoat').value = formatearFecha(doc.fecha_fin);
      }
    } else if (tipoDocumento === 'tecnomecanica') {
      if (doc) {
        document.getElementById('vehiculoIdTecno').value = vehiculoId;
        document.getElementById('documentoIdTecno').value = doc.id || '';
        document.getElementById('fechaInicioTecno').value = formatearFecha(doc.fecha_inicio);
        document.getElementById('fechaFinTecno').value = formatearFecha(doc.fecha_fin);
      }
    }
    
    // Actualizar estado visual
    const estadoElement = document.querySelector(`#estado-${tipoDocumento}-${vehiculoId}`);
    if (estadoElement && doc) {
      const fechaFin = new Date(doc.fecha_fin);
      const estado = fechaFin > new Date() ? 'vigente' : 'vencido';
      estadoElement.textContent = `${formatearFecha(doc.fecha_inicio)} - ${formatearFecha(doc.fecha_fin)}`;
      estadoElement.className = estado;
    }
    
    console.log('✅ Datos cargados correctamente');
  } catch (error) {
    console.error('❌ Error al cargar datos:', error);
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: 'Error al cargar los datos del documento: ' + error.message
    });
  }
}

// Función para convertir fecha de DD/MM/YYYY a YYYY-MM-DD
function convertirFormatoFecha(fecha) {
  if (!fecha) return null;
  const partes = fecha.split('/');
  if (partes.length === 3) {
    const [dia, mes, anio] = partes;
    return `${anio}-${mes}-${dia}`;
  }
  return fecha;
}

// Función para formatear fecha de YYYY-MM-DD a DD/MM/YYYY
function formatearFechaParaMostrar(fecha) {
  if (!fecha) return '';
  
  try {
    const [anio, mes, dia] = fecha.split('-');
    return `${dia}/${mes}/${anio}`;
  } catch (e) {
    return fecha;
  }
}

// Función para validar fechas
function validarFechasVigencia(fechaInicio, fechaFin) {
  console.log('🔍 Validando fechas:', { fechaInicio, fechaFin });
  
  if (!fechaInicio || !fechaFin) {
    Swal.fire({
      icon: 'warning',
      title: 'Campos Requeridos',
      text: 'Por favor, ingrese ambas fechas en formato DD/MM/YYYY'
    });
    return false;
  }

  // Convertir fechas al formato ISO
  const fechaInicioISO = convertirFormatoFecha(fechaInicio);
  const fechaFinISO = convertirFormatoFecha(fechaFin);
  
  console.log('📅 Fechas convertidas:', { fechaInicioISO, fechaFinISO });

  if (!fechaInicioISO || !fechaFinISO) {
    Swal.fire({
      icon: 'error',
      title: 'Formato Inválido',
      text: 'El formato de fecha debe ser DD/MM/YYYY'
    });
    return false;
  }

  const inicio = new Date(fechaInicioISO);
  const fin = new Date(fechaFinISO);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  if (isNaN(inicio.getTime()) || isNaN(fin.getTime())) {
    Swal.fire({
      icon: 'error',
      title: 'Fecha Inválida',
      text: 'Las fechas ingresadas no son válidas'
    });
    return false;
  }

  if (inicio < hoy) {
    Swal.fire({
      icon: 'warning',
      title: 'Fecha Inválida',
      text: 'La fecha de inicio no puede ser anterior a hoy'
    });
    return false;
  }

  if (fin <= inicio) {
    Swal.fire({
      icon: 'warning',
      title: 'Rango Inválido',
      text: 'La fecha de fin debe ser posterior a la fecha de inicio'
    });
    return false;
  }

  return {
    fechaInicio: fechaInicioISO,
    fechaFin: fechaFinISO
  };
}

// Inicialización cuando el DOM está listo
$(document).ready(function() {
  console.log('🚀 Inicializando manejadores de eventos...');
  
  // Manejar cierre de modales sin actualizar
  $('#definirSoatModal, #definirTecnomecanicaModal').on('hidden.bs.modal', function (e) {
    // Solo limpiar el formulario
    $(this).find('form').trigger('reset');
  });

  // Manejar botones de cancelar
  $('.btn-secondary[data-dismiss="modal"]').on('click', function(e) {
    e.preventDefault();
    $(this).closest('.modal').modal('hide');
  });

  // Inicializar formulario SOAT
  const formSoat = document.getElementById('soatForm');
  if (formSoat) {
    console.log('✅ Formulario SOAT encontrado');
    formSoat.addEventListener('submit', async function(e) {
      e.preventDefault();
      await guardarDocumento('soat');
    });
  }

  // Inicializar formulario Tecnomecánica
  const formTecno = document.getElementById('tecnomecanicaForm');
  if (formTecno) {
    console.log('✅ Formulario Tecnomecánica encontrado');
    formTecno.addEventListener('submit', async function(e) {
      e.preventDefault();
      await guardarDocumento('tecnomecanica');
    });
  }

  // Manejar el cambio en el filtro de tipo para mostrar vehículos o colaboradores
  $('#filtroTipo').on('change', function() {
    const tipo = $(this).val();
    const solicitudId = $('#colaboradoresId').text();
    
    if (!solicitudId) {
      console.warn('No hay ID de solicitud disponible');
      return;
    }

    $('#tablaColaboradores').empty();
    $('#tablaVehiculos').empty();

    if (tipo === 'colaboradores') {
      $('#tablaColaboradoresContainer').show();
      $('#tablaVehiculosContainer').hide();
      $('#filtroEstadoContainer').show();
      mostrarColaboradores(solicitudId); // Asume que esta función está en colaboradores.js
    } else if (tipo === 'vehiculos') {
      $('#tablaColaboradoresContainer').hide();
      $('#tablaVehiculosContainer').show();
      $('#filtroEstadoContainer').hide();
      mostrarVehiculos(solicitudId);
    }
  });

  // Manejar el envío del formulario de documentos
  $('#documentosVehiculoForm').on('submit', async function(e) {
    e.preventDefault();
    
    const vehiculoId = $('#vehiculoId').val();
    const solicitudId = $('#vsolicitudId').val();
    const documentoId = $('#vdocumentoId').val();
    const fechaInicio = $('#fechaInicioDoc').val();
    const fechaFin = $('#fechaFinDoc').val();
    
    if (!fechaInicio || !fechaFin) {
      $('#validacionFechasDoc').text('Por favor, ingrese ambas fechas').show();
      return;
    }
    
    if (new Date(fechaFin) <= new Date(fechaInicio)) {
      $('#validacionFechasDoc').text('La fecha de fin debe ser posterior a la fecha de inicio').show();
      return;
    }

    try {
      const response = await fetch('/api/sst/documentos-vehiculo', {
        method: documentoId ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          vehiculoId,
          solicitudId,
          documentoId,
          fechaInicio,
          fechaFin
        })
      });
      
      if (!response.ok) {
        throw new Error('Error al guardar el documento');
      }
      
      const data = await response.json();
      
      $('#documentosVehiculoModal').modal('hide');
      
      await Swal.fire({
        icon: 'success',
        title: 'Éxito',
        text: 'Documento guardado correctamente',
        timer: 1500
      });
      
      // Actualizar la tabla después de guardar
      mostrarVehiculos(solicitudId);
      
    } catch (error) {
      console.error('Error al guardar documento:', error);
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: error.message
      });
    }
  });
});

// Función para guardar documento
async function guardarDocumento(tipoDocumento) {
  try {
    console.log('📤 Enviando datos al servidor:', { vehiculoId: document.getElementById('vehiculoId' + tipoDocumento).value, solicitudId: document.getElementById('solicitudId' + tipoDocumento).value, tipoDocumento });
    
    // Verificar que SweetAlert2 esté disponible
    if (typeof Swal === 'undefined') {
      console.error('❌ SweetAlert2 no está disponible');
      alert('Error: No se pudo mostrar el diálogo de progreso');
      return;
    }
    
    const vehiculoId = document.getElementById('vehiculoId' + tipoDocumento).value;
    const solicitudId = document.getElementById('solicitudId' + tipoDocumento).value;
    
    if (!vehiculoId || !solicitudId) {
      await Swal.fire({
        icon: 'warning',
        title: 'Campos Requeridos',
        text: 'Por favor, ingrese el ID del vehículo y la solicitud',
        customClass: {
          popup: 'animated fadeInDown'
        }
      });
      return;
    }

    const formData = {
      vehiculoId,
      solicitudId,
      tipoDocumento,
      documentoId: document.getElementById('documentoId' + tipoDocumento).value,
      fechaInicio: document.getElementById('fechaInicio' + tipoDocumento).value,
      fechaFin: document.getElementById('fechaFin' + tipoDocumento).value
    };
      
      const response = await fetch('/api/sst/vehiculo-documento', {
        method: formData.documentoId ? 'PUT' : 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
        body: JSON.stringify(formData)
      });

    const responseData = await response.json();
    console.log("se recibe respuesta de informacion enviada: ", responseData);

    if (!response.ok) {
      throw new Error(responseData.message || 'Error al guardar el documento');
    }

    await Swal.fire({
      icon: 'success',
      title: 'Éxito',
      text: 'Vigencia guardada correctamente',
      timer: 1500,
      customClass: {
        popup: 'animated fadeInDown'
      }
    });
    
    $(`#definir${tipoDocumento.charAt(0).toUpperCase() + tipoDocumento.slice(1)}Modal`).modal('hide');
    await mostrarVehiculos(solicitudId);
  } catch (error) {
    console.error('❌ Error en el proceso:', error, ', servidor:', formData);
    await Swal.fire({
      icon: 'error',
      title: 'Error',
      text: error.message || 'Error al guardar la vigencia',
      customClass: {
        popup: 'animated fadeInDown'
      }
    });
  }
}

// Exportar funciones
window.definirSoat = definirSoat;
window.definirTecnomecanica = definirTecnomecanica;
window.mostrarVehiculos = mostrarVehiculos;
window.alternarEstadoLicencia = alternarEstadoLicencia;
window.toggleLicencia = toggleLicencia;