// exchangeRateService.js - Real-time Exchange Rate Service for Cross-Border Payments
const axios = require('axios');

class ExchangeRateService {
  constructor() {
    // Multiple API providers for redundancy
    this.providers = {
      primary: 'https://api.exchangerate-api.com/v4/latest/USD',
      backup: 'https://open.er-api.com/v6/latest/USD',
      coinGecko: 'https://api.coingecko.com/api/v3/simple/price'
    };

    // Cache configuration
    this.cache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
    
    // Fee structure
    this.fees = {
      base: 0.01, // 1% base fee
      network: 0.10, // Fixed network fee in USDC
      minimum: 0.50, // Minimum fee in USDC
      byCountry: {
        'KE': 0.008, // 0.8% for Kenya
        'NG': 0.010, // 1.0% for Nigeria
        'ZA': 0.009, // 0.9% for South Africa
        'GH': 0.010, // 1.0% for Ghana
        'UG': 0.010, // 1.0% for Uganda
        'RW': 0.010  // 1.0% for Rwanda
      }
    };

    // Last successful fetch timestamp
    this.lastFetch = null;
    this.fetchInterval = 5 * 60 * 1000; // Refresh every 5 minutes
  }

  // ==================== EXCHANGE RATE FETCHING ====================

  async getRate(fromCurrency, toCurrency) {
    const cacheKey = `${fromCurrency}_${toCurrency}`;
    
    // Check cache first
    const cached = this.getCachedRate(cacheKey);
    if (cached) {
      console.log(`💰 Using cached rate: 1 ${fromCurrency} = ${cached} ${toCurrency}`);
      return cached;
    }

    try {
      // Fetch from primary API
      console.log(`🔄 Fetching exchange rate: ${fromCurrency} → ${toCurrency}`);
      
      const response = await axios.get(this.providers.primary, {
        timeout: 10000
      });

      if (!response.data || !response.data.rates) {
        throw new Error('Invalid API response');
      }

      const rate = response.data.rates[toCurrency];

      if (!rate) {
        throw new Error(`Currency ${toCurrency} not found`);
      }

      // Cache the rate
      this.cacheRate(cacheKey, rate);
      this.lastFetch = Date.now();

      console.log(`✅ Exchange rate fetched: 1 ${fromCurrency} = ${rate} ${toCurrency}`);
      return rate;

    } catch (error) {
      console.warn(`⚠️ Primary API failed: ${error.message}, trying backup...`);
      
      try {
        // Try backup API
        const response = await axios.get(this.providers.backup, {
          timeout: 10000
        });

        const rate = response.data.rates[toCurrency];
        
        if (rate) {
          this.cacheRate(cacheKey, rate);
          console.log(`✅ Exchange rate from backup: 1 ${fromCurrency} = ${rate} ${toCurrency}`);
          return rate;
        }
      } catch (backupError) {
        console.error('❌ All exchange rate APIs failed:', backupError.message);
      }

      // Return fallback rates if all APIs fail
      return this.getFallbackRate(toCurrency);
    }
  }

  async getAllRates(baseCurrency = 'USD') {
    try {
      const response = await axios.get(this.providers.primary, {
        timeout: 10000
      });

      return response.data.rates;
    } catch (error) {
      console.error('❌ Error fetching all rates:', error.message);
      return {};
    }
  }

  // ==================== REMITTANCE CALCULATION ====================

  async calculateRemittance(amountUSDC, toCurrency, countryCode = null) {
    try {
      // Get exchange rate
      const exchangeRate = await this.getRate('USD', toCurrency);

      // Calculate fees
      const feePercentage = countryCode && this.fees.byCountry[countryCode] 
        ? this.fees.byCountry[countryCode] 
        : this.fees.base;

      const percentageFee = amountUSDC * feePercentage;
      const networkFee = this.fees.network;
      const totalFee = Math.max(percentageFee + networkFee, this.fees.minimum);

      // Calculate net amount
      const netAmount = amountUSDC - totalFee;
      
      if (netAmount <= 0) {
        throw new Error('Amount too small after fees');
      }

      // Calculate receive amount in local currency
      const receiveAmount = netAmount * exchangeRate;

      return {
        // Send details
        sendAmount: amountUSDC,
        sendCurrency: 'USDC',
        
        // Receive details
        receiveAmount: parseFloat(receiveAmount.toFixed(2)),
        receiveCurrency: toCurrency,
        
        // Exchange rate
        exchangeRate: parseFloat(exchangeRate.toFixed(4)),
        
        // Fee breakdown
        fee: parseFloat(totalFee.toFixed(2)),
        feePercentage: (feePercentage * 100).toFixed(2) + '%',
        networkFee: parseFloat(networkFee.toFixed(2)),
        
        // Summary
        netAmount: parseFloat(netAmount.toFixed(2)),
        effectiveRate: parseFloat((receiveAmount / amountUSDC).toFixed(4)),
        
        // Comparison
        savings: this.calculateSavings(amountUSDC, totalFee)
      };
    } catch (error) {
      console.error('❌ Error calculating remittance:', error.message);
      throw error;
    }
  }

