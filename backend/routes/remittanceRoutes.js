// ==================== REMITTANCE ROUTES ====================
// Add these routes to your server.js file

// Initialize Remittance Service (add to top of server.js)
const { getRemittanceService } = require('./services/remittanceService');
const { getCrossBorderService } = require('./services/crossBorderService');
const { getExchangeRateService } = require('./services/exchangeRateService');

// Initialize services after Firebase initialization
let remittanceService = null;
let crossBorderService = null;
let exchangeRateService = null;

(async () => {
  // ... existing initialization code ...
  
  // Initialize cross-border services
  exchangeRateService = getExchangeRateService();
  crossBorderService = getCrossBorderService(paymentScheduler);
  remittanceService = getRemittanceService(thirdwebPayments, paymentScheduler);
  
  console.log('[REMITTANCE] ✅ Cross-border services initialized');
})();

// ==================== RECIPIENT MANAGEMENT ROUTES ====================

/**
 * Add a new recipient
 * POST /api/remittance/recipients
 */
app.post('/api/remittance/recipients', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 'demo-user';
    const recipientData = req.body;
    
    const recipient = await crossBorderService.addRecipient(userId, recipientData);
    
    res.json({
      success: true,
      recipient
    });
  } catch (error) {
    console.error('[API] Add recipient error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get all recipients
 * GET /api/remittance/recipients
 */
app.get('/api/remittance/recipients', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 'demo-user';
    const filter = {
      country: req.query.country,
      favorite: req.query.favorite === 'true'
    };
    
    const recipients = await crossBorderService.getRecipients(userId, filter);
    
    res.json({
      success: true,
      recipients,
      count: recipients.length
    });
  } catch (error) {
    console.error('[API] Get recipients error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get a specific recipient
 * GET /api/remittance/recipients/:recipientId
 */
app.get('/api/remittance/recipients/:recipientId', async (req, res) => {
  try {
    const { recipientId } = req.params;
    const recipient = await crossBorderService.getRecipient(recipientId);
    
    res.json({
      success: true,
      recipient
    });
  } catch (error) {
    console.error('[API] Get recipient error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Toggle recipient favorite
 * POST /api/remittance/recipients/:recipientId/favorite
 */
app.post('/api/remittance/recipients/:recipientId/favorite', async (req, res) => {
  try {
    const { recipientId } = req.params;
    const isFavorite = await crossBorderService.toggleFavorite(recipientId);
    
    res.json({
      success: true,
      favorite: isFavorite
    });
  } catch (error) {
    console.error('[API] Toggle favorite error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Delete recipient
 * DELETE /api/remittance/recipients/:recipientId
 */
app.delete('/api/remittance/recipients/:recipientId', async (req, res) => {
  try {
    const { recipientId } = req.params;
    await crossBorderService.deleteRecipient(recipientId);
    
    res.json({
      success: true,
      message: 'Recipient deleted successfully'
    });
  } catch (error) {
    console.error('[API] Delete recipient error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== EXCHANGE RATE ROUTES ====================

/**
 * Get current exchange rate
 * GET /api/remittance/rates?from=USDC&to=KES
 */
app.get('/api/remittance/rates', async (req, res) => {
  try {
    const { from = 'USDC', to } = req.query;
    
    if (!to) {
      return res.status(400).json({ error: 'Target currency required' });
    }
    
    const rateInfo = await remittanceService.getExchangeRate(from, to);
    
    res.json(rateInfo);
  } catch (error) {
    console.error('[API] Get rate error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get all available rates
 * GET /api/remittance/rates/all
 */
app.get('/api/remittance/rates/all', async (req, res) => {
  try {
    const rates = await remittanceService.getAllRates();
    
    res.json({
      success: true,
      rates,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[API] Get all rates error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get supported currencies
 * GET /api/remittance/currencies
 */
app.get('/api/remittance/currencies', async (req, res) => {
  try {
    const currencies = exchangeRateService.getSupportedCurrencies();
    
    res.json({
      success: true,
      currencies
    });
  } catch (error) {
    console.error('[API] Get currencies error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== REMITTANCE TRANSACTION ROUTES ====================

/**
 * Preview remittance (calculate fees, rates, etc.)
 * POST /api/remittance/preview
 */
app.post('/api/remittance/preview', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 'demo-user';
    const { recipientId, amount } = req.body;
    
    if (!recipientId || !amount) {
      return res.status(400).json({ 
        error: 'recipientId and amount are required' 
      });
    }
    
    const preview = await remittanceService.previewRemittance(
      userId,
      recipientId,
      parseFloat(amount)
    );
    
    res.json(preview);
  } catch (error) {
    console.error('[API] Preview remittance error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Send remittance
 * POST /api/remittance/send
 */
app.post('/api/remittance/send', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 'demo-user';
    const { recipientId, amount, description } = req.body;
    
    if (!recipientId || !amount) {
      return res.status(400).json({ 
        error: 'recipientId and amount are required' 
      });
    }
    
    console.log(`[API] Sending remittance: ${amount} USDC to ${recipientId}`);
    
    const result = await remittanceService.sendRemittance(userId, {
      recipientId,
      amount: parseFloat(amount),
      description: description || 'Cross-border remittance'
    });
    
    if (result.success) {
      // Refresh wallet balance
      await getFreshWalletData(true);
      
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('[API] Send remittance error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

/**
 * Quick send to saved recipient
 * POST /api/remittance/quick-send
 */
app.post('/api/remittance/quick-send', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 'demo-user';
    const { recipientId, amount } = req.body;
    
    const result = await remittanceService.quickSend(
      userId,
      recipientId,
      parseFloat(amount)
    );
    
    res.json(result);
  } catch (error) {
    console.error('[API] Quick send error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get remittance history
 * GET /api/remittance/history
 */
app.get('/api/remittance/history', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 'demo-user';
    const options = {
      limit: parseInt(req.query.limit) || 50,
      country: req.query.country,
      status: req.query.status
    };
    
    const history = await remittanceService.getHistory(userId, options);
    
    res.json({
      success: true,
      history,
      count: history.length
    });
  } catch (error) {
    console.error('[API] Get history error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Track delivery status
 * GET /api/remittance/track/:remittanceId
 */
app.get('/api/remittance/track/:remittanceId', async (req, res) => {
  try {
    const { remittanceId } = req.params;
    const tracking = await remittanceService.trackDelivery(remittanceId);
    
    res.json({
      success: true,
      tracking
    });
  } catch (error) {
    console.error('[API] Track delivery error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get remittance statistics
 * GET /api/remittance/stats?period=month
 */
app.get('/api/remittance/stats', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 'demo-user';
    const period = req.query.period || 'month';
    
    const stats = await remittanceService.getStats(userId, period);
    
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('[API] Get stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get suggested recipients
 * GET /api/remittance/suggestions
 */
app.get('/api/remittance/suggestions', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 'demo-user';
    const limit = parseInt(req.query.limit) || 5;
    
    const suggestions = await remittanceService.getSuggestedRecipients(userId, limit);
    
    res.json({
      success: true,
      suggestions
    });
  } catch (error) {
    console.error('[API] Get suggestions error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Cancel remittance (before execution)
 * POST /api/remittance/:remittanceId/cancel
 */
app.post('/api/remittance/:remittanceId/cancel', async (req, res) => {
  try {
    const { remittanceId } = req.params;
    const result = await remittanceService.cancelRemittance(remittanceId);
    
    res.json(result);
  } catch (error) {
    console.error('[API] Cancel remittance error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== PAYMENT CORRIDOR ROUTES ====================

/**
 * Get available payment corridors
 * GET /api/remittance/corridors
 */
app.get('/api/remittance/corridors', async (req, res) => {
  try {
    const corridors = crossBorderService.getAvailableCorridors();
    
    res.json({
      success: true,
      corridors
    });
  } catch (error) {
    console.error('[API] Get corridors error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== KYC ROUTES ====================

/**
 * Submit KYC data
 * POST /api/remittance/kyc
 */
app.post('/api/remittance/kyc', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 'demo-user';
    const kycData = req.body;
    
    const verification = await crossBorderService.saveKYCData(userId, kycData);
    
    res.json({
      success: true,
      verification,
      message: 'KYC data submitted successfully. Verification pending.'
    });
  } catch (error) {
    console.error('[API] Submit KYC error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get KYC status
 * GET /api/remittance/kyc/status
 */
app.get('/api/remittance/kyc/status', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 'demo-user';
    const status = await crossBorderService.getKYCStatus(userId);
    
    res.json({
      success: true,
      kyc: status
    });
  } catch (error) {
    console.error('[API] Get KYC status error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Export for use in server.js
module.exports = {
  // Routes are added directly to app in server.js
  // This file provides the route definitions
};