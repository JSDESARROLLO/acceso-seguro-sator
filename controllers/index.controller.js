const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const connection = require('../db/db');  // Conexión a la base de datos (ya manejada como una promesa)
const SECRET_KEY = process.env.JWT_SECRET || 'secreto';  // Asegúrate de tener esta variable de entorno configurada
const controllers = {};

// Controlador para la página principal
controllers.index = (req, res) => {
    res.render('index', { title: 'Inicio' });
};

// Controlador para la ruta de login
controllers.loginRoute = (req, res) => {
    res.render('login', { title: 'Iniciar Sesión' });
};



controllers.login = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.render('login', {
            title: 'Iniciar Sesión',
            error: 'Por favor, complete ambos campos.'
        });
    }

    try {
        const [results] = await connection.execute('SELECT * FROM users WHERE username = ?', [username]);

        if (results.length === 0) {
            return res.render('login', {
                title: 'Iniciar Sesión',
                error: 'Usuario o contraseña incorrectos.'
            });
        }

        const user = results[0];
        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
            return res.render('login', {
                title: 'Iniciar Sesión',
                error: 'Usuario o contraseña incorrectos.'
            });
        }

        const roleMapping = {
            1: 'contratista',
            2: 'sst',
            3: 'interventor',
            4: 'seguridad',
            5: 'capacitacion'
        };

        const roleName = roleMapping[user.role_id];

        if (!roleName) {
            return res.render('login', {
                title: 'Iniciar Sesión',
                error: 'Rol no reconocido.'
            });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: roleName },
            SECRET_KEY,
            { expiresIn: '24h' }
        );

        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 86400000
        });

        switch (roleName) {
            case 'contratista':
                return res.redirect('/vista-contratista');
            case 'sst':
                return res.redirect('/vista-sst');
            case 'interventor':
                return res.redirect('/vista-interventor');
            case 'seguridad':
                return res.redirect('/vista-seguridad');
            case 'capacitacion':
                return res.redirect('/capacitaciones/listado');
            default:
                return res.render('login', {
                    title: 'Iniciar Sesión',
                    error: 'Error desconocido al asignar el rol.'
                });
        }
        
    } catch (err) {
        console.error('Error al realizar el login:', err);
        res.status(500).send('Error en el servidor');
    }
};

// Controlador para el logout
controllers.logout = (req, res) => {
    res.clearCookie('token');  // Eliminar la cookie del token
    res.redirect('/login');    // Redirigir al login
};

// Controlador para manejar errores personalizados (opcional)
controllers.notFound = (req, res) => {
    res.status(404).render('404', { title: 'Página no encontrada' });
};

module.exports = controllers;