// contratista.controller.js
const express = require('express'); 
const path = require('path');
const connection = require('../db/db'); // Database connection
const jwt = require('jsonwebtoken');
const SECRET_KEY = process.env.JWT_SECRET || 'secreto';

const controller = {};

controller.vistaContratista = async (req, res) => {
  console.log('[CONTROLADOR] Procesando vista del contratista');

  const token = req.cookies.token;
  let userId = null;
  
  if (token) {
    try {
      const decoded = jwt.verify(token, SECRET_KEY);
      userId = decoded.id; // El ID del usuario en el token
      console.log("ID del usuario desde token:", userId);
    } catch (err) {
      console.error("Error al decodificar token:", err);
      return res.redirect('/logout');
    }
  } else {
    console.log("No se encontró token");
    return res.redirect('/logout');
  }

  try {
    console.log('[CONTROLADOR] Obteniendo solicitudes del contratista');

    const query = `
      SELECT 
      s.id, 
      s.empresa, 
      s.nit, 
      DATE_FORMAT(s.inicio_obra, '%d/%m/%Y') AS inicio_obra, 
      DATE_FORMAT(s.fin_obra, '%d/%m/%Y') AS fin_obra, 
      s.dias_trabajo, 
      s.estado, 
      a.accion, 
      a.comentario, 
      s.lugar,
      l.nombre_lugar,
      s.labor,
      us.username AS interventor,
      CASE
          WHEN s.estado = 'aprobada' AND a.accion = 'pendiente' THEN 'aprobado por sst'  -- Solicitud aprobada y acción pendiente
          WHEN s.estado = 'aprobada' AND a.accion = 'aprobada' THEN 'pendiente ingreso'  -- Solicitud y acción ambas aprobadas
          WHEN s.estado = 'aprobada' AND CURDATE() > DATE(s.fin_obra) THEN 'pendiente ingreso - vencido'
          WHEN s.estado = 'en labor' AND CURDATE() > DATE(s.fin_obra) THEN 'en labor - vencida'
          WHEN s.estado = 'en labor' THEN 'en labor'
          WHEN s.estado = 'labor detenida' THEN 'labor detenida'
          ELSE s.estado
      END AS estado_actual
  FROM solicitudes s
  LEFT JOIN acciones a ON s.id = a.solicitud_id
  LEFT JOIN users us ON us.id = s.interventor_id
  LEFT JOIN lugares l ON s.lugar = l.id
  WHERE s.usuario_id = ?
  ORDER BY s.id DESC;
    `;

    // Obtener las URLs de los documentos (si existen)
    const [solicitud_url_download] = await connection.execute('SELECT * FROM sst_documentos WHERE solicitud_id IN (SELECT id FROM solicitudes)');

    const [solicitudes] = await connection.execute(query, [userId]);

    console.log('[CONTROLADOR] Solicitudes obtenidas:', solicitudes);

    const [userDetails] = await connection.query('SELECT empresa, nit FROM users WHERE id = ?', [userId]);
    
    const [lugares] = await connection.query('SELECT id, nombre_lugar FROM lugares ORDER BY nombre_lugar ASC');
    
    const [Usersinterventores] = await connection.execute(` 
      SELECT id, username FROM users WHERE role_id = (SELECT id FROM roles WHERE role_name = 'interventor')
    `);

    const empresa = userDetails.length > 0 ? userDetails[0].empresa : '';
    const nit = userDetails.length > 0 ? userDetails[0].nit : '';
    const interventores =  Usersinterventores.length > 0 ? Usersinterventores : '';

    // Renderizar la vista incluyendo el ID del usuario
    res.render('contratista', {
        title: 'Contratista - Grupo Argos',
        solicitudes,
        empresa,
        nit,
        interventores: Array.isArray(interventores) ? interventores : [], 
        lugares,
        solicitud_url_download: solicitud_url_download,
        userId: userId,
        interventores: interventores,
        empresa: empresa,
        nit: nit
    });
  } catch (error) {
      console.error('[CONTROLADOR] Error:', error);
      res.status(500).send('Error al procesar la solicitud');
  }
};

 

controller.obtenerSolicitudes = (req, res) => {
  console.log('[CONTROLADOR] Se está procesando la visualización de las solicitudes');

  const token = req.cookies.token;
  console.log('[CONTROLADOR] Token recibido desde las cookies:', token);

  if (!token) {
      console.log('[CONTROLADOR] No se encontró el token, redirigiendo a login');
      return res.redirect('/login');
  }

  jwt.verify(token, SECRET_KEY, (err, decoded) => {
      if (err) {
          console.log('[CONTROLADOR] Error al verificar el token:', err);
          return res.redirect('/login');
      }

      console.log('[CONTROLADOR] Token verificado correctamente:');

      const { id: usuarioId } = decoded;  // Obtener el ID del usuario desde el token

      // Consultar todas las solicitudes de este usuario
      const query = `
          SELECT s.id, s.empresa, s.nit, s.inicio_obra, s.fin_obra, s.dias_trabajo, s.estado, 
                 a.accion, a.comentario
          FROM solicitudes s
          LEFT JOIN acciones a ON s.id = a.solicitud_id
          WHERE s.usuario_id = ?`;
          

      connection.execute(query, [usuarioId])
          .then(result => {
              const solicitudes = result[0];
              console.log('[CONTROLADOR] Solicitudes obtenidas:');

              // Aquí pasamos las solicitudes obtenidas al renderizar la vista
              res.render('solicitudes', { 
                  title: 'Mis Solicitudes - Grupo Argos', 
                  solicitudes 
              });
          })
          .catch(err => {
              console.error('[CONTROLADOR] Error al obtener las solicitudes:', err);
              res.status(500).json({ message: 'Error al obtener las solicitudes' });
          });
  });
};

