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
  fetch(`/descargar-solicitud/${id}`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  })
    .then(response => {
      if (!response.ok) {
        return response.json().then(err => { throw new Error(err.error || 'Error en la respuesta') });
      }
      return response.json();
    })
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
});

// Exportar funciones para que estén disponibles globalmente
window.descargarArchivo = descargarArchivo;
window.generarDocumento = generarDocumento;