// payment-service/models/Transaction.js
const mongoose = require('mongoose');

/**
 * Transaction Schema
 * Note: This is a local schema for tracking transactions
 * The actual data is stored in the database-service
 */
const transactionSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    required: true,
    default: 'eur'
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  productId: {
    type: String,
    required: true
  },
  paymentMethod: {
    type: String,
    enum: ['stripe', 'paypal'],
    required: true
  },
  sessionId: {
    type: String,
    index: true
  },
  paymentIntentId: {
    type: String,
    sparse: true,
    index: true
  },
  stripeCustomerId: {
    type: String,
    sparse: true,
    index: true
  },
  refundId: {
    type: String,
    sparse: true
  },
  metadata: {
    type: Map,
    of: String
  }
}, {
  timestamps: true
});

// Create composite index for faster lookups
transactionSchema.index({ userId: 1, status: 1 });

// Optional: Virtual property for converting amount to currency format
transactionSchema.virtual('formattedAmount').get(function() {
  return (this.amount / 100).toFixed(2);
});

module.exports = mongoose.model('Transaction', transactionSchema);