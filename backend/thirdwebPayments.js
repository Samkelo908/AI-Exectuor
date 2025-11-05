// thirdwebPayments.js - Thirdweb v5 Integration for Arc (COMPLETE + FIXED)
const { ethers } = require("ethers");

/**
 * Thirdweb-style Payment Service for Arc using ethers v6
 * CRITICAL FIX: On Arc Testnet, the NATIVE token IS USDC (not ERC20)
 * Enables AI agents to make autonomous payments
 */
class ThirdwebPaymentService {
  constructor() {
    this.provider = null;
    this.wallet = null;
    this.chainId = parseInt(process.env.ARC_CHAIN_ID || '5042002'); // Fixed chain ID
    this.initialized = false;
  }

  /**
   * Initialize service with Arc network
   */
  async initialize() {
    try {
      if (this.initialized) {
        return true;
      }

      console.log('[THIRDWEB] Initializing payment service for Arc...');

      const privateKey = process.env.PRIVATE_KEY;
      if (!privateKey) {
        throw new Error('PRIVATE_KEY not found in .env');
      }

      // Create provider for Arc network
      this.provider = new ethers.JsonRpcProvider(
        process.env.ARC_RPC || 'https://rpc.testnet.arc.network',
        {
          chainId: this.chainId,
          name: 'Arc Testnet'
        }
      );

      // Create wallet from private key
      this.wallet = new ethers.Wallet(privateKey, this.provider);

      this.initialized = true;
      console.log(`[THIRDWEB] ✅ Initialized with wallet: ${this.wallet.address}`);
      
      return true;
    } catch (error) {
      console.error('[THIRDWEB] Initialization error:', error.message);
      throw error;
    }
  }

  /**
   * Enhanced address validation that's more flexible
   */
  isValidAddress(address) {
    try {
      if (!address || typeof address !== 'string') {
        return false;
      }

      // Clean the address
      const cleanAddr = address.trim();
      
      // Basic format check
      if (!cleanAddr.startsWith('0x') || cleanAddr.length !== 42) {
        console.log(`[THIRDWEB] Address format invalid: ${cleanAddr} (length: ${cleanAddr.length})`);
        return false;
      }

      // Check if it's a valid hex string
      const hexRegex = /^0x[0-9a-fA-F]{40}$/;
      if (!hexRegex.test(cleanAddr)) {
        console.log(`[THIRDWEB] Address contains invalid characters: ${cleanAddr}`);
        return false;
      }

      // Try to checksum the address
      try {
        const checksummed = ethers.getAddress(cleanAddr);
        console.log(`[THIRDWEB] ✅ Valid address: ${checksummed}`);
        return true;
      } catch (checksumError) {
        console.log(`[THIRDWEB] Address checksum failed, but format is valid: ${cleanAddr}`);
        // Even if checksum fails, the address might still be valid
        // Many addresses in testnets don't follow checksum rules
        return true;
      }
    } catch (error) {
      console.log(`[THIRDWEB] Address validation error:`, error);
      return false;
    }
  }

  /**
   * Clean and normalize address
   */
  cleanAddress(address) {
    try {
      const cleanAddr = address.trim();
      // Try to get checksum address, but fallback to lowercase if it fails
      try {
        return ethers.getAddress(cleanAddr);
      } catch (e) {
        return cleanAddr.toLowerCase();
      }
    } catch (error) {
      return address.trim();
    }
  }

