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
                subject: 'Solicitud Aprobada - Grupo Argos',
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
                subject: 'Labor Detenida - Grupo Argos',
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
                subject: 'Labor Reanudada - Grupo Argos',
                html: html
            };

            await this.transporter.sendMail(mailOptions);
            console.log('Correo de reanudación de labor enviado correctamente');
        } catch (error) {
            console.error('Error al enviar correo de reanudación de labor:', error);
            throw error;
        }
    }
}

module.exports = new EmailService(); 