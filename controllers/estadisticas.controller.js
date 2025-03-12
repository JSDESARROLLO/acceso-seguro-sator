const connection = require('../db/db'); // Asegúrate de que la ruta sea correcta
const jwt = require('jsonwebtoken');
const SECRET_KEY = process.env.JWT_SECRET || 'secreto';
const controller = {};

// Función para obtener los datos para los gráficos
const obtenerDatosEstadisticas = async () => {
  try {
    // Consultas a la base de datos
    const [novedadesPorAnio] = await connection.execute(`
      SELECT YEAR(fecha) AS anio, COUNT(*) AS total_novedades 
      FROM novedades 
      GROUP BY YEAR(fecha) 
      ORDER BY anio DESC;
    `);

    const [novedadesPorPuesto] = await connection.execute(`
      SELECT p.nombre_puesto, COUNT(*) AS total_novedades 
      FROM novedades n 
      JOIN puestos p ON n.id_puesto = p.id_puesto 
      GROUP BY p.nombre_puesto 
      ORDER BY total_novedades DESC;
    `);

    const [novedadesPorTipoNovedad] = await connection.execute(`
      SELECT tn.nombre_novedad, COUNT(*) AS total_novedades 
      FROM novedades n 
      JOIN tipos_novedad tn ON n.id_tipo_novedad = tn.id_tipo_novedad 
      GROUP BY tn.nombre_novedad 
      ORDER BY total_novedades DESC;
    `);

    return {
      novedadesPorAnio,
      novedadesPorPuesto,
      novedadesPorTipoNovedad
    };
  } catch (err) {
    console.error('Error al obtener los datos:', err);
    throw err;
  }
};

// Función para obtener estadísticas anuales
controller.getNovedadesAnuales = async (req, res) => {
  try {
    const datos = await obtenerDatosEstadisticas();
    res.json(datos.novedadesPorAnio); // Devuelve los datos como JSON
  } catch (err) {
    console.error('Error al obtener novedades anuales:', err);
    res.status(500).send('Error al obtener novedades anuales');
  }
};

// Función para obtener estadísticas por puesto
controller.getNovedadesPorPuesto = async (req, res) => {
  try {
    const datos = await obtenerDatosEstadisticas();
    res.json(datos.novedadesPorPuesto); // Devuelve los datos como JSON
  } catch (err) {
    console.error('Error al obtener novedades por puesto:', err);
    res.status(500).send('Error al obtener novedades por puesto');
  }
};

// Función para obtener estadísticas por tipo de novedad
controller.getNovedadesPorEvento = async (req, res) => {
  try {
    const datos = await obtenerDatosEstadisticas();
    res.json(datos.novedadesPorTipoNovedad); // Devuelve los datos como JSON
  } catch (err) {
    console.error('Error al obtener novedades por evento:', err);
    res.status(500).send('Error al obtener novedades por evento');
  }
};

// Renderiza la vista de estadísticas (Pug)
controller.estadisticaSeventosCriticos = async (req, res) => {
  const token = req.cookies.token;

  if (!token) {
    console.warn('No se encontró el token en las cookies');
    return res.redirect('/login'); // Si no hay token, redirigir al login
  }

  jwt.verify(token, SECRET_KEY, async (err, decoded) => {
    if (err) {
      console.error('Token inválido o expirado:', err);
      return res.redirect('/login'); // Si el token es inválido, redirigir al login
    }

    try {
      // Obtener los datos de las estadísticas
      const datosEstadisticas = await obtenerDatosEstadisticas();
      
      // Renderizar la vista Pug y pasarle los datos
      res.render('estadisticas', {
        novedadesPorAnio: datosEstadisticas.novedadesPorAnio,
        novedadesPorPuesto: datosEstadisticas.novedadesPorPuesto,
        novedadesPorTipoNovedad: datosEstadisticas.novedadesPorTipoNovedad
      });
    } catch (err) {
      console.error('Error al obtener los datos:', err);
      res.status(500).send('Error al cargar los datos');
    }
  });
};

module.exports = controller;
