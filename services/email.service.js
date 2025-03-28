// services/email.service.js
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
            console.log('[EMAIL SERVICE] Enviando correo de aceptación a contratista:', to);
            const templatePath = path.join(__dirname, '../templates/emails/politica-aceptacion.html');
            let template;
            try {
                console.log('[EMAIL SERVICE] Leyendo plantilla desde:', templatePath);
                template = fs.readFileSync(templatePath, 'utf-8');
            } catch (err) {
                console.warn('[EMAIL SERVICE] Usando plantilla básica');
                template = `
                    <h2>Bienvenido al Sistema de Acceso Seguro</h2>
                    <p>Estimado contratista de {{empresa}},</p>
                    <p>Usted ha sido registrado exitosamente y ha aceptado las políticas de tratamiento de datos.</p>
                    <p>Puede consultar las políticas en: {{domainUrl}}/politica-tratamiento-datos</p>
                    <p>Descargue la constancia aquí: <a href="{{documentoUrl}}">Descargar</a></p>
                `;
            }

            const compiledTemplate = handlebars.compile(template);
            const html = compiledTemplate({
                empresa,
                domainUrl: process.env.DOMAIN_URL,
                documentoUrl
            });

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to,
                subject: 'Registro Exitoso - Aceptación de Políticas',
                html
            };

            await this.transporter.sendMail(mailOptions);
            console.log('[EMAIL SERVICE] Correo de aceptación enviado a contratista:', to);
        } catch (error) {
            console.error('[EMAIL SERVICE] Error al enviar correo de aceptación:', error);
            throw error;
        }
    }


    async sendAcceptanceEmailColaborador(to, nombre, documentoUrl) {
        try {
            console.log('[EMAIL SERVICE] Enviando correo de aceptación a colaborador:', to);
            const templatePath = path.join(__dirname, '../templates/emails/politica-aceptacion-colaborador.html');
            let template;
            try {
                console.log('[EMAIL SERVICE] Leyendo plantilla desde:', templatePath);
                template = fs.readFileSync(templatePath, 'utf-8');
            } catch (err) {
                console.warn('[EMAIL SERVICE] Usando plantilla básica para colaborador');
                template = `
                    <h2>Confirmación de Aceptación de Políticas</h2>
                    <p>Estimado/a {{nombre}},</p>
                    <p>Has aceptado las políticas de tratamiento de datos para la capacitación.</p>
                    <p>Puede consultar las políticas en: {{domainUrl}}/politica-tratamiento-datos</p>
                    <p>Descargue la constancia aquí: <a href="{{documentoUrl}}">Descargar</a></p>
                `;
            }

            const compiledTemplate = handlebars.compile(template);
            const html = compiledTemplate({
                nombre,
                domainUrl: process.env.DOMAIN_URL,
                documentoUrl
            });

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to,
                subject: 'Aceptación de Políticas - Capacitación',
                html
            };

            await this.transporter.sendMail(mailOptions);
            console.log('[EMAIL SERVICE] Correo de aceptación enviado a colaborador:', to);
        } catch (error) {
            console.error('[EMAIL SERVICE] Error al enviar correo a colaborador:', error);
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

    async sendAcceptanceEmailColaborador(to, nombre, documentoUrl) {
        try {
            console.log('[EMAIL SERVICE] Enviando correo de aceptación de políticas al colaborador');
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: to,
                subject: 'Confirmación de aceptación de políticas - Colaborador',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd;">
                        <div style="text-align: center; margin-bottom: 20px;">
                            <h2>Confirmación de Aceptación de Políticas</h2>
                        </div>
                        <div style="padding: 15px;">
                            <p>Estimado/a <strong>${nombre}</strong>,</p>
                            <p>Has aceptado las políticas de tratamiento de datos para realizar la capacitación.</p>
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
            console.error('[EMAIL SERVICE] Error al enviar correo de aceptación al colaborador:', error);
            throw error;
        }
    }
}

module.exports = new EmailService(); 