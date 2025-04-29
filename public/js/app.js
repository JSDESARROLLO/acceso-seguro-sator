// JavaScript principal para la aplicación Acceso Seguro PWA

// Inicializar IndexedDB
let db
const DB_NAME = "SeguridadDB"
const DB_VERSION = 3 // Incrementar versión para cambios de esquema

// Declarar Swal y verDetalles (asumiendo que son globales o importadas)
// Si son importadas, reemplazar esto con la importación correcta
// Ejemplo: import Swal from 'sweetalert2';
// Ejemplo: import { verDetalles } from './modules/detalles';
let Swal
let verDetalles

// Registrar Service Worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    registerServiceWorker()
    initializeApp()
  })
} else {
  console.warn("Service Worker no es compatible con este navegador")
  initializeApp()
}

// Registrar Service Worker
async function registerServiceWorker() {
  try {
    const registration = await navigator.serviceWorker.register("/js/sw.js")
    console.log("Service Worker registrado correctamente:", registration.scope)

    // Verificar actualizaciones
    registration.addEventListener("updatefound", () => {
      const newWorker = registration.installing

      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          showUpdateNotification()
        }
      })
    })

    // Manejar cambio de controlador
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return
      window.location.reload()
      refreshing = true
    })
  } catch (error) {
    console.error("Error al registrar el Service Worker:", error)
  }
}

// Mostrar notificación de actualización
function showUpdateNotification() {
  Swal.fire({
    title: "Nueva versión disponible",
    text: "¿Deseas actualizar a la última versión?",
    icon: "info",
    showCancelButton: true,
    confirmButtonText: "Actualizar",
    cancelButtonText: "Más tarde",
  }).then((result) => {
    if (result.isConfirmed) {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: "SKIP_WAITING" })
      }
    }
  })
}

// Inicializar la aplicación
async function initializeApp() {
  await initializeDatabase()
  setupEventListeners()
  updateOfflineBanner()
  updatePendingActionsTable()
}

// Inicializar IndexedDB
function initializeDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      db = event.target.result

      // Crear almacenes de objetos si no existen
      if (!db.objectStoreNames.contains("solicitudes")) {
        const solicitudesStore = db.createObjectStore("solicitudes", { keyPath: "id" })
        solicitudesStore.createIndex("lugar", "lugar", { unique: false })
        solicitudesStore.createIndex("timestamp", "timestamp", { unique: false })
      }

      if (!db.objectStoreNames.contains("colaboradores")) {
        const colaboradoresStore = db.createObjectStore("colaboradores", { keyPath: "id" })
        colaboradoresStore.createIndex("solicitudId", "solicitudId", { unique: false })
        colaboradoresStore.createIndex("cedula", "cedula", { unique: true })
        colaboradoresStore.createIndex("timestamp", "timestamp", { unique: false })
      }

      if (!db.objectStoreNames.contains("vehiculos")) {
        const vehiculosStore = db.createObjectStore("vehiculos", { keyPath: "id" })
        vehiculosStore.createIndex("solicitudId", "solicitudId", { unique: false })
        vehiculosStore.createIndex("matricula", "matricula", { unique: true })
        vehiculosStore.createIndex("timestamp", "timestamp", { unique: false })
      }

      if (!db.objectStoreNames.contains("pendingActions")) {
        const pendingActionsStore = db.createObjectStore("pendingActions", { keyPath: "id" })
        pendingActionsStore.createIndex("type", "type", { unique: false })
        pendingActionsStore.createIndex("timestamp", "timestamp", { unique: false })
      }
    }

    request.onsuccess = (event) => {
      db = event.target.result
      console.log("IndexedDB inicializado correctamente")
      resolve()
    }

    request.onerror = (event) => {
      console.error("Error al inicializar IndexedDB:", event.target.error)
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "No se pudo inicializar la base de datos local.",
      })
      reject(event.target.error)
    }
  })
}

