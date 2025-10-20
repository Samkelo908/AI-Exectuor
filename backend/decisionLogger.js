// backend/decisionLogger.js
const { ethers } = require('ethers');
require('dotenv').config();

// Contract ABI for DecisionLogger
const DECISION_LOGGER_ABI = [
  "event DecisionLogged(address indexed agent, string decisionId, string actionSummary, string rationaleCID, uint256 timestamp, string txRef)",
  "function logDecision(string decisionId, string actionSummary, string rationaleCID, string txRef) external"
];

class DecisionLogger {
  constructor() {
    this.rpcUrl = process.env.ARC_RPC;
    this.privateKey = process.env.PRIVATE_KEY;
    this.contractAddress = process.env.DECISION_CONTRACT_ADDRESS;
    
    // Check if configuration is valid (not placeholder values)
    const isValidConfig = 
      this.rpcUrl && 
      this.privateKey && 
      this.contractAddress &&
      !this.rpcUrl.includes('example') &&
      !this.privateKey.includes('YourPrivateKeyHere') &&
      !this.contractAddress.includes('YourContractAddressHere') &&
      this.privateKey.length === 66; // Valid private key length
    
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
        
        console.log('[DECISION_LOGGER] ✅ Initialized with address:', this.contractAddress);
        console.log('[DECISION_LOGGER] Agent address:', this.wallet.address);
      } catch (error) {
        console.log('[DECISION_LOGGER] ⚠️ Configuration error:', error.message);
        this.enabled = false;
      }
    } else {
      console.log('[DECISION_LOGGER] ⚠️ Disabled (missing or invalid configuration)');
      console.log('[DECISION_LOGGER] ℹ️  To enable: Set valid ARC_RPC, PRIVATE_KEY, and DECISION_CONTRACT_ADDRESS in .env');
    }
  }
  
  /**
   * Log a decision to the blockchain
   */
  async logDecision(decisionId, actionSummary, rationaleCID, txRef) {
    if (!this.enabled) {
      console.log('[DECISION_LOGGER] Skipping on-chain log (disabled)');
      return {
        success: false,
        reason: 'Decision logger not configured or disabled'
      };
    }
    
    try {
      console.log(`[DECISION_LOGGER] Logging decision ${decisionId} to blockchain...`);
      
      // Estimate gas
      const gasEstimate = await this.contract.logDecision.estimateGas(
        decisionId,
        actionSummary,
        rationaleCID || '',
        txRef || ''
      );
      
      console.log(`[DECISION_LOGGER] Gas estimate: ${gasEstimate.toString()}`);
      
      // Send transaction
      const tx = await this.contract.logDecision(
        decisionId,
        actionSummary,
        rationaleCID || '',
        txRef || '',
        {
          gasLimit: gasEstimate * 120n / 100n // 20% buffer
        }
      );
      
      console.log(`[DECISION_LOGGER] Transaction sent: ${tx.hash}`);
      console.log(`[DECISION_LOGGER] Waiting for confirmation...`);
      
      // Wait for confirmation
      const receipt = await tx.wait();
      
      console.log(`[DECISION_LOGGER] ✅ Confirmed in block ${receipt.blockNumber}`);
      
      // Parse events
      const events = this.parseEvents(receipt);
      
      return {
        success: true,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        events
      };
      
    } catch (error) {
      console.error('[DECISION_LOGGER] ❌ Error:', error.message);
      
      return {
        success: false,
        error: error.message,
        reason: this.parseError(error)
      };
    }
  }
  
  /**
   * Parse events from transaction receipt
   */
  parseEvents(receipt) {
    try {
      const events = [];
      
      for (const log of receipt.logs) {
        try {
          const parsed = this.contract.interface.parseLog({
            topics: log.topics,
            data: log.data
          });
          
          if (parsed) {
            events.push({
              name: parsed.name,
              args: {
                agent: parsed.args.agent,
                decisionId: parsed.args.decisionId,
                actionSummary: parsed.args.actionSummary,
                rationaleCID: parsed.args.rationaleCID,
                timestamp: parsed.args.timestamp.toString(),
                txRef: parsed.args.txRef
              }
            });
          }
        } catch (e) {
          // Skip logs that don't match our ABI
          continue;
        }
      }
      
      return events;
    } catch (error) {
      console.error('[DECISION_LOGGER] Error parsing events:', error.message);
      return [];
    }
  }
  
  /**
   * Parse error message for user-friendly output
   */
  parseError(error) {
    if (error.message.includes('insufficient funds')) {
      return 'Insufficient gas for transaction';
    } else if (error.message.includes('nonce')) {
      return 'Nonce mismatch - transaction order issue';
    } else if (error.message.includes('timeout')) {
      return 'Network timeout - please retry';
    } else if (error.message.includes('revert')) {
      return 'Contract execution reverted';
    }
    return error.message;
  }
  
  /**
   * Get contract information
   */
  async getContractInfo() {
    if (!this.enabled) {
      return { enabled: false };
    }
    
    try {
      const network = await this.provider.getNetwork();
      const balance = await this.provider.getBalance(this.wallet.address);
      
      return {
        enabled: true,
        contractAddress: this.contractAddress,
        agentAddress: this.wallet.address,
        network: {
          name: network.name,
          chainId: network.chainId.toString()
        },
        balance: ethers.formatEther(balance)
      };
    } catch (error) {
      return {
        enabled: true,
        error: error.message
      };
    }
  }
}

// Singleton instance
const logger = new DecisionLogger();

/**
 * Log a decision to blockchain
 */
async function logDecisionOnChain(decisionId, actionSummary, rationaleCID, txRef) {
  return await logger.logDecision(decisionId, actionSummary, rationaleCID, txRef);
}

/**
 * Get contract info
 */
async function getContractInfo() {
  return await logger.getContractInfo();
}

module.exports = {
  logDecisionOnChain,
  getContractInfo,
  DecisionLogger
};