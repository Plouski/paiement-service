// config/db.js
const mongoose = require('mongoose');
const { logger } = require('../utils/logger');

const connectToDatabase = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    logger.info("✅ Connexion à MongoDB établie");
  } catch (error) {
    logger.error("❌ Échec de la connexion à MongoDB", error);
    process.exit(1); // Arrêter l'app si la connexion échoue
  }
};

module.exports = connectToDatabase;