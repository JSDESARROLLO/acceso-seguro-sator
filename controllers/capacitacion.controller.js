// controllers/capacitacion.controller.js
const connection = require('../db/db');
const crypto = require('crypto');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const handlebars = require('handlebars');
const { format } = require('date-fns');
const { Upload } = require("@aws-sdk/lib-storage");
const emailService = require('../services/email.service');
const controllers = {};
const ExcelJS = require('exceljs');

// Configuración del cliente S3 para Digital Ocean Spaces
const s3Client = new S3Client({
    forcePathStyle: false,
    endpoint: `https://${process.env.DO_SPACES_ENDPOINT}`,
    region: "us-east-1",
    credentials: {
        accessKeyId: process.env.DO_SPACES_KEY,
        secretAccessKey: process.env.DO_SPACES_SECRET
    }
});

// Función para eliminar archivo de Digital Ocean Spaces
async function deleteFileFromSpaces(url) {
    try {
        // Extraer el nombre del archivo de la URL
        const key = url.split('/').pop();
        
        const deleteCommand = new DeleteObjectCommand({
            Bucket: process.env.DO_SPACES_BUCKET,
            Key: `capacitaciones/${key}`
        });

        await s3Client.send(deleteCommand);
        console.log('Archivo eliminado exitosamente:', key);
    } catch (error) {
        console.error('Error al eliminar archivo:', error);
    }
}
const generarCodigoSeguridad = () => {
    // Generar un código de 4 caracteres alfanuméricos fáciles de leer
    const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluimos caracteres confusos como I, O, 0, 1
    let codigo = '';
    for (let i = 0; i < 4; i++) {
        codigo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
    }
    if (codigo.length !== 4) {
        return generarCodigoSeguridad(); // Regenerar si no tiene 4 caracteres
    }
    return codigo;
};

// Vista del creador de capacitaciones
controllers.vistaCreador = async (req, res) => {
    try {
        // Obtener las capacitaciones existentes para mostrarlas en la vista
        const [capacitaciones] = await connection.query(
            'SELECT c.*, COUNT(rc.id) as intentos, ' +
            '(SELECT COUNT(*) FROM resultados_capacitaciones rc2 WHERE rc2.capacitacion_id = c.id AND rc2.estado = "APROBADO") as aprobados ' +
            'FROM capacitaciones c ' +
            'LEFT JOIN resultados_capacitaciones rc ON c.id = rc.capacitacion_id ' +
            'WHERE c.creador_id = ? ' +
            'GROUP BY c.id',
            [req.user.id]
        );

        res.render('capacitaciones/creador', {
            title: 'Crear Capacitación',
            capacitaciones: capacitaciones,
            user: req.user
        });
    } catch (error) {
        console.error('Error al cargar la vista del creador:', error);
        res.status(500).send('Error al cargar la vista del creador');
    }
};

controllers.crearCapacitacion = async (req, res) => {
    try {
        const { nombre, vigencia_meses, puntos_por_pregunta, puntaje_minimo_aprobacion, puntaje_maximo, preguntas } = req.body;
        const codigo_seguridad = generarCodigoSeguridad();
        
        // Insertar capacitación
        const [result] = await connection.query(
            'INSERT INTO capacitaciones (nombre, preguntas, puntos_por_pregunta, puntaje_maximo, puntaje_minimo_aprobacion, vigencia_meses, creador_id, codigo_seguridad) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [nombre, JSON.stringify(preguntas), puntos_por_pregunta, puntaje_maximo, puntaje_minimo_aprobacion, vigencia_meses, req.user.id, codigo_seguridad]
        );

        // Generar URL única para la capacitación
        const baseUrl = process.env.DOMAIN_URL || 'http://localhost:3500';
        const capacitacionUrl = `${baseUrl}/capacitacion/responder/${codigo_seguridad}`;

        res.status(201).json({ 
            message: 'Capacitación creada exitosamente', 
            id: result.insertId,
            codigo_seguridad,
            url_acceso: capacitacionUrl
        });
    } catch (error) {
        console.error('Error al crear capacitación:', error);
        res.status(500).json({ error: 'Error al crear la capacitación' });
    }
};

