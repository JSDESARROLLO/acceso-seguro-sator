document.addEventListener('DOMContentLoaded', function() {
  const tipoNegocioSelect = document.getElementById('negocio_id');
  const tipoNovedadSelect = document.getElementById('tipo_novedad_id');
  const destinatarioSelect = document.getElementById('destinatario_id');
  const puestoSelect = document.getElementById('puesto_id');
  const listDestinatariosAsignados = document.getElementById('listDestinatariosAsignados');

  // Función para obtener puestos por tipo de negocio
  function obtenerPuestos() {
    const tipoNegocioId = tipoNegocioSelect.value;

    if (tipoNegocioId) {
      fetch(`/api/puestos?tipoNegocioId=${tipoNegocioId}`)
        .then(response => response.json())
        .then(puestos => {
          puestoSelect.innerHTML = '<option value="" disabled selected>Seleccione un puesto</option>';
          puestos.forEach(puesto => {
            const option = document.createElement('option');
            option.value = puesto.id_puesto;
            option.textContent = puesto.nombre_puesto;
            puestoSelect.appendChild(option);
          });
        })
        .catch(error => {
          console.error('Error al obtener los puestos:', error);
        });
    }
  }

  // Función para obtener los destinatarios asignados a un puesto y tipo de novedad
  function obtenerDestinatariosAsignados() {
    const puestoId = puestoSelect.value;
    const tipoNovedadId = tipoNovedadSelect.value;

    if (puestoId && tipoNovedadId) {
      fetch(`/api/destinatarios/asignados?puestoId=${puestoId}&tipoNovedadId=${tipoNovedadId}`)
        .then(response => response.json())
        .then(destinatariosAsignados => {
          listDestinatariosAsignados.innerHTML = ''; // Limpiar lista antes de actualizar
          destinatariosAsignados.forEach(destinatario => {
            const li = document.createElement('li');
            li.textContent = `${destinatario.nombre} - ${destinatario.email}`;
            listDestinatariosAsignados.appendChild(li);
          });
        })
        .catch(error => {
          console.error('Error al obtener los destinatarios asignados:', error);
        });
    }
  }

  // Eventos para manejar los cambios en los selects
  tipoNegocioSelect.addEventListener('change', obtenerPuestos);
  tipoNovedadSelect.addEventListener('change', obtenerDestinatariosAsignados);
  puestoSelect.addEventListener('change', obtenerDestinatariosAsignados);

  // Inicializar al cargar la página
  obtenerPuestos();
  obtenerDestinatariosAsignados();
});

const formRegistrarDestinatario = document.getElementById('formRegistrarDestinatario');
const mensajeDestinatario = document.getElementById('mensajeDestinatario');

formRegistrarDestinatario.addEventListener('submit', function(event) {
    event.preventDefault(); // Evitar el comportamiento por defecto

    const nombre = document.getElementById('nombre').value;
    const email = document.getElementById('email').value;
    const telefono = document.getElementById('telefono').value;
    const tipoDestinatarioId = document.getElementById('tipo_destinatario_id').value;

    // Validar los campos
    if (!nombre || !email || !tipoDestinatarioId) {
        mensajeDestinatario.textContent = 'Por favor, complete todos los campos requeridos.';
        return;
    }

    // Crear un objeto con los datos del destinatario
    const destinatarioData = {
        nombre: nombre,
        email: email,
        telefono: telefono,
        tipo_destinatario_id: tipoDestinatarioId
    };

    // Enviar los datos al backend utilizando fetch
    fetch('/api/destinatarios/registrar', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(destinatarioData)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            mensajeDestinatario.textContent = 'Destinatario registrado con éxito.';
            formRegistrarDestinatario.reset(); // Limpiar el formulario
        } else {
            mensajeDestinatario.textContent = 'Error al registrar el destinatario.';
        }
    })
    .catch(error => {
        console.error('Error al registrar destinatario:', error);
        mensajeDestinatario.textContent = 'Hubo un error al registrar el destinatario.';
    });
});