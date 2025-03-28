// Ruta para obtener la política de tratamiento de datos personales
router.get('/politica-tratamiento-datos', (req, res) => {
  res.render('politica-tratamiento-datos', {
    title: 'Política de Tratamiento de Datos Personales'
  });
}); 