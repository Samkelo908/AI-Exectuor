// backend/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');  
const http = require('http');
const https = require('https');
const orchestrator = require('./orchestrator');
const { logDecisionOnChain } = require('./decisionLogger');

const app = express();

// Configure axios defaults for better connection handling
axios.defaults.httpAgent = new http.Agent({ 
  keepAlive: true,
  maxSockets: 50 
});
axios.defaults.httpsAgent = new https.Agent({ 
  keepAlive: true,
  maxSockets: 50 
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Validate ElevenLabs configuration
if (process.env.ELEVENLABS_KEY) {
  if (!process.env.ELEVENLABS_KEY.startsWith('sk_')) {
    console.warn('[TTS] ⚠️  ElevenLabs API key format looks incorrect (should start with sk_)');
  } else {
    console.log('[TTS] ✅ ElevenLabs configured');
  }
}

// In-memory store (replace with real DB in production)
const STORE = {
  users: {
    'demo-user': {
      userId: 'demo-user',
      email: 'demo@arcbot.ai',
      name: 'Demo User',
      kyc: true,
      createdAt: new Date()
    }
  },
  agents: {
    'demo-user': {
      agentId: 'agent-demo',
      userId: 'demo-user',
      personality: 'balanced',
      dailyLimit: 1000,
      autoApprove: false
    }
  },
  wallets: {
    'demo-user': {
      walletId: 'wallet-demo',
      userId: 'demo-user',
      circleWalletId: 'circle-wallet-demo',
      arcAddress: '0xDemo123456789AbCdEf',
      balance: 1000
    }
  },
  instructions: {},
  transactions: {}
};

// ============= HELPER FUNCTIONS =============

// Helper function for retry logic
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Check if error is retryable
      const isRetryable = 
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNREFUSED' ||
        (error.response && error.response.status >= 500);
      
      if (!isRetryable) {
        throw error;
      }
      
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`[TTS] Retry attempt ${attempt}/${maxRetries} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

function parseIntents(text) {
  const lower = text.toLowerCase();
  const intents = [];
  
  // Payment detection
  if (lower.includes('netflix') || lower.includes('subscription')) {
    intents.push({
      type: 'PAY',
      payee: 'Netflix',
      amount: 13.99,
      currency: 'USDC',
      when: 'now',
      confidence: 0.95
    });
  }
  
  // Tip detection
  const tipMatch = lower.match(/tip.*?(\d+)\s*(usdc|dollars?)/i);
  if (tipMatch) {
    intents.push({
      type: 'TIP',
      payee: extractPayee(lower, 'tip'),
      amount: parseFloat(tipMatch[1]),
      currency: 'USDC',
      confidence: 0.90
    });
  }
  
  // Save detection
  const saveMatch = lower.match(/save.*?(\d+)%/i);
  if (saveMatch) {
    intents.push({
      type: 'SAVE',
      percent: parseInt(saveMatch[1]),
      confidence: 0.88
    });
  }
  
  // Transfer detection
  const transferMatch = lower.match(/send.*?(\d+)\s*(usdc|dollars?)/i);
  if (transferMatch) {
    intents.push({
      type: 'TRANSFER',
      amount: parseFloat(transferMatch[1]),
      currency: 'USDC',
      to: extractPayee(lower, 'send'),
      confidence: 0.92
    });
  }
  
  return {
    raw: text,
    intents,
    entities: extractEntities(text)
  };
}

function extractPayee(text, action) {
  const payees = ['trainer', 'coach', 'friend', 'mom', 'dad', 'colleague'];
  const found = payees.find(p => text.includes(p));
  return found ? found.charAt(0).toUpperCase() + found.slice(1) : 'Recipient';
}

function extractEntities(text) {
  const entities = {};
  
  // Amount extraction
  const amountMatch = text.match(/\$?(\d+(?:\.\d{2})?)/);
  if (amountMatch) {
    entities.amount = parseFloat(amountMatch[1]);
  }
  
  // Date extraction
  if (text.toLowerCase().includes('today')) {
    entities.when = 'today';
  } else if (text.toLowerCase().includes('tomorrow')) {
    entities.when = 'tomorrow';
  }
  
  return entities;
}

function calculateConfidence(parsed) {
  if (parsed.intents.length === 0) return 0;
  const avgConfidence = parsed.intents.reduce((sum, i) => sum + (i.confidence || 0.8), 0) / parsed.intents.length;
  return Math.round(avgConfidence * 100) / 100;
}

function generateActionPlan(parsed, agent, wallet) {
  const actions = [];
  let totalAmount = 0;
  
  parsed.intents.forEach((intent, idx) => {
    if (intent.type === 'PAY' || intent.type === 'TIP' || intent.type === 'TRANSFER') {
      const amount = intent.amount || 0;
      totalAmount += amount;
      
      actions.push({
        actionId: `action_${idx}_${Date.now()}`,
        type: 'TRANSFER',
        to: intent.payee || intent.to || 'Unknown',
        amount,
        currency: intent.currency || 'USDC',
        memo: `${intent.type}: ${intent.payee || intent.to}`
      });
    } else if (intent.type === 'SAVE') {
      actions.push({
        actionId: `action_${idx}_${Date.now()}`,
        type: 'SAVE',
        to: 'Savings Account',
        percent: intent.percent,
        memo: `Save ${intent.percent}% of available balance`
      });
    }
  });
  
  // Calculate risk score
  const riskScore = calculateRiskScore(totalAmount, wallet, agent);
  
  // Generate rationale based on personality
  const rationale = generateRationale(actions, agent.personality, riskScore);
  
  return {
    actions,
    rationale,
    riskScore,
    totalAmount,
    requiresApproval: riskScore > 0.5 || totalAmount > agent.dailyLimit / 2
  };
}

function calculateRiskScore(amount, wallet, agent) {
  let risk = 0;
  
  // Amount vs balance
  if (amount > wallet.balance * 0.5) risk += 0.3;
  if (amount > wallet.balance) risk += 0.5;
  
  // Amount vs daily limit
  if (amount > agent.dailyLimit * 0.5) risk += 0.2;
  if (amount > agent.dailyLimit) risk += 0.4;
  
  return Math.min(risk, 1.0);
}

function generateRationale(actions, personality, riskScore) {
  const actionCount = actions.length;
  const actionTypes = [...new Set(actions.map(a => a.type))];
  
  let rationale = `Analyzed your request and identified ${actionCount} action${actionCount > 1 ? 's' : ''} to execute. `;
  
  if (personality === 'frugal') {
    rationale += 'As your frugal assistant, I prioritized essential payments and minimized unnecessary spending. ';
  } else if (personality === 'generous') {
    rationale += 'Following your generous profile, I\'ve prepared all requested transfers with priority on tips and donations. ';
  } else {
    rationale += 'Using a balanced approach, I\'ve organized payments by priority and urgency. ';
  }
  
  if (riskScore > 0.7) {
    rationale += '⚠️ High risk detected - please review carefully before approving.';
  } else if (riskScore > 0.4) {
    rationale += '⚡ Moderate risk - standard approval recommended.';
  } else {
    rationale += '✅ Low risk transaction - safe to proceed.';
  }
  
  return rationale;
}

// ============= ROUTES =============

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get user profile
app.get('/api/me', (req, res) => {
  const userId = req.headers['x-user-id'] || 'demo-user';
  const user = STORE.users[userId];
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  const agent = STORE.agents[userId];
  const wallet = STORE.wallets[userId];
  
  res.json({
    user,
    agent,
    wallet
  });
});

// Parse intent from text
app.post('/api/parse', async (req, res) => {
  try {
    const { text } = req.body;
    const userId = req.headers['x-user-id'] || 'demo-user';
    
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Text is required' });
    }
    
    console.log(`[PARSE] User: ${userId}, Text: "${text}"`);
    
    // Simulate AI processing delay
    await new Promise(resolve => setTimeout(resolve, 600 + Math.random() * 400));
    
    // Parse intents using NLP (mocked)
    const parsed = parseIntents(text);
    
    // Store instruction
    const instructionId = uuidv4();
    STORE.instructions[instructionId] = {
      instructionId,
      userId,
      rawText: text,
      parsed,
      status: 'parsed',
      createdAt: new Date()
    };
    
    console.log(`[PARSE] Success: ${parsed.intents.length} intents found`);
    
    res.json({
      instructionId,
      parsed,
      confidence: calculateConfidence(parsed)
    });
    
  } catch (error) {
    console.error('[PARSE] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate action plan
app.post('/api/plan', async (req, res) => {
  try {
    const { instructionId, parsed } = req.body;
    const userId = req.headers['x-user-id'] || 'demo-user';
    
    console.log(`[PLAN] User: ${userId}, Instruction: ${instructionId}`);
    
    const instruction = STORE.instructions[instructionId];
    if (!instruction) {
      return res.status(404).json({ error: 'Instruction not found' });
    }
    
    const agent = STORE.agents[userId];
    const wallet = STORE.wallets[userId];
    
    // Simulate planning delay
    await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 300));
    
    // Generate action plan
    const plan = generateActionPlan(parsed || instruction.parsed, agent, wallet);
    
    // Update instruction
    instruction.plan = plan;
    instruction.status = 'planned';
    
    console.log(`[PLAN] Success: ${plan.actions.length} actions planned`);
    
    res.json({
      actionPlan: plan.actions,
      rationale: plan.rationale,
      riskScore: plan.riskScore,
      totalAmount: plan.totalAmount
    });
    
  } catch (error) {
    console.error('[PLAN] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Approve and execute plan
app.post('/api/approve', async (req, res) => {
  try {
    const { instructionId } = req.body;
    const userId = req.headers['x-user-id'] || 'demo-user';
    
    console.log(`[APPROVE] User: ${userId}, Instruction: ${instructionId}`);
    
    const instruction = STORE.instructions[instructionId];
    if (!instruction || !instruction.plan) {
      return res.status(400).json({ error: 'Invalid instruction or no plan found' });
    }
    
    const agent = STORE.agents[userId];
    const wallet = STORE.wallets[userId];
    
    // Execute plan through orchestrator
    const executionResult = await orchestrator.executePlan(
      instruction.plan,
      { userId, agent, wallet }
    );
    
    // Store transaction records
    executionResult.results.forEach(result => {
      const txId = uuidv4();
      STORE.transactions[txId] = {
        txId,
        instructionId,
        walletId: wallet.walletId,
        ...result,
        createdAt: new Date()
      };
    });
    
    // Log decision on-chain (if configured)
    let onChainTx = null;
    if (process.env.ARC_RPC && process.env.DECISION_CONTRACT_ADDRESS) {
      try {
        onChainTx = await logDecisionOnChain(
          instructionId,
          instruction.plan.rationale,
          '', // CID placeholder
          executionResult.results.map(r => r.circleTxId).join(',')
        );
      } catch (error) {
        console.warn('[APPROVE] On-chain logging failed:', error.message);
      }
    }
    
    // Update instruction status
    instruction.status = 'executed';
    instruction.executionResult = executionResult;
    instruction.onChainTx = onChainTx;
    
    console.log(`[APPROVE] Success: ${executionResult.results.length} transactions executed`);
    
    res.json({
      status: 'submitted',
      result: executionResult,
      onChainTx
    });
    
  } catch (error) {
    console.error('[APPROVE] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get transaction status
app.get('/api/tx/:txId', (req, res) => {
  const { txId } = req.params;
  const transaction = STORE.transactions[txId];
  
  if (!transaction) {
    return res.status(404).json({ error: 'Transaction not found' });
  }
  
  res.json(transaction);
});

// Get agent profile
app.get('/api/agent', (req, res) => {
  const userId = req.headers['x-user-id'] || 'demo-user';
  const agent = STORE.agents[userId];
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  res.json(agent);
});

// Update agent profile
app.post('/api/agent', (req, res) => {
  const userId = req.headers['x-user-id'] || 'demo-user';
  const { personality, dailyLimit, autoApprove } = req.body;
  
  const agent = STORE.agents[userId];
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  if (personality) agent.personality = personality;
  if (dailyLimit !== undefined) agent.dailyLimit = dailyLimit;
  if (autoApprove !== undefined) agent.autoApprove = autoApprove;
  
  res.json(agent);
});

// TTS proxy endpoint with ElevenLabs and retry logic
app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body;
    
    // Validate input
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ 
        error: 'Text is required and must be a non-empty string' 
      });
    }
    
    // Truncate text if too long (ElevenLabs has character limits)
    const maxLength = 5000;
    const truncatedText = text.length > maxLength 
      ? text.substring(0, maxLength) + '...' 
      : text;
    
    if (!process.env.ELEVENLABS_KEY) {
      console.log('[TTS] ElevenLabs not configured');
      return res.json({ 
        url: null, 
        text: truncatedText, 
        fallback: true,
        reason: 'ElevenLabs API key not configured'
      });
    }
    
    console.log(`[TTS] 🎤 Generating speech with ElevenLabs (${truncatedText.length} chars)...`);
    
    // Rachel voice - clear and professional
    const voiceId = 'EXAVITQu4vr4xnSDxMaL';
    
    // Wrap the API call in retry logic
    const response = await retryWithBackoff(async () => {
      return await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          text: truncatedText,
          model_id: "eleven_monolingual_v1",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0,
            use_speaker_boost: true
          }
        },
        {
          headers: {
            'Accept': 'audio/mpeg',
            'xi-api-key': process.env.ELEVENLABS_KEY,
            'Content-Type': 'application/json'
          },
          responseType: 'arraybuffer',
          timeout: 30000, // 30 second timeout
          maxContentLength: 50 * 1024 * 1024 // 50MB max
        }
      );
    }, 3, 1000); // 3 retries, starting with 1 second delay
    
    // Convert audio to base64
    const audioBase64 = Buffer.from(response.data).toString('base64');
    const audioUrl = `data:audio/mpeg;base64,${audioBase64}`;
    
    console.log('[TTS] ✅ Speech generated successfully');
    
    res.json({ 
      url: audioUrl, 
      text: truncatedText,
      fallback: false,
      provider: 'elevenlabs',
      characterCount: truncatedText.length
    });
    
  } catch (error) {
    const errorMessage = error.response?.data?.detail?.message 
      || error.message 
      || 'Unknown error';
    
    console.error('[TTS] ❌ Error:', errorMessage);
    
    // Check for specific error types
    let userMessage = 'Speech generation failed';
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      userMessage = 'Network connection issue - please try again';
    } else if (error.response?.status === 401) {
      userMessage = 'Invalid ElevenLabs API key';
    } else if (error.response?.status === 429) {
      userMessage = 'Rate limit exceeded - please wait a moment';
    } else if (error.response?.status === 500) {
      userMessage = 'ElevenLabs service temporarily unavailable';
    }
    
    // Return fallback response
    res.json({ 
      url: null, 
      text: req.body.text, 
      fallback: true,
      error: errorMessage,
      userMessage,
      provider: 'elevenlabs'
    });
  }
});

// TTS health check endpoint
app.get('/api/tts/health', async (req, res) => {
  if (!process.env.ELEVENLABS_KEY) {
    return res.json({
      status: 'disabled',
      reason: 'API key not configured'
    });
  }
  
  try {
    // Make a small test request
    const response = await axios.get(
      'https://api.elevenlabs.io/v1/user',
      {
        headers: {
          'xi-api-key': process.env.ELEVENLABS_KEY
        },
        timeout: 5000
      }
    );
    
    res.json({
      status: 'ok',
      subscription: response.data.subscription?.tier || 'unknown',
      characterLimit: response.data.subscription?.character_limit || 'unknown',
      characterCount: response.data.subscription?.character_count || 0
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      error: error.message
    });
  }
});

// Get instruction history
app.get('/api/history', (req, res) => {
  const userId = req.headers['x-user-id'] || 'demo-user';
  const limit = parseInt(req.query.limit) || 10;
  
  const instructions = Object.values(STORE.instructions)
    .filter(i => i.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
  
  res.json(instructions);
});

// ============= SERVER START =============

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('🤖 AI Executor Backend Server');
  console.log('='.repeat(60));
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📡 API endpoint: http://localhost:${PORT}/api`);
  console.log(`💾 Storage: In-memory (${Object.keys(STORE.users).length} users)`);
  console.log(`🔐 Arc RPC: ${process.env.ARC_RPC || 'Not configured (using mocks)'}`);
  console.log(`🎤 ElevenLabs: ${process.env.ELEVENLABS_KEY ? 'Configured' : 'Not configured (using browser TTS)'}`);
  console.log('='.repeat(60));
  console.log('Ready to receive requests! 🚀');
  console.log('='.repeat(60));
});

module.exports = app;