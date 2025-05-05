# Lista de 100 nombres reales inventados
nombres = [
    "Juan Pérez", "María Gómez", "Carlos Rodríguez", "Ana López", "Luis Martínez",
    "Sofía Hernández", "Diego Sánchez", "Laura Ramírez", "Javier Torres", "Valentina Díaz",
    "Andrés Castro", "Camila Morales", "Felipe Vargas", "Isabella Rojas", "Mateo Fernández",
    "Lucía Ortiz", "Santiago Mendoza", "Daniela Silva", "Miguel Ángel", "Valeria Cruz",
    "Sebastián Paredes", "Paula Rivas", "Gabriel Navarro", "Emma Salazar", "Alejandro Vega",
    "Clara Guerrero", "Nicolás Campos", "Mariana León", "Iván Escobar", "Renata Delgado",
    "Emilio Suárez", "Juliana Acosta", "Martín Palacios", "Sara Molina", "David Romero",
    "Elena Castillo", "Pablo Rivera", "Victoria Guzmán", "Ricardo Flores", "Mónica Cordero",
    "Jorge Salazar", "Natalia Méndez", "Eduardo Peña", "Andrea Quiroz", "Simón Arias",
    "Catalina Bravo", "Francisco Luna", "Gabriela Ponce", "Tomás Rueda", "Lina Escobar",
    "Samuel Ortiz", "Carolina Vega", "Alonso Duarte", "Fernanda Tapia", "Ignacio Peralta",
    "Diana Montero", "Leonardo Gil", "Teresa Osorio", "Hugo Serrano", "Verónica Lazo",
    "Raúl Franco", "Patricia Solís", "Esteban Vásquez", "Lorena Castaño", "Óscar Beltrán",
    "Carmen Pineda", "Álvaro Rincón", "Rebeca Jaramillo", "Cristian Avendaño", "Adriana Hoyos",
    "Manuel Sosa", "Silvia Calderón", "Fabio Murillo", "Inés Parra", "Rodrigo Téllez",
    "Marina Ulloa", "Germán Zapata", "Alicia Becerra", "César Amaya", "Margarita Lagos",
    "Héctor Prado", "Roxana Saavedra", "Federico Corrales", "Liliana Ocampo", "Armando Quintero",
    "Estefanía Rosales", "Guillermo Serna", "Susana Villalba", "Mauricio Zapata", "Angélica Mora",
    "Enrique Pardo", "Claudia Rangel", "Feliciano Tovar", "Miriam Valencia", "Salvador Yépez",
    "Beatriz Zavala", "Orlando Aguilera", "Dora Betancourt", "Ramiro Caicedo", "Elisa Durán"
]

# Parámetros comunes
solicitud_id = 1
foto = "'https://gestion-contratistas-os.nyc3.digitaloceanspaces.com/images/vehiculos/2b7be9a2-30f7-41ad-84a9-79ecc2671674.webp'"
documento_arl = "'https://gestion-contratistas-os.nyc3.digitaloceanspaces.com/images/vehiculos/37dd94a6-d2b4-4e3c-9317-0cfe6737afb5.pdf'"
estado = 1
cedula_inicial = 123123

# Generar el INSERT SQL
print("INSERT INTO colaboradores (solicitud_id, cedula, nombre, foto, documento_arl, estado) VALUES")
values = []
for i, nombre in enumerate(nombres):
    cedula = str(cedula_inicial + i)
    values.append(f"({solicitud_id}, '{cedula}', '{nombre}', {foto}, {documento_arl}, {estado})")
print(",\n".join(values) + ";")