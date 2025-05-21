# Sistema Acceso Seguro Sator

Sistema de control y gestión para Fortox, desarrollado con Node.js y Express.

## 🚀 Características

- Sistema de autenticación y autorización
- Gestión de contratistas
- Sistema de chat en tiempo real
- Integración con DigitalOcean Spaces para almacenamiento
- Interfaz web responsive
- Sistema de notificaciones
- Gestión de documentos
- Reportes y estadísticas

## 🛠️ Tecnologías y Servicios

### Infraestructura y Hosting

#### Servidor Linux (Cloud Cluster)
- **Ubuntu Server 24 LTS 64-bit**
- **Configuración**: 2 CPU Cores / 4GB RAM / 60GB SSD / 100Mbps
- **Base de Datos**: MySQL alojada en Cloud Cluster
- **Ciclo de Facturación**: Mensual

#### DigitalOcean Spaces
- **Certificaciones de Seguridad**:
  - AICPA SOC 2 Tipo II
  - SOC 3 Tipo II
  - STAR Nivel 1 de la Cloud Security Alliance
- **Uso**: Almacenamiento seguro de archivos y documentos

#### Cloudflare
- **Servicios de Seguridad**:
  - Protección contra DDoS
  - Web Application Firewall (WAF)
  - DNSSEC
  - Cloudflare Zero Trust
  - Protección contra bots
  - Red global de distribución de contenido

### Seguridad de la Aplicación

#### Helmet
- Implementación de cabeceras HTTP seguras
- Protección contra:
  - XSS (Cross-Site Scripting)
  - Clickjacking
  - MIME-type sniffing
  - Cross-Frame Scripting
  - Y otros ataques comunes

## 📋 Prerrequisitos

- Node.js >= 20.0.0
- MySQL
- Cuenta en DigitalOcean Spaces (para almacenamiento de archivos)

## 🔧 Instalación

1. Clonar el repositorio:
```bash
git clone [URL_DEL_REPOSITORIO]
cd acceso-seguro-sator
```

2. Instalar dependencias:
```bash
npm install
```

3. Configurar variables de entorno:
Crear un archivo `.env` en la raíz del proyecto con las siguientes variables:

```env
# Archivo .env
DB_HOST=mysql-191117-0.cloudclusters.net
DB_USER=
DB_PASSWORD=
DB_NAME=
PORT_DB=

#DB_HOST=localhost
#DB_USER=root
#DB_PASSWORD=
#DB_NAME=ingreso_contratista_st_desarrollo
#PORT_DB=3306


DB_CONNECTION_LIMIT=120
BASE_URL=https://www.acceso-seguro-sator.com
JWT_SECRET=
#NODE_ENV=production
DO_SPACES_ENDPOINT=nyc3.digitaloceanspaces.com
DO_SPACES_KEY=
DO_SPACES_SECRET=
DO_SPACES_BUCKET=
REGISTRO_HABILITAR_SI_NO=
EMAIL_USER=
EMAIL_PASS=
DOMAIN_URL=https://www.acceso-seguro-sator.com
REGISTRO_HABILITAR_SI_NO=NO
CODIGO_SEGURIDAD_REGISTRO=
```

## 🏃‍♂️ Ejecución

### Desarrollo
```bash
npm run dev
```

### Producción
```bash
npm start
```

## 📁 Estructura del Proyecto

```
acceso-seguro-sator/
├── app/                    # Lógica de la aplicación
├── config/                 # Archivos de configuración
├── controllers/           # Controladores de la aplicación
├── db/                    # Configuración y scripts de base de datos
├── middleware/            # Middlewares de Express
├── middlewares/           # Middlewares adicionales
├── public/                # Archivos estáticos
│   ├── css/              # Estilos CSS
│   ├── img/              # Imágenes
│   └── js/               # Scripts del cliente
├── routes/                # Rutas de la aplicación
├── services/             # Servicios y lógica de negocio
├── src/                  # Código fuente principal
├── templates/            # Plantillas
├── utils/                # Utilidades y helpers
├── views/                # Vistas EJS
├── .env                  # Variables de entorno
├── .gitignore           # Archivos ignorados por git
├── package.json         # Dependencias y scripts
└── vercel.json          # Configuración de Vercel
```

## 🔐 Seguridad

El proyecto implementa varias medidas de seguridad:

- Helmet para cabeceras HTTP seguras
- CORS configurado
- Protección contra XSS
- Autenticación JWT
- HTTPS forzado en producción
- Políticas de seguridad de contenido (CSP)
 

## 👨‍💻 Autores

Carlos Muñoz 
Jose Florez
