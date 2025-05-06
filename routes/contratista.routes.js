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
router.post('/generar-solicitud', upload.fields([
    { name: 'arl', maxCount: 1 },
    { name: 'pasocial', maxCount: 1 },
    { name: 'foto[]', maxCount: 10 },
    { name: 'documento_arl[]', maxCount: 10 },
    { name: 'foto_vehiculo[]', maxCount: 10 },
    { name: 'tecnomecanica[]', maxCount: 10 },
    { name: 'soat[]', maxCount: 10 },
    { name: 'licencia_conduccion[]', maxCount: 10 },
    { name: 'licencia_transito[]', maxCount: 10 }
  ]), async (req, res) => {
    let conn = await connection.getConnection();
    try {
    await conn.beginTransaction();
      // Generar URLs de archivos para S3/Spaces
      const fileMap = req.files;
    const fileNames = {
      arl: null,
      pasocial: null,
        foto: [],
        documento_arl: [],
        foto_vehiculo: [],
        tecnomecanica: [],
        soat: [],
        licencia_conduccion: [],
        licencia_transito: []
      };
      
      logInfo('Archivos recibidos en generar solicitud:', { 
        tiposArchivos: Object.keys(fileMap),
        arl: fileMap.arl?.length || 0,
        pasocial: fileMap.pasocial?.length || 0,
        foto: fileMap['foto[]']?.length || 0,
        documento_arl: fileMap['documento_arl[]']?.length || 0,
        foto_vehiculo: fileMap['foto_vehiculo[]']?.length || 0,
        tecnomecanica: fileMap['tecnomecanica[]']?.length || 0,
        soat: fileMap['soat[]']?.length || 0,
        licencia_conduccion: fileMap['licencia_conduccion[]']?.length || 0,
        licencia_transito: fileMap['licencia_transito[]']?.length || 0
      });

    // Procesar documentos principales
    if (fileMap['arl']?.[0]) {
      fileNames.arl = await uploadToSpacesFromDisk(fileMap['arl'][0].path, fileMap['arl'][0].originalname);
    }
    if (fileMap['pasocial']?.[0]) {
      fileNames.pasocial = await uploadToSpacesFromDisk(fileMap['pasocial'][0].path, fileMap['pasocial'][0].originalname);
    }

    // Procesar fotos y documentos ARL
    if (fileMap['foto[]']) {
        logInfo('Procesando fotos de colaboradores:', {cantidad: fileMap['foto[]'].length});
      for (const file of fileMap['foto[]']) {
          logInfo(`  Procesando foto: ${file.originalname} (${file.size} bytes, path: ${file.path})`);
          const url = await uploadToSpacesFromDisk(file.path, file.originalname);
          fileNames.foto.push(url);
          logInfo(`  URL generada: ${url}`);
      }
    }
    if (fileMap['documento_arl[]']) {
        logInfo('Procesando documentos ARL de colaboradores:', {cantidad: fileMap['documento_arl[]'].length});
      for (const file of fileMap['documento_arl[]']) {
          logInfo(`  Procesando documento ARL: ${file.originalname} (${file.size} bytes, path: ${file.path})`);
          const url = await uploadToSpacesFromDisk(file.path, file.originalname);
          fileNames.documento_arl.push(url);
          logInfo(`  URL generada: ${url}`);
        }
      }

      // Procesar documentos de vehículos
      const vehiculoArchivosMap = {
        fotos: {},
        tecnomecanicas: {},
        soats: {},
        licencias_conduccion: {},
        licencias_transito: {}
      };
      
      // Mapear cada tipo de archivo por su índice
      if (fileMap['foto_vehiculo[]']) {
        logInfo('Archivos de fotos de vehículos recibidos:', { 
          cantidad: fileMap['foto_vehiculo[]'].length,
          archivos: fileMap['foto_vehiculo[]'].map(f => ({nombre: f.originalname, tamaño: f.size, path: f.path}))
        });
        fileMap['foto_vehiculo[]'].forEach((file, index) => {
          vehiculoArchivosMap.fotos[index] = file;
          logInfo(`Mapeando foto para vehículo posición ${index}:`, { 
            nombre: file.originalname, 
            path: file.path 
          });
        });
      } else {
        logInfo('⚠️ No se encontraron archivos de fotos de vehículos.');
      }
      
      if (fileMap['tecnomecanica[]']) {
        logInfo('Archivos de tecnomecánica recibidos:', { 
          cantidad: fileMap['tecnomecanica[]'].length,
          archivos: fileMap['tecnomecanica[]'].map(f => ({nombre: f.originalname, tamaño: f.size, path: f.path}))
        });
        fileMap['tecnomecanica[]'].forEach((file, index) => {
          vehiculoArchivosMap.tecnomecanicas[index] = file;
          logInfo(`Mapeando tecnomecánica para vehículo posición ${index}:`, { 
            nombre: file.originalname, 
            path: file.path 
          });
        });
      } else {
        logInfo('⚠️ No se encontraron archivos de tecnomecánica.');
      }
      
      if (fileMap['soat[]']) {
        logInfo('Archivos de SOAT recibidos:', { 
          cantidad: fileMap['soat[]'].length,
          archivos: fileMap['soat[]'].map(f => ({nombre: f.originalname, tamaño: f.size, path: f.path}))
        });
        fileMap['soat[]'].forEach((file, index) => {
          vehiculoArchivosMap.soats[index] = file;
          logInfo(`Mapeando SOAT para vehículo posición ${index}:`, { 
            nombre: file.originalname, 
            path: file.path 
          });
        });
      } else {
        logInfo('⚠️ No se encontraron archivos de SOAT.');
      }
      
      if (fileMap['licencia_conduccion[]']) {
        logInfo('Archivos de licencia de conducción recibidos:', { 
          cantidad: fileMap['licencia_conduccion[]'].length,
          archivos: fileMap['licencia_conduccion[]'].map(f => ({nombre: f.originalname, tamaño: f.size, path: f.path}))
        });
        fileMap['licencia_conduccion[]'].forEach((file, index) => {
          vehiculoArchivosMap.licencias_conduccion[index] = file;
          logInfo(`Mapeando licencia de conducción para vehículo posición ${index}:`, { 
            nombre: file.originalname, 
            path: file.path 
          });
        });
      } else {
        logInfo('⚠️ No se encontraron archivos de licencia de conducción.');
      }
      
      if (fileMap['licencia_transito[]']) {
        logInfo('Archivos de licencia de tránsito recibidos:', { 
          cantidad: fileMap['licencia_transito[]'].length,
          archivos: fileMap['licencia_transito[]'].map(f => ({nombre: f.originalname, tamaño: f.size, path: f.path}))
        });
        fileMap['licencia_transito[]'].forEach((file, index) => {
          vehiculoArchivosMap.licencias_transito[index] = file;
          logInfo(`Mapeando licencia de tránsito para vehículo posición ${index}:`, { 
            nombre: file.originalname, 
            path: file.path 
          });
        });
      } else {
        logInfo('⚠️ No se encontraron archivos de licencia de tránsito.');
      }

      // Extraer datos restantes
      const { inicio_obra, fin_obra, dias_trabajo, lugar, labor } = req.body;
      
      // Obtener datos del usuario desde el token
      const token = req.cookies.token;
      if (!token) {
        return res.status(401).json({ success: false, message: 'No se encontró el token' });
      }
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secreto');
      const userId = decoded.id;
      
      // Insertar datos en tablas
      // 1. Insertar solicitud
      const [solicitudResult] = await conn.execute(
        'INSERT INTO solicitudes (usuario_id, empresa, nit, inicio_obra, fin_obra, dias_trabajo, arl_documento, pasocial_documento, estado, lugar, labor, interventor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          userId, 
          req.body.empresa || null, 
          req.body.nit || null, 
          inicio_obra || null, 
          fin_obra || null, 
          dias_trabajo || null, 
          fileNames.arl || null, 
          fileNames.pasocial || null, 
          'pendiente', 
          lugar || null, 
          labor || null, 
          req.body.interventor_id || null
        ]
      );
      const solicitudId = solicitudResult.insertId;

      // 2. Insertar colaboradores
      const cedula = req.body.cedula && !Array.isArray(req.body.cedula) ? [req.body.cedula] : req.body.cedula;
      const nombre = req.body.nombre && !Array.isArray(req.body.nombre) ? [req.body.nombre] : req.body.nombre;

      logInfo('Datos de colaboradores recibidos:', {
        cedulas: cedula,
        nombres: nombre,
        fotosLength: fileNames.foto.length,
        arlsLength: fileNames.documento_arl.length
      });

      // Insertar colaboradores con manejo mejorado de fotos y documentos
    for (let i = 0; i < cedula.length; i++) {
        // Comprobar si hay fotos y documentos ARL antes de insertar
        const fotoUrl = i < fileNames.foto.length ? fileNames.foto[i] : null;
        const documentoArlUrl = i < fileNames.documento_arl.length ? fileNames.documento_arl[i] : null;
        
        logInfo(`Insertando colaborador #${i+1}:`, {
          cedula: cedula[i],
          nombre: nombre[i],
          foto: fotoUrl || 'No proporcionada',
          documento_arl: documentoArlUrl || 'No proporcionado'
        });
        
      await conn.execute(
          'INSERT INTO colaboradores (solicitud_id, cedula, nombre, foto, documento_arl, estado) VALUES (?, ?, ?, ?, ?, true)',
          [solicitudId, cedula[i] || null, nombre[i] || null, fotoUrl || null, documentoArlUrl || null]
        );
      }

      // 3. Insertar vehículos
      if (req.body.matricula) {
        const matricula = !Array.isArray(req.body.matricula) ? [req.body.matricula] : req.body.matricula;
        
        logInfo('Datos de vehículos recibidos:', {
          matriculas: matricula,
          cantidad: matricula.length
        });
        
        for (let i = 0; i < matricula.length; i++) {
          logInfo(`Procesando vehículo #${i+1}:`, { matricula: matricula[i] });
          
          // Preparar archivos de este vehículo
          const vehiculoArchivos = {
            foto: vehiculoArchivosMap.fotos[i] ? await uploadToSpacesFromDisk(vehiculoArchivosMap.fotos[i].path, vehiculoArchivosMap.fotos[i].originalname) : null,
            tecnomecanica: vehiculoArchivosMap.tecnomecanicas[i] ? await uploadToSpacesFromDisk(vehiculoArchivosMap.tecnomecanicas[i].path, vehiculoArchivosMap.tecnomecanicas[i].originalname) : null,
            soat: vehiculoArchivosMap.soats[i] ? await uploadToSpacesFromDisk(vehiculoArchivosMap.soats[i].path, vehiculoArchivosMap.soats[i].originalname) : null,
            licencia_conduccion: vehiculoArchivosMap.licencias_conduccion[i] ? await uploadToSpacesFromDisk(vehiculoArchivosMap.licencias_conduccion[i].path, vehiculoArchivosMap.licencias_conduccion[i].originalname) : null,
            licencia_transito: vehiculoArchivosMap.licencias_transito[i] ? await uploadToSpacesFromDisk(vehiculoArchivosMap.licencias_transito[i].path, vehiculoArchivosMap.licencias_transito[i].originalname) : null
          };
          
          // Log detallado de los resultados de la subida
          logInfo(`Resultados de la subida para vehículo ${matricula[i]}:`, {
            foto: vehiculoArchivos.foto || 'No subida',
            tecnomecanica: vehiculoArchivos.tecnomecanica || 'No subida',
            soat: vehiculoArchivos.soat || 'No subida',
            licencia_conduccion: vehiculoArchivos.licencia_conduccion || 'No subida',
            licencia_transito: vehiculoArchivos.licencia_transito || 'No subida'
          });
          
        await conn.execute(
            'INSERT INTO vehiculos (solicitud_id, matricula, foto, tecnomecanica, soat, licencia_conduccion, licencia_transito, estado) VALUES (?, ?, ?, ?, ?, ?, ?, true)',
            [
              solicitudId, 
              matricula[i] || null, 
              vehiculoArchivos.foto || null, 
              vehiculoArchivos.tecnomecanica || null, 
              vehiculoArchivos.soat || null, 
              vehiculoArchivos.licencia_conduccion || null, 
              vehiculoArchivos.licencia_transito || null
            ]
        );
          
          logInfo(`Vehículo ${matricula[i]} insertado correctamente con ID de solicitud ${solicitudId}`);
      }
    }

      // Verificar y notificar al interventor si es COA
      const [resultUser] = await conn.execute('SELECT username FROM users WHERE id = ?', [req.body.interventor_id]);
    if (resultUser[0]?.username === "COA") {
        await conn.execute('UPDATE solicitudes SET estado = "aprobada" WHERE id = ?', [solicitudId]);
        await conn.execute('INSERT INTO acciones (solicitud_id, usuario_id, accion) VALUES (?, ?, "pendiente")', [solicitudId, userId]);
    }

    await conn.commit();
    logInfo('Solicitud generada exitosamente');
      return res.status(200).json({ success: true, message: 'Solicitud creada exitosamente', solicitudId });
  } catch (error) {
      // Revertir cambios en la base de datos
      if (conn) await conn.rollback();
      console.error('Error en generar solicitud:', error);
    logError(error, '/generar-solicitud');
      
    // Limpiar archivos temporales en caso de error
      if (req.files) {
        for (const fieldname in req.files) {
          await cleanupAllTempFiles(req.files[fieldname]);
        }
      }
      
      return res.status(500).json({ success: false, message: 'Error al generar la solicitud: ' + error.message });
  } finally {
    // Limpiar archivos temporales después de procesar la solicitud
      if (req.files) {
        for (const fieldname in req.files) {
          await cleanupAllTempFiles(req.files[fieldname]);
        }
      }
      
      if (conn) conn.release();
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
          logInfo('Procesando colaboradores nuevos:', { 
            cantidad: cambiosDetectados.colaboradores.nuevos.length, 
            detalle: cambiosDetectados.colaboradores.nuevos
          });
          
          // Construir mapas de archivos indexados por posición
          const fotosMap = {};
          const documentosArlMap = {};
          
          // Mapear archivos por su índice en el array
          if (fileMap['foto[]']) {
            logInfo('Archivos foto[] encontrados:', { 
              cantidad: fileMap['foto[]'].length,
              archivos: fileMap['foto[]'].map(f => ({nombre: f.originalname, tamaño: f.size, path: f.path}))
            });
            fileMap['foto[]'].forEach((file, index) => {
              fotosMap[index] = file;
              logInfo(`Mapeando foto para colaborador posición ${index}:`, { 
                nombre: file.originalname, 
                path: file.path 
              });
            });
          } else {
            logInfo('⚠️ No se encontraron archivos foto[] para los colaboradores nuevos');
          }
          
          if (fileMap['documento_arl[]']) {
            logInfo('Archivos documento_arl[] encontrados:', { 
              cantidad: fileMap['documento_arl[]'].length,
              archivos: fileMap['documento_arl[]'].map(f => ({nombre: f.originalname, tamaño: f.size, path: f.path}))
            });
            fileMap['documento_arl[]'].forEach((file, index) => {
              documentosArlMap[index] = file;
              logInfo(`Mapeando documento ARL para colaborador posición ${index}:`, { 
                nombre: file.originalname, 
                path: file.path 
              });
            });
          } else {
            logInfo('⚠️ No se encontraron archivos documento_arl[] para los colaboradores nuevos');
          }
          
          for (let i = 0; i < cambiosDetectados.colaboradores.nuevos.length; i++) {
            const colaborador = cambiosDetectados.colaboradores.nuevos[i];
            logInfo(`Procesando colaborador nuevo #${i+1}:`, { 
              cedula: colaborador.cedula, 
              nombre: colaborador.nombre,
              tieneFoto: fotosMap[i] ? true : false,
              tieneDocArl: documentosArlMap[i] ? true : false
            });
            
            const fotoFile = fotosMap[i];
            const documentoArlFile = documentosArlMap[i];
            
            // Verificación mejorada para documentos ARL
            let documentoArlUrl = null;
            if (documentoArlFile) {
              logInfo(`Procesando documento ARL para ${colaborador.nombre}:`, { 
                nombre: documentoArlFile.originalname, 
                size: documentoArlFile.size
              });
              try {
                documentoArlUrl = await uploadToSpacesFromDisk(documentoArlFile.path, documentoArlFile.originalname);
                logInfo(`✅ Documento ARL subido correctamente para ${colaborador.nombre}:`, { url: documentoArlUrl });
              } catch (arlError) {
                logError(arlError, 'uploadDocumentoArl');
                logInfo(`⚠️ Error al subir documento ARL para ${colaborador.nombre}: ${arlError.message}`);
              }
            } else {
              logInfo(`⚠️ No se encontró documentoArlFile para colaborador ${colaborador.nombre}`);
              
              // Búsqueda alternativa de documentos ARL - recorrer todos los archivos por si acaso
              const todosDocumentos = Object.keys(fileMap).filter(key => key.includes('documento_arl') || key.includes('arl_') || key.includes('ARL'));
              logInfo(`Buscando documentos ARL alternativos. Claves encontradas:`, todosDocumentos);
              
              // Buscar un documento específico para este colaborador por nombre o por patrón
              for (const key of todosDocumentos) {
                // Si ya encontramos un documento, salir del bucle
                if (documentoArlUrl) break;
                
                const files = fileMap[key];
                if (Array.isArray(files) && files.length > 0) {
                  for (const file of files) {
                    if (file.originalname.toLowerCase().includes(colaborador.nombre.toLowerCase()) || 
                        file.originalname.toLowerCase().includes(colaborador.cedula.toLowerCase())) {
                      logInfo(`🔍 Encontrado posible documento ARL alternativo para ${colaborador.nombre}:`, { 
                        key, 
                        archivo: file.originalname
                      });
                      try {
                        documentoArlUrl = await uploadToSpacesFromDisk(file.path, file.originalname);
                        logInfo(`✅ Documento ARL alternativo subido exitosamente: ${documentoArlUrl}`);
                        break;
                      } catch (err) {
                        logError(err, 'uploadDocumentoArlAlternativo');
                      }
                    }
                  }
                }
              }
            }
            
            // Verificación mejorada para fotos
            let fotoUrl = null;
            if (fotoFile) {
              logInfo(`Procesando foto para ${colaborador.nombre}:`, { 
                nombre: fotoFile.originalname, 
                size: fotoFile.size
              });
              try {
                fotoUrl = await uploadToSpacesFromDisk(fotoFile.path, fotoFile.originalname);
                logInfo(`✅ Foto subida correctamente para ${colaborador.nombre}:`, { url: fotoUrl });
              } catch (fotoError) {
                logError(fotoError, 'uploadFoto');
                logInfo(`⚠️ Error al subir foto para ${colaborador.nombre}: ${fotoError.message}`);
              }
            } else {
              logInfo(`⚠️ No se encontró fotoFile para colaborador ${colaborador.nombre}`);
            }
            
            logInfo(`Resultados de subida para colaborador ${colaborador.nombre}:`, {
              fotoUrl: fotoUrl || 'No subida',
              documentoArlUrl: documentoArlUrl || 'No subido'
            });
            
            await conn.execute(
              'INSERT INTO colaboradores (solicitud_id, cedula, nombre, foto, documento_arl, estado) VALUES (?, ?, ?, ?, ?, true)',
              [solicitudId, colaborador.cedula || null, colaborador.nombre || null, fotoUrl || null, documentoArlUrl || null]
            );
            
            logInfo(`Colaborador ${colaborador.nombre} insertado con éxito en solicitud ${solicitudId}`);
          }
        }
  
        // Procesar vehículos
        if (cambiosDetectados?.vehiculos?.nuevos?.length > 0) {
          // Construir mapas de archivos indexados por posición
          const vehiculoArchivosMap = {
            fotos: {},
            tecnomecanicas: {},
            soats: {},
            licencias_conduccion: {},
            licencias_transito: {}
          };
          
          // Mapear cada tipo de archivo por su índice
          if (fileMap['foto_vehiculo[]']) {
            logInfo('Archivos de fotos de vehículos recibidos:', { 
              cantidad: fileMap['foto_vehiculo[]'].length,
              archivos: fileMap['foto_vehiculo[]'].map(f => ({nombre: f.originalname, tamaño: f.size, path: f.path}))
            });
            fileMap['foto_vehiculo[]'].forEach((file, index) => {
              vehiculoArchivosMap.fotos[index] = file;
              logInfo(`Mapeando foto para vehículo posición ${index}:`, { 
                nombre: file.originalname, 
                path: file.path 
              });
            });
          } else {
            logInfo('⚠️ No se encontraron archivos de fotos de vehículos.');
          }
          
          if (fileMap['tecnomecanica[]']) {
            logInfo('Archivos de tecnomecánica recibidos:', { 
              cantidad: fileMap['tecnomecanica[]'].length,
              archivos: fileMap['tecnomecanica[]'].map(f => ({nombre: f.originalname, tamaño: f.size, path: f.path}))
            });
            fileMap['tecnomecanica[]'].forEach((file, index) => {
              vehiculoArchivosMap.tecnomecanicas[index] = file;
              logInfo(`Mapeando tecnomecánica para vehículo posición ${index}:`, { 
                nombre: file.originalname, 
                path: file.path 
              });
            });
          } else {
            logInfo('⚠️ No se encontraron archivos de tecnomecánica.');
          }
          
          if (fileMap['soat[]']) {
            logInfo('Archivos de SOAT recibidos:', { 
              cantidad: fileMap['soat[]'].length,
              archivos: fileMap['soat[]'].map(f => ({nombre: f.originalname, tamaño: f.size, path: f.path}))
            });
            fileMap['soat[]'].forEach((file, index) => {
              vehiculoArchivosMap.soats[index] = file;
              logInfo(`Mapeando SOAT para vehículo posición ${index}:`, { 
                nombre: file.originalname, 
                path: file.path 
              });
            });
          } else {
            logInfo('⚠️ No se encontraron archivos de SOAT.');
          }
          
          if (fileMap['licencia_conduccion[]']) {
            logInfo('Archivos de licencia de conducción recibidos:', { 
              cantidad: fileMap['licencia_conduccion[]'].length,
              archivos: fileMap['licencia_conduccion[]'].map(f => ({nombre: f.originalname, tamaño: f.size, path: f.path}))
            });
            fileMap['licencia_conduccion[]'].forEach((file, index) => {
              vehiculoArchivosMap.licencias_conduccion[index] = file;
              logInfo(`Mapeando licencia de conducción para vehículo posición ${index}:`, { 
                nombre: file.originalname, 
                path: file.path 
              });
            });
          } else {
            logInfo('⚠️ No se encontraron archivos de licencia de conducción.');
          }
          
          if (fileMap['licencia_transito[]']) {
            logInfo('Archivos de licencia de tránsito recibidos:', { 
              cantidad: fileMap['licencia_transito[]'].length,
              archivos: fileMap['licencia_transito[]'].map(f => ({nombre: f.originalname, tamaño: f.size, path: f.path}))
            });
            fileMap['licencia_transito[]'].forEach((file, index) => {
              vehiculoArchivosMap.licencias_transito[index] = file;
              logInfo(`Mapeando licencia de tránsito para vehículo posición ${index}:`, { 
                nombre: file.originalname, 
                path: file.path 
              });
            });
          } else {
            logInfo('⚠️ No se encontraron archivos de licencia de tránsito.');
          }

          for (let i = 0; i < cambiosDetectados.vehiculos.nuevos.length; i++) {
            const vehiculo = cambiosDetectados.vehiculos.nuevos[i];
            logInfo(`Procesando vehículo nuevo #${i+1}:`, { matricula: vehiculo.matricula });
            
            // Procesar cada tipo de documento de vehículo con mejor manejo de errores
            const vehiculoArchivos = {
              foto: null,
              tecnomecanica: null,
              soat: null,
              licencia_conduccion: null,
              licencia_transito: null
            };
            
            // Procesar foto del vehículo
            if (vehiculoArchivosMap.fotos[i]) {
              const file = vehiculoArchivosMap.fotos[i];
              logInfo(`Procesando foto para vehículo ${vehiculo.matricula}:`, { 
                nombre: file.originalname, 
                size: file.size
              });
              try {
                vehiculoArchivos.foto = await uploadToSpacesFromDisk(file.path, file.originalname);
                logInfo(`✅ Foto subida correctamente para vehículo ${vehiculo.matricula}:`, { url: vehiculoArchivos.foto });
              } catch (error) {
                logError(error, 'uploadFotoVehiculo');
                logInfo(`⚠️ Error al subir foto para vehículo ${vehiculo.matricula}: ${error.message}`);
              }
            } else {
              logInfo(`⚠️ No se encontró foto para vehículo ${vehiculo.matricula}`);
            }
            
            // Procesar tecnomecánica
            if (vehiculoArchivosMap.tecnomecanicas[i]) {
              const file = vehiculoArchivosMap.tecnomecanicas[i];
              logInfo(`Procesando tecnomecánica para vehículo ${vehiculo.matricula}:`, { 
                nombre: file.originalname, 
                size: file.size
              });
              try {
                vehiculoArchivos.tecnomecanica = await uploadToSpacesFromDisk(file.path, file.originalname);
                logInfo(`✅ Tecnomecánica subida correctamente para vehículo ${vehiculo.matricula}:`, { url: vehiculoArchivos.tecnomecanica });
              } catch (error) {
                logError(error, 'uploadTecnomecanicaVehiculo');
                logInfo(`⚠️ Error al subir tecnomecánica para vehículo ${vehiculo.matricula}: ${error.message}`);
              }
            } else {
              logInfo(`⚠️ No se encontró tecnomecánica para vehículo ${vehiculo.matricula}`);
            }
            
            // Procesar SOAT
            if (vehiculoArchivosMap.soats[i]) {
              const file = vehiculoArchivosMap.soats[i];
              logInfo(`Procesando SOAT para vehículo ${vehiculo.matricula}:`, { 
                nombre: file.originalname, 
                size: file.size
              });
              try {
                vehiculoArchivos.soat = await uploadToSpacesFromDisk(file.path, file.originalname);
                logInfo(`✅ SOAT subido correctamente para vehículo ${vehiculo.matricula}:`, { url: vehiculoArchivos.soat });
              } catch (error) {
                logError(error, 'uploadSoatVehiculo');
                logInfo(`⚠️ Error al subir SOAT para vehículo ${vehiculo.matricula}: ${error.message}`);
              }
            } else {
              logInfo(`⚠️ No se encontró SOAT para vehículo ${vehiculo.matricula}`);
            }
            
            // Procesar licencia de conducción
            if (vehiculoArchivosMap.licencias_conduccion[i]) {
              const file = vehiculoArchivosMap.licencias_conduccion[i];
              logInfo(`Procesando licencia de conducción para vehículo ${vehiculo.matricula}:`, { 
                nombre: file.originalname, 
                size: file.size
              });
              try {
                vehiculoArchivos.licencia_conduccion = await uploadToSpacesFromDisk(file.path, file.originalname);
                logInfo(`✅ Licencia de conducción subida correctamente para vehículo ${vehiculo.matricula}:`, { url: vehiculoArchivos.licencia_conduccion });
              } catch (error) {
                logError(error, 'uploadLicenciaConduccionVehiculo');
                logInfo(`⚠️ Error al subir licencia de conducción para vehículo ${vehiculo.matricula}: ${error.message}`);
              }
            } else {
              logInfo(`⚠️ No se encontró licencia de conducción para vehículo ${vehiculo.matricula}`);
            }
            
            // Procesar licencia de tránsito
            if (vehiculoArchivosMap.licencias_transito[i]) {
              const file = vehiculoArchivosMap.licencias_transito[i];
              logInfo(`Procesando licencia de tránsito para vehículo ${vehiculo.matricula}:`, { 
                nombre: file.originalname, 
                size: file.size
              });
              try {
                vehiculoArchivos.licencia_transito = await uploadToSpacesFromDisk(file.path, file.originalname);
                logInfo(`✅ Licencia de tránsito subida correctamente para vehículo ${vehiculo.matricula}:`, { url: vehiculoArchivos.licencia_transito });
              } catch (error) {
                logError(error, 'uploadLicenciaTransitoVehiculo');
                logInfo(`⚠️ Error al subir licencia de tránsito para vehículo ${vehiculo.matricula}: ${error.message}`);
              }
            } else {
              logInfo(`⚠️ No se encontró licencia de tránsito para vehículo ${vehiculo.matricula}`);
            }
            
            // Búsqueda alternativa para los documentos que faltan
            if (!vehiculoArchivos.foto || !vehiculoArchivos.tecnomecanica || !vehiculoArchivos.soat || 
                !vehiculoArchivos.licencia_conduccion || !vehiculoArchivos.licencia_transito) {
              
              logInfo(`🔍 Realizando búsqueda alternativa de documentos para vehículo ${vehiculo.matricula}`);
              
              // Buscar en todas las claves por algún documento que pueda corresponder a este vehículo
              const placaSinEspacios = vehiculo.matricula.replace(/\s+/g, '').toLowerCase();
              
              Object.keys(fileMap).forEach(key => {
                if (Array.isArray(fileMap[key])) {
                  fileMap[key].forEach(file => {
                    const filenameLower = file.originalname.toLowerCase();
                    
                    // Verificar si el nombre del archivo contiene la placa
                    if (filenameLower.includes(placaSinEspacios)) {
                      logInfo(`🔍 Encontrado posible documento para vehículo ${vehiculo.matricula} en ${key}:`, {
                        archivo: file.originalname
                      });
                      
                      // Asignar al tipo de documento correcto según el nombre de campo o contenido
                      const asignarSegunContenido = async () => {
                        try {
                          const url = await uploadToSpacesFromDisk(file.path, file.originalname);
                          
                          if (!vehiculoArchivos.foto && (key.includes('foto') || filenameLower.includes('foto'))) {
                            vehiculoArchivos.foto = url;
                            logInfo(`🔄 Asignada foto alternativa para vehículo ${vehiculo.matricula}`);
                          } else if (!vehiculoArchivos.tecnomecanica && (key.includes('tecno') || filenameLower.includes('tecno'))) {
                            vehiculoArchivos.tecnomecanica = url;
                            logInfo(`🔄 Asignada tecnomecánica alternativa para vehículo ${vehiculo.matricula}`);
                          } else if (!vehiculoArchivos.soat && (key.includes('soat') || filenameLower.includes('soat'))) {
                            vehiculoArchivos.soat = url;
                            logInfo(`🔄 Asignado SOAT alternativo para vehículo ${vehiculo.matricula}`);
                          } else if (!vehiculoArchivos.licencia_conduccion && (key.includes('conduccion') || filenameLower.includes('conduccion'))) {
                            vehiculoArchivos.licencia_conduccion = url;
                            logInfo(`🔄 Asignada licencia de conducción alternativa para vehículo ${vehiculo.matricula}`);
                          } else if (!vehiculoArchivos.licencia_transito && (key.includes('transito') || filenameLower.includes('transito'))) {
                            vehiculoArchivos.licencia_transito = url;
                            logInfo(`🔄 Asignada licencia de tránsito alternativa para vehículo ${vehiculo.matricula}`);
                          }
                        } catch (error) {
                          logError(error, 'asignarDocumentoAlternativoVehiculo');
                        }
                      };
                      
                      asignarSegunContenido();
                    }
                  });
                }
              });
            }
            
            // Log detallado de los resultados de la subida
            logInfo(`Resultados de la subida para vehículo ${vehiculo.matricula}:`, {
              foto: vehiculoArchivos.foto || 'No subida',
              tecnomecanica: vehiculoArchivos.tecnomecanica || 'No subida',
              soat: vehiculoArchivos.soat || 'No subida',
              licencia_conduccion: vehiculoArchivos.licencia_conduccion || 'No subida',
              licencia_transito: vehiculoArchivos.licencia_transito || 'No subida'
            });
  
            await conn.execute(
              'INSERT INTO vehiculos (solicitud_id, matricula, foto, tecnomecanica, soat, licencia_conduccion, licencia_transito, estado) VALUES (?, ?, ?, ?, ?, ?, ?, true)',
              [
                solicitudId, 
                vehiculo.matricula || null, 
                vehiculoArchivos.foto || null, 
                vehiculoArchivos.tecnomecanica || null, 
                vehiculoArchivos.soat || null, 
                vehiculoArchivos.licencia_conduccion || null, 
                vehiculoArchivos.licencia_transito || null
              ]
            );
            logInfo(`Vehículo ${vehiculo.matricula} insertado correctamente con ID de solicitud ${solicitudId}`);
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
                ${cambiosDetectados.vehiculos.nuevos
                  .map((veh) => `<li>${veh.matricula}</li>`)
                  .join('')}
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
            const documentoArlField = `documento_arl_${id}`;
            
            // Verificar si hay cambios en la foto
            if (fileMap[fotoField]?.[0]) {
              const file = fileMap[fotoField][0];
              const [rows] = await conn.execute('SELECT foto FROM colaboradores WHERE id = ?', [id]);
              if (rows[0]?.foto) await deleteFromSpaces(rows[0].foto);
              const newPath = await uploadToSpacesFromDisk(file.path, file.originalname);
              await conn.execute(
                'UPDATE colaboradores SET foto = ? WHERE id = ?',
                [newPath, id]
              );
            }

            // Verificar si hay cambios en el documento ARL
            if (fileMap[documentoArlField]?.[0]) {
              const file = fileMap[documentoArlField][0];
              const [rows] = await conn.execute('SELECT documento_arl FROM colaboradores WHERE id = ?', [id]);
              if (rows[0]?.documento_arl) await deleteFromSpaces(rows[0].documento_arl);
              const newPath = await uploadToSpacesFromDisk(file.path, file.originalname);
              await conn.execute(
                'UPDATE colaboradores SET documento_arl = ? WHERE id = ?',
                [newPath, id]
              );
            }
          }
        }
  
        // Agregar nuevos colaboradores
        if (cambiosDetectados?.colaboradores.nuevos.length > 0) {
          // Construir mapas de archivos indexados por posición
          const fotosMap = {};
          const documentosArlMap = {};
          
          // Mapear archivos por su índice en el array
          if (fileMap['foto[]']) {
            fileMap['foto[]'].forEach((file, index) => {
              fotosMap[index] = file;
            });
          }
          
          if (fileMap['documento_arl[]']) {
            fileMap['documento_arl[]'].forEach((file, index) => {
              documentosArlMap[index] = file;
            });
          }
          
          for (let i = 0; i < cambiosDetectados.colaboradores.nuevos.length; i++) {
            const nuevoColaborador = cambiosDetectados.colaboradores.nuevos[i];
            const [existingColaborador] = await conn.execute(
              'SELECT id FROM colaboradores WHERE solicitud_id = ? AND cedula = ?',
              [solicitudId, nuevoColaborador.cedula]
            );
  
            if (!existingColaborador.length) {
              const fotoFile = fotosMap[i];
              const documentoArlFile = documentosArlMap[i];
              const fotoUrl = fotoFile ? await uploadToSpacesFromDisk(fotoFile.path, fotoFile.originalname) : null;
              const documentoArlUrl = documentoArlFile ? await uploadToSpacesFromDisk(documentoArlFile.path, documentoArlFile.originalname) : null;
              await conn.execute(
                'INSERT INTO colaboradores (solicitud_id, cedula, nombre, foto, documento_arl, estado) VALUES (?, ?, ?, ?, ?, true)',
                [solicitudId, nuevoColaborador.cedula, nuevoColaborador.nombre, fotoUrl, documentoArlUrl]
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
          // Construir mapas de archivos indexados por posición
          const vehiculoArchivosMap = {
            fotos: {},
            tecnomecanicas: {},
            soats: {},
            licencias_conduccion: {},
            licencias_transito: {}
          };
          
          // Mapear cada tipo de archivo por su índice
          if (fileMap['foto_vehiculo[]']) {
            logInfo('Archivos de fotos de vehículos recibidos:', { 
              cantidad: fileMap['foto_vehiculo[]'].length,
              archivos: fileMap['foto_vehiculo[]'].map(f => ({nombre: f.originalname, tamaño: f.size, path: f.path}))
            });
            fileMap['foto_vehiculo[]'].forEach((file, index) => {
              vehiculoArchivosMap.fotos[index] = file;
              logInfo(`Mapeando foto para vehículo posición ${index}:`, { 
                nombre: file.originalname, 
                path: file.path 
              });
            });
          } else {
            logInfo('⚠️ No se encontraron archivos de fotos de vehículos.');
          }
          
          if (fileMap['tecnomecanica[]']) {
            logInfo('Archivos de tecnomecánica recibidos:', { 
              cantidad: fileMap['tecnomecanica[]'].length,
              archivos: fileMap['tecnomecanica[]'].map(f => ({nombre: f.originalname, tamaño: f.size, path: f.path}))
            });
            fileMap['tecnomecanica[]'].forEach((file, index) => {
              vehiculoArchivosMap.tecnomecanicas[index] = file;
              logInfo(`Mapeando tecnomecánica para vehículo posición ${index}:`, { 
                nombre: file.originalname, 
                path: file.path 
              });
            });
          } else {
            logInfo('⚠️ No se encontraron archivos de tecnomecánica.');
          }
          
          if (fileMap['soat[]']) {
            logInfo('Archivos de SOAT recibidos:', { 
              cantidad: fileMap['soat[]'].length,
              archivos: fileMap['soat[]'].map(f => ({nombre: f.originalname, tamaño: f.size, path: f.path}))
            });
            fileMap['soat[]'].forEach((file, index) => {
              vehiculoArchivosMap.soats[index] = file;
              logInfo(`Mapeando SOAT para vehículo posición ${index}:`, { 
                nombre: file.originalname, 
                path: file.path 
              });
            });
          } else {
            logInfo('⚠️ No se encontraron archivos de SOAT.');
          }
          
          if (fileMap['licencia_conduccion[]']) {
            logInfo('Archivos de licencia de conducción recibidos:', { 
              cantidad: fileMap['licencia_conduccion[]'].length,
              archivos: fileMap['licencia_conduccion[]'].map(f => ({nombre: f.originalname, tamaño: f.size, path: f.path}))
            });
            fileMap['licencia_conduccion[]'].forEach((file, index) => {
              vehiculoArchivosMap.licencias_conduccion[index] = file;
              logInfo(`Mapeando licencia de conducción para vehículo posición ${index}:`, { 
                nombre: file.originalname, 
                path: file.path 
              });
            });
          } else {
            logInfo('⚠️ No se encontraron archivos de licencia de conducción.');
          }
          
          if (fileMap['licencia_transito[]']) {
            logInfo('Archivos de licencia de tránsito recibidos:', { 
              cantidad: fileMap['licencia_transito[]'].length,
              archivos: fileMap['licencia_transito[]'].map(f => ({nombre: f.originalname, tamaño: f.size, path: f.path}))
            });
            fileMap['licencia_transito[]'].forEach((file, index) => {
              vehiculoArchivosMap.licencias_transito[index] = file;
              logInfo(`Mapeando licencia de tránsito para vehículo posición ${index}:`, { 
                nombre: file.originalname, 
                path: file.path 
              });
            });
          } else {
            logInfo('⚠️ No se encontraron archivos de licencia de tránsito.');
          }

          for (let i = 0; i < cambiosDetectados.vehiculos.nuevos.length; i++) {
            const vehiculo = cambiosDetectados.vehiculos.nuevos[i];
            logInfo(`Procesando vehículo nuevo #${i+1}:`, { matricula: vehiculo.matricula });
            
            // Procesar cada tipo de documento de vehículo con mejor manejo de errores
            const vehiculoArchivos = {
              foto: null,
              tecnomecanica: null,
              soat: null,
              licencia_conduccion: null,
              licencia_transito: null
            };
            
            // Procesar foto del vehículo
            if (vehiculoArchivosMap.fotos[i]) {
              const file = vehiculoArchivosMap.fotos[i];
              logInfo(`Procesando foto para vehículo ${vehiculo.matricula}:`, { 
                nombre: file.originalname, 
                size: file.size
              });
              try {
                vehiculoArchivos.foto = await uploadToSpacesFromDisk(file.path, file.originalname);
                logInfo(`✅ Foto subida correctamente para vehículo ${vehiculo.matricula}:`, { url: vehiculoArchivos.foto });
              } catch (error) {
                logError(error, 'uploadFotoVehiculo');
                logInfo(`⚠️ Error al subir foto para vehículo ${vehiculo.matricula}: ${error.message}`);
              }
            } else {
              logInfo(`⚠️ No se encontró foto para vehículo ${vehiculo.matricula}`);
            }
            
            // Procesar tecnomecánica
            if (vehiculoArchivosMap.tecnomecanicas[i]) {
              const file = vehiculoArchivosMap.tecnomecanicas[i];
              logInfo(`Procesando tecnomecánica para vehículo ${vehiculo.matricula}:`, { 
                nombre: file.originalname, 
                size: file.size
              });
              try {
                vehiculoArchivos.tecnomecanica = await uploadToSpacesFromDisk(file.path, file.originalname);
                logInfo(`✅ Tecnomecánica subida correctamente para vehículo ${vehiculo.matricula}:`, { url: vehiculoArchivos.tecnomecanica });
              } catch (error) {
                logError(error, 'uploadTecnomecanicaVehiculo');
                logInfo(`⚠️ Error al subir tecnomecánica para vehículo ${vehiculo.matricula}: ${error.message}`);
              }
            } else {
              logInfo(`⚠️ No se encontró tecnomecánica para vehículo ${vehiculo.matricula}`);
            }
            
            // Procesar SOAT
            if (vehiculoArchivosMap.soats[i]) {
              const file = vehiculoArchivosMap.soats[i];
              logInfo(`Procesando SOAT para vehículo ${vehiculo.matricula}:`, { 
                nombre: file.originalname, 
                size: file.size
              });
              try {
                vehiculoArchivos.soat = await uploadToSpacesFromDisk(file.path, file.originalname);
                logInfo(`✅ SOAT subido correctamente para vehículo ${vehiculo.matricula}:`, { url: vehiculoArchivos.soat });
              } catch (error) {
                logError(error, 'uploadSoatVehiculo');
                logInfo(`⚠️ Error al subir SOAT para vehículo ${vehiculo.matricula}: ${error.message}`);
              }
            } else {
              logInfo(`⚠️ No se encontró SOAT para vehículo ${vehiculo.matricula}`);
            }
            
            // Procesar licencia de conducción
            if (vehiculoArchivosMap.licencias_conduccion[i]) {
              const file = vehiculoArchivosMap.licencias_conduccion[i];
              logInfo(`Procesando licencia de conducción para vehículo ${vehiculo.matricula}:`, { 
                nombre: file.originalname, 
                size: file.size
              });
              try {
                vehiculoArchivos.licencia_conduccion = await uploadToSpacesFromDisk(file.path, file.originalname);
                logInfo(`✅ Licencia de conducción subida correctamente para vehículo ${vehiculo.matricula}:`, { url: vehiculoArchivos.licencia_conduccion });
              } catch (error) {
                logError(error, 'uploadLicenciaConduccionVehiculo');
                logInfo(`⚠️ Error al subir licencia de conducción para vehículo ${vehiculo.matricula}: ${error.message}`);
              }
            } else {
              logInfo(`⚠️ No se encontró licencia de conducción para vehículo ${vehiculo.matricula}`);
            }
            
            // Procesar licencia de tránsito
            if (vehiculoArchivosMap.licencias_transito[i]) {
              const file = vehiculoArchivosMap.licencias_transito[i];
              logInfo(`Procesando licencia de tránsito para vehículo ${vehiculo.matricula}:`, { 
                nombre: file.originalname, 
                size: file.size
              });
              try {
                vehiculoArchivos.licencia_transito = await uploadToSpacesFromDisk(file.path, file.originalname);
                logInfo(`✅ Licencia de tránsito subida correctamente para vehículo ${vehiculo.matricula}:`, { url: vehiculoArchivos.licencia_transito });
              } catch (error) {
                logError(error, 'uploadLicenciaTransitoVehiculo');
                logInfo(`⚠️ Error al subir licencia de tránsito para vehículo ${vehiculo.matricula}: ${error.message}`);
              }
            } else {
              logInfo(`⚠️ No se encontró licencia de tránsito para vehículo ${vehiculo.matricula}`);
            }
            
            // Búsqueda alternativa para los documentos que faltan
            if (!vehiculoArchivos.foto || !vehiculoArchivos.tecnomecanica || !vehiculoArchivos.soat || 
                !vehiculoArchivos.licencia_conduccion || !vehiculoArchivos.licencia_transito) {
              
              logInfo(`🔍 Realizando búsqueda alternativa de documentos para vehículo ${vehiculo.matricula}`);
              
              // Buscar en todas las claves por algún documento que pueda corresponder a este vehículo
              const placaSinEspacios = vehiculo.matricula.replace(/\s+/g, '').toLowerCase();
              
              Object.keys(fileMap).forEach(key => {
                if (Array.isArray(fileMap[key])) {
                  fileMap[key].forEach(file => {
                    const filenameLower = file.originalname.toLowerCase();
                    
                    // Verificar si el nombre del archivo contiene la placa
                    if (filenameLower.includes(placaSinEspacios)) {
                      logInfo(`🔍 Encontrado posible documento para vehículo ${vehiculo.matricula} en ${key}:`, {
                        archivo: file.originalname
                      });
                      
                      // Asignar al tipo de documento correcto según el nombre de campo o contenido
                      const asignarSegunContenido = async () => {
                        try {
                          const url = await uploadToSpacesFromDisk(file.path, file.originalname);
                          
                          if (!vehiculoArchivos.foto && (key.includes('foto') || filenameLower.includes('foto'))) {
                            vehiculoArchivos.foto = url;
                            logInfo(`🔄 Asignada foto alternativa para vehículo ${vehiculo.matricula}`);
                          } else if (!vehiculoArchivos.tecnomecanica && (key.includes('tecno') || filenameLower.includes('tecno'))) {
                            vehiculoArchivos.tecnomecanica = url;
                            logInfo(`🔄 Asignada tecnomecánica alternativa para vehículo ${vehiculo.matricula}`);
                          } else if (!vehiculoArchivos.soat && (key.includes('soat') || filenameLower.includes('soat'))) {
                            vehiculoArchivos.soat = url;
                            logInfo(`🔄 Asignado SOAT alternativo para vehículo ${vehiculo.matricula}`);
                          } else if (!vehiculoArchivos.licencia_conduccion && (key.includes('conduccion') || filenameLower.includes('conduccion'))) {
                            vehiculoArchivos.licencia_conduccion = url;
                            logInfo(`🔄 Asignada licencia de conducción alternativa para vehículo ${vehiculo.matricula}`);
                          } else if (!vehiculoArchivos.licencia_transito && (key.includes('transito') || filenameLower.includes('transito'))) {
                            vehiculoArchivos.licencia_transito = url;
                            logInfo(`🔄 Asignada licencia de tránsito alternativa para vehículo ${vehiculo.matricula}`);
                          }
                        } catch (error) {
                          logError(error, 'asignarDocumentoAlternativoVehiculo');
                        }
                      };
                      
                      asignarSegunContenido();
                    }
                  });
                }
              });
            }
            
            // Log detallado de los resultados de la subida
            logInfo(`Resultados de la subida para vehículo ${vehiculo.matricula}:`, {
              foto: vehiculoArchivos.foto || 'No subida',
              tecnomecanica: vehiculoArchivos.tecnomecanica || 'No subida',
              soat: vehiculoArchivos.soat || 'No subida',
              licencia_conduccion: vehiculoArchivos.licencia_conduccion || 'No subida',
              licencia_transito: vehiculoArchivos.licencia_transito || 'No subida'
            });

              await conn.execute(
              'INSERT INTO vehiculos (solicitud_id, matricula, foto, tecnomecanica, soat, licencia_conduccion, licencia_transito, estado) VALUES (?, ?, ?, ?, ?, ?, ?, true)',
              [
                solicitudId, 
                vehiculo.matricula || null, 
                vehiculoArchivos.foto || null, 
                vehiculoArchivos.tecnomecanica || null, 
                vehiculoArchivos.soat || null, 
                vehiculoArchivos.licencia_conduccion || null, 
                vehiculoArchivos.licencia_transito || null
              ]
              );
            logInfo(`Vehículo ${vehiculo.matricula} insertado correctamente con ID de solicitud ${solicitudId}`);
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
                  'SELECT nombre, cedula, foto, documento_arl FROM colaboradores WHERE id = ?',
                  [col.id]
                );
                if (colaboradorData.length > 0) {
                  const colaborador = colaboradorData[0];
                  const cambios = col.cambios || {};
                  const cambiosList = [];
                  
                  if (cambios.foto) cambiosList.push('Foto actualizada');
                  if (cambios.documento_arl) cambiosList.push('Documento ARL actualizado');
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
        c.documento_arl, 
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
      'SELECT id, cedula, nombre, foto, documento_arl, estado FROM colaboradores WHERE id = ?',
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
      'SELECT id, cedula, nombre, foto, documento_arl FROM colaboradores WHERE solicitud_id = ? AND estado = false',
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
        c.documento_arl, 
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
      'SELECT id, cedula, nombre, foto, documento_arl, estado, solicitud_id FROM colaboradores WHERE id = ?',
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