// Configurar event listeners
function setupEventListeners() {
  // Eventos online/offline
  window.addEventListener("online", handleOnlineStatus)
  window.addEventListener("offline", handleOfflineStatus)

  // Formulario de búsqueda
  const searchForm = document.getElementById("searchForm")
  if (searchForm) {
    searchForm.addEventListener("submit", (e) => {
      e.preventDefault()
      buscar()
    })
  }

  // Botones
  const loadDataBtn = document.getElementById("loadDataBtn")
  if (loadDataBtn) {
    loadDataBtn.addEventListener("click", cargarTodosLosRegistros)
  }

  const syncDataBtn = document.getElementById("syncDataBtn")
  if (syncDataBtn) {
    syncDataBtn.addEventListener("click", syncPendingActions)
  }

  const clearCacheBtn = document.getElementById("clearCacheBtn")
  if (clearCacheBtn) {
    clearCacheBtn.addEventListener("click", limpiarCache)
  }

  // Mensajes del Service Worker
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data && event.data.type === "SYNC_COMPLETED") {
        Swal.fire({
          icon: "success",
          title: "Sincronización Completada",
          text: "La sincronización en segundo plano ha finalizado.",
        })
        updatePendingActionsTable()
      }
    })
  }
}

// Manejar estado online
function handleOnlineStatus() {
  console.log("Conexión restaurada")
  updateOfflineBanner()

  Swal.fire({
    icon: "info",
    title: "Conexión Restaurada",
    text: "Puedes sincronizar las acciones pendientes ahora.",
  })

  // Registrar sincronización en segundo plano si es compatible
  if ("serviceWorker" in navigator && "SyncManager" in window) {
    navigator.serviceWorker.ready.then((registration) => {
      registration.sync
        .register("sync-pending-actions")
        .catch((error) => console.error("Error al registrar sincronización en segundo plano:", error))
    })
  }
}

// Manejar estado offline
function handleOfflineStatus() {
  console.log("Sin conexión. Las acciones se guardarán localmente.")
  updateOfflineBanner()

  Swal.fire({
    icon: "warning",
    title: "Sin Conexión",
    text: "Las acciones se guardarán localmente y se sincronizarán cuando haya conexión.",
  })
}

// Actualizar visibilidad del banner offline
function updateOfflineBanner() {
  const banner = document.getElementById("offlineBanner")
  if (banner) {
    if (!navigator.onLine) {
      banner.classList.add("show")
    } else {
      banner.classList.remove("show")
    }
  }
}

// Operaciones de base de datos
async function addActionToDB(action) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Base de datos no inicializada"))
      return
    }

    const transaction = db.transaction(["pendingActions"], "readwrite")
    const store = transaction.objectStore("pendingActions")

    const actionData = {
      id: Date.now().toString(),
      type: action.type,
      data: action.data,
      timestamp: new Date().toISOString(),
    }

    const request = store.add(actionData)

    request.onsuccess = () => {
      console.log("Acción añadida a IndexedDB:", action)
      updatePendingActionsTable()
      resolve(actionData.id)
    }

    request.onerror = () => {
      console.error("Error al añadir acción a IndexedDB:", request.error)
      reject(request.error)
    }
  })
}

async function getPendingActions() {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Base de datos no inicializada"))
      return
    }

    const transaction = db.transaction(["pendingActions"], "readonly")
    const store = transaction.objectStore("pendingActions")
    const request = store.getAll()

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onerror = () => {
      console.error("Error al recuperar acciones de IndexedDB:", request.error)
      reject(request.error)
    }
  })
}

async function deleteActionFromDB(id) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error("Base de datos no inicializada"))
      return
    }

    const transaction = db.transaction(["pendingActions"], "readwrite")
    const store = transaction.objectStore("pendingActions")
    const request = store.delete(id)

    request.onsuccess = () => {
      console.log("Acción eliminada de IndexedDB:", id)
      resolve()
    }

    request.onerror = () => {
      console.error("Error al eliminar acción de IndexedDB:", request.error)
      reject(request.error)
    }
  })
}

