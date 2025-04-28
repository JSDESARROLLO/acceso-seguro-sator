const jwt = require('jsonwebtoken');
const connection = require('../db/db');
const moment = require('moment-timezone');
const SECRET_KEY = process.env.JWT_SECRET || 'secreto';

const controller = {};

// Obtener solicitudes activas
controller.obtenerSolicitudesActivas = async (req, res) => {
    try {
        const { id: userId, username } = req.user;

        const [solicitudes] = await connection.execute(`
            SELECT 
                s.id, 
                s.empresa, 
                s.nit, 
                s.estado, 
                us.username AS interventor, 
                s.lugar,
                l.nombre_lugar,
                DATE_FORMAT(s.inicio_obra, '%Y-%m-%d') AS inicio_obra,
                DATE_FORMAT(s.fin_obra, '%Y-%m-%d') AS fin_obra,
                s.labor,
                CASE
                    WHEN s.estado = 'aprobada' AND CURDATE() > s.fin_obra THEN 'pendiente ingreso - vencido'
                    WHEN s.estado = 'aprobada' THEN 'pendiente ingreso'
                    WHEN s.estado = 'en labor' AND CURDATE() > s.fin_obra THEN 'en labor - vencida'
                    WHEN s.estado = 'en labor' THEN 'en labor'
                    WHEN s.estado = 'labor detenida' THEN 'labor detenida'
                    ELSE s.estado
                END AS estado_actual
            FROM 
                solicitudes s
            JOIN 
                acciones a ON s.id = a.solicitud_id
            JOIN 
                users us ON us.id = s.interventor_id
            JOIN 
                lugares l ON s.lugar = l.id
            WHERE 
                s.estado IN ('aprobada', 'en labor', 'labor detenida')
                AND a.accion = 'aprobada'
                AND EXISTS (
                    SELECT 1 
                    FROM users seguridad 
                    WHERE seguridad.id = ? 
                    AND seguridad.role_id = (SELECT id FROM roles WHERE role_name = 'seguridad')
                )
            ORDER BY 
                s.id DESC;
        `, [userId]);

        res.json(solicitudes);
    } catch (error) {
        console.error('Error al obtener solicitudes activas:', error);
        res.status(500).json({ error: 'Error al obtener las solicitudes activas' });
    }
};

