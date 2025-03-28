const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const handlebars = require('handlebars');

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
            console.log('[EMAIL SERVICE] Enviando correo de aceptación de políticas');
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: to,
                subject: 'Confirmación de aceptación de políticas',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd;">
                        <div style="text-align: center; margin-bottom: 20px;">
                            <h2>Confirmación de Aceptación de Políticas</h2>
                        </div>
                        <div style="padding: 15px;">
                            <p>Estimado usuario de <strong>${empresa}</strong>,</p>
                            <p>Gracias por registrarte en nuestro sistema. Has aceptado las políticas de tratamiento de datos.</p>
                            <p>Puedes acceder a la constancia de aceptación mediante el siguiente enlace:</p>
                            <p style="text-align: center;">
                                <a href="${documentoUrl}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Ver constancia</a>
                            </p>
                            <p>Si tienes alguna pregunta, no dudes en contactarnos.</p>
                            <p>Atentamente,<br>ACCESO SEGURO - SATOR</p>
                        </div>
                    </div>
                `
            };

            await this.transporter.sendMail(mailOptions);
            console.log('[EMAIL SERVICE] Correo de aceptación enviado correctamente a:', to);
        } catch (error) {
            console.error('[EMAIL SERVICE] Error al enviar correo de aceptación:', error);
            throw error;
        }
    }

    async sendRegistrationEmail(to, username, empresa) {
        try {
            console.log('[EMAIL SERVICE] Enviando correo de bienvenida al nuevo usuario');
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: to,
                subject: 'Bienvenido - Registro exitoso',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd;">
                        <div style="text-align: center; margin-bottom: 20px;">
                            <h2>¡Bienvenido al Sistema!</h2>
                        </div>
                        <div style="padding: 15px;">
                            <p>Hola <strong>${username}</strong>,</p>
                            <p>Tu registro en nuestro sistema ha sido completado exitosamente para la empresa <strong>${empresa}</strong>.</p>
                            <p>Ahora puedes acceder al sistema con tus credenciales:</p>
                            <ul>
                                <li>Usuario: ${username}</li>
                                <li>Contraseña: La que estableciste durante el registro</li>
                            </ul>
                            <p>Puedes iniciar sesión usando el siguiente enlace:</p>
                            <p style="text-align: center;">
                                <a href="${process.env.DOMAIN_URL}/login" style="display: inline-block; padding: 10px 20px; background-color: #28a745; color: white; text-decoration: none; border-radius: 5px;">Iniciar sesión</a>
                            </p>
                            <p>Si tienes alguna pregunta o necesitas ayuda, no dudes en contactarnos.</p>
                            <p>Atentamente,<br>ACCESO SEGURO - SATOR</p>
                        </div>
                    </div>
                `
            };

            await this.transporter.sendMail(mailOptions);
            console.log('[EMAIL SERVICE] Correo de bienvenida enviado correctamente a:', to);
        } catch (error) {
            console.error('[EMAIL SERVICE] Error al enviar correo de bienvenida:', error);
            throw error;
        }
    }
}

module.exports = new EmailService(); 