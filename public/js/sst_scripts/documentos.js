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
  console.log('🔄 Iniciando generación de documentos para solicitud:', id);
  
  Swal.fire({
    title: 'Generando...',
    text: 'Por favor espera mientras se genera el documento.',
    allowOutsideClick: false,
    didOpen: () => { Swal.showLoading(); }
  });

  fetch(`/api/sst/generar-documentos/${id}`, {
    method: 'POST',
    headers: { 
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  })
    .then(response => {
      console.log('📥 Respuesta recibida:', {
        status: response.status,
        statusText: response.statusText
      });

      if (!response.ok) {
        return response.text().then(text => {
          console.error('❌ Error en la respuesta:', text);
          try {
            // Intentar parsear como JSON
            const json = JSON.parse(text);
            throw new Error(json.message || json.error || 'Error en la respuesta del servidor');
          } catch (e) {
            // Si no es JSON, usar el texto como está
            throw new Error(text || 'Error en la respuesta del servidor');
          }
        });
      }
      return response.json();
    })
    .then(data => {
      console.log('✅ Datos recibidos:', data);
      
      if (data.success) {
        window.open(data.url, '_blank');
        Swal.fire({ 
          icon: 'success', 
          title: 'Éxito', 
          text: data.message || 'Documento generado correctamente' 
        });
        
        // Actualizar el botón en la tabla
        const btnContainer = document.querySelector(`tr[data-id="${id}"] td:nth-child(10)`);
        if (btnContainer) {
          btnContainer.innerHTML = `<button class="btn btn-success btn-sm descargar-btn" data-url="${data.url}">Descargar Documentos</button>`;
          btnContainer.querySelector('.descargar-btn').addEventListener('click', function() { 
            descargarArchivo(data.url); 
          });
        }
      } else {
        throw new Error(data.message || 'Error al generar el documento');
      }
    })
    .catch(error => {
      console.error('❌ Error al generar:', error);
      Swal.fire({ 
        icon: 'error', 
        title: 'Error', 
        text: error.message || 'No se pudo generar el documento.' 
      });
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