controllers.editarCapacitacion = async (req, res) => {
    const { id } = req.params;
    try {
        // Obtener la capacitación actual para comparar
        const [capacitacionActual] = await connection.query(
            'SELECT preguntas FROM capacitaciones WHERE id = ?',
            [id]
        );

        if (capacitacionActual.length === 0) {
            return res.status(404).json({ error: 'Capacitación no encontrada' });
        }

        // Manejar las preguntas actuales de forma segura
        let preguntasActuales = [];
        if (typeof capacitacionActual[0].preguntas === 'string') {
            try {
                preguntasActuales = JSON.parse(capacitacionActual[0].preguntas);
            } catch (error) {
                console.error('Error al parsear preguntas actuales:', error);
                preguntasActuales = [];
            }
        } else if (typeof capacitacionActual[0].preguntas === 'object') {
            preguntasActuales = capacitacionActual[0].preguntas;
        }

        const { nombre, vigencia_meses, puntos_por_pregunta, puntaje_minimo_aprobacion, puntaje_maximo, preguntas } = req.body;

        // Asegurarse de que preguntas sea un array
        const preguntasArray = Array.isArray(preguntas) ? preguntas : [];

        // Encontrar multimedia que ya no está en las preguntas nuevas
        const urlsNuevas = new Set(preguntasArray.map(p => p.multimedia).filter(Boolean));
        const urlsActuales = new Set(preguntasActuales.map(p => p.multimedia).filter(Boolean));

        // Eliminar archivos que ya no están en uso
        for (const url of urlsActuales) {
            if (!urlsNuevas.has(url)) {
                await deleteFileFromSpaces(url);
                console.log('Archivo eliminado:', url);
            }
        }

        // Convertir el array de preguntas a JSON string
        const preguntasJSON = JSON.stringify(preguntasArray);

        await connection.query(
            'UPDATE capacitaciones SET nombre = ?, preguntas = ?, puntos_por_pregunta = ?, puntaje_maximo = ?, puntaje_minimo_aprobacion = ?, vigencia_meses = ? WHERE id = ?',
            [nombre, preguntasJSON, puntos_por_pregunta, puntaje_maximo, puntaje_minimo_aprobacion, vigencia_meses, id]
        );

        res.json({ message: 'Capacitación actualizada exitosamente' });
    } catch (error) {
        console.error('Error al editar capacitación:', error);
        res.status(500).json({ error: 'Error al actualizar la capacitación' });
    }
};

controllers.obtenerCapacitacion = async (req, res) => {
    const { id } = req.params;

    try {
        const [capacitacion] = await connection.query(
            'SELECT * FROM capacitaciones WHERE id = ?',
            [id]
        );

        if (capacitacion.length === 0) {
            return res.status(404).json({ error: 'Capacitación no encontrada' });
        }

        // Si preguntas ya es un objeto, no necesitamos parsearlo
        if (typeof capacitacion[0].preguntas === 'string') {
            try {
                capacitacion[0].preguntas = JSON.parse(capacitacion[0].preguntas);
            } catch (error) {
                console.error('Error al parsear preguntas:', error);
                capacitacion[0].preguntas = [];
            }
        }

        // Asegurarse de que preguntas sea un array
        if (!Array.isArray(capacitacion[0].preguntas)) {
            capacitacion[0].preguntas = [];
        }

        res.json(capacitacion[0]);
    } catch (error) {
        console.error('Error al obtener capacitación:', error);
        res.status(500).json({ error: 'Error al obtener la capacitación' });
    }
};

