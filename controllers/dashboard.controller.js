const jwt = require('jsonwebtoken');
const connection = require('../db/db');
const SECRET_KEY = process.env.JWT_SECRET || 'secreto';

const controller = {};

// Controlador para la página del Dashboard
controller.dashboard = (req, res) => {
    const token = req.cookies.token;

    if (!token) {
        return res.redirect('/login');
    }

    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) {
            console.error('Token inválido:', err);
            return res.redirect('/login');
        }

        const { username, role } = decoded;

        // Renderizamos el dashboard con los datos del usuario (nombre y rol)
        res.render('dashboard', { 
            title: 'Dashboard - Grupo Argos', 
            username, 
            role 
        });
    });
};


// Controlador para la gestión de asignaciones
controller.asignaciones = async (req, res) => {
    const token = req.cookies.token;

    if (!token) {
        return res.redirect('/login'); // Si no hay token, redirigir al login
    }

    jwt.verify(token, SECRET_KEY, async (err, decoded) => {
        if (err) {
            console.error('Token inválido:', err);
            return res.redirect('/login'); // Si el token es inválido, redirigir al login
        }

        try {
            // Realiza las consultas a la base de datos de forma asíncrona
            const [destinatarios] = await connection.execute('SELECT * FROM destinatarios');
            const [tiposNovedad] = await connection.execute('SELECT * FROM tipos_novedad');
            const [puestos] = await connection.execute('SELECT * FROM puestos');
            const [tiposNegocio] = await connection.execute('SELECT * FROM tipos_negocio');

            // Asegúrate de que no se pasen valores `undefined` a la vista
            res.render('asignaciones', {
                destinatarios: destinatarios || [], // Si no hay destinatarios, pasa un array vacío
                tiposNovedad: tiposNovedad || [],   // Si no hay tipos de novedad, pasa un array vacío
                puestos: puestos || [],             // Si no hay puestos, pasa un array vacío
                tiposNegocio: tiposNegocio || []    // Si no hay tipos de negocio, pasa un array vacío
            });
        } catch (err) {
            console.error('Error al cargar datos:', err);
            res.status(500).send('Error al cargar los datos de asignación'); // En caso de error al obtener los datos
        }
    });
};



controller.estadisticaSeventosCriticos = async (req, res) => {
    const token = req.cookies.token;

    if (!token) {
        return res.redirect('/login'); // Si no hay token, redirigir al login
    }

    jwt.verify(token, SECRET_KEY, async (err, decoded) => {
        if (err) {
            console.error('Token inválido:', err);
            return res.redirect('/login'); // Si el token es inválido, redirigir al login
        }

        try {
            res.render('estadisticaSeventosCriticos'); // Renderiza el archivo Pug
        } catch (err) {
            console.error('Error al cargar datos:', err);
            res.status(500).send('Error al cargar los datos'); // En caso de error
        }
    });
};

// Controlador para el logout
controller.logout = (req, res) => {
    // Eliminar el token de las cookies
    res.clearCookie('token'); // Esto elimina la cookie que contiene el token JWT

    // Redirigir al login después de hacer logout
    res.redirect('/login');
};

module.exports = controller;
