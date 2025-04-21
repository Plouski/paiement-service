const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const UserSchema = new Schema({
  email: {
    type: String,
    trim: true,
    lowercase: true,
    unique: true
  },
  firstName: {
    type: String,
    trim: true
  },
  lastName: {
    type: String,
    trim: true
  },
  password: {
    type: String
  },
  phoneNumber: {
    type: String,
    trim: true
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  verificationToken: {
    type: String
  },
  resetCode: {
    type: String
  },
  resetCodeExpires: {
    type: Date
  },
  oauth: {
    provider: {
      type: String,
      enum: ['google', 'facebook', 'apple', 'github']
    },
    providerId: {
      type: String
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Méthode pour vérifier si un utilisateur est admin
UserSchema.methods.isAdmin = function () {
  return this.role === 'admin';
};

// Méthode pour générer un objet utilisateur sans données sensibles
UserSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.password;
  delete user.resetCode;
  delete user.resetCodeExpires;
  delete user.verificationToken;
  return user;
};

module.exports = mongoose.model('User', UserSchema);