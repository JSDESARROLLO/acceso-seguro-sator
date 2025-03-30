const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const db = require('../db/db'); // Corregir la ruta de importación
const jwt = require('jsonwebtoken');

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

// Mapa para mantener un registro de las conexiones activas
const activeConnections = new Map(); // userId -> Set<WebSocket>

wss.on('connection', async (ws, req) => {
    ws.isAlive = true;
    
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);
        console.log('📨 Mensaje WebSocket recibido:', data);
    
        // Manejar identificación con mejor validación
        if (data.type === 'identify') {
          // Verificar que userId sea válido
          if (!data.userId || data.userId === 'undefined') {
            console.error('❌ ERROR: userId no válido en identify:', data);
            ws.send(JSON.stringify({
              type: 'error',
              error: 'ID de usuario no válido',
              details: 'Se requiere un ID de usuario válido para identificarse'
            }));
            return;
          }
    
          ws.userId = data.userId;
          ws.role = data.role;
          ws.solicitudId = data.solicitudId;
    
          if (!activeConnections.has(data.userId)) {
            activeConnections.set(data.userId, new Set());
          }
          activeConnections.get(data.userId).add(ws);
    
          // Verificar que el usuario existe en la base de datos
          const [usuarios] = await db.query(
            'SELECT username, role_id FROM users WHERE id = ?',
            [data.userId]
          );
    
          if (usuarios.length === 0) {
            console.error(`❌ ERROR: Usuario con ID ${data.userId} no encontrado en la base de datos`);
            ws.send(JSON.stringify({
              type: 'error',
              error: 'Usuario no encontrado',
              details: 'El ID de usuario proporcionado no corresponde a ningún usuario en el sistema'
            }));
            return;
          }
    
          const usuario = usuarios[0];
    
          console.log('🔌 CONEXIÓN WEBSOCKET:', { 
            usuario: {
              id: ws.userId,
              nombre: usuario.username,
              rol: ws.role
            },
            solicitud: ws.solicitudId,
            timestamp: new Date().toISOString()
          });
    
          // Confirmación de identificación exitosa
          ws.send(JSON.stringify({
            type: 'identify_confirmation',
            status: 'success',
            userId: data.userId,
            role: data.role
          }));
    
          return;
        }
    
        // Verificar que el usuario está identificado antes de procesar mensajes
        if (!ws.userId || ws.userId === 'undefined') {
          console.error('❌ ERROR: Intento de enviar mensaje sin identificación previa:', data);
          ws.send(JSON.stringify({
            type: 'error',
            error: 'Usuario no identificado',
            details: 'Debe identificarse antes de enviar mensajes'
          }));
          return;
        }
    
        // Procesar mensaje normal
        if (data.type === 'sst' || data.type === 'contratista' || data.type === 'interventor') {
          // 1. Obtenemos información del remitente
          const [[remitente]] = await db.query(
            'SELECT username, role_id FROM users WHERE id = ?',
            [data.userId]
          );
    
          if (!remitente) {
            throw new Error(`Usuario con ID ${data.userId} no encontrado`);
          }
    
          console.log('👤 REMITENTE:', {
            id: data.userId,
            nombre: remitente.username,
            rol: data.role
          });
    
          // 2. Obtenemos información de la solicitud
          const [[solicitud]] = await db.query(`
            SELECT s.*, 
                   uc.id as contratista_id, uc.username as contratista_nombre,
                   ui.id as interventor_id, ui.username as interventor_nombre
            FROM solicitudes s 
            JOIN users uc ON s.usuario_id = uc.id 
            LEFT JOIN users ui ON s.interventor_id = ui.id
            WHERE s.id = ?
          `, [data.solicitudId]);
    
          if (!solicitud) {
            throw new Error(`Solicitud con ID ${data.solicitudId} no encontrada`);
          }
    
          console.log('📄 SOLICITUD:', {
            id: solicitud.id,
            contratista: {
              id: solicitud.contratista_id,
              nombre: solicitud.contratista_nombre
            },
            interventor: {
              id: solicitud.interventor_id,
              nombre: solicitud.interventor_nombre
            }
          });
    
          // 3. Obtenemos o creamos un chat en la tabla chats
          let chatId;
          const [[existingChat]] = await db.query(
            'SELECT id FROM chats WHERE solicitud_id = ? AND tipo = ?',
            [data.solicitudId, data.type]
          );
    
          if (!existingChat) {
            const [createResult] = await db.query(
              'INSERT INTO chats (solicitud_id, tipo, metadatos) VALUES (?, ?, ?)',
              [data.solicitudId, data.type, JSON.stringify({
                created_by: data.userId,
                created_at: new Date().toISOString()
              })]
            );
    
            chatId = createResult.insertId;
    
            console.log('🆕 NUEVO CHAT CREADO:', {
              id: chatId,
              tipo: data.type,
              solicitudId: data.solicitudId
            });
    
            // 4. Registramos los participantes del chat en chat_participantes
            const participantes = [];
    
            // El contratista siempre es participante
            participantes.push({
              id: solicitud.contratista_id,
              nombre: solicitud.contratista_nombre,
              rol: 'contratista'
            });
    
            // Dependiendo del tipo, añadimos SST o Interventor
            if (data.type === 'sst') {
              participantes.push({
                id: data.userId,
                nombre: remitente.username,
                rol: 'sst'
              });
            } else if (data.type === 'interventor') {
              participantes.push({
                id: solicitud.interventor_id,
                nombre: solicitud.interventor_nombre,
                rol: 'interventor'
              });
            }
    
            // Registrar participantes en la tabla chat_participantes
            for (const participante of participantes) {
              await db.query(
                'INSERT INTO chat_participantes (chat_id, usuario_id) VALUES (?, ?)',
                [chatId, participante.id]
              );
            }
    
            console.log('👥 PARTICIPANTES REGISTRADOS:', participantes);
          } else {
            chatId = existingChat.id;
          }
    
          // 5. Guardamos el mensaje en la tabla mensajes
          const [messageResult] = await db.query(
            'INSERT INTO mensajes (chat_id, usuario_id, contenido, leido) VALUES (?, ?, ?, FALSE)',
            [chatId, data.userId, JSON.stringify({
              text: data.content,
              timestamp: new Date().toISOString()
            })]
          );
    
          const messageId = messageResult.insertId;
          const timestamp = new Date().toISOString();
    
          console.log('💬 MENSAJE GUARDADO:', {
            id: messageId,
            chatId: chatId,
            remitente: {
              id: data.userId,
              nombre: remitente.username
            },
            contenido: data.content,
            timestamp: timestamp
          });
    
          // 6. Obtenemos todos los participantes del chat
          const [participantes] = await db.query(
            `SELECT cp.usuario_id, u.username, r.role_name
             FROM chat_participantes cp 
             JOIN users u ON cp.usuario_id = u.id 
             LEFT JOIN roles r ON u.role_id = r.id
             WHERE cp.chat_id = ?`,
            [chatId]
          );
    
          // Si no hay participantes SST para un chat tipo 'sst', añadirlos
          if (data.type === 'sst' && !participantes.some(p => p.role_name === 'sst')) {
            // Obtener usuarios SST
            const [sstUsers] = await db.query(`
              SELECT u.id, u.username 
              FROM users u
              JOIN roles r ON u.role_id = r.id
              WHERE r.role_name = 'sst'
              LIMIT 1
            `);
            
            if (sstUsers.length > 0) {
              const sstId = sstUsers[0].id;
              // Añadir participante SST al chat
              await db.query('INSERT IGNORE INTO chat_participantes (chat_id, usuario_id) VALUES (?, ?)', 
                [chatId, sstId]
              );
              
              // Añadir al array de participantes para notificación
              participantes.push({
                usuario_id: sstId,
                username: sstUsers[0].username,
                role_name: 'sst'
              });
              
              console.log('🔧 Participante SST añadido automáticamente:', sstUsers[0]);
            }
          }
    
          console.log('📩 ENVIANDO MENSAJE A PARTICIPANTES:', participantes);
    
          // 7. Enviamos el mensaje a todos los participantes conectados
          for (const participante of participantes) {
            const conexiones = activeConnections.get(participante.usuario_id.toString());
    
            // Si el participante está conectado
            if (conexiones && conexiones.size > 0) {
              // Determinamos si es el remitente con conversión explícita a entero
              const isSender = parseInt(participante.usuario_id) === parseInt(data.userId);
    
              if (isSender) {
                // Solo enviamos status_update al remitente
                conexiones.forEach(clientWs => {
                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                      type: 'status_update',
                      tempId: data.tempId,
                      status: 'delivered',
                      messageId: messageId
                    }));
                    console.log('✅ CONFIRMACIÓN ENVIADA a', remitente.username);
                  }
                });
              } else {
                // Enviamos mensaje completo a otros participantes
                const messageToSend = {
                  id: messageId,
                  chatId: chatId,
                  solicitudId: data.solicitudId,
                  usuario_id: data.userId,
                  username: remitente.username,
                  content: data.content,
                  created_at: timestamp,
                  type: data.type,
                  isSender: false
                };
    
                conexiones.forEach(clientWs => {
                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify(messageToSend));
                    console.log('📥 MENSAJE ENVIADO a', participante.username);
                  }
                });
    
                // 8. Actualizamos el contador de mensajes no leídos para los no remitentes
                await db.query(
                  'UPDATE chat_participantes SET mensajes_no_leidos = mensajes_no_leidos + 1 WHERE chat_id = ? AND usuario_id = ?',
                  [chatId, participante.usuario_id]
                );
                console.log('🔔 CONTADOR ACTUALIZADO para', participante.username);
              }
            } else {
              console.log('⚠️ Usuario no conectado:', participante.username);
            }
          }
        }
      } catch (error) {
        console.error('❌ ERROR EN WEBSOCKET:', {
          mensaje: message.toString(),
          error: error.message,
          stack: error.stack
        });
    
        ws.send(JSON.stringify({
          type: 'error',
          error: 'Error al procesar el mensaje',
          details: error.message
        }));
      }
    });

    ws.on('close', async () => {
        if (ws.userId && activeConnections.has(ws.userId)) {
            const [[usuario]] = await db.query(
                'SELECT username FROM users WHERE id = ?',
                [ws.userId]
            ).catch(() => [[{ username: 'Desconocido' }]]);
            
            activeConnections.get(ws.userId).delete(ws);
            if (activeConnections.get(ws.userId).size === 0) {
                activeConnections.delete(ws.userId);
            }
            
            console.log('👋 DESCONEXIÓN:', {
                usuario: {
                    id: ws.userId,
                    nombre: usuario ? usuario.username : 'Desconocido',
                    rol: ws.role
                },
                conexionesActivas: Object.fromEntries([...activeConnections.entries()].map(
                    ([userId, connections]) => [userId, connections.size]
                )),
                timestamp: new Date().toISOString()
            });
        }
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
        console.log('📊 Actualizando contadores de mensajes no leídos');
        
        // Obtener participantes del chat
        const [participants] = await db.query(
            'SELECT usuario_id FROM chat_participantes WHERE chat_id = ?', 
            [chatId]
        );
        
        console.log('👥 Participantes del chat:', participants);

        // Incrementar contador para otros participantes
        for (const participant of participants) {
            if (parseInt(participant.usuario_id) !== parseInt(message.userId)) {
                await db.query(
                    'UPDATE chat_participantes SET mensajes_no_leidos = mensajes_no_leidos + 1 WHERE chat_id = ? AND usuario_id = ?',
                    [chatId, participant.usuario_id]
                );
                console.log(`✅ Contador incrementado para usuario ${participant.usuario_id}`);
            }
        }
    } catch (error) {
        console.error('❌ Error al actualizar contadores:', error);
    }
}

