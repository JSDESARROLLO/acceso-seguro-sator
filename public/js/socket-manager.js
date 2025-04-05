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

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

        this.setupEventListeners();
        this.authenticate(userId);
    }

    setupEventListeners() {
        this.socket.onopen = () => {
            console.log('Socket conectado');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.processMessageQueue();
        };

        this.socket.onclose = () => {
            console.log('Socket desconectado');
            this.isConnected = false;
            this.attemptReconnect();
        };

        this.socket.onerror = (error) => {
            console.error('Error en el socket:', error);
        };

        this.socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.type === 'nuevo_mensaje') {
                    this.handleNewMessage(message);
                }
            } catch (error) {
                console.error('Error al procesar mensaje:', error);
            }
        };
    }

    attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`Intento de reconexión ${this.reconnectAttempts}`);
            setTimeout(() => {
                this.initialize(window.sstUserId);
            }, this.reconnectDelay);
        } else {
            console.log('No se pudo reconectar');
        }
    }

    authenticate(userId) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: 'identify',
                userId: userId
            }));
        }
    }

    sendMessage(data) {
        if (this.isConnected && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: 'message',
                ...data
            }));
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
            this.socket.close();
            this.socket = null;
            this.isConnected = false;
        }
    }
}

// Crear instancia global
window.socketManager = new SocketManager(); 