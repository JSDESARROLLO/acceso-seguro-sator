/**
 * Funciones para la gestión de conversaciones (chat) - Vista SST (Parte 2)
 */

// Función para cerrar el modal de chat
function closeChatModal() {
  if (socket) {
    socket.close();
    socket = null;
  }

  const chatMessages = document.getElementById('chatMessages');
  if (chatMessages) {
    chatMessages.innerHTML = '';
    chatMessages.removeEventListener('scroll', scrollHandler);
  }

  document.getElementById('chatInput').value = '';
  const modalElement = document.getElementById('chatModal');
  
  // Cerrar modal con jQuery si existe la función
  if (typeof $('#chatModal').modal === 'function') {
    $('#chatModal').modal('hide');
  } else if (modalElement) {
    modalElement.classList.add('hidden');
    modalElement.style.display = 'none';
  }
  
  currentSolicitudId = null;
  currentChatType = null;
  oldestMessageId = null;
  displayedMessages.clear();
}

// Función para inicializar el chat (WebSocket)
function initChat() {
  const userId = getSstUserId();
  if (!userId) {
    console.error('No se pudo obtener el ID del usuario SST');
    return;
  }

  if (socket?.readyState === WebSocket.OPEN) {
    socket.close();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

  socket.onopen = () => {
    socket.send(JSON.stringify({
      type: 'identify',
      userId,
      role: 'sst',
      solicitudId: currentSolicitudId
    }));
  };

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    
    if (message.type === 'identify_confirmation') {
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

    if (message.type === 'message' && 
        message.solicitudId == currentSolicitudId && 
        message.type == currentChatType) {
      if (!displayedMessages.has(message.id)) {
        displayMessage(message);
        displayedMessages.add(message.id);
        
        // Marcar como leído si es de otro usuario
        if (message.usuario_id !== userId) {
          markMessageAsRead(message.id);
        }
      }
    }
  };

  socket.onerror = (error) => {
    console.error('WebSocket Error:', error);
  };

  socket.onclose = () => {
    console.log('WebSocket connection closed');
  };
}

// Función para cargar mensajes
function loadChatMessages() {
  loadInitialMessagesWithRetry(currentSolicitudId, currentChatType, getSstUserId())
    .then(messages => {
      const chatMessages = document.getElementById('chatMessages');
      
      chatMessages.innerHTML = messages.length === 0 ? 
        '<div class="text-center text-gray-500 p-4">No hay mensajes. Escribe para comenzar.</div>' : '';
      
      messages.forEach(displayMessage);
      chatMessages.scrollTop = chatMessages.scrollHeight;
      
      // Marcar mensajes como leídos
      markMessagesAsRead(currentSolicitudId, currentChatType);
      
      // Configurar el manejador de scroll para cargar más mensajes
      chatMessages.addEventListener('scroll', scrollHandler);
    })
    .catch(error => {
      console.error('Error al cargar mensajes:', error);
      document.getElementById('chatMessages').innerHTML = `
        <div class="text-center text-red-500 p-4">
          Error al cargar mensajes. <button onclick="loadChatMessages()" class="underline">Reintentar</button>
        </div>
      `;
    });
}

// Función para cargar mensajes iniciales con reintentos
const loadInitialMessagesWithRetry = async (solicitudId, type, userId, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(`/api/chat/${solicitudId}/${type}?limit=30&userId=${userId}`);
      if (response.ok) {
        const messages = await response.json();
        if (messages.length > 0) {
          oldestMessageId = messages.reduce((min, curr) => parseInt(curr.id) < parseInt(min.id) ? curr : min).id;
        } else {
          oldestMessageId = null;
        }
        return messages;
      }
    } catch (err) {
      console.warn(`Intento ${i+1} fallido: ${err}`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw new Error('No se pudieron cargar los mensajes después de varios intentos');
};

// Función para manejar el evento de scroll y cargar mensajes antiguos
function scrollHandler() {
  const chatMessages = document.getElementById('chatMessages');
  
  // Si estamos cerca del principio del scroll (menos de 50px del tope)
  if (chatMessages.scrollTop < 50 && oldestMessageId && !isLoadingMore) {
    loadMoreMessages();
  }
}

// Función para cargar más mensajes antiguos
async function loadMoreMessages() {
  if (!oldestMessageId || isLoadingMore) return;
  
  isLoadingMore = true;
  const chatMessages = document.getElementById('chatMessages');
  
  try {
    // Mostrar indicador de carga
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'text-center text-gray-400 py-2';
    loadingIndicator.innerHTML = '<span class="spinner-border spinner-border-sm mr-2"></span> Cargando mensajes antiguos...';
    chatMessages.insertBefore(loadingIndicator, chatMessages.firstChild);
    
    const response = await fetch(
      `/api/chat/${currentSolicitudId}/${currentChatType}?before=${oldestMessageId}&userId=${getSstUserId()}&limit=20`
    );
    
    if (!response.ok) {
      throw new Error(`Error al cargar mensajes: ${response.status}`);
    }
    
    const messages = await response.json();
    
    // Eliminar indicador de carga
    loadingIndicator.remove();
    
    if (messages.length > 0) {
      // Guardar altura del scroll y posición actual
      const scrollHeightBefore = chatMessages.scrollHeight;
      const scrollTopBefore = chatMessages.scrollTop;
      
      const fragment = document.createDocumentFragment();
      
      // Mostrar mensajes (ordenados por fecha)
      messages
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .forEach(message => {
          if (!displayedMessages.has(message.id)) {
            const messageDiv = document.createElement('div');
            displayMessage(message, messageDiv);
            displayedMessages.add(message.id);
            fragment.appendChild(messageDiv);
          }
        });
      
      chatMessages.insertBefore(fragment, chatMessages.firstChild);
      
      // Actualizar ID del mensaje más antiguo
      oldestMessageId = messages.reduce(
        (oldest, current) => parseInt(current.id) < parseInt(oldest.id) ? current : oldest,
        messages[0]
      ).id;
      
      // Mantener la posición del scroll
      chatMessages.scrollTop = scrollTopBefore + (chatMessages.scrollHeight - scrollHeightBefore);
    } else {
      // Indicar que no hay más mensajes
      oldestMessageId = null;
      
      const noMoreMessagesDiv = document.createElement('div');
      noMoreMessagesDiv.className = 'text-center text-gray-400 py-2';
      noMoreMessagesDiv.textContent = 'No hay más mensajes';
      chatMessages.insertBefore(noMoreMessagesDiv, chatMessages.firstChild);
      
      // Eliminar el mensaje después de 2 segundos
      setTimeout(() => {
        noMoreMessagesDiv.remove();
      }, 2000);
    }
  } catch (error) {
    console.error('Error al cargar más mensajes:', error);
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'text-center text-red-500 py-2';
    errorDiv.textContent = 'Error al cargar más mensajes';
    chatMessages.insertBefore(errorDiv, chatMessages.firstChild);
    
    // Eliminar el mensaje de error después de 3 segundos
    setTimeout(() => {
      errorDiv.remove();
    }, 3000);
  } finally {
    isLoadingMore = false;
  }
}

// Exportar funciones para que estén disponibles globalmente
window.closeChatModal = closeChatModal;
window.initChat = initChat;
window.loadChatMessages = loadChatMessages;
window.scrollHandler = scrollHandler;
window.loadMoreMessages = loadMoreMessages;
window.openChatModalSST = openChatModalSST; 