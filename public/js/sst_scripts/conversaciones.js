/**
 * Funciones para la gestión de conversaciones (chat) - Vista SST
 */

// Variables globales
let socket;
let currentSolicitudId;
let currentChatType = 'sst';
let displayedMessages = new Set();
let sentMessages = new Map();
let isLoadingMore = false;
let oldestMessageId = null;
let reconnectAttempts = 0;
let maxReconnectAttempts = 5;
let reconnectTimeout = null;

// Función para obtener el ID del usuario SST
function getSstUserId() {
  const metaTag = document.querySelector('meta[name="sst-user-id"]');
  return metaTag ? metaTag.content : window.sstUserId;
}

// Función para cargar un tipo de chat específico
async function loadChat(chatType) {
  try {
    console.log('🔄 Cargando chat tipo:', chatType);
    
    if (!currentSolicitudId) {
      console.error('❌ No hay solicitud activa');
    return;
  }
  
    currentChatType = chatType;
    const userId = getSstUserId();

    if (!userId) {
      console.error('❌ No se pudo obtener el ID del usuario');
      return;
    }

    // Limpiar mensajes anteriores
    displayedMessages.clear();
    const chatMessages = document.getElementById('chatMessages');
    chatMessages.innerHTML = '<div class="text-center"><div class="spinner-border text-primary" role="status"></div></div>';

    // Cargar mensajes
    const messages = await loadInitialMessagesWithRetry(currentSolicitudId, chatType, userId);
    console.log('✅ Mensajes obtenidos:', messages.length);

    // Limpiar área de mensajes
    chatMessages.innerHTML = '';

    // Mostrar mensajes
    if (messages.length === 0) {
      chatMessages.innerHTML = '<div class="text-center text-gray-500 p-4">No hay mensajes. Escribe para comenzar.</div>';
    } else {
      messages.forEach(message => {
        if (!displayedMessages.has(message.id)) {
          displayMessage(message);
        }
      });
    }

    // Scroll al final
    setTimeout(() => {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }, 100);

    // Marcar mensajes como leídos
    await markMessagesAsRead(currentSolicitudId, chatType);

  } catch (error) {
    console.error('❌ Error al cargar chat:', error);
    document.getElementById('chatMessages').innerHTML = `
      <div class="flex justify-center my-4 p-4 bg-red-100 text-red-700 rounded-lg">
        Error al cargar mensajes. <button class="underline ml-2" onclick="loadChat('${chatType}')">Reintentar</button>
      </div>
    `;
  }
}

// Función para mostrar un mensaje en el chat
function displayMessage(message) {
  if (displayedMessages.has(message.id)) return;

  const chatMessages = document.getElementById('chatMessages');
  const emptyMessage = chatMessages.querySelector('.text-center.text-gray-500');
  if (emptyMessage) chatMessages.innerHTML = '';

  const userId = getSstUserId();
  const isSender = parseInt(message.usuario_id) === parseInt(userId);

  const div = document.createElement('div');
  div.className = `chat-message p-3 my-2 rounded-lg ${
    isSender 
      ? 'bg-[#011C3D] text-[#FDFDFD] ml-auto' 
      : 'bg-[#FDF1E6] text-[#011C3D]'
  } max-w-xs shadow-sm`;
  div.dataset.messageId = message.id;
  div.dataset.userId = message.usuario_id;

  let content;
  try {
    if (typeof message.content === 'string') {
      const parsed = JSON.parse(message.content);
      content = parsed.text || message.content;
    } else {
      content = message.content.text || JSON.stringify(message.content);
    }
  } catch (e) {
    content = message.content;
  }

  const date = new Date(message.created_at || Date.now());
  const time = date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });

  const statusIcon = isSender ? (
    String(message.id).startsWith('temp-') ? '<span class="status-icon-sent text-[#CC9000]">✓</span>' :
    message.leido ? '<span class="status-icon-read text-[#CC9000]">✓✓</span>' : 
    '<span class="status-icon-delivered text-[#CC9000]">✓✓</span>'
  ) : '';

  div.innerHTML = `
    <div class="text-sm mb-1">${content}</div>
    <div class="text-xs ${isSender ? 'text-[#FBFBF0]' : 'text-[#011C3D]/70'} text-right">${time} ${statusIcon}</div>
  `;

  chatMessages.appendChild(div);
  displayedMessages.add(message.id);

  const isNearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 100;
  if (isNearBottom) setTimeout(() => chatMessages.scrollTop = chatMessages.scrollHeight, 100);
}

