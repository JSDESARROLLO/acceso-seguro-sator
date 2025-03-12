const express = require('express');
const multer = require('multer');
const path = require('path'); 
const router = express.Router();
const { format } = require('date-fns');
const controller = require('../controllers/contratista.controller');
const jwt = require('jsonwebtoken');
const SECRET_KEY = process.env.JWT_SECRET || 'secreto';

const connection = require('../db/db'); // Database connection
require('dotenv').config();  // Cargar variables de entorno desde el archivo .env

// const { createClient } = require('@supabase/supabase-js');

// const supabaseUrl = process.env.SUPABASE_URL;
// const supabaseKey = process.env.SUPABASE_KEY;

const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');

const s3 = new S3Client({
    forcePathStyle: false,
    endpoint: `https://${process.env.DO_SPACES_ENDPOINT}`,
    region: "us-east-1",
    credentials: {
        accessKeyId: process.env.DO_SPACES_KEY,
        secretAccessKey: process.env.DO_SPACES_SECRET
    }
});

// const supabase = createClient(supabaseUrl, supabaseKey);



// Configuración de almacenamiento de Multer en memoria
const storage = multer.memoryStorage();

const upload = multer({
    storage: storage,
    limits: { 
        fileSize: 100 * 1024 * 1024 // Limitar el tamaño de los archivos a 100MB
    }
});

// Función para generar un nombre único para cada archivo
function generateUniqueFilename(originalname) {
    const timestamp = Date.now(); // Usamos la fecha actual como base para generar un nombre único
    const extension = path.extname(originalname); // Obtenemos la extensión original del archivo
    return `${timestamp}${extension}`; // Creamos un nombre único con la extensión original
}

// // Función para subir archivos a SFTP desde el buffer (memoria)
// async function uploadToSFTP(buffer, remotePath) {
//     const sftp = new SFTPClient();
//     try {
//         await sftp.connect({
//             host: process.env.SFTP_HOST,         // Usamos la variable SFTP_HOST
//             port: process.env.SFTP_PORT,         // Usamos la variable SFTP_PORT
//             username: process.env.SFTP_USERNAME, // Usamos la variable SFTP_USERNAME
//             password: process.env.SFTP_PASSWORD  // Usamos la variable SFTP_PASSWORD
//         });

//         // Subir el archivo usando el buffer en memoria
//         await sftp.put(buffer, remotePath);
//         console.log('Archivo subido exitosamente:', remotePath);
//     } catch (err) {
//         console.error('Error al subir archivo:', err);
//     } finally {
//         await sftp.end();
//     }
// }
async function uploadToSpaces(buffer, filename) {

    const uniqueFilename = generateUniqueFilename(filename);
    const upload = new Upload({
        client: s3,
        params: {
            Bucket: process.env.DO_SPACES_BUCKET,
            Key: uniqueFilename,
            Body: buffer,
            ACL: 'public-read'
        }
    });

    try {
        const data = await upload.done();
        console.log('Archivo subido exitosamente a DigitalOcean Spaces:', data.Location);
        return data.Location;
    } catch (err) {
        console.error('Error al subir archivo a DigitalOcean Spaces:', err);
        throw err;
    }
}

// Función para borrar archivo de DigitalOcean Spaces
async function deleteFromSpaces(url) {
    try {
        if (!url) return;
        const key = url.split('/').pop(); // Obtener el nombre del archivo de la URL
        const command = new DeleteObjectCommand({
            Bucket: process.env.DO_SPACES_BUCKET,
            Key: key
        });
        await s3.send(command);
        console.log('Archivo borrado de DigitalOcean:', key);
    } catch (error) {
        console.error('Error al borrar archivo de DigitalOcean:', error);
        throw error;
    }
}

