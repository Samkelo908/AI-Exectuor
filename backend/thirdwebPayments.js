// thirdwebPayments.js - Thirdweb v5 Integration for Arc (ethers v6 compatible)
const { ethers } = require("ethers");

/**
 * Thirdweb-style Payment Service for Arc using ethers v6
 * Enables AI agents to make autonomous payments
 */
class ThirdwebPaymentService {
  constructor() {
    this.provider = null;
    this.wallet = null;
    this.chainId = parseInt(process.env.ARC_CHAIN_ID || '412346');
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

      // Validate recipient address
      if (!ethers.isAddress(to)) {
        throw new Error(`Invalid recipient address: ${to}`);
      }

      const paymentRequest = {
        id: `pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        from: this.wallet.address,
        to,
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
   */
  async executePayment(paymentRequest) {
    try {
      await this.initialize();

      const { to, amount, currency } = paymentRequest;

      console.log(`[THIRDWEB] Executing payment: ${amount} ${currency} to ${to}`);

      let tx;

      if (currency === 'ARC' || currency === 'NATIVE') {
        // Native token transfer
        const amountInWei = ethers.parseEther(amount.toString());
        tx = await this.wallet.sendTransaction({
          to,
          value: amountInWei
        });
        console.log(`[THIRDWEB] Native transfer tx: ${tx.hash}`);
      } else {
        // ERC20 token transfer (USDC)
        const tokenAddress = this.getTokenAddress(currency);
        
        if (!tokenAddress) {
          throw new Error(`Token ${currency} not supported`);
        }

        // ERC20 ABI for transfer
        const erc20ABI = [
          'function transfer(address to, uint256 amount) returns (bool)',
          'function decimals() view returns (uint8)',
          'function balanceOf(address) view returns (uint256)'
        ];

        const tokenContract = new ethers.Contract(tokenAddress, erc20ABI, this.wallet);
        const decimals = await tokenContract.decimals();
        const amountInWei = ethers.parseUnits(amount.toString(), decimals);
        
        tx = await tokenContract.transfer(to, amountInWei);
        console.log(`[THIRDWEB] Token transfer tx: ${tx.hash}`);
      }

      // Wait for confirmation
      const receipt = await tx.wait();

      const result = {
        ...paymentRequest,
        status: 'completed',
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        completedAt: new Date().toISOString(),
        explorerUrl: `https://testnet.arcscan.app/tx/${receipt.hash}`
      };

      console.log(`[THIRDWEB] ✅ Payment executed successfully`);
      
      return result;
    } catch (error) {
      console.error('[THIRDWEB] Error executing payment:', error.message);
      
      return {
        ...paymentRequest,
        status: 'failed',
        error: error.message,
        failedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Check wallet balance
   */
  async getBalance(currency = 'ARC') {
    try {
      await this.initialize();

      if (currency === 'ARC' || currency === 'NATIVE') {
        const balance = await this.provider.getBalance(this.wallet.address);
        const balanceInArc = ethers.formatEther(balance);
        
        return {
          currency: 'ARC',
          balance: parseFloat(balanceInArc),
          displayValue: balanceInArc,
          symbol: 'ARC',
          address: this.wallet.address
        };
      } else {
        // ERC20 token balance
        const tokenAddress = this.getTokenAddress(currency);
        
        if (!tokenAddress) {
          throw new Error(`Token ${currency} not supported`);
        }

        const erc20ABI = [
          'function balanceOf(address) view returns (uint256)',
          'function decimals() view returns (uint8)',
          'function symbol() view returns (string)'
        ];

        const tokenContract = new ethers.Contract(tokenAddress, erc20ABI, this.provider);
        const balance = await tokenContract.balanceOf(this.wallet.address);
        const decimals = await tokenContract.decimals();
        const symbol = await tokenContract.symbol();
        const balanceFormatted = ethers.formatUnits(balance, decimals);
        
        return {
          currency,
          balance: parseFloat(balanceFormatted),
          displayValue: balanceFormatted,
          symbol,
          address: this.wallet.address
        };
      }
    } catch (error) {
      console.error('[THIRDWEB] Error fetching balance:', error.message);
      throw error;
    }
  }

  /**
   * Get token address by symbol
   */
  getTokenAddress(symbol) {
    const tokens = {
      'USDC': process.env.ARC_USDC_CONTRACT || '0x3600000000000000000000000000000000000000',
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

      if (currency === 'ARC' || currency === 'NATIVE') {
        const amountInWei = ethers.parseEther(amount.toString());
        gasEstimate = await this.provider.estimateGas({
          to,
          value: amountInWei,
          from: this.wallet.address
        });
      } else {
        const tokenAddress = this.getTokenAddress(currency);
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
      return balance.balance >= parseFloat(amount);
    } catch (error) {
      console.error('[THIRDWEB] Error checking balance:', error.message);
      return false;
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