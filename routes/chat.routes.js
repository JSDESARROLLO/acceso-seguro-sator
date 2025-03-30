const express = require('express');
const router = express.Router();
const db = require('../db/db');

// Ruta para obtener mensajes con paginación
router.get('/chat/:solicitudId/:type', async (req, res) => {
    try {
      const { solicitudId, type } = req.params;
      const { limit = 20, before, userId } = req.query;
      
      let query = `
        SELECT m.*, 
        CASE WHEN m.usuario_id = $1 THEN true ELSE false END as isSender
        FROM mensajes m
        WHERE m.solicitud_id = $2 AND m.tipo = $3
      `;
      
      const params = [userId, solicitudId, type];
      
      // Filtrar por ID si se proporciona
      if (before) {
        query += ` AND m.id < $${params.length + 1}`;
        params.push(before);
      }
      
      // Ordenar y limitar
      query += ` ORDER BY m.id DESC LIMIT $${params.length + 1}`;
      params.push(parseInt(limit));
      
      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (error) {
      console.error('Error al obtener mensajes:', error);
      res.status(500).json({ error: 'Error al obtener mensajes' });
    }
  }); 

// Obtener mensajes de un chat
router.get('/:solicitudId/:tipo', async (req, res) => {
    try {
        const { solicitudId, tipo } = req.params;
        const { limit = 20, before } = req.query;
        
        // Obtener el ID del usuario actual
        const currentUserId = req.session?.userId || req.query.userId || 1; 
        console.log(`[chat.routes] Usuario actual: ${currentUserId}, solicitando mensajes para solicitud ${solicitudId}, tipo ${tipo}`);
        
        let query = `
            SELECT m.id, m.chat_id, m.usuario_id, m.contenido, m.leido, 
                   m.created_at, DATE_FORMAT(m.created_at, '%Y-%m-%dT%H:%i:%s.000Z') as formatted_date 
            FROM mensajes m
            JOIN chats c ON m.chat_id = c.id
            WHERE c.solicitud_id = ? AND c.tipo = ?
        `;
        
        const params = [solicitudId, tipo];
        
        if (before) {
            query += ' AND m.id < ?';
            params.push(before);
        }
        
        query += ' ORDER BY m.id DESC LIMIT ?';
        params.push(parseInt(limit));
        
        console.log(`[chat.routes] Consultando mensajes para solicitud ${solicitudId}, tipo ${tipo}, usuario ${currentUserId}`);
        const [mensajes] = await db.query(query, params);
        
        // Procesamiento de mensajes con manejo cuidadoso de fechas
        mensajes.forEach(m => {
            try {
                // Intentar parsear el contenido si es string
                if (typeof m.contenido === 'string') {
                    try {
                        const parsed = JSON.parse(m.contenido);
                        // Si el contenido parseado tiene texto, usarlo
                        if (parsed.text) {
                            m.content = parsed.text;
                        } else if (parsed.value) {
                            m.content = parsed.value;
                        } else {
                            // Si no tiene esos campos, ver si es string directamente
                            m.content = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
                        }
                    } catch (e) {
                        // Si falla el parsing, usar el contenido original
                        m.content = m.contenido;
                    }
                } else {
                    // Si no es string, intentar extraer el texto directamente
                    if (m.contenido && m.contenido.text) {
                        m.content = m.contenido.text;
                    } else if (m.contenido && m.contenido.value) {
                        m.content = m.contenido.value;
                    } else {
                        m.content = JSON.stringify(m.contenido);
                    }
                }
                
                // Asegurar formato de fecha consistente
                m.created_at = m.formatted_date || m.created_at;
                if (typeof m.created_at === 'object' && m.created_at !== null) {
                    // Si es un objeto Date, convertir a ISO string
                    m.created_at = m.created_at.toISOString();
                } else if (typeof m.created_at === 'string') {
                    // Validar formato y reparar si es necesario
                    try {
                        const testDate = new Date(m.created_at);
                        if (!isNaN(testDate.getTime())) {
                            m.created_at = testDate.toISOString();
                        }
                    } catch (e) {
                        console.warn('Formato de fecha inválido:', m.created_at);
                        // Usar la fecha actual como fallback
                        m.created_at = new Date().toISOString();
                    }
                } else {
                    // Si no hay fecha, usar la actual
                    m.created_at = new Date().toISOString();
                }
                
                // Determinar explícitamente si el usuario actual es el remitente
                const usuarioId = parseInt(m.usuario_id);
                const usuarioActual = parseInt(currentUserId);
                console.log(`Mensaje ID: ${m.id}, De usuario: ${usuarioId}, Usuario actual: ${usuarioActual}`);
                m.isSender = usuarioId === usuarioActual;
                console.log(`¿Es remitente? ${m.isSender}`);
                
            } catch (e) {
                console.error('Error al procesar mensaje:', e);
                // Valores de fallback
                m.content = String(m.contenido || "Error en el mensaje");
                m.created_at = new Date().toISOString();
                m.isSender = false;
            }
            
            delete m.formatted_date; // Limpiar campo auxiliar
            delete m.contenido;
        });
        
        res.json(mensajes);
    } catch (error) {
        console.error('Error al obtener mensajes:', error);
        res.status(500).json({ error: 'Error al obtener mensajes' });
    }
});

// Marcar mensajes como leídos
router.post('/:solicitudId/:tipo/mark-read', async (req, res) => {
    try {
        const { solicitudId, tipo } = req.params;
        
        console.log(`[chat.routes] Recibiendo petición mark-read para: ${solicitudId}/${tipo}`);
        console.log(`[chat.routes] Body recibido:`, req.body);
        
        const { userId } = req.body;
        
        console.log(`Marcando mensajes como leídos: solicitud ${solicitudId}, tipo ${tipo}, usuario ${userId}`);
        
        // Si userId no está definido, responder con error
        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Se requiere userId para marcar mensajes como leídos' 
            });
        }
        
        // Primero obtener el chat_id
        const [chats] = await db.query(
            'SELECT id FROM chats WHERE solicitud_id = ? AND tipo = ?', 
            [solicitudId, tipo]
        );
        
        if (chats.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Chat no encontrado' 
            });
        }
        
        const chatId = chats[0].id;
        
        // Sólo marcar como leídos los mensajes que NO envió el usuario actual
        await db.query(`
            UPDATE mensajes
            SET leido = TRUE
            WHERE chat_id = ?
            AND usuario_id != ?
            AND leido = FALSE
        `, [chatId, userId]);
        
        // Actualizar contador de mensajes no leídos
        await db.query(`
            UPDATE chat_participantes
            SET mensajes_no_leidos = 0
            WHERE chat_id = ? AND usuario_id = ?
        `, [chatId, userId]);
        
        console.log(`Mensajes marcados como leídos para chat ${chatId}, usuario ${userId}`);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error al marcar mensajes como leídos:', error);
        res.status(500).json({ 
            success: false,
            error: 'Error al marcar mensajes como leídos' 
        });
    }
});

