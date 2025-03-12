const express = require('express');
const router = express.Router();
const controller = require('../controllers/estadisticas.controller');

// Ruta para obtener estadísticas anuales
router.get('/anuales', controller.getNovedadesAnuales);

// Ruta para obtener estadísticas por puesto
router.get('/por-puesto', controller.getNovedadesPorPuesto);

// Ruta para obtener estadísticas por tipo de evento
router.get('/por-evento', controller.getNovedadesPorEvento);

// Ruta para renderizar la vista principal de estadísticas
router.get('/estadisticas', controller.estadisticaSeventosCriticos); // Vista de estadísticas

module.exports = router;
