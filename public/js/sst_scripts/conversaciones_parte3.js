/**
 * Funciones para la gestión de conversaciones (chat) - Vista SST (Parte 3)
 */

// Función para mostrar un mensaje en el chat
function displayMessage(message, container = null) {
  // Si ya existe este mensaje en el chat, no mostrarlo de nuevo
  if (displayedMessages.has(message.id)) return;
  
  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages) return;
  
  // Agregar mensaje al conjunto de mensajes mostrados
  displayedMessages.add(message.id);
  
  // Crear contenedor para el mensaje si no se proporciona uno
  const messageDiv = container || document.createElement('div');
  
  // Determinar si el mensaje es enviado por el usuario actual
  const isSender = parseInt(message.usuario_id) === parseInt(getSstUserId());
  
  // Aplicar estilos según el remitente
  messageDiv.className = `message p-3 my-2 rounded max-w-75 ${isSender ? 
    'bg-primary text-white ms-auto' : 
    'bg-light text-dark'}`;
  
  // Extraer contenido del mensaje
  let messageContent = '';
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
    messageContent = 'Error al procesar el mensaje';
  }
  
  // Formatear fecha
  const messageDate = new Date(message.created_at);
  const formattedTime = messageDate.toLocaleTimeString('es-ES', { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  
  // Determinar ícono de estado para mensajes enviados
  let statusIcon = '';
  if (isSender) {
    const messageId = String(message.id || '');
    if (messageId === 'error') {
      statusIcon = '<span class="status-icon-error">✗</span>';
    } else if (messageId.startsWith('temp-')) {
      statusIcon = '<span class="status-icon-sent">✓</span>';
    } else if (message.leido) {
      statusIcon = '<span class="status-icon-read">✓✓</span>';
    } else {
      statusIcon = '<span class="status-icon-delivered">✓✓</span>';
    }
  }
  
  // Construir HTML del mensaje
  messageDiv.innerHTML = `
    <div class="message-content">${messageContent}</div>
    <div class="message-meta d-flex justify-content-end align-items-center mt-1">
      <small class="text-muted me-1">${formattedTime}</small>
      ${statusIcon}
    </div>
  `;
  
  // Asignar atributos de datos para identificación
  messageDiv.dataset.messageId = message.id || '';
  messageDiv.dataset.userId = message.usuario_id;
  
  // Si no se proporcionó un contenedor externo, añadir al chat
  if (!container) {
    chatMessages.appendChild(messageDiv);
    
    // Auto-scroll si estamos cerca del final
    const isNearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 100;
    if (isNearBottom) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  }
}

// Función para enviar un mensaje
function sendMessage() {
  const input = document.getElementById('chatInput');
  const content = input.value.trim();
  
  if (!content || !currentSolicitudId || !socket) return;
  
  const userId = getSstUserId();
  if (!userId) {
    console.error('No se pudo obtener el ID de usuario SST');
    return;
  }
  
  const tempId = 'temp-' + Date.now();
  const timestamp = new Date().toISOString();
  
  // Mostrar mensaje localmente primero
  const localMessage = {
    id: tempId,
    usuario_id: userId,
    content: content,
    created_at: timestamp,
    username: 'Yo', // Se mostrará "Yo" para los mensajes propios
    isSender: true
  };
  
  displayMessage(localMessage);
  
  // Preparar el mensaje para enviar
  const messageToSend = {
    solicitudId: currentSolicitudId,
    type: currentChatType,
    content: content,
    userId: userId,
    tempId: tempId,
    timestamp: timestamp
  };
  
  // Limpiar el input y hacer scroll
  input.value = '';
  const chatMessages = document.getElementById('chatMessages');
  chatMessages.scrollTop = chatMessages.scrollHeight;
  
  // Verificar estado del WebSocket
  if (socket.readyState !== WebSocket.OPEN) {
    console.warn('WebSocket no está abierto. Reconectando...');
    updateMessageStatus(tempId, 'error');
    initChat(); // Intentar reconectar
    return;
  }
  
  // Enviar mensaje
  try {
    socket.send(JSON.stringify(messageToSend));
    
    // Actualizar estado a "enviado"
    setTimeout(() => {
      updateMessageStatus(tempId, 'sent');
    }, 100);
  } catch (error) {
    console.error('Error al enviar mensaje:', error);
    updateMessageStatus(tempId, 'error');
  }
}

// Función para actualizar el estado de un mensaje
function updateMessageStatus(messageId, status) {
  const messageElement = document.querySelector(`.message[data-message-id="${messageId}"]`);
  if (!messageElement) return;
  
  const statusElement = messageElement.querySelector('.status-icon-sent, .status-icon-delivered, .status-icon-read, .status-icon-error');
  if (!statusElement) return;
  
  // Actualizar clase y contenido según el estado
  statusElement.className = `status-icon-${status}`;
  
  if (status === 'error') {
    statusElement.innerHTML = '⚠️';
    statusElement.style.color = '#dc3545';
  } else if (status === 'sent') {
    statusElement.innerHTML = '✓';
    statusElement.style.color = '#6c757d';
  } else if (status === 'delivered') {
    statusElement.innerHTML = '✓✓';
    statusElement.style.color = '#6c757d';
  } else if (status === 'read') {
    statusElement.innerHTML = '✓✓';
    statusElement.style.color = '#007bff';
  }
}

// Función para marcar mensaje individual como leído
async function markMessageAsRead(messageId) {
  try {
    const response = await fetch('/api/chat/marcar-leido', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId })
    });
    
    if (!response.ok) {
      throw new Error('Error al marcar mensaje como leído');
    }
  } catch (error) {
    console.error('Error al marcar mensaje como leído:', error);
  }
}