controllers.listadoCapacitaciones = async (req, res) => {
    try {
        const [capacitaciones] = await connection.query(
            'SELECT c.*, COUNT(rc.id) as intentos, ' +
            '(SELECT COUNT(*) FROM resultados_capacitaciones rc2 WHERE rc2.capacitacion_id = c.id AND rc2.estado = "APROBADO") as aprobados ' +
            'FROM capacitaciones c ' +
            'LEFT JOIN resultados_capacitaciones rc ON c.id = rc.capacitacion_id ' +
            'GROUP BY c.id'
        );

        if (req.xhr || req.headers.accept.indexOf('json') > -1) {
            res.json(capacitaciones);
        } else {
            res.render('capacitaciones/listado', { 
                capacitaciones,
                title: 'Listado de Capacitaciones',
                user: req.user,
                colaborador_id: req.query.colaborador_id || '',
                solicitud_id: req.query.solicitud_id || ''
            });
        }
    } catch (error) {
        console.error('Error al obtener capacitaciones:', error);
        res.status(500).json({ error: 'Error al obtener el listado de capacitaciones' });
    }
};
controllers.responderCapacitacion = async (req, res) => {
    const { codigo_seguridad, respuestas, colaborador_id, solicitud_id, email, aceptaPolitica } = req.body;

    console.log('[CONTROLADOR] Datos recibidos:', { codigo_seguridad, respuestas, colaborador_id, solicitud_id, email, aceptaPolitica });

    if (!colaborador_id || !solicitud_id) {
        console.log('[CONTROLADOR] Faltan IDs requeridos');
        return res.status(400).json({ error: 'Se requiere el ID del colaborador y de la solicitud' });
    }

    if (!aceptaPolitica) {
        console.log('[CONTROLADOR] Políticas no aceptadas');
        return res.status(400).json({ error: 'Debe aceptar la política de tratamiento de datos' });
    }

    try {
        console.log('[CONTROLADOR] Verificando colaborador');
        const [colaborador] = await connection.query(
            'SELECT c.*, s.empresa FROM colaboradores c JOIN solicitudes s ON c.solicitud_id = s.id WHERE c.id = ? AND c.solicitud_id = ?',
            [colaborador_id, solicitud_id]
        );

        if (colaborador.length === 0) {
            console.log('[CONTROLADOR] Colaborador no encontrado');
            return res.status(404).json({ error: 'Colaborador no encontrado o no pertenece a la solicitud indicada' });
        }

        if (email) {
            console.log('[CONTROLADOR] Verificando si el colaborador ya aceptó las políticas');
            const [politicaExistente] = await connection.query(
                'SELECT documento_url FROM politicas_aceptadas_colaboradores WHERE colaborador_id = ? ORDER BY fecha_aceptacion DESC LIMIT 1',
                [colaborador_id]
            );

            let documentoUrl;

            if (politicaExistente.length > 0 && politicaExistente[0].documento_url) {
                console.log('[CONTROLADOR] Colaborador ya tiene documento de aceptación');
                documentoUrl = politicaExistente[0].documento_url;
                
                // Enviar correo con el documento existente
                console.log('[CONTROLADOR] Reenviando correo con documento existente');
                await emailService.sendAcceptanceEmailColaborador(
                    email, 
                    colaborador[0].nombre, 
                    documentoUrl,
                    true // Indicador de que es un reenvío
                );
            } else {
                console.log('[CONTROLADOR] Generando nuevo documento de aceptación para colaborador');
                documentoUrl = await emailService.generateAndUploadAcceptanceDocument(
                    colaborador_id,
                    colaborador[0].nombre,
                    colaborador[0].cedula,
                    email,
                    req.ip,
                    colaborador[0].empresa
                );

                console.log('[CONTROLADOR] Guardando aceptación en politicas_aceptadas_colaboradores');
                await connection.execute(
                    'INSERT INTO politicas_aceptadas_colaboradores (colaborador_id, fecha_aceptacion, ip_aceptacion, documento_url) VALUES (?, NOW(), ?, ?)',
                    [colaborador_id, req.ip || 'No disponible', documentoUrl]
                );

                console.log('[CONTROLADOR] Enviando correo al colaborador');
                await emailService.sendAcceptanceEmailColaborador(
                    email, 
                    colaborador[0].nombre, 
                    documentoUrl,
                    false // Indicador de que es nuevo
                );
            }
        } else {
            console.log('[CONTROLADOR] Guardando aceptación sin correo');
            await connection.execute(
                'INSERT INTO politicas_aceptadas_colaboradores (colaborador_id, fecha_aceptacion, ip_aceptacion, documento_url) VALUES (?, NOW(), ?, ?)',
                [colaborador_id, req.ip || 'No disponible', null]
            );
        }

        console.log('[CONTROLADOR] Verificando resultado existente');
        const [resultadoExistente] = await connection.query(
            'SELECT id FROM resultados_capacitaciones WHERE colaborador_id = ? AND solicitud_id = ? AND estado = "APROBADO" AND fecha_vencimiento > NOW()',
            [colaborador_id, solicitud_id]
        );

        if (resultadoExistente.length > 0) {
            console.log('[CONTROLADOR] Capacitación ya aprobada');
            return res.status(400).json({ error: 'Ya tienes una capacitación aprobada y vigente' });
        }

        console.log('[CONTROLADOR] Obteniendo capacitación');
        const [capacitacion] = await connection.query(
            'SELECT * FROM capacitaciones WHERE codigo_seguridad = ?',
            [codigo_seguridad]
        );

        if (!capacitacion.length) {
            console.log('[CONTROLADOR] Capacitación no encontrada');
            return res.status(404).json({ error: 'Capacitación no encontrada' });
        }

        let preguntas;
        try {
            preguntas = typeof capacitacion[0].preguntas === 'string'
                ? JSON.parse(capacitacion[0].preguntas)
                : capacitacion[0].preguntas;
        } catch (error) {
            console.error('[CONTROLADOR] Error al parsear preguntas:', error);
            return res.status(500).json({ error: 'Error al procesar las preguntas' });
        }

        let puntaje_obtenido = 0;
        console.log('[CONTROLADOR] Calculando puntaje');
        preguntas.forEach((pregunta, index) => {
            if (pregunta.respuesta_correcta === respuestas[index]) {
                puntaje_obtenido += capacitacion[0].puntos_por_pregunta;
            }
        });

        const estado = puntaje_obtenido >= capacitacion[0].puntaje_minimo_aprobacion ? 'APROBADO' : 'PERDIDO';
        const fecha_vencimiento = new Date();
        fecha_vencimiento.setMonth(fecha_vencimiento.getMonth() + capacitacion[0].vigencia_meses);

        console.log('[CONTROLADOR] Guardando resultado');
        await connection.query(
            'INSERT INTO resultados_capacitaciones (capacitacion_id, colaborador_id, solicitud_id, respuestas, puntaje_obtenido, estado, fecha_vencimiento) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [capacitacion[0].id, colaborador_id, solicitud_id, JSON.stringify(respuestas), puntaje_obtenido, estado, fecha_vencimiento]
        );

        res.json({
            message: estado === 'APROBADO' ? '¡Felicitaciones! Has aprobado la capacitación' : 'No has alcanzado el puntaje mínimo',
            estado,
            puntaje_obtenido,
            puntaje_minimo: capacitacion[0].puntaje_minimo_aprobacion,
            fecha_vencimiento: estado === 'APROBADO' ? fecha_vencimiento : null
        });
    } catch (error) {
        console.error('[CONTROLADOR] Error al procesar respuestas:', error);
        res.status(500).json({ error: 'Error al procesar las respuestas' });
    }
};  
  


