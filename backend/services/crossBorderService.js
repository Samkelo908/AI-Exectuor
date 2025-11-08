// crossBorderService.js - Cross-Border Remittance Service for ArcBot
const admin = require('firebase-admin');

class CrossBorderService {
  constructor(firebaseService) {
    this.firebase = firebaseService;
    this.db = firebaseService.db;
    this.collections = {
      recipients: 'recipients',
      remittances: 'remittances',
      paymentCorridors: 'payment_corridors'
    };
    
    // Supported countries and their configurations
    this.supportedCountries = {
      'KE': {
        name: 'Kenya',
        currency: 'KES',
        methods: ['mobile_money', 'bank_transfer'],
        providers: ['M-Pesa', 'Airtel Money'],
        deliveryTime: '5-15 minutes',
        limits: { min: 1, max: 10000 }
      },
      'NG': {
        name: 'Nigeria',
        currency: 'NGN',
        methods: ['bank_transfer', 'mobile_money'],
        providers: ['Bank Transfer', 'Opay'],
        deliveryTime: '10-30 minutes',
        limits: { min: 1, max: 5000 }
      },
      'ZA': {
        name: 'South Africa',
        currency: 'ZAR',
        methods: ['bank_transfer', 'wallet'],
        providers: ['Bank Transfer', 'Luno'],
        deliveryTime: '15-45 minutes',
        limits: { min: 1, max: 5000 }
      },
      'GH': {
        name: 'Ghana',
        currency: 'GHS',
        methods: ['mobile_money', 'bank_transfer'],
        providers: ['MTN Mobile Money', 'Vodafone Cash'],
        deliveryTime: '10-20 minutes',
        limits: { min: 1, max: 5000 }
      },
      'UG': {
        name: 'Uganda',
        currency: 'UGX',
        methods: ['mobile_money', 'bank_transfer'],
        providers: ['MTN Mobile Money', 'Airtel Money'],
        deliveryTime: '10-20 minutes',
        limits: { min: 1, max: 5000 }
      },
      'RW': {
        name: 'Rwanda',
        currency: 'RWF',
        methods: ['mobile_money', 'bank_transfer'],
        providers: ['MTN Mobile Money', 'Airtel Money'],
        deliveryTime: '10-20 minutes',
        limits: { min: 1, max: 5000 }
      }
    };
  }

  // ==================== RECIPIENT MANAGEMENT ====================