// Función para marcar todos los mensajes como leídos
async function markMessagesAsRead(solicitudId, tipo) {
  try {
    const userId = getSstUserId();
    if (!userId) return;
    
    const response = await fetch('/api/chat/marcar-todos-leidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        solicitudId, 
        tipo, 
        userId 
      })
    });
    
    if (!response.ok) {
      throw new Error('Error al marcar mensajes como leídos');
    }
    
    // Actualizar contador visual
    updateUnreadCountSST(solicitudId);
  } catch (error) {
    console.error('Error al marcar mensajes como leídos:', error);
  }
}

// Función para cargar contactos del chat
function loadChatContacts() {
  try {
    // Obtener todas las solicitudes visibles en la tabla
    const solicitudes = [];
    document.querySelectorAll('#solicitudesTable tbody tr').forEach(row => {
      const solicitudId = row.querySelector('.open-chat-btn')?.dataset.solicitudId;
      const empresa = row.cells[1]?.textContent.trim();
      const contratista = row.cells[2]?.textContent.trim();
      
      if (solicitudId && empresa && contratista) {
        solicitudes.push({ id: solicitudId, empresa, contratista });
      }
    });

    // Actualizar la información del contratista en la interfaz si no está ya establecida
    if (solicitudes.length > 0) {
      document.querySelectorAll('.contratista-name').forEach(el => {
        if (!el.textContent || el.textContent === 'Cargando...') {
          el.textContent = solicitudes[0].contratista + ' (' + solicitudes[0].empresa + ')';
        }
      });
    }

    // Asignar eventos a los contactos
    document.querySelectorAll('.contact-item').forEach(item => {
      // Eliminar eventos anteriores para evitar duplicados
      const clone = item.cloneNode(true);
      item.parentNode.replaceChild(clone, item);
      
      clone.addEventListener('click', function() {
        const type = this.dataset.type;
        
        // Resaltar el contacto seleccionado
        document.querySelectorAll('.contact-item').forEach(i => i.classList.remove('bg-gray-200'));
        this.classList.add('bg-gray-200');
        
        // Cambiar el título del chat según el contacto
        if (type === 'contratista') {
          if (currentSolicitudId) {
            // Usar el nombre que ya está en el elemento contratista-name
            const contratistaName = document.querySelector('.contratista-name')?.textContent || 
                                   `Contratista - Solicitud ${currentSolicitudId}`;
            document.getElementById('chatCurrentContact').textContent = contratistaName;
            changeContactType('sst');
          } else {
            Swal.fire({
              icon: 'info',
              title: 'Seleccione una solicitud',
              text: 'Para chatear con un contratista, primero debe seleccionar una solicitud específica.'
            });
          }
        } else if (type === 'soporte') {
          document.getElementById('chatCurrentContact').textContent = 'Soporte Técnico';
          changeContactType('soporte');
        }
      });
    });
  } catch (error) {
    console.error('Error al cargar contactos:', error);
  }
}

