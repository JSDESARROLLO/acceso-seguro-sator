// seguridad.controller.js
const jwt = require('jsonwebtoken');
const connection = require('../db/db');  // Asegúrate de que este connection sea el correcto
const SECRET_KEY = process.env.JWT_SECRET || 'secreto';
const { format } = require('date-fns');  // Importamos la función 'format' de date-fns
const QRCode = require('qrcode');
const moment = require('moment-timezone');

const controller = {};
controller.vistaSeguridad = async (req, res) => {
    const token = req.cookies.token;

    if (!token) return res.redirect('/login');

    try { 
        const decoded = jwt.verify(token, SECRET_KEY);
        if (decoded.role !== 'seguridad') return res.redirect('/login');
 
        const { role, id, username } = decoded;
  
        // Obtener solicitudes y calcular estados 
    const [solicitud] = await connection.execute(`
        SELECT 
            s.id, 
            s.empresa, 
            s.nit, 
            s.estado, 
            us.username AS interventor, 
            s.lugar,
            l.nombre_lugar,
            DATE_FORMAT(s.inicio_obra, '%d/%m/%Y') AS inicio_obra,
            DATE_FORMAT(s.fin_obra, '%d/%m/%Y') AS fin_obra,
            CASE
                -- Si está aprobada y la fecha de fin ya pasó
                WHEN s.estado = 'aprobada' AND CURDATE() > DATE(s.fin_obra) THEN 'pendiente ingreso - vencido'
                -- Si está aprobada y aún no ha vencido
                WHEN s.estado = 'aprobada' THEN 'pendiente ingreso'
                -- Si está en labor y vencida
                WHEN s.estado = 'en labor' AND CURDATE() > DATE(s.fin_obra) THEN 'en labor - vencida'
                -- Si está en labor
                WHEN s.estado = 'en labor' THEN 'en labor'
                -- Si está detenida
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
        JOIN 
            users seguridad ON l.id = (SELECT id FROM lugares WHERE nombre_lugar = seguridad.username)
        WHERE 
            s.estado IN ('aprobada', 'en labor', 'labor detenida')
            AND a.accion = 'aprobada'
            AND seguridad.role_id = (SELECT id FROM roles WHERE role_name = 'seguridad')
            AND seguridad.id = ?  -- Filtra por el ID del usuario de seguridad
        ORDER BY 
            s.id DESC;
        `, [id] );


        res.render('seguridad', { solicitud, title: 'Control de Seguridad - Grupo Argos', username: username });
    } catch (err) {
        console.error('Error al verificar el token o al obtener solicitudes:', err);
        res.redirect('/login');
    }
};
 


