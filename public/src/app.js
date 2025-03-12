const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const { Console } = require('console');
const app = express();

// Configuración de CORS para permitir todas las solicitudes de cualquier origen
app.use(cors({
    origin: '*',  // Permite todas las solicitudes desde cualquier origen
    methods: ['GET', 'POST', 'PUT', 'DELETE'],  // Permite los métodos comunes
    allowedHeaders: ['Content-Type', 'Authorization']  // Permite los encabezados más comunes
}));

// Middleware para parsear JSON y datos de formularios
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware para manejar cookies
app.use(cookieParser());

// Archivos estáticos (CSS, imágenes, JS)
app.use(express.static(path.join(__dirname, '../public'))); 
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Configuración del motor de vistas
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Rutas protegidas y no protegidas
app.use(require('../routes/index.routes')); // Rutas principales (login)
app.use(require('../routes/register.routes')); // Rutas de registro
app.use(require('../routes/contratista.routes')); // Rutas del dashboard 
app.use(require('../routes/interventor.routes')); // Rutas del dashboard 
app.use(require('../routes/sst.routes')); // Rutas del sst 
app.use(require('../routes/seguridad.routes')); // Rutas del seguridad 

// Ruta para cerrar sesión (logout)
app.get('/logout', (req, res) => {
    // Eliminar la cookie que contiene el token
    res.clearCookie('token');
    
    // Redirigir al login
    res.redirect('/login');
  });
   
console.log(__dirname, 'uploads')

// Manejo de 404
app.use((req, res) => {
    res.status(404).render('404', { title: 'Página no encontrada' });
});

// Servidor
const PORT = 8800;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en http://0.0.0.0:${PORT}`);
});
