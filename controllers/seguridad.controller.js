// seguridad.controller.js
const jwt = require('jsonwebtoken');
const connection = require('../db/db');  // Asegúrate de que este connection sea el correcto
const SECRET_KEY = process.env.JWT_SECRET || 'secreto';
const { format } = require('date-fns');  // Importamos la función 'format' de date-fns
const QRCode = require('qrcode');

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
            lugares l ON l.nombre_lugar = s.lugar
        JOIN 
            users seguridad ON l.nombre_lugar = seguridad.username
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
    const { id } = req.params; // ID del colaborador
    try {
        const token = req.cookies.token;
        if (!token) {
            return res.status(401).json({ message: 'No autorizado' });
        }

        const decoded = jwt.verify(token, SECRET_KEY);
        const { username } = decoded;

        // Obtener datos del colaborador por su ID, incluyendo Curso SISO y Plantilla SS
        const [colaborador] = await connection.execute(
            `
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
            WHERE c.id = ?
            `,
            [id, id, id] // Pasamos el ID tres veces: para rc, pss y WHERE principal
        );

        if (!colaborador.length) {
            return res.status(404).json({ message: 'Colaborador no encontrado' });
        }

        const solicitudId = colaborador[0].solicitud_id;

        // Obtener datos de la solicitud asociada
        const [solicitud] = await connection.execute(
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
                lugar,
                labor
            FROM solicitudes s
            LEFT JOIN users us ON us.id = s.interventor_id
            LEFT JOIN acciones a ON a.solicitud_id = s.id
            WHERE s.id = ? AND estado IN ('aprobada', 'en labor', 'labor detenida')
            AND a.accion = 'aprobada'
            `,
            [solicitudId]
        );

        if (!solicitud.length) {
            return res.status(404).json({ message: 'Solicitud no encontrada' });
        }

        // Verificación del lugar
        const lugarSolicitud = solicitud[0].lugar;
        const mensajeAdvertencia = lugarSolicitud === 'Supervisor'
            ? null
            : (lugarSolicitud !== username
                ? 'ADVERTENCIA: El lugar de la solicitud no coincide con tu ubicación. Notifica a la central la novedad.'
                : null);

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

        // Mensajes de advertencia específicos
        let mensajeCursoSiso = null;
        let mensajePlantillaSS = null;

        if (cursoSisoEstado === 'Vencido') {
            mensajeCursoSiso = 'Curso SISO vencido.';
        } else if (cursoSisoEstado === 'Perdido') {
            mensajeCursoSiso = 'Curso SISO perdido.';
        } else if (cursoSisoEstado === 'No') {
            mensajeCursoSiso = 'No ha realizado el Curso SISO.';
        }

        if (plantillaSSEstado === 'Vencida') {
            mensajePlantillaSS = 'Plantilla de Seguridad Social vencida.';
        } else if (plantillaSSEstado === 'No definida') {
            mensajePlantillaSS = 'No se ha definido la Plantilla de Seguridad Social.';
        }

        // Estructura de respuesta ajustada
        res.json({
            id: solicitud[0].id,
            empresa: solicitud[0].empresa,
            lugar: solicitud[0].lugar,
            labor: solicitud[0].labor,
            interventor: solicitud[0].interventor,
            estado_actual: solicitud[0].estado_actual,
            inicio_obra: solicitud[0].inicio_obra,
            fin_obra: solicitud[0].fin_obra,
            advertencia: mensajeAdvertencia,
            mensajeEstado: colaborador[0].estado === 0 ? 'Ingreso cancelado para este colaborador.' : null,
            colaboradores: [{
                ...colaborador[0],
                cursoSiso: cursoSisoEstado,
                plantillaSS: plantillaSSEstado
            }],
            mensajeCursoSiso,
            mensajePlantillaSS,
            username: username
        });
    } catch (error) {
        console.error('Error al obtener los detalles:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

controller.qrAccesosModal = async (req, res) => {
    const { id } = req.params; // ID del colaborador

    try {
        const token = req.cookies.token;
        if (!token) {
            return res.redirect('/login');
        }

        const decoded = jwt.verify(token, SECRET_KEY);
        if (decoded.role !== 'seguridad') {
            return res.redirect('/login');
        }

        const { id: userId, username } = decoded;

        // Paso 1: Obtener datos del colaborador por su ID
        const [colaborador] = await connection.execute(
            `
            SELECT id, solicitud_id, cedula, nombre, foto, cedulaFoto, estado
            FROM colaboradores 
            WHERE id = ?
            `,
            [id]
        );

        if (!colaborador.length) {
            console.log(`Colaborador con ID ${id} no encontrado`);
            return res.redirect('/vista-seguridad');
        }

        const solicitudId = colaborador[0].solicitud_id;

        // Paso 2: Obtener datos de la solicitud asociada
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
                lugar,
                labor
            FROM solicitudes s
            LEFT JOIN users us ON us.id = s.interventor_id
            LEFT JOIN acciones a ON a.solicitud_id = s.id
            WHERE s.id = ? AND estado IN ('aprobada', 'en labor', 'labor detenida')
            AND a.accion = 'aprobada'
            `,
            [solicitudId]
        );

        if (!solicitudDetails.length) {
            console.log(`Solicitud con ID ${solicitudId} no encontrada`);
            return res.redirect('/vista-seguridad');
        }

        // Consulta para 'solicitud' (mantenida por compatibilidad con la vista)
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
            JOIN lugares l ON l.nombre_lugar = s.lugar
            JOIN users seguridad ON l.nombre_lugar = seguridad.username
            WHERE s.estado IN ('aprobada', 'en labor', 'labor detenida')
            AND a.accion = 'aprobada'
            AND seguridad.role_id = (SELECT id FROM roles WHERE role_name = 'seguridad')
            AND seguridad.id = ?
            ORDER BY s.id DESC
        `, [userId]);

        // Verificación del lugar
        const lugarSolicitud = solicitudDetails[0].lugar;
        const mensajeAdvertencia = lugarSolicitud === 'Supervisor'
            ? null
            : (lugarSolicitud !== username
                ? 'ADVERTENCIA: El lugar de la solicitud no coincide con tu ubicación. Notifica a la central la novedad.'
                : null);

        // Solo incluir el colaborador específico
        const colaboradores = [colaborador[0]];

        // Definir estados no permitidos para ingreso, entrada y salida
        const estadosNoPermitidosIngreso = [
            'en labor',
            'en labor - vencida',
            'labor detenida',
            'pendiente ingreso - vencido',
            'en labor - vencida'
        ];

        const estadoActual = solicitudDetails[0].estado_actual;
        const botonesEstado = {
            registrarIngreso: {
                disabled: estadosNoPermitidosIngreso.includes(estadoActual) || (mensajeAdvertencia !== null && lugarSolicitud !== 'Supervisor'),
                text: estadosNoPermitidosIngreso.includes(estadoActual) || (mensajeAdvertencia !== null && lugarSolicitud !== 'Supervisor') ? 'No disponible' : 'Registrar Ingreso'
            },
            registrarEntrada: {
                disabled: (mensajeAdvertencia !== null && lugarSolicitud !== 'Supervisor') || estadoActual === 'pendiente ingreso - vencido' || estadoActual === 'en labor - vencida',
                text: (mensajeAdvertencia !== null && lugarSolicitud !== 'Supervisor') || estadoActual === 'pendiente ingreso - vencido' || estadoActual === 'en labor - vencida' ? 'No disponible' : 'Registrar Entrada'
            },
            registrarSalida: {
                disabled: (mensajeAdvertencia !== null && lugarSolicitud !== 'Supervisor') || estadoActual === 'pendiente ingreso - vencido' || estadoActual === 'en labor - vencida',
                text: (mensajeAdvertencia !== null && lugarSolicitud !== 'Supervisor') || estadoActual === 'pendiente ingreso - vencido' || estadoActual === 'en labor - vencida' ? 'No disponible' : 'Registrar Salida'
            }
        };

        // Respuesta exacta como solicitaste
        res.render('seguridad', {
            solicitud,
            modalData: {
                ...solicitudDetails[0],
                colaboradores,
                advertencia: mensajeAdvertencia,
                botonesEstado
            },
            title: 'Control de Seguridad - Grupo Argos',
            username: username
        });

    } catch (error) {
        console.error('Error al procesar la solicitud:', error);
        res.redirect('/vista-seguridad');
    }
};

  controller.registrarIngreso = async (req, res) => {
    const { id } = req.params;

    try {
        console.log(`[CONTROLLER] Intentando registrar ingreso para solicitud con ID: ${id}`);

        // Obtener el estado actual de la solicitud
        const [rows] = await connection.execute(
            'SELECT estado FROM solicitudes WHERE id = ?',
            [id]
        );

        if (rows.length === 0) {
            console.error('[CONTROLLER] Solicitud no encontrada.');
            return res.status(404).send({ message: 'Solicitud no encontrada' });
        }

        const { estado } = rows[0];

        // Verificar si la solicitud está en estado "labor detenida"
        if (estado === 'labor detenida') {
            console.log('[CONTROLLER] La solicitud está en estado "labor detenida".');
            return res.status(400).send({ message: 'No se puede registrar ingreso para una solicitud con estado "labor detenida".' });
        }

        // Actualizar el estado a "en labor"
        const [result] = await connection.execute(
            'UPDATE solicitudes SET estado = "en labor" WHERE id = ?',
            [id]
        );

        if (result.affectedRows === 0) {
            console.error('[CONTROLLER] Error al actualizar el estado de la solicitud.');
            return res.status(500).send({ message: 'Error al registrar ingreso.' });
        }

        console.log('[CONTROLLER] Solicitud actualizada exitosamente a "en labor".');
        res.status(200).send({ message: 'Ingreso registrado con éxito' });
    } catch (err) {
        console.error('[CONTROLLER] Error al registrar ingreso:', err);
        res.status(500).send({ message: 'Error interno del servidor' });
    }
};





const moment = require('moment-timezone');
const fechaMySQL = moment().tz("America/Bogota").format("YYYY-MM-DD HH:mm:ss");

 
controller.registrarEntrada = async (req, res) => {
    try {
        const token = req.cookies.token;

        if (!token) {
            return res.redirect('/login');
        }

        const decoded = jwt.verify(token, SECRET_KEY);
        if (decoded.role !== 'seguridad') return res.redirect('/login');
 
        const { role, id, username } = decoded;

        const IdUser = id

        const { solicitudId, colaboradores, fecha, estado_actual } = req.body;
        console.log("Cuerpo del registro: ", req.body);

        if (!solicitudId || !colaboradores || colaboradores.length === 0 || !fecha || !estado_actual) {
            console.log('[CONTROLLER] Datos incompletos en la solicitud.');
            return res.status(400).json({ message: 'Datos incompletos en la solicitud.' });
        }

        console.log(`[CONTROLLER] Iniciando registro de entrada para solicitud_id: ${solicitudId}`);
        console.log(`[CONTROLLER] Fecha y hora de entrada: ${fecha}`);

        for (const colaborador of colaboradores) {
            if (!colaborador.id) {
                console.log('[CONTROLLER] ID del colaborador inválido.');
                continue;
            }
            console.log(`[CONTROLLER] Registrando entrada para colaborador_id: ${colaborador.id}`);
            
            const [result] = await connection.execute(
                'INSERT INTO registros (colaborador_id, solicitud_id,usuario_id, tipo, fecha_hora, estado_actual, created_at) VALUES (?, ?, ?, "entrada", ?,?,?)',
                [colaborador.id, solicitudId, IdUser, fecha, estado_actual, fechaMySQL]
            );
            console.log(`[CONTROLLER] Resultado de la inserción para colaborador_id ${colaborador.id}:`, result);
        }
        
        console.log('[CONTROLLER] Entradas registradas correctamente');
        res.status(200).json({ message: 'Entrada registrada correctamente' });
    } catch (error) {
        console.error('[CONTROLLER] Error al registrar entrada:', error);
        res.status(500).json({ message: 'Error al registrar la entrada', error });
    }
};

controller.registrarSalida = async (req, res) => {
    try {
        const token = req.cookies.token;

        if (!token) {
            return res.redirect('/login');
        }
        
        const decoded = jwt.verify(token, SECRET_KEY);
        if (decoded.role !== 'seguridad') return res.redirect('/login');
 
        const { role, id, username } = decoded;
        const IdUser = id;
        
        const { solicitudId, colaboradores, fecha, estado_actual } = req.body;
        const fechaMySQL = moment().tz("America/Bogota").format("YYYY-MM-DD HH:mm:ss"); // Definir aquí fechaMySQL

        console.log("Cuerpo del registro: ", req.body);

        if (!solicitudId || !colaboradores || colaboradores.length === 0 || !fecha || !estado_actual) {
            console.log('[CONTROLLER] Datos incompletos en la solicitud.');
            return res.status(400).json({ message: 'Datos incompletos en la solicitud.' });
        }

        console.log(`[CONTROLLER] Iniciando registro de salida para solicitud_id: ${solicitudId}`);
        console.log(`[CONTROLLER] Fecha y hora de salida: ${fecha}`);

        for (const colaborador of colaboradores) {
            if (!colaborador.id) {
                console.log('[CONTROLLER] ID del colaborador inválido.');
                continue;
            }
            console.log(`[CONTROLLER] Registrando salida para colaborador_id: ${colaborador.id}`);

            const [result] = await connection.execute(
                'INSERT INTO registros (colaborador_id, solicitud_id, usuario_id, tipo, fecha_hora, estado_actual, created_at) VALUES (?, ?, ?, "salida", ?, ?, ?)',
                [colaborador.id, solicitudId, IdUser, fecha, estado_actual, fechaMySQL]
            );
            console.log(`[CONTROLLER] Resultado de la inserción para colaborador_id ${colaborador.id}:`, result);
        }
        
        console.log('[CONTROLLER] Salidas registradas correctamente');
        res.status(200).json({ message: 'Salida registrada correctamente' });
    } catch (error) {
        console.error('[CONTROLLER] Error al registrar salida:', error);
        res.status(500).json({ message: 'Error al registrar la salida', error });
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
            JOIN lugares l ON l.nombre_lugar = s.lugar
            JOIN users seguridad ON l.nombre_lugar = seguridad.username
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

module.exports = controller; 