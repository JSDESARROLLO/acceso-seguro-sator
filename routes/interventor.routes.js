const express = require('express');
const controller = require('../controllers/interventor.controller');
const router = express.Router();
  
// Lista de rutas requeridas con sus métodos y funciones correspondientes en el controlador
const requiredRoutes = {
  'GET /vista-interventor': 'vistaInterventor',
  'POST /aprobar-solicitud-interventor': 'aprobarSolicitud',
  'GET /generar-qr/:id': 'generarQR',
  'PUT /solicitudes/:solicitudId/detener-labor': 'detenerLabor',
  'PUT /solicitudes/:solicitudId/reanudar-labor': 'reanudarLabor',
  'GET /obtener-detalles-solicitud/:id': 'obtenerDetallesSolicitud',
  'GET /obtener-historial/:solicitudId': 'obtenerHistorialRegistros',
  'POST /filtrar-solicitudes': 'filtrarSolicitudes',
  'POST /eliminar-solicitud': 'eliminarSolicitud',
  'GET /descargar-excel-unico/:solicitudId': 'descargarExcelUnico',  // Updated path
  'GET /descargar-excel-global': 'descargarExcelGlobal',            // Updated path
}; 
router.get('/obtener-datos-tablas', controller.obtenerDatosTablas);
// Verificar que todas las funciones requeridas estén definidas en el controlador
Object.entries(requiredRoutes).forEach(([route, funcName]) => {
  if (typeof controller[funcName] !== 'function') {
    throw new Error(`[ERROR] La función '${funcName}' requerida para la ruta '${route}' no está definida en el controlador.`);
  }
});

// Función genérica para manejar rutas con manejo de errores
const handleRoute = (method, path, handlerName) => {
  router[method.toLowerCase()](path, async (req, res) => {
    console.log(`[RUTAS] ${method} ${path} - Procesando solicitud`);
    try {
      await controller[handlerName](req, res);
    } catch (err) {
      console.error(`[ERROR] En la ruta '${method} ${path}':`, err.message);
      res.status(500).send(`Error al procesar la solicitud en '${method} ${path}': ${err.message}`);
    }
  });
};

// Registrar todas las rutas dinámicamente
Object.entries(requiredRoutes).forEach(([route, funcName]) => {
  const [method, path] = route.split(' ');
  handleRoute(method, path, funcName);
});

// Exportar el router
module.exports = router;