async function generateAcceptanceDocumentColaborador(colaboradorId, nombre, cedula, email, ip, empresa) {
    try {
        console.log('[CONTROLADOR] Generando documento para colaborador');
        const templateContent = `
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <title>Constancia de Aceptación - Colaborador</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; }
                    .container { max-width: 800px; margin: 0 auto; }
                    .header { text-align: center; margin-bottom: 20px; }
                    .content { border: 1px solid #ddd; padding: 20px; }
                    .footer { text-align: center; margin-top: 20px; font-size: 12px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>Constancia de Aceptación - Colaborador</h1>
                    </div>
                    <div class="content">
                        <p><strong>ID Colaborador:</strong> {{colaboradorId}}</p>
                        <p><strong>Nombre:</strong> {{nombre}}</p>
                        <p><strong>Cédula:</strong> {{cedula}}</p>
                        <p><strong>Email:</strong> {{email}}</p>
                        <p><strong>Empresa:</strong> {{empresa}}</p>
                        <p><strong>Fecha:</strong> {{fecha}}</p>
                        <p><strong>IP:</strong> {{ip}}</p>
                        <p>El colaborador ha aceptado las políticas de tratamiento de datos en ${process.env.DOMAIN_URL}/politica-tratamiento-datos</p>
                    </div>
                    <div class="footer">
                        <p>Documento generado electrónicamente</p>
                    </div>
                </div>
            </body>
            </html>
        `;

        const template = handlebars.compile(templateContent);
        const html = template({
            colaboradorId,
            nombre,
            cedula,
            email: email || 'No proporcionado',
            empresa,
            fecha: format(new Date(), 'dd/MM/yyyy HH:mm:ss'),
            ip
        });

        const buffer = Buffer.from(html, 'utf-8');
        const filename = `aceptaciones/colaboradores/${colaboradorId}_${Date.now()}.html`;

        console.log('[CONTROLADOR] Subiendo documento a Spaces');
        const upload = new Upload({
            client: s3Client,
            params: {
                Bucket: 'gestion-contratistas-os',
                Key: filename,
                Body: buffer,
                ContentType: 'text/html',
                ACL: 'public-read'
            }
        });

        await upload.done();
        const url = `https://gestion-contratistas-os.nyc3.digitaloceanspaces.com/${filename}`;
        console.log('[CONTROLADOR] Documento subido:', url);
        return url;
    } catch (error) {
        console.error('[CONTROLADOR] Error generando documento:', error);
        throw error;
    }
}

