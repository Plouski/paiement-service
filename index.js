// payment-service/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');

// Import routes
const premiumRoutes = require('./routes/premiumRoutes');
const webhookRoutes = require('./routes/webhookRoutes');

// Initialize express app
const app = express();
const PORT = process.env.PORT || 5004;

// Middlewares
app.use(helmet()); // Security headers
app.use(cors());
app.use(morgan('combined')); // Logging

// Body parser for regular routes
app.use(express.json());

// Routes
app.use('/premium', premiumRoutes);
app.use('/webhooks', webhookRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'payment-service is up and running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  const { logger } = require('./utils/logger');
  logger.error(err.stack);
  
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal Server Error',
      code: err.code || 'INTERNAL_ERROR'
    }
  });
});

// Start the server
app.listen(PORT, () => {
  const { logger } = require('./utils/logger');
  logger.info(`Payment service running on port ${PORT}`);
});

module.exports = app;