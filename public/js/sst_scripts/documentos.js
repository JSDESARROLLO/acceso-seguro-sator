/**
 * Funciones para la gestión de documentos - Vista SST
 */

// Descargar archivo
function descargarArchivo(url) {
  Swal.fire({
    title: 'Descargando...',
    text: 'Por favor espera mientras se descarga el documento.',
    allowOutsideClick: false,
    didOpen: () => { Swal.showLoading(); }
  });
  window.open(url, '_blank');
  Swal.close();
}

// Generar documentos
function generarDocumento(id) {
  Swal.fire({
    title: 'Generando...',
    text: 'Por favor espera mientras se genera el documento.',
    allowOutsideClick: false,
    didOpen: () => { Swal.showLoading(); }
  });
  fetch(`/descargar-solicitud/${id}`)
    .then(response => response.ok ? response.json() : Promise.reject('Error en la respuesta'))
    .then(data => {
      if (data.success) {
        window.open(data.url, '_blank');
        Swal.fire({ icon: 'success', title: 'Éxito', text: data.message || 'Documento generado correctamente' });
        const btnContainer = document.querySelector(`tr[data-id="${id}"] td:nth-child(10)`);
        if (btnContainer) {
          btnContainer.innerHTML = `<button class="btn btn-success btn-sm descargar-btn" data-url="${data.url}">Descargar Documentos</button>`;
          btnContainer.querySelector('.descargar-btn').addEventListener('click', function() { descargarArchivo(data.url); });
        }
      } else {
        throw new Error(data.error || 'Error al generar el documento');
      }
    })
    .catch(error => {
      Swal.fire({ icon: 'error', title: 'Error', text: error.message || 'No se pudo generar el documento.' });
      console.error('Error al generar:', error);
    });
}

// Función para cargar datos de un documento específico
async function cargarDatosDocumento(vehiculoId, tipoDocumento) {
  try {
    const response = await fetch(`/api/sst/vehiculo-documento/${vehiculoId}/${tipoDocumento}`);
    const data = await response.json();
    
    if (data.documento) {
      const doc = data.documento;
      document.getElementById('documentoId').value = doc.id;
      document.getElementById('fechaInicio').value = doc.fecha_inicio;
      document.getElementById('fechaFin').value = doc.fecha_fin;
      
      // Actualizar el estado en la interfaz
      const estadoElement = document.querySelector(`#estado-${tipoDocumento}-${vehiculoId}`);
      if (estadoElement) {
        estadoElement.textContent = doc.estado_actual;
        estadoElement.className = doc.estado_actual === 'vencido' ? 'text-danger' : 'text-success';
      }
    } else {
      // Limpiar campos si no hay documento
      document.getElementById('documentoId').value = '';
      document.getElementById('fechaInicio').value = '';
      document.getElementById('fechaFin').value = '';
      
      // Actualizar el estado en la interfaz
      const estadoElement = document.querySelector(`#estado-${tipoDocumento}-${vehiculoId}`);
      if (estadoElement) {
        estadoElement.textContent = 'No definido';
        estadoElement.className = 'text-warning';
      }
    }
  } catch (error) {
    console.error('Error al cargar datos del documento:', error);
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: 'Error al cargar los datos del documento'
    });
  }
}

// Función para actualizar un documento de vehículo
async function actualizarDocumentoVehiculo(vehiculoId, solicitudId, tipoDocumento, documentoId, fechaInicio, fechaFin) {
  try {
    const response = await fetch('/api/sst/vehiculo-documento', {
      method: documentoId ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        vehiculoId,
        solicitudId,
        tipoDocumento,
        documentoId,
        fechaInicio,
        fechaFin
      })
    });

    const data = await response.json();
    
    if (data.success) {
      // Actualizar la información en la interfaz
      await cargarDatosDocumento(vehiculoId, tipoDocumento);
      $('#definirVigenciaModal').modal('hide');
      
      // Mostrar mensaje de éxito
      Swal.fire({
        icon: 'success',
        title: 'Éxito',
        text: data.message,
        timer: 1500,
        showConfirmButton: false
      });
    } else {
      throw new Error(data.message || 'Error al actualizar el documento');
    }
  } catch (error) {
    console.error('Error:', error);
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: error.message
    });
  }
}

// Función para mostrar el modal de vigencia
function mostrarModalVigencia(vehiculoId, solicitudId, tipoDocumento) {
  document.getElementById('vehiculoId').value = vehiculoId;
  document.getElementById('solicitudId').value = solicitudId;
  document.getElementById('tipoDocumento').value = tipoDocumento;
  
  cargarDatosDocumento(vehiculoId, tipoDocumento);
  $('#definirVigenciaModal').modal('show');
}

