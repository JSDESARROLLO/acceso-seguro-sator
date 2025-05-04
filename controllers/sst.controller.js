// sst.controller.js
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode'); 
const connection = require('../db/db');
const SECRET_KEY = process.env.JWT_SECRET || 'secreto';
const fs = require('fs');
const puppeteer = require('puppeteer');
const handlebars = require('handlebars');
const path = require('path');
const archiver = require('archiver');
const { format } = require('date-fns');
require('dotenv').config();
const axios = require('axios');
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');

// Definir el directorio temporal
const tempDir = path.join(__dirname, '../temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

// Funciones de logging
function logError(error, message) {
    console.error(`[${new Date().toISOString()}] ${message}`);
    if (error) {
        console.error('Error details:', error);
        if (error.stack) {
            console.error('Stack trace:', error.stack);
        }
    }
}

function logInfo(message, data = {}) {
    console.log(`[${new Date().toISOString()}] ${message}`);
    if (Object.keys(data).length > 0) {
        console.log('Data:', data);
    }
}

const controller = {};

const s3Client = new S3Client({
    forcePathStyle: false,
    endpoint: `https://${process.env.DO_SPACES_ENDPOINT}`,
    region: "us-east-1",
    credentials: {
        accessKeyId: process.env.DO_SPACES_KEY,
        secretAccessKey: process.env.DO_SPACES_SECRET
    }
});



// Vista de SST (con token y rol verificado)


controller.vistaSst = async (req, res) => {
  try {
    // Verificar token JWT
    const token = req.cookies.token;
    if (!token) {
      return res.redirect('/login');
    }
    
    let decodedToken;
    try {
      decodedToken = jwt.verify(token, process.env.JWT_SECRET || 'secreto');
    } catch (error) {
      console.error('Error al verificar token:', error);
      return res.redirect('/login');
    }
    
    // Obtener userId y verificar rol
    const userId = decodedToken.id;
    
    if (!userId) {
      console.error('❌ ERROR: No se pudo obtener userId del token:', decodedToken);
      return res.redirect('/login');
    }
    
    console.log('✅ userID obtenido del token:', userId);
    
    // Verificar que el usuario tenga el rol de SST
    if (decodedToken.role !== 'sst') {
      console.error('❌ ERROR: Usuario no tiene el rol SST:', decodedToken.role);
      return res.redirect('/login');
    }
    
    // Obtener las solicitudes
    const [solicitud] = await connection.execute(`
        SELECT s.*, us.username AS interventor, l.nombre_lugar 
        FROM solicitudes s 
        LEFT JOIN users us ON us.id = s.interventor_id 
        LEFT JOIN lugares l ON s.lugar = l.id
        WHERE us.username != "COA"  
        ORDER BY id DESC
    `);

    // Obtener las URLs de los documentos (si existen)
    const [solicitud_url_download] = await connection.execute('SELECT * FROM sst_documentos WHERE solicitud_id IN (SELECT id FROM solicitudes)');
    const [lugares] = await connection.execute('SELECT id, nombre_lugar FROM lugares ORDER BY nombre_lugar ASC'); // Cargar lugares

    // Formatear fechas
    solicitud.forEach(solici => {
        solici.inicio_obra = format(new Date(solici.inicio_obra), 'dd/MM/yyyy');
        solici.fin_obra = format(new Date(solici.fin_obra), 'dd/MM/yyyy');
    });

    // Al renderizar, asegurarse de que userId esté presente
    res.render('sst', {
      title: 'Vista SST',
      userId: userId,
      solicitud: solicitud,
      solicitud_url_download: solicitud_url_download,
      lugares: lugares
    });
    
  } catch (error) {
    console.error('Error en vistaSst:', error);
    res.status(500).send('Error al cargar la vista SST');
  }
};

// Función para limpiar archivos temporales
async function cleanupTempFiles(filePath) {
  try {
    if (!filePath) return;
    
    // Verificar si el archivo existe
    try {
      await fs.promises.access(filePath);
    } catch (err) {
      if (err.code === 'ENOENT') {
        logInfo('Archivo temporal no encontrado (ya fue eliminado):', { filePath });
        return;
      }
      throw err;
    }

    // Eliminar el archivo
    await fs.promises.unlink(filePath);
    logInfo('Archivo temporal eliminado:', { filePath });
  } catch (err) {
    logError(err, 'Limpieza de archivos temporales');
  }
}

// Función para limpiar todos los archivos temporales
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

// Función para limpiar directorio temporal
async function cleanupTempDirectory(dirPath) {
  try {
    if (!dirPath) return;
    
    // Verificar si el directorio existe
    try {
      await fs.promises.access(dirPath);
    } catch (err) {
      if (err.code === 'ENOENT') {
        logInfo('Directorio temporal no encontrado (ya fue eliminado):', { dirPath });
        return;
      }
      throw err;
    }

    // Eliminar el directorio y su contenido
    await fs.promises.rm(dirPath, { recursive: true, force: true });
    logInfo('Directorio temporal eliminado:', { dirPath });
  } catch (err) {
    logError(err, 'Limpieza de directorio temporal');
  }
}

// Función para subir archivo a Spaces con reintentos
async function uploadToSpacesFromDisk(filePath, originalName, folder = 'solicitudes', retries = 3) {
        const uuid = uuidv4();
        const extension = path.extname(originalName);
        const filename = `${uuid}${extension}`;
        const spacesPath = `${folder}/${filename}`;
        
    try {
        const fileContent = await fs.promises.readFile(filePath);
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
                
                const spacesUrl = `https://${process.env.DO_SPACES_BUCKET}.${process.env.DO_SPACES_ENDPOINT}/${spacesPath}`;
                logInfo('Archivo subido exitosamente:', { spacesUrl });
                
                await cleanupTempFiles(filePath);
                return spacesUrl;
            } catch (error) {
                attempt++;
                logError(error, `uploadToSpacesFromDisk (intento ${attempt}/${retries})`);
                if (attempt === retries) {
                    await cleanupTempFiles(filePath);
                    throw new Error(`Fallo al subir archivo tras ${retries} intentos: ${error.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    } catch (error) {
        logError(error, 'Error en uploadToSpacesFromDisk');
        throw error;
    }
}

controller.mostrarNegarSolicitud = async (req, res) => {
    try {
      const solicitudId = req.params.id;
      console.log('[RUTAS] Consultando detalles para solicitud con ID:', solicitudId);
  
      const query = `
        SELECT s.*, u.username as nombre_usuario
        FROM solicitudes s
        JOIN users u ON s.usuario_id = u.id
        WHERE s.id = ?
      `;
  
      const [solicitud] = await connection.execute(query, [solicitudId]);
  
      if (!solicitud || solicitud.length === 0) {
        return res.status(404).json({ message: 'Solicitud no encontrada' });
      }
  
      res.json(solicitud[0]); // Devolver datos en JSON en lugar de renderizar
    } catch (error) {
      console.error('Error al obtener detalles de la solicitud:', error);
      res.status(500).json({ message: 'Error al obtener detalles de la solicitud' });
    }
};

   

// Aprobar solicitud
controller.aprobarSolicitud = async (req, res) => {
    const { id } = req.params;
    const token = req.cookies.token;

    jwt.verify(token, SECRET_KEY, async (err, decoded) => {
        if (err) {
            return res.redirect('/login');
        }

        const { id: usuarioId } = decoded;

        try {
            const query = 'UPDATE solicitudes SET estado = "aprobada" WHERE id = ?';
            await connection.execute(query, [id]);

            const accionQuery = 'INSERT INTO acciones (solicitud_id, usuario_id, accion) VALUES (?, ?, "pendiente")';
            await connection.execute(accionQuery, [id, usuarioId]);

            res.redirect('/vista-sst');
        } catch (error) {
            console.error('Error al aprobar la solicitud:', error);
            res.status(500).send('Error al aprobar la solicitud');
        }
    });
};

// Negar solicitud (Guardar el comentario y la acción) 
controller.negarSolicitud = async (req, res) => {
    const { id } = req.params;
    const { comentario } = req.body;
    const token = req.cookies.token;
  
    try {
      const decoded = jwt.verify(token, SECRET_KEY);
      const usuarioId = decoded.id;
  
      // Verificar que la solicitud existe y está pendiente
      const [solicitud] = await connection.execute('SELECT estado FROM solicitudes WHERE id = ?', [id]);
      if (!solicitud.length || solicitud[0].estado !== 'pendiente') {
        return res.status(400).json({
          success: false,
          message: 'La solicitud no puede ser negada porque no está pendiente'
        });
      }
  
      // Actualizar estado
      await connection.execute('UPDATE solicitudes SET estado = "negada" WHERE id = ?', [id]);
      // Guardar acción
      await connection.execute(
        'INSERT INTO acciones (solicitud_id, usuario_id, accion, comentario) VALUES (?, ?, "negada", ?)',
        [id, usuarioId, comentario]
      );
  
      res.json({
        success: true,
        message: 'Solicitud negada correctamente'
      });
    } catch (error) {
      console.error('[Backend] Error al negar la solicitud:', error);
      res.status(500).json({
        success: false,
        message: 'Error al negar la solicitud'
      });
    }
  };
 

async function getImageBase64(imageUrl) {
    try {
        const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        return `data:image/jpeg;base64,${Buffer.from(response.data, 'binary').toString('base64')}`;
    } catch (error) {
        console.error("❌ Error al convertir imagen a Base64:", error.message);
        return null; // Retorna null si hay error
    }
}
const sharp = require('sharp');


async function convertWebPtoJpeg(url) {
    try {
        // Validar si la URL es nula, indefinida o no es una cadena válida
        if (!url || typeof url !== 'string' || url.trim() === '') {
            console.warn("⚠️ URL no válida o vacía. Omitiendo conversión.");
            return null;
        }

        // Descargar la imagen WebP
        const response = await axios.get(url, { responseType: 'arraybuffer' });

        // Convertir WebP a JPEG usando sharp
        const jpegBuffer = await sharp(response.data)
            .toFormat('jpeg') // Convertir a JPEG
            .toBuffer();

        // Devolver la imagen en Base64
        return `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
    } catch (error) {
        console.error("❌ Error al convertir la imagen:", error);
        return null;
    }
}

async function generateInformePDF({ solicitud, colaboradores, contractorName, interventorName }) {
    try {
        console.log("Prueba colaborador: ", colaboradores);

        // Convertir las imágenes de los colaboradores a Base64
        for (const colaborador of colaboradores) {
            // Convertir la foto de perfil
            if (colaborador.foto) {
                colaborador.fotoBase64 = await convertWebPtoJpeg(colaborador.foto);
            } else {
                colaborador.fotoBase64 = null; // Si no hay foto, asignar null
            }

            // Convertir la foto de la cédula
            if (colaborador.cedulaFoto) {
                colaborador.cedulaFotoBase64 = await convertWebPtoJpeg(colaborador.cedulaFoto);
            } else {
                colaborador.cedulaFotoBase64 = null; // Si no hay cédula, asignar null
            }
        }

        // Cargar la plantilla HTML
        const templatePath = path.join(__dirname, '../src/views', 'informe-template.html');
        const templateContent = fs.readFileSync(templatePath, 'utf8');
        const template = handlebars.compile(templateContent);

        // Convertir el logo a Base64
        const logoPath = path.join(__dirname, '../public', 'img', 'TSM-Sator-Logo.webp');
        const logoBase64 = fs.readFileSync(logoPath, 'base64');

        // Datos para la plantilla
        const data = {
            logo: `data:image/jpeg;base64,${logoBase64}`,
            fecha: new Date().toLocaleDateString(),
            solicitud,
            colaboradores,
            contractorName,
            interventorName
        };

        // Generar el HTML
        const html = template(data);

        // Opciones para el PDF
        const pdfOptions = {
            format: 'Letter',
            timeout: 60000, // Aumentar el tiempo de espera a 60 segundos
            phantomArgs: ['--web-security=no', '--load-images=yes'] // Habilitar carga de imágenes
        };

        // Generar el PDF
        return new Promise((resolve, reject) => {
            pdf.create(html, pdfOptions).toBuffer((err, buffer) => {
                if (err) {
                    console.error("❌ Error al generar el PDF:", err);
                    reject(err);
                } else {
                    resolve(buffer);
                }
            });
        });

    } catch (error) {
        console.error("❌ Error al generar el informe PDF:", error);
        throw error;
    }
} 

// async function generateInformePDF({ solicitud, colaboradores, contractorName, interventorName }) {
//     const templatePath = path.join(__dirname, '../src/views', 'informe-template.html');
//     const templateContent = fs.readFileSync(templatePath, 'utf8');
//     const template = handlebars.compile(templateContent);

//     const logoPath = path.join(__dirname, '../public', 'img', 'logo-ga.jpg');
//     const logoBase64 = fs.readFileSync(logoPath, 'base64');

//     const data = {
//         logoBase64: `data:image/png;base64,${logoBase64}`,
//         fecha: new Date().toLocaleDateString(),
//         solicitud,
//         contractorName,
//         interventorName,
//         colaboradores
//     };

//     const html = template(data);
//     const browser = await puppeteer.launch();
//     const page = await browser.newPage();
//     await page.setContent(html, { waitUntil: 'networkidle0' });

//     const pdfBuffer = await page.pdf({ format: 'A4' });
//     await browser.close();

//     return pdfBuffer;
// }

async function downloadFromSpaces(fileUrl) {
  if (!fileUrl) {
    logInfo('No se proporcionó URL de archivo para descargar');
    return null;
  }

  try {
    const urlParts = fileUrl.split('/');
        const fileKey = urlParts.slice(3).join('/');
    logInfo('Intentando descargar archivo desde Spaces:', { 
      fileUrl, 
      fileKey,
      bucket: process.env.DO_SPACES_BUCKET,
      endpoint: process.env.DO_SPACES_ENDPOINT
    });

        // Verificar existencia del archivo
        await s3Client.send(new HeadObjectCommand({
            Bucket: process.env.DO_SPACES_BUCKET,
            Key: fileKey
        }));

    const command = new GetObjectCommand({
      Bucket: process.env.DO_SPACES_BUCKET,
      Key: fileKey
    });

    const response = await s3Client.send(command);
    if (!response.Body) {
      throw new Error('No se recibió el contenido del archivo');
    }

    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    logInfo('Archivo descargado exitosamente:', { 
      fileUrl,
      size: buffer.length,
      contentType: response.ContentType
    });

    return buffer;
  } catch (error) {
        logError(error, `Error al descargar el archivo ${fileUrl}`);
    return null;
  }
}


// Función para generar el HTML
async function generateInformeHTML({ solicitud, colaboradores, vehiculos, contractorName, interventorName }) {
    try {
        const documentosFaltantes = [];
        const timestamp = format(new Date(), 'dd/MM/yyyy HH:mm:ss');
        const timestampFile = format(new Date(), 'yyyyMMdd_HHmmss');

        // Formatear fechas de la solicitud
        const solicitudFormateada = {
            ...solicitud,
            inicio_obra: format(new Date(solicitud.inicio_obra), 'dd/MM/yyyy'),
            fin_obra: format(new Date(solicitud.fin_obra), 'dd/MM/yyyy')
        };

        // Procesar colaboradores
        const colaboradoresProcesados = await Promise.all(colaboradores.map(async (colaborador) => {
            let fotoBase64 = null;
            if (colaborador.foto) {
                fotoBase64 = await convertWebPtoJpeg(colaborador.foto);
                if (!fotoBase64) {
                    documentosFaltantes.push(`Colaborador ${colaborador.nombre}: Foto de perfil no disponible`);
                }
            } else {
                documentosFaltantes.push(`Colaborador ${colaborador.nombre}: Foto de perfil no cargada`);
            }

            let cedulaFotoBase64 = null;
            if (colaborador.cedulaFoto) {
                cedulaFotoBase64 = await convertWebPtoJpeg(colaborador.cedulaFoto);
                if (!cedulaFotoBase64) {
                    documentosFaltantes.push(`Colaborador ${colaborador.nombre}: Foto de cédula no disponible`);
                }
            } else {
                documentosFaltantes.push(`Colaborador ${colaborador.nombre}: Foto de cédula no cargada`);
            }

            const qrData = `${process.env.BASE_URL}/vista-seguridad/${colaborador.id}`;
            const qrBase64 = await QRCode.toDataURL(qrData, { width: 100, margin: 1 });

            return {
                ...colaborador,
                fotoBase64,
                cedulaFotoBase64,
                qrBase64
            };
        }));

        // Procesar vehículos
        const vehiculosProcesados = await Promise.all(vehiculos.map(async (vehiculo) => {
            logInfo('Procesando vehículo:', {
                id: vehiculo.id,
                placa: vehiculo.placa,
                fotos_vehiculo: vehiculo.fotos_vehiculo,
                soat: vehiculo.soat,
                tecnomecanica: vehiculo.tecnomecanica,
                licencia_conduccion: vehiculo.licencia_conduccion,
                licencia_transito: vehiculo.licencia_transito
            });

            let fotoBase64 = null;
            if (vehiculo.fotos_vehiculo) {
                const fotoBuffer = await downloadFromSpaces(vehiculo.fotos_vehiculo);
                if (fotoBuffer) {
                    const extension = path.extname(vehiculo.fotos_vehiculo);
                    const mimeType = mime.lookup(extension) || 'image/jpeg';
                    fotoBase64 = `data:${mimeType};base64,${fotoBuffer.toString('base64')}`;
                } else {
                    documentosFaltantes.push(`Vehículo ${vehiculo.placa}: Foto no disponible`);
                }
            } else {
                documentosFaltantes.push(`Vehículo ${vehiculo.placa}: No tiene foto cargada`);
            }

            const documentos = {
                soat: { url: vehiculo.soat, nombre: 'SOAT' },
                tecnomecanica: { url: vehiculo.tecnomecanica, nombre: 'Tecnomecánica' },
                licencia_conduccion: { url: vehiculo.licencia_conduccion, nombre: 'Licencia de conducción' },
                licencia_transito: { url: vehiculo.licencia_transito, nombre: 'Licencia de tránsito' }
            };

            const documentosBase64 = {};
            await Promise.all(Object.entries(documentos).map(async ([tipo, doc]) => {
                if (doc.url) {
                    const docBuffer = await downloadFromSpaces(doc.url);
                    if (docBuffer) {
                        const extension = path.extname(doc.url);
                        const mimeType = mime.lookup(extension) || 'image/jpeg';
                        documentosBase64[tipo] = `data:${mimeType};base64,${docBuffer.toString('base64')}`;
                    } else {
                        documentosFaltantes.push(`Vehículo ${vehiculo.placa}: ${doc.nombre} no disponible`);
                    }
                } else {
                    documentosFaltantes.push(`Vehículo ${vehiculo.placa}: ${doc.nombre} no cargada`);
                }
            }));

            const qrData = `${process.env.BASE_URL}/vista-seguridad/VH-${vehiculo.id}`;
            const qrBase64 = await QRCode.toDataURL(qrData, { width: 100, margin: 1 });

            return {
                ...vehiculo,
                foto: fotoBase64,
                documentosBase64,
                qrBase64
            };
        }));

        // Generar archivo de documentos faltantes
        if (documentosFaltantes.length > 0) {
            const contenidoTxt = `REPORTE DE DOCUMENTOS FALTANTES
Fecha y hora: ${timestamp}
Solicitud ID: ${solicitud.id}
Empresa: ${solicitud.empresa}

Lista de documentos faltantes:
${documentosFaltantes.map((doc, index) => `${index + 1}. ${doc}`).join('\n')}`;

            const txtPath = path.join(__dirname, '..', 'temp', `documentos_faltantes_${solicitud.id}_${timestampFile}.txt`);
            await fs.promises.writeFile(txtPath, contenidoTxt, 'utf8');
            console.log('📄 Archivo de documentos faltantes generado:', txtPath);
        }

        // Cargar plantilla HTML
        const templatePath = path.join(__dirname, '../src/views', 'informe-template.html');
        const templateContent = fs.readFileSync(templatePath, 'utf8');
        const template = handlebars.compile(templateContent);

        // Convertir logo a Base64
        const logoPath = path.join(__dirname, '../public', 'img', 'TSM-Sator-Logo.webp');
        const logoBuffer = await sharp(fs.readFileSync(logoPath)).toFormat('jpeg').toBuffer();
        const logoBase64 = logoBuffer.toString('base64');

        // Datos para la plantilla
        const data = {
            logo: `data:image/jpeg;base64,${logoBase64}`,
            fecha: format(new Date(), 'dd/MM/yyyy'),
            solicitud: solicitudFormateada,
            colaboradores: colaboradoresProcesados,
            vehiculos: vehiculosProcesados,
            contractorName,
            interventorName,
            documentosFaltantes: documentosFaltantes.length > 0
        };

        // Generar HTML
        return template(data);
    } catch (error) {
        console.error('❌ Error al generar el informe HTML:', error);
        throw error;
    }
}


// Descargar documentos de una solicitud
controller.descargarSolicitud = async (req, res) => {
    const { solicitudId } = req.params;
    console.log('[RUTAS] Descargando documentos de la solicitud con ID:', solicitudId);

    try {
        // Crear directorio temporal si no existe
        const tempDir = path.join(__dirname, '..', 'temp');
        if (!fs.existsSync(tempDir)) {
            await fs.promises.mkdir(tempDir, { recursive: true });
        }

        // Obtener documentos de la solicitud
        const [documentos] = await connection.execute(
            'SELECT url FROM sst_documentos WHERE solicitud_id = ?',
            [solicitudId]
        );

        if (!documentos || documentos.length === 0) {
            return res.status(404).json({ success: false, message: 'No se encontraron documentos para esta solicitud' });
        }

        try {
            // Crear archivo ZIP
            const zipFileName = `documentos_solicitud_${solicitudId}_${Date.now()}.zip`;
            const zipPath = path.join(tempDir, zipFileName);
            const output = fs.createWriteStream(zipPath);
            const archive = archiver('zip', { zlib: { level: 9 } });

            // Manejar eventos del archivo ZIP
            output.on('close', () => {
                console.log('✅ ZIP creado exitosamente:', { path: zipPath, size: archive.pointer() });
                res.download(zipPath, zipFileName, (err) => {
                    if (err) {
                        console.error('Error al enviar el archivo:', err);
                        if (!res.headersSent) {
                            res.status(500).json({ success: false, message: 'Error al descargar el archivo' });
                        }
                    }
                    // Eliminar archivo ZIP después de enviarlo
                    fs.unlink(zipPath, (unlinkErr) => {
                        if (unlinkErr) {
                            console.error('Error al eliminar archivo temporal:', unlinkErr);
                        }
                    });
                });
            });

            archive.on('error', (err) => {
                throw err;
            });

            // Conectar archivo ZIP con respuesta
            archive.pipe(output);

            // Agregar documentos al ZIP
            for (const doc of documentos) {
                const filePath = path.join(__dirname, '..', 'public', doc.url);
                if (fs.existsSync(filePath)) {
                    archive.file(filePath, { name: path.basename(doc.url) });
                } else {
                    console.warn('Archivo no encontrado:', filePath);
                }
            }

            // Finalizar archivo ZIP
            await archive.finalize();

        } catch (zipError) {
            console.error('Error al crear el ZIP:', zipError);
            if (!res.headersSent) {
                res.status(500).json({ success: false, message: 'Error al crear el archivo ZIP' });
            }
        }

    } catch (error) {
        console.error('Error al generar el archivo ZIP:', error);
        if (!res.headersSent) {
            res.status(500).json({ 
                success: false,
                message: 'Error al generar el archivo ZIP', 
                error: error.message 
            });
        }
    }
};

// Función para descargar documentos
exports.descargarDocumentos = async (req, res) => {
    try {
        const solicitudId = req.params.id;
        
        // Verificar si existe un registro en sst_documentos
        const [docs] = await connection.execute(
            'SELECT url FROM sst_documentos WHERE solicitud_id = ?',
            [solicitudId]
        );

        if (docs.length === 0) {
            return res.status(404).json({ error: 'No se encontraron documentos para esta solicitud' });
        }

        const fileUrl = docs[0].url;

        // Configurar headers CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        // Redirigir al cliente directamente a la URL del archivo
        res.json({ 
            success: true, 
            url: fileUrl,
            message: 'URL de descarga generada correctamente'
        });

    } catch (error) {
        console.error('Error al descargar documentos:', error);
        res.status(500).json({ 
            error: 'Error al procesar la descarga de documentos',
            details: error.message 
        });
    }
};
 

// Obtener colaboradores de una solicitud
controller.getColaboradores = async (req, res) => {
    const { solicitudId } = req.params;
    const { estado } = req.query;
    
    console.log('Iniciando getColaboradores:', { solicitudId, estado });
    
    try {
        // Validar que solicitudId sea un número válido
        if (!solicitudId || isNaN(solicitudId)) {
            console.error('ID de solicitud inválido:', solicitudId);
            return res.status(400).json({ message: 'ID de solicitud inválido' });
        }

        // Obtener información de la solicitud y el contratista
        console.log('Consultando información de la solicitud...');
        const [solicitud] = await connection.execute(
            'SELECT s.id, s.empresa, u.username AS contratista FROM solicitudes s LEFT JOIN users u ON s.usuario_id = u.id WHERE s.id = ?',
            [solicitudId]
        );

        console.log('Resultado consulta solicitud:', solicitud);

        if (!solicitud.length) {
            console.error('Solicitud no encontrada:', solicitudId);
            return res.status(404).json({ message: 'Solicitud no encontrada' });
        }

        // Preparar consulta para colaboradores
        let colaboradoresQuery = `
            SELECT 
                c.id, 
                c.nombre, 
                c.cedula, 
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
            WHERE c.solicitud_id = ?`;

        let colaboradoresParams = [solicitudId];

        if (estado !== undefined) {
            colaboradoresQuery += ' AND c.estado = ?';
            colaboradoresParams.push(estado === 'true' || estado === true);
        }

        console.log('Consultando colaboradores...', { query: colaboradoresQuery, params: colaboradoresParams });

        // Obtener colaboradores
        const [colaboradores] = await connection.execute(colaboradoresQuery, colaboradoresParams);
        console.log(`Encontrados ${colaboradores.length} colaboradores`);

        // Procesar los resultados
        const colaboradoresProcesados = colaboradores.map(col => {
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
                capacitacion: col.capacitacion
            };
        });

        // Obtener vehículos
        console.log('Consultando vehículos...');
        const [vehiculos] = await connection.execute(
            `SELECT 
                v.id, 
                v.matricula as placa,
                v.estado,
                v.foto as fotos_vehiculo,
                v.soat,
                v.tecnomecanica,
                v.licencia_conduccion,
                v.licencia_transito
            FROM vehiculos v
            WHERE v.solicitud_id = ?`,
            [solicitudId]
        );
        console.log(`Encontrados ${vehiculos.length} vehículos`);

        // Procesar vehículos
        const vehiculosProcesados = vehiculos.map(v => ({
            ...v,
            estado: Boolean(v.estado)
        }));

        // Devolver los datos procesados
        return res.json({
            solicitud: solicitud[0],
            colaboradores: colaboradoresProcesados,
            vehiculos: vehiculosProcesados
        });

    } catch (error) {
        console.error('Error en getColaboradores:', error);
        return res.status(500).json({ 
            message: 'Error al obtener los datos',
            error: error.message 
        });
    }
};

// Obtener Plantilla SS existente
 
  controller.getPlantillaSS = async (req, res) => {
    const { documentoId } = req.params;
    
    try {
        // Validar que documentoId sea un número válido
        if (!documentoId || isNaN(documentoId)) {
            return res.status(400).json({ 
                success: false,
                message: 'ID de documento inválido',
                plantilla: null 
            });
        }

        const [plantilla] = await connection.execute(
            'SELECT id, fecha_inicio, fecha_fin FROM plantilla_seguridad_social WHERE id = ?',
            [documentoId]
        );

        return res.json({ 
            success: true,
            plantilla: plantilla.length ? plantilla[0] : null 
        });
    } catch (error) {
        console.error('Error al obtener plantilla:', error);
        return res.status(500).json({ 
            success: false,
            message: 'Error al obtener la plantilla',
            error: error.message 
        });
    }
  };
  
  // Guardar o Actualizar Plantilla SS
  controller.guardarOActualizarPlantillaSS = async (req, res) => {
    const { colaboradorId, solicitudId, documentoId, fechaInicio, fechaFin } = req.body;
    
    console.log('Datos recibidos:', { colaboradorId, solicitudId, documentoId, fechaInicio, fechaFin });
    
    try {
      // Validar fechas
      if (!fechaInicio || !fechaFin) {
        return res.status(400).json({ message: 'Las fechas son requeridas' });
      }

      const inicio = new Date(fechaInicio);
      const fin = new Date(fechaFin);
      
      if (isNaN(inicio.getTime()) || isNaN(fin.getTime())) {
        return res.status(400).json({ message: 'Fechas inválidas' });
      }

      if (fin <= inicio) {
        return res.status(400).json({ message: 'La fecha de fin debe ser posterior a la fecha de inicio' });
      }

      // Si hay documentoId, actualizar el registro existente
      if (documentoId) {
        const [result] = await connection.execute(
          'UPDATE plantilla_seguridad_social SET fecha_inicio = ?, fecha_fin = ?, updated_at = NOW() WHERE id = ?',
          [fechaInicio, fechaFin, documentoId]
        );

        if (result.affectedRows === 0) {
          return res.status(404).json({ message: 'No se encontró la plantilla para actualizar' });
        }

        return res.json({ 
          success: true,
          message: 'Plantilla actualizada correctamente',
          plantilla: { id: documentoId, fecha_inicio: fechaInicio, fecha_fin: fechaFin }
        });
      }

      // Si no hay documentoId, crear un nuevo registro
      const [result] = await connection.execute(
        'INSERT INTO plantilla_seguridad_social (colaborador_id, solicitud_id, fecha_inicio, fecha_fin) VALUES (?, ?, ?, ?)',
        [colaboradorId, solicitudId, fechaInicio, fechaFin]
      );

      if (result.affectedRows === 0) {
        return res.status(500).json({ message: 'Error al crear la plantilla' });
      }

      return res.json({
        success: true,
        message: 'Plantilla creada correctamente',
        plantilla: { 
          id: result.insertId,
          fecha_inicio: fechaInicio,
          fecha_fin: fechaFin
        }
      });

    } catch (error) {
      console.error('Error al guardar/actualizar plantilla:', error);
      res.status(500).json({ message: 'Error interno del servidor' });
    }
  };
  
  // Obtener Historial de Cursos
  controller.getHistorialCursos = async (req, res) => {
    const { colaboradorId } = req.params;
    try {
      const [historial] = await connection.execute(
        `SELECT cap.nombre, rc.estado, rc.puntaje_obtenido, rc.fecha_vencimiento 
         FROM resultados_capacitaciones rc 
         JOIN capacitaciones cap ON rc.capacitacion_id = cap.id 
         WHERE rc.colaborador_id = ? 
         ORDER BY rc.created_at DESC`,
        [colaboradorId]
      );
      res.json({ historial });
    } catch (error) {
      console.error('Error al obtener historial:', error);
      res.status(500).json({ message: 'Error interno del servidor' });
    }
  };

// Filtrar solicitudes para SST

controller.filtrarSolicitudesSst = async (req, res) => {
    console.log('🔍 Iniciando filtrado de solicitudes SST');
    
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({ message: 'No autorizado' });
    }
  
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        if (decoded.role !== 'sst') {
            return res.status(403).json({ message: 'Acceso denegado' });
        }
  
        // Obtener parámetros según el método HTTP
        const params = req.method === 'GET' ? req.query : req.body;
        console.log('📝 Parámetros recibidos:', params);
      
        const { id, cedula, interventor, estado, fechaInicio, fechaFin, nit, empresa, lugar, vigencia, placa, colaboradorId, vehiculoId } = params;
  
        // Construir consulta base
        let query = `
            SELECT DISTINCT
                s.id AS solicitud_id,
                s.empresa,
                s.nit,
                DATE_FORMAT(s.inicio_obra, '%d/%m/%Y') AS inicio_obra,
                DATE_FORMAT(s.fin_obra, '%d/%m/%Y') AS fin_obra,
                s.dias_trabajo,
                l.nombre_lugar AS lugar,
                s.labor,
                us.username AS interventor,
                s.estado AS solicitud_estado,
                CASE
                    WHEN DATE(s.fin_obra) < CURDATE() THEN 'Vencida'
                    ELSE 'Vigente'
                END AS estado_vigencia
            FROM solicitudes s
            LEFT JOIN users us ON us.id = s.interventor_id
            LEFT JOIN lugares l ON s.lugar = l.id
            LEFT JOIN colaboradores c ON c.solicitud_id = s.id
            LEFT JOIN vehiculos v ON v.solicitud_id = s.id
            WHERE us.username != 'COA'
        `;
        
        const placeholders = [];
  
        // Agregar condiciones de filtrado
        if (id) {
            query += ' AND s.id = ?';
            placeholders.push(id);
        }
        if (cedula) {
            query += ' AND c.cedula LIKE ?';
            placeholders.push(`%${cedula}%`);
        }
        if (colaboradorId) {
            query += ' AND c.id = ?';
            placeholders.push(colaboradorId);
        }
        if (vehiculoId) {
            query += ' AND v.id = ?';
            placeholders.push(vehiculoId);
        }
        if (placa) {
            query += ' AND v.matricula LIKE ?';
            placeholders.push(`%${placa}%`);
        }
        if (interventor) {
            query += ' AND us.username LIKE ?';
            placeholders.push(`%${interventor}%`);
        }
        if (estado) {
            query += ' AND s.estado = ?';
            placeholders.push(estado.toLowerCase());
        }
        if (fechaInicio) {
            query += ' AND s.inicio_obra >= ?';
            placeholders.push(fechaInicio);
        }
        if (fechaFin) {
            query += ' AND s.fin_obra <= ?';
            placeholders.push(fechaFin);
        }
        if (nit) {
            query += ' AND s.nit LIKE ?';
            placeholders.push(`%${nit}%`);
        }
        if (empresa) {
            query += ' AND s.empresa LIKE ?';
            placeholders.push(`%${empresa}%`);
        }
        if (lugar) {
            query += ' AND l.nombre_lugar = ?';
            placeholders.push(lugar);
        }
        if (vigencia) {
            query += ' AND (CASE WHEN DATE(s.fin_obra) < CURDATE() THEN "Vencida" ELSE "Vigente" END) = ?';
            placeholders.push(vigencia);
        }
  
        query += ' GROUP BY s.id ORDER BY s.id DESC';
        console.log('📋 Query final:', query);
        console.log('📋 Placeholders:', placeholders);
  
        const [solicitudes] = await connection.execute(query, placeholders);
        console.log(`✅ Se encontraron ${solicitudes.length} solicitudes`);
      
        // Obtener documentos
        if (solicitudes.length > 0) {
            const solicitudesIds = solicitudes.map(s => s.solicitud_id);
            const placeholdersDocs = solicitudesIds.map(() => '?').join(',');
            const [documentos] = await connection.execute(
                `SELECT solicitud_id, url FROM sst_documentos WHERE solicitud_id IN (${placeholdersDocs})`,
                solicitudesIds
            );
            
            // Agregar URLs de documentos
            solicitudes.forEach(solicitud => {
                const documento = documentos.find(d => d.solicitud_id === solicitud.solicitud_id);
                solicitud.url_documento = documento ? documento.url : null;
            });
        }
        
        res.json(solicitudes);
    } catch (err) {
        console.error('❌ Error al filtrar solicitudes:', err);
        res.status(500).json({ 
            message: 'Error al filtrar solicitudes', 
            error: err.message
        });
    }
};


