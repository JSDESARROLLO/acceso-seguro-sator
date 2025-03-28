const express = require('express');
const router = express.Router();
const controllers = require('../controllers/register.controller');

// Ruta para mostrar el formulario de registro
router.get('/register', controllers.registerForm);

// Ruta para manejar el registro del nuevo usuario
router.post('/register', controllers.register);

// Añadir ruta para la política de tratamiento de datos
router.get('/politica-tratamiento-datos', (req, res) => {
  res.render('politica-tratamiento-datos', {
    title: 'Política de Tratamiento de Datos Personales'
  });
});

// Añadir ruta para la política de privacidad
router.get('/politica-privacidad', (req, res) => {
  res.render('politica-privacidad', {
    title: 'Política de Privacidad - Acceso Seguro'
  });
});

module.exports = router;
