const jwt = require('jsonwebtoken');
const connection = require('../db/db');
const moment = require('moment-timezone');

const controller = {};

// Obtener solicitudes activas
controller.obtenerSolicitudesActivas = async (req, res) => {
  const { id: userId, username } = req.user;
  const logPrefix = `[${new Date().toISOString()}] Solicitudes activas (Usuario: ${username}, ID: ${userId})`;

  try {
    console.info(`${logPrefix} - Iniciando consulta de solicitudes activas...`);

    const query = `
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
      FROM solicitudes s
      JOIN acciones a ON s.id = a.solicitud_id
      JOIN users us ON us.id = s.interventor_id
      JOIN lugares l ON s.lugar = l.id
      WHERE s.estado IN ('aprobada', 'en labor', 'labor detenida')
        AND a.accion = 'aprobada'
        AND EXISTS (
          SELECT 1 
          FROM users seguridad 
          WHERE seguridad.id = ? 
          AND seguridad.role_id = (SELECT id FROM roles WHERE role_name = 'seguridad')
        )
      ORDER BY s.id DESC
    `;
    console.info(`${logPrefix} - Ejecutando consulta: ${query.replace(/\n\s+/g, ' ').trim()}`);
    console.info(`${logPrefix} - Parámetros: [${userId}]`);

    const [solicitudes] = await connection.execute(query, [userId]);

    console.info(`${logPrefix} - Consulta exitosa. Registros obtenidos: ${solicitudes.length}`);
    res.json({
      success: true,
      data: solicitudes,
      message: `Se obtuvieron ${solicitudes.length} solicitudes activas`
    });
  } catch (error) {
    console.error(`${logPrefix} - Error en consulta: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Error al obtener solicitudes activas',
      code: 'INTERNAL_ERROR'
    });
  }
};

// Obtener detalles de una solicitud
controller.obtenerDetallesSolicitud = async (req, res) => {
  const { id } = req.params;
  const { username, id: userId } = req.user;
  const logPrefix = `[${new Date().toISOString()}] Detalles solicitud ${id} (Usuario: ${username}, ID: ${userId})`;

  try {
    console.info(`${logPrefix} - Iniciando consulta de detalles...`);

    // Validar ID
    if (!/^\d+$/.test(id)) {
      console.warn(`${logPrefix} - ID inválido: ${id}`);
      return res.status(400).json({
        success: false,
        error: 'ID de solicitud inválido',
        code: 'BAD_REQUEST'
      });
    }

    const solicitudQuery = `
      SELECT 
        s.id, s.empresa, s.nit, s.estado, us.username AS interventor,
        DATE_FORMAT(s.inicio_obra, '%Y-%m-%d') AS inicio_obra,
        DATE_FORMAT(s.fin_obra, '%Y-%m-%d') AS fin_obra,
        CASE
          WHEN s.estado = 'aprobada' AND CURDATE() > s.fin_obra THEN 'pendiente ingreso - vencido'
          WHEN s.estado = 'aprobada' THEN 'pendiente ingreso'
          WHEN s.estado = 'en labor' AND CURDATE() > s.fin_obra THEN 'en labor - vencida'
          WHEN s.estado = 'en labor' THEN 'en labor'
          WHEN s.estado = 'labor detenida' THEN 'labor detenida'
          ELSE s.estado
        END AS estado_actual,
        l.nombre_lugar,
        s.labor
      FROM solicitudes s
      LEFT JOIN users us ON us.id = s.interventor_id
      LEFT JOIN acciones a ON a.solicitud_id = s.id
      LEFT JOIN lugares l ON s.lugar = l.id
      WHERE s.id = ? AND s.estado IN ('aprobada', 'en labor', 'labor detenida')
      AND a.accion = 'aprobada'
    `;
    console.info(`${logPrefix} - Ejecutando consulta de solicitud: ${solicitudQuery.replace(/\n\s+/g, ' ').trim()}`);
    console.info(`${logPrefix} - Parámetros: [${id}]`);

    const [solicitudDetails] = await connection.execute(solicitudQuery, [id]);

    if (!solicitudDetails.length) {
      console.warn(`${logPrefix} - No se encontró la solicitud`);
      return res.status(404).json({
        success: false,
        error: 'Solicitud no encontrada',
        code: 'NOT_FOUND'
      });
    }

    console.info(`${logPrefix} - Solicitud encontrada: ${JSON.stringify(solicitudDetails[0])}`);

    const colaboradoresQuery = `
      SELECT 
        c.id, c.nombre, c.cedula, c.foto, c.estado,
        rc.estado AS capacitacion_estado,
        DATE_FORMAT(rc.fecha_vencimiento, '%Y-%m-%d') AS capacitacion_vencimiento,
        DATE_FORMAT(pss.fecha_inicio, '%Y-%m-%d') AS plantilla_ss_inicio,
        DATE_FORMAT(pss.fecha_fin, '%Y-%m-%d') AS plantilla_ss_fin
      FROM colaboradores c
      LEFT JOIN (
        SELECT rc.colaborador_id, rc.estado, rc.fecha_vencimiento
        FROM resultados_capacitaciones rc
        JOIN capacitaciones cap ON rc.capacitacion_id = cap.id
        WHERE cap.nombre = 'Capacitación SATOR'
        ORDER BY rc.created_at DESC LIMIT 1
      ) rc ON c.id = rc.colaborador_id
      LEFT JOIN (
        SELECT colaborador_id, fecha_inicio, fecha_fin
        FROM plantilla_seguridad_social
        ORDER BY created_at DESC LIMIT 1
      ) pss ON c.id = pss.colaborador_id
      WHERE c.solicitud_id = ?
    `;
    console.info(`${logPrefix} - Ejecutando consulta de colaboradores: ${colaboradoresQuery.replace(/\n\s+/g, ' ').trim()}`);
    console.info(`${logPrefix} - Parámetros: [${id}]`);

    const [colaboradores] = await connection.execute(colaboradoresQuery, [id]);
    console.info(`${logPrefix} - Colaboradores obtenidos: ${colaboradores.length}`);

    const vehiculosQuery = `
      SELECT 
        v.id, v.matricula, v.foto, v.estado,
        DATE_FORMAT(pdv_soat.fecha_inicio, '%Y-%m-%d') AS soat_inicio,
        DATE_FORMAT(pdv_soat.fecha_fin, '%Y-%m-%d') AS soat_fin,
        DATE_FORMAT(pdv_tecno.fecha_inicio, '%Y-%m-%d') AS tecnomecanica_inicio,
        DATE_FORMAT(pdv_tecno.fecha_fin, '%Y-%m-%d') AS tecnomecanica_fin,
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
    `;
    console.info(`${logPrefix} - Ejecutando consulta de vehículos: ${vehiculosQuery.replace(/\n\s+/g, ' ').trim()}`);
    console.info(`${logPrefix} - Parámetros: [${id}]`);

    const [vehiculos] = await connection.execute(vehiculosQuery, [id]);
    console.info(`${logPrefix} - Vehículos obtenidos: ${vehiculos.length}`);

    res.json({
      success: true,
      data: {
        ...solicitudDetails[0],
        colaboradores,
        vehiculos
      },
      message: `Detalles de solicitud ${id} obtenidos correctamente`
    });
  } catch (error) {
    console.error(`${logPrefix} - Error en consulta: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Error al obtener detalles de la solicitud',
      code: 'INTERNAL_ERROR'
    });
  }
};

