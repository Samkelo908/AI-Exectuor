// backend/orchestrator.js
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

/**
 * Main orchestrator for executing payment plans
 * Integrates with Circle API and Arc blockchain
 */

class PaymentOrchestrator {
  constructor() {
    this.circleApiKey = process.env.CIRCLE_API_KEY;
    this.circleBaseUrl = process.env.CIRCLE_BASE_URL || 'https://api-sandbox.circle.com';
    this.mockMode = !this.circleApiKey;
    
    if (this.mockMode) {
      console.log('[ORCHESTRATOR] Running in MOCK mode (no Circle API key)');
    }
  }
  
  /**
   * Execute a complete action plan
   */
  async executePlan(plan, context) {
    const { userId, agent, wallet } = context;
    
    console.log(`[ORCHESTRATOR] Executing plan for user ${userId}`);
    console.log(`[ORCHESTRATOR] Actions: ${plan.actions.length}`);
    
    const results = [];
    
    for (const action of plan.actions) {
      try {
        // Policy check
        this.checkPolicy(action, agent, wallet);
        
        // Execute based on action type
        let result;
        if (action.type === 'TRANSFER') {
          result = await this.executeTransfer(action, wallet);
        } else if (action.type === 'SAVE') {
          result = await this.executeSave(action, wallet);
        } else {
          throw new Error(`Unknown action type: ${action.type}`);
        }
        
        results.push({
          actionId: action.actionId,
          ...result,
          status: 'confirmed'
        });
        
        console.log(`[ORCHESTRATOR] ✅ Action ${action.actionId} completed`);
        
      } catch (error) {
        console.error(`[ORCHESTRATOR] ❌ Action ${action.actionId} failed:`, error.message);
        
        results.push({
          actionId: action.actionId,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    return {
      results,
      executedAt: new Date().toISOString(),
      summary: this.generateSummary(results)
    };
  }
  
  /**
   * Check if action violates policies
   */
  checkPolicy(action, agent, wallet) {
    // Check daily limit
    if (action.amount && action.amount > agent.dailyLimit) {
      throw new Error(`Amount ${action.amount} exceeds daily limit ${agent.dailyLimit}`);
    }
    
    // Check balance
    if (action.amount && action.amount > wallet.balance) {
      throw new Error(`Insufficient balance: ${wallet.balance} < ${action.amount}`);
    }
    
    // Check for blocked recipients (example)
    const blockedRecipients = ['scammer', 'fraud', 'blocked'];
    if (action.to && blockedRecipients.some(b => action.to.toLowerCase().includes(b))) {
      throw new Error(`Recipient ${action.to} is blocked`);
    }
  }
  
  /**
   * Execute a transfer action
   */
  async executeTransfer(action, wallet) {
    if (this.mockMode) {
      return this.mockCircleTransfer(action, wallet);
    }
    
    try {
      // Real Circle API call
      const response = await axios.post(
        `${this.circleBaseUrl}/v1/transfers`,
        {
          idempotencyKey: uuidv4(),
          source: {
            type: 'wallet',
            id: wallet.circleWalletId
          },
          destination: {
            type: 'blockchain',
            address: this.resolveAddress(action.to),
            chain: 'ETH' // or Arc chain
          },
          amount: {
            amount: action.amount.toString(),
            currency: action.currency
          },
          metadata: {
            memo: action.memo || `Payment to ${action.to}`
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.circleApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      return {
        circleTxId: response.data.id,
        arcTxHash: `0x${this.generateTxHash()}`,
        amount: action.amount,
        to: action.to
      };
      
    } catch (error) {
      console.error('[ORCHESTRATOR] Circle API error:', error.message);
      throw new Error(`Transfer failed: ${error.message}`);
    }
  }
  
  /**
   * Execute a save action
   */
  async executeSave(action, wallet) {
    // Calculate amount to save
    const saveAmount = wallet.balance * (action.percent / 100);
    
    if (this.mockMode) {
      return {
        circleTxId: `circle_save_${uuidv4()}`,
        arcTxHash: `0x${this.generateTxHash()}`,
        amount: saveAmount,
        to: 'Savings Account',
        percent: action.percent
      };
    }
    
    // In real implementation, transfer to savings wallet
    return await this.executeTransfer({
      ...action,
      amount: saveAmount,
      to: 'Savings Wallet Address'
    }, wallet);
  }
  
  /**
   * Mock Circle transfer for testing
   */
  async mockCircleTransfer(action, wallet) {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 400));
    
    // Simulate occasional failures
    if (Math.random() < 0.05) {
      throw new Error('Simulated network timeout');
    }
    
    return {
      circleTxId: `circle_${uuidv4()}`,
      arcTxHash: `0x${this.generateTxHash()}`,
      amount: action.amount,
      to: action.to,
      blockchainTxUrl: `https://arc-explorer.xyz/tx/0x${this.generateTxHash()}`
    };
  }
  
  /**
   * Resolve recipient name to address
   */
  resolveAddress(recipient) {
    // In production, lookup address from contacts/directory
    const mockAddresses = {
      'Netflix': '0xNetflix123456789AbCdEf',
      'Trainer': '0xTrainer123456789AbCdEf',
      'Savings Account': '0xSavings123456789AbCdEf'
    };
    
    return mockAddresses[recipient] || `0x${this.generateTxHash().slice(0, 40)}`;
  }
  
  /**
   * Generate mock transaction hash
   */
  generateTxHash() {
    return Array.from({ length: 64 }, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  }
  
  /**
   * Generate execution summary
   */
  generateSummary(results) {
    const successful = results.filter(r => r.status === 'confirmed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const totalAmount = results
      .filter(r => r.amount)
      .reduce((sum, r) => sum + r.amount, 0);
    
    return {
      total: results.length,
      successful,
      failed,
      totalAmount,
      message: `Executed ${successful}/${results.length} actions successfully${
        totalAmount > 0 ? ` (${totalAmount.toFixed(2)} USDC)` : ''
      }`
    };
  }
}

// Singleton instance
const orchestrator = new PaymentOrchestrator();

/**
 * Execute a payment plan
 */
async function executePlan(plan, context) {
  return await orchestrator.executePlan(plan, context);
}

module.exports = {
  executePlan,
  PaymentOrchestrator
};