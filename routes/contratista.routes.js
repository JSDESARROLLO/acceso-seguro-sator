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
const emailService = require('../services/email.service');
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
    'image/jpeg': ['.jpg', '.jpeg', '.jfif', '.jpe'],
    'image/png': ['.png'],
    'application/pdf': ['.pdf'],
    'application/msword': ['.doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    'image/webp': ['.webp'],
    'image/gif': ['.gif'],
    'image/bmp': ['.bmp'],
    'image/x-ms-bmp': ['.bmp']
  };
  
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeType = file.mimetype.toLowerCase();
  
  logInfo('Validando archivo:', { filename: file.originalname, mimeType, extension: ext });

  // Verificar si es una imagen o documento permitido
  const isAllowedType = Object.entries(allowedTypes).some(([type, extensions]) => {
    return type.toLowerCase() === mimeType || extensions.includes(ext);
  });

  if (isAllowedType) {
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

// Función para limpiar archivos temporales
async function cleanupTempFiles(filePath) {
  try {
    if (!filePath) return;
    await fs.access(filePath);
    await fs.unlink(filePath);
    logInfo('Archivo temporal eliminado:', { filePath });
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logError(err, 'Limpieza de archivos temporales');
    }
  }
}

// Función para limpiar todos los archivos temporales de una solicitud
async function cleanupAllTempFiles(files) {
  if (!files || !Array.isArray(files)) return;
  
  for (const file of files) {
    try {
      if (file && file.path) {
        await cleanupTempFiles(file.path);
      }
    } catch (error) {
      logError(error, 'Limpieza de archivos temporales en batch');
    }
  }
}

// Middleware de limpieza de archivos temporales
const cleanupMiddleware = async (req, res, next) => {
  try {
    if (req.files) {
      await cleanupAllTempFiles(req.files);
    }
    next();
  } catch (error) {
    logError(error, 'Middleware de limpieza');
    next();
  }
};

