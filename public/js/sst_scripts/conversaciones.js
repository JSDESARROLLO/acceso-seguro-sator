/**
 * Funciones para la gestión de conversaciones (chat) - Vista SST (Parte 1)
 */

// Variables globales para gestión del chat
let socket = null;
let currentSolicitudId = null;
let currentChatType = 'sst'; // Tipo de chat: 'sst' (Analista SST - Contratista) o 'soporte' (Usuario - Soporte)
let isLoading = false;
let oldestMessageId = null;
let isReconnecting = false;
let reconnectAttempts = 0;
let reconnectInterval = null;
let displayedMessages = new Set(); // Conjunto para evitar mensajes duplicados

// Función para obtener el ID del usuario SST
const getSstUserId = () => {
  return window.sstUserId || document.querySelector('[data-sst-user-id]')?.dataset.sstUserId || 
         document.querySelector('meta[name="sst-user-id"]')?.getAttribute('content') || null;
};

// Función para abrir modal de chat
function openChatModal(solicitudId) {
  if (!solicitudId) {
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: 'No se proporcionó ID de solicitud para el chat'
    });
    return;
  }
  
  currentSolicitudId = solicitudId;
  
  // Limpiar chat previo
  document.getElementById('chatMessages').innerHTML = '';
  displayedMessages.clear();
  
  // Mostrar modal
  const chatModal = new bootstrap.Modal(document.getElementById('chatModal'));
  chatModal.show();
  
  // Mostrar información del contratista
  const contratistaInfo = document.querySelector(`tr[data-solicitud-id="${solicitudId}"] td:nth-child(2)`);
  const empresaInfo = document.querySelector(`tr[data-solicitud-id="${solicitudId}"] td:nth-child(1)`);
  
  if (contratistaInfo && empresaInfo) {
    document.querySelectorAll('.contratista-name').forEach(el => {
      el.textContent = contratistaInfo.textContent.trim() + ' (' + empresaInfo.textContent.trim() + ')';
    });
  } else {
    document.querySelectorAll('.contratista-name').forEach(el => {
      el.textContent = `Contratista - Solicitud ${solicitudId}`;
    });
  }
  
  // Establecer título del chat actual
  document.getElementById('chatCurrentContact').textContent = 
    document.querySelector('.contratista-name')?.textContent || 
    `Contratista - Solicitud ${solicitudId}`;
  
  // Resaltar contacto activo
  document.querySelectorAll('.contact-item').forEach(item => {
    if (item.dataset.type === 'contratista') {
      item.classList.add('bg-gray-200');
    } else {
      item.classList.remove('bg-gray-200');
    }
  });
  
  // Inicializar chat
  initChat();
  
  // Cargar contactos
  loadChatContacts();
  
  // Establecer foco en el input
  setTimeout(() => {
    document.getElementById('chatInput').focus();
  }, 500);
  
  // Marcar mensajes como leídos
  markMessagesAsRead(solicitudId, 'sst');
}

// Retardo para reconexión exponencial
function getReconnectDelay() {
  // Comenzar con 1 segundo y aumentar exponencialmente hasta un máximo de 30 segundos
  const maxDelay = 30000;
  const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), maxDelay);
  return delay;
}