  async addRecipient(userId, recipientData) {
    try {
      const recipientId = `recip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Validate country
      if (!this.supportedCountries[recipientData.countryCode]) {
        throw new Error(`Country ${recipientData.countryCode} not supported yet`);
      }

      const country = this.supportedCountries[recipientData.countryCode];

      const recipient = {
        recipientId,
        userId,
        name: recipientData.name,
        walletAddress: recipientData.walletAddress || null,
        countryCode: recipientData.countryCode,
        countryName: country.name,
        currency: country.currency,
        phoneNumber: recipientData.phoneNumber || null,
        bankAccount: recipientData.bankAccount || null,
        bankName: recipientData.bankName || null,
        preferredMethod: recipientData.preferredMethod || 'mobile_money',
        relationship: recipientData.relationship || 'other', // family, friend, business, other
        favorite: recipientData.favorite || false,
        nickname: recipientData.nickname || recipientData.name,
        verified: false,
        totalReceived: 0,
        transactionCount: 0,
        lastTransaction: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      await this.db.collection(this.collections.recipients).doc(recipientId).set(recipient);
      
      console.log(`✅ Recipient added: ${recipientId} - ${recipient.name} in ${country.name}`);
      return recipient;
    } catch (error) {
      console.error('❌ Error adding recipient:', error.message);
      throw error;
    }
  }

  async getRecipients(userId, filters = {}) {
    try {
      let query = this.db.collection(this.collections.recipients).where('userId', '==', userId);
      
      if (filters.countryCode) {
        query = query.where('countryCode', '==', filters.countryCode);
      }
      
      if (filters.favorite) {
        query = query.where('favorite', '==', true);
      }

      const snapshot = await query.orderBy('transactionCount', 'desc').get();
      
      return snapshot.docs.map(doc => doc.data());
    } catch (error) {
      console.error('❌ Error fetching recipients:', error.message);
      return [];
    }
  }

  async getRecipientById(recipientId) {
    try {
      const doc = await this.db.collection(this.collections.recipients).doc(recipientId).get();
      
      if (!doc.exists) {
        throw new Error('Recipient not found');
      }
      
      return doc.data();
    } catch (error) {
      console.error('❌ Error fetching recipient:', error.message);
      throw error;
    }
  }

  async updateRecipient(recipientId, updates) {
    try {
      const recipientRef = this.db.collection(this.collections.recipients).doc(recipientId);
      
      await recipientRef.update({
        ...updates,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      console.log(`✅ Recipient updated: ${recipientId}`);
      return { success: true };
    } catch (error) {
      console.error('❌ Error updating recipient:', error.message);
      throw error;
    }
  }

  async deleteRecipient(recipientId) {
    try {
      await this.db.collection(this.collections.recipients).doc(recipientId).delete();
      console.log(`✅ Recipient deleted: ${recipientId}`);
      return { success: true };
    } catch (error) {
      console.error('❌ Error deleting recipient:', error.message);
      throw error;
    }
  }

  async toggleFavorite(recipientId) {
    try {
      const recipient = await this.getRecipientById(recipientId);
      
      await this.updateRecipient(recipientId, {
        favorite: !recipient.favorite
      });
      
      return { success: true, favorite: !recipient.favorite };
    } catch (error) {
      console.error('❌ Error toggling favorite:', error.message);
      throw error;
    }
  }

  // ==================== REMITTANCE TRACKING ====================

  async logRemittance(userId, remittanceData) {
    try {
      const remittanceId = `rem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const remittance = {
        remittanceId,
        userId,
        recipientId: remittanceData.recipientId,
        recipientName: remittanceData.recipientName,
        recipientCountry: remittanceData.recipientCountry,
        recipientCurrency: remittanceData.recipientCurrency,
        
        // Amounts
        sendAmount: remittanceData.sendAmount,
        sendCurrency: 'USDC',
        receiveAmount: remittanceData.receiveAmount,
        receiveCurrency: remittanceData.recipientCurrency,
        
        // Exchange & Fees
        exchangeRate: remittanceData.exchangeRate,
        fee: remittanceData.fee,
        feePercentage: remittanceData.feePercentage || 1.0,
        networkFee: remittanceData.networkFee || 0,
        
        // Delivery
        deliveryMethod: remittanceData.deliveryMethod,
        estimatedDeliveryTime: remittanceData.estimatedDeliveryTime,
        actualDeliveryTime: null,
        
        // Transaction
        txHash: remittanceData.txHash || null,
        explorerUrl: remittanceData.explorerUrl || null,
        status: remittanceData.status || 'pending', // pending, processing, completed, failed
        failureReason: null,
        
        // Metadata
        description: remittanceData.description || '',
        purpose: remittanceData.purpose || 'family_support',
        
        // Timestamps
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        completedAt: null
      };

      await this.db.collection(this.collections.remittances).doc(remittanceId).set(remittance);
      
      // Update recipient stats
      if (remittanceData.recipientId) {
        await this.updateRecipientStats(remittanceData.recipientId, remittanceData.sendAmount);
      }
      
      console.log(`✅ Remittance logged: ${remittanceId}`);
      return remittance;
    } catch (error) {
      console.error('❌ Error logging remittance:', error.message);
      throw error;
    }
  }

  async updateRemittanceStatus(remittanceId, status, additionalData = {}) {
    try {
      const updates = {
        status,
        ...additionalData
      };

      if (status === 'completed') {
        updates.completedAt = admin.firestore.FieldValue.serverTimestamp();
      }

      await this.db.collection(this.collections.remittances).doc(remittanceId).update(updates);
      
      console.log(`✅ Remittance status updated: ${remittanceId} → ${status}`);
      return { success: true };
    } catch (error) {
      console.error('❌ Error updating remittance status:', error.message);
      throw error;
    }
  }

  async getRemittanceHistory(userId, limit = 50) {
    try {
      const snapshot = await this.db.collection(this.collections.remittances)
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      
      return snapshot.docs.map(doc => doc.data());
    } catch (error) {
      console.error('❌ Error fetching remittance history:', error.message);
      return [];
    }
  }