// Actualizar tabla de acciones pendientes
async function updatePendingActionsTable() {
  const tbody = document.getElementById("pendingActionsBody")
  if (!tbody) return

  tbody.innerHTML = ""

  try {
    const actions = await getPendingActions()

    if (actions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center">No hay acciones pendientes.</td></tr>'
      return
    }

    actions.forEach((action) => {
      const row = document.createElement("tr")
      row.setAttribute("data-action-id", action.id)

      const typeText =
        {
          registrarEntrada: "Registrar Entrada (Colaboradores)",
          registrarSalida: "Registrar Salida (Colaboradores)",
          registrarEntradaVehiculo: "Registrar Entrada (Vehículos)",
          registrarSalidaVehiculo: "Registrar Salida (Vehículos)",
          registrarIngreso: "Registrar Ingreso (Solicitud)",
        }[action.type] || action.type

      const details = []
      if (action.data.colaboradores) {
        details.push(`Colaboradores: ${action.data.colaboradores.map((c) => c.nombre).join(", ")}`)
      }
      if (action.data.vehiculos) {
        details.push(`Vehículos: ${action.data.vehiculos.map((v) => v.matricula).join(", ")}`)
      }
      if (action.type === "registrarIngreso") {
        details.push("Ingreso de solicitud completa")
      }

      row.innerHTML = `
                <td>${action.id}</td>
                <td><span class="badge badge-info">${typeText}</span></td>
                <td>${action.data.solicitudId || "N/A"}</td>
                <td>${details.join("; ") || "N/A"}</td>
                <td>${new Date(action.timestamp).toLocaleString()}</td>
            `

      tbody.appendChild(row)
    })
  } catch (error) {
    console.error("Error al actualizar tabla de acciones pendientes:", error)
    tbody.innerHTML =
      '<tr><td colspan="5" class="text-center text-danger">Error al cargar acciones pendientes.</td></tr>'
  }
}

// Sincronizar acciones pendientes
async function syncPendingActions() {
  if (!navigator.onLine) {
    Swal.fire({
      icon: "warning",
      title: "Sin Conexión",
      text: "No hay conexión a internet. Por favor, intenta de nuevo cuando estés en línea.",
    })
    return
  }

  try {
    const actions = await getPendingActions()

    if (actions.length === 0) {
      Swal.fire({
        icon: "info",
        title: "Sin Acciones",
        text: "No hay acciones pendientes para sincronizar.",
      })
      return
    }

    showLoadingOverlay("Sincronizando acciones pendientes...")

    let successCount = 0
    let errorCount = 0

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i]
      updateProgressBar((i / actions.length) * 100)

      try {
        let url, method, body

        switch (action.type) {
          case "registrarEntrada":
            url = `/api/solicitudes/${action.data.solicitudId}/registrar-entrada`
            method = "POST"
            body = JSON.stringify({
              solicitudId: action.data.solicitudId,
              colaboradores: action.data.colaboradores,
              fecha: action.data.fecha,
              estado_actual: action.data.estadoActual,
            })
            break
          case "registrarSalida":
            url = `/api/solicitudes/${action.data.solicitudId}/registrar-salida`
            method = "POST"
            body = JSON.stringify({
              solicitudId: action.data.solicitudId,
              colaboradores: action.data.colaboradores,
              fecha: action.data.fecha,
              estado_actual: action.data.estadoActual,
            })
            break
          case "registrarEntradaVehiculo":
            url = `/api/solicitudes/${action.data.solicitudId}/registrar-entrada-vehiculo`
            method = "POST"
            body = JSON.stringify({
              solicitudId: action.data.solicitudId,
              vehiculos: action.data.vehiculos,
              fecha: action.data.fecha,
              estado_actual: action.data.estadoActual,
            })
            break
          case "registrarSalidaVehiculo":
            url = `/api/solicitudes/${action.data.solicitudId}/registrar-salida-vehiculo`
            method = "POST"
            body = JSON.stringify({
              solicitudId: action.data.solicitudId,
              vehiculos: action.data.vehiculos,
              fecha: action.data.fecha,
              estado_actual: action.data.estadoActual,
            })
            break
          case "registrarIngreso":
            url = `/api/solicitudes/${action.data.solicitudId}/registrar-ingreso`
            method = "PUT"
            body = null
            break
          default:
            console.warn("Tipo de acción desconocido:", action.type)
            continue
        }

        const response = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body,
        })

        if (response.ok) {
          await deleteActionFromDB(action.id)
          successCount++
        } else {
          const errorData = await response.json()
          console.error(`Error al sincronizar ${action.type}:`, errorData)
          errorCount++
        }
      } catch (error) {
        console.error(`Error al sincronizar ${action.type}:`, error)
        errorCount++
      }
    }

    hideLoadingOverlay()
    await updatePendingActionsTable()

    Swal.fire({
      icon: successCount > 0 ? "success" : "warning",
      title: "Sincronización Completada",
      html: `Acciones sincronizadas exitosamente: ${successCount}<br>Acciones con errores: ${errorCount}`,
    })
  } catch (error) {
    hideLoadingOverlay()
    console.error("Error durante la sincronización:", error)

    Swal.fire({
      icon: "error",
      title: "Error de Sincronización",
      text: "Ocurrió un error durante la sincronización.",
    })
  }
}

