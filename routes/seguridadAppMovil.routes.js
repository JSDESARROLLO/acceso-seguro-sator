const express = require('express');
const jwt = require('jsonwebtoken');
const controller = require('../controllers/seguridadAppMovil.controller');
const router = express.Router();

// Middleware de autenticación y autorización
const verificarToken = (req, res, next) => {
  const token = req.cookies?.token;
  const url = req.originalUrl;
  const method = req.method;

  console.info(`[${new Date().toISOString()}] ${method} ${url} - Verificando token...`);

  if (!token) {
    console.warn(`[${new Date().toISOString()}] ${method} ${url} - Acceso denegado: Token no proporcionado`);
    return res.status(401).json({ error: 'No autorizado', code: 'AUTH_REQUIRED' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secreto');
    
    if (decoded.role !== 'seguridad') {
      console.warn(`[${new Date().toISOString()}] ${method} ${url} - Acceso denegado: Rol no autorizado (${decoded.role}) para usuario ${decoded.username}`);
      return res.status(403).json({ error: 'Acceso denegado', code: 'FORBIDDEN' });
    }
    
    req.user = decoded;
    console.info(`[${new Date().toISOString()}] ${method} ${url} - Token válido para usuario ${decoded.username} (ID: ${decoded.id})`);
    next();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ${method} ${url} - Error al verificar token: ${error.message}`);
    return res.status(401).json({ error: 'Token inválido', code: 'INVALID_TOKEN' });
  }
};

// Aplicar middleware a todas las rutas
router.use(verificarToken);

// Definición de rutas
router
  .get('/solicitudes/activas', controller.obtenerSolicitudesActivas)
  .get('/solicitudes/:id', controller.obtenerDetallesSolicitud)
  .post('/solicitudes/:id/entrada-colaborador', controller.registrarEntradaColaborador)
  .post('/solicitudes/:id/salida-colaborador', controller.registrarSalidaColaborador)
  .post('/solicitudes/:id/entrada-vehiculo', controller.registrarEntradaVehiculo)
  .post('/solicitudes/:id/salida-vehiculo', controller.registrarSalidaVehiculo)
  .get('/solicitudes/:id/historial', controller.obtenerHistorialRegistros);

console.info(`[${new Date().toISOString()}] Rutas de seguridadAppMovil.controller inicializadas`);

module.exports = router;