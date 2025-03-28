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
  const token = req.cookies.token;

  if (!token) {
      return res.redirect('/login');
  }

  try {
      const decoded = jwt.verify(token, SECRET_KEY);
      const { role } = decoded;

      if (role !== 'sst') {
          return res.redirect('/login');
      }

      // Obtener las solicitudes
      const [solicitud] = await connection.execute(`
          SELECT s.*, us.username AS interventor 
          FROM solicitudes s 
          LEFT JOIN users us ON us.id = s.interventor_id 
          WHERE us.username != "COA"  
          ORDER BY id DESC
      `);

      // Obtener las URLs de los documentos (si existen)
      const [solicitud_url_download] = await connection.execute('SELECT * FROM sst_documentos WHERE solicitud_id IN (SELECT id FROM solicitudes)');
      const [lugares] = await connection.execute('SELECT nombre_lugar FROM lugares ORDER BY nombre_lugar ASC'); // Cargar lugares

      // Formatear fechas
      solicitud.forEach(solici => {
          solici.inicio_obra = format(new Date(solici.inicio_obra), 'dd/MM/yyyy');
          solici.fin_obra = format(new Date(solici.fin_obra), 'dd/MM/yyyy');
      });

      // Pasar las URLs a la vista
      res.render('sst', {
          solicitud: solicitud,
          title: 'SST - Grupo Argos',
          solicitud_url_download: solicitud_url_download,
          lugares: lugares
      });

  } catch (err) {
      console.error('Error al verificar el token o al obtener solicitudes:', err);
      res.redirect('/login');
  }
};

// Función para subir un archivo a DigitalOcean Spaces
async function uploadToSpaces(filePath, fileName) {
    const fileContent = fs.readFileSync(filePath);

    const command = new PutObjectCommand({
        Bucket: 'gestion-contratistas-os',
        Key: fileName,
        Body: fileContent,
        ACL: 'public-read'
    });

    try {
        const response = await s3Client.send(command);
        const fileUrl = `https://gestion-contratistas-os.nyc3.digitaloceanspaces.com/${fileName}`;
        console.log("Resultado de la subida del zip: ", { response, fileUrl });
        return fileUrl;
    } catch (error) {
        console.error('Error al subir el archivo a DigitalOcean Spaces:', error);
        return null;
    }
}