// Obtener cantidad de mensajes no leídos
router.get('/:solicitudId/:tipo/unread', async (req, res) => {
    try {
        const { solicitudId, tipo } = req.params;
        const userId = req.session?.userId || req.query.userId || 1; // Ajustar según tu sistema de autenticación
        
        // Primero, obtener el chat_id
        const [chats] = await db.query(
            'SELECT id FROM chats WHERE solicitud_id = ? AND tipo = ?',
            [solicitudId, tipo]
        );
        
        if (chats.length === 0) {
            return res.json({ unreadCount: 0 });
        }
        
        const chatId = chats[0].id;
        
        // Obtener contador de mensajes no leídos
        const [result] = await db.query(
            'SELECT mensajes_no_leidos FROM chat_participantes WHERE chat_id = ? AND usuario_id = ?',
            [chatId, userId]
        );
        
        const unreadCount = result.length > 0 ? result[0].mensajes_no_leidos : 0;
        
        res.json({ unreadCount });
    } catch (error) {
        console.error('Error al obtener mensajes no leídos:', error);
        res.status(500).json({ error: 'Error al obtener mensajes no leídos' });
    }
});

// Añadir ruta específica para interventor si no existe
router.get('/:solicitudId/interventor', async (req, res) => {
    try {
        const { solicitudId } = req.params;
        const { limit = 20, before } = req.query;
        
        let query = `
            SELECT m.id, m.chat_id, m.usuario_id, m.contenido, m.leido, m.created_at 
            FROM mensajes m
            JOIN chats c ON m.chat_id = c.id
            WHERE c.solicitud_id = ? AND c.tipo = 'interventor'
        `;
        
        const params = [solicitudId];
        
        if (before) {
            query += ' AND m.id < ?';
            params.push(before);
        }
        
        query += ' ORDER BY m.id DESC LIMIT ?';
        params.push(parseInt(limit));
        
        console.log(`[chat.routes] Consultando mensajes de interventor para solicitud ${solicitudId}`);
        const [mensajes] = await db.query(query, params);
        
        // Convertir el contenido de JSON a objeto si está almacenado como string
        mensajes.forEach(m => {
            try {
                if (typeof m.contenido === 'string') {
                    const parsedContent = JSON.parse(m.contenido);
                    // Si el contenido tiene un campo 'text', usarlo directamente
                    if (parsedContent.text) {
                        m.content = parsedContent.text;
                    } else if (parsedContent.value) {
                        m.content = parsedContent.value;
                    } else {
                        // Si no tiene esos campos, usar el objeto completo
                        m.content = parsedContent;
                    }
                } else {
                    // Si ya es un objeto, usarlo directamente
                    m.content = m.contenido;
                }
            } catch (e) {
                // Si falla el parsing, usar el contenido original
                console.error('Error al parsear contenido de mensaje:', e);
                m.content = m.contenido;
            }
            delete m.contenido;
        });
        
        res.json(mensajes);
    } catch (error) {
        console.error('Error al obtener mensajes del interventor:', error);
        res.status(500).json({ error: 'Error al obtener mensajes' });
    }
});

module.exports = router; 