// Función para borrar documentos SST
async function deleteSSTDocuments(solicitudId) {
    try {
        // Obtener los documentos SST actuales
        const [docs] = await connection.execute(
            'SELECT url FROM sst_documentos WHERE solicitud_id = ?',
            [solicitudId]
        );

        // Borrar los archivos de DigitalOcean
        for (const doc of docs) {
            try {
                await deleteFromSpaces(doc.url);
            } catch (error) {
                console.error('Error al borrar archivo SST:', error);
                // Continuar con el siguiente archivo
            }
        }

        // Borrar los registros de la base de datos
        await connection.execute(
            'DELETE FROM sst_documentos WHERE solicitud_id = ?',
            [solicitudId]
        );

        console.log('Documentos SST borrados para la solicitud:', solicitudId);
    } catch (error) {
        console.error('Error al borrar documentos SST:', error);
        throw error;
    }
}
 


router.post('/generar-solicitud', upload.fields([
    { name: 'arl', maxCount: 1 },
    { name: 'pasocial', maxCount: 1 },
    { name: 'foto[]', maxCount: 25 },
    { name: 'cedulaFoto[]', maxCount: 25 }
]), async (err, req, res, next) => {
    if (err) {
        console.error('Error al subir los archivos:', err);
        return res.status(400).json({ error: 'Error al subir los archivos' });
    }
    next();
}, async (req, res) => {
    console.log('Body:', req.body);
    console.log('Files:', req.files);

    const uploadedFiles = req.files;
    const fileNames = {
        foto: [],
        cedulaFoto: [],
        arl: null,
        pasocial: null
    };

    for (const fileKey in uploadedFiles) {
        const files = uploadedFiles[fileKey];
        for (const file of files) {
            const uniqueFilename = generateUniqueFilename(file.originalname);
            const remoteFilePath = await uploadToSpaces(file.buffer, uniqueFilename);

            if (fileKey === 'foto[]') {
                fileNames.foto.push(remoteFilePath);
            } else if (fileKey === 'cedulaFoto[]') {
                fileNames.cedulaFoto.push(remoteFilePath);
            } else if (fileKey === 'arl') {
                fileNames.arl = remoteFilePath;
            } else if (fileKey === 'pasocial') {
                fileNames.pasocial = remoteFilePath;
            }
        }
    }

    const { empresa, nit, lugar, labor, interventor_id, cedula, nombre, inicio_obra, fin_obra, dias_trabajo } = req.body;

    const token = req.cookies.token;
    if (!token) {
        console.log('[CONTROLADOR] No se encontró el token, redirigiendo a login');
        return res.status(401).json({ error: 'No se encontró el token' });
    }

    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        const { id } = decoded;

        if (!id) {
            console.log('[CONTROLADOR] El token no contiene un id válido');
            return res.status(400).json({ error: 'Token inválido' });
        }

        console.log('[CONTROLADOR] Usuario ID:', id);

        const query = `
            INSERT INTO solicitudes (usuario_id, empresa, nit, inicio_obra, fin_obra, dias_trabajo, lugar, labor, interventor_id, arl_documento, pasocial_documento)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        `;
        const [result] = await connection.execute(query, [
            id, empresa, nit, inicio_obra, fin_obra, dias_trabajo, lugar, labor, interventor_id,
            fileNames.arl || null,
            fileNames.pasocial || null
        ]);

        console.log('[CONTROLADOR] Solicitud creada con éxito', result);

        const [resultUser] = await connection.execute('SELECT username FROM users WHERE id = ?', [interventor_id]);
        console.log("VALIDANDO INTERVENTOR AL QUE VA LA SOLICITUD: ", resultUser[0]?.username);

        if (resultUser[0]?.username === "COA") {
            const conn = await connection.getConnection();
            try {
                await conn.beginTransaction();
                const queryAprobar = 'UPDATE solicitudes SET estado = "aprobada" WHERE id = ?';
                await conn.execute(queryAprobar, [result.insertId]);
                const accionQuery = 'INSERT INTO acciones (solicitud_id, usuario_id, accion) VALUES (?, ?, "pendiente")';
                await conn.execute(accionQuery, [result.insertId, id]);
                await conn.commit();
                console.log("Solicitud aprobada automáticamente para COA y acción registrada.");
            } catch (error) {
                await conn.rollback();
                console.error("Error al aprobar automáticamente para COA:", error);
                throw error; // Re-throw to handle in outer catch block
            } finally {
                conn.release();
            }
        }

        for (let i = 0; i < cedula.length; i++) {
            const cedulaColab = cedula[i];
            const nombreColab = nombre[i];
            const fotoColab = fileNames.foto[i] || null;
            const cedulaFotoColab = fileNames.cedulaFoto[i] || null;

            const queryColaborador = `
                INSERT INTO colaboradores (solicitud_id, cedula, nombre, foto, cedulaFoto)
                VALUES (?, ?, ?, ?, ?);
            `;
            await connection.execute(queryColaborador, [
                result.insertId, cedulaColab, nombreColab, fotoColab, cedulaFotoColab
            ]);
        }

        res.status(200).json({ message: 'Solicitud creada correctamente' });
    } catch (error) {
        console.error('[CONTROLADOR] Error al crear la solicitud:', error);
        res.status(500).json({ error: 'Error al crear la solicitud' });
    }
});


