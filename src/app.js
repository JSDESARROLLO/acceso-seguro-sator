const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const db = require('../db/db');
const jwt = require('jsonwebtoken');
const { S3Client } = require('@aws-sdk/client-s3');
const helmet = require('helmet');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Configuración de seguridad con helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdn.tailwindcss.com", "https:", "'unsafe-eval'"],
      scriptSrcAttr: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "cdn.tailwindcss.com", "https:"],
      imgSrc: ["'self'", "data:", "https:", "https://gestion-contratistas-os.nyc3.digitaloceanspaces.com"],
      connectSrc: ["'self'", "https:", "wss:", "ws:"],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      workerSrc: ["'self'", "blob:"],
      upgradeInsecureRequests: []
    }
  },
  crossOriginEmbedderPolicy: { policy: "credentialless" },
  crossOriginOpenerPolicy: { policy: "same-origin" },
  crossOriginResourcePolicy: { policy: "same-site" },
  dnsPrefetchControl: true,
  frameguard: { action: 'deny' },
  hidePoweredBy: true,
  hsts: { 
    maxAge: 31536000, 
    includeSubDomains: true, 
    preload: true 
  },
  ieNoOpen: true,
  noSniff: true,
  originAgentCluster: true,
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xssFilter: true
}));

// Agregar cabeceras de seguridad adicionales
app.use((req, res, next) => {
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Download-Options', 'noopen');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Permissions-Policy', 
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()'
  );
  next();
});

