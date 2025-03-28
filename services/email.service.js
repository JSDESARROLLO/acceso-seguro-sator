// services/email.service.js
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const handlebars = require('handlebars');
const { format } = require('date-fns');
const { Upload } = require('@aws-sdk/lib-storage');
const { S3Client } = require('@aws-sdk/client-s3');

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

class EmailService {
    constructor() {
        this.transporter = null;
        this.initializeTransporter();
    }

    initializeTransporter() {
        this.transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });
    }

    setTransporter(credentials) {
        this.transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: credentials.user,
                pass: credentials.pass
            }
        });
    }

    async sendApprovalEmail(to, data) {
        try {
            const templatePath = path.join(__dirname, '../templates/emails/approval.html');
            const template = fs.readFileSync(templatePath, 'utf-8');
            const compiledTemplate = handlebars.compile(template);

            const html = compiledTemplate({
                empresa: data.empresa,
                solicitudId: data.solicitudId,
                fecha: new Date().toLocaleDateString(),
                estado: 'aprobada'
            });

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: to,
                subject: 'Solicitud Aprobada',
                html: html
            };

            await this.transporter.sendMail(mailOptions);
            console.log('Correo de aprobación enviado correctamente');
        } catch (error) {
            console.error('Error al enviar correo de aprobación:', error);
            throw error;
        }
    }

    async sendLaborStopEmail(to, data) {
        try {
            const templatePath = path.join(__dirname, '../templates/emails/labor-stop.html');
            const template = fs.readFileSync(templatePath, 'utf-8');
            const compiledTemplate = handlebars.compile(template);

            const html = compiledTemplate({
                empresa: data.empresa,
                solicitudId: data.solicitudId,
                fecha: new Date().toLocaleDateString(),
                estado: 'detenida'
            });

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: to,
                subject: 'Labor Detenida',
                html: html
            };

            await this.transporter.sendMail(mailOptions);
            console.log('Correo de detención de labor enviado correctamente');
        } catch (error) {
            console.error('Error al enviar correo de detención de labor:', error);
            throw error;
        }
    }

    async sendLaborResumeEmail(to, data) {
        try {
            const templatePath = path.join(__dirname, '../templates/emails/labor-resume.html');
            const template = fs.readFileSync(templatePath, 'utf-8');
            const compiledTemplate = handlebars.compile(template);
            const html = compiledTemplate(data);

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: to,
                subject: 'Labor Reanudada',
                html: html
            };

            await this.transporter.sendMail(mailOptions);
            console.log('Correo de reanudación de labor enviado correctamente');
        } catch (error) {
            console.error('Error al enviar correo de reanudación de labor:', error);
            throw error;
        }
    }

    async sendAcceptanceEmail(to, empresa, documentoUrl) {
        try {
            console.log('[EMAIL SERVICE] Enviando correo de bienvenida y aceptación a contratista:', to);
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: to,
                subject: 'Bienvenido a SATOR - Confirmación de Registro y Políticas',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd;">
                        <div style="text-align: center; margin-bottom: 20px;">
                            <h2>¡Bienvenido al Sistema de Acceso Seguro!</h2>
                        </div>
                        <div style="padding: 15px;">
                            <p>Estimado <strong>${empresa}</strong>,</p>
                            
                            <p>Tu registro en nuestro sistema ha sido completado exitosamente. Como parte del proceso, 
                            has aceptado las políticas de tratamiento de datos que nos permitirán:</p>
                            
                            <ul style="margin-bottom: 20px;">
                                <li>Gestionar la información de tu empresa y colaboradores</li>
                                <li>Administrar las capacitaciones y evaluaciones</li>
                                <li>Mantener un registro seguro de las actividades realizadas</li>
                                <li>Garantizar el cumplimiento de las normativas de seguridad</li>
                            </ul>

                            <p>Es importante mencionar que tus colaboradores también deberán confirmar estas políticas 
                            al momento de realizar sus capacitaciones, lo cual representa una doble verificación para 
                            garantizar la transparencia en el manejo de datos personales.</p>

                            <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                                <p style="margin: 0;"><strong>Acceso al Sistema:</strong></p>
                                <p>Puedes iniciar sesión en cualquier momento usando el siguiente enlace:</p>
                                <p style="text-align: center;">
                                    <a href="${process.env.DOMAIN_URL}/login" 
                                       style="display: inline-block; padding: 10px 20px; background-color: #28a745; color: white; text-decoration: none; border-radius: 5px;">
                                       Iniciar Sesión
                                    </a>
                                </p>
                            </div>

                            <p>Para tu registro, puedes consultar:</p>
                            
                            <div style="text-align: center; margin: 20px 0;">
                                <a href="${process.env.DOMAIN_URL}/politica-tratamiento-datos" 
                                   style="display: inline-block; padding: 10px 20px; background-color: #17a2b8; color: white; text-decoration: none; border-radius: 5px; margin: 0 10px;">
                                   Ver Políticas de Tratamiento de Datos
                                </a>
                                
                                <a href="${documentoUrl}" 
                                   style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px; margin: 0 10px;">
                                   Ver Constancia de Aceptación
                                </a>
                            </div>

                            <p style="margin-top: 20px; font-size: 12px; color: #666;">
                                Esta confirmación es parte de nuestro compromiso con la protección de datos personales 
                                y el cumplimiento de las normativas vigentes.
                            </p>

                            <p>Si tienes alguna pregunta sobre el tratamiento de datos o el uso del sistema, 
                            no dudes en contactarnos.</p>

                            <p>Atentamente,<br>ACCESO SEGURO - SATOR</p>
                        </div>
                    </div>
                `
            };

            await this.transporter.sendMail(mailOptions);
            console.log('[EMAIL SERVICE] Correo de bienvenida y aceptación enviado a contratista:', to);
        } catch (error) {
            console.error('[EMAIL SERVICE] Error al enviar correo al contratista:', error);
            throw error;
        }
    }

    async sendAcceptanceEmailColaborador(to, nombre, documentoUrl, isResend = false) {
        try {
            console.log('[EMAIL SERVICE] Enviando correo de aceptación de políticas al colaborador');
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: to,
                subject: isResend ? 
                    'Confirmación de Políticas de Tratamiento de Datos - SATOR' : 
                    'Confirmación de Políticas de Tratamiento de Datos - SATOR',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd;">
                        <div style="text-align: center; margin-bottom: 20px;">
                            <h2>Confirmación de Políticas de Tratamiento de Datos</h2>
                        </div>
                        <div style="padding: 15px;">
                            <p>Estimado/a <strong>${nombre}</strong>,</p>
                            ${isResend ? 
                                `<p>Te enviamos nuevamente la constancia de confirmación de las políticas de tratamiento de datos.</p>
                                 <p>Esta confirmación es necesaria para garantizar la transparencia en el manejo de tus datos personales dentro de nuestro sistema.</p>` :
                                `<p>Has confirmado las políticas de tratamiento de datos de SATOR.</p>
                                 <p>Esta confirmación representa una doble verificación de la autorización previamente otorgada por tu contratista, 
                                 asegurando así la transparencia en el manejo de tus datos personales y el cumplimiento de las normativas establecidas.</p>`
                            }
                            <p>Tus datos serán utilizados exclusivamente para los fines establecidos en nuestra política de tratamiento de datos, 
                            incluyendo la gestión de capacitaciones y el seguimiento de tu participación en nuestro sistema.</p>
                            <p>Puedes consultar en detalle nuestras políticas de tratamiento de datos en el siguiente enlace:</p>
                            <p style="text-align: center;">
                                <a href="${process.env.DOMAIN_URL}/politica-tratamiento-datos" 
                                   style="display: inline-block; padding: 10px 20px; background-color: #28a745; color: white; text-decoration: none; border-radius: 5px;">
                                   Ver Políticas de Tratamiento de Datos
                                </a>
                            </p>
                            <p>Tu constancia de confirmación está disponible aquí:</p>
                            <p style="text-align: center;">
                                <a href="${documentoUrl}" 
                                   style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">
                                   Ver Constancia de Confirmación
                                </a>
                            </p>
                            <p style="margin-top: 20px; font-size: 12px; color: #666;">
                                Esta confirmación es parte de nuestro compromiso con la protección de datos personales y el cumplimiento 
                                de las normativas vigentes.
                            </p>
                            <p>Si tienes alguna pregunta sobre el tratamiento de tus datos, no dudes en contactarnos.</p>
                            <p>Atentamente,<br>ACCESO SEGURO - SATOR</p>
                        </div>
                    </div>
                `
            };

            await this.transporter.sendMail(mailOptions);
            console.log('[EMAIL SERVICE] Correo de confirmación enviado correctamente a:', to);
        } catch (error) {
            console.error('[EMAIL SERVICE] Error al enviar correo de confirmación al colaborador:', error);
            throw error;
        }
    }

    async generateAndUploadAcceptanceDocument(colaboradorId, nombre, cedula, email, ip, empresa) {
        try {
            console.log('[EMAIL SERVICE] Generando documento para colaborador');
            const templateContent = `
                <!DOCTYPE html>
                <html lang="es">
                <head>
                    <meta charset="UTF-8">
                    <title>Constancia de Aceptación - Colaborador</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 20px; }
                        .container { max-width: 800px; margin: 0 auto; }
                        .header { text-align: center; margin-bottom: 20px; }
                        .content { border: 1px solid #ddd; padding: 20px; }
                        .footer { text-align: center; margin-top: 20px; font-size: 12px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>Constancia de Aceptación - Colaborador</h1>
                        </div>
                        <div class="content">
                            <p><strong>ID Colaborador:</strong> {{colaboradorId}}</p>
                            <p><strong>Nombre:</strong> {{nombre}}</p>
                            <p><strong>Cédula:</strong> {{cedula}}</p>
                            <p><strong>Email:</strong> {{email}}</p>
                            <p><strong>Empresa:</strong> {{empresa}}</p>
                            <p><strong>Fecha:</strong> {{fecha}}</p>
                            <p><strong>IP:</strong> {{ip}}</p>
                            <p>El colaborador ha aceptado las políticas de tratamiento de datos en ${process.env.DOMAIN_URL}/politica-tratamiento-datos</p>
                        </div>
                        <div class="footer">
                            <p>Documento generado electrónicamente</p>
                        </div>
                    </div>
                </body>
                </html>
            `;

            const template = handlebars.compile(templateContent);
            const html = template({
                colaboradorId,
                nombre,
                cedula,
                email: email || 'No proporcionado',
                empresa,
                fecha: format(new Date(), 'dd/MM/yyyy HH:mm:ss'),
                ip
            });

            const buffer = Buffer.from(html, 'utf-8');
            const filename = `aceptaciones/colaboradores/${colaboradorId}_${Date.now()}.html`;

            const upload = new Upload({
                client: s3Client,
                params: {
                    Bucket: 'gestion-contratistas-os',
                    Key: filename,
                    Body: buffer,
                    ContentType: 'text/html',
                    ACL: 'public-read'
                }
            });

            await upload.done();
            const url = `https://gestion-contratistas-os.nyc3.digitaloceanspaces.com/${filename}`;
            console.log('[EMAIL SERVICE] Documento subido:', url);
            return url;
        } catch (error) {
            console.error('[EMAIL SERVICE] Error generando documento:', error);
            throw error;
        }
    }
}