router.post('/actualizar-solicitud/:id', upload.any(), async (req, res) => {
    try {
        const solicitudId = req.params.id;
        const uploadedFiles = req.files || {};
        const { cedula, nombre, colaborador_id = [] } = req.body;

        console.log('Archivos recibidos:', uploadedFiles);
        console.log('Datos del formulario:', req.body);

        // Organizamos los archivos por nombre de campo
        const fileMap = {};
        uploadedFiles.forEach(file => {
            fileMap[file.fieldname] = fileMap[file.fieldname] || [];
            fileMap[file.fieldname].push(file);
        });

        // Validamos los campos permitidos
        const validFields = ['arl', 'pasocial', 'foto[]', 'cedulaFoto[]'];
        const collaboratorFields = colaborador_id.map(id => [`foto_${id}`, `cedula_foto_${id}`]).flat();
        const allowedFields = [...validFields, ...collaboratorFields];

        const invalidFields = Object.keys(fileMap).filter(field => !allowedFields.includes(field));
        if (invalidFields.length > 0) {
            return res.status(400).json({
                error: 'Campos de archivo no esperados',
                camposInvalidos: invalidFields,
                camposEsperados: allowedFields
            });
        }

        // Paso 1: Obtener documentos actuales para respaldo
        const [currentSolicitud] = await connection.execute(
            'SELECT arl_documento, pasocial_documento FROM solicitudes WHERE id = ?',
            [solicitudId]
        );
        const oldArl = currentSolicitud[0]?.arl_documento;
        const oldPasocial = currentSolicitud[0]?.pasocial_documento;

        // Paso 2: Borrar documentos SST existentes
        console.log(`Iniciando borrado de documentos SST para solicitud: ${solicitudId}`);
        await deleteSSTDocuments(solicitudId);

        // Paso 3: Procesar nuevos documentos ARL y Pasocial
        for (const field of ['arl', 'pasocial']) {
            if (fileMap[field] && fileMap[field][0]) {
                const file = fileMap[field][0];
                const oldUrl = field === 'arl' ? oldArl : oldPasocial;

                // Borrar el documento viejo específico si existe
                if (oldUrl) {
                    console.log(`Borrando documento viejo ${field}: ${oldUrl}`);
                    await deleteFromSpaces(oldUrl);
                }

                // Subir el nuevo documento
                const filename = generateUniqueFilename(file.originalname); // Usamos tu función existente
                const newUrl = await uploadToSpaces(file.buffer, filename);

                // Actualizar en la base de datos
                await connection.execute(
                    `UPDATE solicitudes SET ${field}_documento = ? WHERE id = ?`,
                    [newUrl, solicitudId]
                );
                console.log(`Nuevo ${field} subido y actualizado: ${newUrl}`);
            }
        }

        // Paso 4: Procesar actualizaciones de colaboradores existentes
        for (const id of colaborador_id) {
            const fotoField = `foto_${id}`;
            const cedulaFotoField = `cedula_foto_${id}`;
            for (const field of [fotoField, cedulaFotoField]) {
                if (fileMap[field] && fileMap[field][0]) {
                    const file = fileMap[field][0];
                    const campo = field.startsWith('foto_') ? 'foto' : 'cedulaFoto';
                    const [rows] = await connection.execute(
                        `SELECT ${campo} FROM colaboradores WHERE id = ?`,
                        [id]
                    );
                    if (rows.length > 0 && rows[0][campo]) {
                        console.log(`Borrando ${campo} viejo del colaborador ${id}: ${rows[0][campo]}`);
                        await deleteFromSpaces(rows[0][campo]);
                    }
                    const filename = generateUniqueFilename(file.originalname); // Usamos tu función existente
                    const url = await uploadToSpaces(file.buffer, filename);
                    await connection.execute(
                        `UPDATE colaboradores SET ${campo} = ? WHERE id = ?`,
                        [url, id]
                    );
                    console.log(`Actualizado ${campo} para colaborador ${id}: ${url}`);
                }
            }
        }

        // Paso 5: Procesar nuevos colaboradores
        if (cedula && nombre) {
            const fotos = fileMap['foto[]'] || [];
            const cedulaFotos = fileMap['cedulaFoto[]'] || [];
            let newColabIndex = 0;

            for (let i = 0; i < cedula.length; i++) {
                const isExisting = colaborador_id.includes(cedula[i].toString()) || (colaborador_id.length > i && colaborador_id[i]);
                if (!isExisting) {
                    const fotoFile = fotos[newColabIndex];
                    const cedulaFotoFile = cedulaFotos[newColabIndex];
                    if (!fotoFile || !cedulaFotoFile) {
                        throw new Error(`Falta archivo para el colaborador con cédula ${cedula[i]}`);
                    }
                    const fotoUrl = await uploadToSpaces(fotoFile.buffer, generateUniqueFilename(fotoFile.originalname));
                    const cedulaFotoUrl = await uploadToSpaces(cedulaFotoFile.buffer, generateUniqueFilename(cedulaFotoFile.originalname));
                    await connection.execute(
                        'INSERT INTO colaboradores (solicitud_id, cedula, nombre, foto, cedulaFoto, estado) VALUES (?, ?, ?, ?, ?, true)',
                        [solicitudId, cedula[i], nombre[i], fotoUrl, cedulaFotoUrl]
                    );
                    console.log(`Nuevo colaborador añadido: ${cedula[i]} - ${fotoUrl}, ${cedulaFotoUrl}`);
                    newColabIndex++;
                }
            }
        }

        res.json({
            success: true,
            message: 'Solicitud actualizada correctamente. Documentos antiguos eliminados y nuevos subidos.'
        });

    } catch (error) {
        console.error('Error al actualizar la solicitud:', error);
        res.status(500).json({ success: false, message: error.message || 'Error al actualizar la solicitud' });
    }
});


