// payment-service/models/Subscription.js
const mongoose = require('mongoose');

/**
 * Subscription Schema
 * Note: This is a local schema for tracking subscriptions
 * The actual data is stored in the database-service
 */
const subscriptionSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  subscriptionId: {
    type: String,
    required: true,
    unique: true
  },
  status: {
    type: String,
    enum: ['active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'trialing', 'paused'],
    default: 'active'
  },
  priceId: {
    type: String,
    required: true
  },
  productId: {
    type: String,
    required: true
  },
  currentPeriodStart: {
    type: Date,
    required: true
  },
  currentPeriodEnd: {
    type: Date,
    required: true
  },
  cancelAtPeriodEnd: {
    type: Boolean,
    default: false
  },
  canceledAt: {
    type: Date
  },
  endedAt: {
    type: Date
  },
  stripeCustomerId: {
    type: String,
    required: true
  },
  paymentMethod: {
    type: String,
    enum: ['stripe', 'paypal'],
    default: 'stripe'
  },
  paymentStatus: {
    type: String,
    enum: ['paid', 'pending', 'failed'],
    default: 'paid'
  },
  latestInvoiceId: {
    type: String
  },
  metadata: {
    type: Map,
    of: String
  }
}, {
  timestamps: true
});

// Create indexes for faster lookups
subscriptionSchema.index({ subscriptionId: 1 });
subscriptionSchema.index({ userId: 1, status: 1 });

// Virtual property to determine if subscription is active
subscriptionSchema.virtual('isActive').get(function() {
  return ['active', 'trialing'].includes(this.status) && 
         (!this.endedAt || this.endedAt > new Date());
});

module.exports = mongoose.model('Subscription', subscriptionSchema);