const jwt = require('jsonwebtoken');


const ExcelJS = require('exceljs');

const connection = require('../db/db');  // Asegúrate de que este connection sea el correcto
const path = require('path');
const fs = require('fs');
const SECRET_KEY = process.env.JWT_SECRET || 'secreto';
const { format } = require('date-fns');  // Importamos la función 'format' de date-fns
const QRCode = require('qrcode');
const handlebars = require('handlebars'); 
const { concurrency } = require('sharp');
const emailService = require('../services/email.service');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');

 
const s3Client = new S3Client({
    forcePathStyle: false,
    endpoint: 'https://nyc3.digitaloceanspaces.com',
    region: "us-east-1",
    credentials: {
        accessKeyId: process.env.DO_SPACES_KEY,
        secretAccessKey: process.env.DO_SPACES_SECRET
    }
});



const controller = {}; 
 

controller.vistaInterventor = async (req, res) => {
  const token = req.cookies.token;

  console.log('[DEBUG] Token recibido:');

  if (!token) {
    console.log('[DEBUG] No se proporcionó token, redirigiendo al login.');
    return res.redirect('/login');
  }

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    console.log('[DEBUG] Token decodificado:');
    const { role, id, username } = decoded;

    if (role !== 'interventor') {
      console.log('[DEBUG] El usuario no es interventor, redirigiendo al login.');
      return res.redirect('/login');
    }

    const [userInterventor] = await connection.execute('SELECT id, username FROM users WHERE id = ?', [id]);
    const [lugares] = await connection.execute('SELECT id, nombre_lugar FROM lugares ORDER BY nombre_lugar ASC'); // Cargar lugares

    let acciones;
    let query;
    let params = [];

    // Base de la consulta SQL
    const baseQuery = `
      SELECT 
        a.id AS accion_id,
        a.solicitud_id,
        a.accion,
        a.comentario,
        DATE_FORMAT(s.inicio_obra, '%d/%m/%Y') AS inicio_obra,
        DATE_FORMAT(s.fin_obra, '%d/%m/%Y') AS fin_obra,
        s.estado AS solicitud_estado,
        a.accion AS solicitud_estado_interventor,
        l.nombre_lugar AS lugar,
        s.labor,
        s.empresa,
        s.nit,
        us.username AS interventor,
        CASE
          WHEN DATE(s.fin_obra) < CURDATE() THEN 'Vencida'
          ELSE 'Vigente'
        END AS estado_vigencia,
        CASE
          WHEN a.accion = 'pendiente' AND s.estado = 'aprobada' THEN 'Aprobar'
          ELSE 'No disponible'
        END AS puede_aprobar,
        CASE
          WHEN a.accion = 'aprobada' AND s.estado = 'en labor' THEN 'Detener Labor'
          ELSE 'No disponible'
        END AS puede_detener,
        CASE
          WHEN a.accion = 'aprobada' AND s.estado IN ('aprobada', 'en labor') 
               AND DATE(s.fin_obra) >= CURDATE() THEN 'Ver QR'
          ELSE 'No disponible'
        END AS puede_ver_qr
      FROM acciones a
      JOIN solicitudes s ON a.solicitud_id = s.id
      LEFT JOIN users us ON us.id = s.interventor_id
      LEFT JOIN lugares l ON s.lugar = l.id
      WHERE 
        (a.accion IN ('aprobada', 'pendiente') OR s.estado IN ('en labor', 'labor detenida'))
    `;

    if (userInterventor[0].username === "COA") {
      console.log("Entre en TRUE, USUARIO: ", userInterventor[0].username);
      query = `${baseQuery} ORDER BY a.id DESC`;
    } else {
      console.log("Entre en FALSE, USUARIO: ", userInterventor[0].username);
      query = `${baseQuery} AND s.interventor_id = ? ORDER BY a.id DESC`;
      params.push(id);
    }

    [acciones] = await connection.execute(query, params);
    console.log('[DEBUG] Acciones obtenidas de la base de datos:');

    // Pasar las acciones, lugares y otros datos a la vista
    res.render('interventor', {
      acciones,
      lugares: lugares.map(l => l.nombre_lugar), // Pasar solo los nombres de los lugares
      title: 'Interventor - Grupo Argos',
      username,
      userId: id,
      format
    });
  } catch (err) {
    console.error('[ERROR] Error al verificar el token o al obtener acciones:', err);
    res.redirect('/login');
  }
};

