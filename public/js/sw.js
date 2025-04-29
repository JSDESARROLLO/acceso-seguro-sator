// Service Worker para Acceso Seguro PWA
const CACHE_NAME = "acceso-seguro-cache-v2"
const STATIC_ASSETS = ["/", "/vista-seguridad", "/css/modern.css", "/js/sw.js", "/offline", "/manifest.json"]

const EXTERNAL_ASSETS = [
  "https://cdn.jsdelivr.net/npm/sweetalert2@11",
  "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js",
]

// Instalar el Service Worker
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME)
        console.log("Cache abierto")

        // Cachear recursos estáticos
        await cache.addAll(STATIC_ASSETS)

        // Cachear recursos externos con manejo de errores
        const externalCachePromises = EXTERNAL_ASSETS.map((url) =>
          fetch(url, { mode: "no-cors" })
            .then((response) => cache.put(url, response))
            .catch((error) => {
              console.warn(`Error al cachear ${url}:`, error)
              return Promise.resolve()
            }),
        )

        await Promise.all(externalCachePromises)
        console.log("Todos los recursos cacheados correctamente")
      } catch (error) {
        console.error("Error al inicializar la caché:", error)
      }
    })(),
  )

  // Activar inmediatamente
  self.skipWaiting()
})

// Activar el Service Worker
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log("Eliminando caché antigua:", cacheName)
              return caches.delete(cacheName)
            }
          }),
        )
      })
      .then(() => {
        console.log("Service Worker activado y controlando clientes")
        return self.clients.claim()
      }),
  )
})

// Manejar solicitudes
self.addEventListener("fetch", (event) => {
  const request = event.request

  // Ignorar solicitudes que no son GET
  if (request.method !== "GET") {
    return
  }

  // Manejar solicitudes a la API
  if (request.url.includes("/api/")) {
    event.respondWith(handleApiRequest(request))
    return
  }

  // Manejar solicitudes de navegación
  if (request.mode === "navigate") {
    event.respondWith(handleNavigationRequest(request))
    return
  }

  // Manejar recursos estáticos - Caché primero, luego red
  event.respondWith(handleStaticAssetRequest(request))
})

// Manejar solicitudes a la API - Red primero con degradación elegante
async function handleApiRequest(request) {
  try {
    // Intentar red primero
    const networkResponse = await fetch(request)

    // Si es exitoso, clonar y cachear la respuesta
    if (networkResponse.ok) {
      const responseToCache = networkResponse.clone()
      const cache = await caches.open(CACHE_NAME)
      cache.put(request, responseToCache)
      return networkResponse
    }

    // Si la red falla, devolver la respuesta de error
    return networkResponse
  } catch (error) {
    console.warn("Solicitud de red fallida, devolviendo respuesta offline para API:", request.url)

    // Devolver una respuesta personalizada para solicitudes de API
    return new Response(
      JSON.stringify({
        error: "Sin conexión",
        message: "No se pudo conectar al servidor. Los datos se guardarán localmente.",
        offline: true,
      }),
      {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "X-Offline-Response": "true",
        },
      },
    )
  }
}

// Manejar solicitudes de navegación - Red primero con fallback offline
async function handleNavigationRequest(request) {
  try {
    // Intentar red primero
    const networkResponse = await fetch(request)

    // Si es exitoso, clonar y cachear la respuesta
    if (networkResponse.ok) {
      const responseToCache = networkResponse.clone()
      const cache = await caches.open(CACHE_NAME)
      cache.put(request, responseToCache)
      return networkResponse
    }

    // Si la respuesta de red no es ok, intentar caché
    const cachedResponse = await caches.match(request)
    if (cachedResponse) {
      return cachedResponse
    }

    // Si no está en caché, intentar la página offline
    return caches.match("/offline") || Response.redirect("/offline")
  } catch (error) {
    console.warn("Solicitud de navegación fallida, recurriendo a caché:", request.url)

    // Intentar obtener de la caché
    const cachedResponse = await caches.match(request)
    if (cachedResponse) {
      return cachedResponse
    }

    // Si no está en caché, devolver página offline
    return caches.match("/offline") || Response.redirect("/offline")
  }
}

// Manejar solicitudes de recursos estáticos - Caché primero, luego red
async function handleStaticAssetRequest(request) {
  // Intentar caché primero
  const cachedResponse = await caches.match(request)
  if (cachedResponse) {
    return cachedResponse
  }

  // Si no está en caché, intentar red
  try {
    const networkResponse = await fetch(request)

    // Cachear respuestas exitosas
    if (networkResponse.ok) {
      const responseToCache = networkResponse.clone()
      const cache = await caches.open(CACHE_NAME)
      cache.put(request, responseToCache)
    }

    return networkResponse
  } catch (error) {
    console.warn("Solicitud de recurso estático fallida:", request.url)

    // Para solicitudes de imágenes, devolver un placeholder
    if (request.url.match(/\.(jpg|jpeg|png|gif|svg)$/i)) {
      return (
        caches.match("/img/placeholder.svg") ||
        new Response("Imagen no disponible offline", {
          status: 404,
          headers: { "Content-Type": "text/plain" },
        })
      )
    }

    // Para otros recursos, devolver una respuesta de error simple
    return new Response("Recurso no disponible offline", {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    })
  }
}

// Manejar mensajes de los clientes
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting()
  }

  if (event.data && event.data.type === "CACHE_URLS") {
    event.waitUntil(
      caches
        .open(CACHE_NAME)
        .then((cache) => cache.addAll(event.data.urls))
        .then(() => {
          console.log("URLs adicionales cacheadas correctamente")
          if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ status: "success" })
          }
        })
        .catch((error) => {
          console.error("Error al cachear URLs adicionales:", error)
          if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ status: "error", message: error.message })
          }
        }),
    )
  }
})

// Manejar eventos de sincronización para sincronización en segundo plano
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-pending-actions") {
    event.waitUntil(syncPendingActions())
  }
})

// Función para sincronizar acciones pendientes
async function syncPendingActions() {
  try {
    // Esto se implementaría para trabajar con IndexedDB
    // para recuperar y procesar acciones pendientes
    console.log("Sincronización en segundo plano activada")

    // Notificar a todos los clientes sobre la sincronización
    const clients = await self.clients.matchAll()
    clients.forEach((client) => {
      client.postMessage({
        type: "SYNC_COMPLETED",
        timestamp: new Date().toISOString(),
      })
    })
  } catch (error) {
    console.error("Sincronización en segundo plano fallida:", error)
  }
}