// Resto de las rutas
router.get('/vista-contratista', (req, res) => {
    console.log('[RUTA] Se accede a la vista del contratista');
    controller.vistaContratista(req, res);
});

// Nueva ruta para obtener solicitudes actualizadas
router.get('/obtener-solicitudes', async (req, res) => {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({ error: 'No autorizado' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { id } = decoded;

        // Obtener solicitudes del contratista
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

        // Obtener documentos SST
        const [solicitud_url_download] = await connection.execute(
            'SELECT * FROM sst_documentos WHERE solicitud_id IN (SELECT id FROM solicitudes WHERE usuario_id = ?)',
            [id]
        );

        // Formatear fechas
        solicitudes.forEach(solicitud => {
            solicitud.inicio_obra = format(new Date(solicitud.inicio_obra), 'dd/MM/yyyy');
            solicitud.fin_obra = format(new Date(solicitud.fin_obra), 'dd/MM/yyyy');
        });

        res.json({
            solicitudes,
            solicitud_url_download
        });
    } catch (error) {
        console.error('[RUTA] Error al obtener solicitudes:', error);
        res.status(500).json({ error: 'Error al obtener solicitudes' });
    }
});
  

router.get('/obtener-datos-solicitud/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Log para depuración
        console.log('Obteniendo datos de la solicitud:', id);

        // Obtener datos de la solicitud con información del usuario y el interventor
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

        console.log('Datos de solicitud obtenidos:', solicitud[0]);

        if (!solicitud[0]) {
            console.log('No se encontró la solicitud');
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        }

        // Obtener colaboradores asociados a la solicitud con sus fotos
        const [colaboradores] = await connection.execute(`
            SELECT 
                c.id,
                c.cedula,
                c.nombre,
                c.foto,
                c.cedulaFoto,
                c.estado,
                c.solicitud_id
            FROM colaboradores c
            WHERE c.solicitud_id = ? AND c.estado = 1
        `, [id]);

        console.log('Colaboradores obtenidos:', colaboradores);

        // Formatear fechas para el frontend
        const solicitudData = {
            ...solicitud[0],
            inicio_obra: format(new Date(solicitud[0].inicio_obra), 'yyyy-MM-dd'),
            fin_obra: format(new Date(solicitud[0].fin_obra), 'yyyy-MM-dd'),
            arl_documento: solicitud[0].arl_documento || null,
            pasocial_documento: solicitud[0].pasocial_documento || null,
            interventor_id: solicitud[0].interventor_id
        };

        console.log('Datos formateados:', solicitudData);

        res.json({
            solicitud: solicitudData,
            colaboradores: colaboradores.map(col => ({
                ...col,
                estado: Boolean(col.estado)
            }))
        });
    } catch (error) {
        console.error('Error al obtener datos de la solicitud:', error);
        res.status(500).json({ error: 'Error al obtener datos de la solicitud' });
    }
});