// Funciones de overlay de carga
function showLoadingOverlay(message) {
  const overlay = document.getElementById("loadingOverlay")
  const messageElement = document.getElementById("loadingMessage")

  if (overlay && messageElement) {
    messageElement.textContent = message
    overlay.classList.remove("hidden")
  }
}

function updateProgressBar(percentage) {
  const progressFill = document.getElementById("progressFill")

  if (progressFill) {
    progressFill.style.width = `${percentage}%`
  }
}

function hideLoadingOverlay() {
  const overlay = document.getElementById("loadingOverlay")

  if (overlay) {
    overlay.classList.add("hidden")
  }
}

// Limpiar caché
async function limpiarCache() {
  try {
    showLoadingOverlay("Limpiando caché...")

    // Limpiar IndexedDB
    const dbNames = ["SeguridadDB"]
    for (const dbName of dbNames) {
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(dbName)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
    }

    // Limpiar cachés del Service Worker
    if ("caches" in window) {
      const cacheNames = await caches.keys()
      await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)))
    }

    // Desregistrar Service Workers
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      for (const registration of registrations) {
        await registration.unregister()
      }
    }

    hideLoadingOverlay()

    Swal.fire({
      icon: "success",
      title: "Caché Limpiada",
      text: "La caché ha sido limpiada exitosamente. La página se recargará.",
      timer: 2000,
      showConfirmButton: false,
    })

    // Recargar la página después de un breve retraso
    setTimeout(() => {
      window.location.reload(true)
    }, 2000)
  } catch (error) {
    hideLoadingOverlay()
    console.error("Error al limpiar la caché:", error)

    Swal.fire({
      icon: "error",
      title: "Error",
      text: "Hubo un problema al limpiar la caché.",
    })
  }
}

// Variables globales
let refreshing = false

// Función para buscar
function buscar() {
  const id = document.getElementById("buscarId").value.trim()
  if (!id) {
    Swal.fire({
      icon: "warning",
      title: "ID requerido",
      text: "Por favor, ingresa un ID válido.",
    })
    return
  }
  verDetalles(id)
}