controllers.eliminarMultimedia = async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) {
            return res.status(400).json({ error: 'URL no proporcionada' });
        }

        await deleteFileFromSpaces(url);
        res.json({ message: 'Archivo eliminado exitosamente' });
    } catch (error) {
        console.error('Error al eliminar multimedia:', error);
        res.status(500).json({ error: 'Error al eliminar el archivo multimedia' });
    }
};

controllers.eliminarCapacitacion = async (req, res) => {
    const { id } = req.params;

    try {
        // Obtener la capacitación y sus preguntas
        const [capacitacion] = await connection.query(
            'SELECT preguntas FROM capacitaciones WHERE id = ?',
            [id]
        );

        if (capacitacion.length === 0) {
            return res.status(404).json({ error: 'Capacitación no encontrada' });
        }

        // Manejar las preguntas de forma segura
        let preguntas = [];
        if (typeof capacitacion[0].preguntas === 'string') {
            try {
                preguntas = JSON.parse(capacitacion[0].preguntas);
            } catch (error) {
                console.error('Error al parsear preguntas:', error);
                preguntas = [];
            }
        } else if (typeof capacitacion[0].preguntas === 'object') {
            preguntas = capacitacion[0].preguntas;
        }

        // Eliminar archivos multimedia de Digital Ocean
        if (Array.isArray(preguntas)) {
            const archivosMultimedia = preguntas
                .map(p => p.multimedia)
                .filter(Boolean);

            // Eliminar cada archivo multimedia
            for (const url of archivosMultimedia) {
                await deleteFileFromSpaces(url);
            }
        }

        // Eliminar resultados asociados
        await connection.query(
            'DELETE FROM resultados_capacitaciones WHERE capacitacion_id = ?',
            [id]
        );

        // Eliminar la capacitación
        await connection.query(
            'DELETE FROM capacitaciones WHERE id = ?',
            [id]
        );

        res.json({ message: 'Capacitación eliminada exitosamente' });
    } catch (error) {
        console.error('Error al eliminar capacitación:', error);
        res.status(500).json({ error: 'Error al eliminar la capacitación' });
    }
};

// Función para descargar resultados en Excel
controllers.descargarExcel = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Obtener todos los resultados sin filtros
        const [resultados] = await connection.query(
            `SELECT 
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
            ORDER BY rc.created_at DESC`,
            [id]
        );

        // Crear un nuevo libro de Excel
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Resultados Capacitación');

        // Definir las columnas
        worksheet.columns = [
            { header: 'Colaborador', key: 'colaborador', width: 30 },
            { header: 'ID Colaborador', key: 'id_colaborador', width: 15 },
            { header: 'Cédula', key: 'cedula', width: 15 },
            { header: 'ID Solicitud', key: 'solicitud', width: 15 },
            { header: 'Puntaje', key: 'puntaje', width: 10 },
            { header: 'Estado', key: 'estado', width: 15 },
            { header: 'Fecha Intento', key: 'fecha_intento', width: 20 },
            { header: 'Fecha Vencimiento', key: 'fecha_vencimiento', width: 20 }
        ];

        // Agregar los datos
        resultados.forEach(resultado => {
            worksheet.addRow({
                colaborador: resultado.nombre_colaborador,
                id_colaborador: resultado.colaborador_id,
                cedula: resultado.cedula,
                solicitud: resultado.solicitud_id,
                puntaje: resultado.puntaje_obtenido,
                estado: resultado.estado,
                fecha_intento: new Date(resultado.fecha_intento).toLocaleString('es-ES'),
                fecha_vencimiento: new Date(resultado.fecha_vencimiento).toLocaleString('es-ES')
            });
        });

        // Generar el buffer del archivo
        const buffer = await workbook.xlsx.writeBuffer();

        // Establecer los headers para la descarga
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=resultados_capacitacion_${id}.xlsx`);
        res.setHeader('Content-Length', buffer.length);

        // Enviar el buffer
        res.send(buffer);
    } catch (error) {
        console.error('Error al generar Excel:', error);
        res.status(500).send('Error al generar el archivo Excel');
    }
};

module.exports = controllers;