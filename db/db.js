require('dotenv').config(); // Cargar las variables de entorno del archivo .env
const mysql = require('mysql2/promise');

// Crear la conexión a la base de datos
const connection = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  port: process.env.PORT_DB,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT, 10), 
  queueLimit: 0,
});

// Función asincrónica para probar la conexión
async function testConnection() {
  try {
    const [rows, fields] = await connection.execute('SELECT 1');
    console.log('Conexión exitosa a la base de datos');
  } catch (err) {
    console.error('Error al conectar a la base de datos:', err.stack);
  }
}

// Llamar a la función para probar la conexión
testConnection();

module.exports = connection;