  calculateSavings(amount, fee) {
    // Compare with traditional services (avg 5% fee)
    const traditionalFee = amount * 0.05;
    const saved = traditionalFee - fee;
    const percentSaved = ((saved / traditionalFee) * 100).toFixed(1);

    return {
      saved: parseFloat(saved.toFixed(2)),
      percentSaved: parseFloat(percentSaved),
      traditionalFee: parseFloat(traditionalFee.toFixed(2))
    };
  }

  // ==================== RATE COMPARISON ====================

  async compareRates(amountUSDC, currencies) {
    const comparisons = [];

    for (const currency of currencies) {
      try {
        const calculation = await this.calculateRemittance(amountUSDC, currency);
        comparisons.push({
          currency,
          ...calculation
        });
      } catch (error) {
        console.error(`Failed to get rate for ${currency}:`, error.message);
      }
    }

    return comparisons;
  }

  // ==================== RATE ALERTS ====================

  async getRateAlert(fromCurrency, toCurrency, targetRate) {
    const currentRate = await this.getRate(fromCurrency, toCurrency);
    
    const difference = ((currentRate - targetRate) / targetRate) * 100;
    const alert = {
      currentRate,
      targetRate,
      difference: parseFloat(difference.toFixed(2)),
      triggered: difference >= 0,
      message: difference >= 0 
        ? `Rate reached! Current: ${currentRate}, Target: ${targetRate}` 
        : `Not yet. Current: ${currentRate}, Target: ${targetRate}`
    };

    return alert;
  }

  // ==================== CACHE MANAGEMENT ====================

  getCachedRate(key) {
    const cached = this.cache.get(key);
    
    if (!cached) return null;
    
    if (Date.now() - cached.timestamp > this.cacheExpiry) {
      this.cache.delete(key);
      return null;
    }
    
    return cached.rate;
  }

  cacheRate(key, rate) {
    this.cache.set(key, {
      rate,
      timestamp: Date.now()
    });
  }

  clearCache() {
    this.cache.clear();
    console.log('✅ Exchange rate cache cleared');
  }

  // ==================== FALLBACK RATES ====================

  getFallbackRate(toCurrency) {
    console.warn(`⚠️ Using fallback rate for ${toCurrency}`);
    
    // Approximate rates as of 2024 (for fallback only)
    const fallbackRates = {
      'KES': 129.00,  // Kenyan Shilling
      'NGN': 775.00,  // Nigerian Naira
      'ZAR': 18.50,   // South African Rand
      'GHS': 12.00,   // Ghanaian Cedi
      'UGX': 3750.00, // Ugandan Shilling
      'RWF': 1100.00, // Rwandan Franc
      'USD': 1.00,
      'EUR': 0.92,
      'GBP': 0.79
    };

    return fallbackRates[toCurrency] || 1.0;
  }

  // ==================== RATE HISTORY ====================

  async getRateHistory(fromCurrency, toCurrency, days = 7) {
    // This would require a historical data API
    // For now, return current rate
    const currentRate = await this.getRate(fromCurrency, toCurrency);
    
    return {
      currency: toCurrency,
      currentRate,
      history: [
        // Would be populated with historical data
        { date: new Date().toISOString(), rate: currentRate }
      ]
    };
  }

  // ==================== UTILITY FUNCTIONS ====================

  async getMultipleRates(currencies) {
    const rates = {};
    
    for (const currency of currencies) {
      try {
        rates[currency] = await this.getRate('USD', currency);
      } catch (error) {
        console.error(`Failed to get rate for ${currency}`);
        rates[currency] = null;
      }
    }
    
    return rates;
  }

  formatAmount(amount, currency) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency === 'USDC' ? 'USD' : currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }

  // ==================== RATE VALIDITY ====================

  isRateStale() {
    if (!this.lastFetch) return true;
    return Date.now() - this.lastFetch > this.fetchInterval;
  }

  async refreshRatesIfNeeded() {
    if (this.isRateStale()) {
      console.log('🔄 Refreshing stale exchange rates...');
      this.clearCache();
    }
  }

  // ==================== FEE CALCULATOR ====================

  calculateFee(amount, countryCode = null) {
    const feePercentage = countryCode && this.fees.byCountry[countryCode]
      ? this.fees.byCountry[countryCode]
      : this.fees.base;

    const percentageFee = amount * feePercentage;
    const totalFee = Math.max(percentageFee + this.fees.network, this.fees.minimum);

    return {
      totalFee: parseFloat(totalFee.toFixed(2)),
      percentageFee: parseFloat(percentageFee.toFixed(2)),
      networkFee: this.fees.network,
      feePercentage: (feePercentage * 100).toFixed(2) + '%'
    };
  }

  // ==================== STATS ====================

  getStats() {
    return {
      cacheSize: this.cache.size,
      lastFetch: this.lastFetch ? new Date(this.lastFetch).toISOString() : null,
      cacheExpiry: `${this.cacheExpiry / 1000 / 60} minutes`,
      isStale: this.isRateStale(),
      supportedCurrencies: ['KES', 'NGN', 'ZAR', 'GHS', 'UGX', 'RWF']
    };
  }
}

// Singleton instance
let exchangeRateServiceInstance = null;

function getExchangeRateService() {
  if (!exchangeRateServiceInstance) {
    exchangeRateServiceInstance = new ExchangeRateService();
  }
  return exchangeRateServiceInstance;
}

module.exports = {
  ExchangeRateService,
  getExchangeRateService
};