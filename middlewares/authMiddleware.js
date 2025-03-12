const jwt = require('jsonwebtoken');
const SECRET_KEY = process.env.JWT_SECRET || 'secreto'; // La clave secreta usada para verificar el JWT

// Middleware para verificar si el usuario está autenticado
const authMiddleware = (req, res, next) => {
    // Obtener el token desde las cookies
    const token = req.cookies.token;

    // Si no hay token, redirigir al login
    if (!token) {
        return res.redirect('/login');
    }

    // Verificar y decodificar el token
    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) {
            console.error('Token inválido:', err);
            return res.redirect('/login');
        }

        // Si el token es válido, almacenamos la información del usuario en la request
        req.user = decoded;

        // Continuamos con la siguiente función en la cadena de middlewares
        next();
    });
};

module.exports = authMiddleware;