// Forzar HTTPS
app.use((req, res, next) => {
  if (!req.secure && req.get('x-forwarded-proto') !== 'https' && process.env.NODE_ENV === 'production') {
    return res.redirect('https://' + req.get('host') + req.url);
  }
  next();
});

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
  origin: function(origin, callback) {
    // Permitir solicitudes sin origen (como mobile apps o curl)
    if (!origin) {
      console.log('🔍 CORS: Solicitud sin origen (probablemente mobile app)');
      return callback(null, true);
    }
    
    // Lista de orígenes permitidos
    const allowedOrigins = [
      'http://localhost:8100',  // Desarrollo local
      process.env.DOMAIN_URL,   // URL de producción
      'capacitor://localhost',  // Para aplicaciones móviles con Capacitor
      'ionic://localhost'       // Para aplicaciones móviles con Ionic
    ];
    
    console.log('🔍 CORS: Verificando origen:', {
      origen: origin,
      allowedOrigins: allowedOrigins,
      DOMAIN_URL: process.env.DOMAIN_URL,
      NODE_ENV: process.env.NODE_ENV
    });
    
    // Verificar si el origen está en la lista de permitidos
    if (allowedOrigins.includes(origin)) {
      console.log('✅ CORS: Origen permitido:', origin);
      callback(null, true);
    } else {
      // En producción, permitir tanto el dominio con www como sin www
      if (process.env.NODE_ENV === 'production' && process.env.DOMAIN_URL) {
        const domainUrl = new URL(process.env.DOMAIN_URL);
        const domainHostname = domainUrl.hostname;
        const originHostname = new URL(origin).hostname;
        
        // Permitir tanto el dominio con www como sin www
        if (originHostname === domainHostname || 
            originHostname === `www.${domainHostname}` || 
            `www.${originHostname}` === domainHostname) {
          console.log('✅ CORS: Dominio permitido:', origin);
          callback(null, true);
          return;
        }
      }
      
      console.error('❌ CORS: Origen no permitido:', {
        origin: origin,
        allowedOrigins: allowedOrigins,
        DOMAIN_URL: process.env.DOMAIN_URL,
        NODE_ENV: process.env.NODE_ENV
      });
      callback(new Error(`Origen no permitido por CORS: ${origin}`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true,
  optionsSuccessStatus: 200
}));

// Middleware para logging de errores CORS
app.use((err, req, res, next) => {
  if (err.message.includes('CORS')) {
    console.error('❌ Error CORS:', {
      error: err.message,
      origin: req.headers.origin,
      method: req.method,
      url: req.url,
      headers: req.headers
    });
    res.status(403).json({
      error: 'Error de CORS',
      message: err.message,
      origin: req.headers.origin,
      allowedOrigins: [
        'http://localhost:8100',
        process.env.DOMAIN_URL,
        'capacitor://localhost',
        'ionic://localhost'
      ]
    });
  } else {
    next(err);
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));
// Cambiar /uploads por acceso a DigitalOcean Spaces (ruta estática no necesaria, se manejará por API)

// Configuración del motor de vistas
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Rutas públicas
app.use(require('../routes/index.routes'));
app.use(require('../routes/register.routes'));
app.use('/capacitacion', require('../routes/capacitacion.routes'));

// Middleware de autenticación
app.use(require('../middleware/auth.middleware'));

// Rutas protegidas
app.use(require('../routes/contratista.routes'));
app.use(require('../routes/interventor.routes'));
app.use(require('../routes/sst.routes'));
app.use(require('../routes/seguridad.routes'));

const uploadRoutes = require('../routes/upload.routes');
const chatRoutes = require('../routes/chat.routes');
const solicitudRoutes = require('../routes/solicitud.routes');

app.use('/', uploadRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api', solicitudRoutes);

// Importar rutas de seguridad móvil
const seguridadAppMovilRoutes = require('../routes/seguridadAppMovil.routes');

// Usar rutas de seguridad móvil
app.use('/seguridad-app', seguridadAppMovilRoutes); 


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

        // Manejo especial para chat global de soporte
        if (data.solicitudId === 'global' && data.type === 'soporte') {
          let chatId;
          const [[existingChat]] = await db.query(
            'SELECT id FROM chats WHERE solicitud_id = ? AND tipo = ?',
            ['global-' + data.userId, 'soporte']
          );

          if (!existingChat) {
            const [createResult] = await db.query(
              'INSERT INTO chats (solicitud_id, tipo, metadatos) VALUES (?, ?, ?)',
              ['global-' + data.userId, 'soporte', JSON.stringify({
                created_by: data.userId,
                created_at: new Date().toISOString(),
                is_global: true
              })]
            );
            chatId = createResult.insertId;

            // Obtener usuarios de soporte
            const [soporteUsers] = await db.query(`
              SELECT u.id FROM users u
              JOIN roles r ON u.role_id = r.id
              WHERE r.role_name = 'soporte' LIMIT 1
            `);
            
            // Agregar participantes
            await db.query('INSERT INTO chat_participantes (chat_id, usuario_id) VALUES (?, ?)', [chatId, data.userId]);
            
            if (soporteUsers.length > 0) {
              await db.query('INSERT INTO chat_participantes (chat_id, usuario_id) VALUES (?, ?)', [chatId, soporteUsers[0].id]);
            }
          } else {
            chatId = existingChat.id;
          }

          // Guardar el mensaje
          const contentJson = typeof data.content === 'string' ? data.content : JSON.stringify({ text: data.content });
          const [messageResult] = await db.query(
            'INSERT INTO mensajes (chat_id, usuario_id, contenido, created_at) VALUES (?, ?, ?, ?)',
            [chatId, data.userId, contentJson, data.timestamp || new Date().toISOString()]
          );
          const messageId = messageResult.insertId;

          // Actualizar contadores de mensajes no leídos para todos los participantes excepto el remitente
          await db.query(`
            UPDATE chat_participantes
            SET mensajes_no_leidos = mensajes_no_leidos + 1
            WHERE chat_id = ? AND usuario_id != ?
          `, [chatId, data.userId]);

          // Enviar confirmación al remitente
          ws.send(JSON.stringify({
            type: 'status_update',
            tempId: data.tempId,
            status: 'delivered',
            messageId: messageId
          }));

          // Difundir mensaje a todos los clientes conectados que pertenezcan al chat
          const [participantes] = await db.query(
            'SELECT usuario_id FROM chat_participantes WHERE chat_id = ?',
            [chatId]
          );

          // Preparar el mensaje para difusión
          const broadcastMessage = {
            type: 'message',
            id: messageId,
            chatId: chatId,
            solicitudId: 'global-' + data.userId,
            usuario_id: data.userId,
            username: remitente.username,
            content: typeof data.content === 'object' ? data.content : { text: data.content },
            created_at: data.timestamp || new Date().toISOString(),
            type: 'soporte'
          };

          // Enviar a todos los clientes conectados que sean participantes
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && 
                client.userId && 
                participantes.some(p => p.usuario_id == client.userId) &&
                client !== ws) {
              client.send(JSON.stringify(broadcastMessage));
            }
          });

          return;
        }

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
            // Para chats de soporte, solo agregamos al usuario de soporte
            // El usuario contratista ya está agregado automáticamente antes
            const [soporteUsers] = await db.query(`
              SELECT u.id, u.username 
              FROM users u
              JOIN roles r ON u.role_id = r.id
              WHERE r.role_name = 'soporte'
              LIMIT 1
            `);
            if (soporteUsers.length > 0) {
              // Solo agregamos el usuario de soporte, ya que el contratista ya fue agregado
              participantes = []; // Limpiamos la lista que tenía al contratista
              participantes.push({
                id: solicitud.contratista_id,
                nombre: solicitud.contratista_nombre,
                rol: 'contratista'
              });
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
        // Para chat de soporte, solo agregamos al usuario de soporte y al contratista
        additionalParticipantId = soporteUsers.length > 0 ? soporteUsers[0].id : message.userId;
        // Limpiamos la tabla de participantes para asegurarnos que no haya otros roles como SST
        await db.query('DELETE FROM chat_participantes WHERE chat_id = ?', [chatId]);
        await db.query('INSERT IGNORE INTO chat_participantes (chat_id, usuario_id) VALUES (?, ?), (?, ?)', 
          [chatId, contratistaId, chatId, additionalParticipantId]);
        // Saltamos el bucle genérico de participantes
        return chatId;
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

// Agregar ruta para favicon.ico
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/img/favicon.ico'));
});

const PORT = process.env.PORT || 3900;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});