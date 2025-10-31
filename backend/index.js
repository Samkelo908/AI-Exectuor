// Load environment variables FIRST
require('dotenv').config();

// Debug environment variables
console.log('=== ENVIRONMENT CHECK ===');
console.log('USER_WALLET_ADDRESS from env:', process.env.USER_WALLET_ADDRESS);
console.log('USER_WALLET_ADDRESS length:', process.env.USER_WALLET_ADDRESS?.length);
console.log('ARC_USDC_CONTRACT from env:', process.env.ARC_USDC_CONTRACT);
console.log('ARC_USDC_CONTRACT length:', process.env.ARC_USDC_CONTRACT?.length);

// Validate addresses
const { ethers } = require('ethers');
console.log('USER_WALLET_ADDRESS valid?', ethers.isAddress(process.env.USER_WALLET_ADDRESS));
console.log('ARC_USDC_CONTRACT valid?', ethers.isAddress(process.env.ARC_USDC_CONTRACT));

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// Import services
const { connectDB, PaymentSchedulerService, ScheduledPayment } = require('./services/paymentScheduler');
const { executePlan } = require('./orchestrator');
const { logDecisionOnChain, getContractInfo, getDecisionFromChain, updateDecisionStatus } = require('./decisionLogger');
const { parseInstructionWithScheduling, formatDateForDisplay } = require('./enhancedParser');
const { getWalletService } = require('./walletService');
const { getThirdwebPaymentService } = require('./thirdwebPayments');

const app = express();

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());

// Connect to MongoDB
connectDB().then(() => {
  console.log('✅ Database ready');
}).catch(err => {
  console.error('❌ Database connection failed:', err);
});

// Initialize Payment Scheduler Service
const paymentScheduler = new PaymentSchedulerService();

// Initialize Wallet Service
const walletService = getWalletService();

// Initialize Thirdweb x402 Service
const thirdwebPayments = getThirdwebPaymentService();

// YOUR ACTUAL WALLET ADDRESS - Replace with your real address
const USER_WALLET_ADDRESS = process.env.USER_WALLET_ADDRESS;

const ARC_USDC_CONTRACT = process.env.ARC_USDC_CONTRACT || '0x3C3380cdFb94dFEEaA41cAD9F58254AE380d752D';
// Cache wallet data to avoid excessive RPC calls
let cachedWalletData = null;
let lastFetchTime = 0;
const CACHE_DURATION = 30000; // 30 seconds

// Helper function to get fresh wallet data
async function getFreshWalletData(forceRefresh = false) {
  const now = Date.now();
  
  // Return cached data if fresh enough
  if (!forceRefresh && cachedWalletData && (now - lastFetchTime) < CACHE_DURATION) {
    return cachedWalletData;
  }
  
  try {
    console.log('[WALLET] Fetching fresh wallet data from Arc blockchain...');
    
    const walletInfo = await walletService.getWalletInfo(
      USER_WALLET_ADDRESS,
      ARC_USDC_CONTRACT
    );
    
    cachedWalletData = {
      id: 'demo-user',
      wallet: {
        address: USER_WALLET_ADDRESS,
        balance: walletInfo.balances.usdc || 0, // USDC balance
        arcBalance: walletInfo.balances.arc, // Native ARC balance
        transactionCount: walletInfo.transactionCount,
        circleWalletId: 'arc_wallet_' + USER_WALLET_ADDRESS.slice(2, 10)
      },
      agent: {
        personality: 'balanced',
        dailyLimit: 500
      },
      network: walletInfo.network,
      lastUpdated: walletInfo.lastUpdated
    };
    
    lastFetchTime = now;
    
    console.log('[WALLET] ✅ Wallet data updated:', {
      address: USER_WALLET_ADDRESS.slice(0, 10) + '...',
      usdcBalance: cachedWalletData.wallet.balance,
      arcBalance: cachedWalletData.wallet.arcBalance,
      txCount: cachedWalletData.wallet.transactionCount
    });
    
    return cachedWalletData;
  } catch (error) {
    console.error('[WALLET] ❌ Error fetching wallet data:', error.message);
    
    // Return fallback data if fetch fails
    if (cachedWalletData) {
      console.log('[WALLET] Using cached data as fallback');
      return cachedWalletData;
    }
    
    // Return mock data as last resort
    return {
      id: 'demo-user',
      wallet: {
        address: USER_WALLET_ADDRESS,
        balance: 0,
        arcBalance: 0,
        transactionCount: 0,
        circleWalletId: 'arc_wallet_error'
      },
      agent: {
        personality: 'balanced',
        dailyLimit: 500
      },
      error: 'Failed to fetch wallet data'
    };
  }
}