// Manejar errores de WebSocket
function handleWebSocketError() {
  console.warn(`Error de WebSocket. Intento ${reconnectAttempts + 1}`);
  
  if (!isReconnecting) {
    isReconnecting = true;
    
    // Mostrar indicador de reconexión
    const chatMessages = document.getElementById('chatMessages');
    const reconnectMessage = document.createElement('div');
    reconnectMessage.className = 'reconnect-message text-center my-2 p-2 bg-warning text-dark rounded';
    reconnectMessage.innerHTML = 'Conexión perdida. Reconectando...';
    reconnectMessage.id = 'reconnectMessage';
    
    // Solo agregar si no existe ya
    if (!document.getElementById('reconnectMessage')) {
      chatMessages.appendChild(reconnectMessage);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  }
  
  // Incrementar conteo de intentos
  reconnectAttempts++;
  
  // Programar reconexión
  const delay = getReconnectDelay();
  clearTimeout(reconnectInterval);
  
  reconnectInterval = setTimeout(() => {
    if (socket) {
      // Cerrar socket previo si existe
      try {
        socket.close();
      } catch (e) {
        console.error('Error al cerrar socket previo:', e);
      }
    }
    
    // Reiniciar conexión
    initChat();
  }, delay);
}

// Comprobar si un mensaje contiene un archivo adjunto
function hasAttachment(message) {
  try {
    let content = message.content;
    
    // Intentar parse si es un string
    if (typeof content === 'string') {
      try {
        content = JSON.parse(content);
      } catch (e) {
        return false;
      }
    }
    
    return content && content.attachment && 
           (content.attachment.url || content.attachment.name || content.attachment.type);
  } catch (e) {
    return false;
  }
}

// Mostrar notificación de escritorio
function showDesktopNotification(message) {
  // Verificar si el navegador soporta notificaciones
  if (!('Notification' in window)) {
    return;
  }
  
  // Verificar si el mensaje es del usuario actual
  const userId = getSstUserId();
  if (parseInt(message.usuario_id) === parseInt(userId)) {
    return; // No notificar mensajes propios
  }
  
  // No mostrar notificación si la ventana está activa y el chat está abierto
  if (document.visibilityState === 'visible' && document.getElementById('chatModal').classList.contains('show')) {
    return;
  }
  
  // Verificar permiso
  if (Notification.permission === 'granted') {
    createNotification(message);
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        createNotification(message);
      }
    });
  }
}

// Crear notificación
function createNotification(message) {
  try {
    let messageContent = '';
    let senderName = '';
    
    // Extraer contenido del mensaje
    try {
      if (typeof message.content === 'string') {
        try {
          const parsedContent = JSON.parse(message.content);
          messageContent = parsedContent.text || message.content;
        } catch (e) {
          messageContent = message.content;
        }
      } else if (typeof message.content === 'object') {
        messageContent = message.content.text || JSON.stringify(message.content);
      }
    } catch (e) {
      messageContent = 'Nuevo mensaje';
    }
    
    // Detectar tipo de chat para mostrar remitente
    if (currentChatType === 'sst') {
      senderName = 'Contratista';
    } else if (currentChatType === 'soporte') {
      senderName = 'Soporte Técnico';
    } else {
      senderName = message.username || 'Usuario';
    }
    
    // Crear y mostrar notificación
    const notification = new Notification('Nuevo mensaje de ' + senderName, {
      body: messageContent.substring(0, 100) + (messageContent.length > 100 ? '...' : ''),
      icon: '/img/logo.png'
    });
    
    // Al hacer clic, enfocar la ventana y mostrar el chat
    notification.onclick = function() {
      window.focus();
      document.getElementById('chatModal').classList.add('show');
    };
    
    // Cerrar automáticamente después de 5 segundos
    setTimeout(() => {
      notification.close();
    }, 5000);
  } catch (error) {
    console.error('Error al crear notificación:', error);
  }
}

