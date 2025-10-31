const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { logDecisionOnChain, updateDecisionStatus } = require('./decisionLogger');

class PaymentOrchestrator {
  constructor() {
    this.circleApiKey = process.env.CIRCLE_API_KEY;
    this.circleBaseUrl = process.env.CIRCLE_BASE_URL || 'https://api-sandbox.circle.com';
    this.mockMode = !this.circleApiKey;
    
    if (this.mockMode) {
      console.log('[ORCHESTRATOR] 🔧 Running in MOCK mode (no Circle API key)');
    } else {
      console.log('[ORCHESTRATOR] 💳 Connected to Circle API');
    }
  }
  
  async executePlan(plan, context) {
    const { userId, agent, wallet, instructionId } = context;
    
    console.log(`[ORCHESTRATOR] 🚀 Executing plan for user ${userId}`);
    console.log(`[ORCHESTRATOR] Actions: ${plan.actions.length}`);
    
    const results = [];
    let totalAmount = 0;
    let allSuccess = true;
    
    // Calculate total amount and risk
    for (const action of plan.actions) {
      if (action.amount) totalAmount += action.amount;
    }
    
    const riskScore = this.calculateRiskScore(totalAmount, wallet, agent);
    
    // Log decision to blockchain BEFORE execution
    let blockchainTx = null;
    if (instructionId) {
      try {
        const actionSummary = plan.actions
          .map(a => `${a.type}: ${a.to} ${a.amount ? a.amount + ' USDC' : ''}`)
          .join(', ');
        
        blockchainTx = await logDecisionOnChain(
          instructionId,
          actionSummary,
          '', // rationaleCID - could upload to IPFS
          '', // txRef - will update after Circle execution
          totalAmount,
          riskScore
        );
        
        if (blockchainTx.success) {
          console.log(`[ORCHESTRATOR] ✅ Decision logged on Arc: ${blockchainTx.explorerUrl}`);
        }
      } catch (error) {
        console.warn('[ORCHESTRATOR] ⚠️  Blockchain logging failed:', error.message);
      }
    }
    
    // Execute each action
    for (const action of plan.actions) {
      try {
        this.checkPolicy(action, agent, wallet);
        
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
        allSuccess = false;
        
        results.push({
          actionId: action.actionId,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    // Update blockchain status after execution
    if (blockchainTx && blockchainTx.success && instructionId) {
      try {
        const circleTxRefs = results
          .filter(r => r.circleTxId)
          .map(r => r.circleTxId)
          .join(',');
        
        await updateDecisionStatus(
          instructionId,
          allSuccess ? 'EXECUTED' : 'FAILED',
          circleTxRefs
        );
        
        console.log(`[ORCHESTRATOR] ✅ Blockchain status updated: ${allSuccess ? 'EXECUTED' : 'FAILED'}`);
      } catch (error) {
        console.warn('[ORCHESTRATOR] ⚠️  Status update failed:', error.message);
      }
    }
    
    return {
      results,
      executedAt: new Date().toISOString(),
      summary: this.generateSummary(results),
      blockchainTx
    };
  }
  
  checkPolicy(action, agent, wallet) {
    if (action.amount && action.amount > agent.dailyLimit) {
      throw new Error(`Amount ${action.amount} exceeds daily limit ${agent.dailyLimit}`);
    }
    
    if (action.amount && action.amount > wallet.balance) {
      throw new Error(`Insufficient balance: ${wallet.balance} < ${action.amount}`);
    }
    
    const blockedRecipients = ['scammer', 'fraud', 'blocked'];
    if (action.to && blockedRecipients.some(b => action.to.toLowerCase().includes(b))) {
      throw new Error(`Recipient ${action.to} is blocked`);
    }
  }
  
  calculateRiskScore(totalAmount, wallet, agent) {
    let risk = 0;
    
    if (totalAmount > wallet.balance * 0.5) risk += 0.3;
    if (totalAmount > wallet.balance) risk += 0.5;
    if (totalAmount > agent.dailyLimit * 0.5) risk += 0.2;
    if (totalAmount > agent.dailyLimit) risk += 0.4;
    
    return Math.min(risk, 1.0);
  }
  
  async executeTransfer(action, wallet) {
    if (this.mockMode) {
      return this.mockCircleTransfer(action, wallet);
    }
    
    try {
      const response = await axios.post(
        `${this.circleBaseUrl}/v1/transfers`,
        {
          idempotencyKey: uuidv4(),
          source: { type: 'wallet', id: wallet.circleWalletId },
          destination: {
            type: 'blockchain',
            address: this.resolveAddress(action.to),
            chain: 'ETH'
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
  
  async executeSave(action, wallet) {
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
    
    return await this.executeTransfer({
      ...action,
      amount: saveAmount,
      to: 'Savings Wallet Address'
    }, wallet);
  }
  
  async mockCircleTransfer(action, wallet) {
    await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 400));
    
    if (Math.random() < 0.05) {
      throw new Error('Simulated network timeout');
    }
    
    return {
      circleTxId: `circle_${uuidv4()}`,
      arcTxHash: `0x${this.generateTxHash()}`,
      amount: action.amount,
      to: action.to,
      blockchainTxUrl: `https://testnet.arcscan.app/tx/0x${this.generateTxHash()}`
    };
  }
  
  resolveAddress(recipient) {
    const mockAddresses = {
      'Netflix': '0xNetflix123456789AbCdEf',
      'Trainer': '0xTrainer123456789AbCdEf',
      'Savings Account': '0xSavings123456789AbCdEf'
    };
    
    return mockAddresses[recipient] || `0x${this.generateTxHash().slice(0, 40)}`;
  }
  
  generateTxHash() {
    return Array.from({ length: 64 }, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  }
  
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

const orchestrator = new PaymentOrchestrator();

async function executePlan(plan, context) {
  return await orchestrator.executePlan(plan, context);
}

module.exports = {
  executePlan,
  PaymentOrchestrator
};