// Función para cambiar el tipo de contacto
function changeContactType(type) {
  if (type === currentChatType) return;
  
  currentChatType = type;
  
  // Limpiar mensajes y mostrar indicador de carga
  const chatMessages = document.getElementById('chatMessages');
  chatMessages.innerHTML = `
    <div class="text-center my-4">
      <div class="spinner-border text-primary" role="status">
        <span class="sr-only">Cargando...</span>
      </div>
      <p class="mt-2">Cargando mensajes...</p>
    </div>
  `;
  
  // Limpiar estado
  oldestMessageId = null;
  displayedMessages.clear();
  
  // Cargar mensajes del nuevo tipo
  loadChatMessages();
}

// Función para actualizar badge de notificaciones
async function updateUnreadCountSST(solicitudId) {
  try {
    const userId = getSstUserId();
    if (!userId) return;
    
    const response = await fetch(`/api/chat/${solicitudId}/sst/unread?userId=${userId}`);
    if (!response.ok) {
      throw new Error('Error al obtener contador de mensajes no leídos');
    }
    
    const data = await response.json();
    
    // Obtener botón de chat para esta solicitud
    const chatButton = document.querySelector(`.open-chat-btn[data-solicitud-id="${solicitudId}"]`);
    if (!chatButton) return;
    
    // Actualizar el badge de notificación
    let badge = chatButton.querySelector('.notif-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'notif-badge';
      badge.style.position = 'absolute';
      badge.style.top = '-8px';
      badge.style.right = '-8px';
      badge.style.backgroundColor = '#e53e3e';
      badge.style.color = 'white';
      badge.style.borderRadius = '9999px';
      badge.style.fontSize = '0.75rem';
      badge.style.padding = '0.15rem 0.4rem';
      badge.style.fontWeight = 'bold';
      badge.style.display = 'flex';
      badge.style.justifyContent = 'center';
      badge.style.alignItems = 'center';
      badge.style.minWidth = '1.2rem';
      badge.style.minHeight = '1.2rem';
      
      chatButton.style.position = 'relative';
      chatButton.appendChild(badge);
    }
    
    badge.textContent = data.unreadCount;
    badge.style.display = data.unreadCount > 0 ? 'flex' : 'none';
  } catch (error) {
    console.error('Error al actualizar contador de mensajes no leídos:', error);
  }
}

// Función para actualizar todos los badges de notificación
function updateSSTNotificationBadges() {
  document.querySelectorAll('.open-chat-btn').forEach(btn => {
    const solicitudId = btn.dataset.solicitudId;
    updateUnreadCountSST(solicitudId);
  });
}

// Inicialización cuando el DOM está listo
document.addEventListener('DOMContentLoaded', function() {
  // Actualizar badges de notificación
  updateSSTNotificationBadges();
  
  // Configurar intervalo para actualizar notificaciones
  setInterval(updateSSTNotificationBadges, 10000);
  
  // Asignar evento de envío de mensaje al presionar Enter
  document.getElementById('chatInput')?.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
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