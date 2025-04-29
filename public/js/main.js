// Service Worker for Acceso Seguro PWA
const CACHE_NAME = 'acceso-seguro-cache-v2';
const STATIC_ASSETS = [
    '/',
    '/vista-seguridad',
    '/css/styles.css',
    '/js/sw.js',
    '/js/app.js',
    '/css/modern.css',
    '/images/icons/icon-192x192.png',
    '/images/icons/icon-512x512.png',
    '/offline.html'
];

const EXTERNAL_ASSETS = [
    'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'
];

// Install event - Cache all static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        (async () => {
            try {
                const cache = await caches.open(CACHE_NAME);
                console.log('Cache opened successfully');
                
                // Cache static assets
                await cache.addAll(STATIC_ASSETS);
                
                // Cache external assets with fallback
                const externalCachePromises = EXTERNAL_ASSETS.map(url => 
                    fetch(url, { mode: 'no-cors' })
                        .then(response => cache.put(url, response))
                        .catch(error => {
                            console.warn(`Failed to cache ${url}:`, error);
                            return Promise.resolve();
                        })
                );
                
                await Promise.all(externalCachePromises);
                console.log('All assets cached successfully');
            } catch (error) {
                console.error('Cache initialization failed:', error);
            }
        })()
    );
    
    // Activate immediately
    self.skipWaiting();
});

// Activate event - Clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('Service Worker activated and controlling clients');
            return self.clients.claim();
        })
    );
});

// Fetch event - Network-first strategy with fallback to cache
self.addEventListener('fetch', (event) => {
    const request = event.request;
    
    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }
    
    // Handle API requests
    if (request.url.includes('/api/')) {
        event.respondWith(handleApiRequest(request));
        return;
    }
    
    // Handle navigation requests
    if (request.mode === 'navigate') {
        event.respondWith(handleNavigationRequest(request));
        return;
    }
    
    // Handle static assets - Cache first, then network
    event.respondWith(handleStaticAssetRequest(request));
});

// Handle API requests - Network first with graceful degradation
async function handleApiRequest(request) {
    try {
        // Try network first
        const networkResponse = await fetch(request);
        
        // If successful, clone and cache the response
        if (networkResponse.ok) {
            const responseToCache = networkResponse.clone();
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, responseToCache);
            return networkResponse;
        }
        
        // If network fails, return the error response
        return networkResponse;
    } catch (error) {
        console.warn('Network request failed, returning offline response for API:', request.url);
        
        // Return a custom offline response for API requests
        return new Response(JSON.stringify({ 
            error: 'Sin conexión', 
            message: 'No se pudo conectar al servidor. Los datos se guardarán localmente.',
            offline: true
        }), {
            status: 503,
            headers: { 
                'Content-Type': 'application/json',
                'X-Offline-Response': 'true'
            }
        });
    }
}

// Handle navigation requests - Network first with offline fallback
async function handleNavigationRequest(request) {
    try {
        // Try network first
        const networkResponse = await fetch(request);
        
        // If successful, clone and cache the response
        if (networkResponse.ok) {
            const responseToCache = networkResponse.clone();
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, responseToCache);
            return networkResponse;
        }
        
        // If network response is not ok, try cache
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // If not in cache, try the offline page
        return caches.match('/offline.html');
    } catch (error) {
        console.warn('Navigation request failed, falling back to cache:', request.url);
        
        // Try to get from cache
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // If not in cache, return offline page
        return caches.match('/offline.html');
    }
}

// Handle static asset requests - Cache first, then network
async function handleStaticAssetRequest(request) {
    // Try cache first
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
        return cachedResponse;
    }
    
    // If not in cache, try network
    try {
        const networkResponse = await fetch(request);
        
        // Cache successful responses
        if (networkResponse.ok) {
            const responseToCache = networkResponse.clone();
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, responseToCache);
        }
        
        return networkResponse;
    } catch (error) {
        console.warn('Static asset request failed:', request.url);
        
        // For image requests, return a placeholder
        if (request.url.match(/\.(jpg|jpeg|png|gif|svg)$/i)) {
            return caches.match('/images/placeholder.svg');
        }
        
        // For other assets, return a simple error response
        return new Response('Resource not available offline', {
            status: 404,
            headers: { 'Content-Type': 'text/plain' }
        });
    }
}

// Handle messages from clients
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (event.data && event.data.type === 'CACHE_URLS') {
        event.waitUntil(
            caches.open(CACHE_NAME)
                .then(cache => cache.addAll(event.data.urls))
                .then(() => {
                    console.log('Additional URLs cached successfully');
                    event.ports[0].postMessage({ status: 'success' });
                })
                .catch(error => {
                    console.error('Failed to cache additional URLs:', error);
                    event.ports[0].postMessage({ status: 'error', message: error.message });
                })
        );
    }
});

// Handle sync events for background synchronization
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-pending-actions') {
        event.waitUntil(syncPendingActions());
    }
});

// Function to sync pending actions
async function syncPendingActions() {
    try {
        // This would be implemented to work with IndexedDB
        // to retrieve and process pending actions
        console.log('Background sync triggered');
        
        // Notify all clients about the sync
        const clients = await self.clients.matchAll();
        clients.forEach(client => {
            client.postMessage({
                type: 'SYNC_COMPLETED',
                timestamp: new Date().toISOString()
            });
        });
    } catch (error) {
        console.error('Background sync failed:', error);
    }
}
