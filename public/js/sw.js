// sw.js
const CACHE_NAME = 'acceso-seguro-cache-v1';
const urlsToCache = [
    '/',
    '/vista-seguridad',
    '/css/styles.css',
    '/js/sw.js',
    '/js/cdn.tailwindcss.com3.4.16.js',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js',
    'https://cdn.jsdelivr.net/npm/sweetalert2@11',
    'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'
];

// Instalar el Service Worker
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Cache abierto');
                return Promise.all(
                    urlsToCache.map(url => {
                        return fetch(url)
                            .then(response => {
                                if (!response.ok) {
                                    throw new Error(`HTTP error! status: ${response.status}`);
                                }
                                return cache.put(url, response);
                            })
                            .catch(error => {
                                console.error(`Error al cachear ${url}:`, error);
                                return Promise.resolve();
                            });
                    })
                );
            })
            .catch((error) => {
                console.error('Error al abrir la caché:', error);
            })
    );
    // Activar el Service Worker inmediatamente
    self.skipWaiting();
});

// Manejar solicitudes
self.addEventListener('fetch', (event) => {
    const request = event.request;
    
    // Ignorar solicitudes que no son GET
    if (request.method !== 'GET') {
        return;
    }

    // Manejar solicitudes a la API
    if (request.url.includes('/api/')) {
        event.respondWith(
            fetch(request)
                .catch(() => {
                    // Si falla la solicitud a la API, devolver un error 503
                    return new Response(JSON.stringify({ 
                        error: 'Sin conexión', 
                        message: 'No se pudo conectar al servidor. Los datos se guardarán localmente.' 
                    }), {
                        status: 503,
                        headers: { 'Content-Type': 'application/json' }
                    });
                })
        );
        return;
    }

    // Para otras solicitudes, intentar primero la caché
    event.respondWith(
        caches.match(request)
            .then((response) => {
                if (response) {
                    return response;
                }

                return fetch(request)
                    .then((response) => {
                        // Solo cacheamos respuestas exitosas
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }

                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME)
                            .then((cache) => {
                                cache.put(request, responseToCache);
                            })
                            .catch(error => {
                                console.error('Error al guardar en caché:', error);
                            });

                        return response;
                    })
                    .catch(() => {
                        // Si falla la solicitud y estamos buscando la página principal
                        if (request.url.includes('/vista-seguridad')) {
                            return caches.match('/vista-seguridad');
                        }
                        // Para otras páginas, intentar servir la página principal
                        return caches.match('/');
                    });
            })
    );
});

// Activar el Service Worker
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    // Tomar control de los clientes inmediatamente
    self.clients.claim();
});

// Manejar mensajes del cliente
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});