controller.eliminarSolicitud = async (req, res) => {
  const { solicitud_id } = req.body;

  if (!solicitud_id) {
      return res.status(400).send('ID de solicitud no proporcionado');
  }

  const token = req.cookies.token;
  if (!token) {
      console.log('[CONTROLADOR] No se encontró el token');
      return res.status(401).send('No se encontró el token');
  }

  try {
      // Verify the token and ensure the user has permission
      const decoded = jwt.verify(token, SECRET_KEY);
      const { role } = decoded;

      if (role !== 'interventor') {
          return res.status(403).send('No tienes permiso para eliminar solicitudes');
      }

      // Start a transaction
      const connection2 = await connection.getConnection();
      await connection2.beginTransaction();

      try {
          // 1. Retrieve all file paths that need to be deleted
          const [solicitud] = await connection2.execute(
              'SELECT arl_documento, pasocial_documento FROM solicitudes WHERE id = ?',
              [solicitud_id]
          );

          if (!solicitud.length) {
              await connection2.rollback();
              connection2.release();
              return res.status(404).send('Solicitud no encontrada');
          }

          // Get all files that need to be deleted
          const [colaboradores] = await connection2.execute(
              'SELECT id, foto, cedulaFoto FROM colaboradores WHERE solicitud_id = ?',
              [solicitud_id]
          );

          const [vehiculos] = await connection2.execute(
              'SELECT id, foto, tecnomecanica, soat, licencia_conduccion, licencia_transito FROM vehiculos WHERE solicitud_id = ?',
              [solicitud_id]
          );

          const [sstDocumentos] = await connection2.execute(
              'SELECT url FROM sst_documentos WHERE solicitud_id = ?',
              [solicitud_id]
          );

          // 2. Delete all related records in the correct order
          // First delete all dependent records (child tables)
          console.log(`[DB] Iniciando eliminación de registros para solicitud ${solicitud_id}`);
          
          // 1. Chat system records
          console.log('[DB] Eliminando registros del sistema de chat...');
          const [chatResult1] = await connection2.execute('DELETE FROM mensajes WHERE chat_id IN (SELECT id FROM chats WHERE solicitud_id = ?)', [solicitud_id]);
          console.log(`[DB] Eliminados ${chatResult1.affectedRows} mensajes`);
          const [chatResult2] = await connection2.execute('DELETE FROM chat_participantes WHERE chat_id IN (SELECT id FROM chats WHERE solicitud_id = ?)', [solicitud_id]);
          console.log(`[DB] Eliminados ${chatResult2.affectedRows} participantes de chat`);
          const [chatResult3] = await connection2.execute('DELETE FROM chats WHERE solicitud_id = ?', [solicitud_id]);
          console.log(`[DB] Eliminados ${chatResult3.affectedRows} chats`);
    
          // 2. Vehicle system records
          console.log('[DB] Eliminando registros del sistema de vehículos...');
          const [vehResult1] = await connection2.execute('DELETE FROM registros_vehiculos WHERE solicitud_id = ?', [solicitud_id]);
          console.log(`[DB] Eliminados ${vehResult1.affectedRows} registros de vehículos`);
          const [vehResult2] = await connection2.execute('DELETE FROM plantilla_documentos_vehiculos WHERE solicitud_id = ?', [solicitud_id]);
          console.log(`[DB] Eliminados ${vehResult2.affectedRows} documentos de vehículos`);
          const [vehResult3] = await connection2.execute('DELETE FROM licencias_vehiculo WHERE solicitud_id = ?', [solicitud_id]);
          console.log(`[DB] Eliminadas ${vehResult3.affectedRows} licencias de vehículos`);
          const [vehResult4] = await connection2.execute('DELETE FROM vehiculos WHERE solicitud_id = ?', [solicitud_id]);
          console.log(`[DB] Eliminados ${vehResult4.affectedRows} vehículos`);
    
          // 3. Collaborator system records
          console.log('[DB] Eliminando registros del sistema de colaboradores...');
          const [colResult1] = await connection2.execute('DELETE FROM registros WHERE solicitud_id = ?', [solicitud_id]);
          console.log(`[DB] Eliminados ${colResult1.affectedRows} registros de entrada/salida`);
          const [colResult2] = await connection2.execute('DELETE FROM resultados_capacitaciones WHERE solicitud_id = ?', [solicitud_id]);
          console.log(`[DB] Eliminados ${colResult2.affectedRows} resultados de capacitaciones`);
          const [colResult3] = await connection2.execute('DELETE FROM plantilla_seguridad_social WHERE solicitud_id = ?', [solicitud_id]);
          console.log(`[DB] Eliminadas ${colResult3.affectedRows} plantillas de seguridad social`);
          const [colResult4] = await connection2.execute('DELETE FROM historial_estados_colaboradores WHERE solicitud_id = ?', [solicitud_id]);
          console.log(`[DB] Eliminados ${colResult4.affectedRows} registros de historial de estados`);
          const [colResult5] = await connection2.execute('DELETE FROM politicas_aceptadas_colaboradores WHERE colaborador_id IN (SELECT id FROM colaboradores WHERE solicitud_id = ?)', [solicitud_id]);
          console.log(`[DB] Eliminadas ${colResult5.affectedRows} políticas aceptadas`);
          const [colResult6] = await connection2.execute('DELETE FROM colaboradores WHERE solicitud_id = ?', [solicitud_id]);
          console.log(`[DB] Eliminados ${colResult6.affectedRows} colaboradores`);
    
          // 4. SST system records
          console.log('[DB] Eliminando registros del sistema SST...');
          const [sstResult] = await connection2.execute('DELETE FROM sst_documentos WHERE solicitud_id = ?', [solicitud_id]);
          console.log(`[DB] Eliminados ${sstResult.affectedRows} documentos SST`);
    
          // 5. Finally delete records directly related to solicitud
          console.log('[DB] Eliminando registros principales...');
          const [accionesResult] = await connection2.execute('DELETE FROM acciones WHERE solicitud_id = ?', [solicitud_id]);
          console.log(`[DB] Eliminadas ${accionesResult.affectedRows} acciones`);

          // 3. Delete files from DigitalOcean Spaces first
          const deleteFromSpaces = async (fileUrl) => {
              if (!fileUrl) return;

              const bucketUrlPrefix = `https://app-storage-contratistas.nyc3.digitaloceanspaces.com/`;
              const fileKey = fileUrl.startsWith(bucketUrlPrefix)
                  ? fileUrl.replace(bucketUrlPrefix, '')
                  : fileUrl.split('/').pop();

              const command = new DeleteObjectCommand({
                  Bucket: process.env.DO_SPACES_BUCKET,
                  Key: fileKey,
              });

              try {
                  await s3Client.send(command);
                  console.log(`Archivo eliminado de Spaces: ${fileKey}`);
              } catch (error) {
                  console.error(`Error al eliminar archivo de Spaces: ${fileKey}`, error);
              }
          };

          // Delete all files
          const { arl_documento, pasocial_documento } = solicitud[0];
          if (arl_documento) await deleteFromSpaces(arl_documento);
          if (pasocial_documento) await deleteFromSpaces(pasocial_documento);

          // Delete collaborator files
          for (const colaborador of colaboradores) {
              if (colaborador.foto) await deleteFromSpaces(colaborador.foto);
              if (colaborador.cedulaFoto) await deleteFromSpaces(colaborador.cedulaFoto);
          }

          // Delete vehicle files
          for (const vehiculo of vehiculos) {
              if (vehiculo.foto) await deleteFromSpaces(vehiculo.foto);
              if (vehiculo.tecnomecanica) await deleteFromSpaces(vehiculo.tecnomecanica);
              if (vehiculo.soat) await deleteFromSpaces(vehiculo.soat);
              if (vehiculo.licencia_conduccion) await deleteFromSpaces(vehiculo.licencia_conduccion);
              if (vehiculo.licencia_transito) await deleteFromSpaces(vehiculo.licencia_transito);
          }

          // Delete SST documents and their files
          for (const sstDoc of sstDocumentos) {
              if (sstDoc.url) {
                  console.log(`[DB] Eliminando archivo SST: ${sstDoc.url}`);
                  await deleteFromSpaces(sstDoc.url);
              }
          }

          // Finally delete the solicitud itself
          console.log(`[DB] Eliminando solicitud ${solicitud_id}`);
          await connection2.execute('DELETE FROM solicitudes WHERE id = ?', [solicitud_id]);

          // Commit the transaction and cleanup
          await connection2.commit();
          connection2.release();

          console.log(`Solicitud ${solicitud_id} y todos sus registros asociados eliminados con éxito`);
          res.status(200).send('Solicitud, registros asociados y archivos eliminados correctamente');

      } catch (error) {
          await connection2.rollback();
          connection2.release();
          throw error;
      }
  } catch (error) {
      console.error('[CONTROLADOR] Error al eliminar la solicitud:', error);
      res.status(500).send('Error al eliminar la solicitud');
  }
};
 
