const mongoose = require('mongoose');
const { logger } = require('../utils/logger');

const connectToDatabase = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    logger.info("✅ Connexion à MongoDB établie");
  } catch (error) {
    logger.error("❌ Échec de la connexion à MongoDB", error);
    process.exit(1);
  }
};

module.exports = connectToDatabase;