// Obtener documento de vehículo
controller.getVehiculoDocumento = async (req, res) => {
    try {
        const { vehiculoId, tipoDocumento } = req.params;
        
        console.log('Obteniendo documento:', { vehiculoId, tipoDocumento });
        
        const [documento] = await connection.execute(
            'SELECT id, fecha_inicio, fecha_fin, estado FROM plantilla_documentos_vehiculos WHERE vehiculo_id = ? AND tipo_documento = ? ORDER BY created_at DESC LIMIT 1',
            [vehiculoId, tipoDocumento]
        );

        if (documento.length === 0) {
            return res.json({ success: true, documento: null });
        }

        res.json({
            success: true,
            documento: {
                id: documento[0].id,
                fecha_inicio: documento[0].fecha_inicio,
                fecha_fin: documento[0].fecha_fin,
                estado: documento[0].estado
            }
        });
    } catch (error) {
        console.error('Error al obtener documento:', error);
        res.status(500).json({ success: false, message: 'Error al obtener el documento', error: error.message });
    }
};
  
// Guardar o actualizar documento de vehículo
controller.saveVehiculoDocumento = async (req, res) => {
    const conn = await connection.getConnection();
    try {
        await conn.beginTransaction();
        
        const { vehiculoId, solicitudId, tipoDocumento, documentoId, fechaInicio, fechaFin } = req.body;
        
        console.log('Datos recibidos en saveVehiculoDocumento:', { vehiculoId, solicitudId, tipoDocumento, documentoId, fechaInicio, fechaFin });
        
        // Validar tipo de documento
        if (!['soat', 'tecnomecanica'].includes(tipoDocumento)) {
            await conn.rollback();
            return res.status(400).json({ success: false, message: 'Tipo de documento no válido' });
        }
        
        // Validar fechas
        if (!fechaInicio || !fechaFin) {
            await conn.rollback();
            return res.status(400).json({ success: false, message: 'Las fechas de inicio y fin son requeridas' });
        }
        
        const inicio = new Date(fechaInicio);
        const fin = new Date(fechaFin);
        if (isNaN(inicio) || isNaN(fin)) {
            await conn.rollback();
            return res.status(400).json({ success: false, message: 'Formato de fecha inválido' });
        }
        if (fin <= inicio) {
            await conn.rollback();
            return res.status(400).json({ success: false, message: 'La fecha de fin debe ser posterior a la fecha de inicio' });
        }

        const estado = fin > new Date() ? 'vigente' : 'vencido';
        const fechaInicioISO = inicio.toISOString().split('T')[0];
        const fechaFinISO = fin.toISOString().split('T')[0];

        let result;
        if (documentoId) {
            [result] = await conn.execute(
                'UPDATE plantilla_documentos_vehiculos SET fecha_inicio = ?, fecha_fin = ?, estado = ?, updated_at = NOW() WHERE id = ?',
                [fechaInicioISO, fechaFinISO, estado, documentoId]
            );
        } else {
            // Verificar si ya existe un registro para este vehículo y tipo de documento
            const [existing] = await conn.execute(
                'SELECT id FROM plantilla_documentos_vehiculos WHERE vehiculo_id = ? AND tipo_documento = ? ORDER BY created_at DESC LIMIT 1',
                [vehiculoId, tipoDocumento]
            );

            if (existing.length > 0) {
                // Actualizar el registro existente
                [result] = await conn.execute(
                    'UPDATE plantilla_documentos_vehiculos SET fecha_inicio = ?, fecha_fin = ?, estado = ?, updated_at = NOW() WHERE id = ?',
                    [fechaInicioISO, fechaFinISO, estado, existing[0].id]
                );
            } else {
                // Crear nuevo registro
                [result] = await conn.execute(
                    'INSERT INTO plantilla_documentos_vehiculos (vehiculo_id, solicitud_id, tipo_documento, fecha_inicio, fecha_fin, estado) VALUES (?, ?, ?, ?, ?, ?)',
                    [vehiculoId, solicitudId, tipoDocumento, fechaInicioISO, fechaFinISO, estado]
                );
            }
        }

        if (result.affectedRows === 0) {
            await conn.rollback();
            return res.status(500).json({ success: false, message: 'Error al guardar el documento' });
        }

        await conn.commit();
        res.json({ success: true, message: documentoId ? 'Documento actualizado' : 'Documento creado' });
    } catch (error) {
        await conn.rollback();
        console.error('Error al guardar documento:', error);
        res.status(500).json({ success: false, message: 'Error al guardar el documento', error: error.message });
    } finally {
        conn.release();
    }
};
  
