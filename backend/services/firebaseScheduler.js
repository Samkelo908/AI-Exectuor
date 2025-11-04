// services/firebaseScheduler.js - Firebase-based Payment Scheduler
const admin = require('firebase-admin');
const cron = require('node-cron');

class FirebasePaymentScheduler {
  constructor() {
    this.initialized = false;
    this.db = null;
    this.thirdwebPayments = null;
    this.cronJobsStarted = false;
  }

  async initialize() {
    if (this.initialized) {
      console.log('✅ Firebase Scheduler already initialized');
      return;
    }

    try {
      // Initialize Firebase Admin SDK
      const path = require('path');
      const credentialsPath = process.env.FIREBASE_CREDENTIALS_PATH || './firebase-credentials.json';
      const absolutePath = path.resolve(process.cwd(), credentialsPath);
      
      console.log(`[FIREBASE] Loading credentials from: ${absolutePath}`);
      
      let serviceAccount;
      
      if (!admin.apps.length) {
        serviceAccount = require(absolutePath);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
      } else {
        // If already initialized, get the project ID from the app
        serviceAccount = { project_id: admin.app().options.projectId || 'arcbot-63f2a' };
      }

      this.db = admin.firestore();
      
      // Initialize Thirdweb for payment execution
      const { getThirdwebPaymentService } = require('../thirdwebPayments');
      this.thirdwebPayments = getThirdwebPaymentService();
      
      this.initialized = true;
      console.log('✅ Firebase Payment Scheduler initialized');
      console.log(`📦 Project: ${serviceAccount.project_id}`);

      // Start cron jobs
      if (!this.cronJobsStarted) {
        this.initializeCronJobs();
        this.cronJobsStarted = true;
      }

      return true;
    } catch (error) {
      console.error('❌ Firebase Scheduler initialization failed:', error.message);
      throw error;
    }
  }

  // ==================== SCHEDULE PAYMENT ====================