// Update mockUser to use real wallet data
let mockUser = null;

// Initialize wallet data on startup
(async () => {
  try {
    mockUser = await getFreshWalletData();
    console.log('[WALLET] 🎯 Real wallet integrated successfully!');
  } catch (error) {
    console.error('[WALLET] Failed to initialize wallet:', error);
    // Fallback to basic mock user
    mockUser = {
      id: 'demo-user',
      wallet: {
        address: USER_WALLET_ADDRESS,
        balance: 0,
        circleWalletId: 'wallet_demo_123'
      },
      agent: {
        personality: 'balanced',
        dailyLimit: 500
      }
    };
  }
})();

// In-memory instruction store
const STORE = {
  instructions: {},
  transactions: {}
};

// ==================== ROUTES ====================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    mongodb: require('mongoose').connection.readyState === 1 ? 'connected' : 'disconnected',
    cloudflare: process.env.CLOUDFLARE_WORKER_URL ? 'configured' : 'not configured',
    blockchain: process.env.DECISION_CONTRACT_ADDRESS ? 'configured' : 'not configured',
    wallet: cachedWalletData ? 'connected' : 'initializing',
    thirdweb: 'ready',
    timestamp: new Date().toISOString() 
  });
});

// Get user profile with REAL wallet data
app.get('/api/me', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const walletData = await getFreshWalletData(forceRefresh);
    res.json(walletData);
  } catch (error) {
    console.error('[API] /me error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch wallet data',
      message: error.message 
    });
  }
});

// NEW ENDPOINT: Get detailed wallet info
app.get('/api/wallet/details', async (req, res) => {
  try {
    const walletInfo = await walletService.getWalletInfo(
      USER_WALLET_ADDRESS,
      ARC_USDC_CONTRACT
    );
    
    const gasPrice = await walletService.getGasPrice();
    
    res.json({
      ...walletInfo,
      gasPrice
    });
  } catch (error) {
    console.error('[API] /wallet/details error:', error);
    res.status(500).json({ error: error.message });
  }
});

