const express = require('express');
const router = express.Router();
const db = require('../db/db');

// Obtener mensajes de un chat (ruta adicional para compatibilidad con sst.ejs)
router.get('/mensajes/:solicitudId/:tipo', async (req, res) => {
  try {
    const { solicitudId, tipo } = req.params;
    const limit = req.query.limit || 20;

    console.log(`[chat.routes] Solicitud de mensajes para solicitud ${solicitudId}, tipo ${tipo} (ruta /mensajes)`);

    // Manejo especial para chat global
    let queryParams;
    let chatQuery;
    
    if (solicitudId === 'global' && tipo === 'soporte') {
      const userId = req.query.userId;
      if (!userId) {
        return res.status(400).json({ error: 'Se requiere userId en query para chat global' });
      }
      chatQuery = 'SELECT id FROM chats WHERE solicitud_id = ? AND tipo = ?';
      queryParams = ['global-' + userId, 'soporte'];
    } else {
      chatQuery = 'SELECT id FROM chats WHERE solicitud_id = ? AND tipo = ?';
      queryParams = [solicitudId, tipo];
    }

    const [chats] = await db.query(chatQuery, queryParams);

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
      ORDER BY m.created_at ASC LIMIT ?
    `;
    
    const [mensajes] = await db.query(query, [chatId, parseInt(limit)]);
    console.log(`[chat.routes] Mensajes encontrados vía /mensajes: ${mensajes.length}`);

    const userId = req.query.userId || '';
    
    const mensajesProcesados = mensajes.map(m => {
      let contentObj;
      try {
        contentObj = typeof m.contenido === 'string' ? JSON.parse(m.contenido) : m.contenido;
      } catch {
        contentObj = { text: m.contenido || 'Mensaje sin contenido' };
      }

      return {
        id: m.id,
        chatId: m.chat_id,
        solicitudId: parseInt(solicitudId),
        usuario_id: m.usuario_id,
        username: m.username || 'Usuario',
        content: contentObj.text || JSON.stringify(contentObj),
        leido: Boolean(m.leido),
        created_at: new Date(m.created_at).toISOString(),
        type: tipo,
        isSender: userId ? parseInt(m.usuario_id) === parseInt(userId) : false
      };
    });

    res.json(mensajesProcesados);
  } catch (error) {
    console.error('[chat.routes] Error al obtener mensajes (ruta /mensajes):', error);
    res.status(500).json({ error: 'Error al obtener mensajes', details: error.message });
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

    // Manejo especial para chat global
    let queryParams;
    let chatQuery;
    
    if (solicitudId === 'global' && tipo === 'soporte') {
      chatQuery = 'SELECT id FROM chats WHERE solicitud_id = ? AND tipo = ?';
      queryParams = ['global-' + userId, 'soporte'];
    } else {
      chatQuery = 'SELECT id FROM chats WHERE solicitud_id = ? AND tipo = ?';
      queryParams = [solicitudId, tipo];
    }

    const [chats] = await db.query(chatQuery, queryParams);

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

    query += ' ORDER BY m.created_at ASC LIMIT ?';
    params.push(parseInt(limit));

    const [mensajes] = await db.query(query, params);
    console.log(`[chat.routes] Mensajes encontrados: ${mensajes.length}`);

    const mensajesProcesados = mensajes.map(m => {
      let contentObj;
      try {
        contentObj = typeof m.contenido === 'string' ? JSON.parse(m.contenido) : m.contenido;
      } catch {
        contentObj = { text: m.contenido || 'Mensaje sin contenido' };
      }

      return {
        id: m.id,
        chatId: m.chat_id,
        solicitudId: parseInt(solicitudId),
        usuario_id: m.usuario_id,
        username: m.username || 'Usuario',
        content: contentObj.text || JSON.stringify(contentObj),
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

// Marcar mensajes como leídos por tipo de chat
router.post('/:solicitudId/:tipo/mark-read', async (req, res) => {
  try {
    const { solicitudId, tipo } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Se requiere userId en el body' });
    }

    const [chats] = await db.query(
      'SELECT id FROM chats WHERE solicitud_id = ? AND tipo = ?',
      [solicitudId, tipo]
    );

    if (chats.length === 0) {
      return res.json({ success: true, message: 'No hay chat para marcar como leído' });
    }

    const chatId = chats[0].id;

    // Marcar todos los mensajes como leídos
    await db.query(`
      UPDATE mensajes m
      SET m.leido = TRUE
      WHERE m.chat_id = ? AND m.usuario_id != ?
    `, [chatId, userId]);

    // Actualizar contador de mensajes no leídos
    await db.query(`
      UPDATE chat_participantes
      SET mensajes_no_leidos = 0
      WHERE chat_id = ? AND usuario_id = ?
    `, [chatId, userId]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error al marcar mensajes como leídos:', error);
    res.status(500).json({ error: 'Error al marcar mensajes como leídos' });
  }
});

// Marcar mensajes como leídos
router.post('/marcar-todos-leidos', async (req, res) => {
  try {
    const { solicitudId, tipo, userId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'Se requiere userId' });
    }

    console.log(`Marcando mensajes como leídos: solicitud ${solicitudId}, tipo ${tipo}, usuario ${userId}`);

    // Manejo especial para chat global
    let queryParams;
    
    if (solicitudId === 'global' && tipo === 'soporte') {
      queryParams = ['global-' + userId, 'soporte'];
    } else {
      queryParams = [solicitudId, tipo];
    }

    const [chats] = await db.query(
      'SELECT id FROM chats WHERE solicitud_id = ? AND tipo = ?',
      queryParams
    );

    if (chats.length === 0) {
      return res.status(404).json({ success: false, message: 'Chat no encontrado' });
    }

    const chatId = chats[0].id;

    await db.query(`
      UPDATE mensajes
      SET leido = TRUE
      WHERE chat_id = ? AND usuario_id != ? AND leido = FALSE
    `, [chatId, userId]);

    await db.query(`
      UPDATE chat_participantes
      SET mensajes_no_leidos = 0
      WHERE chat_id = ? AND usuario_id = ?
    `, [chatId, userId]);

    console.log(`Mensajes marcados como leídos para chat ${chatId}, usuario ${userId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error al marcar mensajes como leídos:', error);
    res.status(500).json({ success: false, error: 'Error al marcar mensajes como leídos' });
  }
});

// Obtener cantidad de mensajes no leídos
router.get('/:solicitudId/:tipo/unread', async (req, res) => {
  try {
    const { solicitudId, tipo } = req.params;
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'Se requiere userId en query' });
    }

    const [chats] = await db.query(
      'SELECT id FROM chats WHERE solicitud_id = ? AND tipo = ?',
      [solicitudId, tipo]
    );

    if (chats.length === 0) {
      return res.json({ unreadCount: 0 });
    }

    const chatId = chats[0].id;

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

// Inicializar conversación si no existe
router.post('/iniciar/:solicitudId/:tipo', async (req, res) => {
  try {
    const { solicitudId, tipo } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Se requiere el ID del usuario' });
    }

    // Manejo especial para chat global de soporte
    if (solicitudId === 'global' && tipo === 'soporte') {
      console.log('[chat.routes] Inicializando chat global de soporte para usuario:', userId);
      
      // Verificar si ya existe un chat global para este usuario
      const [existingChats] = await db.query(
        'SELECT id FROM chats WHERE solicitud_id = ? AND tipo = ?',
        ['global-' + userId, 'soporte']
      );

      let chatId;
      let esNuevo = false;

      if (existingChats.length === 0) {
        // Crear nuevo chat global
        const [result] = await db.query(
          'INSERT INTO chats (solicitud_id, tipo, metadatos) VALUES (?, ?, ?)',
          ['global-' + userId, 'soporte', JSON.stringify({
            created_at: new Date().toISOString(),
            created_by: userId,
            is_global: true
          })]
        );

        chatId = result.insertId;
        esNuevo = true;

        // Obtener usuarios de soporte
        const [soporteUsers] = await db.query(`
          SELECT u.id FROM users u
          JOIN roles r ON u.role_id = r.id
          WHERE r.role_name = 'soporte' LIMIT 1
        `);
        
        if (soporteUsers.length > 0) {
          await db.query(
            'INSERT INTO chat_participantes (chat_id, usuario_id) VALUES (?, ?), (?, ?)',
            [chatId, userId, chatId, soporteUsers[0].id]
          );
        } else {
          // Si no hay usuario de soporte, solo agregamos al usuario actual
          await db.query(
            'INSERT INTO chat_participantes (chat_id, usuario_id) VALUES (?, ?)',
            [chatId, userId]
          );
          console.log('[chat.routes] Advertencia: No hay usuarios de soporte disponibles');
        }
      } else {
        chatId = existingChats[0].id;
      }

      console.log('[chat.routes] Chat global de soporte inicializado:', chatId);
      
      return res.json({
        success: true,
        chatId: chatId,
        esNuevo: esNuevo,
        isGlobal: true
      });
    }

    const [chats] = await db.query(
      'SELECT id FROM chats WHERE solicitud_id = ? AND tipo = ?',
      [solicitudId, tipo]
    );

    let chatId;
    let esNuevo = false;

    if (chats.length === 0) {
      const [solicitudes] = await db.query(
        'SELECT usuario_id, interventor_id FROM solicitudes WHERE id = ?',
        [solicitudId]
      );

      if (solicitudes.length === 0) {
        return res.status(404).json({ error: 'Solicitud no encontrada' });
      }

      const solicitud = solicitudes[0];

      const [result] = await db.query(
        'INSERT INTO chats (solicitud_id, tipo, metadatos) VALUES (?, ?, ?)',
        [solicitudId, tipo, JSON.stringify({
          created_at: new Date().toISOString(),
          created_by: userId
        })]
      );

      chatId = result.insertId;
      esNuevo = true;

      if (tipo === 'sst') {
        const [sstUsers] = await db.query(`
          SELECT u.id FROM users u
          JOIN roles r ON u.role_id = r.id
          WHERE r.role_name = 'sst' LIMIT 1
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
      } else if (tipo === 'soporte') {
        const [soporteUsers] = await db.query(`
          SELECT u.id FROM users u
          JOIN roles r ON u.role_id = r.id
          WHERE r.role_name = 'soporte' LIMIT 1
        `);
        if (soporteUsers.length > 0) {
          // Solo agregamos como participantes al usuario que inicia el chat (contratista) y al usuario de soporte
          // Eliminamos la inclusión de otros roles (SST, interventor) que no deberían ver estos mensajes
          await db.query(
            'INSERT INTO chat_participantes (chat_id, usuario_id) VALUES (?, ?), (?, ?)',
            [chatId, solicitud.usuario_id, chatId, soporteUsers[0].id]
          );
        } else {
          return res.status(404).json({ error: 'No hay usuarios de soporte disponibles' });
        }
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

    const [chats] = await db.query(
      'SELECT id, tipo FROM chats WHERE solicitud_id = ?',
      [solicitudId]
    );

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

    const [sstUsers] = await db.query(`
      SELECT u.id, u.username 
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE r.role_name = 'sst'
    `);

    const [soporteUsers] = await db.query(`
      SELECT u.id, u.username 
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE r.role_name = 'soporte'
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
      sstUsers: sstUsers,
      disponibleSoporte: soporteUsers.length > 0,
      soporteUsers: soporteUsers
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

// Marcar un mensaje individual como leído
router.post('/marcar-leido', async (req, res) => {
  try {
    const { messageId } = req.body;

    if (!messageId) {
      return res.status(400).json({ success: false, message: 'Se requiere messageId' });
    }

    console.log(`Marcando mensaje ${messageId} como leído`);

    await db.query(`UPDATE mensajes SET leido = TRUE WHERE id = ?`, [messageId]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error al marcar mensaje como leído:', error);
    res.status(500).json({ success: false, error: 'Error al marcar mensaje como leído' });
  }
});

module.exports = router;