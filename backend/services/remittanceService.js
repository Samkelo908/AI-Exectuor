// services/remittanceService.js - Complete Remittance Orchestration
const { getExchangeRateService } = require('./exchangeRateService');
const { getCrossBorderService } = require('./crossBorderService');

class RemittanceService {
  constructor(thirdwebPayments, firebaseService) {
    this.payments = thirdwebPayments;
    this.firebase = firebaseService;
    this.exchangeRates = getExchangeRateService();
    this.crossBorder = getCrossBorderService(firebaseService);
  }

  // ==================== SEND REMITTANCE ====================

  /**
   * Complete remittance flow: Calculate → Execute → Deliver
   */
  async sendRemittance(userId, remittanceData) {
    console.log(`[REMITTANCE] 🌍 Starting cross-border transfer for user: ${userId}`);
    
    try {
      // Step 1: Get recipient details
      console.log('[REMITTANCE] 📋 Step 1: Fetching recipient details...');
      const recipient = await this.crossBorder.getRecipient(remittanceData.recipientId);
      
      if (!recipient) {
        throw new Error('Recipient not found');
      }

      console.log(`[REMITTANCE] ✅ Recipient: ${recipient.name} in ${recipient.country}`);

      // Step 2: Calculate exchange rate and fees
      console.log('[REMITTANCE] 💱 Step 2: Calculating exchange rate and fees...');
      const calculation = await this.exchangeRates.calculateRemittance(
        remittanceData.amount,
        recipient.currency
      );

      console.log('[REMITTANCE] 📊 Calculation:', {
        sendAmount: calculation.sendAmount,
        receiveAmount: calculation.receiveAmount,
        exchangeRate: calculation.exchangeRate,
        totalFees: calculation.totalFees
      });

      // Step 3: Check transaction limits
      console.log('[REMITTANCE] 🔒 Step 3: Checking transaction limits...');
      const limitCheck = await this.crossBorder.checkTransactionLimits(
        userId,
        remittanceData.amount
      );

      if (!limitCheck.allowed) {
        throw new Error(limitCheck.reason);
      }

      console.log('[REMITTANCE] ✅ Transaction within limits');

      // Step 4: Create remittance record
      console.log('[REMITTANCE] 📝 Step 4: Creating remittance record...');
      const remittance = await this.crossBorder.createRemittance(userId, {
        recipientId: remittanceData.recipientId,
        sendAmount: calculation.sendAmount,
        receiveAmount: calculation.receiveAmount,
        exchangeRate: calculation.exchangeRate,
        platformFee: calculation.platformFee,
        networkFee: calculation.networkFee,
        description: remittanceData.description || `Remittance to ${recipient.name}`,
        tags: remittanceData.tags || []
      });

      console.log(`[REMITTANCE] ✅ Remittance record created: ${remittance.remittanceId}`);

      // Step 5: Execute blockchain payment
      console.log('[REMITTANCE] ⛓️ Step 5: Executing blockchain transaction...');
      
      // Update status to processing
      await this.crossBorder.updateRemittanceStatus(
        remittance.remittanceId,
        'processing'
      );

      // Create payment request
      const paymentRequest = await this.payments.createPaymentRequest({
        to: recipient.walletAddress,
        amount: remittanceData.amount,
        currency: 'USDC',
        description: `Cross-border remittance: ${remittance.remittanceId}`,
        metadata: {
          remittanceId: remittance.remittanceId,
          recipientCountry: recipient.country,
          recipientName: recipient.name,
          type: 'remittance'
        }
      });

      // Execute payment
      const paymentResult = await this.payments.executePayment(paymentRequest);

      if (paymentResult.status === 'completed') {
        console.log(`[REMITTANCE] ✅ Blockchain transaction successful: ${paymentResult.txHash}`);

        // Update remittance with transaction details
        await this.crossBorder.updateRemittanceStatus(
          remittance.remittanceId,
          'completed',
          {
            txHash: paymentResult.txHash,
            explorerUrl: paymentResult.explorerUrl,
            deliveryConfirmation: paymentResult.blockNumber?.toString()
          }
        );

        // Update recipient usage stats
        await this.crossBorder.updateRecipientUsage(recipient.recipientId);

        // Log to payment history
        await this.firebase.logPaymentHistory(userId, {
          paymentId: remittance.remittanceId,
          type: 'remittance',
          payee: recipient.walletAddress,
          payeeName: recipient.name,
          payeeCountry: recipient.country,
          amount: remittanceData.amount,
          currency: 'USDC',
          receiveAmount: calculation.receiveAmount,
          receiveCurrency: recipient.currency,
          status: 'completed',
          txHash: paymentResult.txHash,
          explorerUrl: paymentResult.explorerUrl
        });

        console.log('[REMITTANCE] 🎉 Remittance completed successfully!');

        return {
          success: true,
          remittance: {
            ...remittance,
            status: 'completed',
            txHash: paymentResult.txHash,
            explorerUrl: paymentResult.explorerUrl
          },
          calculation,
          blockchain: {
            txHash: paymentResult.txHash,
            explorerUrl: paymentResult.explorerUrl,
            blockNumber: paymentResult.blockNumber,
            gasUsed: paymentResult.gasUsed
          },
          message: `Successfully sent ${calculation.sendAmount} USDC to ${recipient.name} in ${recipient.country}. They will receive ${calculation.breakdown.receiveAmount}.`
        };
      } else {
        console.error('[REMITTANCE] ❌ Blockchain transaction failed:', paymentResult.error);

        // Update remittance status to failed
        await this.crossBorder.updateRemittanceStatus(
          remittance.remittanceId,
          'failed',
          {
            failureReason: paymentResult.error || 'Unknown error'
          }
        );

        return {
          success: false,
          error: paymentResult.error || 'Payment execution failed',
          remittance: {
            ...remittance,
            status: 'failed'
          }
        };
      }
    } catch (error) {
      console.error('[REMITTANCE] ❌ Error:', error.message);
      
      return {
        success: false,
        error: error.message,
        details: error.stack
      };
    }
  }

