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
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const pdf = require('html-pdf');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');

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

// Función para subir archivo a Spaces con reintentos
async function uploadToSpacesFromDisk(filePath, originalName, folder = 'solicitudes', retries = 3) {
    const uuid = uuidv4();
    const extension = path.extname(originalName);
    const filename = `${uuid}${extension}`;
    const spacesPath = `${folder}/${filename}`;
    
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
            console.log('Subiendo archivo a Spaces:', { filePath, spacesPath, attempt: attempt + 1 });
            await s3Client.send(command);
            
            // Construir la URL completa de DigitalOcean Spaces
            const spacesUrl = `https://${process.env.DO_SPACES_BUCKET}.${process.env.DO_SPACES_ENDPOINT}/${spacesPath}`;
            
            console.log('Archivo subido exitosamente:', { spacesUrl });
            return spacesUrl;
        } catch (error) {
            attempt++;
            console.error(`Error al subir archivo (intento ${attempt}/${retries}):`, error);
            if (attempt === retries) throw new Error(`Fallo al subir archivo tras ${retries} intentos: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Espera exponencial
        }
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
    // Extraer la clave del archivo de la URL completa
    const urlParts = fileUrl.split('/');
    const fileKey = urlParts.slice(3).join('/'); // Obtener la ruta después del bucket y endpoint

    logInfo('Intentando descargar archivo desde Spaces:', { 
      fileUrl, 
      fileKey,
      bucket: process.env.DO_SPACES_BUCKET,
      endpoint: process.env.DO_SPACES_ENDPOINT
    });

    const command = new GetObjectCommand({
      Bucket: process.env.DO_SPACES_BUCKET,
      Key: fileKey
    });

    const response = await s3Client.send(command);
    
    if (!response.Body) {
      throw new Error('No se recibió el contenido del archivo');
    }

    // Convertir el stream a buffer
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
    logError(error, `Error al descargar el archivo ${fileUrl} desde ${fileUrl}: ${error.message}`);
    if (error.$metadata) {
      logInfo('Metadatos del error:', {
        requestId: error.$metadata.requestId,
        cfId: error.$metadata.cfId,
        httpStatusCode: error.$metadata.httpStatusCode
      });
    }
    return null;
  }
}


// Función para generar el HTML
async function generateInformeHTML({ solicitud, colaboradores, vehiculos, contractorName, interventorName }) {
    try {
        // Formatear fechas de la solicitud
        const solicitudFormateada = {
            ...solicitud,
            inicio_obra: format(new Date(solicitud.inicio_obra), 'dd/MM/yyyy'),
            fin_obra: format(new Date(solicitud.fin_obra), 'dd/MM/yyyy')
        };

        // Convertir las imágenes de los colaboradores a Base64
        for (const colaborador of colaboradores) {
            colaborador.fotoBase64 = colaborador.foto ? await convertWebPtoJpeg(colaborador.foto) : null;
            colaborador.cedulaFotoBase64 = colaborador.cedulaFoto ? await convertWebPtoJpeg(colaborador.cedulaFoto) : null;
            // Generar QR para el ID del colaborador
            const qrData = `${process.env.BASE_URL}/vista-seguridad/${colaborador.id}`;
            colaborador.qrBase64 = await QRCode.toDataURL(qrData, { width: 100, margin: 1 });
        }

        // Procesar vehículos
        for (const vehiculo of vehiculos) {
            // Generar QR para el vehículo
            const qrData = `${process.env.BASE_URL}/vista-seguridad/VH-${vehiculo.id}`;
            vehiculo.qrBase64 = await QRCode.toDataURL(qrData, { width: 100, margin: 1 });
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
            fecha: format(new Date(), 'dd/MM/yyyy'),
            solicitud: solicitudFormateada,
            colaboradores,
            vehiculos,
            contractorName,
            interventorName
        };

        // Generar el HTML
        return template(data);
    } catch (error) {
        console.error("❌ Error al generar el informe HTML:", error);
        throw error;
    }
}

// Controlador para descargar la solicitud
controller.descargarSolicitud = async (req, res) => {
    const { id } = req.params;
    const tempDir = path.join(__dirname, '../temp', `solicitud_${id}`);
    const htmlPath = path.join(tempDir, `Informe_Solicitud_${id}.html`);

    try {
        // Verificar si ya existe una URL en la tabla sst_documentos
        const [existingDoc] = await connection.execute('SELECT * FROM sst_documentos WHERE solicitud_id = ?', [id]);
        if (existingDoc.length > 0) {
            return res.json({
                success: true,
                url: existingDoc[0].url,
                message: 'URL de descarga recuperada correctamente'
            });
        }

        // Crear directorio temporal
        await fs.promises.mkdir(tempDir, { recursive: true });

        // Obtener datos de la solicitud
        const [solicitud] = await connection.execute(`
            SELECT 
                s.*,
                u.empresa,
                u.nit,
                u2.username as interventor_nombre,
                l.nombre_lugar as lugar,
                l.id as lugar_id
            FROM solicitudes s
            JOIN users u ON s.usuario_id = u.id
            LEFT JOIN users u2 ON s.interventor_id = u2.id
            LEFT JOIN lugares l ON s.lugar = l.id
            WHERE s.id = ?
        `, [id]);        if (!solicitud || solicitud.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Solicitud no encontrada'
            });
        }
        

        // Obtener datos necesarios para generar el documento
        const [colaboradores] = await connection.execute(
            'SELECT id, cedula, nombre, foto, cedulaFoto FROM colaboradores WHERE solicitud_id = ? and estado = true',
            [id]
        );

        // Obtener vehículos con todos sus documentos
        const [vehiculos] = await connection.execute(
            'SELECT v.id, v.matricula as placa, v.estado, v.foto, v.tecnomecanica, v.soat, v.licencia_conduccion, v.licencia_transito FROM vehiculos v WHERE v.solicitud_id = ?',
            [id]
        );

        // Obtener nombres del contratista e interventor
        const [contractorInfo] = await connection.execute(
            'SELECT u.username AS contractorName, i.username AS interventorName FROM solicitudes s LEFT JOIN users u ON s.usuario_id = u.id LEFT JOIN users i ON s.interventor_id = i.id WHERE s.id = ?',
            [id]
        );

        // Generar el HTML
        const html = await generateInformeHTML({
            solicitud: solicitud[0],
            colaboradores,
            vehiculos,
            contractorName: contractorInfo[0]?.contractorName || 'No especificado',
            interventorName: contractorInfo[0]?.interventorName || 'No especificado'
        });

        // Guardar el HTML
        await fs.promises.writeFile(htmlPath, html);

        // Crear el archivo ZIP
        const zipFileName = `Solicitud_${solicitud[0].empresa}_${id}.zip`;
        const zipPath = path.join(tempDir, zipFileName);
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', {
            zlib: { level: 9 }
        });

        output.on('close', async () => {
            try {
                // Subir el archivo ZIP a DigitalOcean Spaces
                const fileUrl = await uploadToSpacesFromDisk(zipPath, zipFileName);

                if (fileUrl) {
                    // Guardar la URL en la base de datos
                    await connection.execute(
                        'INSERT INTO sst_documentos (solicitud_id, url) VALUES (?, ?)',
                        [id, fileUrl]
                    );

                    res.json({
                        success: true,
                        url: fileUrl,
                        message: 'Documento generado y subido correctamente'
                    });
                } else {
                    throw new Error('Error al subir el archivo a DigitalOcean Spaces');
                }
            } catch (error) {
                console.error('Error al procesar el archivo:', error);
                res.status(500).json({
                    success: false,
                    error: 'Error al procesar el archivo',
                    details: error.message
                });
            } finally {
                // Limpiar archivos temporales
                try {
                    await fs.promises.rm(tempDir, { recursive: true, force: true });
                } catch (error) {
                    console.error('Error al limpiar archivos temporales:', error);
                }
            }
        });

        archive.on('error', (err) => {
            throw err;
        });

        archive.pipe(output);

        // Agregar el HTML al ZIP
        archive.file(htmlPath, { name: `Informe_Solicitud_${id}.html` });

        // Procesar documentos de la solicitud
        if (solicitud[0].arl_documento) {
            const arlBuffer = await downloadFromSpaces(solicitud[0].arl_documento);
            if (arlBuffer) {
                archive.append(arlBuffer, { name: `ARL_${id}${path.extname(solicitud[0].arl_documento)}` });
            }
        }

        if (solicitud[0].pasocial_documento) {
            const pasocialBuffer = await downloadFromSpaces(solicitud[0].pasocial_documento);
            if (pasocialBuffer) {
                archive.append(pasocialBuffer, { name: `Pasocial_${id}${path.extname(solicitud[0].pasocial_documento)}` });
            }
        }

        // Procesar documentos de vehículos
        for (const vehiculo of vehiculos) {
            const vehiculoDir = `${vehiculo.placa}/`;
            
            if (vehiculo.foto) {
                const fotoBuffer = await downloadFromSpaces(vehiculo.foto);
                if (fotoBuffer) {
                    archive.append(fotoBuffer, { name: `${vehiculoDir}${vehiculo.placa}_foto${path.extname(vehiculo.foto)}` });
                }
            }

            if (vehiculo.tecnomecanica) {
                const tecnomecanicaBuffer = await downloadFromSpaces(vehiculo.tecnomecanica);
                if (tecnomecanicaBuffer) {
                    archive.append(tecnomecanicaBuffer, { name: `${vehiculoDir}${vehiculo.placa}_tecnomecanica${path.extname(vehiculo.tecnomecanica)}` });
                }
            }

            if (vehiculo.soat) {
                const soatBuffer = await downloadFromSpaces(vehiculo.soat);
                if (soatBuffer) {
                    archive.append(soatBuffer, { name: `${vehiculoDir}${vehiculo.placa}_soat${path.extname(vehiculo.soat)}` });
                }
            }

            if (vehiculo.licencia_conduccion) {
                const licenciaConduccionBuffer = await downloadFromSpaces(vehiculo.licencia_conduccion);
                if (licenciaConduccionBuffer) {
                    archive.append(licenciaConduccionBuffer, { name: `${vehiculoDir}${vehiculo.placa}_licencia_conduccion${path.extname(vehiculo.licencia_conduccion)}` });
                }
            }

            if (vehiculo.licencia_transito) {
                const licenciaTransitoBuffer = await downloadFromSpaces(vehiculo.licencia_transito);
                if (licenciaTransitoBuffer) {
                    archive.append(licenciaTransitoBuffer, { name: `${vehiculoDir}${vehiculo.placa}_licencia_transito${path.extname(vehiculo.licencia_transito)}` });
                }
            }
        }

        archive.finalize();

    } catch (error) {
        console.error('Error al generar el archivo ZIP:', error);
        res.status(500).json({
            success: false,
            error: 'Error al generar el archivo ZIP',
            details: error.message
        });
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
    const { estado } = req.query; // Recibir el parámetro estado desde la query
    
    try {
        // Obtener información de la solicitud y el contratista
        const [solicitud] = await connection.execute(
            'SELECT s.id, s.empresa, u.username AS contratista FROM solicitudes s LEFT JOIN users u ON s.usuario_id = u.id WHERE s.id = ?',
            [solicitudId]
        );
        if (!solicitud.length) {
            return res.status(404).json({ message: 'Solicitud no encontrada' });
        }

        // Preparar consulta para colaboradores, aplicando filtro por estado si es necesario
        let colaboradoresQuery = 'SELECT c.id, c.nombre, c.cedula, c.estado FROM colaboradores c WHERE c.solicitud_id = ?';
        let colaboradoresParams = [solicitudId];
        
        // Si se especificó un filtro de estado, añadirlo a la consulta
        if (estado !== undefined) {
            colaboradoresQuery += ' AND c.estado = ?';
            colaboradoresParams.push(estado === 'true' || estado === true);
        }
        
        // Obtener colaboradores con el filtro aplicado
        const [colaboradores] = await connection.execute(colaboradoresQuery, colaboradoresParams);

        // Obtener vehículos con licencias de conducción y tránsito
        const [vehiculos] = await connection.execute(
            `SELECT 
                v.id, 
                v.matricula AS placa, 
                v.estado,
                lv_conduccion.estado AS licencia_conduccion,
                lv_transito.estado AS licencia_transito
            FROM vehiculos v
            LEFT JOIN licencias_vehiculo lv_conduccion 
                ON v.id = lv_conduccion.vehiculo_id AND lv_conduccion.tipo = 'licencia_conduccion'
            LEFT JOIN licencias_vehiculo lv_transito 
                ON v.id = lv_transito.vehiculo_id AND lv_transito.tipo = 'licencia_transito'
            WHERE v.solicitud_id = ?`,
            [solicitudId]
        );

        // Procesar colaboradores con datos adicionales (Curso SISO y Plantilla SS)
        const colaboradoresConDatos = await Promise.all(colaboradores.map(async col => {
            // Curso SISO con fecha_vencimiento
            const [cursoSiso] = await connection.execute(
                `SELECT rc.estado, rc.fecha_vencimiento 
                FROM resultados_capacitaciones rc 
                JOIN capacitaciones cap ON rc.capacitacion_id = cap.id 
                WHERE rc.colaborador_id = ? AND cap.nombre = 'Curso SISO'`,
                [col.id]
            );

            // Determinar estado del curso SISO
            let cursoSisoEstado = 'No'; // Valor por defecto si no hay resultados
            if (cursoSiso.length) {
                if (cursoSiso[0].estado === 'APROBADO') {
                    const fechaVencimiento = new Date(cursoSiso[0].fecha_vencimiento);
                    const hoy = new Date();
                    cursoSisoEstado = fechaVencimiento > hoy ? 'Aprobado' : 'Vencido';
                } else {
                    cursoSisoEstado = 'Perdido';
                }
            }

            // Plantilla SS
            const [plantillaSS] = await connection.execute(
                'SELECT id, fecha_inicio, fecha_fin FROM plantilla_seguridad_social WHERE colaborador_id = ? ORDER BY created_at DESC LIMIT 1',
                [col.id]
            );

            return {
                ...col,
                cursoSiso: cursoSisoEstado,
                plantillaSS: plantillaSS.length ? plantillaSS[0] : null
            };
        }));

        // Procesar vehículos con datos de SOAT y tecnomecánica
        const vehiculosConDatos = await Promise.all(vehiculos.map(async veh => {
            // Obtener SOAT
            const [soat] = await connection.execute(
                'SELECT id, fecha_inicio, fecha_fin, estado FROM plantilla_documentos_vehiculos WHERE vehiculo_id = ? AND tipo_documento = "soat" ORDER BY created_at DESC LIMIT 1',
                [veh.id]
            );

            // Obtener Tecnomecánica
            const [tecnomecanica] = await connection.execute(
                'SELECT id, fecha_inicio, fecha_fin, estado FROM plantilla_documentos_vehiculos WHERE vehiculo_id = ? AND tipo_documento = "tecnomecanica" ORDER BY created_at DESC LIMIT 1',
                [veh.id]
            );

            return {
                ...veh,
                soat: soat.length ? soat[0] : null,
                tecnomecanica: tecnomecanica.length ? tecnomecanica[0] : null,
                licencia_conduccion: veh.licencia_conduccion || false, // Default a false si no existe
                licencia_transito: veh.licencia_transito || false     // Default a false si no existe
            };
        }));

        // Log para depuración
        console.log('Datos enviados al frontend:', {
            solicitudId: solicitud[0].id,
            empresa: solicitud[0].empresa,
            contratista: solicitud[0].contratista,
            estadoFiltro: estado,
            totalColaboradores: colaboradoresConDatos.length,
            totalVehiculos: vehiculosConDatos.length
        });

        // Respuesta al frontend
        res.json({
            id: solicitud[0].id,
            empresa: solicitud[0].empresa,
            contratista: solicitud[0].contratista,
            colaboradores: colaboradoresConDatos,
            vehiculos: vehiculosConDatos
        });
    } catch (error) {
        console.error('Error al obtener colaboradores y vehículos:', error);
        res.status(500).json({ 
            message: 'Error interno del servidor',
            error: error.message 
        });
    }
};


  // Obtener Plantilla SS existente
 
  controller.getPlantillaSS = async (req, res) => {
    const { colaboradorId } = req.params;
    try {
      const [plantilla] = await connection.execute(
        'SELECT id, DATE_FORMAT(fecha_inicio, "%Y-%m-%d") AS fecha_inicio, DATE_FORMAT(fecha_fin, "%Y-%m-%d") AS fecha_fin FROM plantilla_seguridad_social WHERE colaborador_id = ? ORDER BY created_at DESC LIMIT 1',
        [colaboradorId]
      );
      res.json({ plantilla: plantilla.length ? plantilla[0] : null });
    } catch (error) {
      console.error('Error al obtener plantilla:', error);
      res.status(500).json({ message: 'Error interno del servidor' });
    }
  };
  
  // Guardar o Actualizar Plantilla SS
  controller.guardarOActualizarPlantillaSS = async (req, res) => {
    const { colaboradorId, solicitudId, fechaInicio, fechaFin } = req.body;
    try {
      const [existing] = await connection.execute(
        'SELECT id FROM plantilla_seguridad_social WHERE colaborador_id = ? ORDER BY created_at DESC LIMIT 1',
        [colaboradorId]
      );
  
      if (existing.length) {
        // Actualizar
        const [result] = await connection.execute(
          'UPDATE plantilla_seguridad_social SET fecha_inicio = ?, fecha_fin = ?, updated_at = NOW() WHERE id = ?',
          [fechaInicio, fechaFin, existing[0].id]
        );
        if (result.affectedRows) {
          res.json({ message: 'Plantilla actualizada correctamente' });
        } else {
          res.status(500).json({ message: 'Error al actualizar la plantilla' });
        }
      } else {
        // Insertar
        const [result] = await connection.execute(
          'INSERT INTO plantilla_seguridad_social (colaborador_id, solicitud_id, fecha_inicio, fecha_fin) VALUES (?, ?, ?, ?)',
          [colaboradorId, solicitudId, fechaInicio, fechaFin]
        );
        if (result.affectedRows) {
          res.json({ message: 'Plantilla guardada correctamente' });
        } else {
          res.status(500).json({ message: 'Error al guardar la plantilla' });
        }
      }
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
    console.log('Método HTTP:', req.method);
    const token = req.cookies.token;
    if (!token) {
        console.log('❌ No se encontró token en las cookies');
        return res.status(401).json({ message: 'No autorizado' });
    }
  
    try {
        console.log('🔐 Verificando token...');
        const decoded = jwt.verify(token, SECRET_KEY);
        if (decoded.role !== 'sst') {
            console.log('⛔ Usuario no tiene rol SST:', decoded.role);
            return res.status(403).json({ message: 'Acceso denegado' });
        }
        console.log('✅ Token verificado correctamente para rol SST');
  
        // Obtener parámetros según el método HTTP
        let params = {};
        if (req.method === 'GET') {
            params = req.query || {};
        } else if (req.method === 'POST') {
            params = req.body || {};
        }
        
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
        `;
        
        // Agregar join con vehículos cuando se filtra por placa o vehiculoId
        if (placa || vehiculoId) {
            query += `
                LEFT JOIN vehiculos v ON v.solicitud_id = s.id
            `;
        }
        
        query += ` WHERE 1=1`;
        
        const placeholders = [];
  
        // Agregar condiciones de filtrado con logs
        if (id) {
            query += ' AND s.id = ?';
            placeholders.push(id);
            console.log('🔍 Filtrando por ID:', id);
        }
        if (cedula) {
            query += ' AND c.cedula LIKE ?';
            placeholders.push(`%${cedula}%`);
            console.log('🔍 Filtrando por cédula:', cedula);
        }
        if (colaboradorId) {
            query += ' AND c.id = ?';
            placeholders.push(colaboradorId);
            console.log('🔍 Filtrando por ID de colaborador:', colaboradorId);
        }
        if (vehiculoId) {
            query += ' AND v.id = ?';
            placeholders.push(vehiculoId);
            console.log('🔍 Filtrando por ID de vehículo:', vehiculoId);
        }
        if (placa) {
            query += ' AND v.matricula LIKE ?';
            placeholders.push(`%${placa}%`);
            console.log('🔍 Filtrando por placa:', placa);
        }
        if (interventor) {
            query += ' AND us.username LIKE ?';
            placeholders.push(`%${interventor}%`);
            console.log('🔍 Filtrando por interventor:', interventor);
        }
        if (estado) {
            query += ' AND s.estado = ?';
            placeholders.push(estado);
            console.log('🔍 Filtrando por estado:', estado);
        }
        if (fechaInicio) {
            query += ' AND s.inicio_obra >= ?';
            placeholders.push(fechaInicio);
            console.log('🔍 Filtrando por fecha inicio:', fechaInicio);
        }
        if (fechaFin) {
            query += ' AND s.fin_obra <= ?';
            placeholders.push(fechaFin);
            console.log('🔍 Filtrando por fecha fin:', fechaFin);
        }
        if (nit) {
            query += ' AND s.nit LIKE ?';
            placeholders.push(`%${nit}%`);
            console.log('🔍 Filtrando por NIT:', nit);
        }
        if (empresa) {
            query += ' AND s.empresa LIKE ?';
            placeholders.push(`%${empresa}%`);
            console.log('🔍 Filtrando por empresa:', empresa);
        }
        if (lugar) {
            query += ' AND l.nombre_lugar = ?';
            placeholders.push(lugar);
            console.log('🔍 Filtrando por lugar:', lugar);
        }
        if (vigencia) {
            query += ' AND (CASE WHEN DATE(s.fin_obra) < CURDATE() THEN "Vencida" ELSE "Vigente" END) = ?';
            placeholders.push(vigencia);
            console.log('🔍 Filtrando por vigencia:', vigencia);
        }
  
        query += ' GROUP BY s.id ORDER BY s.id DESC';
        console.log('📋 Query final:', query);
        console.log('📋 Placeholders:', placeholders);
  
        const [solicitudes] = await connection.execute(query, placeholders);
        console.log(`✅ Se encontraron ${solicitudes.length} solicitudes`);
      
        // Obtener documentos
        const solicitudesIds = solicitudes.map(s => s.solicitud_id);
        
        if (solicitudesIds.length > 0) {
            console.log('📄 Buscando documentos para las solicitudes:', solicitudes.length);
            const placeholdersDocs = solicitudesIds.map(() => '?').join(',');
            const [documentos] = await connection.execute(
                `SELECT solicitud_id, url FROM sst_documentos WHERE solicitud_id IN (${placeholdersDocs})`,
                solicitudesIds
            );
            console.log(`✅ Se encontraron ${documentos.length} documentos`);
            
            // Agregar URLs de documentos
            solicitudes.forEach(solicitud => {
                const documento = documentos.find(d => d.solicitud_id === solicitud.solicitud_id);
                solicitud.url_documento = documento ? documento.url : null;
            });
        }
        
        console.log('✅ Proceso completado exitosamente');
        res.json(solicitudes);
    } catch (err) {
        console.error('❌ Error al filtrar solicitudes:', err);
        console.error('Stack trace:', err.stack);
        res.status(500).json({ 
            message: 'Error al filtrar solicitudes', 
            error: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
};


// Obtener documento de vehículo
controller.getVehiculoDocumento = async (req, res) => {
    try {
      const { vehiculoId, tipoDocumento } = req.params;
      
      let query = '';
      let params = [];
      
      if (tipoDocumento === 'soat' || tipoDocumento === 'tecnomecanica') {
        query = `
          SELECT 
            id, 
            DATE_FORMAT(fecha_inicio, '%Y-%m-%d') as fecha_inicio,
            DATE_FORMAT(fecha_fin, '%Y-%m-%d') as fecha_fin,
            estado,
            CASE 
              WHEN fecha_fin > CURDATE() THEN 'vigente'
              ELSE 'vencido'
            END as estado_actual
          FROM plantilla_documentos_vehiculos 
          WHERE vehiculo_id = ? AND tipo_documento = ?
          ORDER BY created_at DESC
          LIMIT 1
        `;
        params = [vehiculoId, tipoDocumento];
      } else {
        query = `
          SELECT estado 
          FROM licencias_vehiculo 
          WHERE vehiculo_id = ? AND tipo = ?
        `;
        params = [vehiculoId, tipoDocumento];
      }
  
      const [documento] = await connection.execute(query, params);
      
      if (!documento || documento.length === 0) {
        return res.json({ 
          documento: null,
          message: 'No se encontró el documento'
        });
      }

      // Actualizar el estado si es necesario
      if (tipoDocumento === 'soat' || tipoDocumento === 'tecnomecanica') {
        const doc = documento[0];
        if (new Date(doc.fecha_fin) <= new Date() && doc.estado === 'vigente') {
          await connection.execute(
            `UPDATE plantilla_documentos_vehiculos 
             SET estado = 'vencido' 
             WHERE id = ?`,
            [doc.id]
          );
          doc.estado = 'vencido';
        }
      }
      
      res.json({ 
        documento: documento[0],
        message: 'Documento encontrado correctamente'
      });
    } catch (error) {
      console.error('Error al obtener documento:', error);
      res.status(500).json({ 
        success: false,
        message: 'Error al obtener el documento',
        error: error.message 
      });
    }
  };
  
  // Guardar o actualizar documento de vehículo
  controller.saveVehiculoDocumento = async (req, res) => {
    try {
        const { vehiculoId, solicitudId, tipoDocumento, documentoId, fechaInicio, fechaFin } = req.body;
        if (!['soat', 'tecnomecanica'].includes(tipoDocumento)) {
            return res.status(400).json({ success: false, message: 'Tipo de documento no válido' });
        }
        if (!fechaInicio || !fechaFin) {
            return res.status(400).json({ success: false, message: 'Las fechas de inicio y fin son requeridas' });
        }
        if (new Date(fechaFin) <= new Date(fechaInicio)) {
            return res.status(400).json({ success: false, message: 'La fecha fin debe ser posterior a la fecha inicio' });
        }

        const fechaInicioFormateada = new Date(fechaInicio).toISOString().split('T')[0];
        const fechaFinFormateada = new Date(fechaFin).toISOString().split('T')[0];

        if (documentoId) {
            const [result] = await connection.execute(
                `UPDATE plantilla_documentos_vehiculos 
                 SET fecha_inicio = ?, fecha_fin = ?, estado = CASE WHEN ? > CURDATE() THEN 'vigente' ELSE 'vencido' END,
                 updated_at = NOW() WHERE id = ?`,
                [fechaInicioFormateada, fechaFinFormateada, fechaFinFormateada, documentoId]
            );
            if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Documento no encontrado' });
        } else {
            const [result] = await connection.execute(
                `INSERT INTO plantilla_documentos_vehiculos 
                 (vehiculo_id, solicitud_id, tipo_documento, fecha_inicio, fecha_fin, estado) 
                 VALUES (?, ?, ?, ?, ?, CASE WHEN ? > CURDATE() THEN 'vigente' ELSE 'vencido' END)`,
                [vehiculoId, solicitudId, tipoDocumento, fechaInicioFormateada, fechaFinFormateada, fechaFinFormateada]
            );
            if (result.affectedRows === 0) return res.status(500).json({ success: false, message: 'Error al crear el documento' });
        }

        res.json({ success: true, message: documentoId ? 'Documento actualizado correctamente' : 'Documento creado correctamente' });
    } catch (error) {
        console.error('Error al guardar documento:', error);
        res.status(500).json({ success: false, message: 'Error al guardar el documento', error: error.message });
    }
};
  
  // Alternar estado de licencia
  controller.toggleLicencia = async (req, res) => {
    try {
        const { vehiculoId, solicitudId, tipoLicencia, activar } = req.body;
        
        console.log('Datos recibidos en toggleLicencia:', { vehiculoId, solicitudId, tipoLicencia, activar });
        
        // Validar parámetros requeridos
        if (!vehiculoId || !solicitudId || !tipoLicencia) {
            return res.status(400).json({
                success: false,
                message: 'Faltan parámetros requeridos: vehiculoId, solicitudId y tipoLicencia son obligatorios'
            });
        }
        
        // Validar que activar sea un booleano
        if (typeof activar !== 'boolean') {
            return res.status(400).json({
                success: false,
                message: 'El parámetro activar debe ser un valor booleano'
            });
        }
        
        // Validar que tipoLicencia sea uno de los valores permitidos
        if (!['licencia_conduccion', 'licencia_transito'].includes(tipoLicencia)) {
            return res.status(400).json({
                success: false,
                message: `Tipo de licencia no válido: ${tipoLicencia}. Debe ser 'licencia_conduccion' o 'licencia_transito'`
            });
        }
        
        // Verificar que el vehículo exista
        const [vehiculo] = await connection.execute(
            'SELECT id FROM vehiculos WHERE id = ?',
            [vehiculoId]
        );
        
        if (vehiculo.length === 0) {
            return res.status(404).json({
                success: false,
                message: `No se encontró el vehículo con ID ${vehiculoId}`
            });
        }
        
        // Verificar si ya existe un registro para esta licencia
        const [existing] = await connection.execute(
            `SELECT id FROM licencias_vehiculo WHERE vehiculo_id = ? AND tipo = ?`,
            [vehiculoId, tipoLicencia]
        );

        // Actualizar o insertar el registro
        let result;
        if (existing.length > 0) {
            [result] = await connection.execute(
                `UPDATE licencias_vehiculo SET estado = ?, fecha_actualizacion = NOW() WHERE vehiculo_id = ? AND tipo = ?`,
                [activar, vehiculoId, tipoLicencia]
            );
            console.log('Actualización de licencia completada:', result);
        } else {
            [result] = await connection.execute(
                `INSERT INTO licencias_vehiculo (vehiculo_id, solicitud_id, tipo, estado) VALUES (?, ?, ?, ?)`,
                [vehiculoId, solicitudId, tipoLicencia, activar]
            );
            console.log('Inserción de licencia completada:', result);
        }

        // Determinar el nombre legible del tipo de licencia
        const tipoLegible = tipoLicencia === 'licencia_conduccion' ? 'Licencia de Conducción' : 'Licencia de Tránsito';

        // Responder con éxito
        res.json({
            success: true,
            message: activar 
                ? `${tipoLegible} aprobada correctamente` 
                : `Aprobación de ${tipoLegible} cancelada correctamente`
        });
    } catch (error) {
        console.error('Error al actualizar licencia:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar el estado de la licencia',
            error: error.message
        });
    }
};
  
module.exports = controller;
