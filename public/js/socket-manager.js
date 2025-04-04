class SocketManager {
    constructor() {
        this.socket = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 3000; // 3 segundos
        this.messageQueue = [];
        this.isConnected = false;
    }

    initialize(userId) {
        if (this.socket) {
            console.log('Socket ya inicializado');
            return;
        }

        this.socket = io({
            reconnection: true,
            reconnectionAttempts: this.maxReconnectAttempts,
            reconnectionDelay: this.reconnectDelay,
            timeout: 20000
        });

        this.setupEventListeners();
        this.authenticate(userId);
    }

    setupEventListeners() {
        this.socket.on('connect', () => {
            console.log('Socket conectado');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.processMessageQueue();
        });

        this.socket.on('disconnect', () => {
            console.log('Socket desconectado');
            this.isConnected = false;
        });

        this.socket.on('reconnect_attempt', (attemptNumber) => {
            console.log(`Intento de reconexión ${attemptNumber}`);
            this.reconnectAttempts = attemptNumber;
        });

        this.socket.on('reconnect_failed', () => {
            console.log('No se pudo reconectar');
            this.isConnected = false;
        });

        this.socket.on('error', (error) => {
            console.error('Error en el socket:', error);
        });

        // Escuchar mensajes nuevos
        this.socket.on('nuevo_mensaje', (mensaje) => {
            this.handleNewMessage(mensaje);
        });
    }

    authenticate(userId) {
        if (this.socket && this.isConnected) {
            this.socket.emit('autenticar', { userId });
        }
    }

    sendMessage(data) {
        if (this.isConnected) {
            this.socket.emit('enviar_mensaje', data);
        } else {
            this.messageQueue.push(data);
        }
    }

    processMessageQueue() {
        while (this.messageQueue.length > 0) {
            const message = this.messageQueue.shift();
            this.sendMessage(message);
        }
    }

    handleNewMessage(mensaje) {
        // Verificar si el chat está abierto para esta conversación
        const chatModal = document.getElementById('chatModal');
        const chatSolicitudId = document.getElementById('chatSolicitudId').textContent;
        
        if (chatModal && !chatModal.classList.contains('hidden') && 
            chatSolicitudId === mensaje.solicitud_id.toString()) {
            // Si el chat está abierto, mostrar el mensaje
            this.displayMessage(mensaje);
        } else {
            // Si el chat está cerrado, mostrar notificación
            this.showNotification(mensaje);
        }
    }

    displayMessage(mensaje) {
        const chatMessages = document.getElementById('chatMessages');
        if (chatMessages) {
            const messageDiv = document.createElement('div');
            messageDiv.className = `chat-message ${mensaje.remitente_id === window.sstUserId ? 'text-right' : 'text-left'}`;
            messageDiv.innerHTML = `
                <div class="message-content ${mensaje.remitente_id === window.sstUserId ? 'bg-blue-100' : 'bg-gray-100'} p-2 rounded-lg inline-block">
                    <p class="text-sm">${mensaje.contenido}</p>
                    <span class="text-xs text-gray-500">${new Date(mensaje.fecha).toLocaleTimeString()}</span>
                </div>
            `;
            chatMessages.appendChild(messageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }

    showNotification(mensaje) {
        if (Notification.permission === "granted") {
            new Notification('Nuevo mensaje', {
                body: mensaje.contenido,
                icon: '/images/notification-icon.png'
            });
        }
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            this.isConnected = false;
        }
    }
}

// Crear instancia global
window.socketManager = new SocketManager(); 