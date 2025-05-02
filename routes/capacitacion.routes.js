const express = require('express');
const router = express.Router();
const capacitacionController = require('../controllers/capacitacion.controller');
const authenticateToken = require('../middleware/authenticateToken');
const checkRole = require('../middlewares/checkRole');
const { generateSurveyToken, verifySurveyToken } = require('../middleware/surveyToken');
const connection = require('../db/db');
const crypto = require('crypto'); 
const multer = require('multer');
const path = require('path');
const { S3Client } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');

// =========== RUTAS PÚBLICAS ===========

// Ruta pública para acceder a la capacitación
router.get('/acceso', (req, res) => {
    res.render('capacitaciones/acceso', {
        title: 'Acceso a Capacitación',
        user: null
    });
});

// Ruta para validar el código de acceso
router.post('/validar-acceso', async (req, res) => {
    try {
        const { codigo, capacitacionId } = req.body;
        let query, params;

        if (capacitacionId) {
            // Si tenemos ID, verificamos que coincida con el código
            query = 'SELECT id, codigo_seguridad FROM capacitaciones WHERE id = ? AND codigo_seguridad = ?';
            params = [capacitacionId, codigo];
        } else {
            // Si no hay ID, buscamos por código de seguridad
            query = 'SELECT id, codigo_seguridad FROM capacitaciones WHERE codigo_seguridad = ?';
            params = [codigo];
        }

        const [capacitacion] = await connection.execute(query, params);

        if (capacitacion.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Código de seguridad inválido' 
            });
        }

        // Generar token temporal
        const token = generateSurveyToken(capacitacion[0].codigo_seguridad);
        
        // Establecer cookie con el token
        res.cookie('survey_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 3600000 // 1 hora
        });

        res.json({ 
            success: true, 
            redirect: `/capacitacion/responder/${capacitacion[0].id}`
        });
    } catch (error) {
        console.error('Error al validar acceso:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error al validar el acceso' 
        });
    }
});

// Ruta pública para responder capacitación (con surveyToken)
router.get('/responder/:id', verifySurveyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { colaborador_id, solicitud_id } = req.query;

        // Verificar que la capacitación existe
        const [capacitacion] = await connection.execute(
            'SELECT * FROM capacitaciones WHERE id = ?',
            [id]
        );

        if (capacitacion.length === 0) {
            return res.status(404).render('error', {
                title: 'Error',
                error: 'Capacitación no encontrada'
            });
        }

        // Verificar que el código de seguridad en el token coincide con el de la capacitación
        if (req.surveyCode !== capacitacion[0].codigo_seguridad) {
            res.clearCookie('survey_token');
            return res.redirect('/capacitacion/acceso?id=' + id);
        }

        // Asegurarse de que las preguntas sean un objeto
        try {
            if (typeof capacitacion[0].preguntas === 'string') {
                capacitacion[0].preguntas = JSON.parse(capacitacion[0].preguntas);
            }
        } catch (error) {
            console.error('Error al parsear preguntas:', error);
            capacitacion[0].preguntas = [];
        }

        if (!Array.isArray(capacitacion[0].preguntas)) {
            capacitacion[0].preguntas = [];
        }

        res.render('capacitaciones/responder', {
            title: 'Responder Capacitación',
            capacitacion: capacitacion[0],
            query: {
                colaborador_id,
                solicitud_id
            }
        });
    } catch (error) {
        console.error('Error al cargar la vista de responder:', error);
        res.status(500).render('error', {
            title: 'Error',
            error: 'Error al cargar la capacitación'
        });
    }
});

// Ruta para enviar respuestas (pública)
router.post('/responder', capacitacionController.responderCapacitacion);

// Ruta para el listado de capacitaciones
router.get('/listado', capacitacionController.listadoCapacitaciones);

// =========== RUTAS PRIVADAS (requieren autenticación) ===========

// Vistas administrativas
router.get('/listado', authenticateToken , capacitacionController.listadoCapacitaciones);
router.get('/creador', authenticateToken,  capacitacionController.vistaCreador);
router.get('/editar/:id', authenticateToken, async (req, res) => {
    try {
        const [capacitacion] = await connection.execute(
            'SELECT * FROM capacitaciones WHERE id = ?',
            [req.params.id]
        );

        if (capacitacion.length === 0) {
            return res.status(404).render('error', {
                title: 'Error',
                error: 'Capacitación no encontrada',
                user: req.user
            });
        }

        res.render('capacitaciones/editar', {
            title: 'Editar Capacitación',
            user: req.user,
            capacitacion: capacitacion[0]
        });
    } catch (error) {
        console.error('Error al cargar la vista de edición:', error);
        res.status(500).render('error', {
            title: 'Error',
            error: 'Error al cargar la capacitación',
            user: req.user
        });
    }
});

