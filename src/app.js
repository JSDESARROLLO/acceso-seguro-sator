const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const db = require('../db/db'); // Corregir la ruta de importación

const app = express();

// Crear servidor HTTP con Express
const server = http.createServer(app);

// Configuración de CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Configuración del motor de vistas
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Rutas
app.use(require('../routes/index.routes'));
app.use(require('../routes/register.routes'));
app.use(require('../routes/contratista.routes'));
app.use(require('../routes/interventor.routes'));
app.use(require('../routes/sst.routes'));
app.use(require('../routes/seguridad.routes'));
app.use('/capacitaciones', require('../routes/capacitacion.routes'));

// Importar rutas
const capacitacionRoutes = require('../routes/capacitacion.routes');
const uploadRoutes = require('../routes/upload.routes');
const chatRoutes = require('../routes/chat.routes');
const solicitudRoutes = require('../routes/solicitud.routes');

// Usar rutas
app.use('/capacitacion', capacitacionRoutes);
app.use('/', uploadRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api', solicitudRoutes);

// Ruta para logout
app.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/login');
});

// Manejo de 404
app.use((req, res) => {
    res.status(404).render('404', { title: 'Página no encontrada' });
});

// Configuración del servidor WebSocket
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    // Extraer información de la URL para identificar el tipo de conexión
    const urlParts = req.url.split('/'); 
    // Formato esperado: /ws/chat/[ID_SOLICITUD] o /ws/chat/sst o /ws/chat/interventor
    const chatType = urlParts[2]; // 'chat'
    const identifier = urlParts[3]; // ID de solicitud, 'sst' o 'interventor'
    
    // Guardar información en el objeto websocket para referencia futura
    ws.chatType = chatType;
    ws.identifier = identifier;

    console.log(`Cliente conectado: ${chatType}/${identifier}`);

    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data);
            console.log(`Mensaje recibido: ${JSON.stringify(message)}`);

            // Validar mensaje
            if (!message.solicitudId || !message.type || !message.content) {
                console.error('Mensaje con formato inválido:', message);
                return;
            }

            // Obtener el ID de usuario desde la sesión o solicitud
            // Esto debe adaptarse según tu sistema de autenticación
            const userId = message.userId || 1; // Valor temporal, ajustar según tu sistema

            // Obtener el timestamp del mensaje o crear uno nuevo
            const timestamp = message.timestamp 
                ? new Date(message.timestamp) 
                : new Date();
                
            // Asegurarse de que sea formato ISO para consistencia
            message.created_at = timestamp.toISOString();

            // Guardar el mensaje en la base de datos
            const chatId = await saveMessageToDatabase({...message, userId});

            // Actualizar mensajes no leídos para los participantes
            await updateUnreadCount(chatId, message);

            // Enviar el mensaje a todos los clientes interesados en esta conversación
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    // Determinar si debe recibir este mensaje
                    let shouldReceive = false;
                    
                    // Caso 1: Cliente está en el chat específico de una solicitud
                    if (client.chatType === 'chat' && client.identifier === message.solicitudId) {
                        shouldReceive = true;
                    } 
                    // Caso 2: Cliente SST viendo mensajes tipo 'sst'
                    else if (client.chatType === 'chat' && client.identifier === 'sst' && message.type === 'sst') {
                        shouldReceive = true;
                    }
                    // Caso 3: Cliente Interventor viendo mensajes tipo 'interventor'
                    else if (client.chatType === 'chat' && client.identifier === 'interventor' && message.type === 'interventor') {
                        shouldReceive = true;
                    }
                    
                    // MODIFICACIÓN IMPORTANTE: Solo enviar a clientes que NO sean el remitente
                    if (shouldReceive && client !== ws) {
                        // Contenido a enviar...
                        let contenidoParaEnviar = message.content;
                        if (typeof contenidoParaEnviar === 'object') {
                            contenidoParaEnviar = contenidoParaEnviar.text || 
                                                  contenidoParaEnviar.value || 
                                                  JSON.stringify(contenidoParaEnviar);
                        }
                        
                        client.send(JSON.stringify({
                            id: message.id || null,
                            chatId: chatId,
                            usuario_id: message.userId,
                            content: contenidoParaEnviar,
                            leido: false,
                            created_at: message.created_at,
                            solicitudId: message.solicitudId,
                            type: message.type,
                            isSender: false
                        }));
                    }
                }
            });
        } catch (error) {
            console.error('Error al procesar mensaje:', error);
        }
    });

    ws.on('close', () => {
        console.log(`Cliente desconectado: ${ws.chatType}/${ws.identifier}`);
    });
});

