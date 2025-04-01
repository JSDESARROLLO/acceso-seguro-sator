const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const db = require('../db/db');
const jwt = require('jsonwebtoken');
const { S3Client } = require('@aws-sdk/client-s3');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Configuración de DigitalOcean Spaces con AWS SDK v3
const s3Client = new S3Client({
  endpoint: `https://${process.env.DO_SPACES_ENDPOINT}`,
  region: process.env.DO_SPACES_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET
  }
});

// Configuración de CORS
app.use(cors({
  origin: process.env.DOMAIN_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));
// Cambiar /uploads por acceso a DigitalOcean Spaces (ruta estática no necesaria, se manejará por API)

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

const capacitacionRoutes = require('../routes/capacitacion.routes');
const uploadRoutes = require('../routes/upload.routes');
const chatRoutes = require('../routes/chat.routes');
const solicitudRoutes = require('../routes/solicitud.routes');

app.use('/capacitacion', capacitacionRoutes);
app.use('/', uploadRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api', solicitudRoutes);

// Ruta para servir archivos desde DigitalOcean Spaces
app.get('/spaces/:key', async (req, res) => {
  const { key } = req.params;
  const params = {
    Bucket: process.env.DO_SPACES_BUCKET,
    Key: key
  };

  try {
    const url = await s3Client.send(new GetObjectCommand(params));
    res.redirect(url);
  } catch (error) {
    console.error('Error al obtener archivo de DigitalOcean Spaces:', error);
    res.status(500).json({ error: 'Error al obtener archivo' });
  }
});

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
const activeConnections = new Map();

wss.on('connection', async (ws, req) => {
  ws.isAlive = true;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      console.log('📨 Mensaje WebSocket recibido:', data);

      if (data.type === 'identify') {
        if (!data.userId || data.userId === 'undefined') {
          console.error('❌ ERROR: userId no válido en identify:', data);
          ws.send(JSON.stringify({
            type: 'error',
            error: 'ID de usuario no válido'
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

        const [usuarios] = await db.query(
          'SELECT username, role_id FROM users WHERE id = ?',
          [data.userId]
        );

        if (usuarios.length === 0) {
          console.error(`❌ ERROR: Usuario con ID ${data.userId} no encontrado`);
          ws.send(JSON.stringify({
            type: 'error',
            error: 'Usuario no encontrado'
          }));
          return;
        }

        console.log('🔌 CONEXIÓN WEBSOCKET:', {
          usuario: { id: ws.userId, nombre: usuarios[0].username, rol: ws.role },
          solicitud: ws.solicitudId,
          timestamp: new Date().toISOString()
        });

        ws.send(JSON.stringify({
          type: 'identify_confirmation',
          status: 'success',
          userId: data.userId,
          role: data.role
        }));
        return;
      }

      if (!ws.userId || ws.userId === 'undefined') {
        console.error('❌ ERROR: Intento de enviar mensaje sin identificación:', data);
        ws.send(JSON.stringify({
          type: 'error',
          error: 'Usuario no identificado'
        }));
        return;
      }

      if (data.type === 'sst' || data.type === 'contratista' || data.type === 'interventor' || data.type === 'soporte') {
        const [[remitente]] = await db.query(
          'SELECT username, role_id FROM users WHERE id = ?',
          [data.userId]
        );
        if (!remitente) throw new Error(`Usuario con ID ${data.userId} no encontrado`);

        const [[solicitud]] = await db.query(`
          SELECT s.*, uc.id as contratista_id, uc.username as contratista_nombre,
                 ui.id as interventor_id, ui.username as interventor_nombre
          FROM solicitudes s 
          JOIN users uc ON s.usuario_id = uc.id 
          LEFT JOIN users ui ON s.interventor_id = ui.id
          WHERE s.id = ?
        `, [data.solicitudId]);
        if (!solicitud) throw new Error(`Solicitud con ID ${data.solicitudId} no encontrada`);

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

          const participantes = [];
          participantes.push({
            id: solicitud.contratista_id,
            nombre: solicitud.contratista_nombre,
            rol: 'contratista'
          });

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
          } else if (data.type === 'soporte') {
            const [soporteUsers] = await db.query(`
              SELECT u.id, u.username 
              FROM users u
              JOIN roles r ON u.role_id = r.id
              WHERE r.role_name = 'soporte'
              LIMIT 1
            `);
            if (soporteUsers.length > 0) {
              participantes.push({
                id: soporteUsers[0].id,
                nombre: soporteUsers[0].username,
                rol: 'soporte'
              });
            } else {
              participantes.push({
                id: data.userId,
                nombre: remitente.username,
                rol: 'soporte'
              });
            }
          }

          for (const participante of participantes) {
            await db.query(
              'INSERT IGNORE INTO chat_participantes (chat_id, usuario_id) VALUES (?, ?)',
              [chatId, participante.id]
            );
          }
        } else {
          chatId = existingChat.id;
        }

        const [messageResult] = await db.query(
          'INSERT INTO mensajes (chat_id, usuario_id, contenido, leido) VALUES (?, ?, ?, FALSE)',
          [chatId, data.userId, JSON.stringify({ text: data.content, timestamp: new Date().toISOString() })]
        );

        const messageId = messageResult.insertId;
        const timestamp = new Date().toISOString();

        const [participantes] = await db.query(
          `SELECT cp.usuario_id, u.username, r.role_name
           FROM chat_participantes cp 
           JOIN users u ON cp.usuario_id = u.id 
           LEFT JOIN roles r ON u.role_id = r.id
           WHERE cp.chat_id = ?`,
          [chatId]
        );

        if (data.type === 'soporte' && !participantes.some(p => p.role_name === 'soporte')) {
          const [soporteUsers] = await db.query(`
            SELECT u.id, u.username 
            FROM users u
            JOIN roles r ON u.role_id = r.id
            WHERE r.role_name = 'soporte'
            LIMIT 1
          `);
          if (soporteUsers.length > 0) {
            await db.query('INSERT IGNORE INTO chat_participantes (chat_id, usuario_id) VALUES (?, ?)', 
              [chatId, soporteUsers[0].id]
            );
            participantes.push({
              usuario_id: soporteUsers[0].id,
              username: soporteUsers[0].username,
              role_name: 'soporte'
            });
          }
        }

        for (const participante of participantes) {
          const conexiones = activeConnections.get(participante.usuario_id.toString());
          if (conexiones && conexiones.size > 0) {
            const isSender = parseInt(participante.usuario_id) === parseInt(data.userId);
            if (isSender) {
              conexiones.forEach(clientWs => {
                if (clientWs.readyState === WebSocket.OPEN) {
                  clientWs.send(JSON.stringify({
                    type: 'status_update',
                    tempId: data.tempId,
                    status: 'delivered',
                    messageId: messageId
                  }));
                }
              });
            } else {
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
                }
              });
              await db.query(
                'UPDATE chat_participantes SET mensajes_no_leidos = mensajes_no_leidos + 1 WHERE chat_id = ? AND usuario_id = ?',
                [chatId, participante.usuario_id]
              );
            }
          }
        }
      }
    } catch (error) {
      console.error('❌ ERROR EN WEBSOCKET:', { mensaje: message.toString(), error: error.message });
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Error al procesar el mensaje',
        details: error.message
      }));
    }
  });

  ws.on('close', async () => {
    if (!ws.userId) return;

    const [[usuario]] = await db.query(
      'SELECT username FROM users WHERE id = ?',
      [ws.userId]
    ).catch(() => [[{ username: 'Desconocido' }]]);

    if (activeConnections.has(ws.userId)) {
      activeConnections.get(ws.userId).delete(ws);
      if (activeConnections.get(ws.userId).size === 0) {
        activeConnections.delete(ws.userId);
      }
    }

    console.log('👋 DESCONEXIÓN:', {
      usuario: { id: ws.userId, nombre: usuario ? usuario.username : 'Desconocido', rol: ws.role },
      conexionesActivas: Object.fromEntries([...activeConnections.entries()].map(
        ([userId, connections]) => [userId, connections.size]
      )),
      timestamp: new Date().toISOString()
    });
  });
});

