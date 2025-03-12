const express = require('express');
const router = express.Router();
const controllers = require('../controllers/register.controller');

// Ruta para mostrar el formulario de registro
router.get('/register', controllers.registerForm);

// Ruta para manejar el registro del nuevo usuario
router.post('/register', controllers.register);

module.exports = router;
