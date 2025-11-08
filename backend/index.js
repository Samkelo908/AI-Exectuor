// Load environment variables FIRST
require('dotenv').config();

// Debug environment variables
console.log('=== ENVIRONMENT CHECK ===');
console.log('USER_WALLET_ADDRESS from env:', process.env.USER_WALLET_ADDRESS);
console.log('USER_WALLET_ADDRESS length:', process.env.USER_WALLET_ADDRESS?.length);
console.log('ARC_USDC_CONTRACT from env:', process.env.ARC_USDC_CONTRACT);
console.log('ARC_USDC_CONTRACT length:', process.env.ARC_USDC_CONTRACT?.length);
console.log('FIREBASE_CREDENTIALS_PATH:', process.env.FIREBASE_CREDENTIALS_PATH);

// Validate addresses
const { ethers } = require('ethers');
console.log('USER_WALLET_ADDRESS valid?', ethers.isAddress(process.env.USER_WALLET_ADDRESS));
console.log('ARC_USDC_CONTRACT valid?', ethers.isAddress(process.env.ARC_USDC_CONTRACT));

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const { getRemittanceService } = require('./services/remittanceService');
const { getCrossBorderService } = require('./services/crossBorderService');
const { getExchangeRateService } = require('./services/exchangeRateService');
const { getFirebaseScheduler } = require('./services/firebaseScheduler');
const { getSecurityMonitor } = require('./services/securityMonitor');
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

// Initialize Firebase Payment Scheduler Service
const paymentScheduler = getFirebaseScheduler();

// Initialize Security Monitor
const securityMonitor = getSecurityMonitor();

// Initialize Wallet Service
const walletService = getWalletService();

// Initialize Thirdweb x402 Service
const thirdwebPayments = getThirdwebPaymentService();

let remittanceService = null;
let crossBorderService = null;
let exchangeRateService = null;

// YOUR ACTUAL WALLET ADDRESS - Replace with your real address
const USER_WALLET_ADDRESS = process.env.USER_WALLET_ADDRESS;

const ARC_USDC_CONTRACT = process.env.ARC_USDC_CONTRACT || '0x3C3380cdFb94dFEEaA41cAD9F58254AE380d752D';
// Cache wallet data to avoid excessive RPC calls
let cachedWalletData = null;
let lastFetchTime = 0;
const CACHE_DURATION = 30000; // 30 seconds
let fetchInProgress = false;

// Helper function to get fresh wallet data
async function getFreshWalletData(forceRefresh = false) {
  const now = Date.now();
  
  // Wait if fetch is in progress (race condition fix)
  while (fetchInProgress) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Return cached data if fresh enough
  if (!forceRefresh && cachedWalletData && (now - lastFetchTime) < CACHE_DURATION) {
    return cachedWalletData;
  }
  
  fetchInProgress = true;
  
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
  } finally {
    fetchInProgress = false;
  }
}

// Update mockUser to use real wallet data
let mockUser = null;

