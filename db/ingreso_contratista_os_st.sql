-- Crear base de datos si no existe
CREATE DATABASE IF NOT EXISTS ingreso_contratista_os_st;
USE ingreso_contratista_os_st;

-- Desactivar restricciones de clave foránea
SET FOREIGN_KEY_CHECKS = 0;

-- Eliminar primero las tablas con claves foráneas dependientes
DROP TABLE IF EXISTS acciones;
DROP TABLE IF EXISTS chat_participantes;
DROP TABLE IF EXISTS mensajes;
DROP TABLE IF EXISTS chats;
DROP TABLE IF EXISTS historial_estados_colaboradores;
DROP TABLE IF EXISTS plantilla_seguridad_social;
DROP TABLE IF EXISTS politicas_aceptadas_colaboradores;
DROP TABLE IF EXISTS registros;
DROP TABLE IF EXISTS registros_vehiculos;
DROP TABLE IF EXISTS resultados_capacitaciones;
DROP TABLE IF EXISTS sst_documentos;
DROP TABLE IF EXISTS colaboradores;
DROP TABLE IF EXISTS vehiculos;
DROP TABLE IF EXISTS capacitaciones;
DROP TABLE IF EXISTS solicitudes;
DROP TABLE IF EXISTS politicas_aceptadas;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS plantilla_documentos_vehiculos;
DROP TABLE IF EXISTS licencias_vehiculo;

-- Eliminar tablas independientes o referenciadas al final
DROP TABLE IF EXISTS lugares;
DROP TABLE IF EXISTS roles;

-- Reactivar restricciones de clave foránea
SET FOREIGN_KEY_CHECKS = 1;

