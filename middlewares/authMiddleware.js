// middlewares/authMiddleware.js - Amélioré
const jwt = require('jsonwebtoken');
const { logger } = require('../utils/logger');

/**
 * Middleware pour vérifier l'authentification utilisateur
 * Vérifie que la requête contient un token JWT valide
 */
const authMiddleware = (req, res, next) => {
  // Vérifier d'abord si c'est une requête de service
  if (req.isServiceRequest) {
    return next();
  }

  // Récupérer le token depuis différentes sources possibles
  const authHeader = req.headers.authorization;
  const tokenFromCookie = req.cookies?.token;
  const tokenFromQuery = req.query.token;

  let token = null;

  // Priorité à l'en-tête Authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (tokenFromCookie) {
    token = tokenFromCookie;
  } else if (tokenFromQuery) {
    token = tokenFromQuery;
  }

  if (!token) {
    return res.status(401).json({ 
      success: false,
      message: 'Authentification requise'
    });
  }

  try {
    // Vérifier et décoder le token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Stocker les informations utilisateur dans la requête
    req.user = {
      userId: decoded.userId,
      // id: decoded.userId,
      email: decoded.email,
      role: decoded.role || 'user'
    };

    logger.debug('Utilisateur authentifié', {
      userId: decoded.userId,
      // id: decoded.userId,
      path: req.path,
      method: req.method
    });

    next();
  } catch (error) {
    logger.warn('Erreur de validation du token', {
      error: error.message,
      path: req.path,
      method: req.method
    });

    // Gestion des différents types d'erreurs JWT
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false,
        message: 'Session expirée, veuillez vous reconnecter',
        code: 'TOKEN_EXPIRED'
      });
    }

    return res.status(401).json({ 
      success: false,
      message: 'Authentification invalide',
      code: 'INVALID_TOKEN'
    });
  }
};

/**
 * Middleware pour vérifier les rôles utilisateur
 * @param {Array} roles - Tableau des rôles autorisés
 */
const roleMiddleware = (roles = []) => {
  return (req, res, next) => {
    // Vérifier si l'utilisateur est authentifié
    if (!req.user) {
      return res.status(401).json({ 
        success: false,
        message: 'Authentification requise'
      });
    }

    // Si requête de service, bypass la vérification des rôles
    if (req.isServiceRequest) {
      return next();
    }

    // Vérifier si le rôle de l'utilisateur est dans la liste des rôles autorisés
    if (roles.length > 0 && !roles.includes(req.user.role)) {
      logger.warn('Accès refusé - rôle insuffisant', {
        userId: req.user.userId,
        userRole: req.user.role,
        requiredRoles: roles,
        path: req.path,
        method: req.method
      });

      return res.status(403).json({ 
        success: false,
        message: 'Accès refusé - permissions insuffisantes'
      });
    }

    next();
  };
};

module.exports = {
  authMiddleware,
  roleMiddleware
};