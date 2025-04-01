const express = require('express');
const multer = require('multer');
const router = express.Router();
const { format } = require('date-fns');
const controller = require('../controllers/contratista.controller');
const jwt = require('jsonwebtoken');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const authMiddleware = require('../middleware/auth.middleware');
const connection = require('../db/db');
const fs = require('fs').promises;
const path = require('path');
const mime = require('mime-types');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// Configuración de logger para depuración
const debug = require('debug')('app:contratista');
const errorDebug = require('debug')('app:error');

// Configuración de DigitalOcean Spaces con AWS SDK v3
const s3Client = new S3Client({
  endpoint: `https://${process.env.DO_SPACES_ENDPOINT}`,
  region: process.env.DO_SPACES_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET
  }
});

// Función para registrar errores
const logError = (error, route) => {
  errorDebug(`Error en ruta ${route}:`, error);
  console.error(`[${new Date().toISOString()}] Error en ${route}:`, error);
};

// Función para registrar información de depuración
const logInfo = (message, data = {}) => {
  debug(message, data);
  console.log(`[${new Date().toISOString()}] ${message}`, data);
};
 

const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
      const tempPath = path.join(__dirname, '../temp/uploads');
      try {
        await fs.access(tempPath);
        cb(null, tempPath);
      } catch (error) {
        await fs.mkdir(tempPath, { recursive: true });
        logInfo('Directorio temporal creado:', { path: tempPath });
        cb(null, tempPath);
      }
    },
    filename: (req, file, cb) => {
      const uuid = uuidv4();
      const extension = path.extname(file.originalname);
      const filename = `${uuid}${extension}`;
      logInfo('Generando nombre de archivo:', { originalName: file.originalname, generatedName: filename });
      cb(null, filename);
    }
  }); 
 