// Función para inicializar el chat (WebSocket)
function initChat() {
  const userId = getSstUserId();
  if (!userId) {
    console.error('No se pudo obtener el ID del usuario SST');
    return;
  }
  
  // Limpiar timeout anterior si existe
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  // Cerrar socket anterior si existe
  if (socket?.readyState === WebSocket.OPEN) {
    socket.close();
  }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

    socket.onopen = () => {
    console.log('🔌 WebSocket conectado');
    reconnectAttempts = 0; // Resetear intentos de reconexión
    
    // Enviar identificación
      socket.send(JSON.stringify({
        type: 'identify',
        userId,
        role: 'sst',
      solicitudId: currentSolicitudId
      }));
    };

  socket.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data);
      console.log('📨 Mensaje WebSocket recibido:', message);

      if (message.type === 'identify_confirmation') {
        console.log('✅ Identificación confirmada:', message);
        return;
      }

      if (message.type === 'status_update') {
        const { tempId, status, messageId } = message;
        updateMessageStatus(tempId, status);
        
        if (messageId) {
          const messageElement = document.querySelector(`.chat-message[data-message-id="${tempId}"]`);
          if (messageElement) {
            messageElement.dataset.messageId = messageId;
          sentMessages.set(tempId, messageId);
          }
        }
        return;
      }

      // Si el mensaje tiene id, es un mensaje de chat
      if (message.id) {
        const userId = getSstUserId();
        const isSender = parseInt(message.usuario_id) === parseInt(userId);
        
        // Evitar duplicados
        if (displayedMessages.has(message.id)) {
          return;
        }

        // Normalizar el mensaje
        const normalizedMessage = {
          id: message.id,
          usuario_id: message.usuario_id,
          content: message.content,
          created_at: message.created_at,
          type: message.type || currentChatType, // Usar el tipo actual si no viene especificado
          leido: message.leido || false
        };

        // Verificar si el mensaje pertenece al chat actual
        if (message.solicitudId == currentSolicitudId) {
          displayMessage(normalizedMessage);
          displayedMessages.add(message.id);
          
          // Si no somos el remitente, marcar como leído
          if (!isSender) {
            await markMessagesAsRead(currentSolicitudId, currentChatType);
          }

          // Scroll al último mensaje si estamos cerca del final
    const chatMessages = document.getElementById('chatMessages');
          if (chatMessages) {
            const isNearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 100;
            if (isNearBottom) {
              setTimeout(() => chatMessages.scrollTop = chatMessages.scrollHeight, 100);
            }
          }
        } else {
          // Si el mensaje no es para el chat actual, actualizar contador
          await updateUnreadCounter(message.solicitudId, message.type);
          if (!isSender) {
            notifyNewMessage(message);
          }
        }
      }
    } catch (error) {
      console.error('❌ Error al procesar mensaje WebSocket:', error);
      }
    };

    socket.onerror = (error) => {
    console.error('❌ Error en WebSocket:', error);
  };

  socket.onclose = (event) => {
    console.log('👋 WebSocket cerrado:', event.code, event.reason);
    
    // Intentar reconexión si no fue un cierre limpio y no excedimos los intentos
    if (!event.wasClean && reconnectAttempts < maxReconnectAttempts) {
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000);
      console.log(`🔄 Reintentando conexión en ${delay/1000} segundos...`);
      
      reconnectTimeout = setTimeout(() => {
        reconnectAttempts++;
    initChat();
  }, delay);
    } else if (reconnectAttempts >= maxReconnectAttempts) {
      console.error('❌ Máximo de intentos de reconexión alcanzado');
      Swal.fire({
        icon: 'error',
        title: 'Error de conexión',
        text: 'No se pudo restablecer la conexión. Por favor, recarga la página.',
        confirmButtonText: 'Recargar',
        allowOutsideClick: false
      }).then((result) => {
        if (result.isConfirmed) {
          window.location.reload();
        }
      });
    }
  };
}