async function getImageBase64(imagePath) {
  if (!imagePath) return null;
  const fullPath = path.join(__dirname, '../public', imagePath);
  if (fs.existsSync(fullPath)) {
    return fs.readFileSync(fullPath, 'base64');
  }
  return null;
}

// Función para obtener los detalles de la solicitud

controller.obtenerDetallesSolicitud = async (req, res) => {
  const { id } = req.params;

  try {
    const [solicitud] = await connection.execute(`
      SELECT s.*, l.nombre_lugar as lugar 
      FROM solicitudes s
      JOIN lugares l ON s.lugar = l.id 
      WHERE s.id = ?`, [id]);
    if (!solicitud || solicitud.length === 0) {
      return res.status(404).send('Solicitud no encontrada');
    }

    const [colaboradores] = await connection.execute(
      'SELECT id, cedula, nombre, foto, cedulaFoto FROM colaboradores WHERE solicitud_id = ? and estado = true',
      [id]
    );
    const [contratista] = await connection.execute('SELECT username FROM users WHERE id = ?', [solicitud[0].usuario_id]);
    const [interventor] = await connection.execute('SELECT username FROM users WHERE id = ?', [solicitud[0].interventor_id]);

    // Formatear fechas
    solicitud.forEach((solici) => {
      solici.inicio_obra = format(new Date(solici.inicio_obra), 'dd/MM/yyyy');
      solici.fin_obra = format(new Date(solici.fin_obra), 'dd/MM/yyyy');
    });

    const logoPath = path.join(__dirname, '../public', 'img', 'TSM-Sator-Logo.webp');
    const logoBase64 = fs.readFileSync(logoPath, 'base64');

    const data = {
      logoBase64: `data:image/png;base64,${logoBase64}`,
      fecha: new Date().toLocaleDateString(),
      solicitud: solicitud[0],
      contractorName: contratista[0].username,
      interventorName: interventor[0].username,
      colaboradores,
    };

    res.json(data);
  } catch (error) {
    console.error('[RUTA] Error al obtener los detalles de la solicitud:', error);
    res.status(500).send('Error al obtener los detalles de la solicitud');
  }
};

controller.aprobarSolicitud = async (req, res) => {
  const { solicitudId } = req.body;

  console.log('[DEBUG] Aprobando solicitud con ID:', solicitudId);

  try {
    // Verificar el estado actual de la acción para la solicitud
    const [accion] = await connection.execute('SELECT accion FROM acciones WHERE solicitud_id = ?', [solicitudId]);

    if (accion.length === 0) {
      return res.status(404).send('Acción no encontrada');
    }

    // Si la acción ya está aprobada, no permitir aprobarla nuevamente
    if (accion[0].accion === 'aprobada') {
      console.log('[DEBUG] La solicitud ya está aprobada.');
      return res.status(400).send('La solicitud ya está aprobada.');
    }

    // Obtener información del contratista y la solicitud
    const [solicitudInfo] = await connection.execute(`
      SELECT s.*, u.email, u.empresa 
      FROM solicitudes s 
      JOIN users u ON s.usuario_id = u.id 
      WHERE s.id = ?
    `, [solicitudId]);

    if (solicitudInfo.length === 0) {
      return res.status(404).send('Solicitud no encontrada');
    }

    // Si la acción no está aprobada, actualizamos el estado a "aprobada"
    await connection.execute('UPDATE acciones SET accion = "aprobada" WHERE solicitud_id = ?', [solicitudId]);

    console.log('[DEBUG] Estado de la acción actualizado a "aprobada".');

    // Enviar correo de aprobación si el contratista tiene email
    if (solicitudInfo[0].email) {
      try {
        await emailService.sendApprovalEmail(solicitudInfo[0].email, {
          empresa: solicitudInfo[0].empresa,
          solicitudId: solicitudId,
          fecha: new Date().toLocaleDateString()
        });
        console.log('[DEBUG] Correo de aprobación enviado correctamente');
      } catch (emailError) {
        console.error('[ERROR] Error al enviar correo de aprobación:', emailError);
        // No interrumpimos el flujo si falla el envío del correo
      }
    }

    res.redirect('/vista-interventor');
  } catch (err) {
    console.error('[ERROR] Error al aprobar solicitud:', err);
    res.status(500).send('Error al aprobar la solicitud');
  }
};