controller.eliminarColaborador = async (req, res) => {
    const { colaboradorId } = req.body; // ID del colaborador a eliminar
    try {
        const query = 'UPDATE colaboradores SET estado = false WHERE id = ?';
        await connection.execute(query, [colaboradorId]);
        res.status(200).json({ message: 'Colaborador eliminado correctamente' });
    } catch (error) {
        console.error('Error al eliminar colaborador:', error);
        res.status(500).json({ error: 'Error al eliminar colaborador' });
    }
};


// Obtener datos de una solicitud (asumiendo que ya existe)
controller.getSolicitudData = async (req, res) => {
    const { id } = req.params;
    try {
      const [solicitud] = await connection.execute(
        'SELECT * FROM solicitudes WHERE id = ?',
        [id]
      );
      const [colaboradores] = await connection.execute(
        'SELECT id, nombre, cedula, foto, cedulaFoto FROM colaboradores WHERE solicitud_id = ? AND estado = true',
        [id]
      );
      res.json({ solicitud: solicitud[0], colaboradores });
    } catch (error) {
      console.error('Error fetching solicitud data:', error);
      res.status(500).json({ message: 'Error fetching solicitud data' });
    }
  };
  
  // Nueva función: Obtener colaboradores deshabilitados
  controller.getDisabledCollaborators = async (req, res) => {
    const { id } = req.params; // id de la solicitud
    try {
        const [colaboradores] = await connection.execute(`
            SELECT 
                c.id, 
                c.nombre, 
                c.cedula,
                c.estado,
                COALESCE(
                    (
                        SELECT CONCAT(
                            DATE_FORMAT(pss.fecha_inicio, '%d/%m/%Y'),
                            ' - ',
                            DATE_FORMAT(pss.fecha_fin, '%d/%m/%Y')
                        )
                        FROM plantilla_seguridad_social pss 
                        WHERE pss.colaborador_id = c.id 
                        AND pss.solicitud_id = c.solicitud_id
                        ORDER BY pss.fecha_fin DESC 
                        LIMIT 1
                    ),
                    'No definida'
                ) as plantilla_ss,
                (SELECT 
                    CASE 
                        WHEN rc.estado = 'APROBADO' AND rc.fecha_vencimiento > CURDATE() THEN 'Aprobado'
                        WHEN rc.estado = 'APROBADO' AND rc.fecha_vencimiento <= CURDATE() THEN 'Vencido'
                        WHEN rc.estado = 'PERDIDO' THEN 'Perdido'
                        WHEN rc.estado IS NOT NULL THEN 'No definido'
                        ELSE 'No realizado'
                    END
                 FROM resultados_capacitaciones rc 
                 JOIN capacitaciones cap ON rc.capacitacion_id = cap.id
                 WHERE rc.colaborador_id = c.id 
                 AND cap.nombre LIKE '%Capacitación SATOR%'
                 ORDER BY rc.created_at DESC LIMIT 1
                ) as capacitacion
            FROM colaboradores c
            WHERE c.solicitud_id = ? 
        `, [id]);

        // Log para depuración
        console.log('Datos de colaboradores:', JSON.stringify(colaboradores, null, 2));

        const [solicitud] = await connection.execute(
            'SELECT empresa FROM solicitudes WHERE id = ?',
            [id]
        );

        res.json({
            success: true,
            solicitud: solicitud[0],
            colaboradores: colaboradores
        });
    } catch (error) {
        console.error('Error fetching disabled collaborators:', error);
        res.status(500).json({ message: 'Error fetching disabled collaborators' });
    }
};
  


controller.rehabilitarColaborador = async (req, res) => {
  const { id } = req.params; // id del colaborador
  const { password } = req.body;

  

  try {
    // Validate input parameters
    if (!id) {
      return res.status(400).json({ message: 'ID del colaborador es requerido' });
    }
    if (!req.userId) {
      return res.status(401).json({ message: 'Usuario no autenticado' });
    }
    if (!password) {
      return res.status(400).json({ message: 'Contraseña es requerida' });
    }

    // Obtener el usuario autenticado
    const [user] = await connection.execute(
      'SELECT password FROM users WHERE id = ?',
      [req.userId]
    );
    if (!user.length) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    // Verificar la contraseña
    const isMatch = await bcrypt.compare(password, user[0].password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Contraseña incorrecta' });
    }

    // Actualizar el estado del colaborador a true
    await connection.execute(
      'UPDATE colaboradores SET estado = true WHERE id = ?',
      [id]
    );

    res.json({ message: 'Colaborador rehabilitado correctamente' });
  } catch (error) {
    console.error('Error rehabilitating collaborator:', error);
    res.status(500).json({ message: 'Error rehabilitating collaborator', error: error.message });
  }
};


module.exports = controller;