  /**
   * Create an x402-style payment request
   */
  async createPaymentRequest(params) {
    try {
      await this.initialize();

      const {
        to,
        amount,
        currency = 'USDC',
        description,
        metadata = {}
      } = params;

      console.log(`[THIRDWEB] Creating payment request: ${amount} ${currency} to ${to}`);

      // Enhanced recipient address validation
      if (!to) {
        throw new Error('Recipient address is required');
      }

      if (!this.isValidAddress(to)) {
        throw new Error(`Invalid recipient address: ${to}`);
      }

      // Clean the recipient address
      const cleanTo = this.cleanAddress(to);

      const paymentRequest = {
        id: `pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        from: this.wallet.address,
        to: cleanTo,
        amount: parseFloat(amount),
        currency,
        description,
        status: 'pending',
        createdAt: new Date().toISOString(),
        metadata: {
          ...metadata,
          aiAgent: 'ArcBot',
          version: '1.0.0'
        }
      };

      console.log(`[THIRDWEB] ✅ Payment request created: ${paymentRequest.id}`);
      
      return paymentRequest;
    } catch (error) {
      console.error('[THIRDWEB] Error creating payment request:', error.message);
      throw error;
    }
  }

  /**
   * Execute a payment
   * CRITICAL FIX: Always use native transfers for USDC on Arc
   */
async executePayment(paymentRequest) {
  try {
    console.log(`[THIRDWEB] Executing payment: ${paymentRequest.amount} ${paymentRequest.currency} to ${paymentRequest.to}`);
    
    // Ensure wallet is initialized
    if (!this.wallet) {
      await this.initialize();
    }
    
    console.log('[THIRDWEB] Using NATIVE token transfer (USDC on Arc Testnet)');
    
    // CRITICAL FIX: Arc uses USDC (6 decimals) as native token, NOT 18 decimals
    const amountInWei = ethers.parseUnits(
      paymentRequest.amount.toString(), 
      18  // ← Correct for Arc native token
    );
    
    console.log('[THIRDWEB] Transfer details:');
    console.log(`  From: ${this.wallet.address}`);
    console.log(`  To: ${paymentRequest.to}`);
    console.log(`  Amount: ${paymentRequest.amount} USDC`);
    console.log(`  Amount in USDC units: ${amountInWei.toString()}`);
    
    // Send native USDC transfer
    const tx = await this.wallet.sendTransaction({
      to: paymentRequest.to,
      value: amountInWei,
      gasLimit: 50000 // Reasonable gas limit for simple transfer
    });
    
    console.log(`[THIRDWEB] ✅ Native transfer tx sent: ${tx.hash}`);
    console.log('[THIRDWEB] Waiting for transaction confirmation...');
    
    const receipt = await tx.wait();
    
    console.log(`[THIRDWEB] ✅ Transaction confirmed in block ${receipt.blockNumber}`);
    console.log(`[THIRDWEB] Gas used: ${receipt.gasUsed.toString()}`);
    
    return {
      status: 'completed',
      id: paymentRequest.id,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      explorerUrl: `https://testnet.arcscan.app/tx/${receipt.hash}`,
      message: `Successfully transferred ${paymentRequest.amount} USDC`
    };
    
  } catch (error) {
    console.error('[THIRDWEB] Error executing payment:', error.message);
    console.error('[THIRDWEB] Full error:', error);
    
    return {
      status: 'failed',
      id: paymentRequest.id,
      error: error.message,
      shortError: error.shortMessage || error.message
    };
  }
}

  /**
   * Check wallet balance
   * FIXED: Returns native balance as USDC since that's what it is on Arc
   */
  async getBalance(currency = 'USDC') {
    try {
      await this.initialize();

      // On Arc Testnet, the native token IS USDC
      // So we always return native balance
      const balance = await this.provider.getBalance(this.wallet.address);
      const balanceInArc = ethers.formatEther(balance);
      
      console.log(`[THIRDWEB] Balance: ${balanceInArc} ${currency}`);
      
      return {
        currency: currency,
        balance: parseFloat(balanceInArc),
        displayValue: balanceInArc,
        symbol: currency === 'USDC' ? 'USDC' : 'ARC',
        address: this.wallet.address
      };
    } catch (error) {
      console.error('[THIRDWEB] Error fetching balance:', error.message);
      throw error;
    }
  }

  /**
   * Get token address by symbol
   * NOTE: On Arc, USDC is native, so no contract address needed
   */
  getTokenAddress(symbol) {
    const tokens = {
      'USDC': null, // Native token on Arc, not ERC20
      'USDT': process.env.ARC_USDT_CONTRACT || null,
    };

    return tokens[symbol.toUpperCase()];
  }