// Función para definir vigencia de documentos de vehículos
async function definirVigencia(vehiculoId, solicitudId, tipoDocumento, documentoId) {
  try {
    // Limpiar formulario
    $('#vehiculoId').val(vehiculoId);
    $('#solicitudId').val(solicitudId);
    $('#tipoDocumento').val(tipoDocumento);
  
    // Actualizar título del modal
    const tipoDocumentoTexto = tipoDocumento === 'soat' ? 'SOAT' : 'Tecnomecánica';
    $('#definirVigenciaModalLabel').text(`Definir Vigencia de ${tipoDocumentoTexto}`);
    
    // Si ya existe un documento (tiene ID), obtener sus datos
    if (documentoId) {
      $('#documentoId').val(documentoId);
      
      // Mostrar indicador de carga
      Swal.fire({
        title: 'Cargando...',
        allowOutsideClick: false,
        didOpen: () => {
          Swal.showLoading();
        }
      });
      
      // Obtener datos existentes
      const response = await fetch(`/api/sst/vehiculo-documento/${vehiculoId}/${tipoDocumento}`);
      
      // Cerrar el indicador de carga
      Swal.close();
      
      if (!response.ok) {
        throw new Error(`Error HTTP: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.documento) {
        // Establecer fechas en el formulario
        $('#fechaInicio').val(data.documento.fecha_inicio);
        $('#fechaFin').val(data.documento.fecha_fin);
      } else {
        // Limpiar fechas si no hay documento
        $('#fechaInicio').val('');
        $('#fechaFin').val('');
        $('#documentoId').val('');
      }
    } else {
      // Es un documento nuevo, limpiar el formulario
      $('#documentoId').val('');
      $('#fechaInicio').val('');
      $('#fechaFin').val('');
    }
    
    // Mostrar el modal
    $('#definirVigenciaModal').modal('show');
  } catch (error) {
    console.error('Error al cargar datos de vigencia:', error);
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: 'No se pudieron cargar los datos del documento: ' + error.message
    });
  }
}

// Función para validar documentos
function validarDocumento(vehiculoId, tipoDocumento) {
  $('#vehiculoIdValidar').val(vehiculoId);
  $('#solicitudIdValidar').val($('#colaboradoresId').text());
  $('#tipoDocumentoValidar').val(tipoDocumento);
  $('#validarDocumentoModal').modal('show');
}

// Inicialización cuando el DOM está listo
$(document).ready(function() {
  // Evento para los botones de descarga y generación
  $('.descargar-btn').on('click', function() {
    const url = $(this).data('url');
    descargarArchivo(url);
  });

  $('.generar-btn').on('click', function() {
    const id = $(this).data('id');
    generarDocumento(id);
  });

  // Manejador del formulario de vigencia
  $('#vigenciaForm').on('submit', async function(e) {
    e.preventDefault();
    
    // Obtener valores del formulario
    const vehiculoId = $('#vehiculoId').val();
    const solicitudId = $('#solicitudId').val();
    const tipoDocumento = $('#tipoDocumento').val();
    const documentoId = $('#documentoId').val();
    const fechaInicio = $('#fechaInicio').val();
    const fechaFin = $('#fechaFin').val();
    
    // Validar fechas
    if (new Date(fechaFin) <= new Date(fechaInicio)) {
      $('#validacionFechas').show();
      return;
    }
    
    // Ocultar mensaje de validación
    $('#validacionFechas').hide();
    
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
      const response = await fetch('/api/sst/vehiculo-documento', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          vehiculoId,
          solicitudId,
          tipoDocumento,
          documentoId,
          fechaInicio,
          fechaFin
        })
      });

      // Cerrar indicador de carga
      Swal.close();
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Error al guardar el documento');
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
      $('#definirVigenciaModal').modal('hide');
      mostrarVehiculos(solicitudId);
    } catch (error) {
      console.error('Error al guardar documento:', error);
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: error.message || 'Error al guardar el documento'
      });
    }
  });

  // Validar fechas al cambiar
  $('#fechaInicio, #fechaFin').on('change', function() {
    const fechaInicio = $('#fechaInicio').val();
    const fechaFin = $('#fechaFin').val();
    
    if (fechaInicio && fechaFin) {
      if (new Date(fechaFin) <= new Date(fechaInicio)) {
        $('#validacionFechas').show();
      } else {
        $('#validacionFechas').hide();
      }
    }
  });

  // Manejador del formulario de validación
  $('#validarForm').on('submit', async function(e) {
    e.preventDefault();
    const vehiculoId = $('#vehiculoIdValidar').val();
    const solicitudId = $('#solicitudIdValidar').val();
    const tipoDocumento = $('#tipoDocumentoValidar').val();
    const estado = $('input[name="estadoDocumento"]:checked').val();
    const comentario = $('#comentarioValidacion').val();

    try {
      const response = await fetch('/api/sst/validar-documento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehiculoId,
          solicitudId,
          tipoDocumento,
          estado,
          comentario
        })
      });

      if (response.ok) {
        Swal.fire({ icon: 'success', title: 'Éxito', text: 'Documento validado correctamente.' });
        $('#validarDocumentoModal').modal('hide');
        verColaboradores(solicitudId); // Recargar datos
      } else {
        throw new Error('Error al validar el documento');
      }
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'Error', text: error.message });
    }
  });
});

// Exportar funciones para que estén disponibles globalmente
window.descargarArchivo = descargarArchivo;
window.generarDocumento = generarDocumento;
window.cargarDatosDocumento = cargarDatosDocumento;
window.actualizarDocumentoVehiculo = actualizarDocumentoVehiculo;
window.mostrarModalVigencia = mostrarModalVigencia;
window.definirVigencia = definirVigencia;
window.validarDocumento = validarDocumento; 