// Registrar entrada de colaborador
controller.registrarEntradaColaborador = async (req, res) => {
  const { id: userId, username } = req.user;
  const { id: solicitudId } = req.params;
  const { colaboradores, fecha, estado_actual } = req.body;
  const logPrefix = `[${new Date().toISOString()}] Entrada colaboradores solicitud ${solicitudId} (Usuario: ${username}, ID: ${userId})`;

  try {
    console.info(`${logPrefix} - Iniciando registro de entrada...`);
    console.info(`${logPrefix} - Datos recibidos: ${JSON.stringify({ colaboradores, fecha, estado_actual })}`);

    // Validaciones
    if (!colaboradores?.length || !fecha || !estado_actual) {
      console.warn(`${logPrefix} - Datos incompletos`);
      return res.status(400).json({
        success: false,
        error: 'Datos incompletos',
        code: 'BAD_REQUEST'
      });
    }

    // Validar formato de fecha
    if (!moment(fecha, 'YYYY-MM-DD HH:mm:ss', true).isValid()) {
      console.warn(`${logPrefix} - Formato de fecha inválido: ${fecha}`);
      return res.status(400).json({
        success: false,
        error: 'Formato de fecha inválido',
        code: 'BAD_REQUEST'
      });
    }

    const fechaRegistro = moment().tz("America/Bogota").format("YYYY-MM-DD HH:mm:ss");
    console.info(`${logPrefix} - Fecha de registro: ${fechaRegistro}`);

    let registrados = 0;
    for (const colaborador of colaboradores) {
      if (!colaborador.id || !/^\d+$/.test(colaborador.id)) {
        console.warn(`${logPrefix} - ID de colaborador inválido: ${colaborador.id}`);
        continue;
      }

      const query = `
        INSERT INTO registros (colaborador_id, solicitud_id, usuario_id, tipo, fecha_hora, estado_actual, created_at, usuario_registro)
        VALUES (?, ?, ?, "entrada", ?, ?, ?, ?)
      `;
      const params = [colaborador.id, solicitudId, userId, fecha, estado_actual, fechaRegistro, username];
      console.info(`${logPrefix} - Ejecutando inserción: ${query.replace(/\n\s+/g, ' ').trim()}`);
      console.info(`${logPrefix} - Parámetros: ${JSON.stringify(params)}`);

      await connection.execute(query, params);
      console.info(`${logPrefix} - Entrada registrada para colaborador ${colaborador.id}`);
      registrados++;
    }

    if (registrados === 0) {
      console.warn(`${logPrefix} - No se registraron entradas (ningún colaborador válido)`);
      return res.status(400).json({
        success: false,
        error: 'No se registraron entradas: colaboradores inválidos',
        code: 'BAD_REQUEST'
      });
    }

    res.json({
      success: true,
      message: `Se registraron ${registrados} entradas de colaboradores correctamente`
    });
  } catch (error) {
    console.error(`${logPrefix} - Error en registro: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Error al registrar entrada de colaboradores',
      code: 'INTERNAL_ERROR'
    });
  }
};

// Registrar salida de colaborador
controller.registrarSalidaColaborador = async (req, res) => {
  const { id: userId, username } = req.user;
  const { id: solicitudId } = req.params;
  const { colaboradores, fecha, estado_actual } = req.body;
  const logPrefix = `[${new Date().toISOString()}] Salida colaboradores solicitud ${solicitudId} (Usuario: ${username}, ID: ${userId})`;

  try {
    console.info(`${logPrefix} - Iniciando registro de salida...`);
    console.info(`${logPrefix} - Datos recibidos: ${JSON.stringify({ colaboradores, fecha, estado_actual })}`);

    // Validaciones
    if (!colaboradores?.length || !fecha || !estado_actual) {
      console.warn(`${logPrefix} - Datos incompletos`);
      return res.status(400).json({
        success: false,
        error: 'Datos incompletos',
        code: 'BAD_REQUEST'
      });
    }

    // Validar formato de fecha
    if (!moment(fecha, 'YYYY-MM-DD HH:mm:ss', true).isValid()) {
      console.warn(`${logPrefix} - Formato de fecha inválido: ${fecha}`);
      return res.status(400).json({
        success: false,
        error: 'Formato de fecha inválido',
        code: 'BAD_REQUEST'
      });
    }

    const fechaRegistro = moment().tz("America/Bogota").format("YYYY-MM-DD HH:mm:ss");
    console.info(`${logPrefix} - Fecha de registro: ${fechaRegistro}`);

    let registrados = 0;
    for (const colaborador of colaboradores) {
      if (!colaborador.id || !/^\d+$/.test(colaborador.id)) {
        console.warn(`${logPrefix} - ID de colaborador inválido: ${colaborador.id}`);
        continue;
      }

      const query = `
        INSERT INTO registros (colaborador_id, solicitud_id, usuario_id, tipo, fecha_hora, estado_actual, created_at, usuario_registro)
        VALUES (?, ?, ?, "salida", ?, ?, ?, ?)
      `;
      const params = [colaborador.id, solicitudId, userId, fecha, estado_actual, fechaRegistro, username];
      console.info(`${logPrefix} - Ejecutando inserción: ${query.replace(/\n\s+/g, ' ').trim()}`);
      console.info(`${logPrefix} - Parámetros: ${JSON.stringify(params)}`);

      await connection.execute(query, params);
      console.info(`${logPrefix} - Salida registrada para colaborador ${colaborador.id}`);
      registrados++;
    }

    if (registrados === 0) {
      console.warn(`${logPrefix} - No se registraron salidas (ningún colaborador válido)`);
      return res.status(400).json({
        success: false,
        error: 'No se registraron salidas: colaboradores inválidos',
        code: 'BAD_REQUEST'
      });
    }

    res.json({
      success: true,
      message: `Se registraron ${registrados} salidas de colaboradores correctamente`
    });
  } catch (error) {
    console.error(`${logPrefix} - Error en registro: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Error al registrar salida de colaboradores',
      code: 'INTERNAL_ERROR'
    });
  }
};

