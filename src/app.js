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

            // Guardar el mensaje en la base de datos
            const chatId = await saveMessageToDatabase({...message, userId});

            // Actualizar mensajes no leídos para los participantes
            await updateUnreadCount(chatId, message);

            // Añadir timestamp al mensaje
            message.created_at = new Date().toISOString();
            
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
                            usuario_id: userId,
                            content: contenidoParaEnviar,
                            leido: false,
                            created_at: message.created_at,
                            solicitudId: message.solicitudId,
                            type: message.type,
                            isSender: false // Nunca será el remitente porque ya excluimos a ws
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

        // AQUÍ ESTÁ EL CAMBIO CLAVE: Asegurar que el contenido sea un JSON válido
        let contenidoMsg;
        if (typeof message.content === 'string') {
            // Si es una cadena, convertirla a un objeto JSON
            contenidoMsg = JSON.stringify({ text: message.content });
        } else if (typeof message.content === 'object') {
            // Si ya es un objeto, simplemente serializarlo
            contenidoMsg = JSON.stringify(message.content);
        } else {
            // Para otros casos, crear un objeto con el contenido
            contenidoMsg = JSON.stringify({ value: message.content });
        }

        // Insertar el mensaje en la tabla 'mensajes'
        const [result] = await db.query(
            'INSERT INTO mensajes (chat_id, usuario_id, contenido, leido, created_at) VALUES (?, ?, ?, FALSE, NOW())',
            [chatId, message.userId || 1, contenidoMsg]
        );

        message.id = result.insertId; // Agregar el ID al mensaje para enviarlo al cliente
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

// Iniciar servidor
const PORT = 3900;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});