// Alternar estado de licencia
controller.toggleLicencia = async (req, res) => {
        const { vehiculoId, solicitudId, tipoLicencia, activar } = req.body;
        
    console.log('Datos recibidos en toggleLicencia:', {
        vehiculoId,
        solicitudId,
        tipoLicencia,
        activar
    });

    try {
        // Primero verificar si existe la licencia
        const [existingLicense] = await connection.execute(
            'SELECT id FROM licencias_vehiculo WHERE vehiculo_id = ? AND tipo = ?',
            [vehiculoId, tipoLicencia]
        );

        if (existingLicense.length > 0) {
            // Actualizar licencia existente
            const [result] = await connection.execute(
                'UPDATE licencias_vehiculo SET estado = ? WHERE vehiculo_id = ? AND tipo = ?',
                [activar, vehiculoId, tipoLicencia]
            );
            console.log('Actualización de licencia completada:', result);
        } else {
            // Insertar nueva licencia
            const [result] = await connection.execute(
                'INSERT INTO licencias_vehiculo (vehiculo_id, solicitud_id, tipo, estado) VALUES (?, ?, ?, ?)',
                [vehiculoId, solicitudId, tipoLicencia, activar]
            );
            console.log('Inserción de licencia completada:', result);
        }

        // Obtener vehículos actualizados con el estado de las licencias
        const [vehiculos] = await connection.execute(
            `SELECT 
                v.id, 
                v.matricula as placa,
                v.estado,
                v.foto as fotos_vehiculo,
                v.soat,
                v.tecnomecanica,
                v.licencia_conduccion,
                v.licencia_transito,
                lc.estado as licencia_conduccion_estado,
                lt.estado as licencia_transito_estado
            FROM vehiculos v
            LEFT JOIN licencias_vehiculo lc ON v.id = lc.vehiculo_id AND lc.tipo = 'licencia_conduccion'
            LEFT JOIN licencias_vehiculo lt ON v.id = lt.vehiculo_id AND lt.tipo = 'licencia_transito'
            WHERE v.solicitud_id = ?`,
            [solicitudId]
        );

        // Procesar los resultados para asegurar que los estados sean booleanos
        const vehiculosProcesados = vehiculos.map(v => ({
            ...v,
            licencia_conduccion: v.licencia_conduccion_estado === 1,
            licencia_transito: v.licencia_transito_estado === 1
        }));

        res.json({
            success: true,
            message: activar ? 'Licencia aprobada correctamente' : 'Licencia inhabilitada correctamente',
            vehiculos: vehiculosProcesados
        });
    } catch (error) {
        console.error('Error en toggleLicencia:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar la licencia',
            error: error.message
        });
    }
};
  
