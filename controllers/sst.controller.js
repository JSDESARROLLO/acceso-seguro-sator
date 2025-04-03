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
    try {
        console.log('🔄 Iniciando subida de archivo:', { filePath, originalName, folder });
        
        const uuid = uuidv4();
        const extension = path.extname(originalName);
        const filename = `${uuid}${extension}`;
        const spacesPath = `${folder}/${filename}`;
        
        // Leer el archivo usando fs.promises
        const fileContent = await fs.promises.readFile(filePath);
        console.log('📄 Archivo leído correctamente:', { size: fileContent.length });
        
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
                console.log('📤 Subiendo archivo a Spaces:', { attempt: attempt + 1, spacesPath });
                await s3Client.send(command);
                
                // Construir la URL completa de DigitalOcean Spaces
                const spacesUrl = `https://${process.env.DO_SPACES_BUCKET}.${process.env.DO_SPACES_ENDPOINT}/${spacesPath}`;
                
                console.log('✅ Archivo subido exitosamente:', { spacesUrl });
                return spacesUrl;
            } catch (error) {
                attempt++;
                console.error(`❌ Error al subir archivo (intento ${attempt}/${retries}):`, error);
                if (attempt === retries) {
                    throw new Error(`Fallo al subir archivo tras ${retries} intentos: ${error.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Espera exponencial
            }
        }
    } catch (error) {
        console.error('❌ Error en uploadToSpacesFromDisk:', error);
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
            const zipFilename = `documentos_solicitud_${solicitudId}_${Date.now()}.zip`;
            const zipPath = path.join(tempDir, zipFilename);
            const output = fs.createWriteStream(zipPath);
            const archive = archiver('zip', {
                zlib: { level: 9 }
            });

            // Manejar eventos del archivo ZIP
            output.on('close', () => {
                console.log('ZIP creado exitosamente:', archive.pointer() + ' bytes totales');
                res.download(zipPath, zipFilename, (err) => {
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
                (SELECT rc.estado 
                 FROM resultados_capacitaciones rc 
                 WHERE rc.colaborador_id = c.id 
                 ORDER BY rc.fecha_vencimiento DESC LIMIT 1) as cursoSiso
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
                cursoSiso: col.cursoSiso === 1 ? 'Aprobado' : col.cursoSiso === 0 ? 'Vencido' : 'No definido'
            };
        });

        // Obtener vehículos
        console.log('Consultando vehículos...');
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
        console.log(`Encontrados ${vehiculos.length} vehículos`);

        // Procesar vehículos
        console.log('Procesando datos adicionales de vehículos...');
        const vehiculosConDatos = await Promise.all(vehiculos.map(async veh => {
            try {
                const [soat] = await connection.execute(
                    'SELECT id, fecha_inicio, fecha_fin, estado FROM plantilla_documentos_vehiculos WHERE vehiculo_id = ? AND tipo_documento = "soat" ORDER BY created_at DESC LIMIT 1',
                    [veh.id]
                );

                const [tecnomecanica] = await connection.execute(
                    'SELECT id, fecha_inicio, fecha_fin, estado FROM plantilla_documentos_vehiculos WHERE vehiculo_id = ? AND tipo_documento = "tecnomecanica" ORDER BY created_at DESC LIMIT 1',
                    [veh.id]
                );

                return {
                    ...veh,
                    soat: soat.length ? soat[0] : null,
                    tecnomecanica: tecnomecanica.length ? tecnomecanica[0] : null,
                    licencia_conduccion: veh.licencia_conduccion || false,
                    licencia_transito: veh.licencia_transito || false
                };
            } catch (error) {
                console.error(`Error procesando vehículo ${veh.id}:`, error);
                return {
                    ...veh,
                    soat: null,
                    tecnomecanica: null,
                    licencia_conduccion: false,
                    licencia_transito: false,
                    error: 'Error procesando datos adicionales'
                };
            }
        }));

        console.log('Preparando respuesta final...');
        const respuesta = {
            id: solicitud[0].id,
            empresa: solicitud[0].empresa,
            contratista: solicitud[0].contratista,
            colaboradores: colaboradoresProcesados,
            vehiculos: vehiculosConDatos
        };

        console.log('Enviando respuesta exitosa');
        res.json(respuesta);

    } catch (error) {
        console.error('Error en getColaboradores:', error);
        console.error('Stack trace:', error.stack);
        res.status(500).json({ 
            message: 'Error interno del servidor al obtener colaboradores y vehículos',
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
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
            WHERE 1=1
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
  
// Generar y subir documentos de una solicitud
controller.generarDocumentos = async (req, res) => {
    const { id } = req.params;
    console.log('🔄 Iniciando generación de documentos para solicitud:', id);

    try {
        // Validar que la solicitud existe
        const [solicitudExiste] = await connection.execute(
            'SELECT COUNT(*) as count FROM solicitudes WHERE id = ?',
            [id]
        );

        if (!solicitudExiste[0].count) {
            console.error('❌ Solicitud no encontrada:', id);
            return res.status(404).json({
                success: false,
                message: `No se encontró la solicitud con ID ${id}`
            });
        }

        // 1. Crear directorio temporal principal
        const tempDir = path.join(__dirname, '..', 'temp', `solicitud_${id}_${Date.now()}`);
        try {
            await fs.promises.mkdir(tempDir, { recursive: true });
            console.log('📁 Directorio temporal creado:', tempDir);
        } catch (mkdirError) {
            console.error('❌ Error al crear directorio temporal:', mkdirError);
            throw new Error('Error al crear directorio temporal: ' + mkdirError.message);
        }

        // 2. Obtener datos de la solicitud
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

        if (!solicitud || solicitud.length === 0) {
            throw new Error(`No se encontraron datos para la solicitud ${id}`);
        }

        // 3. Obtener colaboradores y vehículos
        const [colaboradores] = await connection.execute(
            'SELECT id, cedula, nombre, estado FROM colaboradores WHERE solicitud_id = ?',
            [id]
        );

        const [vehiculos] = await connection.execute(
            'SELECT id, matricula as placa, estado, foto FROM vehiculos WHERE solicitud_id = ?',
            [id]
        );

        console.log(`📊 Datos obtenidos: ${colaboradores.length} colaboradores, ${vehiculos.length} vehículos`);

        // 4. Generar documentos generales
        // 4.1 Generar HTML del informe
        const html = await generateInformeHTML({
            solicitud: solicitud[0],
            colaboradores,
            vehiculos,
            contractorName: solicitud[0].empresa,
            interventorName: solicitud[0].interventor_nombre
        });
        
        // 4.2 Guardar HTML
        const htmlPath = path.join(tempDir, `Informe_Solicitud_${id}.html`);
        await fs.promises.writeFile(htmlPath, html);
        console.log('💾 HTML guardado en:', htmlPath);

        // 4.3 Generar ARL y Pasocial (simulados por ahora)
        const arlPath = path.join(tempDir, `ARL_${id}.docx`);
        const pasocialPath = path.join(tempDir, `Pasocial_${id}.pdf`);
        await fs.promises.writeFile(arlPath, 'Contenido ARL');
        await fs.promises.writeFile(pasocialPath, 'Contenido Pasocial');

        // 5. Procesar cada vehículo
        for (const vehiculo of vehiculos) {
            const vehiculoDir = path.join(tempDir, vehiculo.placa);
            await fs.promises.mkdir(vehiculoDir, { recursive: true });
            console.log(`📁 Creando directorio para vehículo ${vehiculo.placa}`);

            // 5.1 Guardar foto del vehículo
            if (vehiculo.foto) {
                const fotoBuffer = await downloadFromSpaces(vehiculo.foto);
                if (fotoBuffer) {
                    await fs.promises.writeFile(
                        path.join(vehiculoDir, `${vehiculo.placa}_foto.jpg`),
                        fotoBuffer
                    );
                }
            }

            // 5.2 Obtener y guardar documentos del vehículo
            const documentos = [
                { tipo: 'soat', columna: 'soat' },
                { tipo: 'tecnomecanica', columna: 'tecnomecanica' },
                { tipo: 'licencia_conduccion', columna: 'licencia_conduccion' },
                { tipo: 'licencia_transito', columna: 'licencia_transito' }
            ];

            for (const doc of documentos) {
                // Obtener la URL directamente de la tabla vehículos
                const [docData] = await connection.execute(
                    `SELECT ${doc.columna} as url FROM vehiculos WHERE id = ?`,
                    [vehiculo.id]
                );

                if (docData && docData[0] && docData[0].url) {
                    const docBuffer = await downloadFromSpaces(docData[0].url);
                    if (docBuffer) {
                        await fs.promises.writeFile(
                            path.join(vehiculoDir, `${vehiculo.placa}_${doc.tipo}.pdf`),
                            docBuffer
                        );
                    }
                }
            }
        }

        // 6. Crear ZIP
        const zipFileName = `documentos_solicitud_${id}_${Date.now()}.zip`;
        const zipPath = path.join(tempDir, zipFileName);
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        return new Promise((resolve, reject) => {
            output.on('close', async () => {
                try {
                    console.log('📦 ZIP creado:', archive.pointer() + ' bytes');
                    
                    // 7. Subir ZIP a DigitalOcean Spaces
                    const fileUrl = await uploadToSpacesFromDisk(zipPath, zipFileName);
                    console.log('☁️ Archivo subido a DigitalOcean:', fileUrl);

                    if (!fileUrl) {
                        throw new Error('Error al subir el archivo a DigitalOcean');
                    }

                    // 8. Guardar URL en la base de datos
                    await connection.execute(
                        'INSERT INTO sst_documentos (solicitud_id, url) VALUES (?, ?)',
                        [id, fileUrl]
                    );

                    // 9. Enviar respuesta exitosa
                    resolve(res.json({
                        success: true,
                        url: fileUrl,
                        message: 'Documentos generados y subidos correctamente'
                    }));
                } catch (error) {
                    console.error('❌ Error en el proceso de subida:', error);
                    reject(error);
                } finally {
                    // 10. Limpiar archivos temporales
                    try {
                        await fs.promises.rm(tempDir, { recursive: true, force: true });
                        console.log('🧹 Archivos temporales eliminados');
                    } catch (cleanupError) {
                        console.error('⚠️ Error al limpiar archivos temporales:', cleanupError);
                    }
                }
            });

            archive.on('error', (err) => {
                console.error('❌ Error al crear ZIP:', err);
                reject(new Error('Error al crear el archivo ZIP: ' + err.message));
            });

            // 11. Agregar todos los archivos al ZIP
            archive.pipe(output);
            
            // Agregar archivos principales
            archive.file(htmlPath, { name: path.basename(htmlPath) });
            archive.file(arlPath, { name: path.basename(arlPath) });
            archive.file(pasocialPath, { name: path.basename(pasocialPath) });

            // Agregar carpetas de vehículos
            archive.directory(tempDir, false, (data) => {
                // Solo incluir archivos que no sean los principales
                if (!data.name.includes('Informe_Solicitud_') && 
                    !data.name.includes('ARL_') && 
                    !data.name.includes('Pasocial_') &&
                    !data.name.endsWith('.zip')) {
                    return data;
                }
                return false;
            });

            archive.finalize();
        }).catch(error => {
            console.error('❌ Error general:', error);
            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    message: 'Error al generar los documentos',
                    error: error.message
                });
            }
        });

    } catch (error) {
        console.error('❌ Error general:', error);
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                message: 'Error al generar los documentos',
                error: error.message
            });
        }
    }
};

module.exports = controller;