// Función para mostrar la pantalla de negar solicitud
controller.mostrarNegarSolicitud = async (req, res) => {
  try {
    const solicitudId = req.params.id;
    console.log("[RUTAS] Mostrando detalles para negar solicitud con ID:", solicitudId);
    
    // Obtener detalles de la solicitud
    const [solicitudRows] = await connection.execute(`
      SELECT s.*, u.nombre AS nombre_usuario, e.nombre AS nombre_empresa 
      FROM solicitudes s
      JOIN users u ON s.usuario_id = u.id
      JOIN empresas e ON s.empresa_id = e.id
      WHERE s.id = ?
    `, [solicitudId]);
    
    if (solicitudRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Solicitud no encontrada'
      });
    }
    
    // Devolver los datos en formato JSON para que el modal los use
    res.json({
      success: true,
      solicitud: solicitudRows[0]
    });
  } catch (error) {
    console.error('Error al obtener detalles de la solicitud:', error);
    res.status(500).json({
      success: false,
      message: 'Error al cargar los detalles de la solicitud'
    });
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

        // Actualizar el estado de la solicitud a "negada"
        await connection.execute('UPDATE solicitudes SET estado = "negada" WHERE id = ?', [id]);

        // Registrar la acción con el comentario
        await connection.execute(
            'INSERT INTO acciones (solicitud_id, usuario_id, accion, comentario) VALUES (?, ?, "negada", ?)',
            [id, usuarioId, comentario]
        );

        // Responder con éxito
        res.json({
            success: true,
            message: 'Solicitud negada correctamente'
        });
    } catch (error) {
        console.error('Error al negar la solicitud:', error);
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

async function downloadFromSpaces(fileUrl, localPath) {
    if (!fileUrl) {
        console.warn('URL vacía o inválida en downloadFromSpaces');
        return false;
    }

    const fileName = fileUrl.split('/').pop();
    if (!fileName) {
        console.warn('No se pudo extraer el nombre del archivo de la URL:', fileUrl);
        return false;
    }

    console.log(`Intentando descargar archivo desde Spaces: ${fileName}`);

    const command = new GetObjectCommand({
        Bucket: 'gestion-contratistas-os',
        Key: fileName,
    });

    try {
        const response = await s3Client.send(command);
        const chunks = [];
        for await (const chunk of response.Body) {
            chunks.push(chunk);
        }
        fs.writeFileSync(localPath, Buffer.concat(chunks));
        console.log(`Archivo descargado exitosamente: ${localPath}`);
        return true;
    } catch (error) {
        console.error(`Error al descargar el archivo ${fileName} desde ${fileUrl}:`, error.message);
        if (error.code === 'NoSuchKey') {
            console.error(`El archivo ${fileName} no existe en el bucket gestion-contratistas-os`);
        }
        return false;
    }
}


// Función para generar el HTML
async function generateInformeHTML({ solicitud, colaboradores, contractorName, interventorName }) {
    try {
        // Convertir las imágenes de los colaboradores a Base64
        for (const colaborador of colaboradores) {
            colaborador.fotoBase64 = colaborador.foto ? await convertWebPtoJpeg(colaborador.foto) : null;
            colaborador.cedulaFotoBase64 = colaborador.cedulaFoto ? await convertWebPtoJpeg(colaborador.cedulaFoto) : null;
            // Generar QR para el ID del colaborador
            
            const qrData = `${process.env.BASE_URL}/vista-seguridad/${colaborador.id}`;

            colaborador.qrBase64 = await QRCode.toDataURL(qrData, { width: 100, margin: 1 }); // Generar QR en Base64
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
        return template(data);
    } catch (error) {
        console.error("❌ Error al generar el informe HTML:", error);
        throw error;
    }
}

// Controlador para descargar la solicitud (sin cambios relevantes aquí, solo se asegura que los datos incluyan el ID)
controller.descargarSolicitud = async (req, res) => {
    const { id } = req.params;
    const tempDir = path.join('/tmp', `solicitud_${id}`);
    const htmlPath = path.join(tempDir, `Informe_Solicitud_${id}.html`);
    const zipPath = path.join(tempDir, `Solicitud_${id}.zip`);

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

        fs.mkdirSync(tempDir, { recursive: true });

        const [solicitud] = await connection.execute('SELECT * FROM solicitudes WHERE id = ?', [id]);
        if (!solicitud || solicitud.length === 0) {
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
        const [contratista] = await connection.execute('SELECT username FROM users WHERE id = ?', [solicitud[0].usuario_id]);
        const [interventor] = await connection.execute('SELECT username FROM users WHERE id = ?', [solicitud[0].interventor_id]);

        solicitud.forEach(solici => {
            solici.inicio_obra = format(new Date(solici.inicio_obra), 'dd/MM/yyyy');
            solici.fin_obra = format(new Date(solici.fin_obra), 'dd/MM/yyyy');
        });

        const htmlContent = await generateInformeHTML({
            solicitud: solicitud[0],
            colaboradores,
            contractorName: contratista[0].username,
            interventorName: interventor[0].username,
        });

        fs.writeFileSync(htmlPath, htmlContent);

        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', async () => {
            const zipFileName = `sst-documents/Solicitud_${id}.zip`;
            const zipUrl = await uploadToSpaces(zipPath, zipFileName);
            if (zipUrl) {
                await connection.execute(
                    'INSERT INTO sst_documentos (solicitud_id, url) VALUES (?, ?)',
                    [id, zipUrl]
                );
                res.json({
                    success: true,
                    url: zipUrl,
                    message: 'Documento generado y subido correctamente'
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: 'Error al subir el archivo ZIP'
                });
            }
            fs.rmSync(tempDir, { recursive: true, force: true });
        });

        archive.on('error', (err) => {
            throw err;
        });

        archive.pipe(output);
        archive.file(htmlPath, { name: `Informe_Solicitud_${id}.html` });

        if (solicitud[0].arl_documento) {
            const arlPath = path.join(tempDir, `ARL_${id}${path.extname(solicitud[0].arl_documento)}`);
            await downloadFromSpaces(solicitud[0].arl_documento, arlPath);
            archive.file(arlPath, { name: `ARL_${id}${path.extname(solicitud[0].arl_documento)}` });
        }

        if (solicitud[0].pasocial_documento) {
            const pasocialPath = path.join(tempDir, `Pago_Seguridad_Social_${id}${path.extname(solicitud[0].pasocial_documento)}`);
            await downloadFromSpaces(solicitud[0].pasocial_documento, pasocialPath);
            archive.file(pasocialPath, { name: `Pago_Seguridad_Social_${id}${path.extname(solicitud[0].pasocial_documento)}` });
        }

        archive.finalize();

    } catch (error) {
        console.error('[RUTA] Error al generar el archivo ZIP:', error);
        res.status(500).json({
            success: false,
            error: 'Error al generar el archivo ZIP',
            details: error.message
        });
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
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
    try {
      const [solicitud] = await connection.execute(
        'SELECT s.id, s.empresa, u.username AS contratista FROM solicitudes s LEFT JOIN users u ON s.usuario_id = u.id WHERE s.id = ?',
        [solicitudId]
      );
      if (!solicitud.length) return res.status(404).json({ message: 'Solicitud no encontrada' });
  
      const [colaboradores] = await connection.execute(
        'SELECT c.id, c.nombre, c.cedula, c.estado FROM colaboradores c WHERE c.solicitud_id = ?',
        [solicitudId]
      );
  
      const colaboradoresConDatos = await Promise.all(colaboradores.map(async col => {
        // Curso SISO con fecha_vencimiento
        const [cursoSiso] = await connection.execute(
          `SELECT rc.estado, rc.fecha_vencimiento 
           FROM resultados_capacitaciones rc 
           JOIN capacitaciones cap ON rc.capacitacion_id = cap.id 
           WHERE rc.colaborador_id = ? AND cap.nombre = 'Curso SISO' 
           ORDER BY rc.created_at DESC LIMIT 1`,
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
          cursoSiso: cursoSisoEstado, // Siempre será un string: "No", "Aprobado", "Perdido" o "Vencido"
          plantillaSS: plantillaSS.length ? plantillaSS[0] : null
        };
      }));
  
      res.json({
        id: solicitud[0].id,
        empresa: solicitud[0].empresa,
        contratista: solicitud[0].contratista,
        colaboradores: colaboradoresConDatos
      });
    } catch (error) {
      console.error('Error al obtener colaboradores:', error);
      res.status(500).json({ message: 'Error interno del servidor' });
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
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ message: 'No autorizado' });
  
    try {
      const decoded = jwt.verify(token, SECRET_KEY);
      if (decoded.role !== 'sst') return res.status(403).json({ message: 'Acceso denegado' });
  
      const { id, cedula, interventor, estado, fechaInicio, fechaFin, nit, empresa, lugar, vigencia, idColaborador } = req.body;
  
      let query = `
        SELECT DISTINCT
          s.id AS solicitud_id,
          s.empresa,
          s.nit,
          DATE_FORMAT(s.inicio_obra, '%d/%m/%Y') AS inicio_obra,
          DATE_FORMAT(s.fin_obra, '%d/%m/%Y') AS fin_obra,
          s.dias_trabajo,
          s.lugar,
          s.labor,
          us.username AS interventor,
          s.estado AS solicitud_estado,
          CASE
            WHEN DATE(s.fin_obra) < CURDATE() THEN 'Vencida'
            ELSE 'Vigente'
          END AS estado_vigencia,
          sd.url AS url_documento
        FROM solicitudes s
        LEFT JOIN users us ON us.id = s.interventor_id
        LEFT JOIN colaboradores c ON c.solicitud_id = s.id
        LEFT JOIN sst_documentos sd ON sd.solicitud_id = s.id
        WHERE 1=1
      `;
      const params = [];
  
      if (id) {
        query += ' AND s.id = ?';
        params.push(id);
      }
      if (idColaborador) {
        query += ' AND c.id = ?';
        params.push(idColaborador);
      }
      if (cedula) {
        query += ' AND c.cedula LIKE ?';
        params.push(`%${cedula}%`);
      }
      if (interventor) {
        query += ' AND us.username LIKE ?';
        params.push(`%${interventor}%`);
      }
      if (estado) {
        query += ' AND s.estado = ?';
        params.push(estado);
      }
      if (fechaInicio) {
        query += ' AND s.inicio_obra >= ?';
        params.push(fechaInicio);
      }
      if (fechaFin) {
        query += ' AND s.fin_obra <= ?';
        params.push(fechaFin);
      }
      if (nit) {
        query += ' AND s.nit LIKE ?';
        params.push(`%${nit}%`);
      }
      if (empresa) {
        query += ' AND s.empresa LIKE ?';
        params.push(`%${empresa}%`);
      }
      if (lugar) {
        query += ' AND s.lugar = ?';
        params.push(lugar);
      }
      if (vigencia) {
        query += ' AND (CASE WHEN DATE(s.fin_obra) < CURDATE() THEN "Vencida" ELSE "Vigente" END) = ?';
        params.push(vigencia);
      }
  
      query += ' ORDER BY s.id DESC';
  
      const [solicitudes] = await connection.execute(query, params);
      res.json(solicitudes);
    } catch (err) {
      console.error('Error al filtrar solicitudes:', err);
      res.status(500).json({ message: 'Error al filtrar solicitudes', error: err.message });
    }
  };
  
  
module.exports = controller;