// Función para guardar mensajes en la base de datos
async function saveMessageToDatabase(message) {
    try {
        // Obtener o crear el chat_id desde la tabla 'chats'
        let chatId;
        const [chatRows] = await db.query('SELECT id FROM chats WHERE solicitud_id = ? AND tipo = ?', [message.solicitudId, message.type]);
        if (chatRows.length === 0) {
            const [result] = await db.query('INSERT INTO chats (solicitud_id, tipo) VALUES (?, ?)', [message.solicitudId, message.type]);
            chatId = result.insertId;

            // Agregar participantes al chat (contratista, SST o interventor según tipo)
            const [solicitud] = await db.query('SELECT usuario_id, interventor_id FROM solicitudes WHERE id = ?', [message.solicitudId]);
            
            if (solicitud.length === 0) {
                throw new Error(`Solicitud con ID ${message.solicitudId} no encontrada`);
            }
            
            const contratistaId = solicitud[0].usuario_id;
            const interventorId = solicitud[0].interventor_id;
            
            // Obtener ID del SST (si message.type es 'sst')
            let sstId = null;
            if (message.type === 'sst') {
                const [sstRoleResult] = await db.query('SELECT id FROM roles WHERE role_name = "sst"');
                if (sstRoleResult.length > 0) {
                    const [sstUsers] = await db.query('SELECT id FROM users WHERE role_id = ?', [sstRoleResult[0].id]);
                    if (sstUsers.length > 0) {
                        sstId = sstUsers[0].id;
                    }
                }
            }

            const participants = message.type === 'sst' ? 
                [contratistaId, sstId].filter(id => id) : 
                [contratistaId, interventorId].filter(id => id);
            
            // Registrar los participantes en el chat
            for (const userId of participants) {
                await db.query('INSERT IGNORE INTO chat_participantes (chat_id, usuario_id) VALUES (?, ?)', [chatId, userId]);
            }
        } else {
            chatId = chatRows[0].id;
        }

        // Determinar el timestamp (usar el enviado o generar uno nuevo)
        const timestamp = message.timestamp 
          ? new Date(message.timestamp) 
          : new Date();
          
        // Formatear para MySQL
        const formattedTimestamp = timestamp.toISOString().slice(0, 19).replace('T', ' ');

        // Asegurar que el contenido se almacene como JSON
        let contenidoMsg;
        if (typeof message.content === 'string') {
            contenidoMsg = JSON.stringify({ 
                text: message.content,
                timestamp: timestamp.toISOString() // Incluir timestamp dentro del contenido
            });
        } else if (typeof message.content === 'object') {
            // Añadir el timestamp al objeto existente
            const contentObj = { ...message.content, timestamp: timestamp.toISOString() };
            contenidoMsg = JSON.stringify(contentObj);
        } else {
            contenidoMsg = JSON.stringify({ 
                value: message.content,
                timestamp: timestamp.toISOString()
            });
        }

        // Insertar el mensaje en la tabla 'mensajes' con el timestamp
        const [result] = await db.query(
            'INSERT INTO mensajes (chat_id, usuario_id, contenido, leido, created_at) VALUES (?, ?, ?, FALSE, ?)',
            [chatId, message.userId || 1, contenidoMsg, formattedTimestamp]
        );

        message.id = result.insertId; // Agregar el ID al mensaje
        message.created_at = timestamp.toISOString(); // Asegurar que el timestamp sea formato ISO
        
        return chatId;
    } catch (error) {
        console.error('Error al guardar mensaje:', error);
        throw error;
    }
}

// Función mejorada para actualizar el conteo de mensajes no leídos
async function updateUnreadCount(chatId, message) {
    try {
        // Consultar participantes del chat
        const [participants] = await db.query('SELECT usuario_id FROM chat_participantes WHERE chat_id = ?', [chatId]);
        
        // Registrar la actualización detallada
        console.log(`Actualizando mensajes no leídos para el chat ${chatId}:`);
        console.log(`- Mensaje enviado por usuario ${message.userId}`);
        console.log(`- Participantes del chat:`, participants.map(p => p.usuario_id));
        
        // Incrementar contador solo para otros participantes
        for (const participant of participants) {
            // Solo incrementar para los destinatarios, no para el remitente
            if (parseInt(participant.usuario_id) !== parseInt(message.userId)) {
                console.log(`- Incrementando contador para usuario ${participant.usuario_id}`);
                await db.query(
                    'UPDATE chat_participantes SET mensajes_no_leidos = mensajes_no_leidos + 1 WHERE chat_id = ? AND usuario_id = ?',
                    [chatId, participant.usuario_id]
                );
            } else {
                console.log(`- Omitiendo incremento para el remitente ${participant.usuario_id}`);
            }
        }
    } catch (error) {
        console.error('Error al actualizar mensajes no leídos:', error);
    }
}

