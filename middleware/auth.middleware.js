const jwt = require('jsonwebtoken');
const SECRET_KEY = process.env.JWT_SECRET || 'secreto';

function authMiddleware(req, res, next) {
  try {
    // Obtener el token de la cookie
    const token = req.cookies.token;
    
    if (!token) {
      return res.redirect('/login');
    }
    
    // Verificar y decodificar el token localmente
    const decoded = jwt.verify(token, SECRET_KEY);
    
    // Guardar la información del usuario en el objeto request
    req.user = {
      id: decoded.id,
      username: decoded.username,
      role: decoded.role
    };
    
    // Continuar con la siguiente función
    next();
  } catch (error) {
    console.error('Error de autenticación:', error);
    // Solo redirigir al login si el token es inválido o ha expirado
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      res.clearCookie('token');
      return res.redirect('/login');
    }
    // Si es otro tipo de error (como falta de conexión), permitir continuar
    next();
  }
}

module.exports = authMiddleware; 