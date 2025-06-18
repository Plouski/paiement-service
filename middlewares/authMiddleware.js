const JwtConfig = require('../config/jwtConfig');
const logger = require('../utils/logger');

// Middleware de vérification d'authentification
const authMiddleware = (req, res, next) => {

  const token =
    req.headers.authorization?.split(' ')[1] ||
    req.cookies?.accessToken ||
    req.headers['x-access-token'] ||
    req.query.token;

  if (!token) {
    logger.warn('🔒 Tentative d\'accès sans token.');
    return res.status(401).json({ message: 'Authentification requise.' });
  }

  try {

    const decoded = JwtConfig.verifyToken(token);

    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
    };

    next();
  } catch (error) {
    logger.warn('🔒 Token invalide ou expiré.', { error: error.message });

    if (error.message === 'Token expiré') {
      return res.status(401).json({
        message: 'Session expirée, veuillez vous reconnecter.',
        code: 'TOKEN_EXPIRED',
      });
    }

    return res.status(401).json({
      message: 'Authentification invalide.',
      code: 'INVALID_TOKEN',
    });
  }
};

// Middleware de vérification des rôles
const roleMiddleware = (roles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      logger.warn('🔒 Accès refusé - utilisateur non authentifié.');
      return res.status(401).json({ message: 'Authentification requise.' });
    }

    const userRole = req.user.role || 'user';

    if (roles.length && !roles.includes(userRole)) {
      logger.warn('🚫 Accès refusé - rôle insuffisant.', {
        userId: req.user.userId,
        userRole,
        requiredRoles: roles,
      });

      return res.status(403).json({
        message: 'Accès refusé - permissions insuffisantes.',
      });
    }

    next();
  };
};

module.exports = {
  authMiddleware,
  roleMiddleware,
};