// Ruta para desactivar un colaborador
router.post('/desactivar-colaborador/:id', async (req, res) => {
    const colaboradorId = req.params.id;

    try {
        // Obtener la solicitud_id antes de actualizar
        const [colaborador] = await connection.execute(
            'SELECT solicitud_id FROM colaboradores WHERE id = ?',
            [colaboradorId]
        );

        if (colaborador.length === 0) {
            throw new Error('Colaborador no encontrado');
        }

        // Actualizar el estado del colaborador a false
        await connection.execute(
            'UPDATE colaboradores SET estado = FALSE WHERE id = ?',
            [colaboradorId]
        );

        // Registrar el cambio en el historial
        await connection.execute(
            'INSERT INTO historial_estados_colaboradores (colaborador_id, solicitud_id, estado) VALUES (?, ?, FALSE)',
            [colaboradorId, colaborador[0].solicitud_id]
        );

        res.status(200).json({ message: 'Colaborador desactivado correctamente' });
    } catch (error) {
        console.error('Error al desactivar colaborador:', error);
        res.status(500).json({ error: 'Error al desactivar colaborador' });
    }
});

// Ruta para actualizar el estado de un colaborador
router.put('/actualizar-estado-colaborador/:id', async (req, res) => {
    try {
        const colaboradorId = req.params.id;
        const { estado } = req.body;

        // Actualizar el estado del colaborador
        await connection.execute(
            'UPDATE colaboradores SET estado = ? WHERE id = ?',
            [estado, colaboradorId]
        );

        // Registrar el cambio en el historial
        await connection.execute(
            'INSERT INTO historial_estados_colaboradores (colaborador_id, solicitud_id, estado) SELECT ?, solicitud_id, ? FROM colaboradores WHERE id = ?',
            [colaboradorId, estado, colaboradorId]
        );

        res.json({ success: true, message: 'Estado del colaborador actualizado correctamente' });
    } catch (error) {
        console.error('Error al actualizar estado del colaborador:', error);
        res.status(500).json({ success: false, message: 'Error al actualizar el estado del colaborador' });
    }
});

// Ruta para obtener colaboradores inactivos
router.get('/obtener-colaboradores-inactivos/:solicitudId', async (req, res) => {
  try {
    const { solicitudId } = req.params;

    // Obtener colaboradores inactivos de la solicitud
    const [colaboradores] = await connection.execute(`
      SELECT id, cedula, nombre, foto, cedulaFoto
      FROM colaboradores 
      WHERE solicitud_id = ? AND estado = false
    `, [solicitudId]);

    res.json({ success: true, colaboradores });
  } catch (error) {
    console.error('Error al obtener colaboradores inactivos:', error);
    res.status(500).json({ success: false, message: 'Error al obtener colaboradores inactivos' });
  }
});




module.exports = router;