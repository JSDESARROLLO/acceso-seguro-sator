const checkRole = (role) => {
    return (req, res, next) => {
        if (req.user && req.user.role === role) {
            next(); // Si el rol es el correcto, continuar
        } else {
            // Redirigir según el rol del usuario
            switch (req.user?.role) {
                case 'contratista':
                    return res.redirect('/vista-contratista');
                case 'sst':
                    return res.redirect('/vista-sst');
                case 'interventor':
                    return res.redirect('/vista-interventor');
                case 'seguridad':
                    return res.redirect('/vista-seguridad');
                case 'capacitacion':
                    return res.redirect('/capacitacion/listado');
                default:
                    return res.redirect('/login');
            }
        }
    };
};

module.exports = checkRole;