// Actualizar la ruta para marcar mensajes como leídos
app.post('/api/chat/:solicitudId/:type/mark-read', async (req, res) => {
  try {
    const { solicitudId, type } = req.params;
    const { userId } = req.body;
    
    console.log(`Marcando mensajes como leídos: solicitud ${solicitudId}, tipo ${type}, usuario ${userId}`);
    
    // Validar los parámetros
    if (!solicitudId || !type || !userId) {
      return res.status(400).json({ 
        error: 'Parámetros incompletos. Se requiere solicitudId, type y userId',
        details: { solicitudId, type, userId }
      });
    }
    
    // Validar que userId sea un número válido
    const userIdNum = parseInt(userId);
    if (isNaN(userIdNum) || userIdNum <= 0) {
      return res.status(400).json({ 
        error: 'ID de usuario inválido, debe ser un número positivo',
        details: { userId, parsed: userIdNum }
      });
    }
    
    // Primero, obtener el chat_id correspondiente
    const [chats] = await db.query(
      'SELECT id FROM chats WHERE solicitud_id = ? AND tipo = ?',
      [solicitudId, type]
    );
    
    if (chats.length === 0) {
      // No existe un chat para esta solicitud y tipo, pero no es un error
      return res.json({ success: true, info: 'No hay chat para marcar mensajes' });
    }
    
    const chatId = chats[0].id;
    
    // Marcar como leídos todos los mensajes que NO fueron enviados por este usuario
    await db.query(`
      UPDATE mensajes
      SET leido = TRUE
      WHERE chat_id = ?
      AND usuario_id != ?
      AND leido = FALSE
    `, [chatId, userIdNum]);
    
    // Actualizar contador de mensajes no leídos en la tabla chat_participantes
    await db.query(`
      UPDATE chat_participantes
      SET mensajes_no_leidos = 0
      WHERE chat_id = ? AND usuario_id = ?
    `, [chatId, userIdNum]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error al marcar mensajes como leídos:', error);
    res.status(500).json({ 
      error: 'Error al marcar mensajes como leídos', 
      details: error.message 
    });
  }
});

// API para actualizar estado de mensajes
app.put('/api/chat/message/:messageId/status', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { status } = req.body;
    
    if (!messageId || !status) {
      return res.status(400).json({ error: 'Se requiere ID de mensaje y estado' });
    }
    
    // Actualizar el estado del mensaje en la base de datos
    if (status === 'read') {
      await db.query('UPDATE mensajes SET leido = true WHERE id = ?', [messageId]);
    }
    
    // Enviar notificación de cambio de estado por WebSocket
    // (implementación depende de cómo manejas los WebSockets en el servidor)
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error al actualizar estado del mensaje:', error);
    res.status(500).json({ error: 'Error al actualizar estado del mensaje' });
  }
});

// API para obtener estado de mensajes
app.get('/api/chat/messages/status', async (req, res) => {
  try {
    const { ids } = req.query;
    
    if (!ids) {
      return res.status(400).json({ error: 'Se requieren IDs de mensajes' });
    }
    
    const messageIds = ids.split(',');
    
    // Consultar estado de los mensajes
    const [rows] = await db.query(
      'SELECT id, leido FROM mensajes WHERE id IN (?)',
      [messageIds]
    );
    
    const statuses = {};
    rows.forEach(row => {
      statuses[row.id] = row.leido ? 'read' : 'delivered';
    });
    
    res.json({ statuses });
  } catch (error) {
    console.error('Error al obtener estado de mensajes:', error);
    res.status(500).json({ error: 'Error al obtener estado de mensajes' });
  }
});