// Generar y subir documentos de una solicitud
controller.generarDocumentos = async (req, res) => {
    const { id } = req.params;
    console.log('🔄 Iniciando generación de documentos para solicitud:', id);

    let tempDir;
    let zipPath;
    try {
        // Validar solicitud
        const [solicitudExiste] = await connection.execute(
            'SELECT COUNT(*) as count FROM solicitudes WHERE id = ?',
            [id]
        );
        if (!solicitudExiste[0].count) {
            return res.status(404).json({
                success: false,
                message: `No se encontró la solicitud con ID ${id}`
            });
        }

        // Crear directorio temporal
        tempDir = path.join(__dirname, '..', 'temp', `solicitud_${id}_${Date.now()}`);
            await fs.promises.mkdir(tempDir, { recursive: true });
            console.log('📁 Directorio temporal creado:', tempDir);

        // Obtener datos de la solicitud
        const [solicitud] = await connection.execute(`
            SELECT 
                s.*,
                u.empresa,
                u.nit,
                u2.username as interventor_nombre,
                l.nombre_lugar as lugar
            FROM solicitudes s
            JOIN users u ON s.usuario_id = u.id
            LEFT JOIN users u2 ON s.interventor_id = u2.id
            LEFT JOIN lugares l ON s.lugar = l.id
            WHERE s.id = ?
        `, [id]);

        if (!solicitud.length) {
            throw new Error(`No se encontraron datos para la solicitud ${id}`);
        }

        // Obtener colaboradores
        const [colaboradores] = await connection.execute(
            'SELECT id, cedula, nombre, estado, foto, cedulaFoto FROM colaboradores WHERE solicitud_id = ?',
            [id]
        );

        // Obtener vehículos con documentos
        const [vehiculos] = await connection.execute(
            `SELECT 
                v.id,
                v.matricula as placa,
                v.estado,
                v.foto as fotos_vehiculo,
                v.soat,
                v.tecnomecanica,
                v.licencia_conduccion,
                v.licencia_transito
            FROM vehiculos v
            WHERE v.solicitud_id = ?`,
            [id]
        );

        console.log(`📊 Datos obtenidos: ${colaboradores.length} colaboradores, ${vehiculos.length} vehículos`);

        // Generar HTML
        const html = await generateInformeHTML({
            solicitud: solicitud[0],
            colaboradores,
            vehiculos,
            contractorName: solicitud[0].empresa,
            interventorName: solicitud[0].interventor_nombre
        });
        
        // Guardar HTML
        const htmlPath = path.join(tempDir, `Informe_Solicitud_${id}.html`);
        await fs.promises.writeFile(htmlPath, html);

        // Crear archivo ZIP
        const zipFileName = `documentos_solicitud_${id}_${Date.now()}.zip`;
        zipPath = path.join(tempDir, zipFileName);

        // Crear y llenar el ZIP
        await new Promise(async (resolve, reject) => {
            const output = fs.createWriteStream(zipPath);
            const archive = archiver('zip', {
                zlib: { level: 9 }
            });

            output.on('close', resolve);
            output.on('error', reject);
            archive.on('error', reject);

            archive.pipe(output);

            // Agregar HTML al ZIP
            archive.file(htmlPath, { name: `Informe_Solicitud_${id}.html` });

            // Incluir documentos faltantes si existen
            const files = fs.readdirSync(path.join(__dirname, '..', 'temp'));
            const docsFaltantesFiles = files.filter(file => file.startsWith(`documentos_faltantes_${id}_`) && file.endsWith('.txt'));
            if (docsFaltantesFiles.length > 0) {
                const latestFile = docsFaltantesFiles.sort().reverse()[0];
                const sourcePath = path.join(__dirname, '..', 'temp', latestFile);
                archive.file(sourcePath, { name: `documentos_faltantes_${id}.txt` });
            }

            // Procesar documentos de la solicitud (ARL y Pasocial)
        if (solicitud[0].arl_documento) {
            const arlBuffer = await downloadFromSpaces(solicitud[0].arl_documento);
            if (arlBuffer) {
                    archive.append(arlBuffer, {
                        name: `ARL_${id}${path.extname(solicitud[0].arl_documento)}`
                    });
                }
            }
        if (solicitud[0].pasocial_documento) {
            const pasocialBuffer = await downloadFromSpaces(solicitud[0].pasocial_documento);
            if (pasocialBuffer) {
                    archive.append(pasocialBuffer, {
                        name: `Pasocial_${id}${path.extname(solicitud[0].pasocial_documento)}`
                    });
                }
            }

            // Procesar vehículos
        for (const vehiculo of vehiculos) {
                const vehiculoDir = `vehiculo_${vehiculo.placa}`;

                // Agregar foto del vehículo
                if (vehiculo.fotos_vehiculo) {
                    const fotoBuffer = await downloadFromSpaces(vehiculo.fotos_vehiculo);
                    if (fotoBuffer) {
                        archive.append(fotoBuffer, {
                            name: `${vehiculoDir}/foto_vehiculo${path.extname(vehiculo.fotos_vehiculo)}`
                        });
                    }
                }

                // Agregar documentos del vehículo
            const documentos = {
                    soat: vehiculo.soat,
                    tecnomecanica: vehiculo.tecnomecanica,
                    licencia_conduccion: vehiculo.licencia_conduccion,
                    licencia_transito: vehiculo.licencia_transito
                };

                for (const [tipo, url] of Object.entries(documentos)) {
                    if (url) {
                        const docBuffer = await downloadFromSpaces(url);
                    if (docBuffer) {
                            archive.append(docBuffer, {
                                name: `${vehiculoDir}/${tipo}${path.extname(url)}`
                            });
                        }
                    }
                }
            }

            // Finalizar el archivo
            await archive.finalize();
        });

        // Subir ZIP a Spaces
        const zipUrl = await uploadToSpacesFromDisk(zipPath, zipFileName, 'documentos');
        console.log('✅ ZIP subido a Spaces:', zipUrl);

        // Guardar URL en sst_documentos
                    await connection.execute(
                        'INSERT INTO sst_documentos (solicitud_id, url) VALUES (?, ?)',
            [id, zipUrl]
                    );

        // Responder
        res.json({
                        success: true,
            message: 'Documentos generados exitosamente',
            url: zipUrl
        });

                } catch (error) {
        console.error('❌ Error al generar documentos:', error);
        res.status(500).json({
            success: false,
            message: 'Error al generar documentos: ' + error.message
        });
                } finally {
                    // Limpiar archivos temporales
        if (tempDir) {
                    try {
                        await fs.promises.rm(tempDir, { recursive: true, force: true });
                        console.log('🧹 Archivos temporales eliminados');
                    } catch (cleanupError) {
                console.error('Error al limpiar archivos temporales:', cleanupError);
            }
        }
    }
};