// API Routes (privadas)
router.post('/crear', authenticateToken,   capacitacionController.crearCapacitacion);
router.put('/editar/:id', authenticateToken,   capacitacionController.editarCapacitacion);
router.get('/obtener/:id', authenticateToken,   capacitacionController.obtenerCapacitacion);
router.delete('/eliminar/:id', authenticateToken,   capacitacionController.eliminarCapacitacion);
router.post('/eliminar-multimedia', authenticateToken,   capacitacionController.eliminarMultimedia);

// Ruta para verificar estado de capacitaciones
router.get('/verificar/:colaborador_id/:solicitud_id', authenticateToken, async (req, res) => {
    try {
        const { colaborador_id, solicitud_id } = req.params;
        
        const [resultados] = await connection.query(
            'SELECT c.nombre, rc.estado, rc.fecha_vencimiento ' +
            'FROM capacitaciones c ' +
            'LEFT JOIN resultados_capacitaciones rc ON c.id = rc.capacitacion_id ' +
            'AND rc.colaborador_id = ? AND rc.solicitud_id = ? ' +
            'WHERE rc.estado = "APROBADO" AND rc.fecha_vencimiento > NOW()',
            [colaborador_id, solicitud_id]
        );

        res.json({
            success: true,
            capacitaciones: resultados
        });
    } catch (error) {
        console.error('Error al verificar capacitaciones:', error);
        res.status(500).json({ error: 'Error al verificar el estado de las capacitaciones' });
    }
});

// Configuración de subida de archivos
const s3Client = new S3Client({
    forcePathStyle: false,
    endpoint: `https://${process.env.DO_SPACES_ENDPOINT}`,
    region: "us-east-1",
    credentials: {
        accessKeyId: process.env.DO_SPACES_KEY,
        secretAccessKey: process.env.DO_SPACES_SECRET
    }
});

const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 100 * 1024 * 1024 // Límite de 100MB
    }
});

// Ruta para subir archivos (privada)
router.post('/upload', authenticateToken,   upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se ha proporcionado ningún archivo' });
        }

        const uniqueFilename = generateUniqueFilename(req.file.originalname);
        const fileUrl = await uploadToSpaces(req.file.buffer, uniqueFilename);

        res.json({ url: fileUrl });
    } catch (error) {
        console.error('Error al procesar la subida del archivo:', error);
        res.status(500).json({ error: 'Error al subir el archivo' });
    }
});

// Funciones auxiliares
function generarCodigoSeguridad() {
    return crypto.randomBytes(5).toString('hex').toUpperCase();
}

function generateUniqueFilename(originalname) {
    const timestamp = Date.now();
    const extension = path.extname(originalname);
    return `capacitaciones/${timestamp}${extension}`;
}

async function uploadToSpaces(buffer, filename) {
    const upload = new Upload({
        client: s3Client,
        params: {
            Bucket: process.env.DO_SPACES_BUCKET,
            Key: filename,
            Body: buffer,
            ACL: 'public-read'
        }
    });

    try {
        const data = await upload.done();
        return data.Location;
    } catch (err) {
        console.error('Error al subir archivo a DigitalOcean Spaces:', err);
        throw err;
    }
}

router.get('/detalles/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Construir la consulta base
        let query = `
            SELECT 
                c.nombre as nombre_capacitacion,
                col.id as colaborador_id,
                col.nombre as nombre_colaborador,
                col.cedula,
                rc.solicitud_id,
                rc.puntaje_obtenido,
                rc.estado,
                rc.fecha_vencimiento,
                rc.created_at as fecha_intento
            FROM capacitaciones c
            LEFT JOIN resultados_capacitaciones rc ON c.id = rc.capacitacion_id
            LEFT JOIN colaboradores col ON rc.colaborador_id = col.id
            WHERE c.id = ?
            ORDER BY rc.created_at DESC
        `;

        // Obtener detalles de la capacitación y sus participantes
        const [resultados] = await connection.query(query, [id]);

        // Obtener estadísticas generales
        const [estadisticas] = await connection.query(
            `SELECT 
                COUNT(*) as total_intentos,
                SUM(CASE WHEN estado = 'APROBADO' THEN 1 ELSE 0 END) as total_aprobados,
                SUM(CASE WHEN estado = 'PERDIDO' THEN 1 ELSE 0 END) as total_perdidos
            FROM resultados_capacitaciones
            WHERE capacitacion_id = ?`,
            [id]
        );

        res.render('capacitaciones/detalles', {
            title: 'Detalles de Capacitación',
            user: req.user,
            resultados,
            estadisticas: estadisticas[0],
            capacitacion: resultados[0]?.nombre_capacitacion || 'Capacitación no encontrada'
        });
    } catch (error) {
        console.error('Error al obtener detalles:', error);
        res.status(500).render('error', {
            title: 'Error',
            error: 'Error al obtener los detalles de la capacitación',
            user: req.user
        });
    }
});

