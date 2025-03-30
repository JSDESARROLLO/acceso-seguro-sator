const jwt = require('jsonwebtoken');
const SECRET_KEY = process.env.JWT_SECRET || 'secreto';

function authMiddleware(req, res, next) {
  try {
    // Obtener el token de la cookie
    const token = req.cookies.token;
    
    if (!token) {
      return res.redirect('/login');
    }
    
    // Verificar y decodificar el token
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
    res.clearCookie('token');
    res.redirect('/login');
  }
}

module.exports = authMiddleware; 