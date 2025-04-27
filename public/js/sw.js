// sw.js
const CACHE_NAME = 'acceso-seguro-cache-v1';
const urlsToCache = [
    '/',
    '/css/styles.css',
    '/js/main.js',
    '/js/offline-manager.js',
    '/js/sw.js',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js',
    'https://cdn.jsdelivr.net/npm/sweetalert2@11',
    'https://cdn.tailwindcss.com'
];

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
                                // Continuar con el siguiente recurso incluso si este falla
                                return Promise.resolve();
                            });
                    })
                );
            })
            .catch((error) => {
                console.error('Error al abrir la caché:', error);
            })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                if (response) {
                    return response;
                }
                return fetch(event.request)
                    .then((response) => {
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME)
                            .then((cache) => {
                                cache.put(event.request, responseToCache);
                            })
                            .catch(error => {
                                console.error('Error al guardar en caché:', error);
                            });
                        return response;
                    })
                    .catch(error => {
                        console.error('Error en la petición fetch:', error);
                        return new Response('Error de red', { status: 503 });
                    });
            })
    );
});

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
});