// NEW ENDPOINT: Get wallet transactions
app.get('/api/wallet/transactions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 1000;
    const transactions = await walletService.getRecentTransactions(
      USER_WALLET_ADDRESS,
      limit
    );
    
    res.json({
      address: USER_WALLET_ADDRESS,
      transactions,
      count: transactions.length
    });
  } catch (error) {
    console.error('[API] /wallet/transactions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// NEW ENDPOINT: Refresh wallet balance
app.post('/api/wallet/refresh', async (req, res) => {
  try {
    const freshData = await getFreshWalletData(true);
    res.json({
      success: true,
      wallet: freshData.wallet,
      message: 'Wallet data refreshed successfully'
    });
  } catch (error) {
    console.error('[API] /wallet/refresh error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== THIRDWEB x402 PAYMENT ROUTES ====================

// Initialize Thirdweb (called automatically on first use)
app.post('/api/thirdweb/initialize', async (req, res) => {
  try {
    await thirdwebPayments.initialize();
    const address = thirdwebPayments.getWalletAddress();
    
    res.json({
      success: true,
      walletAddress: address,
      message: 'Thirdweb x402 initialized successfully'
    });
  } catch (error) {
    console.error('[API] Thirdweb init error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Create payment request
app.post('/api/thirdweb/payment/create', async (req, res) => {
  try {
    const { to, amount, currency, description, metadata } = req.body;
    
    if (!to || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: to, amount'
      });
    }
    
    console.log(`[THIRDWEB API] Creating payment: ${amount} ${currency} to ${to}`);
    
    const paymentRequest = await thirdwebPayments.createPaymentRequest({
      to,
      amount: parseFloat(amount),
      currency: currency || 'USDC',
      description: description || `Payment to ${to}`,
      metadata: metadata || {}
    });
    
    res.json({
      success: true,
      payment: paymentRequest
    });
  } catch (error) {
    console.error('[API] Thirdweb create payment error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Execute payment
app.post('/api/thirdweb/payment/execute', async (req, res) => {
  try {
    const { payment } = req.body;
    
    if (!payment || !payment.to || !payment.amount) {
      return res.status(400).json({
        success: false,
        error: 'Invalid payment request'
      });
    }
    
    console.log(`[THIRDWEB API] Executing payment: ${payment.id}`);
    
    // Check balance first
    const hasFunds = await thirdwebPayments.hasSufficientBalance(
      payment.amount,
      payment.currency
    );
    
    if (!hasFunds) {
      return res.status(400).json({
        success: false,
        error: `Insufficient ${payment.currency} balance`
      });
    }
    
    const result = await thirdwebPayments.executePayment(payment);
    
    if (result.status === 'completed') {
      res.json({
        success: true,
        payment: result,
        txHash: result.txHash,
        explorerUrl: result.explorerUrl
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        payment: result
      });
    }
  } catch (error) {
    console.error('[API] Thirdweb execute payment error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get wallet balance via Thirdweb
app.get('/api/thirdweb/balance/:currency?', async (req, res) => {
  try {
    const currency = req.params.currency || 'ARC';
    const balance = await thirdwebPayments.getBalance(currency);
    
    res.json({
      success: true,
      balance
    });
  } catch (error) {
    console.error('[API] Thirdweb balance error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Estimate gas for payment
app.post('/api/thirdweb/estimate-gas', async (req, res) => {
  try {
    const { to, amount, currency } = req.body;
    
    if (!to || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: to, amount'
      });
    }
    
    const gasEstimate = await thirdwebPayments.estimateGas(
      to,
      amount,
      currency || 'USDC'
    );
    
    res.json({
      success: true,
      gas: gasEstimate
    });
  } catch (error) {
    console.error('[API] Thirdweb estimate gas error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// One-step payment (create + execute)
app.post('/api/thirdweb/payment/send', async (req, res) => {
  try {
    const { to, amount, currency, description } = req.body;
    
    if (!to || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: to, amount'
      });
    }
    
    console.log(`[THIRDWEB API] One-step payment: ${amount} ${currency || 'USDC'} to ${to}`);
    
    // Create payment request
    const paymentRequest = await thirdwebPayments.createPaymentRequest({
      to,
      amount: parseFloat(amount),
      currency: currency || 'USDC',
      description: description || `Payment to ${to}`
    });
    
    // Execute immediately
    const result = await thirdwebPayments.executePayment(paymentRequest);
    
    if (result.status === 'completed') {
      res.json({
        success: true,
        payment: result,
        txHash: result.txHash,
        explorerUrl: result.explorerUrl,
        message: `Successfully sent ${amount} ${currency || 'USDC'} to ${to}`
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        payment: result
      });
    }
  } catch (error) {
    console.error('[API] Thirdweb send payment error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== BLOCKCHAIN ROUTES ====================

app.get('/api/blockchain/stats', async (req, res) => {
  try {
    const stats = await getContractInfo();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/blockchain/decision/:decisionId', async (req, res) => {
  try {
    const decision = await getDecisionFromChain(req.params.decisionId);
    if (!decision) {
      return res.status(404).json({ error: 'Decision not found on blockchain' });
    }
    res.json(decision);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== CLOUDFLARE AI CHAT - PRIMARY ENDPOINT (FIXED) ====================

app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    const userId = req.headers['x-user-id'] || 'demo-user';
    
    console.log(`[CHAT] User: ${userId}, Messages: ${messages?.length || 0}`);
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }
    
    // ✅ ALWAYS fetch fresh wallet data for accurate AI context
    console.log('[CHAT] Fetching fresh wallet data for AI context...');
    const user = await getFreshWalletData(true); // Force refresh
    const wallet = user.wallet;
    const agent = user.agent;
    
    console.log(`[CHAT] Using wallet balance: ${wallet.balance} USDC (Fresh data)`);
    
    // System context for AI with scheduling capabilities
    const systemMessage = {
      role: "system",
      content: `You are ArcBot, an AI assistant for cryptocurrency payments powered by Arc blockchain.

**CRITICAL - CURRENT WALLET DATA (DO NOT MAKE UP NUMBERS):**
- CURRENT BALANCE: ${wallet.balance} USDC (EXACT VALUE: ${wallet.balance})
- ARC BALANCE: ${wallet.arcBalance || 0} ARC
- WALLET ADDRESS: ${wallet.address}
- DAILY LIMIT: ${agent.dailyLimit} USDC
- LAST UPDATED: ${new Date().toISOString()}

**IMPORTANT: When asked about balance, ALWAYS respond with the EXACT number: ${wallet.balance} USDC. Do NOT round, estimate, or make up any other number.**

**User Context:**
- Personality: ${agent.personality}
- Transaction Count: ${wallet.transactionCount || 0}

**Your Capabilities:**
1. **Natural Conversations** - Chat about crypto, payments, blockchain
2. **Payment Processing** - Send USDC to people/services using Thirdweb x402
3. **Payment Scheduling** - Schedule one-time or recurring payments
4. **Wallet Management** - Check balance, view history

**PAYMENT EXECUTION - CRITICAL INSTRUCTIONS:**
When user wants to send/pay/transfer money, you MUST:
1. Extract: recipient, amount, currency (default USDC)
2. Verify user has sufficient balance (current: ${wallet.balance} USDC)
3. Create a payment request in this EXACT format:

PAYMENT_REQUEST:
{
  "action": "payment",
  "recipient": "exact recipient name or address",
  "amount": numeric_amount,
  "currency": "USDC",
  "description": "brief description"
}

4. Then explain the payment clearly and wait for confirmation

**EXAMPLE PAYMENT RESPONSES:**

User: "send 10 USDC to Alice"
You: "I'll prepare a payment of 10 USDC to Alice.

PAYMENT_REQUEST:
{
  "action": "payment",
  "recipient": "Alice",
  "amount": 10,
  "currency": "USDC",
  "description": "Payment to Alice"
}

Please confirm this payment. You have ${wallet.balance} USDC available."

User: "pay Netflix 13.99"
You: "I'll prepare your Netflix payment.

PAYMENT_REQUEST:
{
  "action": "payment",
  "recipient": "Netflix",
  "amount": 13.99,
  "currency": "USDC",
  "description": "Netflix subscription payment"
}

Ready to process this payment?"

**How to Handle Balance Queries:**
When user asks "what's my balance" or similar questions, respond with:
"Your current wallet balance is ${wallet.balance} USDC"

**Important:**
- Be conversational and friendly
- Ask follow-up questions if details are missing
- ALWAYS use the exact balance provided: ${wallet.balance} USDC
- For payments, ALWAYS include the PAYMENT_REQUEST JSON
- Never execute without the proper JSON format
- Check sufficient funds before creating payment requests

Be helpful, clear, and enable seamless crypto payments!`
    };
    
    // Inject balance info into the last user message as a workaround for AI hallucination
    const modifiedMessages = [...messages];
    if (modifiedMessages.length > 0 && modifiedMessages[modifiedMessages.length - 1].role === 'user') {
      const lastMessage = modifiedMessages[modifiedMessages.length - 1];
      // Check if asking about balance
      if (lastMessage.content.toLowerCase().includes('balance') || 
          lastMessage.content.toLowerCase().includes('how much')) {
        lastMessage.content = `${lastMessage.content}\n\n[SYSTEM CONTEXT: User's current wallet balance is exactly ${wallet.balance} USDC. Use this exact number in your response.]`;
      }
      
      // Check if this is a payment request
      const paymentKeywords = ['send', 'pay', 'transfer', 'give'];
      const isPaymentRequest = paymentKeywords.some(kw => lastMessage.content.toLowerCase().includes(kw));
      
      if (isPaymentRequest) {
        // Add payment capability context
        lastMessage.content = `${lastMessage.content}\n\n[SYSTEM CONTEXT: User has ${wallet.balance} USDC available. If user wants to make a payment, extract the details and respond with a JSON payment request in this exact format:
PAYMENT_REQUEST:
{
  "action": "payment",
  "recipient": "recipient name or address",
  "amount": amount_as_number,
  "currency": "USDC",
  "description": "brief description"
}
Then explain the payment to the user and ask for confirmation.]`;
      }
    }
    
    const chatMessages = [systemMessage, ...modifiedMessages];
    
    const cloudflareWorkerUrl = process.env.CLOUDFLARE_WORKER_URL;
    
    if (!cloudflareWorkerUrl) {
      return res.status(500).json({ 
        error: 'Cloudflare Worker not configured',
        message: 'Please set CLOUDFLARE_WORKER_URL in your .env file'
      });
    }
    
    console.log(`[CHAT] Forwarding to Cloudflare AI...`);
    
    // Forward to Cloudflare Worker
    const response = await axios.post(
      `${cloudflareWorkerUrl}/api/chat`,
      { messages: chatMessages },
      {
        responseType: 'stream',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        timeout: 30000
      }
    );
    
    // Set streaming headers for SSE format
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    
    // Transform the stream to convert "response" to "content"
    let buffer = '';
    
    response.data.on('data', (chunk) => {
      try {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.trim()) {
            try {
              // Parse the JSON from Cloudflare Worker
              const parsed = JSON.parse(line);
              
              // Transform "response" field to "content" field for frontend
              if (parsed.response) {
                const transformed = { content: parsed.response };
                res.write(`data: ${JSON.stringify(transformed)}\n\n`);
              } else if (parsed.content) {
                // Already in correct format
                res.write(`data: ${JSON.stringify(parsed)}\n\n`);
              }
            } catch (parseError) {
              // If line is not JSON, it might be SSE format already
              if (line.startsWith('data: ')) {
                res.write(line + '\n');
              }
            }
          }
        }
      } catch (error) {
        console.error('[CHAT] Stream processing error:', error);
      }
    });
    
    response.data.on('end', () => {
      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer);
          if (parsed.response) {
            res.write(`data: ${JSON.stringify({ content: parsed.response })}\n\n`);
          }
        } catch (e) {
          // Ignore parsing errors for final buffer
        }
      }
      
      res.write('data: [DONE]\n\n');
      res.end();
      console.log('[CHAT] ✅ Stream completed');
    });
    
    response.data.on('error', (error) => {
      console.error('[CHAT] Stream error:', error.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Stream error' });
      } else {
        res.end();
      }
    });
    
  } catch (error) {
    console.error('[CHAT] Error:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({ 
        error: 'Cannot connect to Cloudflare Worker',
        message: 'Make sure your Worker is deployed and CLOUDFLARE_WORKER_URL is correct'
      });
    }
    
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// ==================== SMART PAYMENT EXECUTION ====================

// Execute payment via Thirdweb
app.post('/api/payment/execute', async (req, res) => {
  try {
    const { recipient, amount, currency, description } = req.body;
    
    if (!recipient || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: recipient, amount'
      });
    }
    
    console.log(`[PAYMENT] Executing: ${amount} ${currency || 'USDC'} to ${recipient}`);
    
    // Get fresh wallet data
    const user = await getFreshWalletData(true);
    
    // Check sufficient balance
    if (amount > user.wallet.balance) {
      return res.status(400).json({
        success: false,
        error: `Insufficient balance. You have ${user.wallet.balance} USDC but trying to send ${amount} USDC`
      });
    }
    
    // Create payment request via Thirdweb
    const paymentRequest = await thirdwebPayments.createPaymentRequest({
      to: recipient,
      amount: parseFloat(amount),
      currency: currency || 'USDC',
      description: description || `Payment to ${recipient}`
    });
    
    // Execute payment
    const result = await thirdwebPayments.executePayment(paymentRequest);
    
    if (result.status === 'completed') {
      // Log to blockchain
      try {
        const instructionId = `payment_${Date.now()}`;
        await logDecisionOnChain(
          instructionId,
          `AI Payment: ${amount} ${currency || 'USDC'} to ${recipient}`,
          '',
          result.txHash || '',
          amount,
          0.2
        );
      } catch (error) {
        console.warn('[PAYMENT] Blockchain logging failed:', error.message);
      }
      
      res.json({
        success: true,
        payment: result,
        txHash: result.txHash,
        explorerUrl: result.explorerUrl,
        message: `Successfully sent ${amount} ${currency || 'USDC'} to ${recipient}`,
        newBalance: user.wallet.balance - amount
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || 'Payment failed',
        payment: result
      });
    }
  } catch (error) {
    console.error('[PAYMENT] Execution error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== SMART COMMAND DETECTION ====================

app.post('/api/chat/smart', async (req, res) => {
  try {
    const { message } = req.body;
    const userId = req.headers['x-user-id'] || 'demo-user';
    
    console.log(`[CHAT/SMART] Processing: "${message}"`);
    
    const messageL = message.toLowerCase();
    
    // Balance query - use real wallet data
    if (messageL.includes('balance') || messageL.includes('how much')) {
      const user = await getFreshWalletData(true);
      const wallet = user.wallet;
      return res.json({
        type: 'balance',
        message: `💰 **Your Wallet Balance**\n\nUSDC Balance: ${wallet.balance} USDC\nARC Balance: ${wallet.arcBalance || 0} ARC\nWallet Address: \`${wallet.address}\`\nDaily Limit: ${user.agent.dailyLimit} USDC`
      });
    }
    
    // Blockchain stats query
    if (messageL.includes('blockchain') || messageL.includes('on-chain')) {
      const stats = await getContractInfo();
      return res.json({
        type: 'blockchain',
        message: `🔗 **Blockchain Status**\n\n${stats.enabled ? `Agent: ${stats.agentAddress}\nDecisions: ${stats.agentDecisions}\nVolume: ${stats.totalVolume}\nExplorer: ${stats.explorerUrl}` : 'Blockchain not configured'}`,
        data: stats
      });
    }
    
    // Scheduled payments query
    if (messageL.includes('scheduled') || messageL.includes('upcoming payment')) {
      const payments = await ScheduledPayment.find({ 
        userId, 
        status: 'scheduled' 
      }).sort({ scheduledDate: 1 });
      
      if (payments.length === 0) {
        return res.json({
          type: 'info',
          message: '📅 No scheduled payments found.'
        });
      }
      
      let msg = `📅 **Scheduled Payments** (${payments.length} total)\n\n`;
      payments.slice(0, 5).forEach((p, i) => {
        msg += `${i + 1}. ${p.payee} - ${p.amount} ${p.currency}\n`;
        msg += `   Date: ${formatDateForDisplay(p.scheduledDate)}\n`;
        if (p.recurring?.enabled) {
          msg += `   Recurring: ${p.recurring.frequency}\n`;
        }
        msg += `\n`;
      });
      
      return res.json({
        type: 'list',
        message: msg,
        data: payments
      });
    }
    
    // Transaction history
    if (messageL.includes('history') || messageL.includes('transaction')) {
      return res.json({
        type: 'info',
        message: '📜 **Transaction History**\n\nView your recent transactions at /api/history'
      });
    }
    
    // No command detected - use AI chat
    return res.json({
      type: 'chat',
      message: 'For natural conversation, use the /api/chat endpoint with message history.'
    });
    
  } catch (error) {
    console.error('[CHAT/SMART] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== PAYMENT PROCESSING WITH SCHEDULING ====================

// Parse user instruction with enhanced scheduling support
app.post('/api/parse', async (req, res) => {
  try {
    const { text } = req.body;
    const instructionId = `inst_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`[PARSE] Processing: "${text}"`);
    
    // Use enhanced parser with scheduling support
    const parsed = parseInstructionWithScheduling(text);
    
    // Store instruction
    STORE.instructions[instructionId] = {
      instructionId,
      userId: 'demo-user',
      rawText: text,
      parsed,
      status: 'parsed',
      createdAt: new Date()
    };
    
    console.log('[PARSE] Result:', JSON.stringify(parsed, null, 2));
    
    res.json({
      instructionId,
      parsed,
      confidence: parsed.confidence,
      hasScheduling: parsed.hasScheduling,
      scheduledDate: parsed.scheduledDate,
      naturalLanguageSummary: parsed.naturalLanguageSummary
    });
  } catch (error) {
    console.error('[PARSE] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate action plan (handles both immediate and scheduled payments)
app.post('/api/plan', async (req, res) => {
  try {
    const { instructionId, parsed } = req.body;
    
    console.log(`[PLAN] Generating plan for: ${instructionId}`);
    
    const instruction = STORE.instructions[instructionId];
    const parsedData = parsed || instruction?.parsed;
    
    if (!parsedData) {
      return res.status(400).json({ error: 'No parsed data found' });
    }
    
    // Check if this is a scheduling request
    if (parsedData.hasScheduling && parsedData.scheduledDate) {
      const user = await getFreshWalletData(true);
      const plan = await generateScheduledPlan(parsedData, user.id);
      
      if (instruction) {
        instruction.plan = plan;
        instruction.status = 'planned';
      }
      
      res.json({
        instructionId,
        ...plan,
        isScheduled: true,
        scheduledDate: parsedData.scheduledDate,
        message: parsedData.naturalLanguageSummary
      });
    } else {
      const plan = generateActionPlan(parsedData);
      
      if (instruction) {
        instruction.plan = plan;
        instruction.status = 'planned';
      }
      
      res.json({
        instructionId,
        actionPlan: plan.actions,
        rationale: plan.rationale,
        riskScore: plan.riskScore,
        totalAmount: plan.totalAmount,
        isScheduled: false
      });
    }
  } catch (error) {
    console.error('[PLAN] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Approve and execute plan (handles both immediate and scheduled)
app.post('/api/approve', async (req, res) => {
  try {
    const { instructionId, isScheduled, plan: providedPlan, scheduledPayment } = req.body;
    
    const user = await getFreshWalletData(true);
    console.log(`[APPROVE] User: ${user.id}, Instruction: ${instructionId}`);
    
    if (isScheduled) {
      // Handle scheduled payment approval
      const payment = await paymentScheduler.schedulePayment(user.id, scheduledPayment);
      
      console.log(`[APPROVE] ✅ Payment scheduled: ${payment.paymentId}`);
      
      res.json({
        success: true,
        scheduled: true,
        payment,
        message: `Payment scheduled successfully for ${formatDateForDisplay(payment.scheduledDate)}`
      });
    } else {
      // Handle immediate execution
      const instruction = STORE.instructions[instructionId];
      const plan = providedPlan || instruction?.plan;
      
      if (!plan || !plan.actions) {
        return res.status(400).json({ error: 'No valid plan found' });
      }
      
      // Execute the plan with instruction ID for blockchain logging
      const result = await executePlan(plan, {
        userId: user.id,
        agent: user.agent,
        wallet: user.wallet,
        instructionId
      });
      
      // Store transaction records
      if (result.results) {
        result.results.forEach(r => {
          const txId = uuidv4();
          STORE.transactions[txId] = {
            txId,
            instructionId,
            ...r,
            createdAt: new Date()
          };
        });
      }
      
      // Update instruction status
      if (instruction) {
        instruction.status = 'executed';
        instruction.executionResult = result;
        instruction.blockchainTx = result.blockchainTx;
      }
      
      console.log(`[APPROVE] ✅ Success: ${result.summary.successful} transactions executed`);
      
      if (result.blockchainTx && result.blockchainTx.success) {
        console.log(`[APPROVE] 🔗 View on blockchain: ${result.blockchainTx.explorerUrl}`);
      }
      
      res.json({
        success: true,
        scheduled: false,
        result,
        blockchainTx: result.blockchainTx
      });
    }
  } catch (error) {
    console.error('[APPROVE] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get transaction history
app.get('/api/history', (req, res) => {
  const userId = req.headers['x-user-id'] || 'demo-user';
  const limit = parseInt(req.query.limit) || 10;
  
  const instructions = Object.values(STORE.instructions)
    .filter(i => i.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
  
  res.json(instructions);
});

// Text-to-Speech endpoint
app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body;
    
    console.log(`[TTS] 🎤 Generating speech (${text.length} chars)...`);
    
    if (!process.env.ELEVENLABS_KEY) {
      console.log('[TTS] ⚠️ Falling back to browser TTS');
      return res.json({ fallback: true });
    }
    
    const response = await axios.post(
      'https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL',
      { text, model_id: 'eleven_monolingual_v1' },
      {
        headers: {
          'xi-api-key': process.env.ELEVENLABS_KEY,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer'
      }
    );
    
    const audioBase64 = Buffer.from(response.data).toString('base64');
    const audioUrl = `data:audio/mpeg;base64,${audioBase64}`;
    
    console.log('[TTS] ✅ Speech generated successfully');
    
    res.json({ url: audioUrl, fallback: false });
  } catch (error) {
    console.error('[TTS] Error:', error.message);
    res.json({ fallback: true });
  }
});

// ==================== SCHEDULER ROUTES ====================

const schedulerRoutes = require('./routes/scheduler');
app.use('/api/scheduler', schedulerRoutes);

// ==================== HELPER FUNCTIONS ====================

async function generateScheduledPlan(parsed, userId) {
  const intent = parsed.intents[0];
  
  const scheduledPayment = {
    type: intent.type,
    payee: intent.payee,
    amount: intent.amount,
    currency: intent.currency || 'USDC',
    scheduledDate: parsed.scheduledDate,
    recurring: intent.recurring || { enabled: false },
    description: parsed.raw
  };
  
  return {
    scheduledPayment,
    actionPlan: [{
      actionId: `scheduled_${Date.now()}`,
      type: 'SCHEDULE',
      ...scheduledPayment
    }],
    totalAmount: intent.amount || 0,
    riskScore: 0.1,
    rationale: parsed.naturalLanguageSummary,
    estimatedGas: 0
  };
}

function generateActionPlan(parsed) {
  const actions = [];
  let totalAmount = 0;
  
  parsed.intents.forEach((intent, idx) => {
    const action = {
      actionId: `action_${idx}_${Date.now()}`,
      type: intent.type,
      to: intent.payee || 'Savings',
      amount: intent.amount,
      percent: intent.percent,
      currency: intent.currency || 'USDC'
    };
    
    if (action.amount) {
      totalAmount += action.amount;
    }
    
    actions.push(action);
  });
  
  const riskScore = totalAmount > 100 ? 0.7 : totalAmount > 50 ? 0.4 : 0.2;
  
  return {
    actions,
    totalAmount,
    riskScore,
    rationale: `Executing ${actions.length} action(s) with total amount of ${totalAmount.toFixed(2)} USDC`,
    estimatedGas: 0.05
  };
}

// ==================== START SERVER ====================

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log('\n🚀 ============================================');
  console.log(`   ArcBot Backend with Full Scheduling`);
  console.log(`   Port: ${PORT}`);
  console.log(`   Cloudflare AI: ${process.env.CLOUDFLARE_WORKER_URL ? '✅ Ready' : '⚠️  Not configured'}`);
  console.log(`   Arc Blockchain: ${process.env.DECISION_CONTRACT_ADDRESS ? '✅ Connected' : '⚠️  Not configured'}`);
  console.log(`   Real Wallet: ${USER_WALLET_ADDRESS ? '✅ Integrated' : '⚠️  Not configured'}`);
  console.log(`   Thirdweb x402: ✅ Ready for AI Payments`);
  console.log(`   Scheduling: ✅ Enabled (One-time & Recurring)`);
  console.log(`   Payment Mode: User approval required`);
  console.log('============================================ 🚀\n');
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  process.exit(0);
});

module.exports = app;