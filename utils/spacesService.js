const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');
const fs = require('fs');
const { s3Client } = require('../config/s3Client');

// Subir archivo a Spaces
async function uploadToSpaces(buffer, originalName) {
    const timestamp = Date.now();
    const fileExtension = path.extname(originalName); // Extrae la extensión del nombre original
    const uniqueFileName = `${timestamp}${fileExtension}`; // Ejemplo: 1741756582502.pdf

    const command = new PutObjectCommand({
        Bucket: process.env.DO_SPACES_BUCKET,
        Key: uniqueFileName,
        Body: buffer,
        ACL: 'public-read', // Ajusta según tus necesidades
    });

    try {
        await s3Client.send(command);
        const url = `https://gestion-contratistas-os.nyc3.digitaloceanspaces.com/${uniqueFileName}`;
        console.log(`Archivo subido exitosamente: ${url}`);
        return url;
    } catch (error) {
        console.error(`Error al subir el archivo ${uniqueFileName}:`, error);
        throw error;
    }
}

// Descargar archivo de Spaces
async function downloadFromSpaces(fileUrl, localPath) {
    const fileName = fileUrl.split('/').pop();
    if (!fileName) {
        console.warn('No se pudo extraer el nombre del archivo de la URL:', fileUrl);
        return false;
    }

    console.log(`Intentando descargar archivo desde Spaces: ${fileName}`);

    const command = new GetObjectCommand({
        Bucket: process.env.DO_SPACES_BUCKET,
        Key: fileName,
    });

    try {
        const response = await s3Client.send(command);
        if (!response.Body) {
            throw new Error('Respuesta vacía desde Spaces');
        }
        const chunks = [];
        for await (const chunk of response.Body) {
            chunks.push(chunk);
        }
        fs.writeFileSync(localPath, Buffer.concat(chunks));
        console.log(`Archivo descargado exitosamente: ${localPath}`);
        return true;
    } catch (error) {
        console.error(`Error al descargar el archivo ${fileName} desde ${fileUrl}:`, {
            name: error.name,
            message: error.message,
            code: error.code,
            stack: error.stack,
        });
        if (error.code === 'NoSuchKey') {
            console.error(`El archivo ${fileName} no existe en el bucket ${process.env.DO_SPACES_BUCKET}`);
        }
        return false;
    }
}

// Eliminar archivo de Spaces
async function deleteFromSpaces(fileUrl) {
    if (!fileUrl) return;

    const fileName = fileUrl.split('/').pop();
    const command = new DeleteObjectCommand({
        Bucket: process.env.DO_SPACES_BUCKET,
        Key: fileName,
    });

    try {
        await s3Client.send(command);
        console.log(`Archivo eliminado de Spaces: ${fileName}`);
    } catch (error) {
        console.error(`Error al eliminar el archivo ${fileName}:`, error);
        throw error;
    }
}

module.exports = { uploadToSpaces, downloadFromSpaces, deleteFromSpaces };