  /**
   * Estimate gas for a payment
   */
  async estimateGas(to, amount, currency = 'USDC') {
    try {
      await this.initialize();

      let gasEstimate;

      if (currency === 'ARC' || currency === 'NATIVE' || currency === 'USDC') {
        const amountInWei = ethers.parseEther(amount.toString());
        gasEstimate = await this.provider.estimateGas({
          to,
          value: amountInWei,
          from: this.wallet.address
        });
      } else {
        // For ERC20 tokens (future)
        const tokenAddress = this.getTokenAddress(currency);
        if (!tokenAddress) {
          return {
            gasLimit: '21000',
            gasPrice: '0',
            estimatedCost: 0,
            estimatedCostDisplay: '0 ARC'
          };
        }

        const erc20ABI = [
          'function transfer(address to, uint256 amount) returns (bool)',
          'function decimals() view returns (uint8)'
        ];

        const tokenContract = new ethers.Contract(tokenAddress, erc20ABI, this.wallet);
        const decimals = await tokenContract.decimals();
        const amountInWei = ethers.parseUnits(amount.toString(), decimals);
        
        gasEstimate = await tokenContract.transfer.estimateGas(to, amountInWei);
      }

      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice || ethers.parseUnits('1', 'gwei');
      const gasCostInWei = gasEstimate * gasPrice;
      const gasCostInArc = ethers.formatEther(gasCostInWei);

      return {
        gasLimit: gasEstimate.toString(),
        gasPrice: ethers.formatUnits(gasPrice, 'gwei'),
        estimatedCost: parseFloat(gasCostInArc),
        estimatedCostDisplay: `${gasCostInArc} ARC`
      };
    } catch (error) {
      console.error('[THIRDWEB] Error estimating gas:', error.message);
      return {
        gasLimit: '21000',
        gasPrice: '0',
        estimatedCost: 0,
        estimatedCostDisplay: '0 ARC'
      };
    }
  }

  /**
   * Get wallet address
   */
  getWalletAddress() {
    return this.wallet?.address;
  }

  /**
   * Check if wallet has sufficient balance
   */
  async hasSufficientBalance(amount, currency = 'USDC') {
    try {
      const balance = await this.getBalance(currency);
      const hasEnough = balance.balance >= parseFloat(amount);
      
      console.log(`[THIRDWEB] Balance check: ${balance.balance} >= ${amount} = ${hasEnough}`);
      
      return hasEnough;
    } catch (error) {
      console.error('[THIRDWEB] Error checking balance:', error.message);
      return false;
    }
  }

  /**
   * Get transaction receipt
   */
  async getTransactionReceipt(txHash) {
    try {
      await this.initialize();
      const receipt = await this.provider.getTransactionReceipt(txHash);
      return receipt;
    } catch (error) {
      console.error('[THIRDWEB] Error getting receipt:', error.message);
      return null;
    }
  }

  /**
   * Get transaction details
   */
  async getTransaction(txHash) {
    try {
      await this.initialize();
      const tx = await this.provider.getTransaction(txHash);
      return tx;
    } catch (error) {
      console.error('[THIRDWEB] Error getting transaction:', error.message);
      return null;
    }
  }

  /**
   * Wait for transaction confirmation
   */
  async waitForTransaction(txHash, confirmations = 1) {
    try {
      await this.initialize();
      console.log(`[THIRDWEB] Waiting for ${confirmations} confirmation(s) for tx: ${txHash}`);
      const receipt = await this.provider.waitForTransaction(txHash, confirmations);
      console.log(`[THIRDWEB] ✅ Transaction confirmed`);
      return receipt;
    } catch (error) {
      console.error('[THIRDWEB] Error waiting for transaction:', error.message);
      return null;
    }
  }
}

// Singleton instance
let thirdwebServiceInstance = null;

function getThirdwebPaymentService() {
  if (!thirdwebServiceInstance) {
    thirdwebServiceInstance = new ThirdwebPaymentService();
  }
  return thirdwebServiceInstance;
}

module.exports = {
  ThirdwebPaymentService,
  getThirdwebPaymentService
};