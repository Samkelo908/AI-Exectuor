const express = require('express');
const router = express.Router();
const { ScheduledPayment, SavedTransfer } = require('../services/paymentScheduler');

// Schedule a payment
router.post('/schedule', async (req, res) => {
  try {
    const { type, payee, amount, scheduledDate, recurring, description } = req.body;
    const userId = req.user?.id || 'demo-user';
    
    const payment = new ScheduledPayment({
      userId,
      paymentId: `pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      payee,
      amount,
      scheduledDate: new Date(scheduledDate),
      recurring: recurring || { enabled: false },
      description
    });
    
    await payment.save();
    
    res.json({ success: true, payment });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all scheduled payments
router.get('/scheduled', async (req, res) => {
  try {
    const userId = req.user?.id || 'demo-user';
    const payments = await ScheduledPayment.find({ userId, status: 'scheduled' })
      .sort({ scheduledDate: 1 });
    
    res.json({ success: true, payments });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Save a transfer
router.post('/transfers/save', async (req, res) => {
  try {
    const { payee, nickname, amount, category } = req.body;
    const userId = req.user?.id || 'demo-user';
    
    const transfer = new SavedTransfer({
      userId,
      transferId: `trans_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      payee,
      nickname,
      amount,
      category: category || 'other'
    });
    
    await transfer.save();
    
    res.json({ success: true, transfer });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get saved transfers
router.get('/transfers', async (req, res) => {
  try {
    const userId = req.user?.id || 'demo-user';
    const transfers = await SavedTransfer.find({ userId })
      .sort({ favorite: -1, lastUsed: -1 });
    
    res.json({ success: true, transfers });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Cancel scheduled payment
router.delete('/scheduled/:paymentId', async (req, res) => {
  try {
    const payment = await ScheduledPayment.findOne({ paymentId: req.params.paymentId });
    if (!payment) {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }
    
    payment.status = 'cancelled';
    await payment.save();
    
    res.json({ success: true, payment });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;