// Función para enviar un mensaje
async function sendMessage() {
  const input = document.getElementById('chatInput');
  const content = input.value.trim();
  if (!content || !currentSolicitudId || !currentChatType || !socket) return;

  const userId = getSstUserId();
  if (!userId) {
    Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo identificar usuario' });
    return;
  }
  
  const tempId = 'temp-' + Date.now();
  const timestamp = new Date().toISOString();

  const localMessage = { id: tempId, usuario_id: userId, content, created_at: timestamp, type: currentChatType };
  displayMessage(localMessage);
  sentMessages.set(tempId, tempId);
  displayedMessages.add(tempId);

  const messageToSend = { solicitudId: currentSolicitudId, type: currentChatType, content, userId, tempId, timestamp };

  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(messageToSend));
    setTimeout(() => updateMessageStatus(tempId, 'sent'), 300);
    setTimeout(() => updateMessageStatus(tempId, 'delivered'), 1000);
  } else {
    updateMessageStatus(tempId, 'error');
    Swal.fire({ icon: 'warning', title: 'Conexión perdida', text: 'Reconectando...' });
    setTimeout(() => { closeChatModal(); openChatModalSST(currentSolicitudId); }, 2000);
  }

  input.value = '';
}

// Función para actualizar el estado de un mensaje
function updateMessageStatus(messageId, status) {
  const messageElement = document.querySelector(`.chat-message[data-message-id="${messageId}"]`);
  if (!messageElement) return;

  const statusContainer = messageElement.querySelector('.text-right');
  if (!statusContainer) return;

  const timeText = statusContainer.textContent.trim().split(' ').slice(0, 2).join(' ');
  const statusIcon = status === 'error' ? '<span class="status-icon-error">!</span>' :
                    status === 'sent' ? '<span class="status-icon-sent">✓</span>' :
                    status === 'delivered' ? '<span class="status-icon-delivered">✓✓</span>' :
                    '<span class="status-icon-read">✓✓</span>';

  statusContainer.innerHTML = `${timeText} ${statusIcon}`;
}

// Función para marcar un mensaje como leído
async function markMessageAsRead(messageId) {
  try {
    await fetch(`/api/chat/mensaje/${messageId}/leido`, {
      method: 'PUT'
    });
  } catch (error) {
    console.error('Error al marcar mensaje como leído:', error);
  }
}

// Función para marcar múltiples mensajes como leídos
async function markMessagesAsRead(messageIds) {
  try {
    await fetch('/api/chat/mensajes/leidos', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ messageIds })
    });
  } catch (error) {
    console.error('Error al marcar mensajes como leídos:', error);
  }
}

// Función para cargar contactos del chat
async function loadChatContacts(solicitudId) {
  if (!solicitudId) return;
  
  // Solo mostramos el contacto SST
  document.getElementById('sstContact').classList.add('active');
  document.getElementById('chatActiveContact').textContent = 'Chat con Contratista';
  
  // Cargar el chat SST por defecto
  loadChat(solicitudId, 'sst');
}