// Obtener detalles de una solicitud
controller.obtenerDetallesSolicitud = async (req, res) => {
    try {
        const { id } = req.params;
        const { username } = req.user;

        // Obtener detalles de la solicitud
        const [solicitudDetails] = await connection.execute(`
            SELECT 
                s.id, s.empresa, s.nit, s.estado, us.username AS interventor,
                DATE_FORMAT(inicio_obra, '%Y-%m-%d') AS inicio_obra,
                DATE_FORMAT(fin_obra, '%Y-%m-%d') AS fin_obra,
                CASE
                    WHEN estado = 'aprobada' AND CURDATE() > DATE(fin_obra) THEN 'pendiente ingreso - vencido'
                    WHEN estado = 'aprobada' THEN 'pendiente ingreso'
                    WHEN estado = 'en labor' AND CURDATE() > DATE(fin_obra) THEN 'en labor - vencida'
                    WHEN estado = 'en labor' THEN 'en labor'
                    WHEN estado = 'labor detenida' THEN 'labor detenida'
                    ELSE estado
                END AS estado_actual,
                l.nombre_lugar,
                s.labor
            FROM solicitudes s
            LEFT JOIN users us ON us.id = s.interventor_id
            LEFT JOIN acciones a ON a.solicitud_id = s.id
            LEFT JOIN lugares l ON s.lugar = l.id
            WHERE s.id = ? AND estado IN ('aprobada', 'en labor', 'labor detenida')
            AND a.accion = 'aprobada'
        `, [id]);

        if (!solicitudDetails.length) {
            return res.status(404).json({ message: 'Solicitud no encontrada' });
        }

        // Obtener colaboradores
        const [colaboradores] = await connection.execute(`
            SELECT 
                c.id, c.nombre, c.cedula, c.foto, c.estado,
                rc.estado AS curso_siso_estado,
                rc.fecha_vencimiento AS curso_siso_vencimiento,
                pss.fecha_inicio AS plantilla_ss_inicio,
                pss.fecha_fin AS plantilla_ss_fin
            FROM colaboradores c
            LEFT JOIN (
                SELECT rc.colaborador_id, rc.estado, rc.fecha_vencimiento
                FROM resultados_capacitaciones rc
                JOIN capacitaciones cap ON rc.capacitacion_id = cap.id
                WHERE cap.nombre = 'Curso SISO'
                ORDER BY rc.created_at DESC LIMIT 1
            ) rc ON c.id = rc.colaborador_id
            LEFT JOIN (
                SELECT colaborador_id, fecha_inicio, fecha_fin
                FROM plantilla_seguridad_social
                ORDER BY created_at DESC LIMIT 1
            ) pss ON c.id = pss.colaborador_id
            WHERE c.solicitud_id = ?
        `, [id]);

        // Obtener vehículos
        const [vehiculos] = await connection.execute(`
            SELECT 
                v.id, v.matricula, v.foto, v.estado,
                pdv_soat.fecha_inicio AS soat_inicio,
                pdv_soat.fecha_fin AS soat_fin,
                pdv_tecno.fecha_inicio AS tecnomecanica_inicio,
                pdv_tecno.fecha_fin AS tecnomecanica_fin,
                lv_conduccion.estado AS licencia_conduccion,
                lv_transito.estado AS licencia_transito
            FROM vehiculos v
            LEFT JOIN (
                SELECT vehiculo_id, fecha_inicio, fecha_fin
                FROM plantilla_documentos_vehiculos
                WHERE tipo_documento = 'soat'
                ORDER BY created_at DESC LIMIT 1
            ) pdv_soat ON v.id = pdv_soat.vehiculo_id
            LEFT JOIN (
                SELECT vehiculo_id, fecha_inicio, fecha_fin
                FROM plantilla_documentos_vehiculos
                WHERE tipo_documento = 'tecnomecanica'
                ORDER BY created_at DESC LIMIT 1
            ) pdv_tecno ON v.id = pdv_tecno.vehiculo_id
            LEFT JOIN licencias_vehiculo lv_conduccion ON v.id = lv_conduccion.vehiculo_id 
                AND lv_conduccion.tipo = 'licencia_conduccion'
            LEFT JOIN licencias_vehiculo lv_transito ON v.id = lv_transito.vehiculo_id 
                AND lv_transito.tipo = 'licencia_transito'
            WHERE v.solicitud_id = ?
        `, [id]);

        res.json({
            ...solicitudDetails[0],
            colaboradores,
            vehiculos
        });
    } catch (error) {
        console.error('Error al obtener detalles de la solicitud:', error);
        res.status(500).json({ error: 'Error al obtener los detalles de la solicitud' });
    }
};

// Registrar entrada de colaborador
controller.registrarEntradaColaborador = async (req, res) => {
    try {
        const { id: userId } = req.user;
        const { id: solicitudId } = req.params;
        const { colaboradores, fecha, estado_actual } = req.body;

        if (!colaboradores || !fecha || !estado_actual) {
            return res.status(400).json({ message: 'Datos incompletos' });
        }

        const fechaRegistro = moment().tz("America/Bogota").format("YYYY-MM-DD HH:mm:ss");

        for (const colaborador of colaboradores) {
            await connection.execute(
                'INSERT INTO registros (colaborador_id, solicitud_id, usuario_id, tipo, fecha_hora, estado_actual, created_at) VALUES (?, ?, ?, "entrada", ?, ?, ?)',
                [colaborador.id, solicitudId, userId, fecha, estado_actual, fechaRegistro]
            );
        }

        res.json({ message: 'Entrada de colaboradores registrada correctamente' });
    } catch (error) {
        console.error('Error al registrar entrada de colaboradores:', error);
        res.status(500).json({ error: 'Error al registrar la entrada de colaboradores' });
    }
};

// Registrar salida de colaborador
controller.registrarSalidaColaborador = async (req, res) => {
    try {
        const { id: userId } = req.user;
        const { id: solicitudId } = req.params;
        const { colaboradores, fecha, estado_actual } = req.body;

        if (!colaboradores || !fecha || !estado_actual) {
            return res.status(400).json({ message: 'Datos incompletos' });
        }

        const fechaRegistro = moment().tz("America/Bogota").format("YYYY-MM-DD HH:mm:ss");

        for (const colaborador of colaboradores) {
            await connection.execute(
                'INSERT INTO registros (colaborador_id, solicitud_id, usuario_id, tipo, fecha_hora, estado_actual, created_at) VALUES (?, ?, ?, "salida", ?, ?, ?)',
                [colaborador.id, solicitudId, userId, fecha, estado_actual, fechaRegistro]
            );
        }

        res.json({ message: 'Salida de colaboradores registrada correctamente' });
    } catch (error) {
        console.error('Error al registrar salida de colaboradores:', error);
        res.status(500).json({ error: 'Error al registrar la salida de colaboradores' });
    }
};

