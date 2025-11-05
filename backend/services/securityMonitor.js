// ============================================
// ArcBot Security Layer - services/securityMonitor.js
// AI-Powered Pattern Recognition & Fraud Detection
// ============================================

const admin = require('firebase-admin');

class SecurityMonitor {
  constructor() {
    this.db = null;
    this.initialized = false;
    
    // Security thresholds (configurable per user)
    this.defaultThresholds = {
      maxSingleTransaction: 1000, // USDC
      maxDailyVolume: 5000,
      maxMonthlyVolume: 50000,
      unusualAmountMultiplier: 3, // 3x average is suspicious
      newRecipientHighAmount: 500, // Flag large payments to new addresses
      rapidTransactionCount: 5, // More than 5 in 5 minutes is suspicious
      rapidTransactionWindow: 5 * 60 * 1000, // 5 minutes
      velocityCheckWindow: 60 * 60 * 1000, // 1 hour
      maxVelocityTransactions: 10
    };
  }

  async initialize() {
    if (this.initialized) return;
    
    this.db = admin.firestore();
    this.initialized = true;
    console.log('✅ Security Monitor initialized');
  }

  // ==================== MAIN SECURITY CHECK ====================
  
  async checkTransaction(userId, transaction) {
    if (!this.initialized) await this.initialize();
    
    const checks = {
      timestamp: new Date(),
      transactionId: transaction.paymentId || `tx_${Date.now()}`,
      userId,
      transaction,
      passed: true,
      riskScore: 0, // 0-100
      alerts: [],
      flags: [],
      recommendation: 'APPROVE'
    };

    try {
      // Get user's transaction history and patterns
      const userProfile = await this.getUserSecurityProfile(userId);
      
      // Run all security checks
      await this.checkAmountLimits(checks, transaction, userProfile);
      await this.checkRecipientTrust(checks, transaction, userProfile);
      await this.checkTransactionVelocity(checks, userId);
      await this.checkPatternAnomalies(checks, transaction, userProfile);
      await this.checkTimePatterns(checks, transaction, userProfile);
      await this.checkGeographicPatterns(checks, transaction, userProfile);
      
      // Calculate final risk score (0-100)
      checks.riskScore = this.calculateRiskScore(checks);
      
      // Determine recommendation
      if (checks.riskScore >= 80) {
        checks.recommendation = 'BLOCK';
        checks.passed = false;
      } else if (checks.riskScore >= 50) {
        checks.recommendation = 'REQUIRE_2FA';
        checks.passed = false;
      } else if (checks.riskScore >= 30) {
        checks.recommendation = 'WARN';
      } else {
        checks.recommendation = 'APPROVE';
      }
      
      // Log security check
      await this.logSecurityCheck(checks);
      
      console.log(`[SECURITY] Check completed: ${checks.recommendation} (Risk: ${checks.riskScore})`);
      
      return checks;
      
    } catch (error) {
      console.error('[SECURITY] Check failed:', error);
      return {
        ...checks,
        passed: false,
        recommendation: 'ERROR',
        alerts: ['Security check failed - manual review required']
      };
    }
  }

  // ==================== AMOUNT LIMIT CHECKS ====================
  
  async checkAmountLimits(checks, transaction, profile) {
    const amount = transaction.amount;
    
    // Check single transaction limit
    if (amount > profile.limits.maxSingleTransaction) {
      checks.flags.push({
        type: 'AMOUNT_LIMIT_EXCEEDED',
        severity: 'HIGH',
        message: `Amount ${amount} USDC exceeds your single transaction limit of ${profile.limits.maxSingleTransaction} USDC`,
        recommendation: 'This transaction requires additional verification'
      });
      checks.riskScore += 30;
    }
    
    // Check unusual amount (compared to average)
    if (profile.stats.averageTransaction > 0) {
      const ratio = amount / profile.stats.averageTransaction;
      
      if (ratio > profile.limits.unusualAmountMultiplier) {
        checks.flags.push({
          type: 'UNUSUAL_AMOUNT',
          severity: 'MEDIUM',
          message: `This amount is ${ratio.toFixed(1)}x larger than your average transaction of ${profile.stats.averageTransaction.toFixed(2)} USDC`,
          recommendation: 'Review this transaction carefully'
        });
        checks.riskScore += 20;
      }
    }
    
    // Check daily volume
    const todayVolume = await this.getDailyVolume(checks.userId);
    if (todayVolume + amount > profile.limits.maxDailyVolume) {
      checks.flags.push({
        type: 'DAILY_LIMIT_EXCEEDED',
        severity: 'HIGH',
        message: `This transaction would exceed your daily limit. Current: ${todayVolume} + ${amount} = ${todayVolume + amount} USDC (Limit: ${profile.limits.maxDailyVolume})`,
        recommendation: 'Wait until tomorrow or request limit increase'
      });
      checks.riskScore += 25;
    }
    
    // Check if amount is suspiciously round (common in fraud)
    if (amount >= 100 && amount % 100 === 0) {
      checks.flags.push({
        type: 'ROUND_AMOUNT',
        severity: 'LOW',
        message: `Round number amount (${amount} USDC) - common in fraudulent transactions`,
        recommendation: 'Verify recipient and purpose'
      });
      checks.riskScore += 5;
    }
  }