// Función para abrir el chat de soporte global
window.openSoporteChat = async () => {
  try {
    currentChatType = 'soporte';
    sentMessages.clear();
    displayedMessages.clear();

    const modalElement = document.getElementById('chatModal');
    if (!modalElement) throw new Error('No se encontró el modal de chat');
    modalElement.style.display = 'flex';
    modalElement.classList.remove('hidden');

    const userId = getSstUserId();
    if (!userId) throw new Error('No se pudo obtener ID de usuario');

    // Inicializar chat de soporte
    await fetch('/api/chat/iniciar/global/soporte', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    }).catch(err => console.warn('Error al inicializar chat Soporte:', err));

    // Cargar información del contratista para las solicitudes actuales
    loadChatContacts();

    // Activar el contacto de soporte por defecto
    document.querySelectorAll('.contact-item').forEach(item => {
      item.classList.remove('bg-gray-200');
      if (item.dataset.type === 'soporte') {
        item.classList.add('bg-gray-200');
        document.getElementById('chatCurrentContact').textContent = 'Soporte Técnico';
      }
    });

    if (socket?.readyState === WebSocket.OPEN) socket.close();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

    socket.onopen = () => {
      socket.send(JSON.stringify({
        type: 'identify',
        userId,
        role: 'sst',
        solicitudId: 'global'
      }));
    };

    socket.onmessage = (event) => {
      console.log('Received WebSocket message:', event.data);
      const message = JSON.parse(event.data);
      if (message.type === 'identify_confirmation') return;

      if (message.type === 'status_update') {
        const { tempId, status, messageId } = message;
        const existing = document.querySelector(`.chat-message[data-message-id="${tempId}"]`);
        if (existing) {
          existing.dataset.messageId = messageId;
          updateMessageStatus(messageId, status);
          sentMessages.set(tempId, messageId);
          displayedMessages.add(messageId);
        }
        return;
      }

      if (message.type === 'message') {
        if (!displayedMessages.has(message.id)) {
          displayMessage(message);
          if (message.usuario_id !== getSstUserId()) {
            markMessageAsRead(message.id);
          }
        }
        return;
      }
    };

    socket.onerror = (error) => {
      console.error('WebSocket Error:', error);
      Swal.fire({
        icon: 'error',
        title: 'Error de conexión',
        text: 'No se pudo establecer conexión con el servidor de chat'
      });
    };

    const chatMessages = document.getElementById('chatMessages');
    chatMessages.addEventListener('scroll', scrollHandler);

    const loadedMessages = await loadInitialMessagesWithRetry('global', 'soporte', getSstUserId());
    chatMessages.innerHTML = loadedMessages.length === 0 ? 
      '<div class="text-center text-gray-500 p-4">No hay mensajes. Escribe para comenzar.</div>' : '';
    
    loadedMessages.forEach(displayMessage);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    await markMessagesAsRead('global', 'soporte');
  } catch (error) {
    console.error('Error al abrir el chat:', error);
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: 'No se pudo iniciar el chat: ' + error.message
    });
  }
};

// Función para abrir el modal de chat y cargar los mensajes para una solicitud específica
function openChatModalSST(solicitudId) {
  try {
    currentSolicitudId = solicitudId;
    currentChatType = 'sst';
    
    // Limpiar mensajes anteriores
    document.getElementById('chatMessages').innerHTML = `
      <div class="text-center my-4">
        <div class="spinner-border text-primary" role="status">
          <span class="sr-only">Cargando...</span>
        </div>
        <p class="mt-2">Cargando mensajes...</p>
      </div>
    `;
    
    // Abrir el modal de manera asíncrona para evitar conflictos
    setTimeout(() => {
      // Usando jQuery para mostrar el modal de Bootstrap
      $('#chatModal').modal('show');
      
      // Focus en el campo de texto una vez que el modal esté visible
      $('#chatModal').on('shown.bs.modal', function() {
        $('#chatInput').trigger('focus');
      });
    }, 100);
    
    // Obtener los datos del contratista de la solicitud seleccionada
    const row = document.querySelector(`#solicitudesTable tbody tr .open-chat-btn[data-solicitud-id="${solicitudId}"]`)?.closest('tr');
    if (row) {
      const empresa = row.cells[1]?.textContent.trim() || '';
      const contratista = row.cells[2]?.textContent.trim() || '';
      
      // Actualizar título con el nombre del contratista
      const titulo = contratista + (empresa ? ` (${empresa})` : '');
      document.querySelectorAll('.contratista-name').forEach(el => {
        el.textContent = titulo;
      });
      
      // Cambiar el contacto activo a Contratista
      const contactoContratista = document.querySelector('.contact-item[data-type="contratista"]');
      if (contactoContratista) {
        // Remover clase active de todos los contactos
        document.querySelectorAll('.contact-item').forEach(item => {
          item.classList.remove('active');
        });
        // Agregar clase active al contacto seleccionado
        contactoContratista.classList.add('active');
      }
    }
    
    // Cargar contactos
    loadChatContacts();
    
    // Inicializar chat via WebSocket
    initChat();
    
    // Cargar mensajes existentes
    loadChatMessages();
  } catch (error) {
    console.error('Error al abrir el modal de chat:', error);
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: 'Hubo un problema al abrir el chat. Por favor intente nuevamente.'
    });
  }
} 