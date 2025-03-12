const multer = require('multer');
const path = require('path');

// Configuración de multer para subir archivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    console.log('[MULTER] Archivo subido a la carpeta "uploads/"');
    cb(null, 'uploads/');  // Carpeta donde se guardarán los archivos
  },
  filename: (req, file, cb) => {
    console.log(`[MULTER] Nombre del archivo: ${file.originalname}`);
    cb(null, Date.now() + path.extname(file.originalname)); // Renombrar el archivo para evitar colisiones
  }
});

const upload = multer({ storage: storage });

module.exports = upload;