controller.generarQR = async (req, res) => {
  const solicitudId = req.params.id;

  console.log('[DEBUG] Generando QR para solicitud con ID:', solicitudId);

  try {
    // Verificamos si la solicitud está aprobada
    const [solicitud] = await connection.execute(
      `SELECT a.accion AS estado_accion, s.fin_obra 
       FROM acciones a
       JOIN solicitudes s ON a.solicitud_id = s.id
       WHERE a.solicitud_id = ? AND a.accion = 'aprobada'
       ORDER BY a.created_at DESC
       LIMIT 1`, 
      [solicitudId]
    );

    if (solicitud.length === 0) {
      // Si no se encuentra la solicitud aprobada, no permitimos generar el QR
      console.log('[DEBUG] Solo las solicitudes aprobadas pueden generar un QR.');
      return res.status(400).json({ error: 'Solo las solicitudes aprobadas pueden generar un QR.' });
    }

    const currentDate = new Date();
    let fechaFin = new Date(solicitud[0].fin_obra); // Asegúrate de que fin_obra esté en un formato válido
    fechaFin.setDate(fechaFin.getDate() + 1); // Sumar 1 día a la fecha de fin
    const fechafinal = fechaFin; // Esta es la fecha final con un día añadido


    if (fechafinal < currentDate) {
      // Si la solicitud está vencida, no se puede generar el QR
      console.log('[DEBUG] La solicitud está vencida, no se puede generar el QR.');
      return res.status(400).json({ error: 'La solicitud está vencida, no se puede generar el QR.' });
    }

    // Generamos el código QR con el formato de URL solicitado
    const qrData = `${process.env.DOMAIN_URL}/vista-seguridad/${solicitudId}`;
    const qrImage = await QRCode.toDataURL(qrData);

    console.log('[DEBUG] QR generado exitosamente.');
    res.json({ qrUrl: qrImage }); // Enviamos la imagen del QR como JSON
  } catch (err) {
    console.error('[ERROR] Error al generar el QR:', err);
    res.status(500).json({ error: 'Error al generar el código QR' });
  }
};



 // Endpoint para detener la labor de una solicitud
 controller.detenerLabor = async (req, res) => {
  const { solicitudId } = req.params;

  console.log("Validando id de solicitud a detener", solicitudId);

  try {
    // Obtener información del contratista y la solicitud
    const [solicitudInfo] = await connection.execute(`
      SELECT s.*, u.email, u.empresa 
      FROM solicitudes s 
      JOIN users u ON s.usuario_id = u.id 
      WHERE s.id = ?
    `, [solicitudId]);

    if (solicitudInfo.length === 0) {
      return res.status(404).json({ message: 'Solicitud no encontrada' });
    }

    const query = ` 
      UPDATE solicitudes s
      JOIN acciones a ON s.id = a.solicitud_id
      SET s.estado = 'labor detenida'
      WHERE 
        s.estado = 'en labor' 
        OR (s.estado = 'aprobada' AND a.accion = 'aprobada')
        AND s.id = ?;`;

    const [result] = await connection.execute(query, [solicitudId]);

    if (result.affectedRows > 0) {
      // Enviar correo de detención de labor si el contratista tiene email
      if (solicitudInfo[0].email) {
        try {
          await emailService.sendLaborStopEmail(solicitudInfo[0].email, {
            empresa: solicitudInfo[0].empresa,
            solicitudId: solicitudId,
            fecha: new Date().toLocaleDateString()
          });
          console.log('[DEBUG] Correo de detención de labor enviado correctamente');
        } catch (emailError) {
          console.error('[ERROR] Error al enviar correo de detención de labor:', emailError);
          // No interrumpimos el flujo si falla el envío del correo
        }
      }
      res.status(200).json({ message: 'Labor detenida correctamente' });
    } else {
      res.status(400).json({ message: 'La solicitud no está en estado de "en labor" o ya fue detenida.' });
    }
  } catch (err) {
    console.error('[CONTROLADOR] Error al detener la labor:', err);
    res.status(500).json({ message: 'Error al intentar detener la labor' });
  }
};



// Endpoint para reanudar la labor de una solicitud
controller.reanudarLabor = async (req, res) => {
  const { solicitudId } = req.params;

  console.log("Validando id de solicitud para reanudar", solicitudId);

  try {
    // Obtener información del contratista y la solicitud
    const [solicitudInfo] = await connection.execute(`
      SELECT s.*, u.email, u.empresa 
      FROM solicitudes s 
      JOIN users u ON s.usuario_id = u.id 
      WHERE s.id = ?
    `, [solicitudId]);

    if (solicitudInfo.length === 0) {
      return res.status(404).json({ message: 'Solicitud no encontrada' });
    }

    const query = `UPDATE solicitudes 
                   SET estado = 'aprobada' 
                   WHERE id = ? AND estado = 'labor detenida'`;

    const [result] = await connection.execute(query, [solicitudId]);

    if (result.affectedRows > 0) {
      // Enviar correo de reanudación de labor si el contratista tiene email
      if (solicitudInfo[0].email) {
        try {
          await emailService.sendLaborResumeEmail(solicitudInfo[0].email, {
            empresa: solicitudInfo[0].empresa,
            solicitudId: solicitudId,
            fecha: new Date().toLocaleDateString()
          });
          console.log('[DEBUG] Correo de reanudación de labor enviado correctamente');
        } catch (emailError) {
          console.error('[ERROR] Error al enviar correo de reanudación de labor:', emailError);
          // No interrumpimos el flujo si falla el envío del correo
        }
      }
      res.status(200).json({ message: 'Labor reanudada correctamente' });
    } else {
      res.status(400).json({ message: 'La solicitud no está en estado de "labor detenida" o ya está en labor.' });
    }
  } catch (err) {
    console.error('[CONTROLADOR] Error al reanudar la labor:', err);
    res.status(500).json({ message: 'Error al intentar reanudar la labor' });
  }
};