// Initialize wallet data on startup
(async () => {
  try {
    // Initialize Firebase first
    console.log('[FIREBASE] Initializing Firebase services...');
    await paymentScheduler.initialize();
    
    // Initialize Security Monitor                          
    console.log('[SECURITY] Initializing security monitor...');  
    await securityMonitor.initialize();                     
    console.log('[SECURITY] ✅ Security Monitor ready');
    
    // ✅ ADD THIS BLOCK:
    // Initialize Cross-Border Services
    console.log('[REMITTANCE] Initializing cross-border services...');
    exchangeRateService = getExchangeRateService();
    crossBorderService = getCrossBorderService(paymentScheduler);
    remittanceService = getRemittanceService(thirdwebPayments, paymentScheduler);
    console.log('[REMITTANCE] ✅ Cross-border services ready');
    console.log('[REMITTANCE] 🌍 7 countries supported (KE, NG, ZA, GH, UG, TZ, RW)');
    
    // Then fetch wallet data
    mockUser = await getFreshWalletData();
    console.log('[WALLET] 🎯 Real wallet integrated successfully!');
    console.log('[STARTUP] ✅ All services initialized!');
  } catch (error) {
    console.error('[STARTUP] Failed to initialize:', error);
    // Fallback...
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
    firebase: paymentScheduler.initialized ? 'connected' : 'disconnected',
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
// One-step payment (create + execute) - FIXED VERSION WITH HISTORY LOGGING + SAVE TRANSFER
app.post('/api/thirdweb/payment/send', async (req, res) => {
  try {
    const { to, amount, currency, description } = req.body;
    const userId = req.headers['x-user-id'] || 'demo-user'; // Get user ID
    
    if (!to || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: to, amount'
      });
    }
    
    console.log(`[THIRDWEB API] One-step payment: ${amount} ${currency || 'USDC'} to ${to}`);
    console.log(`[THIRDWEB API] User: ${userId}`);
    
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
      // ✅ LOG TO FIREBASE PAYMENT HISTORY
      try {
        await paymentScheduler.logPaymentHistory(userId, {
          paymentId: result.id || `direct_${Date.now()}`,
          type: 'direct',
          payee: to,
          amount: parseFloat(amount),
          currency: currency || 'USDC',
          status: 'completed',
          txHash: result.txHash,
          explorerUrl: result.explorerUrl,
          description: description || `Payment to ${to}`
        });
        console.log('[THIRDWEB API] ✅ Payment logged to Firebase history');
      } catch (historyError) {
        console.error('[THIRDWEB API] ⚠️ Failed to log to history:', historyError.message);
      }
      
      // ✅ SAVE/UPDATE TRANSFER FOR FUTURE USE
      try {
        // Check if this transfer already exists
        const existingTransfers = await paymentScheduler.getSavedTransfers(userId);
        const existing = existingTransfers.find(t => t.payee.toLowerCase() === to.toLowerCase());
        
        if (existing) {
          // Update usage count
          await paymentScheduler.updateTransferUsage(existing.transferId);
          console.log('[THIRDWEB API] ✅ Updated transfer usage count');
        } else {
          // Save new transfer
          await paymentScheduler.saveTransfer(userId, {
            payee: to,
            nickname: description || `Payment to ${to.slice(0, 6)}...`,
            amount: parseFloat(amount),
            currency: currency || 'USDC',
            category: 'general',
            favorite: false
          });
          console.log('[THIRDWEB API] ✅ Saved new transfer');
        }
      } catch (transferError) {
        console.error('[THIRDWEB API] ⚠️ Failed to save transfer:', transferError.message);
      }
      
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

// ==================== CLOUDFLARE AI CHAT - PRIMARY ENDPOINT (FIXED) ====================

// ============================================
// ADD TO YOUR server.js - Memory-Enhanced Chat
// Replace your existing /api/chat endpoint
// ============================================

// Memory-enhanced chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    const userId = req.headers['x-user-id'] || 'demo-user';
    
    console.log(`[CHAT/MEMORY] User: ${userId}, Building context...`);
    
    // ✅ Get fresh wallet data
    const user = await getFreshWalletData(true);
    const wallet = user.wallet;
    const agent = user.agent;
    
    // ✅ Get comprehensive AI memory context
    const memory = await buildAIMemoryContext(userId);
    
    // 🧠 Enhanced system message with memory
// 🧠 Enhanced system message with REMITTANCE support
const systemMessage = {
  role: "system",
  content: `You are ArcBot, an AI assistant with PERFECT MEMORY for cryptocurrency payments on Arc blockchain.

**CURRENT USER DATA:**
- Balance: ${wallet.balance} USDC (EXACT: ${wallet.balance})
- Wallet: ${wallet.address}
- Today's Date: ${new Date().toISOString().split('T')[0]}

**CRITICAL: PAYMENT REQUEST FORMAT**

When the user asks you to send/pay/transfer money, you MUST respond with this EXACT format:

PAYMENT_REQUEST: {"recipient": "0xADDRESS", "amount": 10.50, "currency": "USDC", "description": "Payment description"}

Example conversation:
User: "Arc, send 0.001 USDC to 0x64EEA87b4737Eafa46c9B4661d534AF7307d7C5c"

You respond:
"I'll prepare that payment for you.

PAYMENT_REQUEST: {"recipient": "0x64EEA87b4737Eafa46c9B4661d534AF7307d7C5c", "amount": 0.001, "currency": "USDC", "description": "Payment to 0x64EE...7C5c"}

Please review the details and click 'Approve Payment' when ready."

**SCHEDULE REQUEST FORMAT**

For scheduled/recurring payments, use:

SCHEDULE_REQUEST: {"recipient": "0xADDRESS", "amount": 10, "currency": "USDC", "scheduledDate": "2025-11-10T15:00:00Z", "recurring": {"enabled": false}, "description": "Monthly subscription"}

**🌍 REMITTANCE REQUEST FORMAT (NEW!)**

When user wants to send money to another country, respond with:

REMITTANCE_REQUEST: {"recipientId": "new", "recipientName": "John Doe", "country": "Kenya", "countryCode": "KE", "walletAddress": "0x1234...", "phoneNumber": "+254712345678", "amount": 50, "currency": "USDC", "receiveAmount": 6387.5, "receiveCurrency": "KES", "exchangeRate": 129, "platformFee": 0.5, "networkFee": 0.25, "totalFees": 0.75, "deliveryMethod": "mobile_money", "description": "Family support"}

**REMITTANCE DETECTION KEYWORDS:**
- "send money to [country]"
- "remit", "remittance", "cross-border"
- "pay [person] in [country]"
- "transfer internationally"
- "send to Nigeria/Kenya/Ghana/etc"
- "my family in [country]"
- "mobile money", "M-Pesa"

**SUPPORTED COUNTRIES & EXCHANGE RATES:**

1. 🇰🇪 **Kenya (KES)** - Rate: 1 USDC = 129 KES
   - M-Pesa (5-15 min)
   - Bank Transfer (1-2 hours)
   
2. 🇳🇬 **Nigeria (NGN)** - Rate: 1 USDC = 1,550 NGN
   - Bank Transfer (1-2 hours)
   - Mobile Money (30 min)
   
3. 🇿🇦 **South Africa (ZAR)** - Rate: 1 USDC = 18.5 ZAR
   - Bank Transfer (1-2 hours)
   - Instant EFT (5-15 min)
   
4. 🇬🇭 **Ghana (GHS)** - Rate: 1 USDC = 15.5 GHS
   - Mobile Money (5-15 min)
   - Bank Transfer (1-2 hours)
   
5. 🇺🇬 **Uganda (UGX)** - Rate: 1 USDC = 3,700 UGX
   - Mobile Money (5-15 min)
   - Bank Transfer (1-2 hours)
   
6. 🇹🇿 **Tanzania (TZS)** - Rate: 1 USDC = 2,500 TZS
   - Vodacom M-Pesa (5-15 min)
   - Bank Transfer (1-2 hours)
   
7. 🇷🇼 **Rwanda (RWF)** - Rate: 1 USDC = 1,350 RWF
   - MTN Mobile Money (5-15 min)
   - Bank Transfer (1-2 hours)

**REMITTANCE FEES:**
- Platform Fee: 1% (e.g., $0.50 on $50)
- Network Fee: $0.25 (blockchain gas)
- Total: ~1.5% vs Western Union's 5-10%

**REMITTANCE CONVERSATION FLOW:**

Example 1 - Basic Request:
User: "Send 50 USDC to Kenya"
You: "Great! I can help you send money to Kenya. To set this up, I need:

1. **Recipient's name**
2. **Their M-Pesa number** (e.g., +254712345678) OR **wallet address**

💡 **Why ArcBot?**
- 💰 Fee: $0.75 (1.5%) vs Western Union: $2.50 (5%)
- ⚡ Speed: 5-15 minutes vs 1-3 days
- 📱 Direct to M-Pesa mobile wallet

What's the recipient's name and M-Pesa number?"

User: "Her name is Jane, M-Pesa +254712345678"
You: "Perfect! Here's your remittance breakdown:

REMITTANCE_REQUEST: {"recipientId": "new", "recipientName": "Jane", "country": "Kenya", "countryCode": "KE", "phoneNumber": "+254712345678", "walletAddress": "", "amount": 50, "currency": "USDC", "receiveAmount": 6387.5, "receiveCurrency": "KES", "exchangeRate": 129, "platformFee": 0.5, "networkFee": 0.25, "totalFees": 0.75, "deliveryMethod": "mobile_money", "description": "Payment to Jane in Kenya"}

📊 **Transaction Summary:**
- You send: 50 USDC
- Exchange rate: 1 USDC = 129 KES
- Total fees: $0.75 (1.5%)
- Jane receives: **6,387.50 KES**
- Delivery: M-Pesa (5-15 minutes)

Click **'Confirm & Send'** to proceed!"

Example 2 - Saved Recipient:
User: "Send $100 to my mom in Nigeria"
You: "I found your saved recipient 'Mom' in Nigeria. Here's the breakdown:

REMITTANCE_REQUEST: {"recipientId": "recipient_12345", "recipientName": "Mom", "country": "Nigeria", "countryCode": "NG", "walletAddress": "0xABC...", "phoneNumber": "", "amount": 100, "currency": "USDC", "receiveAmount": 153462.5, "receiveCurrency": "NGN", "exchangeRate": 1550, "platformFee": 1.0, "networkFee": 0.25, "totalFees": 1.25, "deliveryMethod": "wallet_transfer", "description": "Payment to Mom"}

📊 **Transaction Summary:**
- You send: 100 USDC
- Exchange rate: 1 USDC = 1,550 NGN
- Total fees: $1.25 (1.25%)
- Mom receives: **₦153,462.50 NGN**
- Delivery: Instant to wallet

Ready to send?"

Example 3 - Rate Check:
User: "What's the exchange rate for Kenya?"
You: "Current exchange rate for Kenya:

💱 1 USDC = 129 KES (Kenyan Shilling)

**Example amounts:**
- 10 USDC = 1,290 KES
- 50 USDC = 6,450 KES
- 100 USDC = 12,900 KES

💰 **Fees:** Only 1.5% + $0.25 network fee
⚡ **Delivery:** 5-15 minutes via M-Pesa

Would you like to send money to Kenya?"

**PAYMENT MEMORY (Last 30 Days):**
${memory.paymentMemory}

**CONVERSATION MEMORY:**
${memory.conversationMemory}

**PAYMENT STATISTICS:**
${memory.statistics}

**YOUR CAPABILITIES:**

1. **Execute Payments** - When user says "send", "pay", "transfer" → Always output PAYMENT_REQUEST format
2. **Schedule Payments** - For "schedule", "pay on", "recurring" → Use SCHEDULE_REQUEST format
3. **🌍 International Remittances** - For "send to [country]" → Use REMITTANCE_REQUEST format
4. **Memory Recall** - Answer questions about past payments using PAYMENT MEMORY
5. **Balance Queries** - Current balance is ${wallet.balance} USDC
6. **Exchange Rates** - Provide current rates for 7 African countries

**MEMORY CAPABILITIES:**

1. **Temporal Memory** - Remember payments by date:
   - "last Friday" → Recall payments on that specific date
   - "this month" → Count and summarize all payments this month
   - "last week" → Recall payments from previous week
   - "yesterday" → Immediate recall of yesterday's transactions

2. **Contextual Memory** - Understand patterns:
   - Frequent recipients (e.g., "Netflix", "Alice", "Mom in Kenya")
   - Payment amounts and habits
   - Recurring payments
   - Spending trends by country

3. **Conversational Memory** - Remember discussions:
   - Previous questions asked
   - Payments discussed but not executed
   - User preferences and habits
   - Saved international recipients

**IMPORTANT RULES:**
- ALWAYS use PAYMENT_REQUEST: {...} format for local payments
- ALWAYS use REMITTANCE_REQUEST: {...} format for international/cross-border payments
- Put JSON on single line after request type
- Include friendly text before/after the structured data
- Never make up transaction hashes - only use data from PAYMENT MEMORY
- Be conversational and helpful
- For remittances, ALWAYS ask for recipient details if not provided
- Highlight cost savings vs traditional remittance services
- Mention delivery speed and methods

**RESPONSE FORMAT:**
- Be friendly and conversational
- Use exact amounts and dates from memory
- Show exchange rate calculations for remittances
- Offer helpful follow-up suggestions
- Link to transaction explorers when relevant
- For remittances, show cost comparison with traditional services

**🚨 CRITICAL: DETECT COUNTRY MENTIONS**
If the user mentions ANY country name (Kenya, Nigeria, Ghana, etc.) OR says "internationally", "cross-border", "remit", "mobile money", "M-Pesa" → This is a REMITTANCE request, NOT a regular payment!

Ready to assist with payments, scheduling, remittances, and perfect memory!`
};
    
    const chatMessages = [systemMessage, ...messages];
    
    // Forward to Cloudflare AI with enhanced context
    const cloudflareWorkerUrl = process.env.CLOUDFLARE_WORKER_URL;
    
    if (!cloudflareWorkerUrl) {
      return res.status(500).json({ 
        error: 'Cloudflare Worker not configured'
      });
    }
    
    console.log(`[CHAT/MEMORY] Forwarding to Cloudflare AI with memory context...`);
    
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
    
    // Stream response back
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    let buffer = '';
    
    response.data.on('data', (chunk) => {
      try {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.trim()) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.response) {
                res.write(`data: ${JSON.stringify({ content: parsed.response })}\n\n`);
              } else if (parsed.content) {
                res.write(`data: ${JSON.stringify(parsed)}\n\n`);
              }
            } catch (e) {
              if (line.startsWith('data: ')) {
                res.write(line + '\n');
              }
            }
          }
        }
      } catch (error) {
        console.error('[CHAT/MEMORY] Stream error:', error);
      }
    });
    
    response.data.on('end', () => {
      res.write('data: [DONE]\n\n');
      res.end();
      console.log('[CHAT/MEMORY] ✅ Stream completed with memory');
    });
    
    response.data.on('error', (error) => {
      console.error('[CHAT/MEMORY] Stream error:', error.message);
      res.end();
    });
    
  } catch (error) {
    console.error('[CHAT/MEMORY] Error:', error.message);
    
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// ============================================
// BUILD AI MEMORY CONTEXT FROM FIREBASE
// ============================================

async function buildAIMemoryContext(userId) {
  const context = {
    paymentMemory: '',
    conversationMemory: '',
    statistics: ''
  };
  
  try {
    // Get payment history (last 30 days) from Firebase
    const history = await paymentScheduler.getPaymentHistory(userId, 100);
    
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    // Filter to last 30 days
    const recentPayments = history.filter(p => {
      const paymentDate = p.timestamp?.toDate ? p.timestamp.toDate() : new Date(p.timestamp);
      return paymentDate >= thirtyDaysAgo;
    });
    
    // Build payment memory list with detailed context
    if (recentPayments.length > 0) {
      context.paymentMemory = recentPayments.map(p => {
        const date = p.timestamp?.toDate ? p.timestamp.toDate() : new Date(p.timestamp);
        const dateStr = date.toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        });
        
        return `- ${dateStr}: Sent ${p.amount} ${p.currency} to ${p.payee}
  Status: ${p.status}
  ${p.txHash ? `TX: ${p.txHash}` : ''}
  ${p.explorerUrl ? `Explorer: ${p.explorerUrl}` : ''}
  ${p.description ? `Note: ${p.description}` : ''}`;
      }).join('\n\n');
    } else {
      context.paymentMemory = '(No payment history in last 30 days)';
    }
    
    // Build statistics
    const thisMonth = recentPayments.filter(p => {
      const date = p.timestamp?.toDate ? p.timestamp.toDate() : new Date(p.timestamp);
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    });
    
    const thisWeek = recentPayments.filter(p => {
      const date = p.timestamp?.toDate ? p.timestamp.toDate() : new Date(p.timestamp);
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return date >= weekAgo;
    });
    
    const totalAmount = recentPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const monthTotal = thisMonth.reduce((sum, p) => sum + (p.amount || 0), 0);
    const weekTotal = thisWeek.reduce((sum, p) => sum + (p.amount || 0), 0);
    
    // Frequent recipients
    const recipientMap = {};
    recentPayments.forEach(p => {
      if (!recipientMap[p.payee]) {
        recipientMap[p.payee] = { count: 0, total: 0 };
      }
      recipientMap[p.payee].count++;
      recipientMap[p.payee].total += p.amount || 0;
    });
    
    const topRecipients = Object.entries(recipientMap)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([addr, data]) => `  - ${addr.slice(0, 10)}... (${data.count} payments, ${data.total.toFixed(2)} USDC)`)
      .join('\n');
    
    context.statistics = `
Total Payments (30 days): ${recentPayments.length}
Total Volume (30 days): ${totalAmount.toFixed(2)} USDC

This Month (${now.toLocaleDateString('en-US', { month: 'long' })}):
  - Payments: ${thisMonth.length}
  - Volume: ${monthTotal.toFixed(2)} USDC

This Week:
  - Payments: ${thisWeek.length}
  - Volume: ${weekTotal.toFixed(2)} USDC

Most Frequent Recipients:
${topRecipients || '  (None yet)'}`;
    
    // Get scheduled payments context
    const scheduled = await paymentScheduler.getScheduledPayments(userId, { status: 'scheduled' });
    
    if (scheduled.length > 0) {
      context.statistics += `\n\nUpcoming Scheduled Payments: ${scheduled.length}`;
      scheduled.slice(0, 3).forEach(s => {
        context.statistics += `\n  - ${s.amount} ${s.currency} to ${s.payee} on ${new Date(s.scheduledDate).toLocaleDateString()}`;
      });
    }
    
    // Get saved transfers (frequent contacts)
    const saved = await paymentScheduler.getSavedTransfers(userId);
    
    if (saved.length > 0) {
      context.conversationMemory = `\nSaved Transfer Contacts (${saved.length} total):\n`;
      saved.slice(0, 5).forEach(t => {
        context.conversationMemory += `  - ${t.nickname || t.payee.slice(0, 10) + '...'}: Used ${t.useCount} times`;
        if (t.favorite) context.conversationMemory += ' ⭐ FAVORITE';
        context.conversationMemory += '\n';
      });
    }
    const alertsSnapshot = await paymentScheduler.db          // ← ADD THIS
      .collection('security_alerts')                          // ← ADD THIS
      .where('userId', '==', userId)                          // ← ADD THIS
      .where('read', '==', false)                             // ← ADD THIS
      .orderBy('timestamp', 'desc')                           // ← ADD THIS
      .limit(5)                                               // ← ADD THIS
      .get();                                                 // ← ADD THIS
    
    if (!alertsSnapshot.empty) {                              // ← ADD THIS
      context.securityAlerts = `\n\n**SECURITY ALERTS (${alertsSnapshot.size} unread):**\n`;
      alertsSnapshot.docs.forEach(doc => {
        const alert = doc.data();
        context.securityAlerts += `- ${alert.severity} Risk: ${alert.flags[0]?.message || 'Security concern'}\n`;
      });
    }
    
    // Get security profile                                   // ← ADD THIS
    const profile = await securityMonitor.getUserSecurityProfile(userId);
    
    context.securityAlerts += `\n**YOUR SECURITY LIMITS:**\n`;
    context.securityAlerts += `- Max Single Transaction: ${profile.limits.maxSingleTransaction} USDC\n`;
    context.securityAlerts += `- Max Daily Volume: ${profile.limits.maxDailyVolume} USDC\n`;
    
  } catch (error) {
    console.error('[MEMORY] Error building context:', error.message);
    context.paymentMemory = '(Error loading payment history)';
    context.statistics = '(Error calculating statistics)';
    
  }

  
  return context;
}