// Agregar directamente en src/app.js para garantizar que la ruta funcione
app.get('/api/solicitud/:solicitudId/participants', async (req, res) => {
  try {
    const { solicitudId } = req.params;
    
    // Validar que el ID sea un número
    if (!solicitudId || isNaN(parseInt(solicitudId))) {
      return res.status(400).json({ error: 'ID de solicitud inválido' });
    }
    
    // Obtener información de la solicitud incluyendo el interventor
    const [solicitud] = await db.query(`
      SELECT s.id, s.empresa, s.usuario_id, s.interventor_id, 
             u_interventor.username AS interventor_nombre
      FROM solicitudes s
      LEFT JOIN users u_interventor ON s.interventor_id = u_interventor.id
      WHERE s.id = ?
    `, [solicitudId]);
    
    if (solicitud.length === 0) {
      return res.status(404).json({ error: 'Solicitud no encontrada' });
    }
    
    // Obtener información del usuario contratista
    const [contratista] = await db.query(`
      SELECT id, username, empresa, nit
      FROM users
      WHERE id = ?
    `, [solicitud[0].usuario_id]);
    
    // Obtener usuarios SST (todos los que tienen ese rol)
    const [sstUsers] = await db.query(`
      SELECT u.id, u.username
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE r.role_name = 'sst'
      ORDER BY u.username ASC
    `);
    
    // Enviar la respuesta con la información de participantes
    res.json({
      solicitudId: parseInt(solicitudId),
      interventorId: solicitud[0].interventor_id,
      interventorName: solicitud[0].interventor_nombre || 'Sin asignar',
      contratistaId: contratista[0]?.id,
      contratistaName: contratista[0]?.username || 'Desconocido',
      sstUsers: sstUsers.map(user => ({
        id: user.id,
        username: user.username
      })),
      sstUsername: 'Soporte SST'
    });
    
  } catch (error) {
    console.error('Error al obtener participantes del chat:', error);
    res.status(500).json({ 
      error: 'Error al obtener participantes del chat',
      details: error.message 
    });
  }
});

// Agregar esta ruta para obtener cantidad de mensajes no leídos
app.get('/api/chat/:solicitudId/:type/unread', async (req, res) => {
  try {
    const { solicitudId, type } = req.params;
    const { userId } = req.query;
    
    // Validar parámetros
    if (!solicitudId || !type || !userId) {
      return res.status(400).json({ 
        error: 'Parámetros incompletos. Se requiere solicitudId, type y userId',
        details: { solicitudId, type, userId }
      });
    }
    
    // Validar que userId sea un número válido
    const userIdNum = parseInt(userId);
    if (isNaN(userIdNum) || userIdNum <= 0) {
      return res.status(400).json({ 
        error: 'ID de usuario inválido, debe ser un número positivo',
        details: { userId, parsed: userIdNum }
      });
    }
    
    // Obtener el chat_id correspondiente
    const [chats] = await db.query(
      'SELECT id FROM chats WHERE solicitud_id = ? AND tipo = ?',
      [solicitudId, type]
    );
    
    if (chats.length === 0) {
      // No existe un chat para esta solicitud y tipo
      return res.json({ unreadCount: 0 });
    }
    
    const chatId = chats[0].id;
    
    // Obtener el número de mensajes no leídos
    const [rows] = await db.query(`
      SELECT mensajes_no_leidos 
      FROM chat_participantes 
      WHERE chat_id = ? AND usuario_id = ?
    `, [chatId, userIdNum]);
    
    const unreadCount = rows.length > 0 ? rows[0].mensajes_no_leidos : 0;
    
    res.json({ unreadCount });
  } catch (error) {
    console.error('Error al obtener mensajes no leídos:', error);
    res.status(500).json({ error: 'Error al obtener mensajes no leídos' });
  }
});

// Ruta auxiliar para depuración (quítala en producción)
app.get('/debug/routes', (req, res) => {
  const routes = [];
  
  // Recolectar todas las rutas registradas
  app._router.stack.forEach(middleware => {
    if (middleware.route) {
      // Rutas directamente registradas en app
      routes.push({
        path: middleware.route.path,
        methods: Object.keys(middleware.route.methods).join(', ').toUpperCase()
      });
    } else if (middleware.name === 'router') {
      // Rutas incluidas a través de un router
      middleware.handle.stack.forEach(handler => {
        if (handler.route) {
          routes.push({
            path: handler.route.path,
            methods: Object.keys(handler.route.methods).join(', ').toUpperCase(),
            baseRouter: middleware.regexp.toString()
          });
        }
      });
    }
  });
  
  // Renderizar la lista de rutas
  res.send(`
    <h1>Rutas registradas</h1>
    <table border="1">
      <tr>
        <th>Método</th>
        <th>Ruta</th>
      </tr>
      ${routes.map(route => `
        <tr>
          <td>${route.methods}</td>
          <td>${route.path}</td>
        </tr>
      `).join('')}
    </table>
  `);
});

// Iniciar servidor
const PORT = 3900;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});