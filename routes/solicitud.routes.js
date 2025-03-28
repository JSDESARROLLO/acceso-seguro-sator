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

module.exports = router; 