// Función para cargar todos los registros
async function cargarTodosLosRegistros() {
  const loadingOverlay = document.getElementById("loadingOverlay")
  const progressFill = document.getElementById("progressFill")
  const loadingMessage = document.getElementById("loadingMessage")

  if (!loadingOverlay || !progressFill || !loadingMessage) {
    console.error("Elementos de UI no encontrados")
    return
  }

  loadingOverlay.classList.remove("hidden")
  loadingMessage.textContent = "Obteniendo solicitudes..."
  progressFill.style.width = "0%"

  try {
    if (!navigator.onLine) {
      throw new Error("Sin conexión a internet")
    }

    const response = await fetch("/api/solicitudes/obtenerSolicitudesActivasConColaboradoresYVehiculos")
    if (!response.ok) {
      throw new Error(`Error al cargar los registros: ${response.statusText}`)
    }

    const solicitudes = await response.json()
    let totalItems = solicitudes.length
    solicitudes.forEach((solicitud) => {
      totalItems += solicitud.colaboradores ? solicitud.colaboradores.length : 0
      totalItems += solicitud.vehiculos ? solicitud.vehiculos.length : 0
    })
    let processedItems = 0

    function updateProgress() {
      processedItems++
      const progress = (processedItems / totalItems) * 100
      progressFill.style.width = `${progress}%`
      loadingMessage.textContent = `Procesando ${processedItems} de ${totalItems} elementos...`
    }

    const transaction = db.transaction(["solicitudes", "colaboradores", "vehiculos"], "readwrite")
    const solicitudesStore = transaction.objectStore("solicitudes")
    const colaboradoresStore = transaction.objectStore("colaboradores")
    const vehiculosStore = transaction.objectStore("vehiculos")

    for (const solicitud of solicitudes) {
      const solicitudData = {
        id: solicitud.id,
        empresa: solicitud.empresa,
        nit: solicitud.nit,
        estado: solicitud.estado,
        interventor: solicitud.interventor,
        lugar: solicitud.lugar,
        nombre_lugar: solicitud.nombre_lugar,
        inicio_obra: solicitud.inicio_obra,
        fin_obra: solicitud.fin_obra,
        labor: solicitud.labor,
        estado_actual: solicitud.estado_actual,
        advertencia: solicitud.advertencia,
        mensajeCursoSiso: solicitud.mensajeCursoSiso,
        mensajePlantillaSS: solicitud.mensajePlantillaSS,
        mensajeVehiculos: solicitud.mensajeVehiculos,
        timestamp: new Date().toISOString(),
      }
      await solicitudesStore.put(solicitudData)
      updateProgress()

      if (solicitud.colaboradores && solicitud.colaboradores.length > 0) {
        for (const colaborador of solicitud.colaboradores) {
          const colaboradorData = {
            id: colaborador.id,
            nombre: colaborador.nombre,
            cedula: colaborador.cedula,
            foto: colaborador.foto,
            cedulaFoto: colaborador.cedulaFoto,
            estado: colaborador.estado,
            cursoSiso: colaborador.cursoSiso,
            curso_siso_estado: colaborador.curso_siso_estado,
            curso_siso_vencimiento: colaborador.curso_siso_vencimiento,
            plantillaSS: colaborador.plantillaSS,
            plantilla_ss_inicio: colaborador.plantilla_ss_inicio,
            plantilla_ss_fin: colaborador.plantilla_ss_fin,
            mensajeCursoSiso: colaborador.mensajeCursoSiso,
            mensajePlantillaSS: colaborador.mensajePlantillaSS,
            solicitudId: solicitud.id,
            timestamp: new Date().toISOString(),
          }
          await colaboradoresStore.put(colaboradorData)
          updateProgress()
        }
      }

      if (solicitud.vehiculos && solicitud.vehiculos.length > 0) {
        for (const vehiculo of solicitud.vehiculos) {
          const vehiculoData = {
            id: vehiculo.id,
            matricula: vehiculo.matricula,
            foto: vehiculo.foto,
            estado: vehiculo.estado,
            soat_inicio: vehiculo.soat_inicio,
            soat_fin: vehiculo.soat_fin,
            tecnomecanica_inicio: vehiculo.tecnomecanica_inicio,
            tecnomecanica_fin: vehiculo.tecnomecanica_fin,
            licencia_conduccion: vehiculo.licencia_conduccion,
            licencia_transito: vehiculo.licencia_transito,
            estado_soat: vehiculo.estado_soat,
            estado_tecnomecanica: vehiculo.estado_tecnomecanica,
            mensajesAdvertencia: vehiculo.mensajesAdvertencia,
            solicitudId: solicitud.id,
            timestamp: new Date().toISOString(),
          }
          await vehiculosStore.put(vehiculoData)
          updateProgress()
        }
      }
    }

    loadingMessage.textContent = "¡Carga completa!"
    progressFill.style.width = "100%"
    setTimeout(() => {
      loadingOverlay.classList.add("hidden")
    }, 500)

    Swal.fire({
      icon: "success",
      title: "Datos Cargados",
      text: "Los datos se han cargado correctamente.",
    })
  } catch (error) {
    console.error("Error al cargar registros:", error)
    loadingMessage.textContent = "Error al cargar datos. Usando caché."
    setTimeout(() => {
      loadingOverlay.classList.add("hidden")
    }, 1000)

    Swal.fire({
      icon: "error",
      title: "Error",
      text: "No se pudieron cargar los datos. " + error.message,
    })
  }
}

// Inicializar cuando el DOM esté listo
document.addEventListener("DOMContentLoaded", () => {
  // Verificar si el Service Worker está registrado
  if ("serviceWorker" in navigator) {
    registerServiceWorker()
  }

  // Verificar conexión al cargar la página
  updateOfflineBanner()
})