controller.getSolicitudDetails = async (req, res) => {
    try {
        const solicitudId = req.params.solicitudId;
        console.log('📋 Obteniendo detalles de la solicitud:', solicitudId);

        const query = `
            SELECT s.*, u.username as nombre_usuario, l.nombre_lugar
            FROM solicitudes s
            LEFT JOIN users u ON s.usuario_id = u.id
            LEFT JOIN lugares l ON s.lugar = l.id
            WHERE s.id = ?
        `;

        const [solicitud] = await connection.execute(query, [solicitudId]);

        if (!solicitud || solicitud.length === 0) {
            console.error('❌ Solicitud no encontrada:', solicitudId);
            return res.status(404).json({ 
                error: 'Solicitud no encontrada',
                message: 'No se encontró la solicitud solicitada'
            });
        }

        // Formatear fechas
        const solicitudData = solicitud[0];
        solicitudData.inicio_obra = format(new Date(solicitudData.inicio_obra), 'dd/MM/yyyy');
        solicitudData.fin_obra = format(new Date(solicitudData.fin_obra), 'dd/MM/yyyy');

        console.log('✅ Detalles de la solicitud obtenidos correctamente');
        res.json(solicitudData);
    } catch (error) {
        console.error('❌ Error al obtener detalles de la solicitud:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor',
            message: 'Ocurrió un error al obtener los detalles de la solicitud'
        });
    }
};