// Registrar entrada de vehículo
controller.registrarEntradaVehiculo = async (req, res) => {
  const { id: userId, username } = req.user;
  const { id: solicitudId } = req.params;
  const { vehiculos, fecha, estado_actual } = req.body;
  const logPrefix = `[${new Date().toISOString()}] Entrada vehículos solicitud ${solicitudId} (Usuario: ${username}, ID: ${userId})`;

  try {
    console.info(`${logPrefix} - Iniciando registro de entrada...`);
    console.info(`${logPrefix} - Datos recibidos: ${JSON.stringify({ vehiculos, fecha, estado_actual })}`);

    // Validaciones
    if (!vehiculos?.length || !fecha || !estado_actual) {
      console.warn(`${logPrefix} - Datos incompletos`);
      return res.status(400).json({
        success: false,
        error: 'Datos incompletos',
        code: 'BAD_REQUEST'
      });
    }

    // Validar formato de fecha
    if (!moment(fecha, 'YYYY-MM-DD HH:mm:ss', true).isValid()) {
      console.warn(`${logPrefix} - Formato de fecha inválido: ${fecha}`);
      return res.status(400).json({
        success: false,
        error: 'Formato de fecha inválido',
        code: 'BAD_REQUEST'
      });
    }

    const fechaRegistro = moment().tz("America/Bogota").format("YYYY-MM-DD HH:mm:ss");
    console.info(`${logPrefix} - Fecha de registro: ${fechaRegistro}`);

    let registrados = 0;
    for (const vehiculo of vehiculos) {
      if (!vehiculo.id) {
        console.warn(`${logPrefix} - ID de vehículo inválido: ${vehiculo.id}`);
        continue;
      }

      const vehiculoId = vehiculo.id.replace('VH-', '');
      if (!/^\d+$/.test(vehiculoId)) {
        console.warn(`${logPrefix} - ID de vehículo inválido tras limpieza: ${vehiculoId}`);
        continue;
      }

      const query = `
        INSERT INTO registros_vehiculos (vehiculo_id, solicitud_id, usuario_id, tipo, fecha_hora, estado_actual, created_at, usuario_registro)
        VALUES (?, ?, ?, "entrada", ?, ?, ?, ?)
      `;
      const params = [vehiculoId, solicitudId, userId, fecha, estado_actual, fechaRegistro, username];
      console.info(`${logPrefix} - Ejecutando inserción: ${query.replace(/\n\s+/g, ' ').trim()}`);
      console.info(`${logPrefix} - Parámetros: ${JSON.stringify(params)}`);

      await connection.execute(query, params);
      console.info(`${logPrefix} - Entrada registrada para vehículo ${vehiculoId}`);
      registrados++;
    }

    if (registrados === 0) {
      console.warn(`${logPrefix} - No se registraron entradas (ningún vehículo válido)`);
      return res.status(400).json({
        success: false,
        error: 'No se registraron entradas: vehículos inválidos',
        code: 'BAD_REQUEST'
      });
    }

    res.json({
      success: true,
      message: `Se registraron ${registrados} entradas de vehículos correctamente`
    });
  } catch (error) {
    console.error(`${logPrefix} - Error en registro: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Error al registrar entrada de vehículos',
      code: 'INTERNAL_ERROR'
    });
  }
};

// Registrar salida de vehículo
controller.registrarSalidaVehiculo = async (req, res) => {
  const { id: userId, username } = req.user;
  const { id: solicitudId } = req.params;
  const { vehiculos, fecha, estado_actual } = req.body;
  const logPrefix = `[${new Date().toISOString()}] Salida vehículos solicitud ${solicitudId} (Usuario: ${username}, ID: ${userId})`;

  try {
    console.info(`${logPrefix} - Iniciando registro de salida...`);
    console.info(`${logPrefix} - Datos recibidos: ${JSON.stringify({ vehiculos, fecha, estado_actual })}`);

    // Validaciones
    if (!vehiculos?.length || !fecha || !estado_actual) {
      console.warn(`${logPrefix} - Datos incompletos`);
      return res.status(400).json({
        success: false,
        error: 'Datos incompletos',
        code: 'BAD_REQUEST'
      });
    }

    // Validar formato de fecha
    if (!moment(fecha, 'YYYY-MM-DD HH:mm:ss', true).isValid()) {
      console.warn(`${logPrefix} - Formato de fecha inválido: ${fecha}`);
      return res.status(400).json({
        success: false,
        error: 'Formato de fecha inválido',
        code: 'BAD_REQUEST'
      });
    }

    const fechaRegistro = moment().tz("America/Bogota").format("YYYY-MM-DD HH:mm:ss");
    console.info(`${logPrefix} - Fecha de registro: ${fechaRegistro}`);

    let registrados = 0;
    for (const vehiculo of vehiculos) {
      if (!vehiculo.id) {
        console.warn(`${logPrefix} - ID de vehículo inválido: ${vehiculo.id}`);
        continue;
      }

      const vehiculoId = vehiculo.id.replace('VH-', '');
      if (!/^\d+$/.test(vehiculoId)) {
        console.warn(`${logPrefix} - ID de vehículo inválido tras limpieza: ${vehiculoId}`);
        continue;
      }

      const query = `
        INSERT INTO registros_vehiculos (vehiculo_id, solicitud_id, usuario_id, tipo, fecha_hora, estado_actual, created_at, usuario_registro)
        VALUES (?, ?, ?, "salida", ?, ?, ?, ?)
      `;
      const params = [vehiculoId, solicitudId, userId, fecha, estado_actual, fechaRegistro, username];
      console.info(`${logPrefix} - Ejecutando inserción: ${query.replace(/\n\s+/g, ' ').trim()}`);
      console.info(`${logPrefix} - Parámetros: ${JSON.stringify(params)}`);

      await connection.execute(query, params);
      console.info(`${logPrefix} - Salida registrada para vehículo ${vehiculoId}`);
      registrados++;
    }

    if (registrados === 0) {
      console.warn(`${logPrefix} - No se registraron salidas (ningún vehículo válido)`);
      return res.status(400).json({
        success: false,
        error: 'No se registraron salidas: vehículos inválidos',
        code: 'BAD_REQUEST'
      });
    }

    res.json({
      success: true,
      message: `Se registraron ${registrados} salidas de vehículos correctamente`
    });
  } catch (error) {
    console.error(`${logPrefix} - Error en registro: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Error al registrar salida de vehículos',
      code: 'INTERNAL_ERROR'
    });
  }
};

