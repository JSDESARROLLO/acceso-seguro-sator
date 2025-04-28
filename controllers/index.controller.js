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

// Controlador para login desde la aplicación móvil
controllers.appLogin = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            error: 'Por favor, complete ambos campos.'
        });
    }

    try {
        const [results] = await connection.execute('SELECT * FROM users WHERE username = ?', [username]);

        if (results.length === 0) {
            return res.status(401).json({
                success: false,
                error: 'Usuario o contraseña incorrectos.'
            });
        }

        const user = results[0];
        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                error: 'Usuario o contraseña incorrectos.'
            });
        }

        // Verificar si el usuario tiene rol de seguridad (role_id = 4)
        if (user.role_id !== 4) {
            return res.status(403).json({
                success: false,
                error: 'Acceso denegado. Solo usuarios de seguridad pueden acceder a la aplicación móvil.'
            });
        }

        const token = jwt.sign(
            { 
                id: user.id, 
                username: user.username, 
                role: 'seguridad',
                exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 horas
            },
            SECRET_KEY
        );

        // Configurar la cookie para la aplicación móvil
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 86400000, // 24 horas
            sameSite: 'none' // Permitir cross-site cookies
        });

        // Obtener información adicional del usuario
        const [userDetails] = await connection.execute(
            'SELECT id, username, role_id, email, created_at FROM users WHERE id = ?',
            [user.id]
        );

        return res.status(200).json({
            success: true,
            token: token,
            user: {
                id: userDetails[0].id,
                username: userDetails[0].username,
                role: 'seguridad',
                email: userDetails[0].email,
                created_at: userDetails[0].created_at
            }
        });
        
    } catch (err) {
        console.error('Error en appLogin:', err);
        return res.status(500).json({
            success: false,
            error: 'Error en el servidor'
        });
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