  // ==================== RECIPIENT TRUST CHECKS ====================
  
  async checkRecipientTrust(checks, transaction, profile) {
    const recipient = transaction.payee;
    
    // Check if recipient is new
    const isNewRecipient = !profile.knownRecipients.includes(recipient);
    
    if (isNewRecipient) {
      checks.flags.push({
        type: 'NEW_RECIPIENT',
        severity: 'MEDIUM',
        message: `First time sending to ${recipient.slice(0, 10)}...`,
        recommendation: 'Verify the recipient address carefully'
      });
      checks.riskScore += 15;
      
      // Extra flag for large amount to new recipient
      if (transaction.amount > profile.limits.newRecipientHighAmount) {
        checks.flags.push({
          type: 'HIGH_AMOUNT_NEW_RECIPIENT',
          severity: 'HIGH',
          message: `Large payment (${transaction.amount} USDC) to a NEW recipient you've never sent to before`,
          recommendation: 'This is high risk - confirm recipient identity before proceeding'
        });
        checks.riskScore += 35;
      }
    } else {
      // Check recipient transaction history
      const recipientHistory = profile.recipientStats[recipient];
      
      if (recipientHistory && transaction.amount > recipientHistory.maxAmount * 2) {
        checks.flags.push({
          type: 'UNUSUAL_AMOUNT_FOR_RECIPIENT',
          severity: 'MEDIUM',
          message: `This is 2x more than you've ever sent to ${recipient.slice(0, 10)}... (Previous max: ${recipientHistory.maxAmount} USDC)`,
          recommendation: 'Verify the amount is correct'
        });
        checks.riskScore += 15;
      }
    }
    
    // Check if address looks suspicious (vanity address, similar to known scams)
    if (this.isAddressSuspicious(recipient)) {
      checks.flags.push({
        type: 'SUSPICIOUS_ADDRESS',
        severity: 'HIGH',
        message: 'Recipient address matches patterns associated with scams',
        recommendation: 'DO NOT PROCEED - Likely scam address'
      });
      checks.riskScore += 50;
    }
  }

  // ==================== VELOCITY CHECKS ====================
  
  async checkTransactionVelocity(checks, userId) {
    // Get recent transactions (last 5 minutes)
    const recentSnapshot = await this.db.collection('payment_history')
      .where('userId', '==', userId)
      .where('timestamp', '>', admin.firestore.Timestamp.fromMillis(
        Date.now() - checks.transaction.rapidTransactionWindow || 5 * 60 * 1000
      ))
      .get();
    
    const recentCount = recentSnapshot.size;
    
    if (recentCount >= 5) {
      checks.flags.push({
        type: 'RAPID_TRANSACTIONS',
        severity: 'HIGH',
        message: `${recentCount} transactions in the last 5 minutes - this is unusual velocity`,
        recommendation: 'Possible account compromise - verify all recent transactions'
      });
      checks.riskScore += 40;
    }
    
    // Check hourly velocity
    const hourlySnapshot = await this.db.collection('payment_history')
      .where('userId', '==', userId)
      .where('timestamp', '>', admin.firestore.Timestamp.fromMillis(
        Date.now() - 60 * 60 * 1000
      ))
      .get();
    
    if (hourlySnapshot.size >= 10) {
      checks.flags.push({
        type: 'HIGH_VELOCITY',
        severity: 'MEDIUM',
        message: `${hourlySnapshot.size} transactions in the last hour`,
        recommendation: 'Unusual activity pattern detected'
      });
      checks.riskScore += 20;
    }
  }

// ==================== PATTERN ANOMALY DETECTION ====================

async checkPatternAnomalies(checks, transaction, profile) {
  // Check if this breaks normal patterns
  
  // 1. Time pattern anomaly
  const hour = new Date().getHours();
  if (profile.patterns.activeHours.length > 0) {
    const isUnusualHour = !profile.patterns.activeHours.includes(hour);
    
    if (isUnusualHour && transaction.amount > 100) {
      checks.flags.push({
        type: 'UNUSUAL_TIME',
        severity: 'MEDIUM',
        message: `Transaction at ${hour}:00 - you don't usually transact at this time`,
        recommendation: 'Verify you authorized this transaction'
      });
      checks.riskScore += 10;
    }
  }
  
  // 2. Day pattern anomaly
  const dayOfWeek = new Date().getDay();
  if (profile.patterns.activeDays.length > 0) {
    const isUnusualDay = !profile.patterns.activeDays.includes(dayOfWeek);
    
    if (isUnusualDay && transaction.amount > 100) {
      checks.flags.push({
        type: 'UNUSUAL_DAY',
        severity: 'LOW',
        message: 'Transaction on a day you don\'t typically make payments', // Fixed: escaped apostrophe
        recommendation: 'Confirm this is authorized'
      });
      checks.riskScore += 5;
    }
  }
  
  // 3. Currency pattern
  if (transaction.currency !== profile.patterns.primaryCurrency) {
    checks.flags.push({
      type: 'UNUSUAL_CURRENCY',
      severity: 'LOW',
      message: `Using ${transaction.currency} - you normally use ${profile.patterns.primaryCurrency}`,
      recommendation: 'Verify currency is correct'
    });
    checks.riskScore += 5;
  }
}