// Función para cambiar el tipo de contacto
function changeContactType(type) {
  if (!currentSolicitudId) {
    console.error('❌ No hay solicitud activa');
    return;
  }

  currentChatType = type;
  $('#chatActiveContact').text('Contratista');
  
  // Cargar mensajes con los parámetros correctos
  loadChat(type);
}

// Función para actualizar contador de mensajes no leídos
async function updateUnreadCountSST(solicitudId) {
  // Eliminar esta funcionalidad ya que no queremos mostrar contadores
  return;
}

// Función para actualizar badges de notificaciones
async function updateSSTNotificationBadges() {
  // Eliminar esta funcionalidad ya que no queremos mostrar contadores
  return;
}

// Función para actualizar el contador de mensajes no leídos
async function updateUnreadCounter(solicitudId, type) {
  // Eliminar esta funcionalidad ya que no queremos mostrar contadores
  return;
}

// Función para abrir el modal de chat SST
async function openChatModalSST(solicitudId) {
  try {
    console.log('🔄 Abriendo chat para solicitud:', solicitudId);
    
    currentSolicitudId = solicitudId;
    currentChatType = 'sst';
    sentMessages.clear();
    displayedMessages.clear();

    const modalElement = document.getElementById('chatModal');
    if (!modalElement) {
      throw new Error('No se encontró el modal de chat');
    }

    modalElement.style.display = 'flex';
    modalElement.classList.remove('hidden');

    document.getElementById('chatSolicitudId').textContent = solicitudId;
    document.getElementById('chatActiveContact').textContent = 'Contratista';

    // Inicializar WebSocket
    initChat();

    // Cargar mensajes iniciales
    await loadChat('sst');
    
    // Agregar manejador de scroll
    const chatMessages = document.getElementById('chatMessages');
    chatMessages.removeEventListener('scroll', scrollHandler);
    chatMessages.addEventListener('scroll', scrollHandler);
    
  } catch (error) {
    console.error('❌ Error al abrir chat:', error);
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: 'No se pudo abrir el chat: ' + error.message
    });
  }
}

// Función para cargar mensajes
async function loadMessages() {
  if (!currentSolicitudId || !currentChatType) {
    console.error('❌ Faltan parámetros necesarios:', { currentSolicitudId, currentChatType });
    return;
  }

  try {
    const chatMessages = document.getElementById('chatMessages');
    chatMessages.innerHTML = '<div class="text-center"><div class="spinner-border text-primary" role="status"></div></div>';

    const userId = getSstUserId();
    const response = await fetch(`/api/chat/${currentSolicitudId}/${currentChatType}?userId=${userId}`);
    
    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }
    
    const messages = await response.json();

    chatMessages.innerHTML = messages.length === 0 ? 
      '<div class="text-center text-muted p-4">No hay mensajes. Escribe para comenzar.</div>' : '';

    messages.forEach(message => displayMessage(message));
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Marcar mensajes como leídos
    const unreadMessages = messages.filter(m => !m.leido && m.usuario_id !== userId).map(m => m.id);
    if (unreadMessages.length > 0) {
      await markMessagesAsRead(currentSolicitudId, currentChatType);
    }
  } catch (error) {
    console.error('Error al cargar mensajes:', error);
    document.getElementById('chatMessages').innerHTML = `
      <div class="alert alert-danger">
        Error al cargar mensajes. <button class="btn btn-link" onclick="loadMessages()">Reintentar</button>
      </div>
    `;
  }
}

// Función para cargar más mensajes (scroll infinito)
async function loadMoreMessages() {
  if (isLoadingMore || !oldestMessageId) return;

  try {
    isLoadingMore = true;
    const userId = getSstUserId();
    const response = await fetch(`/api/chat/${currentSolicitudId}/${currentChatType}?userId=${userId}&before=${oldestMessageId}`);
    const messages = await response.json();

    if (messages.length > 0) {
      const chatMessages = document.getElementById('chatMessages');
      const scrollHeight = chatMessages.scrollHeight;
      
      messages.forEach(message => {
        if (!displayedMessages.has(message.id)) {
          const messageElement = displayMessage(message);
          if (messageElement) {
            chatMessages.insertBefore(messageElement, chatMessages.firstChild);
          }
        }
      });

      chatMessages.scrollTop = chatMessages.scrollHeight - scrollHeight;
      oldestMessageId = messages[messages.length - 1].id;
    }
  } catch (error) {
    console.error('Error al cargar más mensajes:', error);
  } finally {
    isLoadingMore = false;
  }
}

