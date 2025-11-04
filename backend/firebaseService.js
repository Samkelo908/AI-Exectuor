// firebaseService.js - Firebase Integration for ArcBot with AI Memory & Scheduled Payments
const admin = require('firebase-admin');
const cron = require('node-cron');

class FirebaseService {
  constructor() {
    this.initialized = false;
    this.db = null;
    this.collections = {
      scheduledPayments: 'scheduled_payments',
      savedTransfers: 'saved_transfers',
      conversations: 'conversations',
      paymentHistory: 'payment_history'
    };
  }

  async initialize() {
    if (this.initialized) {
      console.log('✅ Firebase already initialized');
      return;
    }

    try {
      // Initialize Firebase Admin SDK
      const credentialsPath = process.env.FIREBASE_CREDENTIALS_PATH;
      
      if (credentialsPath) {
        // Use service account file
        const serviceAccount = require(credentialsPath);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
      } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
        // Use individual environment variables
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
          })
        });
      } else {
        throw new Error('Firebase credentials not found. Set FIREBASE_CREDENTIALS_PATH or individual variables in .env');
      }

      this.db = admin.firestore();
      this.initialized = true;

      console.log('✅ Firebase initialized successfully');
      console.log(`📦 Project: ${admin.app().options.credential.projectId}`);

      // Initialize cron jobs for scheduled payments
      this.initializeCronJobs();

      return true;
    } catch (error) {
      console.error('❌ Firebase initialization failed:', error.message);
      throw error;
    }
  }

  // ==================== SCHEDULED PAYMENTS ====================

  async schedulePayment(userId, paymentData) {
    const paymentId = `pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const payment = {
      userId,
      paymentId,
      type: paymentData.type,
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
      failureReason: null
    };

    await this.db.collection(this.collections.scheduledPayments).doc(paymentId).set(payment);
    
    console.log(`✅ Payment scheduled: ${paymentId} for ${paymentData.scheduledDate}`);
    return { ...payment, paymentId };
  }

  async getScheduledPayments(userId, filter = {}) {
    let query = this.db.collection(this.collections.scheduledPayments).where('userId', '==', userId);
    
    if (filter.status) {
      query = query.where('status', '==', filter.status);
    }
    
    const snapshot = await query.orderBy('scheduledDate', 'asc').get();
    
    return snapshot.docs.map(doc => ({
      ...doc.data(),
      scheduledDate: doc.data().scheduledDate.toDate()
    }));
  }

  async getUpcomingPayments(userId, hoursAhead = 24) {
    const now = new Date();
    const future = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);
    
    const snapshot = await this.db.collection(this.collections.scheduledPayments)
      .where('userId', '==', userId)
      .where('status', '==', 'scheduled')
      .where('scheduledDate', '>=', admin.firestore.Timestamp.fromDate(now))
      .where('scheduledDate', '<=', admin.firestore.Timestamp.fromDate(future))
      .orderBy('scheduledDate', 'asc')
      .get();
    
    return snapshot.docs.map(doc => ({
      ...doc.data(),
      scheduledDate: doc.data().scheduledDate.toDate()
    }));
  }

  async executeScheduledPayment(paymentId) {
    const paymentRef = this.db.collection(this.collections.scheduledPayments).doc(paymentId);
    const paymentDoc = await paymentRef.get();
    
    if (!paymentDoc.exists) {
      throw new Error('Payment not found');
    }
    
    const payment = paymentDoc.data();
    
    try {
      console.log(`💸 Executing payment: ${paymentId}`);
      console.log(`   To: ${payment.payee}`);
      console.log(`   Amount: ${payment.amount} ${payment.currency}`);
      
      // TODO: Integrate with your actual payment execution logic here
      // For now, mark as completed
      
      await paymentRef.update({
        status: 'completed',
        executedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      // Log to payment history
      await this.logPaymentHistory(payment.userId, {
        paymentId,
        type: 'scheduled',
        payee: payment.payee,
        amount: payment.amount,
        currency: payment.currency,
        status: 'completed'
      });
      
      // Handle recurring payments
      if (payment.recurring && payment.recurring.enabled) {
        await this.scheduleRecurringPayment(payment);
      }
      
      return { success: true };
    } catch (error) {
      console.error('❌ Error executing payment:', error);
      
      await paymentRef.update({
        status: 'failed',
        failureReason: error.message
      });
      
      return { success: false, error: error.message };
    }
  }

  async scheduleRecurringPayment(payment) {
    const currentDate = payment.scheduledDate.toDate();
    const nextDate = this.calculateNextDate(currentDate, payment.recurring.frequency);
    
    // Check if there's an end date and if we've passed it
    if (payment.recurring.endDate) {
      const endDate = new Date(payment.recurring.endDate);
      if (nextDate > endDate) {
        console.log(`⏹️ Recurring payment ended: ${payment.paymentId}`);
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
    
    console.log(`🔁 Next recurring payment scheduled for ${nextDate}`);
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
    }
    
    return date;
  }

  async cancelScheduledPayment(paymentId) {
    const paymentRef = this.db.collection(this.collections.scheduledPayments).doc(paymentId);
    const paymentDoc = await paymentRef.get();
    
    if (!paymentDoc.exists) {
      throw new Error('Payment not found');
    }
    
    await paymentRef.update({
      status: 'cancelled'
    });
    
    console.log(`❌ Payment cancelled: ${paymentId}`);
    return paymentDoc.data();
  }

  // ==================== SAVED TRANSFERS ====================

  async saveTransfer(userId, transferData) {
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

    await this.db.collection(this.collections.savedTransfers).doc(transferId).set(transfer);
    
    console.log(`✅ Transfer saved: ${transferId}`);
    return transfer;
  }

  async getSavedTransfers(userId) {
    const snapshot = await this.db.collection(this.collections.savedTransfers)
      .where('userId', '==', userId)
      .orderBy('favorite', 'desc')
      .orderBy('lastUsed', 'desc')
      .get();
    
    return snapshot.docs.map(doc => doc.data());
  }

  async updateTransferUsage(transferId) {
    const transferRef = this.db.collection(this.collections.savedTransfers).doc(transferId);
    
    await transferRef.update({
      lastUsed: admin.firestore.FieldValue.serverTimestamp(),
      useCount: admin.firestore.FieldValue.increment(1)
    });
  }

  // ==================== AI CONVERSATION MEMORY ====================

  async saveConversation(userId, messages) {
    const conversationId = `conv_${Date.now()}`;
    
    const conversation = {
      conversationId,
      userId,
      messages,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.db.collection(this.collections.conversations).doc(conversationId).set(conversation);
    return conversation;
  }

  async getRecentConversations(userId, limit = 5) {
    const snapshot = await this.db.collection(this.collections.conversations)
      .where('userId', '==', userId)
      .orderBy('lastUpdated', 'desc')
      .limit(limit)
      .get();
    
    return snapshot.docs.map(doc => doc.data());
  }

  async addMessageToConversation(conversationId, message) {
    const conversationRef = this.db.collection(this.collections.conversations).doc(conversationId);
    
    await conversationRef.update({
      messages: admin.firestore.FieldValue.arrayUnion(message),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  // ==================== PAYMENT HISTORY ====================

  async logPaymentHistory(userId, paymentData) {
    const historyId = `hist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const history = {
      historyId,
      userId,
      ...paymentData,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };

    await this.db.collection(this.collections.paymentHistory).doc(historyId).set(history);
    return history;
  }

  async getPaymentHistory(userId, limit = 50) {
    const snapshot = await this.db.collection(this.collections.paymentHistory)
      .where('userId', '==', userId)
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();
    
    return snapshot.docs.map(doc => doc.data());
  }

  // ==================== AI CONTEXT FOR REMINDERS ====================

  async getAIContext(userId) {
    // Get upcoming payments for AI context
    const upcomingPayments = await this.getUpcomingPayments(userId, 48); // Next 48 hours
    
    // Get recent payment history
    const recentHistory = await this.getPaymentHistory(userId, 10);
    
    // Get saved transfers
    const savedTransfers = await this.getSavedTransfers(userId);
    
    return {
      upcomingPayments: upcomingPayments.map(p => ({
        payee: p.payee,
        amount: p.amount,
        currency: p.currency,
        scheduledDate: p.scheduledDate,
        recurring: p.recurring
      })),
      recentPayments: recentHistory.slice(0, 5).map(h => ({
        payee: h.payee,
        amount: h.amount,
        currency: h.currency,
        status: h.status
      })),
      frequentPayees: savedTransfers
        .filter(t => t.useCount > 2)
        .map(t => t.nickname || t.payee)
    };
  }

  // ==================== CRON JOBS ====================

  initializeCronJobs() {
    // Check for due payments every minute
    cron.schedule('* * * * *', async () => {
      await this.checkDuePayments();
    });

    // Send daily reminders at 9 AM
    cron.schedule('0 9 * * *', async () => {
      await this.sendDailyReminders();
    });

    console.log('✅ Cron jobs initialized');
    console.log('   - Payment execution: Every minute');
    console.log('   - Daily reminders: 9:00 AM');
  }

  async checkDuePayments() {
    try {
      const now = admin.firestore.Timestamp.now();
      
      const snapshot = await this.db.collection(this.collections.scheduledPayments)
        .where('status', '==', 'scheduled')
        .where('scheduledDate', '<=', now)
        .get();
      
      for (const doc of snapshot.docs) {
        await this.executeScheduledPayment(doc.id);
      }
    } catch (error) {
      console.error('Error checking due payments:', error);
    }
  }

  async sendDailyReminders() {
    try {
      // Get all users with upcoming payments
      const snapshot = await this.db.collection(this.collections.scheduledPayments)
        .where('status', '==', 'scheduled')
        .get();
      
      const userPayments = {};
      
      snapshot.docs.forEach(doc => {
        const payment = doc.data();
        if (!userPayments[payment.userId]) {
          userPayments[payment.userId] = [];
        }
        userPayments[payment.userId].push(payment);
      });
      
      for (const [userId, payments] of Object.entries(userPayments)) {
        const today = payments.filter(p => {
          const paymentDate = p.scheduledDate.toDate();
          const now = new Date();
          return paymentDate.toDateString() === now.toDateString();
        });
        
        if (today.length > 0) {
          console.log(`📅 Reminder: User ${userId} has ${today.length} payment(s) today`);
          // TODO: Send notification/email
        }
      }
    } catch (error) {
      console.error('Error sending daily reminders:', error);
    }
  }
}

// Singleton instance
let firebaseServiceInstance = null;

function getFirebaseService() {
  if (!firebaseServiceInstance) {
    firebaseServiceInstance = new FirebaseService();
  }
  return firebaseServiceInstance;
}

module.exports = {
  FirebaseService,
  getFirebaseService
};