/**
 * Funciones para la gestión de conversaciones (chat) - Vista SST (Parte 4)
 */

// Manejador global para reacciones en mensajes
document.addEventListener('click', function(e) {
  // Comprobar si se hizo clic en un botón de reacción
  if (e.target.matches('.reaction-btn') || e.target.closest('.reaction-btn')) {
    const button = e.target.matches('.reaction-btn') ? e.target : e.target.closest('.reaction-btn');
    const messageId = button.dataset.messageId;
    const reactionType = button.dataset.reaction;
    
    if (messageId && reactionType) {
      toggleReaction(messageId, reactionType);
    }
  }

  // Comprobar si se hizo clic en el botón de enviar
  if (e.target.matches('#sendMessageBtn') || e.target.closest('#sendMessageBtn')) {
    sendMessage();
  }
});

// Función para adjuntar archivos al chat
function attachFileToChatMessage() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.xls,.xlsx,.zip';
  input.multiple = false;
  input.max = 1;
  input.style.display = 'none';
  
  input.addEventListener('change', async function() {
    if (!input.files || input.files.length === 0) return;
    
    const file = input.files[0];
    if (file.size > 10 * 1024 * 1024) { // 10 MB
      Swal.fire({
        icon: 'error',
        title: 'Archivo demasiado grande',
        text: 'El archivo no debe superar los 10 MB.'
      });
      return;
    }
    
    if (!currentSolicitudId || !currentChatType) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'No hay un chat activo para adjuntar el archivo.'
      });
      return;
    }
    
    // Mostrar indicador de carga
    const chatInput = document.getElementById('chatInput');
    chatInput.disabled = true;
    chatInput.placeholder = 'Subiendo archivo...';
    
    // Preparar datos para envío
    const formData = new FormData();
    formData.append('file', file);
    formData.append('solicitudId', currentSolicitudId);
    formData.append('type', currentChatType);
    formData.append('userId', getSstUserId());
    
    try {
      const response = await fetch('/api/chat/upload-file', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        throw new Error('Error al subir el archivo');
      }
      
      const data = await response.json();
      
      // Indicar éxito
      Swal.fire({
        icon: 'success',
        title: 'Archivo enviado',
        text: 'El archivo ha sido adjuntado al chat correctamente.',
        timer: 2000,
        showConfirmButton: false
      });
      
    } catch (error) {
      console.error('Error al adjuntar archivo:', error);
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'No se pudo adjuntar el archivo. Inténtelo de nuevo.'
      });
    } finally {
      // Restaurar estado
      chatInput.disabled = false;
      chatInput.placeholder = 'Escribe un mensaje...';
    }
  });
  
  document.body.appendChild(input);
  input.click();
  
  // Limpiar el input del DOM después de usarlo
  setTimeout(() => {
    input.remove();
  }, 1000);
}

// Función para añadir reacción a un mensaje
async function toggleReaction(messageId, reactionType) {
  if (!messageId || !reactionType || !currentSolicitudId) return;
  
  try {
    const userId = getSstUserId();
    if (!userId) throw new Error('No se pudo obtener el ID de usuario');
    
    const response = await fetch('/api/chat/reaction', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messageId,
        userId,
        reactionType,
        solicitudId: currentSolicitudId
      })
    });
    
    if (!response.ok) {
      throw new Error('Error al añadir reacción');
    }
    
    const data = await response.json();
    
    // Actualizar interfaz con la nueva reacción
    updateReactionUI(messageId, data.reactions);
    
  } catch (error) {
    console.error('Error al añadir reacción:', error);
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: 'No se pudo añadir la reacción. Inténtelo de nuevo.'
    });
  }
}

// Función para actualizar la UI de reacciones
function updateReactionUI(messageId, reactions) {
  const messageElement = document.querySelector(`.message[data-message-id="${messageId}"]`);
  if (!messageElement) return;
  
  // Contenedor de reacciones
  let reactionsContainer = messageElement.querySelector('.message-reactions');
  if (!reactionsContainer) {
    reactionsContainer = document.createElement('div');
    reactionsContainer.className = 'message-reactions d-flex flex-wrap mt-1';
    messageElement.appendChild(reactionsContainer);
  }
  
  // Limpiar reacciones anteriores
  reactionsContainer.innerHTML = '';
  
  // No mostrar nada si no hay reacciones
  if (!reactions || Object.keys(reactions).length === 0) {
    reactionsContainer.style.display = 'none';
    return;
  }
  
  // Mostrar contenedor
  reactionsContainer.style.display = 'flex';
  
  // Añadir cada tipo de reacción
  for (const [type, users] of Object.entries(reactions)) {
    if (!users || users.length === 0) continue;
    
    const reactionBadge = document.createElement('span');
    reactionBadge.className = 'reaction-badge me-2 mb-1 px-2 py-1 rounded-pill';
    
    const emoji = getReactionEmoji(type);
    const count = users.length;
    const isUserReacted = users.includes(parseInt(getSstUserId()));
    
    // Destacar si el usuario actual reaccionó
    if (isUserReacted) {
      reactionBadge.classList.add('reaction-active');
    }
    
    reactionBadge.innerHTML = `${emoji} ${count}`;
    reactionBadge.dataset.reaction = type;
    reactionBadge.dataset.messageId = messageId;
    reactionBadge.style.cursor = 'pointer';
    
    // Añadir evento para alternar la reacción
    reactionBadge.addEventListener('click', function() {
      toggleReaction(messageId, type);
    });
    
    reactionsContainer.appendChild(reactionBadge);
  }
}