async function generateAcceptanceDocument(data) {
    const templateContent = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>Constancia de Aceptación - Colaborador</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; }
                .container { max-width: 800px; margin: 0 auto; }
                .header { text-align: center; margin-bottom: 20px; }
                .content { border: 1px solid #ddd; padding: 20px; }
                .footer { text-align: center; margin-top: 20px; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Constancia de Aceptación - Colaborador</h1>
                </div>
                <div class="content">
                    <p><strong>ID Colaborador:</strong> {{colaboradorId}}</p>
                    <p><strong>Nombre:</strong> {{nombre}}</p>
                    <p><strong>Cédula:</strong> {{cedula}}</p>
                    <p><strong>Email:</strong> {{email}}</p>
                    <p><strong>Empresa:</strong> {{empresa}}</p>
                    <p><strong>Fecha:</strong> {{fecha}}</p>
                    <p><strong>IP:</strong> {{ip}}</p>
                    <p>El colaborador ha aceptado las políticas de tratamiento de datos en ${process.env.DOMAIN_URL}/politica-tratamiento-datos</p>
                </div>
                <div class="footer">
                    <p>Documento generado electrónicamente</p>
                </div>
            </div>
        </body>
        </html>
    `;

    const template = handlebars.compile(templateContent);
    return template(data);
}

async function uploadToSpaces(html, colaboradorId) {
    const buffer = Buffer.from(html, 'utf-8');
    const filename = `aceptaciones/colaboradores/${colaboradorId}_${Date.now()}.html`;

    const upload = new Upload({
        client: s3Client,
        params: {
            Bucket: 'gestion-contratistas-os',
            Key: filename,
            Body: buffer,
            ContentType: 'text/html',
            ACL: 'public-read'
        }
    });

    await upload.done();
    return `https://gestion-contratistas-os.nyc3.digitaloceanspaces.com/${filename}`;
}

async function generateAndUploadAcceptanceDocument(colaboradorId, nombre, cedula, email, ip, empresa) {
    try {
        const data = {
            colaboradorId,
            nombre,
            cedula,
            email: email || 'No proporcionado',
            empresa,
            fecha: format(new Date(), 'dd/MM/yyyy HH:mm:ss'),
            ip
        };

        const html = await generateAcceptanceDocument(data);
        return await uploadToSpaces(html, colaboradorId);
    } catch (error) {
        console.error('[EMAIL SERVICE] Error generando documento:', error);
        throw error;
    }
}

module.exports = new EmailService(); 