controller.obtenerHistorialRegistros = async (req, res) => {
  const { solicitudId } = req.params;

  const query = `
    SELECT 
      'Colaborador' AS tipo_registro,
      c.nombre AS nombre,
      c.cedula AS identificacion,
      u.empresa,
      u.nit,
      r.tipo,
      DATE_FORMAT(r.fecha_hora, '%Y-%m-%d %H:%i:%s') AS fecha_hora,
      r.estado_actual,
      l.nombre_lugar AS lugar,
      DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i:%s') AS registro_hecho,
      us.username AS usuario_registro
    FROM registros r
    JOIN colaboradores c ON r.colaborador_id = c.id
    JOIN solicitudes s ON r.solicitud_id = s.id
    JOIN users u ON s.usuario_id = u.id
    JOIN users us ON r.usuario_id = us.id
    JOIN lugares l ON s.lugar = l.id
    WHERE r.solicitud_id = ?

    UNION ALL

    SELECT 
      'Vehículo' AS tipo_registro,
      v.matricula AS nombre,
      v.matricula AS identificacion,
      u.empresa,
      u.nit,
      rv.tipo,
      DATE_FORMAT(rv.fecha_hora, '%Y-%m-%d %H:%i:%s') AS fecha_hora,
      rv.estado_actual,
      l.nombre_lugar AS lugar,
      DATE_FORMAT(rv.created_at, '%Y-%m-%d %H:%i:%s') AS registro_hecho,
      us.username AS usuario_registro
    FROM registros_vehiculos rv
    JOIN vehiculos v ON rv.vehiculo_id = v.id
    JOIN solicitudes s ON rv.solicitud_id = s.id
    JOIN users u ON s.usuario_id = u.id
    JOIN users us ON rv.usuario_id = us.id
    JOIN lugares l ON s.lugar = l.id
    WHERE rv.solicitud_id = ?

    ORDER BY fecha_hora DESC;
  `;

  try {
    const [rows] = await connection.query(query, [solicitudId, solicitudId]);
    res.status(200).json(rows);
  } catch (error) {
    console.error('[CONTROLADOR] Error al obtener el historial:', error);
    res.status(500).json({ message: 'Error al obtener el historial de registros' });
  }
};

