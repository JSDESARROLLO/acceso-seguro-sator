const jwt = require('jsonwebtoken');
const SECRET_KEY = process.env.JWT_SECRET || 'secreto';

const generateSurveyToken = (codigo) => {
    return jwt.sign({ codigo }, SECRET_KEY, { expiresIn: '1h' });
};

const verifySurveyToken = (req, res, next) => {
    const token = req.cookies.survey_token;

    if (!token) {
        return res.redirect(`/capacitacion/acceso?redirect=${encodeURIComponent(req.originalUrl)}`);
    }

    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        req.surveyCode = decoded.codigo;
        next();
    } catch (error) {
        res.clearCookie('survey_token');
        return res.redirect(`/capacitacion/acceso?redirect=${encodeURIComponent(req.originalUrl)}`);
    }
};

module.exports = { generateSurveyToken, verifySurveyToken };