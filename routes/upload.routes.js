const express = require('express');
const router = express.Router();
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');
const crypto = require('crypto');

// Configuración de multer para manejar archivos
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // Límite de 5MB
    }
});

// Configuración del cliente S3
const s3Client = new S3Client({
    forcePathStyle: false,
    endpoint: `https://${process.env.DO_SPACES_ENDPOINT}`,
    region: "us-east-1",
    credentials: {
        accessKeyId: process.env.DO_SPACES_KEY,
        secretAccessKey: process.env.DO_SPACES_SECRET
    }
});

// Ruta para subir archivos
router.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se ha proporcionado ningún archivo' });
        }

        // Generar nombre único para el archivo
        const fileExtension = path.extname(req.file.originalname);
        const fileName = `capacitaciones/${crypto.randomBytes(16).toString('hex')}${fileExtension}`;

        // Configurar el comando para subir el archivo
        const command = new PutObjectCommand({
            Bucket: process.env.DO_SPACES_BUCKET,
            Key: fileName,
            Body: req.file.buffer,
            ACL: 'public-read',
            ContentType: req.file.mimetype
        });

        // Subir el archivo
        await s3Client.send(command);

        // Construir la URL del archivo
        const fileUrl = `https://${process.env.DO_SPACES_BUCKET}.${process.env.DO_SPACES_ENDPOINT}/${fileName}`;

        res.json({
            success: true,
            url: fileUrl
        });

    } catch (error) {
        console.error('Error al subir archivo:', error);
        res.status(500).json({
            error: 'Error al subir el archivo',
            details: error.message
        });
    }
});

module.exports = router; 