  async schedulePayment(userId, paymentData) {
    if (!this.initialized) await this.initialize();

    const paymentId = `pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const payment = {
      userId,
      paymentId,
      type: paymentData.type || 'PAY',
      payee: paymentData.payee,
      amount: paymentData.amount,
      currency: paymentData.currency || 'USDC',
      scheduledDate: admin.firestore.Timestamp.fromDate(new Date(paymentData.scheduledDate)),
      recurring: paymentData.recurring || { enabled: false },
      status: 'scheduled',
      description: paymentData.description || '',
      tags: paymentData.tags || [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      executedAt: null,
      txHash: null,
      explorerUrl: null,
      failureReason: null
    };

    await this.db.collection('scheduled_payments').doc(paymentId).set(payment);
    
    console.log(`✅ Payment scheduled: ${paymentId} for ${paymentData.scheduledDate}`);
    
    return {
      ...payment,
      paymentId,
      scheduledDate: new Date(paymentData.scheduledDate)
    };
  }

  // ==================== GET SCHEDULED PAYMENTS ====================

  async getScheduledPayments(userId, filter = {}) {
    if (!this.initialized) await this.initialize();

    let query = this.db.collection('scheduled_payments')
      .where('userId', '==', userId);
    
    if (filter.status) {
      query = query.where('status', '==', filter.status);
    }
    
    const snapshot = await query.orderBy('scheduledDate', 'asc').get();
    
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        ...data,
        scheduledDate: data.scheduledDate?.toDate() || new Date(data.scheduledDate)
      };
    });
  }

  // ==================== EXECUTE SCHEDULED PAYMENT ====================

  async executeScheduledPayment(paymentId) {
    if (!this.initialized) await this.initialize();

    const paymentRef = this.db.collection('scheduled_payments').doc(paymentId);
    const paymentDoc = await paymentRef.get();
    
    if (!paymentDoc.exists) {
      throw new Error('Payment not found');
    }
    
    const payment = paymentDoc.data();
    
    try {
      console.log(`💸 Executing scheduled payment: ${paymentId}`);
      console.log(`   To: ${payment.payee}`);
      console.log(`   Amount: ${payment.amount} ${payment.currency}`);
      
      // Create payment request via Thirdweb
      const paymentRequest = await this.thirdwebPayments.createPaymentRequest({
        to: payment.payee,
        amount: payment.amount,
        currency: payment.currency,
        description: payment.description || `Scheduled payment to ${payment.payee}`
      });
      
      // Execute payment
      const result = await this.thirdwebPayments.executePayment(paymentRequest);
      
      if (result.status === 'completed') {
        // Update payment status
        await paymentRef.update({
          status: 'completed',
          executedAt: admin.firestore.FieldValue.serverTimestamp(),
          txHash: result.txHash,
          explorerUrl: result.explorerUrl
        });
        
        console.log(`✅ Payment executed: ${result.txHash}`);
        
        // Log to payment history
        await this.logPaymentHistory(payment.userId, {
          paymentId,
          type: 'scheduled',
          payee: payment.payee,
          amount: payment.amount,
          currency: payment.currency,
          status: 'completed',
          txHash: result.txHash,
          explorerUrl: result.explorerUrl
        });
        
        // Handle recurring payments
        if (payment.recurring && payment.recurring.enabled) {
          await this.scheduleRecurringPayment(payment);
        }
        
        return { success: true, txHash: result.txHash, explorerUrl: result.explorerUrl };
      } else {
        throw new Error(result.error || 'Payment execution failed');
      }
    } catch (error) {
      console.error(`❌ Payment execution failed: ${error.message}`);
      
      await paymentRef.update({
        status: 'failed',
        failureReason: error.message
      });
      
      return { success: false, error: error.message };
    }
  }

  // ==================== CANCEL SCHEDULED PAYMENT ====================

  async cancelScheduledPayment(paymentId) {
    if (!this.initialized) await this.initialize();

    const paymentRef = this.db.collection('scheduled_payments').doc(paymentId);
    const paymentDoc = await paymentRef.get();
    
    if (!paymentDoc.exists) {
      throw new Error('Payment not found');
    }
    
    await paymentRef.update({
      status: 'cancelled'
    });
    
    console.log(`❌ Payment cancelled: ${paymentId}`);
    
    const data = paymentDoc.data();
    return {
      ...data,
      scheduledDate: data.scheduledDate?.toDate() || new Date(data.scheduledDate),
      status: 'cancelled'
    };
  }

  // ==================== RECURRING PAYMENTS ====================

  async scheduleRecurringPayment(payment) {
    const currentDate = payment.scheduledDate.toDate();
    const nextDate = this.calculateNextDate(currentDate, payment.recurring.frequency);
    
    // Check if there's an end date
    if (payment.recurring.endDate) {
      const endDate = new Date(payment.recurring.endDate);
      if (nextDate > endDate) {
        console.log(`⏹️ Recurring payment series ended: ${payment.paymentId}`);
        return;
      }
    }
    
    // Create next payment
    await this.schedulePayment(payment.userId, {
      type: payment.type,
      payee: payment.payee,
      amount: payment.amount,
      currency: payment.currency,
      scheduledDate: nextDate,
      recurring: payment.recurring,
      description: payment.description,
      tags: payment.tags
    });
    
    console.log(`🔁 Next recurring payment scheduled for ${nextDate.toISOString()}`);
  }

  calculateNextDate(currentDate, frequency) {
    const date = new Date(currentDate);
    
    switch (frequency) {
      case 'daily':
        date.setDate(date.getDate() + 1);
        break;
      case 'weekly':
        date.setDate(date.getDate() + 7);
        break;
      case 'monthly':
        date.setMonth(date.getMonth() + 1);
        break;
      case 'yearly':
        date.setFullYear(date.getFullYear() + 1);
        break;
      default:
        throw new Error(`Invalid frequency: ${frequency}`);
    }
    
    return date;
  }

  // ==================== SAVED TRANSFERS ====================

  async saveTransfer(userId, transferData) {
    if (!this.initialized) await this.initialize();

    const transferId = `trans_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const transfer = {
      userId,
      transferId,
      payee: transferData.payee,
      nickname: transferData.nickname || '',
      amount: transferData.amount || null,
      currency: transferData.currency || 'USDC',
      category: transferData.category || 'other',
      favorite: transferData.favorite || false,
      lastUsed: null,
      useCount: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.db.collection('saved_transfers').doc(transferId).set(transfer);
    
    console.log(`✅ Transfer saved: ${transferId}`);
    return transfer;
  }

  async getSavedTransfers(userId) {
    if (!this.initialized) await this.initialize();

    const snapshot = await this.db.collection('saved_transfers')
      .where('userId', '==', userId)
      .orderBy('favorite', 'desc')
      .orderBy('useCount', 'desc')
      .get();
    
    return snapshot.docs.map(doc => doc.data());
  }

  async updateTransferUsage(transferId) {
    if (!this.initialized) await this.initialize();

    const transferRef = this.db.collection('saved_transfers').doc(transferId);
    
    await transferRef.update({
      lastUsed: admin.firestore.FieldValue.serverTimestamp(),
      useCount: admin.firestore.FieldValue.increment(1)
    });
  }

  // ==================== PAYMENT HISTORY ====================

  async logPaymentHistory(userId, paymentData) {
    if (!this.initialized) await this.initialize();

    const historyId = `hist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const history = {
      historyId,
      userId,
      ...paymentData,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.db.collection('payment_history').doc(historyId).set(history);
    return history;
  }

  async getPaymentHistory(userId, limit = 50) {
    if (!this.initialized) await this.initialize();

    const snapshot = await this.db.collection('payment_history')
      .where('userId', '==', userId)
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();
    
    return snapshot.docs.map(doc => doc.data());
  }

  // ==================== CRON JOBS ====================

  initializeCronJobs() {
    // Check for due payments every minute
    cron.schedule('* * * * *', async () => {
      try {
        await this.checkDuePayments();
      } catch (error) {
        console.error('❌ Cron job error (due payments):', error.message);
      }
    });

    // Daily reminder at 9 AM
    cron.schedule('0 9 * * *', async () => {
      try {
        await this.sendDailyReminders();
      } catch (error) {
        console.error('❌ Cron job error (reminders):', error.message);
      }
    });

    console.log('✅ Cron jobs initialized');
    console.log('   - Payment execution: Every minute');
    console.log('   - Daily reminders: 9:00 AM');
  }

  async checkDuePayments() {
    if (!this.initialized) return;

    const now = admin.firestore.Timestamp.now();
    
    const snapshot = await this.db.collection('scheduled_payments')
      .where('status', '==', 'scheduled')
      .where('scheduledDate', '<=', now)
      .limit(10)
      .get();
    
    if (snapshot.empty) return;
    
    console.log(`⏰ Found ${snapshot.size} due payment(s)`);
    
    for (const doc of snapshot.docs) {
      try {
        await this.executeScheduledPayment(doc.id);
      } catch (error) {
        console.error(`❌ Failed to execute payment ${doc.id}:`, error.message);
      }
    }
  }

  async sendDailyReminders() {
    if (!this.initialized) return;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);
    
    const snapshot = await this.db.collection('scheduled_payments')
      .where('status', '==', 'scheduled')
      .where('scheduledDate', '>=', admin.firestore.Timestamp.fromDate(tomorrow))
      .where('scheduledDate', '<', admin.firestore.Timestamp.fromDate(dayAfter))
      .get();
    
    if (!snapshot.empty) {
      console.log(`📅 ${snapshot.size} payment(s) scheduled for tomorrow`);
      // TODO: Send notifications/emails to users
    }
  }

  // ==================== AI CONTEXT ====================

  async getAIContext(userId) {
    if (!this.initialized) await this.initialize();

    // Get upcoming payments (next 48 hours)
    const now = new Date();
    const future = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    
    const upcomingSnapshot = await this.db.collection('scheduled_payments')
      .where('userId', '==', userId)
      .where('status', '==', 'scheduled')
      .where('scheduledDate', '>=', admin.firestore.Timestamp.fromDate(now))
      .where('scheduledDate', '<=', admin.firestore.Timestamp.fromDate(future))
      .orderBy('scheduledDate', 'asc')
      .get();
    
    const upcomingPayments = upcomingSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        payee: data.payee,
        amount: data.amount,
        currency: data.currency,
        scheduledDate: data.scheduledDate.toDate(),
        recurring: data.recurring
      };
    });
    
    // Get recent payment history
    const historySnapshot = await this.db.collection('payment_history')
      .where('userId', '==', userId)
      .orderBy('timestamp', 'desc')
      .limit(10)
      .get();
    
    const recentPayments = historySnapshot.docs.slice(0, 5).map(doc => {
      const data = doc.data();
      return {
        payee: data.payee,
        amount: data.amount,
        currency: data.currency,
        status: data.status
      };
    });
    
    // Get saved transfers with high use count
    const transfersSnapshot = await this.db.collection('saved_transfers')
      .where('userId', '==', userId)
      .where('useCount', '>', 2)
      .orderBy('useCount', 'desc')
      .limit(10)
      .get();
    
    const frequentPayees = transfersSnapshot.docs.map(doc => {
      const data = doc.data();
      return data.nickname || data.payee;
    });
    
    return {
      upcomingPayments,
      recentPayments,
      frequentPayees
    };
  }
}

// Singleton instance
let schedulerInstance = null;

function getFirebaseScheduler() {
  if (!schedulerInstance) {
    schedulerInstance = new FirebasePaymentScheduler();
  }
  return schedulerInstance;
}

module.exports = {
  FirebasePaymentScheduler,
  getFirebaseScheduler
};