controller.filtrarSolicitudes = async (req, res) => {
  console.log('[DEBUG] Iniciando filtrarSolicitudes');
  const token = req.cookies.token;

  if (!token) {
    console.log('[DEBUG] No se encontró token');
    return res.status(401).json({ message: 'No autorizado' });
  }

  try {
    console.log('[DEBUG] Verificando token');
    const decoded = jwt.verify(token, SECRET_KEY);
    const { role, id } = decoded;
    console.log('[DEBUG] Role:', role, 'ID:', id);

    console.log('[DEBUG] Consultando información del interventor');
    const [userInterventor] = await connection.execute('SELECT id, username FROM users WHERE id = ?', [id]);
    const username = userInterventor[0].username;
    console.log('[DEBUG] Username:', username);

    if (role !== 'interventor') {
      console.log('[DEBUG] Rol no autorizado:', role);
      return res.status(403).json({ message: 'Acceso denegado' });
    }

    const { id: filtroId, cedula, interventor, estado, fechaInicio, fechaFin, nit, empresa, lugar, vigencia, idColaborador } = req.body;
    console.log('[DEBUG] Filtros recibidos:', { filtroId, cedula, interventor, estado, fechaInicio, fechaFin, nit, empresa, lugar, vigencia, idColaborador });

    let query = `
      SELECT DISTINCT
        a.id AS accion_id,
        a.solicitud_id,
        a.accion,
        a.comentario,
        DATE_FORMAT(s.inicio_obra, '%d/%m/%Y') AS inicio_obra,
        DATE_FORMAT(s.fin_obra, '%d/%m/%Y') AS fin_obra,
        s.estado AS solicitud_estado,
        a.accion AS solicitud_estado_interventor,
        l.nombre_lugar AS lugar,
        s.labor,
        s.empresa,
        s.nit,
        us.username AS interventor,
        CASE
          WHEN DATE(s.fin_obra) < CURDATE() THEN 'Vencida'
          ELSE 'Vigente'
        END AS estado_vigencia,
        CASE
          WHEN a.accion = 'pendiente' AND s.estado = 'aprobada' THEN 'Aprobar'
          ELSE 'No disponible'
        END AS puede_aprobar,
        CASE
          WHEN a.accion = 'aprobada' AND s.estado IN ('aprobada', 'en labor') 
               AND DATE(s.fin_obra) >= CURDATE() THEN 'Ver QR'
          ELSE 'No disponible'
        END AS puede_ver_qr
      FROM acciones a
      JOIN solicitudes s ON a.solicitud_id = s.id
      LEFT JOIN users us ON us.id = s.interventor_id
      LEFT JOIN colaboradores c ON c.solicitud_id = s.id
      LEFT JOIN lugares l ON s.lugar = l.id
      WHERE 
        (a.accion IN ('aprobada', 'pendiente') OR s.estado IN ('en labor', 'labor detenida'))
    `;
    const params = [];
    console.log('[DEBUG] Query base construida');

    // Filtros dinámicos
    if (filtroId) {
      query += ' AND a.solicitud_id = ?';
      params.push(filtroId);
      console.log('[DEBUG] Añadido filtro ID:', filtroId);
    }
    if (idColaborador) {
      query += ' AND c.id = ?';
      params.push(idColaborador);
      console.log('[DEBUG] Añadido filtro colaborador:', idColaborador);
    }
    if (cedula) {
      query += ' AND c.cedula LIKE ?';
      params.push(`%${cedula}%`);
      console.log('[DEBUG] Añadido filtro cédula:', cedula);
    }
    if (interventor) {
      query += ' AND us.username LIKE ?';
      params.push(`%${interventor}%`);
      console.log('[DEBUG] Añadido filtro interventor:', interventor);
    }
    if (estado) {
      if (estado === 'Aprobado por SST') {
        query += ' AND s.estado = "aprobada" AND a.accion = "pendiente"';
        console.log('[DEBUG] Añadido filtro estado: Aprobado por SST');
      } else if (estado === 'Pendiente Ingreso') {
        query += ' AND s.estado = "aprobada" AND a.accion = "aprobada"';
        console.log('[DEBUG] Añadido filtro estado: Pendiente Ingreso');
      } else {
        query += ' AND s.estado = ?';
        params.push(estado);
        console.log('[DEBUG] Añadido filtro estado:', estado);
      }
    }
    if (fechaInicio) {
      query += ' AND s.inicio_obra >= ?';
      params.push(fechaInicio);
      console.log('[DEBUG] Añadido filtro fecha inicio:', fechaInicio);
    }
    if (fechaFin) {
      query += ' AND s.fin_obra <= ?';
      params.push(fechaFin);
      console.log('[DEBUG] Añadido filtro fecha fin:', fechaFin);
    }
    if (nit) {
      query += ' AND s.nit LIKE ?';
      params.push(`%${nit}%`);
      console.log('[DEBUG] Añadido filtro NIT:', nit);
    }
    if (empresa) {
      query += ' AND s.empresa LIKE ?';
      params.push(`%${empresa}%`);
      console.log('[DEBUG] Añadido filtro empresa:', empresa);
    }
    if (lugar) {
      query += ' AND l.nombre_lugar = ?';
      params.push(lugar);
      console.log('[DEBUG] Añadido filtro lugar:', lugar);
    }
    if (vigencia) {
      query += ' AND (CASE WHEN DATE(s.fin_obra) < CURDATE() THEN "Vencida" ELSE "Vigente" END) = ?';
      params.push(vigencia);
      console.log('[DEBUG] Añadido filtro vigencia:', vigencia);
    }
    if (username !== "COA") {
      query += ' AND s.interventor_id = ?';
      params.push(id);
      console.log('[DEBUG] Añadido filtro por interventor_id:', id);
    }

    // Si hay algún filtro específico, entonces incluimos las negadas
    if (filtroId || cedula || interventor || estado || fechaInicio || fechaFin || nit || empresa || lugar || vigencia || idColaborador) {
      query = query.replace(
        "(a.accion IN ('aprobada', 'pendiente')", 
        "(a.accion IN ('aprobada', 'pendiente', 'negada')"
      );
      console.log('[DEBUG] Modificada query para incluir acciones negadas');
    }

    query += ' ORDER BY a.id DESC';
    console.log('[DEBUG] Query final:', query);
    console.log('[DEBUG] Parámetros:', params);

    const [acciones] = await connection.execute(query, params);
    console.log('[DEBUG] Número de resultados:', acciones.length);

    res.json(acciones);
  } catch (err) {
    console.error('[ERROR] Error al filtrar solicitudes:', err);
    res.status(500).json({ message: 'Error al filtrar solicitudes' });
  }
};

// Descargar historial único


controller.descargarExcelUnico = async (req, res) => {
  const { solicitudId } = req.params;

  try {
    const historial = await obtenerHistorialRegistros(solicitudId);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Historial Único');

    // Define the new column headers
    worksheet.columns = [
      { header: 'Tipo', key: 'tipo_registro', width: 15 },
      { header: 'Nombre/Placa', key: 'nombre', width: 30 },
      { header: 'Cédula/Matrícula', key: 'identificacion', width: 20 },
      { header: 'Empresa', key: 'empresa', width: 30 },
      { header: 'Lugar', key: 'lugar', width: 20 },
      { header: 'Usuario Registro', key: 'usuario_registro', width: 20 },
      { header: 'Movimiento', key: 'tipo', width: 15 },
      { header: 'H. Registro', key: 'registro_hecho', width: 20 },
      { header: 'Fecha/Hora', key: 'fecha_hora', width: 20 },
      { header: 'Estado', key: 'estado', width: 15 },
    ];

    // Add rows with correct field mapping
    historial.forEach(registro => {
      worksheet.addRow({
        tipo_registro: registro.tipo_registro || 'N/A',
        nombre: registro.nombre || 'N/A',
        identificacion: registro.identificacion || 'N/A',
        empresa: registro.empresa || 'N/A',
        lugar: registro.lugar || 'N/A',
        usuario_registro: registro.usuario_registro || 'N/A',
        tipo: registro.tipo || 'N/A',
        registro_hecho: new Date(registro.registro_hecho).toLocaleString(),
        fecha_hora: new Date(registro.fecha_hora).toLocaleString(),
        estado: registro.tipo === 'entrada' ? 'Ingreso' : 'Salida', // Temporary workaround
      });
    });

    // Set headers for file download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=historial_unico_${solicitudId}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('[CONTROLADOR] Error al generar el Excel único:', error);
    res.status(500).send('Error al generar el archivo Excel');
  }
};