async function saveMessageToDatabase(message) {
  try {
    let chatId;
    const [chatRows] = await db.query('SELECT id FROM chats WHERE solicitud_id = ? AND tipo = ?', [message.solicitudId, message.type]);
    if (chatRows.length === 0) {
      const [result] = await db.query('INSERT INTO chats (solicitud_id, tipo) VALUES (?, ?)', [message.solicitudId, message.type]);
      chatId = result.insertId;

      const [solicitud] = await db.query('SELECT usuario_id, interventor_id FROM solicitudes WHERE id = ?', [message.solicitudId]);
      if (solicitud.length === 0) throw new Error(`Solicitud con ID ${message.solicitudId} no encontrada`);

      const contratistaId = solicitud[0].usuario_id;
      const interventorId = solicitud[0].interventor_id;

      let additionalParticipantId = null;
      if (message.type === 'sst') {
        const [sstUsers] = await db.query(`
          SELECT u.id FROM users u
          JOIN roles r ON u.role_id = r.id
          WHERE r.role_name = 'sst' LIMIT 1
        `);
        additionalParticipantId = sstUsers.length > 0 ? sstUsers[0].id : null;
      } else if (message.type === 'interventor') {
        additionalParticipantId = interventorId;
      } else if (message.type === 'soporte') {
        const [soporteUsers] = await db.query(`
          SELECT u.id FROM users u
          JOIN roles r ON u.role_id = r.id
          WHERE r.role_name = 'soporte' LIMIT 1
        `);
        additionalParticipantId = soporteUsers.length > 0 ? soporteUsers[0].id : message.userId;
      }

      const participants = [contratistaId, additionalParticipantId].filter(id => id);
      for (const userId of participants) {
        await db.query('INSERT IGNORE INTO chat_participantes (chat_id, usuario_id) VALUES (?, ?)', [chatId, userId]);
      }
    } else {
      chatId = chatRows[0].id;
    }

    const timestamp = message.timestamp ? new Date(message.timestamp) : new Date();
    const formattedTimestamp = timestamp.toISOString().slice(0, 19).replace('T', ' ');

    let contenidoMsg;
    if (typeof message.content === 'string') {
      contenidoMsg = JSON.stringify({ text: message.content, timestamp: timestamp.toISOString() });
    } else {
      contenidoMsg = JSON.stringify({ ...message.content, timestamp: timestamp.toISOString() });
    }

    const [result] = await db.query(
      'INSERT INTO mensajes (chat_id, usuario_id, contenido, leido, created_at) VALUES (?, ?, ?, FALSE, ?)',
      [chatId, message.userId || 1, contenidoMsg, formattedTimestamp]
    );

    message.id = result.insertId;
    message.created_at = timestamp.toISOString();
    return chatId;
  } catch (error) {
    console.error('Error al guardar mensaje:', error);
    throw error;
  }
}

const PORT = process.env.PORT || 3900;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en http://0.0.0.0:${PORT}`);
});