const { ethers } = require('ethers');
require('dotenv').config();

// ABI for your deployed ArcBotDecisionLogger contract
const DECISION_LOGGER_ABI = [
  "event DecisionLogged(address indexed agent, string indexed decisionId, string actionSummary, uint256 totalAmount, uint8 riskScore, uint256 timestamp)",
  "event DecisionStatusUpdated(string indexed decisionId, uint8 oldStatus, uint8 newStatus, string txRef)",
  "event AgentAuthorized(address indexed agent, bool authorized)",
  "function logDecision(string decisionId, string actionSummary, string rationaleCID, string txRef, uint256 totalAmount, uint8 riskScore) external returns (bool)",
  "function updateDecisionStatus(string decisionId, uint8 newStatus, string txRef) external returns (bool)",
  "function getDecision(string decisionId) external view returns (tuple(address agent, string decisionId, string actionSummary, string rationaleCID, uint256 timestamp, string txRef, uint8 status, uint256 totalAmount, uint8 riskScore))",
  "function getTotalDecisions() external view returns (uint256)",
  "function getAgentStats(address agent) external view returns (uint256 totalDecisionsCount, uint256 totalVolume, bool isAuthorized)",
  "function setAgentAuthorization(address agent, bool authorized) external",
  "function authorizedAgents(address) external view returns (bool)",
  "function owner() external view returns (address)"
];

class DecisionLogger {
  constructor() {
    this.rpcUrl = process.env.ARC_RPC;
    this.privateKey = process.env.PRIVATE_KEY;
    this.contractAddress = process.env.DECISION_CONTRACT_ADDRESS;
    
    const isValidConfig = 
      this.rpcUrl && 
      this.privateKey && 
      this.contractAddress &&
      this.privateKey.startsWith('0x') &&
      this.privateKey.length === 66 &&
      this.contractAddress.startsWith('0x');
    
    this.enabled = isValidConfig;
    
    if (this.enabled) {
      try {
        this.provider = new ethers.JsonRpcProvider(this.rpcUrl);
        this.wallet = new ethers.Wallet(this.privateKey, this.provider);
        this.contract = new ethers.Contract(
          this.contractAddress,
          DECISION_LOGGER_ABI,
          this.wallet
        );
        
        console.log('╔════════════════════════════════════════════════════════╗');
        console.log('║          🔗 ARC BLOCKCHAIN CONNECTED                  ║');
        console.log('╠════════════════════════════════════════════════════════╣');
        console.log('║ Network:  Arc Testnet                                  ║');
        console.log(`║ Contract: ${this.contractAddress.slice(0, 20)}...    ║`);
        console.log(`║ Agent:    ${this.wallet.address.slice(0, 20)}...    ║`);
        console.log('║ Explorer: https://testnet.arcscan.app                  ║');
        console.log('╚════════════════════════════════════════════════════════╝');
      } catch (error) {
        console.log('[DECISION_LOGGER] ⚠️ Error:', error.message);
        this.enabled = false;
      }
    } else {
      console.log('[DECISION_LOGGER] ⚠️ Not configured properly');
    }
  }
  
