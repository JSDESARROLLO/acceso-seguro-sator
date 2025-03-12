//  middlewares/authenticateToken.js
// Middleware para verificar el token JWT 
const jwt = require('jsonwebtoken');
const SECRET_KEY = process.env.JWT_SECRET || 'secreto';

const authenticateToken = (req, res, next) => {
    const token = req.cookies.token || req.headers['authorization']?.split(' ')[1];
    if (!token) {
        return res.status(401).redirect('/login'); // Redirige al login si no hay token
    }

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) {
            return res.status(403).redirect('/login'); // Token inválido o expirado
        }
        req.user = user; // Agrega los datos del usuario (id, username, role) al request
        next();
    });
};

module.exports = authenticateToken;