// Función para cerrar el modal del chat
function closeChatModal() {
  // Limpiar timeout de reconexión si existe
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  // Cerrar socket si existe
  if (socket) {
    const closeSocket = socket;
    socket = null; // Evitar que onclose intente reconectar
    closeSocket.close(1000, 'Cierre normal'); // Código 1000 indica cierre limpio
  }

  const chatMessages = document.getElementById('chatMessages');
  if (chatMessages) {
    chatMessages.innerHTML = '';
    chatMessages.removeEventListener('scroll', scrollHandler);
  }

  document.getElementById('chatInput').value = '';
  document.querySelectorAll('.contact-item').forEach(item => item.classList.remove('active'));
  document.getElementById('chatActiveContact').textContent = 'Selecciona un contacto';
  
  const modalElement = document.getElementById('chatModal');
  modalElement.classList.add('hidden');
  modalElement.style.display = 'none';

  currentSolicitudId = null;
  currentChatType = null;
  oldestMessageId = null;
  displayedMessages.clear();
  reconnectAttempts = 0;
}

// Inicializar eventos cuando el documento esté listo
document.addEventListener('DOMContentLoaded', () => {
  // Inicializar botones de chat
  document.querySelectorAll('.open-chat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const solicitudId = btn.dataset.solicitudId;
      openChatModalSST(solicitudId);
    });
  });

  // Inicializar eventos de contactos
        document.querySelectorAll('.contact-item').forEach(item => {
    item.addEventListener('click', () => {
      const type = item.dataset.type;
      if (type) {
        changeContactType(type);
      }
    });
  });

  // Inicializar input de chat
  const chatInput = document.getElementById('chatInput');
  if (chatInput) {
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }
});

// Exportar funciones para que estén disponibles globalmente
window.displayMessage = displayMessage;
window.sendMessage = sendMessage;
window.updateMessageStatus = updateMessageStatus;
window.markMessageAsRead = markMessageAsRead;
window.markMessagesAsRead = markMessagesAsRead;
window.loadChatContacts = loadChatContacts;
window.changeContactType = changeContactType;
window.updateUnreadCountSST = updateUnreadCountSST;
window.updateSSTNotificationBadges = updateSSTNotificationBadges;
window.openChatModalSST = openChatModalSST;
window.loadMessages = loadMessages;
window.loadMoreMessages = loadMoreMessages;
window.closeChatModal = closeChatModal;

