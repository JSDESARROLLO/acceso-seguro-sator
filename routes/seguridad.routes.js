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



// Ruta para obtener detalles de una solicitud por ID
router.get('/api/solicitudes/:id', async (req, res) => {
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



// Ruta para registrar ingreso (actualizar estado a "en labor")
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


  router.get('/vista-seguridad/:id', controller.qrAccesosModal);



module.exports = router;