// Aplicar middleware de limpieza a todas las rutas que manejan archivos
router.use(cleanupMiddleware);

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
      
      // Limpiar archivo temporal después de subirlo exitosamente
      await cleanupTempFiles(filePath);
      
      return spacesUrl;
    } catch (error) {
      attempt++;
      logError(error, `uploadToSpacesFromDisk (intento ${attempt}/${retries})`);
      if (attempt === retries) {
        // Limpiar archivo temporal si fallan todos los intentos
        await cleanupTempFiles(filePath);
        throw new Error(`Fallo al subir archivo tras ${retries} intentos: ${error.message}`);
      }
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

    // Obtener todos los documentos SST de la solicitud
    const [docs] = await conn.execute(
      'SELECT id, url FROM sst_documentos WHERE solicitud_id = ?',
      [solicitudId]
    );

    logInfo('Documentos SST encontrados:', { count: docs.length, docs });

    // Borrar cada documento de DigitalOcean
    for (const doc of docs) {
      try {
        // Extraer la clave del archivo de la URL completa
        const urlParts = doc.url.split('/');
        const fileKey = urlParts.slice(3).join('/'); // Obtener la ruta después del bucket y endpoint

        const command = new DeleteObjectCommand({
          Bucket: process.env.DO_SPACES_BUCKET,
          Key: fileKey
        });

        logInfo('Intentando borrar archivo de Spaces:', { url: doc.url, fileKey });
        await s3Client.send(command);
        logInfo('Archivo borrado exitosamente de Spaces:', { url: doc.url });
      } catch (error) {
        logError(error, `Error al borrar documento de DigitalOcean: ${doc.url}`);
        // Continuar con el siguiente documento incluso si hay error
      }
    }

    // Borrar todos los registros de la base de datos
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
router.post('/generar-solicitud', upload.any(), async (req, res) => {
  const conn = await connection.getConnection();
  try {
    logInfo('Iniciando generación de solicitud', { body: req.body });
    await conn.beginTransaction();

    const uploadedFiles = req.files || {};
    logInfo('Archivos recibidos:', { 
      fileCount: Object.keys(uploadedFiles || {}).reduce((acc, key) => acc + uploadedFiles[key].length, 0) 
    });

    const fileMap = {};
    uploadedFiles.forEach(file => {
      fileMap[file.fieldname] = fileMap[file.fieldname] || [];
      fileMap[file.fieldname].push(file);
    });

    const fileNames = {
      foto: [],
      cedulaFoto: [],
      arl: null,
      pasocial: null,
      vehiculos: []
    };

    // Procesar documentos principales
    if (fileMap['arl']?.[0]) {
      fileNames.arl = await uploadToSpacesFromDisk(fileMap['arl'][0].path, fileMap['arl'][0].originalname);
    }
    if (fileMap['pasocial']?.[0]) {
      fileNames.pasocial = await uploadToSpacesFromDisk(fileMap['pasocial'][0].path, fileMap['pasocial'][0].originalname);
    }

    // Procesar fotos y cédulas
    if (fileMap['foto[]']) {
      for (const file of fileMap['foto[]']) {
        fileNames.foto.push(await uploadToSpacesFromDisk(file.path, file.originalname));
      }
    }
    if (fileMap['cedulaFoto[]']) {
      for (const file of fileMap['cedulaFoto[]']) {
        fileNames.cedulaFoto.push(await uploadToSpacesFromDisk(file.path, file.originalname));
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
          foto: fileMap['foto_vehiculo[]']?.[i] ? await uploadToSpacesFromDisk(fileMap['foto_vehiculo[]'][i].path, fileMap['foto_vehiculo[]'][i].originalname) : null,
          tecnomecanica: fileMap['tecnomecanica[]']?.[i] ? await uploadToSpacesFromDisk(fileMap['tecnomecanica[]'][i].path, fileMap['tecnomecanica[]'][i].originalname) : null,
          soat: fileMap['soat[]']?.[i] ? await uploadToSpacesFromDisk(fileMap['soat[]'][i].path, fileMap['soat[]'][i].originalname) : null,
          licencia_conduccion: fileMap['licencia_conduccion[]']?.[i] ? await uploadToSpacesFromDisk(fileMap['licencia_conduccion[]'][i].path, fileMap['licencia_conduccion[]'][i].originalname) : null,
          licencia_transito: fileMap['licencia_transito[]']?.[i] ? await uploadToSpacesFromDisk(fileMap['licencia_transito[]'][i].path, fileMap['licencia_transito[]'][i].originalname) : null
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
    await cleanupAllTempFiles(req.files);
    res.status(500).json({ 
      error: 'Error al crear la solicitud',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    // Limpiar archivos temporales después de procesar la solicitud
    await cleanupAllTempFiles(req.files);
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
      const { cedula, nombre, colaborador_id = [], matricula, vehiculo_id = [], renovacion, inicio_obra, fin_obra, dias_trabajo, lugar, labor, cambios } = req.body;
  
      // Parsear los cambios si existen
      const cambiosDetectados = cambios ? JSON.parse(cambios) : {
        colaboradores: { nuevos: [], modificados: [], eliminados: [] },
        vehiculos: { nuevos: [], modificados: [], eliminados: [] },
        documentos: { arl: false, pasocial: false }
      };
  
      // Obtener información de la solicitud y el contratista
      const [solicitudInfo] = await conn.execute(`
        SELECT s.*, u.empresa, u.nit, u.email as email_contratista, l.nombre_lugar
        FROM solicitudes s
        JOIN users u ON s.usuario_id = u.id
        JOIN lugares l ON s.lugar = l.id
        WHERE s.id = ?
      `, [solicitudId]);
  
      if (!solicitudInfo || solicitudInfo.length === 0) {
        throw new Error('No se encontró la solicitud');
      }
  
      // Actualizar datos básicos de la solicitud si se proporcionan
      if (inicio_obra || fin_obra || dias_trabajo || lugar || labor) {
        const updateFields = [];
        const updateValues = [];
  
        if (inicio_obra) {
          updateFields.push('inicio_obra = ?');
          updateValues.push(inicio_obra);
        }
        if (fin_obra) {
          updateFields.push('fin_obra = ?');
          updateValues.push(fin_obra);
        }
        if (dias_trabajo) {
          updateFields.push('dias_trabajo = ?');
          updateValues.push(dias_trabajo);
        }
        if (lugar) {
          updateFields.push('lugar = ?');
          updateValues.push(lugar);
        }
        if (labor) {
          updateFields.push('labor = ?');
          updateValues.push(labor);
        }
  
        if (updateFields.length > 0) {
          const updateQuery = `UPDATE solicitudes SET ${updateFields.join(', ')} WHERE id = ?`;
          updateValues.push(solicitudId);
          await conn.execute(updateQuery, updateValues);
        }
      }
  
      // Obtener usuarios SST
      const [usuariosSST] = await conn.execute(`
        SELECT u.email, u.username
        FROM users u
        JOIN roles r ON u.role_id = r.id
        WHERE r.role_name = 'sst'
        AND u.email IS NOT NULL
        AND u.email != ''
      `);
  
      // Log de los datos recibidos
      logInfo('Datos recibidos:', { 
        inicio_obra, 
        fin_obra, 
        dias_trabajo, 
        lugar, 
        labor,
        cedula: cedula?.length,
        matricula: matricula?.length,
        files: Object.keys(uploadedFiles || {}).length,
        cambios: cambiosDetectados
      });
  
      // Obtener el nombre del lugar si se proporciona un ID
      let nombreLugar = lugar;
      if (lugar) {
        const [lugarInfo] = await conn.execute(
          'SELECT nombre_lugar FROM lugares WHERE id = ?',
          [lugar]
        );
        if (lugarInfo.length > 0) {
          nombreLugar = lugarInfo[0].nombre_lugar;
        }
      }
  
      // Verificar si hay cambios reales basados en la información del frontend
      const hayCambios = cambiosDetectados && (
        cambiosDetectados.colaboradores.nuevos.length > 0 ||
        cambiosDetectados.colaboradores.modificados.length > 0 ||
        cambiosDetectados.colaboradores.eliminados.length > 0 ||
        cambiosDetectados.vehiculos.nuevos.length > 0 ||
        cambiosDetectados.vehiculos.modificados.length > 0 ||
        cambiosDetectados.vehiculos.eliminados.length > 0 ||
        cambiosDetectados.documentos.arl ||
        cambiosDetectados.documentos.pasocial
      );
  
      // Definir variables para detectar cambios específicos
      const hayCambiosColaboradores =
        cambiosDetectados &&
        (cambiosDetectados.colaboradores.nuevos.length > 0 ||
          cambiosDetectados.colaboradores.modificados.length > 0 ||
          cambiosDetectados.colaboradores.eliminados.length > 0);
  
      const hayCambiosVehiculos =
        cambiosDetectados &&
        (cambiosDetectados.vehiculos.nuevos.length > 0 ||
          cambiosDetectados.vehiculos.modificados.length > 0 ||
          cambiosDetectados.vehiculos.eliminados.length > 0);
  
      const hayCambiosDocumentos =
        cambiosDetectados && (cambiosDetectados.documentos.arl || cambiosDetectados.documentos.pasocial);
  
      // Log detallado de los cambios detectados
      logInfo('Cambios detectados:', { 
        cambiosDetectados,
        hayCambios,
        renovacion
      });
  
      // Determinar si es una nueva solicitud o una actualización
      const esNuevaSolicitud = !solicitudId || solicitudId === 'null';
  
      if (esNuevaSolicitud) {
        logInfo('Creando nueva solicitud');
        
        // Obtener datos del usuario actual
        const [usuarioActual] = await conn.execute(
          'SELECT empresa, nit, email FROM users WHERE id = ?',
          [req.user.id]
        );
  
        if (!usuarioActual.length) {
          throw new Error('No se encontró información del usuario');
        }
  
        // Obtener interventor_id y datos del body
        const { interventor_id, lugar, labor, inicio_obra, fin_obra, dias_trabajo } = req.body;
        if (!interventor_id) {
          throw new Error('El interventor_id es requerido');
        }
  
        // Preparar los documentos principales
        const documentosPrincipales = {
          arl: uploadedFiles['arl']?.[0] ? await uploadToSpacesFromDisk(uploadedFiles['arl'][0].path, uploadedFiles['arl'][0].originalname) : null,
          pasocial: uploadedFiles['pasocial']?.[0] ? await uploadToSpacesFromDisk(uploadedFiles['pasocial'][0].path, uploadedFiles['pasocial'][0].originalname) : null
        };
  
        // Crear nueva solicitud
        const query = `
          INSERT INTO solicitudes (usuario_id, empresa, nit, inicio_obra, fin_obra, dias_trabajo, lugar, labor, interventor_id, arl_documento, pasocial_documento)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        `;
        const [result] = await conn.execute(query, [
          req.user.id, 
          usuarioActual[0].empresa, 
          usuarioActual[0].nit, 
          inicio_obra, 
          fin_obra, 
          dias_trabajo, 
          lugar, 
          labor, 
          interventor_id,
          documentosPrincipales.arl,
          documentosPrincipales.pasocial
        ]);
  
        const solicitudId = result.insertId;
  
        // Procesar colaboradores
        if (cambiosDetectados?.colaboradores?.nuevos?.length > 0) {
          const fotos = uploadedFiles['foto[]'] || [];
          const cedulaFotos = uploadedFiles['cedulaFoto[]'] || [];
          
          for (let i = 0; i < cambiosDetectados.colaboradores.nuevos.length; i++) {
            const colaborador = cambiosDetectados.colaboradores.nuevos[i];
            const fotoFile = fotos[i];
            const cedulaFotoFile = cedulaFotos[i];
            
            const fotoUrl = fotoFile ? await uploadToSpacesFromDisk(fotoFile.path, fotoFile.originalname) : null;
            const cedulaFotoUrl = cedulaFotoFile ? await uploadToSpacesFromDisk(cedulaFotoFile.path, cedulaFotoFile.originalname) : null;
            
            await conn.execute(
              'INSERT INTO colaboradores (solicitud_id, cedula, nombre, foto, cedulaFoto, estado) VALUES (?, ?, ?, ?, ?, true)',
              [solicitudId, colaborador.cedula, colaborador.nombre, fotoUrl, cedulaFotoUrl]
            );
          }
        }
  
        // Procesar vehículos
        if (cambiosDetectados?.vehiculos?.nuevos?.length > 0) {
          for (let i = 0; i < cambiosDetectados.vehiculos.nuevos.length; i++) {
            const vehiculo = cambiosDetectados.vehiculos.nuevos[i];
            const vehiculoArchivos = {
              foto: uploadedFiles['foto_vehiculo[]']?.[i] ? await uploadToSpacesFromDisk(uploadedFiles['foto_vehiculo[]'][i].path, uploadedFiles['foto_vehiculo[]'][i].originalname) : null,
              tecnomecanica: uploadedFiles['tecnomecanica[]']?.[i] ? await uploadToSpacesFromDisk(uploadedFiles['tecnomecanica[]'][i].path, uploadedFiles['tecnomecanica[]'][i].originalname) : null,
              soat: uploadedFiles['soat[]']?.[i] ? await uploadToSpacesFromDisk(uploadedFiles['soat[]'][i].path, uploadedFiles['soat[]'][i].originalname) : null,
              licencia_conduccion: uploadedFiles['licencia_conduccion[]']?.[i] ? await uploadToSpacesFromDisk(uploadedFiles['licencia_conduccion[]'][i].path, uploadedFiles['licencia_conduccion[]'][i].originalname) : null,
              licencia_transito: uploadedFiles['licencia_transito[]']?.[i] ? await uploadToSpacesFromDisk(uploadedFiles['licencia_transito[]'][i].path, uploadedFiles['licencia_transito[]'][i].originalname) : null
            };
  
            await conn.execute(
              'INSERT INTO vehiculos (solicitud_id, matricula, foto, tecnomecanica, soat, licencia_conduccion, licencia_transito, estado) VALUES (?, ?, ?, ?, ?, ?, ?, true)',
              [solicitudId, vehiculo.matricula, vehiculoArchivos.foto, vehiculoArchivos.tecnomecanica, vehiculoArchivos.soat, vehiculoArchivos.licencia_conduccion, vehiculoArchivos.licencia_transito]
            );
          }
        }
  
        // Enviar correo a usuarios SST
        if (usuariosSST.length > 0) {
          const asunto = `Nueva Solicitud #${solicitudId} - ${usuarioActual[0].empresa}`;
          
          let detallesHtml = `
            <h4>Detalles de la Solicitud:</h4>
            <ul>
              <li>Lugar: ${nombreLugar}</li>
              <li>Labor: ${labor}</li>
              <li>Fecha de inicio: ${inicio_obra}</li>
              <li>Fecha de fin: ${fin_obra}</li>
              <li>Días de trabajo: ${dias_trabajo}</li>
            </ul>
          `;
  
          if (cambiosDetectados?.colaboradores?.nuevos?.length > 0) {
            detallesHtml += `
              <h4>Colaboradores:</h4>
              <ul>
                ${cambiosDetectados.colaboradores.nuevos.map(col => `
                  <li>${col.nombre} (${col.cedula})</li>
                `).join('')}
              </ul>
            `;
          }
  
          if (cambiosDetectados?.vehiculos?.nuevos?.length > 0) {
            detallesHtml += `
              <h4>Vehículos:</h4>
              <ul>
                ${cambiosDetectados.vehiculos.nuevos.map(veh => `
                  <li>${veh.matricula}</li>
                `).join('')}
              </ul>
            `;
          }
  
          for (const usuario of usuariosSST) {
            try {
              await emailService.sendEmail(
                usuario.email,
                asunto,
                {
                  template: 'notification',
                  context: {
                    asunto,
                    empresa: usuarioActual[0].empresa,
                    nit: usuarioActual[0].nit,
                    solicitudId,
                    tipoOperacion: 'Nueva Solicitud',
                    fechaModificacion: new Date().toLocaleDateString('es-CO'),
                    detallesCambios: detallesHtml,
                    currentYear: new Date().getFullYear()
                  }
                }
              );
            } catch (error) {
              console.error(`Error al enviar correo a ${usuario.email}:`, error);
            }
          }
        }
  
        await conn.commit();
        return res.json({ 
          success: true, 
          message: 'Solicitud creada correctamente',
          solicitudId: solicitudId
        });
      } else {
        // Borrar documentos SST solo si hay cambios reales y la solicitud existe
        if (hayCambios) {
          logInfo('Borrando documentos SST:', { solicitudId, renovacion, hayCambios, cambiosDetectados });
          await deleteSSTDocuments(solicitudId);
        } else {
          logInfo('No se borraron documentos SST:', { 
            solicitudId, 
            renovacion, 
            hayCambios, 
            cambiosDetectados,
            razon: 'Sin cambios detectados'
          });
        }
  
        const fileMap = {};
        uploadedFiles.forEach(file => {
          fileMap[file.fieldname] = fileMap[file.fieldname] || [];
          fileMap[file.fieldname].push(file);
        });
  
        // Actualizar documentos ARL y Pasocial solo si hay cambios
        if (cambiosDetectados?.documentos.arl || cambiosDetectados?.documentos.pasocial) {
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
        }
  
        // Actualizar colaboradores existentes solo si hay cambios
        if (cambiosDetectados?.colaboradores.modificados.length > 0) {
          for (const colaborador of cambiosDetectados.colaboradores.modificados) {
            const id = colaborador.id;
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
        if (cambiosDetectados?.colaboradores.nuevos.length > 0) {
          const fotos = fileMap['foto[]'] || [];
          const cedulaFotos = fileMap['cedulaFoto[]'] || [];
          
          for (const nuevoColaborador of cambiosDetectados.colaboradores.nuevos) {
            const [existingColaborador] = await conn.execute(
              'SELECT id FROM colaboradores WHERE solicitud_id = ? AND cedula = ?',
              [solicitudId, nuevoColaborador.cedula]
            );
  
            if (!existingColaborador.length) {
              const fotoFile = fotos.shift();
              const cedulaFotoFile = cedulaFotos.shift();
              const fotoUrl = fotoFile ? await uploadToSpacesFromDisk(fotoFile.path, fotoFile.originalname) : null;
              const cedulaFotoUrl = cedulaFotoFile ? await uploadToSpacesFromDisk(cedulaFotoFile.path, cedulaFotoFile.originalname) : null;
              await conn.execute(
                'INSERT INTO colaboradores (solicitud_id, cedula, nombre, foto, cedulaFoto, estado) VALUES (?, ?, ?, ?, ?, true)',
                [solicitudId, nuevoColaborador.cedula, nuevoColaborador.nombre, fotoUrl, cedulaFotoUrl]
              );
            }
          }
        }
  
        // Actualizar vehículos existentes solo si hay cambios
        if (cambiosDetectados?.vehiculos.modificados.length > 0) {
          for (const vehiculo of cambiosDetectados.vehiculos.modificados) {
            const id = vehiculo.id;
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
        if (cambiosDetectados?.vehiculos.nuevos.length > 0) {
          for (const nuevoVehiculo of cambiosDetectados.vehiculos.nuevos) {
            const [existing] = await conn.execute(
              'SELECT id FROM vehiculos WHERE solicitud_id = ? AND matricula = ? AND estado = 1',
              [solicitudId, nuevoVehiculo.matricula]
            );
            
            if (!existing.length) {
              const vehiculo = {
                matricula: nuevoVehiculo.matricula,
                foto: fileMap['foto_vehiculo[]']?.[0] ? await uploadToSpacesFromDisk(fileMap['foto_vehiculo[]'][0].path, fileMap['foto_vehiculo[]'][0].originalname) : null,
                tecnomecanica: fileMap['tecnomecanica[]']?.[0] ? await uploadToSpacesFromDisk(fileMap['tecnomecanica[]'][0].path, fileMap['tecnomecanica[]'][0].originalname) : null,
                soat: fileMap['soat[]']?.[0] ? await uploadToSpacesFromDisk(fileMap['soat[]'][0].path, fileMap['soat[]'][0].originalname) : null,
                licencia_conduccion: fileMap['licencia_conduccion[]']?.[0] ? await uploadToSpacesFromDisk(fileMap['licencia_conduccion[]'][0].path, fileMap['licencia_conduccion[]'][0].originalname) : null,
                licencia_transito: fileMap['licencia_transito[]']?.[0] ? await uploadToSpacesFromDisk(fileMap['licencia_transito[]'][0].path, fileMap['licencia_transito[]'][0].originalname) : null
              };
              await conn.execute(
                'INSERT INTO vehiculos (solicitud_id, matricula, foto, tecnomecanica, soat, licencia_conduccion, licencia_transito) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [solicitudId, vehiculo.matricula, vehiculo.foto, vehiculo.tecnomecanica, vehiculo.soat, vehiculo.licencia_conduccion, vehiculo.licencia_transito]
              );
            }
          }
        }
  
        await conn.commit();
  
        // Enviar correo a usuarios SST si hay cambios
        if (hayCambios && usuariosSST.length > 0) {
          const asunto = renovacion
            ? `Renovación de Solicitud #${solicitudId} - ${solicitudInfo[0].empresa}`
            : `Actualización de Solicitud #${solicitudId} - ${solicitudInfo[0].empresa}`;
  
          // Preparar los detalles de cambios en HTML
          let detallesCambiosHtml = renovacion
            ? '<p><strong>Esta es una renovación de la solicitud.</strong></p>'
            : '<p><strong>Se han realizado las siguientes actualizaciones:</strong></p>';
  
          // Log detallado de los cambios
          logInfo('Procesando cambios para el correo:', {
            colaboradoresModificados: cambiosDetectados.colaboradores.modificados,
            solicitudInfo: solicitudInfo[0],
            cambiosDetectados: cambiosDetectados,
          });
  
          // Colaboradores
          if (hayCambiosColaboradores) {
            if (cambiosDetectados.colaboradores.nuevos.length > 0) {
              detallesCambiosHtml += `
                <h4>Colaboradores Nuevos:</h4>
                <ul>
                  ${cambiosDetectados.colaboradores.nuevos
                    .map((col) => `<li>${col.nombre} (Cédula: ${col.cedula})</li>`)
                    .join('')}
                </ul>
              `;
            }
  
            if (cambiosDetectados.colaboradores.modificados.length > 0) {
              detallesCambiosHtml += '<h4>Colaboradores Modificados:</h4><ul>';
              for (const col of cambiosDetectados.colaboradores.modificados) {
                const [colaboradorData] = await conn.execute(
                  'SELECT nombre, cedula, foto, cedulaFoto FROM colaboradores WHERE id = ?',
                  [col.id]
                );
                if (colaboradorData.length > 0) {
                  const colaborador = colaboradorData[0];
                  const cambios = col.cambios || {};
                  const cambiosList = [];
                  
                  if (cambios.foto) cambiosList.push('Foto actualizada');
                  if (cambios.cedulaFoto) cambiosList.push('Foto de cédula actualizada');
                  if (cambios.cedula) cambiosList.push('Cédula actualizada');
                  
                  detallesCambiosHtml += `
                    <li>${colaborador.nombre} (Cédula: ${colaborador.cedula}) - ${
                      cambiosList.length > 0 ? cambiosList.join(', ') : 'Detalles no especificados'
                    }</li>
                  `;
                }
              }
              detallesCambiosHtml += '</ul>';
            }
  
            if (cambiosDetectados.colaboradores.eliminados.length > 0) {
              detallesCambiosHtml += `
                <h4>Colaboradores Eliminados:</h4>
                <ul>
                  ${cambiosDetectados.colaboradores.eliminados
                    .map((col) => `<li>${col.nombre} (Cédula: ${col.cedula})</li>`)
                    .join('')}
                </ul>
              `;
            }
          }
  
          // Vehículos
          if (hayCambiosVehiculos) {
            if (cambiosDetectados.vehiculos.nuevos.length > 0) {
              detallesCambiosHtml += `
                <h4>Vehículos Nuevos:</h4>
                <ul>
                  ${cambiosDetectados.vehiculos.nuevos
                    .map((veh) => `<li>Matrícula: ${veh.matricula}</li>`)
                    .join('')}
                </ul>
              `;
            }
  
            if (cambiosDetectados.vehiculos.modificados.length > 0) {
              detallesCambiosHtml += '<h4>Vehículos Modificados:</h4><ul>';
              for (const veh of cambiosDetectados.vehiculos.modificados) {
                const [vehiculoData] = await conn.execute(
                  'SELECT matricula, foto, tecnomecanica, soat, licencia_conduccion, licencia_transito FROM vehiculos WHERE id = ?',
                  [veh.id]
                );
                if (vehiculoData.length > 0) {
                  const vehiculo = vehiculoData[0];
                  const cambios = veh.cambios || {};
                  const cambiosList = [];
                  if (cambios.foto) cambiosList.push(`Foto actualizada  `);
                  if (cambios.tecnomecanica)
                    cambiosList.push(`Tecnomecánica actualizada `);
                  if (cambios.soat) cambiosList.push(`SOAT actualizado  `);
                  if (cambios.licencia_conduccion)
                    cambiosList.push(`Licencia de conducción actualizada`);
                  if (cambios.licencia_transito)
                    cambiosList.push(`Licencia de tránsito actualizada`);
  
                  detallesCambiosHtml += `
                    <li>Matrícula: ${vehiculo.matricula} - ${
                      cambiosList.length > 0 ? 'Cambios: ' + cambiosList.join(', ') : 'Detalles no especificados'
                    }</li>
                  `;
                }
              }
              detallesCambiosHtml += '</ul>';
            }
  
            if (cambiosDetectados.vehiculos.eliminados.length > 0) {
              detallesCambiosHtml += `
                <h4>Vehículos Eliminados:</h4>
                <ul>
                  ${cambiosDetectados.vehiculos.eliminados
                    .map((veh) => `<li>Matrícula: ${veh.matricula}</li>`)
                    .join('')}
                </ul>
              `;
            }
          }
  
          // Documentos (ARL y Pasocial)
          if (hayCambiosDocumentos) {
            const documentosActualizados = [];
            if (cambiosDetectados.documentos.arl)
              documentosActualizados.push(
                `<li>ARL: Actualizado </li>`
              );
            if (cambiosDetectados.documentos.pasocial)
              documentosActualizados.push(
                `<li>Pasocial: Actualizado </li>`
              );
  
            if (documentosActualizados.length > 0) {
              detallesCambiosHtml += `
                <h4>Documentos Actualizados:</h4>
                <ul>${documentosActualizados.join('')}</ul>
              `;
            }
          }
  
          // Si no hay cambios específicos, mostrar mensaje genérico
          if (!hayCambiosColaboradores && !hayCambiosVehiculos && !hayCambiosDocumentos) {
            detallesCambiosHtml += '<p class="no-changes">No se detectaron cambios específicos.</p>';
          }
  
          // Log final del HTML generado
          logInfo('HTML generado para el correo:', { detallesCambiosHtml });
  
          // Enviar correo a cada usuario SST
          for (const usuario of usuariosSST) {
            try {
                await emailService.sendEmail(usuario.email, asunto, {
                    template: 'notification',
                    context: {
                      asunto,
                      empresa: solicitudInfo[0].empresa || 'No especificada',
                      nit: solicitudInfo[0].nit || 'No especificado',
                      solicitudId: solicitudId || 'No especificado',
                      tipoOperacion: renovacion ? 'Renovación' : 'Actualización',
                      fechaModificacion: new Date().toLocaleDateString('es-CO'),
                      detallesCambios: detallesCambiosHtml,
                      currentYear: new Date().getFullYear(),
                    },
                  });
            } catch (error) {
              console.error(`Error al enviar correo a ${usuario.email}:`, error);
            }
          }
        }
  
        res.json({ 
          success: true, 
          message: 'Solicitud actualizada correctamente',
          cambios: cambiosDetectados
        });
      }
    } catch (error) {
      await conn.rollback();
      logError(error, '/actualizar-solicitud');
      
      // Limpiar archivos temporales en caso de error
      await cleanupAllTempFiles(req.files);

      // Enviar respuesta de error más específica
      let errorMessage = 'Error al actualizar la solicitud';
      let statusCode = 500;

      if (error.message === 'No se encontró la solicitud') {
        errorMessage = 'La solicitud no existe';
        statusCode = 404;
      } else if (error.code === 'ER_NO_REFERENCED_ROW_2') {
        errorMessage = 'Uno o más campos hacen referencia a registros que no existen';
        statusCode = 400;
      } else if (error.code === 'ER_DUP_ENTRY') {
        errorMessage = 'Ya existe un registro con esos datos';
        statusCode = 409;
      }

      res.status(statusCode).json({ 
        success: false,
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    } finally {
      // Limpiar archivos temporales después de procesar la solicitud
      await cleanupAllTempFiles(req.files);
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
    logInfo('Obteniendo datos de solicitud:', { id });

    const [solicitud] = await connection.execute(`
      SELECT 
        s.*,
        u.empresa,
        u.nit,
        u2.username as interventor_nombre,
        l.nombre_lugar,
        l.id as lugar_id
      FROM solicitudes s
      JOIN users u ON s.usuario_id = u.id
      LEFT JOIN users u2 ON s.interventor_id = u2.id
      LEFT JOIN lugares l ON s.lugar = l.id
      WHERE s.id = ?
    `, [id]);
 

    if (!solicitud[0]) {
      logError('Solicitud no encontrada:', { id });
      return res.status(404).json({ error: 'Solicitud no encontrada' });
    }

    const [colaboradores] = await connection.execute(`
      SELECT 
        c.id, 
        c.cedula, 
        c.nombre, 
        c.foto, 
        c.cedulaFoto, 
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
        COALESCE(
          (
            SELECT 
              CASE
                WHEN rc.estado = 'APROBADO' AND rc.fecha_vencimiento >= CURDATE() THEN 'Aprobado'
                WHEN rc.estado = 'APROBADO' AND rc.fecha_vencimiento < CURDATE() THEN 'Vencido'
                WHEN rc.estado IS NOT NULL THEN 'Perdido'
                ELSE 'No realizado'
              END
            FROM resultados_capacitaciones rc
            JOIN capacitaciones cap ON rc.capacitacion_id = cap.id
            WHERE rc.colaborador_id = c.id
            AND cap.nombre LIKE '%Capacitación SATOR%'
            ORDER BY rc.created_at DESC
            LIMIT 1
          ),
          'No realizado'
        ) as capacitacion
      FROM colaboradores c
      WHERE c.solicitud_id = ?
    `, [id]);

    const solicitudData = {
      ...solicitud[0],
      inicio_obra: format(new Date(solicitud[0].inicio_obra), 'yyyy-MM-dd'),
      fin_obra: format(new Date(solicitud[0].fin_obra), 'yyyy-MM-dd'),
      arl_documento: solicitud[0].arl_documento || null,
      pasocial_documento: solicitud[0].pasocial_documento || null,
      interventor_id: solicitud[0].interventor_id,
      lugar: solicitud[0].lugar_id // Asegurarnos de que el lugar se incluya correctamente
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

    const [colaboradores] = await connection.execute(`
      SELECT 
        c.id, 
        c.cedula, 
        c.nombre, 
        c.foto, 
        c.cedulaFoto, 
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
        COALESCE(
          (
            SELECT 
              CASE
                WHEN rc.estado = 'APROBADO' AND rc.fecha_vencimiento >= CURDATE() THEN 'Aprobado'
                WHEN rc.estado = 'APROBADO' AND rc.fecha_vencimiento < CURDATE() THEN 'Vencido'
                WHEN rc.estado IS NOT NULL THEN 'Perdido'
                ELSE 'No realizado'
              END
            FROM resultados_capacitaciones rc
            JOIN capacitaciones cap ON rc.capacitacion_id = cap.id
            WHERE rc.colaborador_id = c.id
            AND cap.nombre LIKE '%Capacitación SATOR%'
            ORDER BY rc.created_at DESC
            LIMIT 1
          ),
          'No realizado'
        ) as capacitacion
      FROM colaboradores c
      WHERE c.solicitud_id = ?
    `, [solicitudId]);

    res.json({
      success: true,
      solicitud: solicitudData[0],
      colaboradores: colaboradores.map(col => ({ 
        ...col, 
        estado: Boolean(col.estado)
      }))
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
        l.nombre_lugar,
        DATE_FORMAT(r.created_at, '%d/%m/%Y %H:%i:%s') as registro_hecho,
        us.username AS usuario_registro
      FROM registros r
      JOIN colaboradores c ON r.colaborador_id = c.id
      JOIN solicitudes s ON r.solicitud_id = s.id
      JOIN users u ON s.usuario_id = u.id
      JOIN users us ON r.usuario_id = us.id
      JOIN lugares l ON s.lugar = l.id
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
      Object.values(req.files).flat().forEach(file => {
        cleanupTempFiles(file.path);
      });
    }
    return res.status(400).json({
      error: 'Error en la carga de archivos',
      details: err.message
    });
  }
  
  if (req.files) {
    Object.values(req.files).flat().forEach(file => {
      cleanupTempFiles(file.path);
    });
  }
  res.status(500).json({
    error: 'Error interno del servidor',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

module.exports = router;