// Ruta para descargar resultados en Excel
router.get('/descargar-excel/:id', authenticateToken, async (req, res) => {
    try {
        await capacitacionController.descargarExcel(req, res);
    } catch (error) {
        console.error('Error en la ruta de descarga Excel:', error);
        res.status(500).send('Error al generar el archivo Excel');
    }
});

// Ruta para filtrar resultados en tiempo real
router.post('/filtrar/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { cedula, estado, vigencia, colaborador_id } = req.body;
        
        // Construir la consulta base
        let query = `
            SELECT 
                c.nombre as nombre_capacitacion,
                col.id as colaborador_id,
                col.nombre as nombre_colaborador,
                col.cedula,
                rc.solicitud_id,
                rc.puntaje_obtenido,
                rc.estado,
                rc.fecha_vencimiento,
                rc.created_at as fecha_intento
            FROM capacitaciones c
            LEFT JOIN resultados_capacitaciones rc ON c.id = rc.capacitacion_id
            LEFT JOIN colaboradores col ON rc.colaborador_id = col.id
            WHERE c.id = ?
        `;

        const params = [id];

        // Aplicar filtros
        if (cedula) {
            query += ' AND col.cedula LIKE ?';
            params.push(`%${cedula}%`);
        }

        if (estado) {
            query += ' AND rc.estado = ?';
            params.push(estado);
        }

        if (vigencia) {
            if (vigencia === 'vigente') {
                query += ' AND rc.fecha_vencimiento > NOW()';
            } else if (vigencia === 'vencido') {
                query += ' AND rc.fecha_vencimiento <= NOW()';
            }
        }

        if (colaborador_id) {
            query += ' AND col.id LIKE ?';
            params.push(`%${colaborador_id}%`);
        }

        query += ' ORDER BY rc.created_at DESC';

        // Obtener resultados filtrados
        const [resultados] = await connection.query(query, params);

        // Obtener estadísticas de los resultados filtrados
        const [estadisticas] = await connection.query(
            `SELECT 
                COUNT(*) as total_intentos,
                SUM(CASE WHEN rc.estado = 'APROBADO' THEN 1 ELSE 0 END) as total_aprobados,
                SUM(CASE WHEN rc.estado = 'PERDIDO' THEN 1 ELSE 0 END) as total_perdidos
            FROM resultados_capacitaciones rc
            LEFT JOIN colaboradores col ON rc.colaborador_id = col.id
            WHERE rc.capacitacion_id = ?
            ${cedula ? ' AND col.cedula LIKE ?' : ''}
            ${estado ? ' AND rc.estado = ?' : ''}
            ${vigencia === 'vigente' ? ' AND rc.fecha_vencimiento > NOW()' : ''}
            ${vigencia === 'vencido' ? ' AND rc.fecha_vencimiento <= NOW()' : ''}
            ${colaborador_id ? ' AND col.id LIKE ?' : ''}`,
            [id, ...params.slice(1)]
        );

        // Asegurarse de que las estadísticas tengan valores por defecto
        const estadisticasFormateadas = {
            total_intentos: estadisticas[0]?.total_intentos || 0,
            total_aprobados: estadisticas[0]?.total_aprobados || 0,
            total_perdidos: estadisticas[0]?.total_perdidos || 0
        };

        res.json({
            resultados: resultados || [],
            estadisticas: estadisticasFormateadas
        });
    } catch (error) {
        console.error('Error al filtrar resultados:', error);
        res.status(500).json({ 
            error: 'Error al filtrar los resultados',
            resultados: [],
            estadisticas: {
                total_intentos: 0,
                total_aprobados: 0,
                total_perdidos: 0
            }
        });
    }
});

module.exports = router;