// Validación de tipos de archivo
const fileFilter = (req, file, cb) => {
  const allowedTypes = {
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'application/pdf': ['.pdf'],
    'application/msword': ['.doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    'image/webp': ['.webp']
  };
  
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeType = file.mimetype;
  
  logInfo('Validando archivo:', { filename: file.originalname, mimeType, extension: ext });

  if (allowedTypes[mimeType] && allowedTypes[mimeType].includes(ext)) {
    logInfo('Archivo válido');
    cb(null, true);
  } else {
    const error = new Error(`Tipo de archivo no permitido. Solo se permiten: ${Object.keys(allowedTypes).join(', ')}`);
    logError(error, 'fileFilter');
    cb(error, false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 10 * 1024 * 1024, files: 100 } // 10MB máximo, 100 archivos
});

// Función para subir archivo a Spaces con reintentos
async function uploadToSpacesFromDisk(filePath, originalName, folder = 'images/vehiculos', retries = 3) {
  const uuid = uuidv4();
  const extension = path.extname(originalName);
  const filename = `${uuid}${extension}`;
  const spacesPath = `${folder}/${filename}`;
  
  const fileContent = await fs.readFile(filePath);
  const command = new PutObjectCommand({
    Bucket: process.env.DO_SPACES_BUCKET,
    Key: spacesPath,
    Body: fileContent,
    ACL: 'public-read',
    ContentType: mime.lookup(filePath) || 'application/octet-stream'
  });

  let attempt = 0;
  while (attempt < retries) {
    try {
      logInfo('Subiendo archivo a Spaces:', { filePath, spacesPath, attempt: attempt + 1 });
      await s3Client.send(command);
      
      // Construir la URL completa de DigitalOcean Spaces
      const spacesUrl = `https://${process.env.DO_SPACES_BUCKET}.${process.env.DO_SPACES_ENDPOINT}/${spacesPath}`;
      
      logInfo('Archivo subido exitosamente:', { spacesUrl });
      return spacesUrl;
    } catch (error) {
      attempt++;
      logError(error, `uploadToSpacesFromDisk (intento ${attempt}/${retries})`);
      if (attempt === retries) throw new Error(`Fallo al subir archivo tras ${retries} intentos: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Espera exponencial
    }
  }
}

// Función para borrar archivo de Spaces
async function deleteFromSpaces(fileUrl) {
  if (!fileUrl) {
    logInfo('No se proporcionó URL de archivo para borrar');
    return;
  }

  // Extraer la clave del archivo de la URL completa
  const urlParts = fileUrl.split('/');
  const fileKey = urlParts.slice(3).join('/'); // Obtener la ruta después del bucket y endpoint

  const command = new DeleteObjectCommand({
    Bucket: process.env.DO_SPACES_BUCKET,
    Key: fileKey
  });

  logInfo('Intentando borrar archivo de Spaces:', { fileUrl, fileKey });
  try {
    await s3Client.send(command);
    logInfo('Archivo borrado exitosamente de Spaces:', { fileUrl });
  } catch (error) {
    logError(error, 'deleteFromSpaces');
    throw error;
  }
}

// Función para borrar documentos SST
async function deleteSSTDocuments(solicitudId) {
  const conn = await connection.getConnection();
  try {
    await conn.beginTransaction();
    logInfo('Iniciando borrado de documentos SST:', { solicitudId });

    const [docs] = await conn.execute(
      'SELECT url FROM sst_documentos WHERE solicitud_id = ?',
      [solicitudId]
    );

    logInfo('Documentos encontrados:', { count: docs.length });

    for (const doc of docs) {
      await deleteFromSpaces(doc.url);
    }

    await conn.execute(
      'DELETE FROM sst_documentos WHERE solicitud_id = ?',
      [solicitudId]
    );

    await conn.commit();
    logInfo('Documentos SST borrados exitosamente:', { solicitudId });
  } catch (error) {
    await conn.rollback();
    logError(error, 'deleteSSTDocuments');
    throw error;
  } finally {
    conn.release();
  }
}

router.use(authMiddleware);

// Ruta para generar solicitud
router.post('/generar-solicitud', upload.fields([
  { name: 'arl', maxCount: 1 },
  { name: 'pasocial', maxCount: 1 },
  { name: 'foto[]', maxCount: 25 },
  { name: 'cedulaFoto[]', maxCount: 25 },
  { name: 'foto_vehiculo[]', maxCount: 10 },
  { name: 'tecnomecanica[]', maxCount: 10 },
  { name: 'soat[]', maxCount: 10 },
  { name: 'licencia_conduccion[]', maxCount: 10 },
  { name: 'licencia_transito[]', maxCount: 10 }
]), async (req, res) => {
  const conn = await connection.getConnection();
  try {
    logInfo('Iniciando generación de solicitud', { body: req.body });
    await conn.beginTransaction();

    const uploadedFiles = req.files;
    logInfo('Archivos recibidos:', { 
      fileCount: Object.keys(uploadedFiles || {}).reduce((acc, key) => acc + uploadedFiles[key].length, 0) 
    });

    const fileNames = {
      foto: [],
      cedulaFoto: [],
      arl: null,
      pasocial: null,
      vehiculos: []
    };

    for (const fileKey in uploadedFiles) {
      const files = uploadedFiles[fileKey];
      for (const file of files) {
        const filePath = await uploadToSpacesFromDisk(file.path, file.originalname);
        if (fileKey === 'foto[]') fileNames.foto.push(filePath);
        else if (fileKey === 'cedulaFoto[]') fileNames.cedulaFoto.push(filePath);
        else if (fileKey === 'arl') fileNames.arl = filePath;
        else if (fileKey === 'pasocial') fileNames.pasocial = filePath;
      }
    }

    const { empresa, nit, lugar, labor, interventor_id, cedula, nombre, inicio_obra, fin_obra, dias_trabajo, matricula } = req.body;
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'No se encontró el token' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secreto');
    const { id } = decoded;

    const query = `
      INSERT INTO solicitudes (usuario_id, empresa, nit, inicio_obra, fin_obra, dias_trabajo, lugar, labor, interventor_id, arl_documento, pasocial_documento)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;
    const [result] = await conn.execute(query, [
      id, empresa, nit, inicio_obra, fin_obra, dias_trabajo, lugar, labor, interventor_id,
      fileNames.arl || null, fileNames.pasocial || null
    ]);

    for (let i = 0; i < cedula.length; i++) {
      await conn.execute(
        'INSERT INTO colaboradores (solicitud_id, cedula, nombre, foto, cedulaFoto) VALUES (?, ?, ?, ?, ?)',
        [result.insertId, cedula[i], nombre[i], fileNames.foto[i] || null, fileNames.cedulaFoto[i] || null]
      );
    }

    if (matricula && matricula.length) {
      const matriculas = Array.isArray(matricula) ? matricula : [matricula];
      for (let i = 0; i < matriculas.length; i++) {
        const vehiculo = {
          matricula: matriculas[i],
          foto: uploadedFiles['foto_vehiculo[]']?.[i] ? await uploadToSpacesFromDisk(uploadedFiles['foto_vehiculo[]'][i].path, uploadedFiles['foto_vehiculo[]'][i].originalname) : null,
          tecnomecanica: uploadedFiles['tecnomecanica[]']?.[i] ? await uploadToSpacesFromDisk(uploadedFiles['tecnomecanica[]'][i].path, uploadedFiles['tecnomecanica[]'][i].originalname) : null,
          soat: uploadedFiles['soat[]']?.[i] ? await uploadToSpacesFromDisk(uploadedFiles['soat[]'][i].path, uploadedFiles['soat[]'][i].originalname) : null,
          licencia_conduccion: uploadedFiles['licencia_conduccion[]']?.[i] ? await uploadToSpacesFromDisk(uploadedFiles['licencia_conduccion[]'][i].path, uploadedFiles['licencia_conduccion[]'][i].originalname) : null,
          licencia_transito: uploadedFiles['licencia_transito[]']?.[i] ? await uploadToSpacesFromDisk(uploadedFiles['licencia_transito[]'][i].path, uploadedFiles['licencia_transito[]'][i].originalname) : null
        };
        await conn.execute(
          'INSERT INTO vehiculos (solicitud_id, matricula, foto, tecnomecanica, soat, licencia_conduccion, licencia_transito) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [result.insertId, vehiculo.matricula, vehiculo.foto, vehiculo.tecnomecanica, vehiculo.soat, vehiculo.licencia_conduccion, vehiculo.licencia_transito]
        );
      }
    }

    const [resultUser] = await conn.execute('SELECT username FROM users WHERE id = ?', [interventor_id]);
    if (resultUser[0]?.username === "COA") {
      await conn.execute('UPDATE solicitudes SET estado = "aprobada" WHERE id = ?', [result.insertId]);
      await conn.execute('INSERT INTO acciones (solicitud_id, usuario_id, accion) VALUES (?, ?, "pendiente")', [result.insertId, id]);
    }

    await conn.commit();
    logInfo('Solicitud generada exitosamente');
    res.status(200).json({ message: 'Solicitud creada correctamente' });
  } catch (error) {
    await conn.rollback();
    logError(error, '/generar-solicitud');
    // Limpiar archivos temporales en caso de error
    if (req.files) {
      Object.values(req.files).flat().forEach(async file => {
        try {
          await fs.access(file.path);
          await fs.unlink(file.path);
        } catch (err) {
          // Ignorar errores si el archivo ya no existe
          if (err.code !== 'ENOENT') {
            logError(err, 'Limpieza de archivos temporales');
          }
        }
      });
    }
    res.status(500).json({ 
      error: 'Error al crear la solicitud',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    conn.release();
  }
});

// Ruta para actualizar solicitud
router.post('/actualizar-solicitud/:id', upload.any(), async (req, res) => {
  const conn = await connection.getConnection();
  try {
    await conn.beginTransaction();
    const solicitudId = req.params.id;
    const uploadedFiles = req.files || {};
    const { cedula, nombre, colaborador_id = [], matricula, vehiculo_id = [] } = req.body;

    const fileMap = {};
    uploadedFiles.forEach(file => {
      fileMap[file.fieldname] = fileMap[file.fieldname] || [];
      fileMap[file.fieldname].push(file);
    });

    // Actualizar documentos ARL y Pasocial
    const [currentSolicitud] = await conn.execute(
      'SELECT arl_documento, pasocial_documento FROM solicitudes WHERE id = ?',
      [solicitudId]
    );
    const oldArl = currentSolicitud[0]?.arl_documento;
    const oldPasocial = currentSolicitud[0]?.pasocial_documento;

    for (const field of ['arl', 'pasocial']) {
      if (fileMap[field]?.[0]) {
        const file = fileMap[field][0];
        const oldUrl = field === 'arl' ? oldArl : oldPasocial;
        if (oldUrl) await deleteFromSpaces(oldUrl);
        const newPath = await uploadToSpacesFromDisk(file.path, file.originalname);
        await conn.execute(
          `UPDATE solicitudes SET ${field}_documento = ? WHERE id = ?`,
          [newPath, solicitudId]
        );
      }
    }

    // Actualizar colaboradores existentes
    for (let i = 0; i < colaborador_id.length; i++) {
      const id = colaborador_id[i];
      if (id) {
        const fotoField = `foto_${id}`;
        const cedulaFotoField = `cedula_foto_${id}`;
        for (const field of [fotoField, cedulaFotoField]) {
          if (fileMap[field]?.[0]) {
            const file = fileMap[field][0];
            const campo = field.startsWith('foto_') ? 'foto' : 'cedulaFoto';
            const [rows] = await conn.execute(`SELECT ${campo} FROM colaboradores WHERE id = ?`, [id]);
            if (rows[0]?.[campo]) await deleteFromSpaces(rows[0][campo]);
            const newPath = await uploadToSpacesFromDisk(file.path, file.originalname);
            await conn.execute(
              `UPDATE colaboradores SET ${campo} = ? WHERE id = ?`,
              [newPath, id]
            );
          }
        }
      }
    }

    // Agregar nuevos colaboradores
    if (cedula && nombre) {
      const fotos = fileMap['foto[]'] || [];
      const cedulaFotos = fileMap['cedulaFoto[]'] || [];
      for (let i = 0; i < cedula.length; i++) {
        const [existingColaborador] = await conn.execute(
          'SELECT id FROM colaboradores WHERE solicitud_id = ? AND cedula = ?',
          [solicitudId, cedula[i]]
        );

        if (!existingColaborador.length) {
          const fotoFile = fotos.shift();
          const cedulaFotoFile = cedulaFotos.shift();
          const fotoUrl = fotoFile ? await uploadToSpacesFromDisk(fotoFile.path, fotoFile.originalname) : null;
          const cedulaFotoUrl = cedulaFotoFile ? await uploadToSpacesFromDisk(cedulaFotoFile.path, cedulaFotoFile.originalname) : null;
          await conn.execute(
            'INSERT INTO colaboradores (solicitud_id, cedula, nombre, foto, cedulaFoto, estado) VALUES (?, ?, ?, ?, ?, true)',
            [solicitudId, cedula[i], nombre[i], fotoUrl, cedulaFotoUrl]
          );
        }
      }
    }

    // Actualizar vehículos existentes
    for (let i = 0; i < vehiculo_id.length; i++) {
      const id = vehiculo_id[i];
      if (id) {
        const fields = ['foto_vehiculo', 'tecnomecanica', 'soat', 'licencia_conduccion', 'licencia_transito'];
        for (const field of fields) {
          const fieldName = `${field}_${id}`;
          if (fileMap[fieldName]?.[0]) {
            const file = fileMap[fieldName][0];
            const column = field.replace('foto_vehiculo', 'foto');
            const [rows] = await conn.execute(`SELECT ${column} FROM vehiculos WHERE id = ?`, [id]);
            if (rows[0]?.[column]) await deleteFromSpaces(rows[0][column]);
            const newPath = await uploadToSpacesFromDisk(file.path, file.originalname);
            await conn.execute(
              `UPDATE vehiculos SET ${column} = ? WHERE id = ?`,
              [newPath, id]
            );
          }
        }
      }
    }

    // Agregar nuevos vehículos
    if (matricula && matricula.length) {
      const matriculas = Array.isArray(matricula) ? matricula : [matricula];
      for (let i = 0; i < matriculas.length; i++) {
        const matriculaValue = matriculas[i];
        const [existing] = await conn.execute(
          'SELECT id FROM vehiculos WHERE solicitud_id = ? AND matricula = ? AND estado = 1',
          [solicitudId, matriculaValue]
        );
        if (!existing.length) {
          const vehiculo = {
            matricula: matriculaValue,
            foto: fileMap['foto_vehiculo[]']?.[i] ? await uploadToSpacesFromDisk(fileMap['foto_vehiculo[]'][i].path, fileMap['foto_vehiculo[]'][i].originalname) : null,
            tecnomecanica: fileMap['tecnomecanica[]']?.[i] ? await uploadToSpacesFromDisk(fileMap['tecnomecanica[]'][i].path, fileMap['tecnomecanica[]'][i].originalname) : null,
            soat: fileMap['soat[]']?.[i] ? await uploadToSpacesFromDisk(fileMap['soat[]'][i].path, fileMap['soat[]'][i].originalname) : null,
            licencia_conduccion: fileMap['licencia_conduccion[]']?.[i] ? await uploadToSpacesFromDisk(fileMap['licencia_conduccion[]'][i].path, fileMap['licencia_conduccion[]'][i].originalname) : null,
            licencia_transito: fileMap['licencia_transito[]']?.[i] ? await uploadToSpacesFromDisk(fileMap['licencia_transito[]'][i].path, fileMap['licencia_transito[]'][i].originalname) : null
          };
          await conn.execute(
            'INSERT INTO vehiculos (solicitud_id, matricula, foto, tecnomecanica, soat, licencia_conduccion, licencia_transito) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [solicitudId, vehiculo.matricula, vehiculo.foto, vehiculo.tecnomecanica, vehiculo.soat, vehiculo.licencia_conduccion, vehiculo.licencia_transito]
          );
        }
      }
    }

    await conn.commit();
    res.json({ success: true, message: 'Solicitud actualizada correctamente' });
  } catch (error) {
    await conn.rollback();
    logError(error, '/actualizar-solicitud');
    if (req.files) {
      Object.values(req.files).flat().forEach(async file => {
        try {
          await fs.access(file.path);
          await fs.unlink(file.path);
        } catch (err) {
          // Ignorar errores si el archivo ya no existe
          if (err.code !== 'ENOENT') {
            logError(err, 'Limpieza de archivos temporales');
          }
        }
      });
    }
    res.status(500).json({ success: false, message: error.message });
  } finally {
    conn.release();
  }
});

// Ruta para obtener solicitudes
router.get('/obtener-solicitudes', async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secreto');
    const { id } = decoded;

    const [solicitudes] = await connection.execute(`
      SELECT s.*, us.username AS interventor, a.comentario, 
      CASE 
        WHEN s.estado = 'aprobada' AND a.accion = 'pendiente' THEN 'aprobado por sst'
        WHEN s.estado = 'aprobada' AND a.accion = 'aprobada' AND DATE(s.fin_obra) < CURDATE() THEN 'pendiente ingreso - vencido'
        WHEN s.estado = 'en labor' AND DATE(s.fin_obra) < CURDATE() THEN 'en labor - vencida'
        ELSE s.estado
      END AS estado_actual
      FROM solicitudes s 
      LEFT JOIN users us ON us.id = s.interventor_id
      LEFT JOIN acciones a ON a.solicitud_id = s.id
      WHERE s.usuario_id = ?
      ORDER BY s.id DESC`, [id]);

    const [solicitud_url_download] = await connection.execute(
      'SELECT * FROM sst_documentos WHERE solicitud_id IN (SELECT id FROM solicitudes WHERE usuario_id = ?)',
      [id]
    );

    solicitudes.forEach(solicitud => {
      solicitud.inicio_obra = format(new Date(solicitud.inicio_obra), 'dd/MM/yyyy');
      solicitud.fin_obra = format(new Date(solicitud.fin_obra), 'dd/MM/yyyy');
    });

    res.json({ solicitudes, solicitud_url_download });
  } catch (error) {
    logError(error, '/obtener-solicitudes');
    res.status(500).json({ error: 'Error al obtener solicitudes' });
  }
});

// Ruta para obtener datos de una solicitud
router.get('/obtener-datos-solicitud/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [solicitud] = await connection.execute(`
      SELECT 
        s.*,
        u.empresa,
        u.nit,
        u2.username as interventor_nombre
      FROM solicitudes s
      JOIN users u ON s.usuario_id = u.id
      LEFT JOIN users u2 ON s.interventor_id = u2.id
      WHERE s.id = ?
    `, [id]);

    if (!solicitud[0]) return res.status(404).json({ error: 'Solicitud no encontrada' });

    const [colaboradores] = await connection.execute(
      'SELECT id, cedula, nombre, foto, cedulaFoto, estado, solicitud_id FROM colaboradores WHERE solicitud_id = ? AND estado = 1',
      [id]
    );

    const solicitudData = {
      ...solicitud[0],
      inicio_obra: format(new Date(solicitud[0].inicio_obra), 'yyyy-MM-dd'),
      fin_obra: format(new Date(solicitud[0].fin_obra), 'yyyy-MM-dd'),
      arl_documento: solicitud[0].arl_documento || null,
      pasocial_documento: solicitud[0].pasocial_documento || null,
      interventor_id: solicitud[0].interventor_id
    };

    res.json({
      solicitud: solicitudData,
      colaboradores: colaboradores.map(col => ({ ...col, estado: Boolean(col.estado) }))
    });
  } catch (error) {
    logError(error, '/obtener-datos-solicitud');
    res.status(500).json({ error: 'Error al obtener datos de la solicitud' });
  }
});

// Ruta para obtener vehículos de una solicitud
router.get('/obtener-vehiculos-solicitud/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [vehiculos] = await connection.execute(
      'SELECT id, matricula, foto, tecnomecanica, soat, licencia_conduccion, licencia_transito FROM vehiculos WHERE solicitud_id = ? AND estado = 1',
      [id]
    );
    res.json(vehiculos);
  } catch (error) {
    logError(error, '/obtener-vehiculos-solicitud');
    res.status(500).json({ error: 'Error al obtener vehículos' });
  }
});

// Ruta para desactivar un vehículo
router.post('/desactivar-vehiculo/:id', async (req, res) => {
  try {
    const vehiculoId = req.params.id;
    const [vehiculo] = await connection.execute(
      'SELECT * FROM vehiculos WHERE id = ?',
      [vehiculoId]
    );

    if (vehiculo.length === 0) return res.status(404).json({ error: 'Vehículo no encontrado' });

    await connection.execute(
      'UPDATE vehiculos SET estado = 0 WHERE id = ?',
      [vehiculoId]
    );

    res.status(200).json({ message: 'Vehículo desactivado correctamente' });
  } catch (error) {
    logError(error, '/desactivar-vehiculo');
    res.status(500).json({ error: 'Error al desactivar vehículo' });
  }
});

// Ruta para desactivar un colaborador
router.post('/desactivar-colaborador/:id', async (req, res) => {
  try {
    const colaboradorId = req.params.id;
    const [colaborador] = await connection.execute(
      'SELECT solicitud_id, cedula FROM colaboradores WHERE id = ?',
      [colaboradorId]
    );

    if (colaborador.length === 0) return res.status(404).json({ error: 'Colaborador no encontrado' });

    const [existingInactive] = await connection.execute(
      'SELECT id FROM colaboradores WHERE solicitud_id = ? AND cedula = ? AND estado = false',
      [colaborador[0].solicitud_id, colaborador[0].cedula]
    );

    if (existingInactive.length === 0) {
      await connection.execute(
        'UPDATE colaboradores SET estado = FALSE WHERE id = ?',
        [colaboradorId]
      );

      await connection.execute(
        'INSERT INTO historial_estados_colaboradores (colaborador_id, solicitud_id, estado) VALUES (?, ?, FALSE)',
        [colaboradorId, colaborador[0].solicitud_id]
      );
    }

    res.status(200).json({ message: 'Colaborador desactivado correctamente' });
  } catch (error) {
    logError(error, '/desactivar-colaborador');
    res.status(500).json({ error: 'Error al desactivar colaborador' });
  }
});

// Ruta para actualizar el estado de un colaborador
router.put('/actualizar-estado-colaborador/:id', async (req, res) => {
  try {
    const colaboradorId = req.params.id;
    const { estado } = req.body;

    if (typeof estado !== 'boolean') return res.status(400).json({ success: false, message: 'El estado debe ser true o false' });

    const [result] = await connection.execute(
      'UPDATE colaboradores SET estado = ? WHERE id = ?',
      [estado, colaboradorId]
    );

    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Colaborador no encontrado' });

    await connection.execute(
      'INSERT INTO historial_estados_colaboradores (colaborador_id, solicitud_id, estado) SELECT ?, solicitud_id, ? FROM colaboradores WHERE id = ?',
      [colaboradorId, estado, colaboradorId]
    );

    const [updatedColaborador] = await connection.execute(
      'SELECT id, cedula, nombre, foto, cedulaFoto, estado FROM colaboradores WHERE id = ?',
      [colaboradorId]
    );

    res.json({
      success: true,
      message: 'Estado actualizado correctamente',
      colaborador: updatedColaborador[0]
    });
  } catch (error) {
    logError(error, '/actualizar-estado-colaborador');
    res.status(500).json({ success: false, message: 'Error al actualizar el estado' });
  }
});

// Ruta para obtener colaboradores inactivos
router.get('/obtener-colaboradores-inactivos/:solicitudId', async (req, res) => {
  try {
    const { solicitudId } = req.params;
    const [colaboradores] = await connection.execute(
      'SELECT id, cedula, nombre, foto, cedulaFoto FROM colaboradores WHERE solicitud_id = ? AND estado = false',
      [solicitudId]
    );
    res.json({ success: true, colaboradores });
  } catch (error) {
    logError(error, '/obtener-colaboradores-inactivos');
    res.status(500).json({ success: false, message: 'Error al obtener colaboradores inactivos' });
  }
});

// Ruta para obtener todos los colaboradores
router.get('/obtener-colaboradores-todos/:solicitudId', async (req, res) => {
  try {
    const { solicitudId } = req.params;
    const [solicitudData] = await connection.execute(
      'SELECT id, empresa, nit FROM solicitudes WHERE id = ?',
      [solicitudId]
    );

    if (!solicitudData.length) return res.status(404).json({ success: false, message: 'Solicitud no encontrada' });

    const [colaboradores] = await connection.execute(
      'SELECT id, cedula, nombre, foto, cedulaFoto, estado FROM colaboradores WHERE solicitud_id = ?',
      [solicitudId]
    );

    res.json({
      success: true,
      solicitud: solicitudData[0],
      colaboradores: colaboradores.map(col => ({ ...col, estado: Boolean(col.estado) }))
    });
  } catch (error) {
    logError(error, '/obtener-colaboradores-todos');
    res.status(500).json({ success: false, message: 'Error al obtener colaboradores', error: error.message });
  }
});

// Ruta para obtener historial del colaborador
router.get('/obtener-historial-colaborador/:colaboradorId', async (req, res) => {
  try {
    const { colaboradorId } = req.params;
    const [historial] = await connection.execute(`
      SELECT 
        c.nombre AS nombre_colaborador,
        u.empresa,
        u.nit,
        r.tipo,
        DATE_FORMAT(r.fecha_hora, '%d/%m/%Y %H:%i:%s') as fecha_hora,
        r.estado_actual,
        s.lugar,
        DATE_FORMAT(r.created_at, '%d/%m/%Y %H:%i:%s') as registro_hecho,
        us.username AS usuario_registro
      FROM registros r
      JOIN colaboradores c ON r.colaborador_id = c.id
      JOIN solicitudes s ON r.solicitud_id = s.id
      JOIN users u ON s.usuario_id = u.id
      JOIN users us ON r.usuario_id = us.id
      WHERE r.colaborador_id = ?
      ORDER BY r.fecha_hora DESC
    `, [colaboradorId]);
    res.json(historial);
  } catch (error) {
    logError(error, '/obtener-historial-colaborador');
    res.status(500).json({ success: false, message: 'Error al obtener historial', error: error.message });
  }
});

// Ruta para obtener datos de un colaborador específico
router.get('/obtener-colaborador/:colaboradorId', async (req, res) => {
  try {
    const { colaboradorId } = req.params;
    const [colaboradores] = await connection.execute(
      'SELECT id, cedula, nombre, foto, cedulaFoto, estado, solicitud_id FROM colaboradores WHERE id = ?',
      [colaboradorId]
    );

    if (!colaboradores.length) return res.status(404).json({ success: false, message: 'Colaborador no encontrado' });

    res.json(colaboradores[0]);
  } catch (error) {
    logError(error, '/obtener-colaborador');
    res.status(500).json({ success: false, message: 'Error al obtener datos del colaborador', error: error.message });
  }
});

// Ruta para la vista del contratista
router.get('/vista-contratista', (req, res) => {
  logInfo('[RUTA] Se accede a la vista del contratista');
  controller.vistaContratista(req, res);
});

// Middleware de manejo de errores global para las rutas
router.use((err, req, res, next) => {
  logError(err, req.path);
  
  if (err instanceof multer.MulterError) {
    if (req.files) {
      Object.values(req.files).flat().forEach(async file => {
        try {
          await fs.access(file.path);
          await fs.unlink(file.path);
        } catch (err) {
          // Ignorar errores si el archivo ya no existe
          if (err.code !== 'ENOENT') {
            logError(err, 'Limpieza de archivos temporales');
          }
        }
      });
    }
    return res.status(400).json({
      error: 'Error en la carga de archivos',
      details: err.message
    });
  }
  
  if (req.files) {
    Object.values(req.files).flat().forEach(async file => {
      try {
        await fs.access(file.path);
        await fs.unlink(file.path);
      } catch (err) {
        // Ignorar errores si el archivo ya no existe
        if (err.code !== 'ENOENT') {
          logError(err, 'Limpieza de archivos temporales');
        }
      }
    });
  }
  res.status(500).json({
    error: 'Error interno del servidor',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

module.exports = router;