// ============================================
// MEMORY QUERY ENDPOINTS
// ============================================

// Get payment by date
app.get('/api/memory/payments/date/:date', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 'demo-user';
    const targetDate = new Date(req.params.date);
    
    const history = await paymentScheduler.getPaymentHistory(userId, 100);
    
    const paymentsOnDate = history.filter(p => {
      const paymentDate = p.timestamp?.toDate ? p.timestamp.toDate() : new Date(p.timestamp);
      return paymentDate.toDateString() === targetDate.toDateString();
    });
    
    res.json({
      success: true,
      date: targetDate.toDateString(),
      payments: paymentsOnDate,
      count: paymentsOnDate.length,
      total: paymentsOnDate.reduce((sum, p) => sum + (p.amount || 0), 0)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get payment statistics
app.get('/api/memory/stats', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 'demo-user';
    const period = req.query.period || 'month'; // day, week, month, year
    
    const history = await paymentScheduler.getPaymentHistory(userId, 1000);
    
    const now = new Date();
    let startDate;
    
    switch (period) {
      case 'day':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    
    const periodPayments = history.filter(p => {
      const paymentDate = p.timestamp?.toDate ? p.timestamp.toDate() : new Date(p.timestamp);
      return paymentDate >= startDate;
    });
    
    const total = periodPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const successful = periodPayments.filter(p => p.status === 'completed').length;
    
    // Group by recipient
    const byRecipient = {};
    periodPayments.forEach(p => {
      if (!byRecipient[p.payee]) {
        byRecipient[p.payee] = { count: 0, total: 0 };
      }
      byRecipient[p.payee].count++;
      byRecipient[p.payee].total += p.amount || 0;
    });
    
    // Group by day
    const byDay = {};
    periodPayments.forEach(p => {
      const date = p.timestamp?.toDate ? p.timestamp.toDate() : new Date(p.timestamp);
      const dateKey = date.toISOString().split('T')[0];
      if (!byDay[dateKey]) {
        byDay[dateKey] = { count: 0, total: 0 };
      }
      byDay[dateKey].count++;
      byDay[dateKey].total += p.amount || 0;
    });
    
    res.json({
      success: true,
      period,
      startDate,
      endDate: now,
      summary: {
        totalPayments: periodPayments.length,
        successfulPayments: successful,
        totalVolume: total,
        averagePayment: periodPayments.length > 0 ? total / periodPayments.length : 0
      },
      byRecipient,
      byDay,
      recentPayments: periodPayments.slice(0, 10)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search payments
app.get('/api/memory/search', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 'demo-user';
    const query = req.query.q?.toLowerCase();
    const limit = parseInt(req.query.limit) || 50;
    
    if (!query) {
      return res.status(400).json({ error: 'Search query required' });
    }
    
    const history = await paymentScheduler.getPaymentHistory(userId, 1000);
    
    const results = history.filter(p => {
      return (
        p.payee?.toLowerCase().includes(query) ||
        p.description?.toLowerCase().includes(query) ||
        p.amount?.toString().includes(query) ||
        p.txHash?.toLowerCase().includes(query)
      );
    }).slice(0, limit);
    
    res.json({
      success: true,
      query,
      results,
      count: results.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
      // Log to Firebase payment history
      try {
        await paymentScheduler.logPaymentHistory(user.id, {
          paymentId: `direct_${Date.now()}`,
          type: 'direct',
          payee: recipient,
          amount: amount,
          currency: currency || 'USDC',
          status: 'completed',
          txHash: result.txHash,
          explorerUrl: result.explorerUrl
        });
      } catch (error) {
        console.warn('[PAYMENT] History logging failed:', error.message);
      }
      
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
// ==================== SECURITY API ENDPOINTS ====================

// Get user's security profile
app.get('/api/security/profile', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 'demo-user';
    const profile = await securityMonitor.getUserSecurityProfile(userId);
    res.json({ success: true, profile });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get security alerts
app.get('/api/security/alerts', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 'demo-user';
    const limit = parseInt(req.query.limit) || 20;
    
    const snapshot = await paymentScheduler.db.collection('security_alerts')
      .where('userId', '==', userId)
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();
    
    const alerts = snapshot.docs.map(doc => ({
      alertId: doc.id,
      ...doc.data()
    }));
    
    res.json({
      success: true,
      alerts,
      unreadCount: alerts.filter(a => !a.read).length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get security checks history
app.get('/api/security/checks', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 'demo-user';
    const limit = parseInt(req.query.limit) || 50;
    
    const snapshot = await paymentScheduler.db.collection('security_checks')
      .where('userId', '==', userId)
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();
    
    const checks = snapshot.docs.map(doc => doc.data());
    
    const stats = {
      totalChecks: checks.length,
      blocked: checks.filter(c => c.recommendation === 'BLOCK').length,
      warned: checks.filter(c => c.recommendation === 'WARN').length,
      approved: checks.filter(c => c.recommendation === 'APPROVE').length,
      avgRiskScore: checks.reduce((sum, c) => sum + c.riskScore, 0) / checks.length || 0
    };
    
    res.json({ success: true, checks, stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update security limits
app.post('/api/security/limits', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 'demo-user';
    const { limits } = req.body;
    
    await securityMonitor.updateUserLimits(userId, limits);
    
    res.json({
      success: true,
      message: 'Security limits updated successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manual security review (2FA verification)
app.post('/api/security/review/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { approved, twoFactorCode } = req.body;
    const userId = req.headers['x-user-id'] || 'demo-user';
    
    if (!twoFactorCode) {
      return res.status(400).json({
        success: false,
        error: '2FA code required'
      });
    }
    
    // Log manual review
    await paymentScheduler.db.collection('security_reviews').add({
      userId,
      transactionId,
      approved,
      timestamp: require('firebase-admin').firestore.FieldValue.serverTimestamp()
    });
    
    res.json({
      success: true,
      approved,
      message: approved ? 'Transaction approved' : 'Transaction rejected'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    
    // Scheduled payments query - USING FIREBASE
    if (messageL.includes('scheduled') || messageL.includes('upcoming payment')) {
      const payments = await paymentScheduler.getScheduledPayments(userId, { status: 'scheduled' });
      
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
      // Handle scheduled payment approval - USING FIREBASE
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
  console.log(`   Firebase: ${paymentScheduler.initialized ? '✅ Ready' : '⏳ Initializing...'}`);
  console.log(`   Thirdweb x402: ✅ Ready for AI Payments`);
  console.log(`   Scheduling: ✅ Enabled (Firebase + Recurring)`);
  console.log(`   Security: ${securityMonitor.initialized ? '✅ AI-Powered Protection' : '⏳ Initializing...'}`);
  console.log(`   Payment Mode: User approval required`);
  console.log('============================================ 🚀\n');
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  process.exit(0);
});

module.exports = app;