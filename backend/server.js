// Load environment variables FIRST
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// Import services
const { connectDB, PaymentSchedulerService, ScheduledPayment } = require('./services/paymentScheduler');
const { executePlan } = require('./orchestrator');
const { logDecisionOnChain, getContractInfo, getDecisionFromChain, updateDecisionStatus } = require('./decisionLogger');
const { parseInstructionWithScheduling, formatDateForDisplay } = require('./enhancedParser');

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

// Mock user data
const mockUser = {
  id: 'demo-user',
  wallet: {
    address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    balance: 1000,
    circleWalletId: 'wallet_demo_123'
  },
  agent: {
    personality: 'balanced',
    dailyLimit: 500
  }
};

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
    timestamp: new Date().toISOString() 
  });
});

// Get user profile
app.get('/api/me', (req, res) => {
  res.json(mockUser);
});

// ==================== BLOCKCHAIN ROUTES ====================

// Get blockchain stats
app.get('/api/blockchain/stats', async (req, res) => {
  try {
    const stats = await getContractInfo();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get specific decision from blockchain
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

// ==================== CLOUDFLARE AI CHAT ====================

// AI Chat endpoint with Cloudflare Workers AI
app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    const userId = req.headers['x-user-id'] || 'demo-user';
    
    console.log(`[CHAT] User: ${userId}, Messages: ${messages?.length || 0}`);
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }
    
    // Get user context
    const user = mockUser;
    const wallet = user.wallet;
    const agent = user.agent;
    
    // Add ArcBot system context
    const systemMessage = {
      role: "system",
      content: `You are ArcBot, an AI assistant for cryptocurrency wallet management powered by Cloudflare Workers AI.

**User Context:**
- Wallet Balance: ${wallet.balance} USDC
- Wallet Address: ${wallet.address}
- Daily Limit: ${agent.dailyLimit} USDC
- Personality: ${agent.personality}

**You can help users with:**
- Checking wallet balance and transactions
- Scheduling payments and recurring transfers
- Sending money to contacts
- Saving for goals
- Viewing transaction history
- Answering questions about crypto and payments

**Available Commands:**
- "What's my balance?" - Check wallet balance
- "Schedule a payment" - Set up future payments
- "Send [amount] to [person]" - Transfer funds
- "Show my scheduled payments" - View upcoming payments
- "Transaction history" - View past transactions

Be helpful, concise, and security-conscious. When users want to perform financial actions, guide them with clear instructions.`
    };
    
    // Prepare messages for Cloudflare
    const chatMessages = [systemMessage, ...messages];
    
    // Check if Cloudflare Worker is configured
    const cloudflareWorkerUrl = process.env.CLOUDFLARE_WORKER_URL;
    
    if (!cloudflareWorkerUrl) {
      return res.status(500).json({ 
        error: 'Cloudflare Worker not configured',
        message: 'Please set CLOUDFLARE_WORKER_URL in your .env file'
      });
    }
    
    console.log(`[CHAT] Forwarding to Cloudflare Worker: ${cloudflareWorkerUrl}`);
    
    // Forward to Cloudflare Worker and stream response
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
    
    // Set headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    
    // Pipe the stream from Cloudflare to client
    response.data.pipe(res);
    
    // Handle stream errors
    response.data.on('error', (error) => {
      console.error('[CHAT] Stream error:', error.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Stream error' });
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
    
    res.status(500).json({ error: error.message });
  }
});

// Chat with command detection (smart routing)
app.post('/api/chat/smart', async (req, res) => {
  try {
    const { message } = req.body;
    const userId = req.headers['x-user-id'] || 'demo-user';
    
    console.log(`[CHAT/SMART] Processing: "${message}"`);
    
    // Detect financial commands
    const messageL = message.toLowerCase();
    
    // Balance query
    if (messageL.includes('balance') || messageL.includes('how much')) {
      const wallet = mockUser.wallet;
      return res.json({
        type: 'balance',
        message: `💰 **Your Wallet Balance**\n\nCurrent Balance: ${wallet.balance} USDC\nWallet Address: \`${wallet.address}\`\nDaily Limit: ${mockUser.agent.dailyLimit} USDC`
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
        msg += `   Date: ${formatDateForDisplay(p.scheduledDate)}\n\n`;
      });
      
      return res.json({
        type: 'list',
        message: msg,
        data: payments
      });
    }
    
    // Send/Transfer/Pay command
    if (messageL.includes('send') || messageL.includes('transfer') || messageL.includes('pay')) {
      const parsed = parseInstructionWithScheduling(message);
      
      if (parsed.intents.length > 0) {
        return res.json({
          type: 'action',
          message: `🔍 **Payment Detected**\n\nI found a payment request. Use the /api/parse endpoint to process this transaction.`,
          parsed
        });
      }
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

// ==================== ORIGINAL ROUTES ====================

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

// Generate action plan (now handles scheduling)
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
      const plan = await generateScheduledPlan(parsedData, mockUser.id);
      
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
    
    console.log(`[APPROVE] User: ${mockUser.id}, Instruction: ${instructionId}`);
    
    if (isScheduled) {
      // Handle scheduled payment approval
      const payment = await paymentScheduler.schedulePayment(mockUser.id, scheduledPayment);
      
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
      const plan = providedPlan || instruction?.plan || mockPlan;
      
      if (!plan || !plan.actions) {
        return res.status(400).json({ error: 'No valid plan found' });
      }
      
      // Execute the plan with instruction ID for blockchain logging
      const result = await executePlan(plan, {
        userId: mockUser.id,
        agent: mockUser.agent,
        wallet: mockUser.wallet,
        instructionId  // Pass for blockchain logging
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
      'https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM',
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
    
    res.json({ url: audioUrl });
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

const mockPlan = {
  actions: [
    { actionId: 'mock_1', type: 'TRANSFER', to: 'Netflix', amount: 13.99, currency: 'USDC' }
  ]
};

// ==================== START SERVER ====================

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log('\n🚀 ============================================');
  console.log(`   ArcBot Backend Server`);
  console.log(`   Port: ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   MongoDB: ${process.env.MONGODB_URI || 'mongodb://localhost:27017/arcbot'}`);
  console.log(`   Circle API: ${process.env.CIRCLE_API_KEY ? 'Configured' : 'Not configured (Mock mode)'}`);
  console.log(`   Cloudflare AI: ${process.env.CLOUDFLARE_WORKER_URL ? '✅ Configured' : '⚠️  Not configured'}`);
  console.log(`   Arc Blockchain: ${process.env.DECISION_CONTRACT_ADDRESS ? '✅ Configured' : '⚠️  Not configured'}`);
  console.log(`   Scheduler: ✅ Active`);
  console.log('============================================ 🚀\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  process.exit(0);
});