// Función para obtener los vehículos de una solicitud
async function getVehiculos(req, res) {
  try {
    const { solicitudId } = req.params;
    
    // Log para depuración
    logInfo('Obteniendo vehículos para la solicitud', { solicitudId });
    
    // Consulta SQL para obtener los vehículos con sus documentos y licencias
    const query = `
      SELECT 
        v.id,
        v.matricula as placa,
        v.estado,
        s.id as soat_id, 
        s.fecha_inicio as soat_inicio, 
        s.fecha_fin as soat_fin,
        t.id as tecno_id, 
        t.fecha_inicio as tecno_inicio, 
        t.fecha_fin as tecno_fin,
        lc.id as licencia_conduccion_id,
        lc.estado as licencia_conduccion_estado,
        lc.fecha_actualizacion as licencia_conduccion_fecha,
        lt.id as licencia_transito_id,
        lt.estado as licencia_transito_estado,
        lt.fecha_actualizacion as licencia_transito_fecha
      FROM vehiculos v
      LEFT JOIN plantilla_documentos_vehiculos s ON v.id = s.vehiculo_id AND s.tipo_documento = 'soat'
      LEFT JOIN plantilla_documentos_vehiculos t ON v.id = t.vehiculo_id AND t.tipo_documento = 'tecnomecanica'
      LEFT JOIN licencias_vehiculo lc ON v.id = lc.vehiculo_id AND lc.tipo = 'licencia_conduccion'
      LEFT JOIN licencias_vehiculo lt ON v.id = lt.vehiculo_id AND lt.tipo = 'licencia_transito'
      WHERE v.solicitud_id = ?
    `;
    
    const [vehiculos] = await connection.execute(query, [solicitudId]);
    
    // Formatear los datos para la respuesta
    const vehiculosFormateados = vehiculos.map(v => ({
      id: v.id,
      placa: v.placa,
      estado: v.estado,
      licencias: [
        {
          tipo: 'licencia_conduccion',
          id: v.licencia_conduccion_id,
          estado: v.licencia_conduccion_estado,
          fecha_actualizacion: v.licencia_conduccion_fecha
        },
        {
          tipo: 'licencia_transito',
          id: v.licencia_transito_id,
          estado: v.licencia_transito_estado,
          fecha_actualizacion: v.licencia_transito_fecha
        }
      ],
      soat: v.soat_id ? {
        id: v.soat_id,
        fecha_inicio: v.soat_inicio,
        fecha_fin: v.soat_fin
      } : null,
      tecnomecanica: v.tecno_id ? {
        id: v.tecno_id,
        fecha_inicio: v.tecno_inicio,
        fecha_fin: v.tecno_fin
      } : null
    }));
    
    res.json({ success: true, vehiculos: vehiculosFormateados });
  } catch (error) {
    logError(error, 'Error al obtener los vehículos');
    res.status(500).json({ 
      success: false, 
      message: 'Error al obtener los vehículos',
      error: error.message 
    });
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

// Exportar el middleware y el controlador
module.exports = {
  ...controller,
  getVehiculos,
  cleanupMiddleware
};