// Función para marcar mensajes como leídos
async function markMessagesAsRead(solicitudId, type) {
  const userId = getSstUserId();
  if (!userId) return;

  try {
    const response = await fetch(`/api/chat/${solicitudId}/${type}/mark-read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        console.log('Chat no encontrado, ignorando error');
        return;
      }
      const errorData = await response.json().catch(() => ({ message: 'Error desconocido' }));
      throw new Error(errorData.message || 'Error al marcar mensajes');
    }
    
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'Error al marcar mensajes como leídos');
    }
    
    // Actualizar contador visual
    const badge = document.querySelector(`.unread-count[data-type="${type}"][data-solicitud-id="${solicitudId}"]`);
    if (badge) {
      badge.textContent = '0';
      badge.classList.add('hidden');
    }
  } catch (error) {
    console.error('Error al marcar mensajes como leídos:', error);
    // No mostramos el error al usuario para no interrumpir la experiencia
  }
}

// Función para notificar nuevos mensajes
function notifyNewMessage(message) {
  if (parseInt(message.userId) === parseInt(getSstUserId())) return;
  
  updateUnreadCounter(message.solicitudId, message.type);
  
  if (!document.getElementById('chatModal').classList.contains('hidden') && 
      currentSolicitudId === message.solicitudId && currentChatType === message.type) return;

  if (Notification.permission === 'granted') {
    const sender = message.type === 'sst' ? 'Contratista' : 'Soporte';
    const notification = new Notification(`Nuevo mensaje de ${sender}`, {
      body: message.content,
      icon: '/img/logo.png',
      tag: `chat-${message.solicitudId}-${message.type}`
    });
    notification.onclick = () => {
      window.focus();
      openChatModalSST(message.solicitudId);
      loadChat(message.type);
    };
  }
}

// Función para manejar el scroll infinito
function scrollHandler() {
  const chatMessages = document.getElementById('chatMessages');
  if (chatMessages.scrollTop < 50 && oldestMessageId && !isLoadingMore) {
    loadMoreMessages(currentSolicitudId, currentChatType);
  }
}

// Función para cargar más mensajes
async function loadMoreMessages(solicitudId, type) {
  if (!oldestMessageId || isLoadingMore) return;
  isLoadingMore = true;

  try {
    const chatMessages = document.getElementById('chatMessages');
    const loading = document.createElement('div');
    loading.className = 'text-center text-gray-500 text-sm py-2';
    loading.innerHTML = '<div class="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-ga-gold inline-block"></div> Cargando...';
    chatMessages.insertBefore(loading, chatMessages.firstChild);

    const response = await fetch(`/api/chat/${solicitudId}/${type}?limit=20&before=${oldestMessageId}&userId=${getSstUserId()}`);
    if (!response.ok) throw new Error('Error al cargar más mensajes');

    const messages = await response.json();
    loading.remove();

    if (messages.length > 0) {
      const scrollHeightBefore = chatMessages.scrollHeight;
      const scrollTopBefore = chatMessages.scrollTop;

      messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).forEach(displayMessage);
      oldestMessageId = messages.reduce((min, curr) => parseInt(curr.id) < parseInt(min.id) ? curr : min).id;

      chatMessages.scrollTop = scrollTopBefore + (chatMessages.scrollHeight - scrollHeightBefore);
    } else {
      oldestMessageId = null;
      const noMore = document.createElement('div');
      noMore.className = 'text-center text-gray-500 text-xs py-1';
      noMore.textContent = 'No hay más mensajes';
      chatMessages.insertBefore(noMore, chatMessages.firstChild);
      setTimeout(() => noMore.remove(), 3000);
    }
  } catch (error) {
    console.error('Error al cargar más mensajes:', error);
  } finally {
    isLoadingMore = false;
  }
}

// Inicialización cuando el documento está listo
document.addEventListener('DOMContentLoaded', async () => {
  if ("Notification" in window && Notification.permission !== "granted") {
    Notification.requestPermission();
  }

  const solicitudIds = Array.from(document.querySelectorAll('.unread-count[data-solicitud-id]'))
    .map(el => el.dataset.solicitudId);
  for (const id of solicitudIds) {
    await updateUnreadCounter(id, 'sst');
    await updateUnreadCounter(id, 'soporte');
  }

  document.getElementById('chatInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
});

// Función auxiliar para cargar mensajes iniciales con reintentos
async function loadInitialMessagesWithRetry(solicitudId, type, userId, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log('🔄 Intentando cargar mensajes:', { solicitudId, type, userId });
      const response = await fetch(`/api/chat/${solicitudId}/${type}?userId=${userId}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const messages = await response.json();
      console.log('✅ Mensajes cargados:', messages.length);
      return messages;
    } catch (error) {
      console.error(`❌ Intento ${i + 1} fallido:`, error);
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
} 