// Descargar historial global
controller.descargarExcelGlobal = async (req, res) => {
  try {
    const historial = await obtenerHistorialGlobal();

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Historial Global');

    // Define the new column headers
    worksheet.columns = [
      { header: 'Tipo', key: 'tipo_registro', width: 15 },
      { header: 'Nombre/Placa', key: 'nombre', width: 30 },
      { header: 'Cédula/Matrícula', key: 'identificacion', width: 20 },
      { header: 'Empresa', key: 'empresa', width: 30 },
      { header: 'Lugar', key: 'lugar', width: 20 },
      { header: 'Usuario Registro', key: 'usuario_registro', width: 20 },
      { header: 'Movimiento', key: 'tipo', width: 15 },
      { header: 'H. Registro', key: 'registro_hecho', width: 20 },
      { header: 'Fecha/Hora', key: 'fecha_hora', width: 20 },
      { header: 'Estado', key: 'estado', width: 15 },
    ];

    // Add rows with correct field mapping
    historial.forEach(registro => {
      worksheet.addRow({
        tipo_registro: registro.tipo_registro || 'N/A',
        nombre: registro.nombre || 'N/A',
        identificacion: registro.identificacion || 'N/A',
        empresa: registro.empresa || 'N/A',
        lugar: registro.lugar || 'N/A',
        usuario_registro: registro.usuario_registro || 'N/A',
        tipo: registro.tipo || 'N/A',
        registro_hecho: new Date(registro.registro_hecho).toLocaleString(),
        fecha_hora: new Date(registro.fecha_hora).toLocaleString(),
        estado: registro.tipo === 'entrada' ? 'Ingreso' : 'Salida', // Temporary workaround
      });
    });

    // Set headers for file download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=historial_global.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('[CONTROLADOR] Error al generar el Excel global:', error);
    res.status(500).send('Error al generar el archivo Excel');
  }
};

// Función auxiliar para historial único
const obtenerHistorialRegistros = async (solicitudId) => {
  const query = `
    SELECT 
      'Colaborador' AS tipo_registro,
      c.nombre AS nombre,
      c.cedula AS identificacion,
      u.empresa,
      u.nit,
      r.tipo,
      DATE_FORMAT(r.fecha_hora, '%Y-%m-%d %H:%i:%s') AS fecha_hora,
      r.estado_actual,
      l.nombre_lugar AS lugar,
      DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i:%s') AS registro_hecho,
      us.username AS usuario_registro
    FROM registros r
    JOIN colaboradores c ON r.colaborador_id = c.id
    JOIN solicitudes s ON r.solicitud_id = s.id
    JOIN users u ON s.usuario_id = u.id
    JOIN users us ON r.usuario_id = us.id
    JOIN lugares l ON s.lugar = l.id
    WHERE r.solicitud_id = ?

    UNION ALL

    SELECT 
      'Vehículo' AS tipo_registro,
      v.matricula AS nombre,
      v.matricula AS identificacion,
      u.empresa,
      u.nit,
      rv.tipo,
      DATE_FORMAT(rv.fecha_hora, '%Y-%m-%d %H:%i:%s') AS fecha_hora,
      rv.estado_actual,
      l.nombre_lugar AS lugar,
      DATE_FORMAT(rv.created_at, '%Y-%m-%d %H:%i:%s') AS registro_hecho,
      us.username AS usuario_registro
    FROM registros_vehiculos rv
    JOIN vehiculos v ON rv.vehiculo_id = v.id
    JOIN solicitudes s ON rv.solicitud_id = s.id
    JOIN users u ON s.usuario_id = u.id
    JOIN users us ON rv.usuario_id = us.id
    JOIN lugares l ON s.lugar = l.id
    WHERE rv.solicitud_id = ?

    ORDER BY fecha_hora DESC;
  `;
  const [rows] = await connection.query(query, [solicitudId, solicitudId]);
  return rows;
};

// Función auxiliar para historial global
const obtenerHistorialGlobal = async () => {
  const query = `
    SELECT 
      'Colaborador' AS tipo_registro,
      c.nombre AS nombre,
      c.cedula AS identificacion,
      u.empresa,
      u.nit,
      r.tipo,
      DATE_FORMAT(r.fecha_hora, '%Y-%m-%d %H:%i:%s') AS fecha_hora,
      r.estado_actual,
      l.nombre_lugar AS lugar,
      DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i:%s') AS registro_hecho,
      us.username AS usuario_registro
    FROM registros r
    JOIN colaboradores c ON r.colaborador_id = c.id
    JOIN solicitudes s ON r.solicitud_id = s.id
    JOIN users u ON s.usuario_id = u.id
    JOIN users us ON r.usuario_id = us.id
    JOIN lugares l ON s.lugar = l.id

    UNION ALL

    SELECT 
      'Vehículo' AS tipo_registro,
      v.matricula AS nombre,
      v.matricula AS identificacion,
      u.empresa,
      u.nit,
      rv.tipo,
      DATE_FORMAT(rv.fecha_hora, '%Y-%m-%d %H:%i:%s') AS fecha_hora,
      rv.estado_actual,
      l.nombre_lugar AS lugar,
      DATE_FORMAT(rv.created_at, '%Y-%m-%d %H:%i:%s') AS registro_hecho,
      us.username AS usuario_registro
    FROM registros_vehiculos rv
    JOIN vehiculos v ON rv.vehiculo_id = v.id
    JOIN solicitudes s ON rv.solicitud_id = s.id
    JOIN users u ON s.usuario_id = u.id
    JOIN users us ON rv.usuario_id = us.id
    JOIN lugares l ON s.lugar = l.id

    ORDER BY fecha_hora DESC;
  `;
  const [rows] = await connection.execute(query);
  return rows;
};

