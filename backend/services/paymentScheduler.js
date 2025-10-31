const mongoose = require('mongoose');
const cron = require('node-cron');

// MongoDB Connection
const connectDB = async () => {
  try {
    await mongoose.connect('mongodb://localhost:27017/arcbot', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Scheduled Payment Schema
const ScheduledPaymentSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  paymentId: { type: String, required: true, unique: true },
  
  type: { type: String, enum: ['PAY', 'TRANSFER', 'SAVE'], required: true },
  payee: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'USDC' },
  
  scheduledDate: { type: Date, required: true },
  recurring: {
    enabled: { type: Boolean, default: false },
    frequency: { type: String, enum: ['daily', 'weekly', 'monthly', 'yearly'] },
    endDate: Date
  },
  
  status: { 
    type: String, 
    enum: ['scheduled', 'completed', 'failed', 'cancelled'],
    default: 'scheduled'
  },
  
  description: String,
  tags: [String],
  createdAt: { type: Date, default: Date.now },
  executedAt: Date,
  failureReason: String
});

// Saved Transfer Schema
const SavedTransferSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  transferId: { type: String, required: true, unique: true },
  
  payee: { type: String, required: true },
  nickname: String,
  amount: Number,
  currency: { type: String, default: 'USDC' },
  
  category: { type: String, enum: ['subscription', 'personal', 'savings', 'bills', 'other'] },
  favorite: { type: Boolean, default: false },
  lastUsed: Date,
  useCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const ScheduledPayment = mongoose.model('ScheduledPayment', ScheduledPaymentSchema);
const SavedTransfer = mongoose.model('SavedTransfer', SavedTransferSchema);

// Payment Scheduler Service
class PaymentSchedulerService {
  constructor() {
    this.initializeCronJobs();
  }
  
  initializeCronJobs() {
    // Check for scheduled payments every minute
    cron.schedule('* * * * *', async () => {
      await this.executeScheduledPayments();
    });
    
    console.log('✅ Cron jobs initialized');
  }
  
  async schedulePayment(userId, paymentData) {
    const paymentId = `pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const scheduledPayment = new ScheduledPayment({
      userId,
      paymentId,
      type: paymentData.type,
      payee: paymentData.payee,
      amount: paymentData.amount,
      currency: paymentData.currency || 'USDC',
      scheduledDate: new Date(paymentData.scheduledDate),
      recurring: paymentData.recurring || { enabled: false },
      description: paymentData.description,
      tags: paymentData.tags || []
    });
    
    await scheduledPayment.save();
    return scheduledPayment;
  }
  
  async executeScheduledPayments() {
    const now = new Date();
    
    const duePayments = await ScheduledPayment.find({
      scheduledDate: { $lte: now },
      status: 'scheduled'
    });
    
    for (const payment of duePayments) {
      await this.executePayment(payment);
    }
  }
  
  async executePayment(payment) {
    try {
      console.log(`💸 Executing payment: ${payment.paymentId}`);
      console.log(`   To: ${payment.payee}`);
      console.log(`   Amount: ${payment.amount} ${payment.currency}`);
      
      // TODO: Integrate with your actual payment execution logic here
      
      payment.status = 'completed';
      payment.executedAt = new Date();
      await payment.save();
      
      if (payment.recurring.enabled) {
        await this.scheduleRecurringPayment(payment);
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error executing payment:', error);
      
      payment.status = 'failed';
      payment.failureReason = error.message;
      await payment.save();
      
      return { success: false, error: error.message };
    }
  }
  
  async scheduleRecurringPayment(payment) {
    const nextDate = this.calculateNextDate(
      payment.scheduledDate, 
      payment.recurring.frequency
    );
    
    if (payment.recurring.endDate && nextDate > payment.recurring.endDate) {
      return;
    }
    
    const nextPayment = new ScheduledPayment({
      userId: payment.userId,
      paymentId: `pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: payment.type,
      payee: payment.payee,
      amount: payment.amount,
      currency: payment.currency,
      scheduledDate: nextDate,
      recurring: payment.recurring,
      description: payment.description,
      tags: payment.tags
    });
    
    await nextPayment.save();
    return nextPayment;
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
  
  async saveTransfer(userId, transferData) {
    const transferId = `trans_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const savedTransfer = new SavedTransfer({
      userId,
      transferId,
      payee: transferData.payee,
      nickname: transferData.nickname,
      amount: transferData.amount,
      currency: transferData.currency || 'USDC',
      category: transferData.category || 'other',
      favorite: transferData.favorite || false
    });
    
    await savedTransfer.save();
    return savedTransfer;
  }
  
  async getUserScheduledPayments(userId, filter = {}) {
    const query = { userId, ...filter };
    return await ScheduledPayment.find(query).sort({ scheduledDate: 1 });
  }
  
  async getUserSavedTransfers(userId) {
    return await SavedTransfer.find({ userId }).sort({ favorite: -1, lastUsed: -1 });
  }
  
  async cancelScheduledPayment(paymentId) {
    const payment = await ScheduledPayment.findOne({ paymentId });
    if (!payment) throw new Error('Payment not found');
    
    payment.status = 'cancelled';
    await payment.save();
    
    return payment;
  }
}

module.exports = {
  connectDB,
  PaymentSchedulerService,
  ScheduledPayment,
  SavedTransfer
};