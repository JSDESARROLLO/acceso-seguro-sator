// Initialize IndexedDB
let db;

export function initDB() {
    return new Promise((resolve, reject) => {
        const dbRequest = indexedDB.open('SeguridadDB', 3); // Increment version for new schema

        dbRequest.onupgradeneeded = function(event) {
            db = event.target.result;

            // Create store for requests
            if (!db.objectStoreNames.contains('solicitudes')) {
                const solicitudesStore = db.createObjectStore('solicitudes', { keyPath: 'id' });
                solicitudesStore.createIndex('lugar', 'lugar', { unique: false });
            }

            // Create store for collaborators
            if (!db.objectStoreNames.contains('colaboradores')) {
                const colaboradoresStore = db.createObjectStore('colaboradores', { keyPath: 'id' });
                colaboradoresStore.createIndex('solicitudId', 'solicitudId', { unique: false });
                colaboradoresStore.createIndex('cedula', 'cedula', { unique: true });
            }

            // Create store for vehicles
            if (!db.objectStoreNames.contains('vehiculos')) {
                const vehiculosStore = db.createObjectStore('vehiculos', { keyPath: 'id' });
                vehiculosStore.createIndex('solicitudId', 'solicitudId', { unique: false });
                vehiculosStore.createIndex('matricula', 'matricula', { unique: true });
            }

            // Create store for pending actions
            if (!db.objectStoreNames.contains('pendingActions')) {
                db.createObjectStore('pendingActions', { keyPath: 'id' });
            }
        };

        dbRequest.onsuccess = function(event) {
            db = event.target.result;
            resolve(db);
        };

        dbRequest.onerror = function(event) {
            console.error('Error opening IndexedDB:', event.target.error);
            reject(event.target.error);
        };
    });
}

// Function to add an action to IndexedDB
export async function addActionToDB(action) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['pendingActions'], 'readwrite');
        const store = transaction.objectStore('pendingActions');
        const request = store.add({
            id: Date.now().toString(),
            type: action.type,
            data: action.data,
            timestamp: new Date().toISOString()
        });

        request.onsuccess = () => {
            console.log('Action added to IndexedDB:', action);
            resolve();
        };

        request.onerror = () => {
            console.error('Error adding action to IndexedDB:', request.error);
            reject(request.error);
        };
    });
}

// Function to get all pending actions from IndexedDB
export async function getPendingActions() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['pendingActions'], 'readonly');
        const store = transaction.objectStore('pendingActions');
        const request = store.getAll();

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = () => {
            console.error('Error retrieving actions from IndexedDB:', request.error);
            reject(request.error);
        };
    });
}

// Function to delete an action from IndexedDB
export async function deleteActionFromDB(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['pendingActions'], 'readwrite');
        const store = transaction.objectStore('pendingActions');
        const request = store.delete(id);

        request.onsuccess = () => {
            console.log('Action deleted from IndexedDB:', id);
            resolve();
        };

        request.onerror = () => {
            console.error('Error deleting action from IndexedDB:', request.error);
            reject(request.error);
        };
    });
}

// Store solicitudes in IndexedDB
export async function storeSolicitud(solicitud) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['solicitudes'], 'readwrite');
        const store = transaction.objectStore('solicitudes');
        const request = store.put(solicitud);

        request.onsuccess = () => {
            resolve();
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

// Store colaboradores in IndexedDB
export async function storeColaborador(colaborador) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['colaboradores'], 'readwrite');
        const store = transaction.objectStore('colaboradores');
        const request = store.put(colaborador);

        request.onsuccess = () => {
            resolve();
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

// Store vehiculos in IndexedDB
export async function storeVehiculo(vehiculo) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['vehiculos'], 'readwrite');
        const store = transaction.objectStore('vehiculos');
        const request = store.put(vehiculo);

        request.onsuccess = () => {
            resolve();
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

// Get solicitud by ID
export async function getSolicitudById(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['solicitudes'], 'readonly');
        const store = transaction.objectStore('solicitudes');
        const request = store.get(id);

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

// Get colaboradores by solicitudId
export async function getColaboradoresBySolicitudId(solicitudId) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['colaboradores'], 'readonly');
        const store = transaction.objectStore('colaboradores');
        const index = store.index('solicitudId');
        const request = index.getAll(solicitudId);

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

// Get vehiculos by solicitudId
export async function getVehiculosBySolicitudId(solicitudId) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['vehiculos'], 'readonly');
        const store = transaction.objectStore('vehiculos');
        const index = store.index('solicitudId');
        const request = index.getAll(solicitudId);

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

// Get colaborador by ID
export async function getColaboradorById(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['colaboradores'], 'readonly');
        const store = transaction.objectStore('colaboradores');
        const request = store.get(Number(id));

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

// Get vehiculo by ID
export async function getVehiculoById(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['vehiculos'], 'readonly');
        const store = transaction.objectStore('vehiculos');
        const request = store.get(Number(id));

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

// Clear all data from IndexedDB
export async function clearAllData() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['solicitudes', 'colaboradores', 'vehiculos', 'pendingActions'], 'readwrite');
        const solicitudesStore = transaction.objectStore('solicitudes');
        const colaboradoresStore = transaction.objectStore('colaboradores');
        const vehiculosStore = transaction.objectStore('vehiculos');
        const pendingActionsStore = transaction.objectStore('pendingActions');

        solicitudesStore.clear();
        colaboradoresStore.clear();
        vehiculosStore.clear();
        pendingActionsStore.clear();

        transaction.oncomplete = () => {
            resolve();
        };

        transaction.onerror = () => {
            reject(transaction.error);
        };
    });
}
