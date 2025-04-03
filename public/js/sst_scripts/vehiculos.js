/**
 * Funciones para la gestión de vehículos - Vista SST
 */

// Función para mostrar vehículos de una solicitud
function mostrarVehiculos(solicitudId) {
  if (!solicitudId) {
    console.warn('No se proporcionó ID de solicitud para mostrar vehículos');
    return;
  }

  const tbody = $('#tablaVehiculos');
  tbody.empty();
  tbody.append('<tr><td colspan="7" class="text-center"><i class="fas fa-spinner fa-spin"></i> Cargando vehículos...</td></tr>');

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
                <span class="${soatClase}">${soatTexto}</span>
                <button class="btn btn-sm btn-primary ml-2" 
                        onclick="definirVigencia(${vehiculo.id}, ${solicitudId}, 'soat', '${vehiculo.soat ? vehiculo.soat.id : ''}')">
                  Definir
                </button>
              </td>
              <td>
                <span class="${tecnoClase}">${tecnoTexto}</span>
                <button class="btn btn-sm btn-primary ml-2" 
                        onclick="definirVigencia(${vehiculo.id}, ${solicitudId}, 'tecnomecanica', '${vehiculo.tecnomecanica ? vehiculo.tecnomecanica.id : ''}')">
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
        tbody.append('<tr><td colspan="7">No hay vehículos asociados a esta solicitud</td></tr>');
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
  
  // Verificar que tipoLicencia sea "conduccion" o "transito"
  if (tipoLicencia !== 'conduccion' && tipoLicencia !== 'transito') {
    console.error('Tipo de licencia inválido:', tipoLicencia);
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: 'Tipo de licencia inválido'
    });
    return;
  }
  
  // Convertir a formato completo (licencia_conduccion o licencia_transito)
  const tipoCompleto = `licencia_${tipoLicencia}`;
  
  // Llamar a la función que hace la petición al servidor
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
        text: activar ? 'Licencia aprobada correctamente' : 'Aprobación de licencia cancelada correctamente',
        timer: 1500
      });
      
      // Actualizar la tabla de vehículos
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

// Función para alternar la aprobación de licencia
async function alternarLicencia(vehiculoId, solicitudId, tipoLicencia, activar) {
  try {
    const response = await fetch('/api/sst/vehiculo-licencia', {
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
      throw new Error('Error al actualizar la licencia');
    }

    const result = await response.json();
    if (result.success) {
      Swal.fire({
        icon: 'success',
        title: 'Éxito',
        text: 'Estado de licencia actualizado correctamente'
      });
      verColaboradores(solicitudId); // Recargar datos
    }
  } catch (error) {
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: error.message
    });
  }
}

// Inicialización cuando el DOM está listo
$(document).ready(function() {
  // Manejar el cambio en el filtro de tipo para mostrar vehículos o colaboradores
  $('#filtroTipo').on('change', function() {
    const tipo = $(this).val();
    const solicitudId = $('#colaboradoresId').text();
    
    if (!solicitudId) {
      console.warn('No hay ID de solicitud disponible');
      return;
    }

    // Limpiar tablas primero para evitar duplicados
    $('#tablaColaboradores').empty();
    $('#tablaVehiculos').empty();

    if (tipo === 'colaboradores') {
      $('#tablaColaboradoresContainer').show();
      $('#tablaVehiculosContainer').hide();
      $('#filtroEstadoContainer').show();
      mostrarColaboradores(solicitudId);
    } else if (tipo === 'vehiculos') {
      $('#tablaColaboradoresContainer').hide();
      $('#tablaVehiculosContainer').show();
      $('#filtroEstadoContainer').hide();
      mostrarVehiculos(solicitudId);
    }
  });
});

// Exportar funciones para que estén disponibles globalmente
window.mostrarVehiculos = mostrarVehiculos;
window.alternarEstadoLicencia = alternarEstadoLicencia;
window.toggleLicencia = toggleLicencia;
window.alternarLicencia = alternarLicencia; 