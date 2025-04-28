const express = require('express');
const controller = require('../controllers/seguridad.controller');   

const router = express.Router();

// Depuración de la importación del controlador
console.log('vista  controller:', controller);  // Para depurar que controller se importó correctamente

// Verificación de que la función 'vistaSst' está definida en el controlador
console.log('Verificando controller.seguridad...');
if (typeof controller.vistaSeguridad !== 'function') {
  console.error('seguridad.vistaSeguridad no es una función o está undefined');
} else {
  // Si controller.seguridad es una función válida, se añade la ruta
  router.get('/vista-seguridad', async (req, res) => {
    try {
      console.log('[RUTAS] Accediendo a la vista de Seguridad');
      await controller.vistaSeguridad(req, res);
    } catch (err) {
      console.error('[RUTAS] Error al acceder a la vista de Seguridad:', err);
      res.status(500).send('Error al acceder a la vista de Seguridad');
    }
  });
}

// Ruta para obtener detalles de una solicitud por ID (colaborador o vehículo)
router.get('/api/solicitudes/seguridad/:id', async (req, res) => {
    try {
        const solicitudId = req.params.id;
        console.log(`[RUTAS] Obteniendo detalles de la solicitud con ID: ${solicitudId}`);
        
        // Delegamos la lógica de obtener los detalles al controlador
        await controller.getSolicitudDetalles(req, res);
    } catch (err) {
        console.error('[RUTAS] Error al obtener los detalles de la solicitud:', err);
        res.status(500).send('Error al obtener los detalles de la solicitud');
    }
});

// Ruta para obtener detalles de un vehículo por ID
router.get('/api/solicitudes/vehiculo/:id', async (req, res) => {
    try {
      const vehiculoId = req.params.id;
      console.log(`[RUTAS] Obteniendo detalles del vehículo con ID: ${vehiculoId}`);
      await controller.getVehiculoDetalles(req, res);
    } catch (err) {
      console.error('[RUTAS] Error al obtener los detalles del vehículo:', err);
      res.status(500).send('Error al obtener los detalles del vehículo');
    }
});

// Ruta para registrar ingreso
router.put('/api/solicitudes/:id/registrar-ingreso', async (req, res) => {
    try {
        console.log('[RUTAS] Registrando ingreso para la solicitud...');
        await controller.registrarIngreso(req, res);
    } catch (err) {
        console.error('[RUTAS] Error al registrar ingreso:', err);
        res.status(500).send('Error al registrar ingreso');
    }
});

// Ruta para registrar entrada
router.post('/api/solicitudes/:id/registrar-entrada', async (req, res) => {
    try {
        console.log('[RUTAS] Registrando entrada para la solicitud...');
        await controller.registrarEntrada(req, res);
    } catch (err) {
        console.error('[RUTAS] Error al registrar entrada:', err);
        res.status(500).send('Error al registrar entrada');
    }
});

// Ruta para registrar salida
router.post('/api/solicitudes/:id/registrar-salida', async (req, res) => {
    try {
        console.log('[RUTAS] Registrando salida para la solicitud...');
        await controller.registrarSalida(req, res);
    } catch (err) {
        console.error('[RUTAS] Error al registrar salida:', err);
        res.status(500).send('Error al registrar salida');
    }
});

// Ruta para registrar entrada de vehículos
router.post('/api/solicitudes/:id/registrar-entrada-vehiculo', controller.registrarEntradaVehiculo);

// Ruta para registrar salida de vehículos
router.post('/api/solicitudes/:id/registrar-salida-vehiculo', controller.registrarSalidaVehiculo);

// Ruta para acceso por QR (colaborador o vehículo)
router.get('/vista-seguridad/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`[RUTAS] Accediendo por QR con ID: ${id}`);
        await controller.qrAccesosModal(req, res);
    } catch (err) {
        console.error('[RUTAS] Error al procesar acceso por QR:', err);
        res.status(500).send('Error al procesar acceso por QR');
    }
});

// Ruta temporal para mostrar tablas
router.get('/mostrar-tablas', controller.mostrarTablas);

// Ruta para obtener solicitudes activas
router.get('/api/solicitudes/obtenerSolicitudesActivasConColaboradoresYVehiculos', async (req, res) => {
    try {
        console.log('[RUTAS] Obteniendo solicitudes activas');
        await controller.obtenerSolicitudesActivasConColaboradoresYVehiculos(req, res);
    } catch (err) {
        console.error('[RUTAS] Error al obtener solicitudes activas:', err);
        res.status(500).json({ error: 'Error al obtener las solicitudes activas' });
    }
});

module.exports = router;
