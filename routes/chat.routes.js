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
      const { limit = 20, before, userId } = req.query;
      
      if (!userId) {
        return res.status(400).json({ error: 'Se requiere userId en query' });
      }
      
      console.log(`[chat.routes] Usuario ${userId} solicitando mensajes para solicitud ${solicitudId}, tipo ${tipo}`);
      
      const [chats] = await db.query(
        'SELECT id FROM chats WHERE solicitud_id = ? AND tipo = ?',
        [solicitudId, tipo]
      );
      
      let chatId;
      if (chats.length === 0) {
        return res.json([]);
      } else {
        chatId = chats[0].id;
      }
      
      let query = `
        SELECT m.id, m.chat_id, m.usuario_id, m.contenido, m.leido, m.created_at, u.username
        FROM mensajes m
        JOIN chats c ON m.chat_id = c.id
        LEFT JOIN users u ON m.usuario_id = u.id
        WHERE m.chat_id = ?
      `;
      const params = [chatId];
      
      if (before) {
        query += ' AND m.id < ?';
        params.push(before);
      }
      
      query += ' ORDER BY m.created_at ASC LIMIT ?'; // Cambiado a ASC para orden cronológico
      params.push(parseInt(limit));
      
      const [mensajes] = await db.query(query, params);
      console.log(`[chat.routes] Mensajes encontrados: ${mensajes.length}`);
      
      const mensajesProcesados = mensajes.map(m => {
        let content = '';
        try {
          if (typeof m.contenido === 'string') {
            const parsed = JSON.parse(m.contenido);
            content = parsed.text || parsed.value || JSON.stringify(parsed);
          } else {
            content = m.contenido?.text || m.contenido?.value || JSON.stringify(m.contenido || {});
          }
        } catch {
          content = m.contenido || 'Mensaje sin contenido';
        }
        
        return {
          id: m.id,
          chatId: m.chat_id,
          solicitudId: parseInt(solicitudId),
          usuario_id: m.usuario_id,
          username: m.username || 'Usuario',
          content: content,
          leido: Boolean(m.leido),
          created_at: new Date(m.created_at).toISOString(),
          type: tipo,
          isSender: parseInt(m.usuario_id) === parseInt(userId)
        };
      });
      
      console.log(`[chat.routes] Enviando ${mensajesProcesados.length} mensajes procesados`);
      res.json(mensajesProcesados);
    } catch (error) {
      console.error('[chat.routes] Error al obtener mensajes:', error);
      res.status(500).json({ error: 'Error al obtener mensajes', details: error.message });
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

// Inicializar conversación si no existe
router.post('/iniciar/:solicitudId/:tipo', async (req, res) => {
    try {
        const { solicitudId, tipo } = req.params;
        const { userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({ error: 'Se requiere el ID del usuario' });
        }
        
        // Verificar si ya existe un chat
        const [chats] = await db.query(
            'SELECT id FROM chats WHERE solicitud_id = ? AND tipo = ?',
            [solicitudId, tipo]
        );
        
        let chatId;
        let esNuevo = false;
        
        if (chats.length === 0) {
            // Obtener datos de la solicitud
            const [solicitudes] = await db.query(
                'SELECT usuario_id, interventor_id FROM solicitudes WHERE id = ?',
                [solicitudId]
            );
            
            if (solicitudes.length === 0) {
                return res.status(404).json({ error: 'Solicitud no encontrada' });
            }
            
            const solicitud = solicitudes[0];
            
            // Crear nuevo chat
            const [result] = await db.query(
                'INSERT INTO chats (solicitud_id, tipo, metadatos) VALUES (?, ?, ?)',
                [solicitudId, tipo, JSON.stringify({
                    created_at: new Date().toISOString(),
                    created_by: userId
                })]
            );
            
            chatId = result.insertId;
            esNuevo = true;
            
            // Registrar participantes según el tipo
            if (tipo === 'sst') {
                const [sstUsers] = await db.query(`
                    SELECT u.id FROM users u
                    JOIN roles r ON u.role_id = r.id
                    WHERE r.role_name = 'sst'
                    LIMIT 1
                `);
                
                if (sstUsers.length > 0) {
                    await db.query(
                        'INSERT INTO chat_participantes (chat_id, usuario_id) VALUES (?, ?), (?, ?)',
                        [chatId, solicitud.usuario_id, chatId, sstUsers[0].id]
                    );
                }
            } else if (tipo === 'interventor' && solicitud.interventor_id) {
                await db.query(
                    'INSERT INTO chat_participantes (chat_id, usuario_id) VALUES (?, ?), (?, ?)',
                    [chatId, solicitud.usuario_id, chatId, solicitud.interventor_id]
                );
            }
        } else {
            chatId = chats[0].id;
        }
        
        res.json({ 
            success: true, 
            chatId: chatId,
            esNuevo: esNuevo
        });
    } catch (error) {
        console.error('Error al inicializar conversación:', error);
        res.status(500).json({ error: 'Error al inicializar conversación' });
    }
});

// Ruta para verificar estado del chat
router.get('/status/:solicitudId', async (req, res) => {
    try {
        const { solicitudId } = req.params;
        
        // Verificar que la solicitud existe
        const [solicitudes] = await db.query(
            'SELECT id, usuario_id, interventor_id, estado FROM solicitudes WHERE id = ?',
            [solicitudId]
        );
        
        if (solicitudes.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: 'Solicitud no encontrada' 
            });
        }
        
        const solicitud = solicitudes[0];
        
        // Verificar chats existentes
        const [chats] = await db.query(
            'SELECT id, tipo FROM chats WHERE solicitud_id = ?',
            [solicitudId]
        );
        
        // Obtener participantes de los chats
        const chatInfo = [];
        for (const chat of chats) {
            const [participantes] = await db.query(`
                SELECT cp.usuario_id, u.username 
                FROM chat_participantes cp
                JOIN users u ON cp.usuario_id = u.id
                WHERE cp.chat_id = ?
            `, [chat.id]);
            
            chatInfo.push({
                id: chat.id,
                tipo: chat.tipo,
                participantes: participantes
            });
        }
        
        // Verificar disponibilidad de SST
        const [sstUsers] = await db.query(`
            SELECT u.id, u.username 
            FROM users u
            JOIN roles r ON u.role_id = r.id
            WHERE r.role_name = 'sst'
        `);
        
        res.json({
            success: true,
            solicitud: {
                id: solicitud.id,
                estado: solicitud.estado,
                usuario_id: solicitud.usuario_id,
                interventor_id: solicitud.interventor_id
            },
            chats: chatInfo,
            disponibleSST: sstUsers.length > 0,
            sstUsers: sstUsers
        });
    } catch (error) {
        console.error('Error al verificar estado del chat:', error);
        res.status(500).json({ 
            success: false,
            error: 'Error al verificar estado del chat',
            details: error.message
        });
    }
});

module.exports = router; 