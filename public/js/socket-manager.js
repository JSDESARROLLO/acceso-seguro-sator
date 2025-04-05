class SocketManager {
    constructor() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        this.socket = io(`${protocol}//${host}`, {
            transports: ['websocket'],
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000
        });

        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 3000; // 3 segundos
        this.messageQueue = [];
        this.isConnected = false;
    }

    initialize() {
        this.socket.on('connect', () => {
            console.log('✅ Socket conectado');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.processMessageQueue();
        });

        this.socket.on('connect_error', (error) => {
            console.error('❌ Error de conexión Socket:', error);
        });

        this.socket.on('disconnect', (reason) => {
            console.log('⚠️ Socket desconectado:', reason);
            this.isConnected = false;
            this.attemptReconnect();
        });

        this.socket.on('message', (message) => {
            try {
                if (message.type === 'nuevo_mensaje') {
                    this.handleNewMessage(message);
                }
            } catch (error) {
                console.error('Error al procesar mensaje:', error);
            }
        });
    }

    attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`Intento de reconexión ${this.reconnectAttempts}`);
            setTimeout(() => {
                this.initialize();
            }, this.reconnectDelay);
        } else {
            console.log('No se pudo reconectar');
        }
    }

    authenticate(userId) {
        if (this.socket && this.socket.connected) {
            this.socket.emit('identify', {
                userId: userId
            });
        }
    }

    sendMessage(data) {
        if (this.isConnected && this.socket.connected) {
            this.socket.emit('message', data);
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
        const chatModal = document.getElementById('chatModal');
        const chatSolicitudId = document.getElementById('chatSolicitudId')?.textContent;
        
        if (chatModal && !chatModal.classList.contains('hidden') && 
            chatSolicitudId === mensaje.solicitud_id?.toString()) {
            this.displayMessage(mensaje);
        } else {
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
        }
    }
}

// Crear instancia global
window.socketManager = new SocketManager(); 