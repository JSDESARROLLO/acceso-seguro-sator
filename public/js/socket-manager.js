class SocketManager {
    constructor() {
        this.socket = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
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
            console.log('✅ Socket conectado');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.processMessageQueue();
        };

        this.socket.onclose = () => {
            console.log('⚠️ Socket desconectado');
            this.isConnected = false;
            this.attemptReconnect();
        };

        this.socket.onerror = (error) => {
            console.error('❌ Error en el socket:', error);
        };

        this.socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.type === 'nuevo_mensaje') {
                    this.handleNewMessage(message);
                } else if (message.type === 'identify_confirmation') {
                    console.log('✅ Identificación confirmada:', message);
                } else if (message.type === 'error') {
                    console.error('❌ Error del servidor:', message.error);
                }
            } catch (error) {
                console.error('Error al procesar mensaje:', error);
            }
        };
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

    attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`Intento de reconexión ${this.reconnectAttempts}`);
            setTimeout(() => {
                this.initialize(window.sstUserId);
            }, this.reconnectDelay);
        } else {
            console.error('❌ Máximo número de intentos de reconexión alcanzado');
        }
    }

    handleNewMessage(message) {
        // Implementar lógica para manejar nuevos mensajes
        console.log('📨 Nuevo mensaje recibido:', message);
    }

    disconnect() {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
            this.isConnected = false;
        }
    }
}

// Exportar la clase al objeto window
window.socketManager = new SocketManager(); 