  async getRemittanceById(remittanceId) {
    try {
      const doc = await this.db.collection(this.collections.remittances).doc(remittanceId).get();
      
      if (!doc.exists) {
        throw new Error('Remittance not found');
      }
      
      return doc.data();
    } catch (error) {
      console.error('❌ Error fetching remittance:', error.message);
      throw error;
    }
  }

  // ==================== STATISTICS ====================

  async updateRecipientStats(recipientId, amount) {
    try {
      const recipientRef = this.db.collection(this.collections.recipients).doc(recipientId);
      
      await recipientRef.update({
        totalReceived: admin.firestore.FieldValue.increment(amount),
        transactionCount: admin.firestore.FieldValue.increment(1),
        lastTransaction: admin.firestore.FieldValue.serverTimestamp()
      });
      
      console.log(`✅ Recipient stats updated: ${recipientId}`);
    } catch (error) {
      console.error('❌ Error updating recipient stats:', error.message);
    }
  }

  async getUserRemittanceStats(userId) {
    try {
      const remittances = await this.getRemittanceHistory(userId, 1000);
      
      const stats = {
        totalRemittances: remittances.length,
        totalSent: remittances.reduce((sum, r) => sum + r.sendAmount, 0),
        totalFees: remittances.reduce((sum, r) => sum + r.fee, 0),
        averageAmount: 0,
        byCountry: {},
        byStatus: {
          completed: 0,
          pending: 0,
          failed: 0
        }
      };

      if (stats.totalRemittances > 0) {
        stats.averageAmount = stats.totalSent / stats.totalRemittances;
      }

      remittances.forEach(r => {
        // Count by country
        if (!stats.byCountry[r.recipientCountry]) {
          stats.byCountry[r.recipientCountry] = {
            count: 0,
            total: 0,
            currency: r.recipientCurrency
          };
        }
        stats.byCountry[r.recipientCountry].count++;
        stats.byCountry[r.recipientCountry].total += r.sendAmount;

        // Count by status
        stats.byStatus[r.status] = (stats.byStatus[r.status] || 0) + 1;
      });

      return stats;
    } catch (error) {
      console.error('❌ Error fetching user stats:', error.message);
      return null;
    }
  }

  // ==================== UTILITY FUNCTIONS ====================

  getSupportedCountries() {
    return Object.entries(this.supportedCountries).map(([code, data]) => ({
      code,
      ...data
    }));
  }

  getCountryInfo(countryCode) {
    return this.supportedCountries[countryCode] || null;
  }

  validateRemittanceAmount(countryCode, amount) {
    const country = this.supportedCountries[countryCode];
    
    if (!country) {
      return { valid: false, error: 'Country not supported' };
    }

    if (amount < country.limits.min) {
      return { valid: false, error: `Minimum amount is ${country.limits.min} USDC` };
    }

    if (amount > country.limits.max) {
      return { valid: false, error: `Maximum amount is ${country.limits.max} USDC` };
    }

    return { valid: true };
  }

  // ==================== SEARCH & FILTER ====================

  async searchRecipients(userId, searchTerm) {
    try {
      const recipients = await this.getRecipients(userId);
      
      const lowerSearch = searchTerm.toLowerCase();
      
      return recipients.filter(r => 
        r.name.toLowerCase().includes(lowerSearch) ||
        r.nickname?.toLowerCase().includes(lowerSearch) ||
        r.countryName.toLowerCase().includes(lowerSearch)
      );
    } catch (error) {
      console.error('❌ Error searching recipients:', error.message);
      return [];
    }
  }

  async getFrequentRecipients(userId, limit = 5) {
    try {
      const snapshot = await this.db.collection(this.collections.recipients)
        .where('userId', '==', userId)
        .orderBy('transactionCount', 'desc')
        .limit(limit)
        .get();
      
      return snapshot.docs.map(doc => doc.data());
    } catch (error) {
      console.error('❌ Error fetching frequent recipients:', error.message);
      return [];
    }
  }
}

// Singleton instance
let crossBorderServiceInstance = null;

function getCrossBorderService(firebaseService) {
  if (!crossBorderServiceInstance) {
    crossBorderServiceInstance = new CrossBorderService(firebaseService);
  }
  return crossBorderServiceInstance;
}

module.exports = {
  CrossBorderService,
  getCrossBorderService
};