// Obtener historial de registros
controller.obtenerHistorialRegistros = async (req, res) => {
  const { id: solicitudId } = req.params;
  const { username, id: userId } = req.user;
  const logPrefix = `[${new Date().toISOString()}] Historial solicitud ${solicitudId} (Usuario: ${username}, ID: ${userId})`;

  try {
    console.info(`${logPrefix} - Iniciando consulta de historial...`);

    // Validar ID
    if (!/^\d+$/.test(solicitudId)) {
      console.warn(`${logPrefix} - ID inválido: ${solicitudId}`);
      return res.status(400).json({
        success: false,
        error: 'ID de solicitud inválido',
        code: 'BAD_REQUEST'
      });
    }

    const colaboradoresQuery = `
      SELECT 
        r.id,
        r.colaborador_id,
        c.nombre,
        c.cedula,
        r.tipo,
        DATE_FORMAT(r.fecha_hora, '%Y-%m-%d %H:%i:%s') AS fecha_hora,
        r.estado_actual,
        r.usuario_registro
      FROM registros r
      JOIN colaboradores c ON r.colaborador_id = c.id
      WHERE r.solicitud_id = ?
      ORDER BY r.fecha_hora DESC
    `;
    console.info(`${logPrefix} - Ejecutando consulta de historial de colaboradores: ${colaboradoresQuery.replace(/\n\s+/g, ' ').trim()}`);
    console.info(`${logPrefix} - Parámetros: [${solicitudId}]`);

    const [historialColaboradores] = await connection.execute(colaboradoresQuery, [solicitudId]);
    console.info(`${logPrefix} - Registros de colaboradores obtenidos: ${historialColaboradores.length}`);

    const vehiculosQuery = `
      SELECT 
        r.id,
        r.vehiculo_id,
        v.matricula,
        r.tipo,
        DATE_FORMAT(r.fecha_hora, '%Y-%m-%d %H:%i:%s') AS fecha_hora,
        r.estado_actual,
        r.usuario_registro
      FROM registros_vehiculos r
      JOIN vehiculos v ON r.vehiculo_id = v.id
      WHERE r.solicitud_id = ?
      ORDER BY r.fecha_hora DESC
    `;
    console.info(`${logPrefix} - Ejecutando consulta de historial de vehículos: ${vehiculosQuery.replace(/\n\s+/g, ' ').trim()}`);
    console.info(`${logPrefix} - Parámetros: [${solicitudId}]`);

    const [historialVehiculos] = await connection.execute(vehiculosQuery, [solicitudId]);
    console.info(`${logPrefix} - Registros de vehículos obtenidos: ${historialVehiculos.length}`);

    res.json({
      success: true,
      data: {
        colaboradores: historialColaboradores,
        vehiculos: historialVehiculos
      },
      message: `Historial obtenido correctamente (${historialColaboradores.length} colaboradores, ${historialVehiculos.length} vehículos)`
    });
  } catch (error) {
    console.error(`${logPrefix} - Error en consulta: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Error al obtener historial de registros',
      code: 'INTERNAL_ERROR'
    });
  }
};

module.exports = controller;