  // ==================== TIME PATTERN CHECKS ====================
  
  async checkTimePatterns(checks, transaction, profile) {
    const now = new Date();
    const hour = now.getHours();
    
    // Late night/early morning transactions (2 AM - 5 AM)
    if (hour >= 2 && hour <= 5 && transaction.amount > 50) {
      checks.flags.push({
        type: 'LATE_NIGHT_TRANSACTION',
        severity: 'MEDIUM',
        message: 'Transaction during late night hours (2 AM - 5 AM)',
        recommendation: 'Common time for unauthorized access - verify this is you'
      });
      checks.riskScore += 15;
    }
    
    // Weekend large transactions
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;
    if (isWeekend && transaction.amount > profile.stats.averageTransaction * 2) {
      checks.flags.push({
        type: 'WEEKEND_LARGE_TRANSACTION',
        severity: 'LOW',
        message: 'Large transaction on weekend',
        recommendation: 'Ensure this is intentional'
      });
      checks.riskScore += 5;
    }
  }

  // ==================== GEOGRAPHIC PATTERN CHECKS ====================
  
  async checkGeographicPatterns(checks, transaction, profile) {
    // Note: In production, integrate with IP geolocation API
    // For now, this is a placeholder
    
    if (transaction.metadata?.ipAddress) {
      // Check if IP is from unusual location
      // Check if IP is from known VPN/proxy (higher risk)
      // Check if IP changed rapidly (account sharing/compromise)
    }
  }

  // ==================== USER SECURITY PROFILE ====================
  
  async getUserSecurityProfile(userId) {
    // Get user's custom limits or use defaults
    const userLimitsDoc = await this.db.collection('user_security_settings')
      .doc(userId)
      .get();
    
    const customLimits = userLimitsDoc.exists ? userLimitsDoc.data().limits : {};
    const limits = { ...this.defaultThresholds, ...customLimits };
    
    // Get transaction history for pattern analysis
    const historySnapshot = await this.db.collection('payment_history')
      .where('userId', '==', userId)
      .orderBy('timestamp', 'desc')
      .limit(100)
      .get();
    
    const history = historySnapshot.docs.map(doc => doc.data());
    
    // Calculate statistics
    const stats = this.calculateUserStats(history);
    
    // Identify known recipients
    const knownRecipients = [...new Set(history.map(h => h.payee))];
    
    // Calculate recipient-specific stats
    const recipientStats = {};
    history.forEach(h => {
      if (!recipientStats[h.payee]) {
        recipientStats[h.payee] = {
          count: 0,
          totalAmount: 0,
          maxAmount: 0,
          avgAmount: 0
        };
      }
      recipientStats[h.payee].count++;
      recipientStats[h.payee].totalAmount += h.amount || 0;
      recipientStats[h.payee].maxAmount = Math.max(recipientStats[h.payee].maxAmount, h.amount || 0);
    });
    
    Object.keys(recipientStats).forEach(recipient => {
      recipientStats[recipient].avgAmount = 
        recipientStats[recipient].totalAmount / recipientStats[recipient].count;
    });
    
    // Detect patterns
    const patterns = this.detectPatterns(history);
    
    return {
      userId,
      limits,
      stats,
      knownRecipients,
      recipientStats,
      patterns,
      lastUpdated: new Date()
    };
  }