controller.obtenerDatosTablas = async (req, res) => {
  const token = req.cookies.token;
  const { yearSolicitudes, monthSolicitudes, yearColaboradores, monthColaboradores, yearInterventores, monthInterventores } = req.query;

  if (!token) {
    return res.status(401).json({ message: 'No autorizado' });
  }

  try {
    console.log('[DEBUG] SECRET_KEY:', SECRET_KEY);
    const decoded = jwt.verify(token, SECRET_KEY);
    
    
    const { role } = decoded;

    // Solo verificamos que sea un usuario autenticado, no restringimos por rol 'interventor'
    // if (role !== 'interventor') {
    //   return res.status(403).json({ message: 'Acceso denegado' });
    // }

    // 1. Solicitudes por Puesto (Lugar)
    let querySolicitudesPorPuesto = `
      SELECT l.nombre_lugar AS lugar, COUNT(*) AS cantidad
      FROM solicitudes s
      JOIN lugares l ON s.lugar = l.id
      ${yearSolicitudes ? 'WHERE YEAR(s.created_at) = ?' : ''}
      ${monthSolicitudes ? `${yearSolicitudes ? 'AND' : 'WHERE'} MONTH(s.created_at) = ?` : ''}
      GROUP BY l.nombre_lugar
    `;
    const solicitudesParams = [];
    if (yearSolicitudes) solicitudesParams.push(yearSolicitudes);
    if (monthSolicitudes) solicitudesParams.push(monthSolicitudes);
    const [solicitudesPorPuesto] = await connection.execute(querySolicitudesPorPuesto, solicitudesParams);

    // 2. Colaboradores por Contratista (usando s.empresa)
    let queryColaboradoresPorContratista = `
      SELECT s.empresa AS contratista, COUNT(DISTINCT c.cedula) AS cantidad
      FROM colaboradores c
      JOIN solicitudes s ON c.solicitud_id = s.id
      ${yearColaboradores ? 'WHERE YEAR(s.created_at) = ?' : ''}
      ${monthColaboradores ? `${yearColaboradores ? 'AND' : 'WHERE'} MONTH(s.created_at) = ?` : ''}
      GROUP BY s.empresa
    `;
    const colaboradoresParams = [];
    if (yearColaboradores) colaboradoresParams.push(yearColaboradores);
    if (monthColaboradores) colaboradoresParams.push(monthColaboradores);
    const [colaboradoresPorContratista] = await connection.execute(queryColaboradoresPorContratista, colaboradoresParams);

    // 3. Solicitudes por Interventor
    let querySolicitudesPorInterventor = `
      SELECT u.username AS interventor, COUNT(*) AS cantidad
      FROM solicitudes s
      JOIN users u ON s.interventor_id = u.id
      ${yearInterventores ? 'WHERE YEAR(s.created_at) = ?' : ''}
      ${monthInterventores ? `${yearInterventores ? 'AND' : 'WHERE'} MONTH(s.created_at) = ?` : ''}
      GROUP BY u.username
    `;
    const interventoresParams = [];
    if (yearInterventores) interventoresParams.push(yearInterventores);
    if (monthInterventores) interventoresParams.push(monthInterventores);
    const [solicitudesPorInterventor] = await connection.execute(querySolicitudesPorInterventor, interventoresParams);

    res.json({
      solicitudesPorPuesto,
      colaboradoresPorContratista,
      solicitudesPorInterventor
    });
  } catch (err) {
    console.error('[ERROR] Error al obtener datos de tablas:', err);
    res.status(500).json({ message: 'Error al obtener datos de tablas' });
  }
};

controller.obtenerTodosColaboradores = async (req, res) => {
  const { solicitudId } = req.params;

  try {
    // Obtener información de la solicitud
    const [solicitudData] = await connection.execute(
      'SELECT id, empresa, nit FROM solicitudes WHERE id = ?',
      [solicitudId]
    );

    if (!solicitudData.length) {
      return res.status(404).json({ success: false, message: 'Solicitud no encontrada' });
    }

    // Obtener TODOS los colaboradores sin filtrar por estado
    const [colaboradores] = await connection.execute(`
      SELECT 
        c.id, 
        c.cedula, 
        c.nombre, 
        c.foto, 
        c.cedulaFoto, 
        c.estado,
        (SELECT 
          JSON_OBJECT(
            'id', pss.id,
            'fecha_inicio', pss.fecha_inicio,
            'fecha_fin', pss.fecha_fin
          )
         FROM plantilla_seguridad_social pss 
         WHERE pss.colaborador_id = c.id 
         ORDER BY pss.fecha_fin DESC LIMIT 1) as plantillaSS,
        (SELECT rc.estado 
         FROM resultados_capacitaciones rc 
         JOIN capacitaciones cap ON rc.capacitacion_id = cap.id
         WHERE rc.colaborador_id = c.id 
         AND cap.nombre LIKE '%Capacitación SATOR%'
         ORDER BY rc.created_at DESC LIMIT 1) as capacitacion
      FROM colaboradores c
      WHERE c.solicitud_id = ?
    `, [solicitudId]);

    // Convertir formato de los datos
    const colaboradoresFormateados = colaboradores.map(col => {
      // Convertir plantillaSS de string a objeto si es necesario
      let plantillaSS = null;
      if (col.plantillaSS && typeof col.plantillaSS === 'string') {
        try {
          plantillaSS = JSON.parse(col.plantillaSS);
        } catch (e) {
          console.error('Error al parsear plantillaSS:', e);
        }
      } else {
        plantillaSS = col.plantillaSS;
      }

      return {
        ...col,
        estado: Boolean(col.estado),
        plantillaSS: plantillaSS,
        capacitacion: col.capacitacion,
        mensajeCapacitacion: col.mensajeCapacitacion,
      };
    });

    res.json({ 
      success: true, 
      solicitud: solicitudData[0],
      colaboradores: colaboradoresFormateados 
    });
  } catch (error) {
    console.error('[CONTROLADOR] Error al obtener colaboradores:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error al obtener colaboradores',
      error: error.message 
    });
  }
};

module.exports = controller; 