-- Tabla roles
CREATE TABLE roles (
    id INT NOT NULL AUTO_INCREMENT,
    role_name VARCHAR(50) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY role_name (role_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Tabla users
CREATE TABLE users (
    id INT NOT NULL AUTO_INCREMENT,
    username VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL,
    role_id INT NOT NULL,
    empresa VARCHAR(255) NOT NULL,
    nit VARCHAR(20) NOT NULL,
    email VARCHAR(255) DEFAULT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY username (username),
    FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Tabla lugares (movida antes de solicitudes)
CREATE TABLE lugares (
    id INT NOT NULL AUTO_INCREMENT,
    nombre_lugar VARCHAR(255) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY nombre_lugar (nombre_lugar)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Tabla solicitudes
CREATE TABLE solicitudes (
    id INT NOT NULL AUTO_INCREMENT,
    usuario_id INT NOT NULL,
    empresa VARCHAR(255) NOT NULL,
    nit VARCHAR(20) NOT NULL,
    inicio_obra DATE NOT NULL,
    fin_obra DATE NOT NULL,
    dias_trabajo INT NOT NULL,
    arl_documento VARCHAR(255) DEFAULT NULL,
    pasocial_documento VARCHAR(255) DEFAULT NULL,
    estado ENUM('pendiente','aprobada','negada','en labor','labor detenida') DEFAULT 'pendiente',
    lugar INT NOT NULL,
    labor VARCHAR(255) NOT NULL,
    interventor_id INT NOT NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (usuario_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (interventor_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (lugar) REFERENCES lugares (id),
    KEY idx_solicitudes_estado (estado),
    KEY idx_solicitudes_fecha (inicio_obra, fin_obra),
    KEY idx_solicitudes_empresa (empresa),
    KEY idx_solicitudes_nit (nit)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Tabla acciones
CREATE TABLE acciones (
    id INT NOT NULL AUTO_INCREMENT,
    solicitud_id INT NOT NULL,
    usuario_id INT NOT NULL,
    accion ENUM('aprobada','pendiente','negada') DEFAULT 'pendiente',
    comentario TEXT,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (solicitud_id) REFERENCES solicitudes (id) ON DELETE CASCADE,
    FOREIGN KEY (usuario_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Tabla capacitaciones
CREATE TABLE capacitaciones (
    id INT NOT NULL AUTO_INCREMENT,
    nombre VARCHAR(255) NOT NULL,
    preguntas JSON NOT NULL,
    puntos_por_pregunta INT NOT NULL,
    puntaje_maximo INT NOT NULL,
    puntaje_minimo_aprobacion INT NOT NULL,
    vigencia_meses INT NOT NULL,
    creador_id INT NOT NULL,
    codigo_seguridad VARCHAR(10) NOT NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY codigo_seguridad (codigo_seguridad),
    FOREIGN KEY (creador_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Tabla chats
CREATE TABLE chats (
    id INT NOT NULL AUTO_INCREMENT,
    solicitud_id INT NOT NULL,
    tipo ENUM('sst','interventor','soporte') NOT NULL,
    metadatos JSON DEFAULT NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (solicitud_id) REFERENCES solicitudes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Tabla chat_participantes
CREATE TABLE chat_participantes (
    chat_id INT NOT NULL,
    usuario_id INT NOT NULL,
    ultimo_acceso TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    mensajes_no_leidos INT DEFAULT '0',
    PRIMARY KEY (chat_id, usuario_id),
    FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE CASCADE,
    FOREIGN KEY (usuario_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Tabla colaboradores
CREATE TABLE colaboradores (
    id INT NOT NULL AUTO_INCREMENT,
    solicitud_id INT NOT NULL,
    cedula VARCHAR(20) NOT NULL,
    nombre VARCHAR(255) NOT NULL,
    foto VARCHAR(255) DEFAULT NULL,
    cedulaFoto VARCHAR(255) DEFAULT NULL,
    estado TINYINT(1) DEFAULT '1',
    PRIMARY KEY (id),
    FOREIGN KEY (solicitud_id) REFERENCES solicitudes (id) ON DELETE CASCADE,
    KEY idx_colaboradores_cedula (cedula)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE colaboradores 
CHANGE COLUMN cedulaFoto documento_arl VARCHAR(255) DEFAULT NULL;

CREATE TABLE vehiculos (
    id INT NOT NULL AUTO_INCREMENT,
    solicitud_id INT NOT NULL,
    matricula VARCHAR(20) NOT NULL, -- Placa o matrícula del vehículo
    foto VARCHAR(255) DEFAULT NULL,
    tecnomecanica VARCHAR(255) DEFAULT NULL, -- URL del documento tecnomecánica
    soat VARCHAR(255) DEFAULT NULL, -- URL del SOAT
    licencia_conduccion VARCHAR(255) DEFAULT NULL, -- URL de la licencia de conducción
    licencia_transito VARCHAR(255) DEFAULT NULL, -- URL de la licencia de tránsito
    estado TINYINT(1) DEFAULT '1',
    PRIMARY KEY (id),
    FOREIGN KEY (solicitud_id) REFERENCES solicitudes (id) ON DELETE CASCADE,
    KEY idx_vehiculos_matricula (matricula)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Tabla historial_estados_colaboradores
CREATE TABLE historial_estados_colaboradores (
    id INT NOT NULL AUTO_INCREMENT,
    colaborador_id INT NOT NULL,
    solicitud_id INT NOT NULL,
    estado TINYINT(1) NOT NULL,
    fecha_cambio TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (colaborador_id) REFERENCES colaboradores (id) ON DELETE CASCADE,
    FOREIGN KEY (solicitud_id) REFERENCES solicitudes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Tabla mensajes
CREATE TABLE mensajes (
    id INT NOT NULL AUTO_INCREMENT,
    chat_id INT NOT NULL,
    usuario_id INT NOT NULL,
    contenido JSON DEFAULT NULL,
    leido TINYINT(1) DEFAULT '0',
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE CASCADE,
    FOREIGN KEY (usuario_id) REFERENCES users (id) ON DELETE CASCADE,
    KEY idx_chat_fecha (chat_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Tabla plantilla_seguridad_social
CREATE TABLE plantilla_seguridad_social (
    id INT NOT NULL AUTO_INCREMENT,
    colaborador_id INT NOT NULL,
    solicitud_id INT NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (colaborador_id) REFERENCES colaboradores (id) ON DELETE CASCADE,
    FOREIGN KEY (solicitud_id) REFERENCES solicitudes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Tabla plantilla_documentos_vehiculos
CREATE TABLE plantilla_documentos_vehiculos (
    id INT NOT NULL AUTO_INCREMENT,
    vehiculo_id INT NOT NULL,
    solicitud_id INT NOT NULL,
    tipo_documento ENUM('soat', 'tecnomecanica') NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,
    estado ENUM('vigente', 'vencido', 'pendiente') DEFAULT 'vigente',
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (vehiculo_id) REFERENCES vehiculos (id) ON DELETE CASCADE,
    FOREIGN KEY (solicitud_id) REFERENCES solicitudes (id) ON DELETE CASCADE,
    KEY idx_documentos_fecha (fecha_inicio, fecha_fin),
    KEY idx_documentos_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE licencias_vehiculo (
    id INT NOT NULL AUTO_INCREMENT,
    vehiculo_id INT NOT NULL,
    solicitud_id INT NOT NULL,
    tipo ENUM('licencia_conduccion', 'licencia_transito') NOT NULL,
    estado BOOLEAN DEFAULT FALSE,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (vehiculo_id) REFERENCES vehiculos(id) ON DELETE CASCADE,
    FOREIGN KEY (solicitud_id) REFERENCES solicitudes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- Tabla politicas_aceptadas
CREATE TABLE politicas_aceptadas (
    id INT NOT NULL AUTO_INCREMENT,
    usuario_id INT NOT NULL,
    fecha_aceptacion DATETIME NOT NULL,
    ip_aceptacion VARCHAR(50) DEFAULT NULL,
    documento_url VARCHAR(255) DEFAULT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (usuario_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Tabla politicas_aceptadas_colaboradores
CREATE TABLE politicas_aceptadas_colaboradores (
    id INT NOT NULL AUTO_INCREMENT,
    colaborador_id INT NOT NULL,
    fecha_aceptacion DATETIME NOT NULL,
    ip_aceptacion VARCHAR(50) DEFAULT NULL,
    documento_url VARCHAR(255) DEFAULT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY (colaborador_id) REFERENCES colaboradores (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Tabla registros
CREATE TABLE registros (
    id INT NOT NULL AUTO_INCREMENT,
    colaborador_id INT NOT NULL,
    solicitud_id INT NOT NULL,
    usuario_id INT NOT NULL,
    tipo ENUM('entrada','salida') NOT NULL,
    fecha_hora DATETIME NOT NULL,
    estado_actual VARCHAR(50) NOT NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (colaborador_id) REFERENCES colaboradores (id) ON DELETE CASCADE,
    FOREIGN KEY (solicitud_id) REFERENCES solicitudes (id) ON DELETE CASCADE,
    FOREIGN KEY (usuario_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

 CREATE TABLE IF NOT EXISTS registros_vehiculos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    vehiculo_id INT NOT NULL,
    solicitud_id INT NOT NULL,
    usuario_id INT NOT NULL,
    tipo ENUM('entrada', 'salida') NOT NULL,
    fecha_hora DATETIME NOT NULL,
    estado_actual VARCHAR(50) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (vehiculo_id) REFERENCES vehiculos(id),
    FOREIGN KEY (solicitud_id) REFERENCES solicitudes(id),
    FOREIGN KEY (usuario_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Tabla resultados_capacitaciones
CREATE TABLE resultados_capacitaciones (
    id INT NOT NULL AUTO_INCREMENT,
    capacitacion_id INT NOT NULL,
    colaborador_id INT NOT NULL,
    solicitud_id INT NOT NULL,
    respuestas JSON NOT NULL,
    puntaje_obtenido INT NOT NULL,
    estado ENUM('APROBADO','PERDIDO') NOT NULL,
    fecha_vencimiento DATETIME NOT NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (capacitacion_id) REFERENCES capacitaciones (id),
    FOREIGN KEY (colaborador_id) REFERENCES colaboradores (id),
    FOREIGN KEY (solicitud_id) REFERENCES solicitudes (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Tabla sst_documentos
CREATE TABLE sst_documentos (
    id INT NOT NULL AUTO_INCREMENT,
    solicitud_id INT NOT NULL,
    url VARCHAR(255) NOT NULL,
    fecha_de_subida TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (solicitud_id) REFERENCES solicitudes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Inserción de datos iniciales
INSERT INTO roles (id, role_name) VALUES
(1, 'contratista'),
(2, 'sst'),
(3, 'interventor'),
(4, 'seguridad'),
(5, 'capacitacion'),
(6, 'soporte');
 
INSERT INTO lugares (id, nombre_lugar) VALUES
(1, 'BASCULA'),
(2, 'CAMPAMENTO'),
(3, 'MINA'),
(4, 'MINA PIT 3X'),
(5, 'OFICINAS PLATAFORMA'),
(6, 'PARQUEADERO PATIO ACOPIO'),
(7, 'PATIO DE ACOPIO'),
(8, 'PLATAFORMA'),
(9, 'Sator'),
(10, 'TALLERES');

INSERT INTO users (username,password,role_id,empresa,nit,email) VALUES
	 ('CONTRATISTA1','$2b$10$k3CtiKwuO0q/BTSJ4LOKn.xMpcu/L2OJcMGQH1uKFLLPeJEARd6Qe',1,'Contratista Ltda.','123456789','jcdesarrollo25@gmail.com'),
	 ('INTERVENTOR 1','$2b$10$wHCaz4g5Vk7pPzVGiEOCqeZbDncZLo06KAj6x7WAOgrgiL1Oe3tKK',3,'Interventor Sator','123456789','jcdesarrollo25@gmail.com'),
	 ('COA','$2b$10$n7qozRtfeJ6/fA3CnJnr8uaEntaeKb/rL4fKOVhVyI9KF4ILtP5la',3,'Fortox','860046201-2','jcdesarrollo25@gmail.com'),
	 ('Sator','$2b$10$g6k3IV4JdiW2M9ww84r6EetkxAyJGjQaZaspgrYu4Re2nF9C7odeq',4,'Sator','890110985-0',NULL),
	 ('SST SATOR','$2b$10$Ry9DNb5caCb2X1qLHcyi4e47PMgGfpZUBQlC8eVE2eGCABIOTlyzC',2,'SATOR','890110985-0',NULL),
	 ('BASCULA','$2b$10$FOrUjvjJtv/.CBdlBQSmAeHT26mUxBgFchYNQnc15f6am1d66U4G.',4,'SATOR','890110985-0',NULL),
	 ('CAMPAMENTO','$2b$10$NGI3yUqcLYtYAI9zWbCLs.pIblrl4mKztKigGWE5bmkDZYUA1TRL2',4,'SATOR','890110985-0',NULL),
	 ('MINA','$2b$10$Rfog1FYU1dnegL5tPSNE.u.YATdsYZ0vssJH3jCxS6I4m0M4gBzHi',4,'SATOR','890110985-0',NULL),
	 ('MINA PIT 3X','$2b$10$J34bkRYANHrEO1jRiuGHm.nUBAsN693YCFQrIW2mi7k4csvJZhWyS',4,'SATOR','890110985-0',NULL),
	 ('OFICINA PLATAFORMA','$2b$10$iEpAkYJ5F4v/1DcyUaeMG.Ry.pi5F10BRujKt8S0qH7O00PdvXOGm',4,'SATOR','890110985-0',NULL);
INSERT INTO users (username,password,role_id,empresa,nit,email) VALUES
	 ('PARQ PATIO ACOP','$2b$10$pH2mivDrNK3fmJPDAXsLpeIp2ddCCoXmnSkvr3n3sRsStdp/2x5a.',4,'SATOR','890110985-0',NULL),
	 ('PLATAFORMA','$2b$10$ldPWwR6gPxQbpxxGdyjube2kIRjwCcZ.uDTy5hI/iXLf7e.nKe/VK',4,'SATOR','890110985-0',NULL),
	 ('TALLERES','$2b$10$ddRpSuBzPtjzIyFffmhm0OF/X1Xt8gNBRwr/BeAULR5/i3469/ZLC',4,'SATOR','890110985-0',NULL),
	 ('soporte','$2b$10$1o7MSnOJbfn/RciWj4IkMOlvw1jeaKgk1i1EdR5K4vVjUZE33Iqpq',6,'FORTOX','860046201-2','jcdesarrollo25@gmail.com');


INSERT INTO capacitaciones (nombre,preguntas,puntos_por_pregunta,puntaje_maximo,puntaje_minimo_aprobacion,vigencia_meses,creador_id,codigo_seguridad,created_at,updated_at) VALUES
	 ('Capacitación SATOR','[{"texto": "SI O NO", "opciones": ["SI", "NO"], "respuesta_correcta": 0}, {"texto": "SI O NO", "opciones": ["SI", "NO"], "respuesta_correcta": 0}]',5,10,5,12,5,'49FB','2025-05-23 19:24:09','2025-05-23 19:24:09');


-- =============================================
-- IMPORTANTE: Este script borrará todos los datos
-- de las tablas excepto capacitaciones, users, roles y lugares
-- =============================================

-- Desactivar restricciones de clave foránea para permitir el truncado
-- SET FOREIGN_KEY_CHECKS = 0;

-- Truncar todas las tablas excepto users, roles y lugares
-- Se mantienen los datos de configuración inicial
-- TRUNCATE TABLE acciones;
-- TRUNCATE TABLE chat_participantes;
-- TRUNCATE TABLE mensajes;
-- TRUNCATE TABLE chats;
-- TRUNCATE TABLE historial_estados_colaboradores;
-- TRUNCATE TABLE plantilla_seguridad_social;
-- TRUNCATE TABLE politicas_aceptadas_colaboradores;
-- TRUNCATE TABLE registros;
-- TRUNCATE TABLE registros_vehiculos;
-- TRUNCATE TABLE resultados_capacitaciones;
-- TRUNCATE TABLE sst_documentos;
-- TRUNCATE TABLE colaboradores;
-- TRUNCATE TABLE vehiculos;
-- TRUNCATE TABLE solicitudes;
-- TRUNCATE TABLE politicas_aceptadas;
-- TRUNCATE TABLE plantilla_documentos_vehiculos;
-- TRUNCATE TABLE licencias_vehiculo;

-- Reactivar restricciones de clave foránea
-- SET FOREIGN_KEY_CHECKS = 1;