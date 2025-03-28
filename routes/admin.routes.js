const express = require('express');
const router = express.Router();
const AWS = require('aws-sdk');
const { User } = require('../models');
const { isAdmin } = require('../middlewares/auth.middleware');

// Configuración de Digital Ocean Spaces
const spacesEndpoint = new AWS.Endpoint(process.env.DO_SPACES_ENDPOINT);
const s3 = new AWS.S3({
  endpoint: spacesEndpoint,
  accessKeyId: process.env.DO_SPACES_KEY,
  secretAccessKey: process.env.DO_SPACES_SECRET
});

// Ruta para ver las políticas aceptadas
router.get('/politicas-aceptadas', isAdmin, async (req, res) => {
  try {
    const users = await User.findAll({
      where: { accepted_policy: true },
      order: [['policy_acceptance_date', 'DESC']]
    });
    
    res.render('admin/politicas-aceptadas', { users });
  } catch (error) {
    console.error('Error al obtener políticas aceptadas:', error);
    res.status(500).send('Error al cargar la página');
  }
});

// Ruta para ver un documento específico
router.get('/ver-politica/:id', isAdmin, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    
    if (!user || !user.policy_document_url) {
      return res.status(404).send('Documento no encontrado');
    }
    
    // Generar URL firmada para acceder al documento
    const params = {
      Bucket: process.env.DO_SPACES_BUCKET,
      Key: user.policy_document_url,
      Expires: 60 * 5 // 5 minutos
    };
    
    const url = s3.getSignedUrl('getObject', params);
    
    // Redireccionar a la URL firmada
    res.redirect(url);
  } catch (error) {
    console.error('Error al obtener documento:', error);
    res.status(500).send('Error al obtener el documento');
  }
});

module.exports = router; 