  async logDecision(decisionId, actionSummary, rationaleCID, txRef, totalAmount, riskScore) {
    if (!this.enabled) {
      return { success: false, reason: 'Not configured' };
    }
    
    try {
      console.log(`[DECISION_LOGGER] 📝 Logging decision ${decisionId} to Arc...`);
      
      // Convert amount to 6 decimals (USDC format)
      const amountInUSDC = Math.floor((totalAmount || 0) * 1e6);
      
      // Ensure risk score is 0-100
      const safeRiskScore = Math.min(Math.max(Math.floor((riskScore || 0) * 100), 0), 100);
      
      const tx = await this.contract.logDecision(
        decisionId,
        actionSummary || 'No description',
        rationaleCID || '',
        txRef || '',
        amountInUSDC,
        safeRiskScore
      );
      
      console.log(`[DECISION_LOGGER] ⏳ TX sent: ${tx.hash}`);
      console.log(`[DECISION_LOGGER] 🔍 View: https://testnet.arcscan.app/tx/${tx.hash}`);
      
      const receipt = await tx.wait();
      console.log(`[DECISION_LOGGER] ✅ Confirmed in block ${receipt.blockNumber}`);
      console.log(`[DECISION_LOGGER] ⛽ Gas used: ${receipt.gasUsed.toString()}`);
      
      return {
        success: true,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        explorerUrl: `https://testnet.arcscan.app/tx/${receipt.hash}`,
        contractUrl: `https://testnet.arcscan.app/address/${this.contractAddress}`
      };
      
    } catch (error) {
      console.error('[DECISION_LOGGER] ❌ Error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  async updateStatus(decisionId, newStatus, txRef) {
    if (!this.enabled) return { success: false };
    
    try {
      // Status enum: 0=LOGGED, 1=EXECUTED, 2=FAILED, 3=CANCELLED
      const statusMap = {
        'LOGGED': 0,
        'EXECUTED': 1,
        'FAILED': 2,
        'CANCELLED': 3
      };
      
      const statusCode = statusMap[newStatus] || 0;
      
      const tx = await this.contract.updateDecisionStatus(
        decisionId,
        statusCode,
        txRef || ''
      );
      
      const receipt = await tx.wait();
      
      return {
        success: true,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber
      };
    } catch (error) {
      console.error('[DECISION_LOGGER] Update status error:', error.message);
      return { success: false, error: error.message };
    }
  }
  
  async getStats() {
    if (!this.enabled) return { enabled: false };
    
    try {
      const [count, volume, authorized] = await this.contract.getAgentStats(this.wallet.address);
      const totalDecisions = await this.contract.getTotalDecisions();
      const balance = await this.provider.getBalance(this.wallet.address);
      
      return {
        enabled: true,
        network: 'Arc Testnet',
        agentAddress: this.wallet.address,
        agentDecisions: count.toString(),
        totalVolume: (Number(volume) / 1e6).toFixed(2) + ' USDC',
        authorized,
        totalSystemDecisions: totalDecisions.toString(),
        contractAddress: this.contractAddress,
        balance: ethers.formatEther(balance) + ' USDC',
        explorerUrl: `https://testnet.arcscan.app/address/${this.contractAddress}`
      };
    } catch (error) {
      return { enabled: true, error: error.message };
    }
  }
  
  async getDecision(decisionId) {
    if (!this.enabled) return null;
    
    try {
      const decision = await this.contract.getDecision(decisionId);
      return {
        agent: decision.agent,
        decisionId: decision.decisionId,
        actionSummary: decision.actionSummary,
        rationaleCID: decision.rationaleCID,
        timestamp: new Date(Number(decision.timestamp) * 1000).toISOString(),
        txRef: decision.txRef,
        status: ['LOGGED', 'EXECUTED', 'FAILED', 'CANCELLED'][decision.status],
        totalAmount: (Number(decision.totalAmount) / 1e6).toFixed(2),
        riskScore: decision.riskScore
      };
    } catch (error) {
      console.error('[DECISION_LOGGER] Get decision error:', error.message);
      return null;
    }
  }
}

const logger = new DecisionLogger();

async function logDecisionOnChain(decisionId, actionSummary, rationaleCID, txRef, totalAmount = 0, riskScore = 0) {
  return await logger.logDecision(decisionId, actionSummary, rationaleCID, txRef, totalAmount, riskScore);
}

async function updateDecisionStatus(decisionId, status, txRef) {
  return await logger.updateStatus(decisionId, status, txRef);
}

async function getContractInfo() {
  return await logger.getStats();
}

async function getDecisionFromChain(decisionId) {
  return await logger.getDecision(decisionId);
}

module.exports = {
  logDecisionOnChain,
  updateDecisionStatus,
  getContractInfo,
  getDecisionFromChain,
  DecisionLogger
};