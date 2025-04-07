// payment-service/middlewares/authMiddleware.js
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { logger } = require('../utils/logger');

// Base URL for auth service
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:5001';

/**
 * Middleware to verify JWT and authenticate user
 */
const authMiddleware = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized - No token provided'
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Option 1: Verify token locally
    if (process.env.JWT_SECRET) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        return next();
      } catch (error) {
        logger.error(`Error verifying JWT locally: ${error.message}`);
        // Fall through to Option 2 if local verification fails
      }
    }
    
    // Option 2: Verify token via auth-service
    try {
      const response = await axios.get(`${AUTH_SERVICE_URL}/auth/verify-token`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.data && response.data.valid) {
        req.user = response.data.user;
        return next();
      } else {
        return res.status(401).json({
          error: 'Unauthorized - Invalid token'
        });
      }
    } catch (error) {
      logger.error(`Error verifying token with auth-service: ${error.message}`);
      return res.status(401).json({
        error: 'Unauthorized - Token verification failed'
      });
    }
  } catch (error) {
    logger.error(`Authentication error: ${error.message}`);
    return res.status(500).json({
      error: 'Internal server error during authentication'
    });
  }
};

module.exports = authMiddleware;