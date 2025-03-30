const express = require('express');
const router = express.Router();
const db = require('../db/db');

// Obtener datos del interventor de una solicitud
router.get('/solicitud/:id/interventor', async (req, res) => {
    try {
        const solicitudId = req.params.id;
        console.log(`[solicitud.routes] Solicitando interventor para solicitud ${solicitudId}`);
        
        const [rows] = await db.query(`
            SELECT u.username as interventorName, u.id as interventorId
            FROM solicitudes s
            JOIN users u ON s.interventor_id = u.id
            WHERE s.id = ?
        `, [solicitudId]);
        
        console.log(`[solicitud.routes] Resultados de la consulta:`, rows);
        
        if (rows.length === 0) {
            console.log(`[solicitud.routes] No se encontró la solicitud ${solicitudId}`);
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        }
        
        const response = { 
            interventorName: rows[0].interventorName,
            interventorId: rows[0].interventorId
        };
        
        console.log(`[solicitud.routes] Enviando respuesta:`, response);
        res.json(response);
    } catch (error) {
        console.error('Error al obtener datos del interventor:', error);
        res.status(500).json({ error: 'Error al obtener datos del interventor' });
    }
});

// Ruta para obtener participantes
router.get('/solicitud/:solicitudId/participants', async (req, res) => {
  try {
    const { solicitudId } = req.params;
    
    // Validar que el ID sea un número
    if (!solicitudId || isNaN(parseInt(solicitudId))) {
      return res.status(400).json({ error: 'ID de solicitud inválido' });
    }
    
    // Obtener información de la solicitud incluyendo el interventor
    const [solicitud] = await db.query(`
      SELECT s.id, s.empresa, s.usuario_id, s.interventor_id, 
             u_interventor.username AS interventor_nombre
      FROM solicitudes s
      LEFT JOIN users u_interventor ON s.interventor_id = u_interventor.id
      WHERE s.id = ?
    `, [solicitudId]);
    
    if (solicitud.length === 0) {
      return res.status(404).json({ error: 'Solicitud no encontrada' });
    }
    
    // Obtener información del usuario contratista
    const [contratista] = await db.query(`
      SELECT id, username, empresa, nit
      FROM users
      WHERE id = ?
    `, [solicitud[0].usuario_id]);
    
    // Obtener usuarios SST (todos los que tienen ese rol)
    const [sstUsers] = await db.query(`
      SELECT u.id, u.username
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE r.role_name = 'sst'
      ORDER BY u.username ASC
    `);
    
    // Enviar la respuesta con la información de participantes
    res.json({
      solicitudId: parseInt(solicitudId),
      interventorId: solicitud[0].interventor_id,
      interventorName: solicitud[0].interventor_nombre || 'Sin asignar',
      contratistaId: contratista[0]?.id,
      contratistaName: contratista[0]?.username || 'Desconocido',
      sstUsers: sstUsers.map(user => ({
        id: user.id,
        username: user.username
      })),
      sstUsername: 'Soporte SST' // Nombre genérico para la lista de contactos
    });
    
  } catch (error) {
    console.error('Error al obtener participantes del chat:', error);
    res.status(500).json({ 
      error: 'Error al obtener participantes del chat',
      details: error.message 
    });
  }
});

module.exports = router; 