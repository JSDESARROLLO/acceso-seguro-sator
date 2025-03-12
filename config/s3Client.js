const { S3Client } = require('@aws-sdk/client-s3');
require('dotenv').config(); // Cargar variables de entorno

const s3Client = new S3Client({
    forcePathStyle: false,
    endpoint: `https://${process.env.DO_SPACES_ENDPOINT}`,
    region: 'us-east-1',
    credentials: {
        accessKeyId: process.env.DO_SPACES_KEY,
        secretAccessKey: process.env.DO_SPACES_SECRET,
    },
});

module.exports = { s3Client };