// Registrar entrada de vehículo
controller.registrarEntradaVehiculo = async (req, res) => {
    try {
        const { id: userId } = req.user;
        const { id: solicitudId } = req.params;
        const { vehiculos, fecha, estado_actual } = req.body;

        if (!vehiculos || !fecha || !estado_actual) {
            return res.status(400).json({ message: 'Datos incompletos' });
        }

        const fechaRegistro = moment().tz("America/Bogota").format("YYYY-MM-DD HH:mm:ss");

        for (const vehiculo of vehiculos) {
            const vehiculoId = vehiculo.id.replace('VH-', '');
            await connection.execute(
                'INSERT INTO registros_vehiculos (vehiculo_id, solicitud_id, usuario_id, tipo, fecha_hora, estado_actual, created_at) VALUES (?, ?, ?, "entrada", ?, ?, ?)',
                [vehiculoId, solicitudId, userId, fecha, estado_actual, fechaRegistro]
            );
        }

        res.json({ message: 'Entrada de vehículos registrada correctamente' });
    } catch (error) {
        console.error('Error al registrar entrada de vehículos:', error);
        res.status(500).json({ error: 'Error al registrar la entrada de vehículos' });
    }
};

// Registrar salida de vehículo
controller.registrarSalidaVehiculo = async (req, res) => {
    try {
        const { id: userId } = req.user;
        const { id: solicitudId } = req.params;
        const { vehiculos, fecha, estado_actual } = req.body;

        if (!vehiculos || !fecha || !estado_actual) {
            return res.status(400).json({ message: 'Datos incompletos' });
        }

        const fechaRegistro = moment().tz("America/Bogota").format("YYYY-MM-DD HH:mm:ss");

        for (const vehiculo of vehiculos) {
            const vehiculoId = vehiculo.id.replace('VH-', '');
            await connection.execute(
                'INSERT INTO registros_vehiculos (vehiculo_id, solicitud_id, usuario_id, tipo, fecha_hora, estado_actual, created_at) VALUES (?, ?, ?, "salida", ?, ?, ?)',
                [vehiculoId, solicitudId, userId, fecha, estado_actual, fechaRegistro]
            );
        }

        res.json({ message: 'Salida de vehículos registrada correctamente' });
    } catch (error) {
        console.error('Error al registrar salida de vehículos:', error);
        res.status(500).json({ error: 'Error al registrar la salida de vehículos' });
    }
};

// Obtener historial de registros
controller.obtenerHistorialRegistros = async (req, res) => {
    try {
        const { id: solicitudId } = req.params;

        // Obtener historial de colaboradores
        const [historialColaboradores] = await connection.execute(`
            SELECT 
                r.id,
                r.colaborador_id,
                c.nombre,
                c.cedula,
                r.tipo,
                DATE_FORMAT(r.fecha_hora, '%Y-%m-%d %H:%i:%s') AS fecha_hora,
                r.estado_actual,
                u.username AS usuario_registro
            FROM registros r
            JOIN colaboradores c ON r.colaborador_id = c.id
            JOIN users u ON r.usuario_id = u.id
            WHERE r.solicitud_id = ?
            ORDER BY r.fecha_hora DESC
        `, [solicitudId]);

        // Obtener historial de vehículos
        const [historialVehiculos] = await connection.execute(`
            SELECT 
                r.id,
                r.vehiculo_id,
                v.matricula,
                r.tipo,
                DATE_FORMAT(r.fecha_hora, '%Y-%m-%d %H:%i:%s') AS fecha_hora,
                r.estado_actual,
                u.username AS usuario_registro
            FROM registros_vehiculos r
            JOIN vehiculos v ON r.vehiculo_id = v.id
            JOIN users u ON r.usuario_id = u.id
            WHERE r.solicitud_id = ?
            ORDER BY r.fecha_hora DESC
        `, [solicitudId]);

        res.json({
            colaboradores: historialColaboradores,
            vehiculos: historialVehiculos
        });
    } catch (error) {
        console.error('Error al obtener historial de registros:', error);
        res.status(500).json({ error: 'Error al obtener el historial de registros' });
    }
};

module.exports = controller; 