  // ==================== STATISTICS CALCULATION ====================
  
  calculateUserStats(history) {
    if (history.length === 0) {
      return {
        totalTransactions: 0,
        totalVolume: 0,
        averageTransaction: 0,
        maxTransaction: 0,
        medianTransaction: 0
      };
    }
    
    const amounts = history.map(h => h.amount || 0).filter(a => a > 0);
    const totalVolume = amounts.reduce((sum, a) => sum + a, 0);
    
    amounts.sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    
    return {
      totalTransactions: history.length,
      totalVolume,
      averageTransaction: totalVolume / amounts.length,
      maxTransaction: Math.max(...amounts),
      medianTransaction: median
    };
  }

  // ==================== PATTERN DETECTION ====================
  
  detectPatterns(history) {
    const patterns = {
      activeHours: [],
      activeDays: [],
      primaryCurrency: 'USDC',
      typicalAmount: 0,
      recurringRecipients: []
    };
    
    // Detect active hours
    const hourCounts = {};
    history.forEach(h => {
      if (h.timestamp) {
        const date = h.timestamp.toDate ? h.timestamp.toDate() : new Date(h.timestamp);
        const hour = date.getHours();
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      }
    });
    
    // Hours with more than 10% of transactions
    const totalTx = history.length;
    patterns.activeHours = Object.entries(hourCounts)
      .filter(([_, count]) => count / totalTx > 0.1)
      .map(([hour]) => parseInt(hour));
    
    // Detect active days
    const dayCounts = {};
    history.forEach(h => {
      if (h.timestamp) {
        const date = h.timestamp.toDate ? h.timestamp.toDate() : new Date(h.timestamp);
        const day = date.getDay();
        dayCounts[day] = (dayCounts[day] || 0) + 1;
      }
    });
    
    patterns.activeDays = Object.entries(dayCounts)
      .filter(([_, count]) => count / totalTx > 0.1)
      .map(([day]) => parseInt(day));
    
    // Detect primary currency
    const currencyCounts = {};
    history.forEach(h => {
      const currency = h.currency || 'USDC';
      currencyCounts[currency] = (currencyCounts[currency] || 0) + 1;
    });
    
    patterns.primaryCurrency = Object.entries(currencyCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'USDC';
    
    return patterns;
  }

  // ==================== RISK SCORE CALCULATION ====================
  
  calculateRiskScore(checks) {
    // Risk score is already accumulated during checks
    // Cap at 100
    return Math.min(checks.riskScore, 100);
  }

  // ==================== HELPER FUNCTIONS ====================
  
  async getDailyVolume(userId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const snapshot = await this.db.collection('payment_history')
      .where('userId', '==', userId)
      .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(today))
      .get();
    
    return snapshot.docs.reduce((sum, doc) => sum + (doc.data().amount || 0), 0);
  }

  isAddressSuspicious(address) {
    // Check for vanity addresses that might be scams
    const suspicious = [
      '0x0000000000000000000000000000000000000000', // Zero address
      // Add known scam addresses here
    ];
    
    if (suspicious.includes(address.toLowerCase())) {
      return true;
    }
    
    // Check for addresses with too many repeated characters (vanity scams)
    const chars = address.toLowerCase().slice(2);
    const charCounts = {};
    for (const char of chars) {
      charCounts[char] = (charCounts[char] || 0) + 1;
    }
    
    // If any character appears more than 30 times, suspicious
    return Object.values(charCounts).some(count => count > 30);
  }

  async logSecurityCheck(checks) {
    await this.db.collection('security_checks').add({
      ...checks,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  // ==================== USER ALERT SYSTEM ====================
  
  async sendSecurityAlert(userId, checks) {
    // Store alert in database
    await this.db.collection('security_alerts').add({
      userId,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      severity: checks.recommendation,
      riskScore: checks.riskScore,
      flags: checks.flags,
      transaction: checks.transaction,
      read: false
    });
    
    // In production: Send email, SMS, push notification
    console.log(`🚨 Security Alert sent to user ${userId}`);
  }

  // ==================== UPDATE USER LIMITS ====================
  
  async updateUserLimits(userId, newLimits) {
    await this.db.collection('user_security_settings')
      .doc(userId)
      .set({
        userId,
        limits: newLimits,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    
    console.log(`✅ Security limits updated for user ${userId}`);
  }
}

// Singleton instance
let securityMonitorInstance = null;

function getSecurityMonitor() {
  if (!securityMonitorInstance) {
    securityMonitorInstance = new SecurityMonitor();
  }
  return securityMonitorInstance;
}

module.exports = {
  SecurityMonitor,
  getSecurityMonitor
};