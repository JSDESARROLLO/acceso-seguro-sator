const { S3Client } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const emailService = require('../services/email.service');
const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');
const connection = require('../db/db');

// En tu función de registro, agrega la lógica para guardar la aceptación de la política
exports.register = async (req, res) => {
  try {
    // ... código existente de validación ...
    
    const { username, password, empresa, nit, email, role } = req.body;
    const aceptaPolitica = req.body.aceptaPolitica === 'on';
    
    // Verificar si es un contratista y exigir aceptación de política
    const [roleData] = await connection.execute('SELECT role_name FROM roles WHERE id = ?', [role]);
    const isContratista = roleData[0]?.role_name.toLowerCase() === 'contratista';
    
    if (isContratista && !aceptaPolitica) {
      return res.render('register', { 
        title: 'Registro', 
        roles: await getRoles(),
        error: 'Debe aceptar la política de tratamiento de datos personales para registrarse como contratista' 
      });
    }
    
    // ... código existente para crear el usuario ...
    
    // Si es contratista, guardar la aceptación de la política
    if (isContratista && aceptaPolitica) {
      // Generar documento de aceptación
      const documentoUrl = await generarDocumentoAceptacion(userId, empresa, nit, email, req.ip || 'No disponible');
      
      // Guardar registro de aceptación
      await connection.execute(
        'INSERT INTO politicas_aceptadas (usuario_id, fecha_aceptacion, ip_aceptacion, documento_url) VALUES (?, NOW(), ?, ?)',
        [userId, req.ip || 'No disponible', documentoUrl]
      );
    }
    
    // ... resto del código existente ...
  } catch (error) {
    // ... manejo de errores existente ...
  }
};

// Función modificada para generar documento HTML en lugar de PDF
async function generarDocumentoAceptacion(userId, empresa, nit, email, ip) {
  try {
    // Crear contenido HTML
    const fechaAceptacion = format(new Date(), 'dd/MM/yyyy HH:mm:ss');
    const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Constancia de Aceptación - Política de Tratamiento de Datos</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 0;
    }
    .container {
      width: 100%;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      text-align: center;
      border-bottom: 2px solid #011C3D;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .logo {
      max-width: 150px;
      margin-bottom: 15px;
    }
    .title {
      color: #011C3D;
      font-size: 24px;
      font-weight: bold;
      margin-bottom: 30px;
      text-align: center;
    }
    .subtitle {
      color: #011C3D;
      font-size: 18px;
      font-weight: bold;
      margin: 25px 0 15px 0;
    }
    .info-box {
      background-color: #f9f9f9;
      border: 1px solid #ddd;
      padding: 20px;
      margin-bottom: 25px;
      border-radius: 5px;
    }
    .info-item {
      margin-bottom: 10px;
    }
    .info-label {
      font-weight: bold;
      width: 180px;
      display: inline-block;
    }
    .content {
      text-align: justify;
      margin-bottom: 30px;
    }
    .list-item {
      margin-bottom: 8px;
      padding-left: 20px;
      position: relative;
    }
    .list-item:before {
      content: "•";
      position: absolute;
      left: 0;
      color: #CC9000;
    }
    .footer {
      margin-top: 50px;
      text-align: center;
      font-size: 12px;
      color: #666;
      border-top: 1px solid #ddd;
      padding-top: 20px;
    }
    @media print {
      body {
        font-size: 12pt;
      }
      .container {
        width: 100%;
        max-width: none;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
    
    
    <div class="footer">
      <p>Documento generado electrónicamente el ${fechaAceptacion}</p>
      <p>FORTOX SECURITY GROUP | Todos los derechos reservados</p>
    </div>
  </div>
</body>
</html>
    `;
    
    // Convertir el HTML a un buffer
    const buffer = Buffer.from(htmlContent, 'utf-8');
    
    // Configurar cliente S3 para DigitalOcean Spaces
    const s3 = new S3Client({
      forcePathStyle: false,
      endpoint: `https://${process.env.DO_SPACES_ENDPOINT}`,
      region: "us-east-1",
      credentials: {
        accessKeyId: process.env.DO_SPACES_KEY,
        secretAccessKey: process.env.DO_SPACES_SECRET
      }
    });
    
    // Generar nombre único para el archivo
    const timestamp = Date.now();
    const filename = `politicas-aceptacion/${userId}_${timestamp}.html`;
    
    // Subir el archivo HTML a DigitalOcean Spaces
    const upload = new Upload({
      client: s3,
      params: {
        Bucket: process.env.DO_SPACES_BUCKET,
        Key: filename,
        Body: buffer,
        ContentType: 'text/html',
        ACL: 'public-read'
      }
    });
    
    const result = await upload.done();
    
    // Enviar correo electrónico de confirmación
    await enviarCorreoAceptacionPolitica(email, empresa, result.Location);
    
    // Retornar la URL del documento
    return result.Location;
  } catch (error) {
    console.error('Error al generar documento de aceptación:', error);
    return null;
  }
}

// Función para enviar correo de confirmación
async function enviarCorreoAceptacionPolitica(to, empresa, documentoUrl) {
  try {
    const templatePath = path.join(__dirname, '../templates/emails/politica-aceptacion.html');
    let templateHtml;
    
    // Intentar leer la plantilla, si no existe, usar una plantilla básica
    try {
      templateHtml = fs.readFileSync(templatePath, 'utf-8');
    } catch (err) {
      templateHtml = `
        <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { width: 100%; max-width: 600px; margin: 0 auto; }
              .header { background-color: #011C3D; color: white; padding: 20px; text-align: center; }
              .content { padding: 20px; }
              .footer { background-color: #f4f4f4; padding: 10px; text-align: center; font-size: 12px; }
              .button { display: inline-block; background-color: #CC9000; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Política de Tratamiento de Datos Personales</h1>
              </div>
              <div class="content">
                <h2>Gracias por aceptar nuestra política</h2>
                <p>Estimado contratista de {{empresa}},</p>
                <p>Usted ha aceptado la Política de Tratamiento de Datos Personales de FORTOX SECURITY GROUP. Este correo confirma su aceptación.</p>
                <p>Se ha generado un documento PDF como comprobante de su aceptación, el cual puede consultar en cualquier momento haciendo clic en el siguiente botón:</p>
                <p style="text-align: center;">
                  <a href="{{documentoUrl}}" class="button">Ver documento de aceptación</a>
                </p>
                <p>Si tiene alguna pregunta o inquietud, no dude en contactarnos.</p>
              </div>
              <div class="footer">
                <p>FORTOX SECURITY GROUP | Todos los derechos reservados</p>
              </div>
            </div>
          </body>
        </html>
      `;
    }
    
    // Reemplazar variables en la plantilla
    const html = templateHtml
      .replace(/{{empresa}}/g, empresa)
      .replace(/{{documentoUrl}}/g, documentoUrl)
      .replace(/{{fecha}}/g, format(new Date(), 'dd/MM/yyyy HH:mm:ss'));
    
    // Enviar el correo
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: to,
      subject: 'Confirmación de Aceptación - Política de Tratamiento de Datos Personales',
      html: html
    };
    
    await emailService.transporter.sendMail(mailOptions);
    console.log('Correo de aceptación de política enviado a:', to);
    
  } catch (error) {
    console.error('Error al enviar correo de aceptación de política:', error);
  }
}

// También necesitamos una función para obtener roles
async function getRoles() {
  const [roles] = await connection.execute('SELECT * FROM roles');
  return roles;
} 