// Modificación en la ruta para marcar mensajes como leídos
app.post('/api/chat/:solicitudId/:type/mark-read', async (req, res) => {
  try {
    const { solicitudId, type } = req.params;
    let { userId } = req.body;
    
    console.log(`Solicitud de marcar mensajes como leídos recibida:`, {
      solicitudId,
      type,
      userIdEnBody: userId
    });
    
    // Si userId no está en el body, intentar obtenerlo del query string
    if (!userId && req.query.userId) {
      userId = req.query.userId;
      console.log(`Usando userId del query string: ${userId}`);
    }
    
    // Si aún no hay userId, intentar obtenerlo del token JWT si existe
    if (!userId && req.cookies && req.cookies.token) {
      try {
        const token = req.cookies.token;
        const decoded = jwt.verify(token, SECRET_KEY);
        userId = decoded.id;
        console.log(`Usando userId del token JWT: ${userId}`);
      } catch (jwtError) {
        console.error('Error al decodificar token JWT:', jwtError);
      }
    }
    
    console.log(`Marcando mensajes como leídos: solicitud ${solicitudId}, tipo ${type}, usuario ${userId}`);
    
    // Validar los parámetros con mejor mensaje
    if (!solicitudId || !type || !userId) {
      console.error(`❌ ERROR: Parámetros incompletos`, { solicitudId, type, userId });
      return res.status(400).json({ 
        error: 'Parámetros incompletos. Se requiere solicitudId, type y userId',
        details: { 
          solicitudId: solicitudId || 'falta', 
          type: type || 'falta', 
          userId: userId || 'falta'
        }
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
    `, [chatId, userId]);
    
    // Actualizar contador de mensajes no leídos en la tabla chat_participantes
    await db.query(`
      UPDATE chat_participantes
      SET mensajes_no_leidos = 0
      WHERE chat_id = ? AND usuario_id = ?
    `, [chatId, userId]);
    
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
app.post('/api/chat/message/:messageId/status', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { status, userId } = req.body;
    
    if (!messageId || !status || !userId) {
      return res.status(400).json({ error: 'Se requiere messageId, status y userId' });
    }
    
    // Actualizar el estado en la base de datos si es 'read'
    if (status === 'read') {
      await db.query('UPDATE mensajes SET leido = TRUE WHERE id = ?', [messageId]);
    }
    
    // Obtener información del mensaje para enviar la notificación
    const [mensajeRows] = await db.query(`
      SELECT m.chat_id, c.solicitud_id, c.tipo, m.usuario_id 
      FROM mensajes m
      JOIN chats c ON m.chat_id = c.id
      WHERE m.id = ?
    `, [messageId]);
    
    if (mensajeRows.length === 0) {
      return res.status(404).json({ error: 'Mensaje no encontrado' });
    }
    
    const mensaje = mensajeRows[0];
    
    // Enviar notificación de actualización de estado por WebSocket
    const remitente = activeConnections.get(mensaje.usuario_id?.toString());
    if (remitente && remitente.size > 0) {
      const statusUpdate = {
        type: 'status_update',
        messageId: messageId,
        status: status,
        chatType: mensaje.tipo,
        solicitudId: mensaje.solicitud_id
      };
      
      remitente.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(statusUpdate));
        }
      });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error al actualizar estado del mensaje:', error);
    res.status(500).json({ 
      error: 'Error al actualizar estado del mensaje',
      details: error.message 
    });
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