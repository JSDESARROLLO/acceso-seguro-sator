const express = require('express');
const router = express.Router();
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { User } = require('../models');
const { isAdmin } = require('../middlewares/auth.middleware');

// Configuración de Digital Ocean Spaces con AWS SDK v3
const s3Client = new S3Client({
  endpoint: `https://${process.env.DO_SPACES_ENDPOINT}`,
  region: process.env.DO_SPACES_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET
  }
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
    const command = new GetObjectCommand({
      Bucket: process.env.DO_SPACES_BUCKET,
      Key: user.policy_document_url
    });
    
    const url = await getSignedUrl(s3Client, command, { expiresIn: 300 }); // 5 minutos
    
    // Redireccionar a la URL firmada
    res.redirect(url);
  } catch (error) {
    console.error('Error al generar URL firmada:', error);
    res.status(500).send('Error al acceder al documento');
  }
});

module.exports = router; 