  // ==================== REMITTANCE PREVIEW ====================

  /**
   * Preview remittance without executing (for user approval)
   */
  async previewRemittance(userId, recipientId, amount) {
    try {
      // Get recipient
      const recipient = await this.crossBorder.getRecipient(recipientId);
      
      if (!recipient) {
        throw new Error('Recipient not found');
      }

      // Calculate rates and fees
      const calculation = await this.exchangeRates.calculateRemittance(
        amount,
        recipient.currency
      );

      // Check limits
      const limitCheck = await this.crossBorder.checkTransactionLimits(userId, amount);

      // Get comparison with traditional services
      const comparison = await this.exchangeRates.compareWithTraditional(
        amount,
        recipient.currency
      );

      return {
        success: true,
        preview: {
          recipient: {
            name: recipient.name,
            country: recipient.country,
            currency: recipient.currency,
            deliveryMethod: recipient.preferredMethod
          },
          calculation,
          limits: limitCheck,
          comparison,
          estimatedDelivery: '5-15 minutes',
          totalSteps: 5
        }
      };
    } catch (error) {
      console.error('[REMITTANCE] Preview error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ==================== QUICK SEND (SAVED RECIPIENT) ====================

  /**
   * Quick send to a saved recipient
   */
  async quickSend(userId, recipientId, amount) {
    return await this.sendRemittance(userId, {
      recipientId,
      amount,
      description: 'Quick send'
    });
  }

  // ==================== REMITTANCE HISTORY ====================

  /**
   * Get user's remittance history with enhanced details
   */
  async getHistory(userId, options = {}) {
    const limit = options.limit || 50;
    const country = options.country;
    const status = options.status;

    let remittances = await this.crossBorder.getRemittanceHistory(userId, limit);

    // Apply filters
    if (country) {
      remittances = remittances.filter(r => r.recipientCountryCode === country);
    }

    if (status) {
      remittances = remittances.filter(r => r.status === status);
    }

    // Enhance with recipient info
    const enhanced = await Promise.all(
      remittances.map(async (remittance) => {
        try {
          const recipient = await this.crossBorder.getRecipient(remittance.recipientId);
          return {
            ...remittance,
            recipientDetails: recipient
          };
        } catch (error) {
          return remittance;
        }
      })
    );

    return enhanced;
  }

  // ==================== STATISTICS ====================

  /**
   * Get comprehensive remittance statistics
   */
  async getStats(userId, period = 'month') {
    const stats = await this.crossBorder.getRemittanceStats(userId, period);
    
    // Add additional insights
    const insights = {
      mostFrequentCountry: null,
      averageFee: 0,
      totalSaved: 0 // vs traditional services
    };

    if (stats.byCountry) {
      const countries = Object.entries(stats.byCountry);
      if (countries.length > 0) {
        const [country, data] = countries.reduce((max, current) => 
          current[1].count > max[1].count ? current : max
        );
        insights.mostFrequentCountry = country;
      }
    }

    insights.averageFee = stats.totalFees / (stats.totalTransactions || 1);
    
    // Calculate savings vs 5% traditional fee
    insights.totalSaved = (stats.totalVolume * 0.05) - stats.totalFees;

    return {
      ...stats,
      insights
    };
  }

  // ==================== RECIPIENT SUGGESTIONS ====================

  /**
   * Get suggested recipients based on history
   */
  async getSuggestedRecipients(userId, limit = 5) {
    const recipients = await this.crossBorder.getRecipients(userId);
    
    // Sort by frequency and recency
    const sorted = recipients
      .filter(r => r.useCount > 0)
      .sort((a, b) => {
        // Weight: 70% frequency, 30% recency
        const aScore = (a.useCount * 0.7) + (a.lastUsed ? 0.3 : 0);
        const bScore = (b.useCount * 0.7) + (b.lastUsed ? 0.3 : 0);
        return bScore - aScore;
      })
      .slice(0, limit);

    return sorted;
  }

  // ==================== TRACK DELIVERY ====================

  /**
   * Track remittance delivery status
   */
  async trackDelivery(remittanceId) {
    return await this.crossBorder.trackDelivery(remittanceId);
  }

  // ==================== CANCEL REMITTANCE ====================

  /**
   * Cancel pending remittance (before execution)
   */
  async cancelRemittance(remittanceId) {
    try {
      const remittance = await this.crossBorder.getRemittance(remittanceId);
      
      if (remittance.status !== 'pending') {
        throw new Error('Can only cancel pending remittances');
      }

      await this.crossBorder.updateRemittanceStatus(
        remittanceId,
        'cancelled',
        {
          cancelledAt: new Date().toISOString()
        }
      );

      console.log(`[REMITTANCE] ❌ Remittance cancelled: ${remittanceId}`);
      
      return {
        success: true,
        message: 'Remittance cancelled successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ==================== EXCHANGE RATE QUERIES ====================

  /**
   * Get current exchange rate for a currency pair
   */
  async getExchangeRate(fromCurrency, toCurrency) {
    try {
      const rate = await this.exchangeRates.getRate(fromCurrency, toCurrency);
      const currencyInfo = this.exchangeRates.getCurrencyInfo(toCurrency);

      return {
        success: true,
        from: fromCurrency,
        to: toCurrency,
        rate,
        formatted: `1 ${fromCurrency} = ${rate.toFixed(2)} ${toCurrency}`,
        symbol: currencyInfo?.symbol,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get all available exchange rates
   */
  async getAllRates() {
    const currencies = this.exchangeRates.getSupportedCurrencies()
      .filter(c => c.code !== 'USDC' && c.code !== 'USD')
      .map(c => c.code);

    const rates = await this.exchangeRates.getRatesForMultipleCurrencies(currencies);

    return Object.entries(rates).map(([currency, rate]) => ({
      currency,
      rate,
      info: this.exchangeRates.getCurrencyInfo(currency)
    }));
  }
}

// Singleton instance
let remittanceServiceInstance = null;

function getRemittanceService(thirdwebPayments, firebaseService) {
  if (!remittanceServiceInstance) {
    remittanceServiceInstance = new RemittanceService(thirdwebPayments, firebaseService);
  }
  return remittanceServiceInstance;
}

module.exports = {
  RemittanceService,
  getRemittanceService
};