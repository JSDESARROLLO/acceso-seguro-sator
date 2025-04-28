const express = require('express');
const controller = require('../controllers/seguridad-app-movil.controller');   
const router = express.Router();

// Middleware para verificar token y rol de seguridad
const verificarToken = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({ message: 'No autorizado' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secreto');
        if (decoded.role !== 'seguridad') {
            return res.status(403).json({ message: 'No autorizado' });
        }
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ message: 'Token inválido' });
    }
};

// Aplicar middleware de verificación a todas las rutas
router.use(verificarToken);

// Ruta para obtener solicitudes activas
router.get('/api/solicitudes/activas', controller.obtenerSolicitudesActivas);

// Ruta para obtener detalles de una solicitud
router.get('/api/solicitudes/:id', controller.obtenerDetallesSolicitud);

// Ruta para registrar entrada de colaborador
router.post('/api/solicitudes/:id/entrada-colaborador', controller.registrarEntradaColaborador);

// Ruta para registrar salida de colaborador
router.post('/api/solicitudes/:id/salida-colaborador', controller.registrarSalidaColaborador);

// Ruta para registrar entrada de vehículo
router.post('/api/solicitudes/:id/entrada-vehiculo', controller.registrarEntradaVehiculo);

// Ruta para registrar salida de vehículo
router.post('/api/solicitudes/:id/salida-vehiculo', controller.registrarSalidaVehiculo);

// Ruta para obtener historial de registros
router.get('/api/solicitudes/:id/historial', controller.obtenerHistorialRegistros);

module.exports = router; 