controller.getSolicitudDetalles = async (req, res) => {
    const { id } = req.params;
    try {
        const token = req.cookies.token;
        if (!token) {
            return res.status(401).json({ message: 'No autorizado' });
        }

        const decoded = jwt.verify(token, SECRET_KEY);
        if (decoded.role !== 'seguridad') {
            return res.status(403).json({ message: 'No autorizado' });
        }

        const { id: userId, username } = decoded;

        // Determinar si es un vehículo o un colaborador
        const isVehiculo = id.startsWith('VH-');
        const entityId = isVehiculo ? id.replace('VH-', '') : id;

        if (isVehiculo) {
            // Obtener datos del vehículo
            const [vehiculo] = await connection.execute(
                QUERIES.VEHICULO + ' WHERE v.id = ?',
                [entityId]
            );

            if (!vehiculo.length) {
                return res.status(404).json({ message: 'Vehículo no encontrado' });
            }

            const solicitudId = vehiculo[0].solicitud_id;

            // Obtener datos de la solicitud asociada
            const [solicitudDetails] = await connection.execute(
                QUERIES.SOLICITUD,
                [solicitudId]
            );

            if (!solicitudDetails.length) {
                return res.status(404).json({ message: 'Solicitud no encontrada' });
            }

            // Determinar estado de los documentos del vehículo
            const mensajesAdvertencia = verificarDocumentosVehiculo(vehiculo[0]);

            // Verificación del lugar
            const lugarSolicitud = solicitudDetails[0].nombre_lugar;
            const mensajeAdvertencia = verificarLugarSolicitud(lugarSolicitud, username);

            res.json({
                ...solicitudDetails[0],
                vehiculos: [{
                    ...vehiculo[0],
                    mensajesAdvertencia: mensajesAdvertencia.length > 0 ? mensajesAdvertencia : null
                }],
                colaboradores: [], // No incluir colaboradores
                advertencia: mensajeAdvertencia,
                mensajeVehiculos: mensajesAdvertencia.length > 0 ? mensajesAdvertencia.join(' ') : null,
                mensajeCursoSiso: null, // No incluir advertencias de colaboradores
                mensajePlantillaSS: null // No incluir advertencias de colaboradores
            });

        } else {
            // Obtener datos del colaborador
            const [colaborador] = await connection.execute(
                QUERIES.COLABORADOR + ' WHERE c.id = ?',
                [entityId, entityId, entityId]
            );

            if (!colaborador.length) {
                return res.status(404).json({ message: 'Colaborador no encontrado' });
            }

            const solicitudId = colaborador[0].solicitud_id;

            // Obtener datos de la solicitud asociada
            const [solicitudDetails] = await connection.execute(
                QUERIES.SOLICITUD,
                [solicitudId]
            );

            if (!solicitudDetails.length) {
                return res.status(404).json({ message: 'Solicitud no encontrada' });
            }

            // Determinar estado del Curso SISO
            let cursoSisoEstado = 'No';
            let mensajeCursoSiso = null;
            if (colaborador[0].curso_siso_estado) {
                if (colaborador[0].curso_siso_estado === 'APROBADO') {
                    const fechaVencimiento = new Date(colaborador[0].curso_siso_vencimiento);
                    const hoy = new Date();
                    cursoSisoEstado = fechaVencimiento > hoy ? 'Aprobado' : 'Vencido';
                    mensajeCursoSiso = cursoSisoEstado === 'Vencido' ? 'Curso SISO vencido.' : null;
                } else {
                    cursoSisoEstado = 'Perdido';
                    mensajeCursoSiso = 'Curso SISO perdido.';
                }
            } else {
                mensajeCursoSiso = 'No ha realizado el Curso SISO.';
            }

            // Determinar estado de la Plantilla SS
            let plantillaSSEstado = 'No definida';
            let mensajePlantillaSS = null;
            if (colaborador[0].plantilla_ss_fin) {
                const fechaFin = new Date(colaborador[0].plantilla_ss_fin);
                const hoy = new Date();
                plantillaSSEstado = fechaFin > hoy ? 'Vigente' : 'Vencida';
                mensajePlantillaSS = plantillaSSEstado === 'Vencida' ? 'Plantilla de Seguridad Social vencida.' : null;
            } else {
                mensajePlantillaSS = 'No se ha definido la Plantilla de Seguridad Social.';
            }

            // Verificación del lugar
            const lugarSolicitud = solicitudDetails[0].nombre_lugar;
            const mensajeAdvertencia = verificarLugarSolicitud(lugarSolicitud, username);

            res.json({
                ...solicitudDetails[0],
                colaboradores: [{
                    ...colaborador[0],
                    cursoSiso: cursoSisoEstado,
                    plantillaSS: plantillaSSEstado
                }],
                vehiculos: [], // No incluir vehículos
                advertencia: mensajeAdvertencia,
                mensajeCursoSiso,
                mensajePlantillaSS,
                mensajeVehiculos: null // No incluir advertencias de vehículos
            });
        }
    } catch (error) {
        console.error('Error al procesar la solicitud:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// Consultas SQL reutilizables
const QUERIES = {
    VEHICULO: `
         SELECT 
    v.id, v.solicitud_id, v.matricula, v.foto, v.estado,
    pdv_soat.fecha_inicio AS soat_inicio, pdv_soat.fecha_fin AS soat_fin,
    pdv_tecno.fecha_inicio AS tecnomecanica_inicio, pdv_tecno.fecha_fin AS tecnomecanica_fin,
    lv_conduccion.estado AS licencia_conduccion,
    lv_transito.estado AS licencia_transito
FROM vehiculos v
LEFT JOIN (
    SELECT vehiculo_id, fecha_inicio, fecha_fin
    FROM plantilla_documentos_vehiculos pdv1
    WHERE tipo_documento = 'soat'
    AND created_at = (
        SELECT MAX(created_at)
        FROM plantilla_documentos_vehiculos pdv2
        WHERE pdv2.vehiculo_id = pdv1.vehiculo_id
        AND pdv2.tipo_documento = 'soat'
    )
) pdv_soat ON v.id = pdv_soat.vehiculo_id
LEFT JOIN (
    SELECT vehiculo_id, fecha_inicio, fecha_fin
    FROM plantilla_documentos_vehiculos pdv1
    WHERE tipo_documento = 'tecnomecanica'
    AND created_at = (
        SELECT MAX(created_at)
        FROM plantilla_documentos_vehiculos pdv2
        WHERE pdv2.vehiculo_id = pdv1.vehiculo_id
        AND pdv2.tipo_documento = 'tecnomecanica'
    )
) pdv_tecno ON v.id = pdv_tecno.vehiculo_id
LEFT JOIN licencias_vehiculo lv_conduccion ON v.id = lv_conduccion.vehiculo_id AND lv_conduccion.tipo = 'licencia_conduccion'
LEFT JOIN licencias_vehiculo lv_transito ON v.id = lv_transito.vehiculo_id AND lv_transito.tipo = 'licencia_transito'
    `,
    SOLICITUD: `
        SELECT s.id, s.empresa, s.nit, s.estado, us.username AS interventor,
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
    `,
    COLABORADOR: `
        SELECT 
            c.id, c.solicitud_id, c.cedula, c.nombre, c.foto, c.cedulaFoto, c.estado,
            rc.estado AS curso_siso_estado, rc.fecha_vencimiento AS curso_siso_vencimiento,
            pss.fecha_inicio AS plantilla_ss_inicio, pss.fecha_fin AS plantilla_ss_fin
        FROM colaboradores c
        LEFT JOIN (
            SELECT rc.colaborador_id, rc.estado, rc.fecha_vencimiento
            FROM resultados_capacitaciones rc
            JOIN capacitaciones cap ON rc.capacitacion_id = cap.id
            WHERE cap.nombre = 'Curso SISO' AND rc.colaborador_id = ?
            ORDER BY rc.created_at DESC LIMIT 1
        ) rc ON c.id = rc.colaborador_id
        LEFT JOIN (
            SELECT colaborador_id, fecha_inicio, fecha_fin
            FROM plantilla_seguridad_social
            WHERE colaborador_id = ?
            ORDER BY created_at DESC LIMIT 1
        ) pss ON c.id = pss.colaborador_id
    `
};

// Funciones auxiliares
const verificarDocumentosVehiculo = (vehiculo) => {
    const hoy = new Date();
    const mensajesAdvertencia = [];

    // Verificar SOAT
    if (!vehiculo.soat_inicio || !vehiculo.soat_fin) {
        mensajesAdvertencia.push('SOAT no definido.');
    } else if (new Date(vehiculo.soat_fin) < hoy) {
        mensajesAdvertencia.push('SOAT vencido.');
    }

    // Verificar Tecnomecánica
    if (!vehiculo.tecnomecanica_inicio || !vehiculo.tecnomecanica_fin) {
        mensajesAdvertencia.push('Tecnomecánica no definida.');
    } else if (new Date(vehiculo.tecnomecanica_fin) < hoy) {
        mensajesAdvertencia.push('Tecnomecánica vencida.');
    }

    // Verificar Licencias
    if (!vehiculo.licencia_conduccion) {
        mensajesAdvertencia.push('Licencia de conducción no aprobada.');
    }
    if (!vehiculo.licencia_transito) {
        mensajesAdvertencia.push('Licencia de tránsito no aprobada.');
    }

    return mensajesAdvertencia;
};

const verificarLugarSolicitud = (lugarSolicitud, username) => {
    if (lugarSolicitud === 'Supervisor') return null;
    return lugarSolicitud !== username
        ? 'ADVERTENCIA: El lugar de la solicitud no coincide con tu ubicación. Notifica a la central la novedad.'
        : null;
};

controller.qrAccesosModal = async (req, res) => {
    const { id } = req.params;
    let username;

    try {
        // Validación de autenticación
        const token = req.cookies.token;
        if (!token) {
            console.log('Intento de acceso sin token');
            return res.redirect('/login');
        }

        const decoded = jwt.verify(token, SECRET_KEY);
        if (decoded.role !== 'seguridad') {
            console.log(`Intento de acceso no autorizado por usuario ${decoded.username}`);
            return res.redirect('/login');
        }

        username = decoded.username;

        // Determinar tipo de entidad
        const isVehiculo = id.startsWith('VH-');
        const entityId = isVehiculo ? id.replace('VH-', '') : id;

        if (isVehiculo) {
            // Procesamiento para vehículos
            const [vehiculo] = await connection.execute(
                `${QUERIES.VEHICULO} WHERE v.id = ?`,
                [entityId]
            );

            if (!vehiculo.length) {
                console.log(`Vehículo con ID ${entityId} no encontrado`);
                return res.render('seguridad', {
                    solicitud: [],
                    modalData: null,
                    error: 'Vehículo no encontrado',
                    title: 'Control de Seguridad - Grupo Argos',
                    username
                });
            }

            const solicitudId = vehiculo[0].solicitud_id;
            const [solicitudDetails] = await connection.execute(QUERIES.SOLICITUD, [solicitudId]);

            if (!solicitudDetails.length) {
                console.log(`Solicitud con ID ${solicitudId} no encontrada`);
                return res.render('seguridad', {
                    solicitud: [],
                    modalData: null,
                    error: 'Solicitud no encontrada',
                    title: 'Control de Seguridad - Grupo Argos',
                    username
                });
            }

            const mensajesAdvertencia = verificarDocumentosVehiculo(vehiculo[0]);
            const mensajeAdvertencia = verificarLugarSolicitud(solicitudDetails[0].nombre_lugar, username);

            // Obtener lista de vehículos
            const [vehiculos] = await connection.execute(`
                ${QUERIES.VEHICULO}
                WHERE v.solicitud_id = ?
            `, [solicitudId]);

            return res.render('seguridad', {
                solicitud: vehiculos,
                modalData: {
                    ...solicitudDetails[0],
                    vehiculos: [{
                        ...vehiculo[0],
                        mensajesAdvertencia: mensajesAdvertencia.length > 0 ? mensajesAdvertencia : null
                    }],
                    advertencia: mensajeAdvertencia
                },
                title: 'Control de Seguridad - Grupo Argos',
                username
            });

        } else {
            // Procesamiento para colaboradores
            const [colaborador] = await connection.execute(
                `${QUERIES.COLABORADOR} WHERE c.id = ?`,
                [entityId, entityId, entityId]
            );

            if (!colaborador.length) {
                console.log(`Colaborador con ID ${entityId} no encontrado`);
                return res.render('seguridad', {
                    solicitud: [],
                    modalData: null,
                    error: 'Colaborador no encontrado',
                    title: 'Control de Seguridad - Grupo Argos',
                    username
                });
            }

            const solicitudId = colaborador[0].solicitud_id;
            const [solicitudDetails] = await connection.execute(QUERIES.SOLICITUD, [solicitudId]);

            if (!solicitudDetails.length) {
                console.log(`Solicitud con ID ${solicitudId} no encontrada`);
                return res.render('seguridad', {
                    solicitud: [],
                    modalData: null,
                    error: 'Solicitud no encontrada',
                    title: 'Control de Seguridad - Grupo Argos',
                    username
                });
            }

            // Determinar estado del Curso SISO
            let cursoSisoEstado = 'No';
            if (colaborador[0].curso_siso_estado) {
                if (colaborador[0].curso_siso_estado === 'APROBADO') {
                    const fechaVencimiento = new Date(colaborador[0].curso_siso_vencimiento);
                    const hoy = new Date();
                    cursoSisoEstado = fechaVencimiento > hoy ? 'Aprobado' : 'Vencido';
                } else {
                    cursoSisoEstado = 'Perdido';
                }
            }

            // Determinar estado de la Plantilla SS
            let plantillaSSEstado = 'No definida';
            if (colaborador[0].plantilla_ss_fin) {
                const fechaFin = new Date(colaborador[0].plantilla_ss_fin);
                const hoy = new Date();
                plantillaSSEstado = fechaFin > hoy ? 'Vigente' : 'Vencida';
            }

            const mensajeAdvertencia = verificarLugarSolicitud(solicitudDetails[0].nombre_lugar, username);

            return res.render('seguridad', {
                solicitud: [],
                modalData: {
                    ...solicitudDetails[0],
                    colaboradores: [{
                        ...colaborador[0],
                        cursoSiso: cursoSisoEstado,
                        plantillaSS: plantillaSSEstado
                    }],
                    advertencia: mensajeAdvertencia
                },
                title: 'Control de Seguridad - Grupo Argos',
                username
            });
        }

    } catch (error) {
        console.error('Error en qrAccesosModal:', error);
        return res.render('seguridad', {
            solicitud: [],
            modalData: null,
            error: 'Error al procesar la solicitud',
            title: 'Control de Seguridad - Grupo Argos',
            username: username || 'Usuario desconocido'
        });
    }
};

const fechaMySQL = moment().tz("America/Bogota").format("YYYY-MM-DD HH:mm:ss");
controller.registrarEntrada = async (req, res) => {
    try {
        console.log('Token recibido:', req.cookies.token);
        const token = req.cookies.token;
        if (!token) return res.redirect('/login');

        const decoded = jwt.verify(token, SECRET_KEY);
        console.log('Token decodificado:', decoded);
        if (decoded.role !== 'seguridad') return res.redirect('/login');

        const { id: userId } = decoded;
        console.log('ID de usuario:', userId);
        const { solicitudId, colaboradores, fecha, estado_actual } = req.body;
        console.log('Datos del cuerpo de la solicitud:', { solicitudId, colaboradores, fecha, estado_actual });

        if (!solicitudId || !colaboradores || colaboradores.length === 0 || !fecha || !estado_actual) {
            return res.status(400).json({ message: 'Datos incompletos en la solicitud.' });
        }

        // Obtener la fecha y hora actual en la zona horaria de Colombia
        const fechaRegistro = moment().tz("America/Bogota").format("YYYY-MM-DD HH:mm:ss");
        console.log('Fecha de registro:', fechaRegistro);

        for (const colaborador of colaboradores) {
            if (!colaborador.id) continue;
            
            const [result] = await connection.execute(
                'INSERT INTO registros (colaborador_id, solicitud_id, usuario_id, tipo, fecha_hora, estado_actual, created_at) VALUES (?, ?, ?, "entrada", ?, ?, ?)',
                [colaborador.id, solicitudId, userId, fecha, estado_actual, fechaRegistro]
            );
            console.log(`[CONTROLLER] Entrada registrada para colaborador_id ${colaborador.id}:`, result);
        }

        res.status(200).json({ message: 'Entrada de colaboradores registrada correctamente' });
    } catch (error) {
        console.error('[CONTROLLER] Error al registrar entrada de colaboradores:', error);
        res.status(500).json({ message: 'Error al registrar la entrada de colaboradores', error });
    }
};

controller.registrarSalida = async (req, res) => {
    try {
        const token = req.cookies.token;
        if (!token) return res.redirect('/login');

        const decoded = jwt.verify(token, SECRET_KEY);
        if (decoded.role !== 'seguridad') return res.redirect('/login');

        const { id: userId } = decoded;
        const { solicitudId, colaboradores, fecha, estado_actual } = req.body;

        if (!solicitudId || !colaboradores || colaboradores.length === 0 || !fecha || !estado_actual) {
            return res.status(400).json({ message: 'Datos incompletos en la solicitud.' });
        }

        // Obtener la fecha y hora actual en la zona horaria de Colombia
        const fechaRegistro = moment().tz("America/Bogota").format("YYYY-MM-DD HH:mm:ss");

        for (const colaborador of colaboradores) {
            if (!colaborador.id) continue;
            
            const [result] = await connection.execute(
                'INSERT INTO registros (colaborador_id, solicitud_id, usuario_id, tipo, fecha_hora, estado_actual, created_at) VALUES (?, ?, ?, "salida", ?, ?, ?)',
                [colaborador.id, solicitudId, userId, fecha, estado_actual, fechaRegistro]
            );
            console.log(`[CONTROLLER] Salida registrada para colaborador_id ${colaborador.id}:`, result);
        }

        res.status(200).json({ message: 'Salida de colaboradores registrada correctamente' });
    } catch (error) {
        console.error('[CONTROLLER] Error al registrar salida de colaboradores:', error);
        res.status(500).json({ message: 'Error al registrar la salida de colaboradores', error });
    }
};

controller.vistaSeguridadDetalle = async (req, res) => {
    const idS = req.params.id;
    try {
        const token = req.cookies.token;

        if (!token) {
            return res.redirect('/login');
        }

        const decoded = jwt.verify(token, SECRET_KEY);
        if (decoded.role !== 'seguridad') {
            return res.redirect('/login');
        }

        const { id, username } = decoded;

        // Obtener todas las solicitudes para la tabla principal
        const [solicitud] = await connection.execute(`
            SELECT 
                s.id, 
                s.empresa, 
                s.nit, 
                s.estado, 
                us.username AS interventor, 
                s.lugar,
                l.nombre_lugar,
                DATE_FORMAT(s.inicio_obra, '%d/%m/%Y') AS inicio_obra,
                DATE_FORMAT(s.fin_obra, '%d/%m/%Y') AS fin_obra,
                CASE
                    WHEN s.estado = 'aprobada' AND CURDATE() > DATE(s.fin_obra) THEN 'pendiente ingreso - vencido'
                    WHEN s.estado = 'aprobada' THEN 'pendiente ingreso'
                    WHEN s.estado = 'en labor' AND CURDATE() > DATE(s.fin_obra) THEN 'en labor - vencida'
                    WHEN s.estado = 'en labor' THEN 'en labor'
                    WHEN s.estado = 'labor detenida' THEN 'labor detenida'
                    ELSE s.estado
                END AS estado_actual
            FROM solicitudes s
            JOIN acciones a ON s.id = a.solicitud_id
            JOIN users us ON us.id = s.interventor_id
            JOIN lugares l ON s.lugar = l.id
            JOIN users seguridad ON l.id = (SELECT id FROM lugares WHERE nombre_lugar = seguridad.username)
            WHERE s.estado IN ('aprobada', 'en labor', 'labor detenida')
            AND a.accion = 'aprobada'
            AND seguridad.role_id = (SELECT id FROM roles WHERE role_name = 'seguridad')
            AND seguridad.id = ?
            ORDER BY s.id DESC
        `, [id]);

        // Obtener detalles de la solicitud específica
        const [solicitudDetails] = await connection.execute(`
            SELECT s.id, s.empresa, s.nit, s.estado, us.username AS interventor,
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
                lugar,
                labor
            FROM solicitudes s
            LEFT JOIN users us ON us.id = s.interventor_id
            LEFT JOIN acciones a ON a.solicitud_id = s.id
            WHERE s.id = ? AND estado IN ('aprobada', 'en labor', 'labor detenida')
            AND a.accion = 'aprobada'
        `, [idS]);

        if (!solicitudDetails.length) {
            return res.status(404).json({ message: 'Solicitud no encontrada' });
        }

        const lugarSolicitud = solicitudDetails[0].lugar;
        const mensajeAdvertencia = lugarSolicitud !== username
            ? 'ADVERTENCIA: El lugar de la solicitud no coincide con tu ubicación. Notifica a la central la novedad.'
            : null;

        // Obtener colaboradores y verificar si todos están inactivos
        const [colaboradores] = await connection.execute(
            'SELECT id, nombre, cedula, foto, estado FROM colaboradores WHERE solicitud_id = ?',
            [idS]
        );

        // Verificar si todos los colaboradores tienen estado = FALSE
        const todosInactivos = colaboradores.length > 0 && colaboradores.every(col => col.estado === false);
        const mensajeEstado = todosInactivos ? 'Todos los colaboradores tienen ingreso cancelado.' : null;

        // Renderizar la vista con los datos
        res.render('seguridad', {
            solicitud,
            modalData: {
                ...solicitudDetails[0],
                colaboradores,
                advertencia: mensajeAdvertencia,
                mensajeEstado // Agregar mensaje si todos están inactivos
            },
            title: 'Control de Seguridad - Grupo Argos',
            username: username
        });

    } catch (error) {
        console.error('Error al procesar la solicitud:', error);
        res.status(500).send('Error interno del servidor');
    }
};

controller.getVehiculoDetalles = async (req, res) => {
    const { id } = req.params;
    console.log(`[CONTROLADOR] Obteniendo detalles del vehículo con ID: ${id}`);

    try {
        // Obtener datos del vehículo
        const [vehiculo] = await connection.execute(
            `
            SELECT 
                v.id, v.solicitud_id, v.matricula, v.foto, v.estado,
                pdv_soat.fecha_inicio AS soat_inicio, pdv_soat.fecha_fin AS soat_fin,
                pdv_tecno.fecha_inicio AS tecnomecanica_inicio, pdv_tecno.fecha_fin AS tecnomecanica_fin,
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
            LEFT JOIN licencias_vehiculo lv_conduccion ON v.id = lv_conduccion.vehiculo_id AND lv_conduccion.tipo = 'licencia_conduccion'
            LEFT JOIN licencias_vehiculo lv_transito ON v.id = lv_transito.vehiculo_id AND lv_transito.tipo = 'licencia_transito'
            WHERE v.id = ?
            `,
            [id]
        );

        if (!vehiculo.length) {
            console.log(`Vehículo con ID ${id} no encontrado`);
            return res.status(404).json({ error: 'Vehículo no encontrado' });
        }

        const solicitudId = vehiculo[0].solicitud_id;

        // Obtener datos de la solicitud asociada
        const [solicitudDetails] = await connection.execute(
            `
            SELECT s.id, s.empresa, s.nit, s.estado, us.username AS interventor,
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
            `,
            [solicitudId]
        );

        if (!solicitudDetails.length) {
            console.log(`Solicitud con ID ${solicitudId} no encontrada`);
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        }

        // Determinar estado de los documentos del vehículo
        const hoy = new Date();
        let mensajesAdvertencia = [];

        // Verificar SOAT
        if (!vehiculo[0].soat_inicio || !vehiculo[0].soat_fin) {
            mensajesAdvertencia.push('SOAT no definido.');
        } else if (new Date(vehiculo[0].soat_fin) < hoy) {
            mensajesAdvertencia.push('SOAT vencido.');
        }

        // Verificar Tecnomecánica
        if (!vehiculo[0].tecnomecanica_inicio || !vehiculo[0].tecnomecanica_fin) {
            mensajesAdvertencia.push('Tecnomecánica no definida.');
        } else if (new Date(vehiculo[0].tecnomecanica_fin) < hoy) {
            mensajesAdvertencia.push('Tecnomecánica vencida.');
        }

        // Verificar Licencias
        if (!vehiculo[0].licencia_conduccion) {
            mensajesAdvertencia.push('Licencia de conducción no aprobada.');
        }
        if (!vehiculo[0].licencia_transito) {
            mensajesAdvertencia.push('Licencia de tránsito no aprobada.');
        }

        // Preparar respuesta
        const respuesta = {
            ...solicitudDetails[0],
            vehiculos: [{
                ...vehiculo[0],
                mensajesAdvertencia: mensajesAdvertencia.length > 0 ? mensajesAdvertencia : null
            }]
        };

        console.log('Enviando respuesta con datos del vehículo');
        res.json(respuesta);

    } catch (error) {
        console.error('Error al obtener detalles del vehículo:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
};

// Función temporal para mostrar las tablas
controller.mostrarTablas = async (req, res) => {
    try {
        console.log('[CONTROLLER] Consultando tablas de la base de datos');
        const [rows] = await connection.execute('SHOW TABLES');
        console.log('[CONTROLLER] Tablas encontradas:', rows);
        res.json(rows);
    } catch (error) {
        console.error('[CONTROLLER] Error al consultar tablas:', error);
        res.status(500).json({ message: 'Error al consultar tablas', error });
    }
};

// Función para crear la tabla de registros de vehículos
/*
// Función para crear la tabla de registros de vehículos
// NO USAR - SOLO PARA REFERENCIA
// Query para crear la tabla:
CREATE TABLE IF NOT EXISTS registros_vehiculos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    vehiculo_id INT NOT NULL,
    solicitud_id INT NOT NULL,
    usuario_id INT NOT NULL,
    tipo ENUM('entrada', 'salida') NOT NULL,
    fecha_hora DATETIME NOT NULL,
    estado_actual VARCHAR(50) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (vehiculo_id) REFERENCES vehiculos(id),
    FOREIGN KEY (solicitud_id) REFERENCES solicitudes(id),
    FOREIGN KEY (usuario_id) REFERENCES users(id)
)
controller.crearTablaRegistrosVehiculos = async (req, res) => {
    try {
        console.log('[CONTROLLER] Creando tabla registros_vehiculos');
        const [result] = await connection.execute(`
            CREATE TABLE IF NOT EXISTS registros_vehiculos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                vehiculo_id INT NOT NULL,
                solicitud_id INT NOT NULL,
                usuario_id INT NOT NULL,
                tipo ENUM('entrada', 'salida') NOT NULL,
                fecha_hora DATETIME NOT NULL,
                estado_actual VARCHAR(50) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (vehiculo_id) REFERENCES vehiculos(id),
                FOREIGN KEY (solicitud_id) REFERENCES solicitudes(id),
                FOREIGN KEY (usuario_id) REFERENCES users(id)
            )
        `);
        console.log('[CONTROLLER] Tabla registros_vehiculos creada:', result);
        res.json({ message: 'Tabla registros_vehiculos creada correctamente' });
    } catch (error) {
        console.error('[CONTROLLER] Error al crear tabla registros_vehiculos:', error);
        res.status(500).json({ message: 'Error al crear la tabla', error });
    }
};
*/

// Función para registrar entrada de vehículos
controller.registrarEntradaVehiculo = async (req, res) => {
    try {
        const token = req.cookies.token;
        if (!token) return res.redirect('/login');

        const decoded = jwt.verify(token, SECRET_KEY);
        if (decoded.role !== 'seguridad') return res.redirect('/login');

        const { id: userId } = decoded;
        const { solicitudId, vehiculos, fecha, estado_actual } = req.body;

        if (!solicitudId || !vehiculos || vehiculos.length === 0 || !fecha || !estado_actual) {
            return res.status(400).json({ message: 'Datos incompletos en la solicitud.' });
        }

        // Obtener la fecha y hora actual en la zona horaria de Colombia
        const fechaRegistro = moment().tz("America/Bogota").format("YYYY-MM-DD HH:mm:ss");

        for (const vehiculo of vehiculos) {
            if (!vehiculo.id) continue;
            
            // Extraer el ID numérico del formato VH-XX
            const vehiculoId = vehiculo.id.replace('VH-', '');
            
            const [result] = await connection.execute(
                'INSERT INTO registros_vehiculos (vehiculo_id, solicitud_id, usuario_id, tipo, fecha_hora, estado_actual, created_at) VALUES (?, ?, ?, "entrada", ?, ?, ?)',
                [vehiculoId, solicitudId, userId, fecha, estado_actual, fechaRegistro]
            );
            console.log(`[CONTROLLER] Entrada registrada para vehiculo_id ${vehiculoId}:`, result);
        }

        res.status(200).json({ message: 'Entrada de vehículos registrada correctamente' });
    } catch (error) {
        console.error('[CONTROLLER] Error al registrar entrada de vehículos:', error);
        res.status(500).json({ message: 'Error al registrar la entrada de vehículos', error });
    }
};

// Función para registrar salida de vehículos
controller.registrarSalidaVehiculo = async (req, res) => {
    try {
        const token = req.cookies.token;
        if (!token) return res.redirect('/login');

        const decoded = jwt.verify(token, SECRET_KEY);
        if (decoded.role !== 'seguridad') return res.redirect('/login');

        const { id: userId } = decoded;
        const { solicitudId, vehiculos, fecha, estado_actual } = req.body;

        if (!solicitudId || !vehiculos || vehiculos.length === 0 || !fecha || !estado_actual) {
            return res.status(400).json({ message: 'Datos incompletos en la solicitud.' });
        }

        // Obtener la fecha y hora actual en la zona horaria de Colombia
        const fechaRegistro = moment().tz("America/Bogota").format("YYYY-MM-DD HH:mm:ss");

        for (const vehiculo of vehiculos) {
            if (!vehiculo.id) continue;
            
            // Extraer el ID numérico del formato VH-XX
            const vehiculoId = vehiculo.id.replace('VH-', '');
            
            const [result] = await connection.execute(
                'INSERT INTO registros_vehiculos (vehiculo_id, solicitud_id, usuario_id, tipo, fecha_hora, estado_actual, created_at) VALUES (?, ?, ?, "salida", ?, ?, ?)',
                [vehiculoId, solicitudId, userId, fecha, estado_actual, fechaRegistro]
            );
            console.log(`[CONTROLLER] Salida registrada para vehiculo_id ${vehiculoId}:`, result);
        }

        res.status(200).json({ message: 'Salida de vehículos registrada correctamente' });
    } catch (error) {
        console.error('[CONTROLLER] Error al registrar salida de vehículos:', error);
        res.status(500).json({ message: 'Error al registrar la salida de vehículos', error });
    }
};

controller.registrarIngreso = async (req, res) => {
    const { id } = req.params;
    const conn = await connection.getConnection();
    
    try {
        await conn.beginTransaction();
        
        // Actualizar el estado de la solicitud a 'en labor'
        await conn.execute(
            'UPDATE solicitudes SET estado = ? WHERE id = ?',
            ['en labor', id]
        );
        
        await conn.commit();
        
        res.json({
            success: true,
            message: 'Solicitud actualizada a "en labor" correctamente'
        });
    } catch (error) {
        await conn.rollback();
        console.error('[CONTROLLER] Error al registrar ingreso:', error);
        res.status(500).json({
            success: false,
            message: 'Error al registrar el ingreso',
            error: error.message
        });
    } finally {
        conn.release();
    }
};
 
controller.obtenerSolicitudesActivasConColaboradoresYVehiculos = async (req, res) => {
    try {
        const token = req.cookies.token;
        if (!token) {
            console.log('No se encontró token en las cookies');
            return res.status(401).json({ message: 'No autorizado' });
        }

        const decoded = jwt.verify(token, SECRET_KEY);
        if (decoded.role !== 'seguridad') {
            console.log('Usuario no tiene rol de seguridad:', decoded.role);
            return res.status(403).json({ message: 'No autorizado' });
        }

        const { id, username } = decoded;

        // Consulta de solicitudes activas
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
        `, [id]);

        console.log('Solicitudes obtenidas:', solicitudes.map(s => ({ id: s.id, estado: s.estado })));

        // Procesar cada solicitud
        for (let solicitud of solicitudes) {
            // Verificación del lugar
            const lugarSolicitud = solicitud.nombre_lugar;
            solicitud.advertencia = lugarSolicitud === 'Supervisor'
                ? null
                : (lugarSolicitud !== username
                    ? 'ADVERTENCIA: El lugar de la solicitud no coincide con tu ubicación. Notifica a la central la novedad.'
                    : null);

            // Obtener todos los colaboradores, activos o no
            const [colaboradores] = await connection.execute(`
                SELECT 
                    c.id,
                    c.nombre,
                    c.cedula,
                    c.foto,
                    c.cedulaFoto,
                    c.estado,
                    rc.estado AS curso_siso_estado,
                    rc.fecha_vencimiento AS curso_siso_vencimiento,
                    pss.fecha_inicio AS plantilla_ss_inicio,
                    pss.fecha_fin AS plantilla_ss_fin,
                    CASE WHEN pss.id IS NOT NULL THEN 1 ELSE 0 END AS has_plantilla_ss
                FROM 
                    colaboradores c
                LEFT JOIN (
                    SELECT rc.colaborador_id, rc.estado, rc.fecha_vencimiento
                    FROM resultados_capacitaciones rc
                    JOIN capacitaciones cap ON rc.capacitacion_id = cap.id
                    WHERE cap.nombre = 'Curso SISO'
                        AND (rc.colaborador_id, rc.created_at) IN (
                            SELECT colaborador_id, MAX(created_at)
                            FROM resultados_capacitaciones
                            WHERE capacitacion_id = cap.id
                            GROUP BY colaborador_id
                        )
                ) rc ON c.id = rc.colaborador_id
                LEFT JOIN (
                    SELECT id, colaborador_id, fecha_inicio, fecha_fin
                    FROM plantilla_seguridad_social pss
                    WHERE (colaborador_id, created_at) IN (
                        SELECT colaborador_id, MAX(created_at)
                        FROM plantilla_seguridad_social
                        GROUP BY colaborador_id
                    )
                ) pss ON c.id = pss.colaborador_id
                WHERE c.solicitud_id = ?
            `, [solicitud.id]);

            console.log(`Colaboradores para solicitud ${solicitud.id}:`, colaboradores.map(c => ({
                id: c.id,
                nombre: c.nombre,
                estado: c.estado,
                curso_siso_estado: c.curso_siso_estado,
                curso_siso_vencimiento: c.curso_siso_vencimiento
            })));

            // Procesar estado de colaboradores
            colaboradores.forEach(col => {
                // Curso SISO
                let cursoSisoEstado = 'No';
                let mensajeCursoSiso = null;
                if (col.curso_siso_estado) {
                    if (col.curso_siso_estado === 'APROBADO') {
                        const fechaVencimiento = new Date(col.curso_siso_vencimiento);
                        const hoy = new Date();
                        cursoSisoEstado = fechaVencimiento > hoy ? 'Aprobado' : 'Vencido';
                        mensajeCursoSiso = cursoSisoEstado === 'Vencido' ? 'Curso SISO vencido.' : null;
                    } else {
                        cursoSisoEstado = 'Perdido';
                        mensajeCursoSiso = 'Curso SISO perdido.';
                    }
                } else {
                    console.log(`Colaborador ${col.id} (${col.nombre}) no tiene Curso SISO:`, {
                        curso_siso_estado: col.curso_siso_estado,
                        curso_siso_vencimiento: col.curso_siso_vencimiento
                    });
                    mensajeCursoSiso = 'No ha realizado el Curso SISO.';
                }

                // Plantilla SS
                let plantillaSSEstado = 'No definida';
                let mensajePlantillaSS = null;
                if (col.has_plantilla_ss && col.plantilla_ss_fin) {
                    const fechaFin = new Date(col.plantilla_ss_fin);
                    const hoy = new Date();
                    plantillaSSEstado = fechaFin > hoy ? 'Vigente' : 'Vencida';
                    mensajePlantillaSS = plantillaSSEstado === 'Vencida' ? 'Plantilla de Seguridad Social vencida.' : null;
                } else {
                    console.log(`Colaborador ${col.id} (${col.nombre}) no tiene plantilla SS:`, {
                        has_plantilla_ss: col.has_plantilla_ss,
                        plantilla_ss_inicio: col.plantilla_ss_inicio,
                        plantilla_ss_fin: col.plantilla_ss_fin
                    });
                    mensajePlantillaSS = 'No se ha definido la Plantilla de Seguridad Social.';
                }

                // Indicador de permiso de ingreso
                col.permisoIngreso = col.estado === 1 ? 'Permitido' : 'No permitido';

                col.cursoSiso = cursoSisoEstado;
                col.plantillaSS = plantillaSSEstado;
                col.mensajeCursoSiso = mensajeCursoSiso;
                col.mensajePlantillaSS = mensajePlantillaSS;
                delete col.has_plantilla_ss; // Eliminar campo auxiliar
            });

            // Obtener vehículos
            const [vehiculos] = await connection.execute(`
                SELECT 
                    v.id,
                    v.matricula,
                    v.foto,
                    v.estado,
                    pdv_soat.fecha_inicio AS soat_inicio,
                    pdv_soat.fecha_fin AS soat_fin,
                    pdv_tecno.fecha_inicio AS tecnomecanica_inicio,
                    pdv_tecno.fecha_fin AS tecnomecanica_fin,
                    lv_conduccion.estado AS licencia_conduccion,
                    lv_transito.estado AS licencia_transito
                FROM 
                    vehiculos v
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
                WHERE 
                    v.solicitud_id = ?
            `, [solicitud.id]);

            console.log(`Vehículos para solicitud ${solicitud.id}:`, vehiculos.map(v => ({
                id: v.id,
                matricula: v.matricula
            })));

            // Procesar estado de vehículos
            vehiculos.forEach(veh => {
                const hoy = new Date();
                let mensajesAdvertencia = [];

                // SOAT
                if (!veh.soat_inicio || !veh.soat_fin) {
                    mensajesAdvertencia.push('SOAT no definido.');
                } else if (new Date(veh.soat_fin) < hoy) {
                    mensajesAdvertencia.push('SOAT vencido.');
                }
                veh.estado_soat = (!veh.soat_inicio || new Date(veh.soat_fin) < hoy) ? 'Vencido' : 'Vigente';

                // Tecnomecánica
                if (!veh.tecnomecanica_inicio || !veh.tecnomecanica_fin) {
                    mensajesAdvertencia.push('Tecnomecánica no definida.');
                } else if (new Date(veh.tecnomecanica_fin) < hoy) {
                    mensajesAdvertencia.push('Tecnomecánica vencida.');
                }
                veh.estado_tecnomecanica = (!veh.tecnomecanica_inicio || new Date(veh.tecnomecanica_fin) < hoy) ? 'Vencida' : 'Vigente';

                // Licencias
                if (!veh.licencia_conduccion) {
                    mensajesAdvertencia.push('Licencia de conducción no aprobada.');
                }
                if (!veh.licencia_transito) {
                    mensajesAdvertencia.push('Licencia de tránsito no aprobada.');
                }

                veh.mensajesAdvertencia = mensajesAdvertencia.length > 0 ? mensajesAdvertencia : null;
            });

            // Agregar colaboradores y vehículos a la solicitud
            solicitud.colaboradores = colaboradores;
            solicitud.vehiculos = vehiculos;

            // Eliminar mensajes generales de restricción
            solicitud.mensajeCursoSiso = null;
            solicitud.mensajePlantillaSS = null;
            solicitud.mensajeVehiculos = null;
        }

        res.json(solicitudes);
    } catch (err) {
        console.error('Error al obtener solicitudes activas:', err.message);
        res.status(500).json({ error: 'Error al obtener las solicitudes activas' });
    }
};

module.exports = controller; 