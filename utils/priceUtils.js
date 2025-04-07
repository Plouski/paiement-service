// payment-service/utils/priceUtils.js

/**
 * Format amount for payment processing
 * Converts decimal amount to the smallest currency unit (e.g., cents for EUR/USD)
 * @param {number} amount - The amount in decimal (e.g., 10.99)
 * @param {string} currency - Currency code (default: 'eur')
 * @returns {number} - The amount in smallest currency unit
 */
const formatAmount = (amount, currency = 'eur') => {
    // Handle potential string input
    const numericAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    
    // Determine how many decimal places the currency uses
    // Most currencies use 2 decimal places (e.g., EUR, USD)
    const currencyDecimalPlaces = {
      'eur': 2,
      'usd': 2,
      'gbp': 2,
      'jpy': 0, // Japanese yen doesn't use decimal places
      'krw': 0  // Korean won doesn't use decimal places
    };
    
    const decimalPlaces = currencyDecimalPlaces[currency.toLowerCase()] || 2;
    
    // Convert to smallest currency unit
    return Math.round(numericAmount * Math.pow(10, decimalPlaces));
  };
  
  /**
   * Format currency for display
   * @param {number} amount - The amount in smallest currency unit (e.g., cents)
   * @param {string} currency - Currency code (default: 'eur')
   * @returns {string} - Formatted currency string
   */
  const formatCurrency = (amount, currency = 'eur') => {
    // Get the currency symbol
    const currencySymbols = {
      'eur': '€',
      'usd': '$',
      'gbp': '£',
      'jpy': '¥',
      'krw': '₩'
    };
    
    // Determine symbol and decimal places
    const symbol = currencySymbols[currency.toLowerCase()] || currency.toUpperCase();
    const decimalPlaces = ['jpy', 'krw'].includes(currency.toLowerCase()) ? 0 : 2;
    
    // Convert from smallest unit to decimal
    const decimalAmount = amount / Math.pow(10, decimalPlaces);
    
    // Format based on the currency
    if (['eur', 'krw'].includes(currency.toLowerCase())) {
      // Symbol after number
      return `${decimalAmount.toFixed(decimalPlaces)} ${symbol}`;
    } else {
      // Symbol before number
      return `${symbol}${decimalAmount.toFixed(decimalPlaces)}`;
    }
  };
  
  module.exports = {
    formatAmount,
    formatCurrency
  };