// Función para obtener emoji según tipo de reacción
function getReactionEmoji(type) {
  const emojiMap = {
    'like': '👍',
    'heart': '❤️',
    'laugh': '😂',
    'surprised': '😮',
    'sad': '😢',
    'angry': '😠'
  };
  
  return emojiMap[type] || '👍';
}

// Función para descargar un archivo adjunto
async function downloadAttachment(messageId, fileName) {
  try {
    Swal.fire({
      title: 'Descargando...',
      text: 'Preparando archivo para descarga',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });
    
    const response = await fetch(`/api/chat/download/${messageId}`);
    if (!response.ok) {
      throw new Error('Error al descargar el archivo');
    }
    
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    
    // Crear enlace temporal para la descarga
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = fileName || `archivo_${messageId}`;
    
    document.body.appendChild(a);
    a.click();
    
    // Limpiar
    window.URL.revokeObjectURL(url);
    a.remove();
    
    Swal.close();
    
  } catch (error) {
    console.error('Error al descargar archivo:', error);
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: 'No se pudo descargar el archivo. Inténtelo de nuevo.'
    });
  }
}

// Función para obtener ID de usuario SST actual
function getSstUserId() {
  try {
    return document.getElementById('currentUserId')?.value || 
           localStorage.getItem('sstUserId') || 
           sessionStorage.getItem('sstUserId');
  } catch (error) {
    console.error('Error al obtener ID de usuario SST:', error);
    return null;
  }
}

// Función para buscar en los mensajes del chat actual
function searchInChat(query) {
  if (!query || !query.trim()) {
    // Si la búsqueda está vacía, mostrar todos los mensajes
    document.querySelectorAll('#chatMessages .message').forEach(msg => {
      msg.style.display = 'block';
      msg.classList.remove('search-highlight');
    });
    return;
  }
  
  query = query.trim().toLowerCase();
  let foundCount = 0;
  
  document.querySelectorAll('#chatMessages .message').forEach(msg => {
    const content = msg.querySelector('.message-content')?.textContent.toLowerCase() || '';
    
    if (content.includes(query)) {
      msg.style.display = 'block';
      msg.classList.add('search-highlight');
      foundCount++;
    } else {
      msg.style.display = 'none';
      msg.classList.remove('search-highlight');
    }
  });
  
  // Mostrar resultado de la búsqueda
  const searchResultEl = document.getElementById('searchResultInfo');
  if (searchResultEl) {
    searchResultEl.textContent = foundCount > 0 
      ? `${foundCount} mensaje${foundCount !== 1 ? 's' : ''} encontrado${foundCount !== 1 ? 's' : ''}`
      : 'No se encontraron mensajes';
    searchResultEl.style.display = 'block';
  }
}

// Función para limpiar la búsqueda
function clearChatSearch() {
  const searchInput = document.getElementById('chatSearchInput');
  if (searchInput) searchInput.value = '';
  
  document.querySelectorAll('#chatMessages .message').forEach(msg => {
    msg.style.display = 'block';
    msg.classList.remove('search-highlight');
  });
  
  const searchResultEl = document.getElementById('searchResultInfo');
  if (searchResultEl) searchResultEl.style.display = 'none';
}

// Función para activar el modo de búsqueda en el chat
function toggleChatSearch() {
  const searchBox = document.getElementById('chatSearchBox');
  if (!searchBox) return;
  
  const isVisible = searchBox.style.display === 'flex';
  
  if (isVisible) {
    searchBox.style.display = 'none';
    clearChatSearch();
  } else {
    searchBox.style.display = 'flex';
    document.getElementById('chatSearchInput').focus();
  }
}

// Eventos de inicialización global
document.addEventListener('DOMContentLoaded', function() {
  // Configurar búsqueda en chat
  document.getElementById('chatSearchInput')?.addEventListener('input', function(e) {
    searchInChat(e.target.value);
  });
  
  document.getElementById('clearSearchBtn')?.addEventListener('click', clearChatSearch);
  document.getElementById('searchChatBtn')?.addEventListener('click', toggleChatSearch);
  
  // Configurar botón de adjuntar archivo
  document.getElementById('attachFileBtn')?.addEventListener('click', attachFileToChatMessage);
});

// Exportar funciones para que estén disponibles globalmente
window.attachFileToChatMessage = attachFileToChatMessage;
window.toggleReaction = toggleReaction;
window.updateReactionUI = updateReactionUI;
window.getReactionEmoji = getReactionEmoji;
window.downloadAttachment = downloadAttachment;
window.getSstUserId = getSstUserId;
window.searchInChat = searchInChat;
window.clearChatSearch = clearChatSearch;
window.toggleChatSearch = toggleChatSearch; 