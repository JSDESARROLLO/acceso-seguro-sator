const express = require('express');
const router = express.Router();

// Importamos los controladores
const controllers = require('../controllers/index.controller');
const registerControllers = require('../controllers/register.controller');
const contratista = require('../controllers/contratista.controller');
const interventor = require('../controllers/interventor.controller'); 

// Depuración: Imprimir qué se está importando para cada controlador
console.log('controllers:', controllers); 
console.log('registerControllers:', registerControllers);
console.log('controller:', contratista);

// Ruta principal
console.log('Verificando controllers.index...');
if (typeof controllers.index !== 'function') {
  console.error('controllers.index no es una función o está undefined');
} else {
  router.get('/', controllers.index);  // Si es una función válida, definir la ruta
}

// Ruta de inicio de sesión 
console.log('Verificando controllers.login...');
if (typeof controllers.login !== 'function') {
  console.error('controllers.login no es una función o está undefined');
} else {
  router.post('/login', controllers.login);  // Si es una función válida, definir la ruta
}

// Ruta de login para la aplicación móvil
console.log('Verificando controllers.appLogin...');
if (typeof controllers.appLogin !== 'function') {
  console.error('controllers.appLogin no es una función o está undefined');
} else {
  router.post('/appLogin', controllers.appLogin);  // Si es una función válida, definir la ruta
}

console.log('Verificando controllers.loginRoute...');
if (typeof controllers.loginRoute !== 'function') {
  console.error('controllers.loginRoute no es una función o está undefined');
} else {
  router.get('/login', controllers.loginRoute);  // Si es una función válida, definir la ruta
}

// Rutas de registro
console.log('Verificando registerControllers.registerForm...');
if (typeof registerControllers.registerForm !== 'function') {
  console.error('registerControllers.registerForm no es una función o está undefined');
} else {
  router.get('/register', registerControllers.registerForm);  // Si es una función válida, definir la ruta
}

console.log('Verificando registerControllers.register...');
if (typeof registerControllers.register !== 'function') {
  console.error('registerControllers.register no es una función o está undefined');
} else {
  router.post('/register', registerControllers.register);  // Si es una función válida, definir la ruta
}

// Ruta de contratista
console.log('Verificando controller.vistaContratista...');
if (typeof contratista.vistaContratista !== 'function') {
  console.error('controller.contratista no es una función o está undefined');
} else {
  router.get('/vista-contratista', contratista.vistaContratista);  
}



// Ruta de contratista
console.log('Verificando interventor.vistainterventor...');
if (typeof interventor.vistaInterventor !== 'function') {
  console.error('interventor.vistainterventor no es una función o está undefined');
} else {
  router.get('/vista-interventor', interventor.vistaInterventor);  
}






module.exports = router;
