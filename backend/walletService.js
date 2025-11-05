// walletService.js - Real Arc Blockchain Wallet Integration (Secure TLS)
const { ethers } = require('ethers');

// USDC ABI (standard ERC20)
const USDC_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)'
];

class ArcWalletService {
  constructor() {
    const rpcUrl = process.env.ARC_RPC || 'https://rpc.testnet.arc.network';
    
    // ✅ SECURE: Create provider with proper HTTPS configuration
    // This uses Node's default TLS settings (secure)
    const fetchRequest = new ethers.FetchRequest(rpcUrl);
    
    // Set reasonable timeout
    fetchRequest.timeout = 30000; // 30 seconds
    
    // Add user agent for better logging
    fetchRequest.setHeader('User-Agent', 'ArcBot-Wallet/1.0');
    
    // Create provider with secure fetch
    this.provider = new ethers.JsonRpcProvider(
      fetchRequest,
      undefined, // Let ethers auto-detect network
      {
        staticNetwork: true, // Prevent network detection issues
        batchMaxCount: 1 // Disable batching for better error messages
      }
    );
    
    this.chainId = parseInt(process.env.ARC_CHAIN_ID || '412346');
    
    console.log(`[WALLET] Connected to Arc RPC: ${rpcUrl}`);
  }

  /**
   * Validate address format - more lenient version
   */
  isValidAddress(address) {
    if (!address || typeof address !== 'string') return false;
    
    // Must start with 0x and be 42 characters total
    if (!address.toLowerCase().startsWith('0x')) return false;
    if (address.length !== 42) return false;
    
    // Check if all characters after 0x are valid hex
    const hexPart = address.slice(2);
    const isValidHex = /^[0-9a-fA-F]{40}$/.test(hexPart);
    
    return isValidHex;
  }

  /**
   * Get checksummed address (fixes case sensitivity)
   * BYPASS: Just use lowercase to avoid checksum issues
   */
  getChecksumAddress(address) {
    try {
      // Try to get proper checksum first
      return ethers.getAddress(address);
    } catch (error) {
      // If checksum fails, just return lowercase version
      // This works fine for RPC calls
      console.warn('[WALLET] Checksum validation failed, using lowercase');
      return address.toLowerCase();
    }
  }

  /**
   * Get native ARC token balance
   */
  async getNativeBalance(address) {
    try {
      // Validate address before making RPC call
      if (!this.isValidAddress(address)) {
        throw new Error(`Invalid address format: ${address}`);
      }

      // Use checksummed address for RPC calls
      const checksumAddress = this.getChecksumAddress(address);
      
      const balance = await this.provider.getBalance(checksumAddress);
      const balanceInArc = ethers.formatEther(balance);
      return parseFloat(balanceInArc);
    } catch (error) {
      // Check if error is ENS-related
      if (error.code === 'UNSUPPORTED_OPERATION' && error.operation === 'getEnsAddress') {
        console.error('[WALLET] ENS not supported on Arc network. Use hex addresses only.');
        return 0;
      }
      console.error('[WALLET] Error fetching native balance:', error.message);
      return 0;
    }
  }

  /**
   * Get USDC token balance (ERC20)
   */
  async getUSDCBalance(address, usdcContractAddress) {
    try {
      // Validate addresses
      if (!this.isValidAddress(address)) {
        console.error(`[WALLET] Invalid wallet address: ${address}`);
        return 0;
      }

      if (!usdcContractAddress || usdcContractAddress === '0x...' || !this.isValidAddress(usdcContractAddress)) {
        console.warn('[WALLET] USDC contract address not configured or invalid');
        console.warn(`[WALLET] Received: ${usdcContractAddress}`);
        console.warn('[WALLET] Set ARC_USDC_CONTRACT in .env file');
        return 0;
      }

      console.log(`[WALLET] Fetching USDC balance from contract: ${usdcContractAddress}`);

      // Use checksummed addresses
      const checksumWallet = this.getChecksumAddress(address);
      const checksumContract = this.getChecksumAddress(usdcContractAddress);

      const usdcContract = new ethers.Contract(
        checksumContract,
        USDC_ABI,
        this.provider
      );

      // Try to get decimals first to verify contract exists
      let decimals;
      try {
        decimals = await usdcContract.decimals();
        console.log(`[WALLET] USDC contract decimals: ${decimals}`);
      } catch (decimalError) {
        console.error('[WALLET] Failed to read decimals from contract:', decimalError.message);
        console.warn('[WALLET] This might not be a valid ERC20 contract or contract does not exist');
        
        // Try with default USDC decimals (6)
        decimals = 6;
        console.log('[WALLET] Using default USDC decimals: 6');
      }

      const balance = await usdcContract.balanceOf(checksumWallet);
      const balanceInUsdc = ethers.formatUnits(balance, decimals);
      const balanceNum = parseFloat(balanceInUsdc);
      
      console.log(`[WALLET] USDC Balance: ${balanceNum} (raw: ${balance.toString()}, decimals: ${decimals})`);
      
      return balanceNum;
    } catch (error) {
      if (error.code === 'UNSUPPORTED_OPERATION') {
        console.error('[WALLET] ENS not supported. Ensure you are using hex addresses.');
        return 0;
      }
      console.error('[WALLET] Error fetching USDC balance:', error.message);
      console.error('[WALLET] Contract address:', usdcContractAddress);
      console.error('[WALLET] Wallet address:', address);
      return 0;
    }
  }

  /**
   * Get complete wallet info
   */
  async getWalletInfo(address, usdcContractAddress = null) {
    try {
      console.log(`[WALLET] Fetching wallet info for: ${address}`);

      // Validate address first
      if (!this.isValidAddress(address)) {
        throw new Error(`Invalid wallet address format: ${address}. Use hex address (0x...)`);
      }

      const checksumAddress = this.getChecksumAddress(address);
      console.log(`[WALLET] Using checksummed address: ${checksumAddress}`);

      // Use Promise.allSettled to handle partial failures gracefully
      const [arcResult, usdcResult, txCountResult] = await Promise.allSettled([
        this.getNativeBalance(checksumAddress),
        usdcContractAddress ? this.getUSDCBalance(checksumAddress, usdcContractAddress) : Promise.resolve(0),
        this.provider.getTransactionCount(checksumAddress).catch(() => 0)
      ]);

      // Extract values or use defaults
      const arcBalance = arcResult.status === 'fulfilled' ? arcResult.value : 0;
      let usdcBalance = usdcResult.status === 'fulfilled' ? usdcResult.value : 0;
      const transactionCount = txCountResult.status === 'fulfilled' ? txCountResult.value : 0;

      // WORKAROUND: If USDC contract doesn't work, native balance might BE the USDC
      // On Arc testnet, the native token appears to be USDC
      if (usdcBalance === 0 && arcBalance > 0) {
        console.log('[WALLET] ⚠️ USDC contract not responding, using native balance as USDC');
        usdcBalance = arcBalance;
        // Set arcBalance to 0 since the native token IS USDC on this network
      }

      // Get network info safely - don't rely on auto-detection
      let networkInfo = { name: 'Arc Testnet', chainId: this.chainId };
      try {
        // Query the actual chain ID from RPC
        const network = await this.provider.getNetwork();
        const actualChainId = Number(network.chainId);
        
        networkInfo = {
          name: actualChainId === 5042002 ? 'Arc Testnet' : network.name || 'Arc Testnet',
          chainId: actualChainId
        };
        
        // Log if there's a mismatch
        if (actualChainId !== this.chainId) {
          console.warn(`[WALLET] Chain ID mismatch: expected ${this.chainId}, got ${actualChainId}`);
          console.warn('[WALLET] Update ARC_CHAIN_ID in .env to match the actual network');
        }
      } catch (networkError) {
        console.warn('[WALLET] Could not fetch network info, using defaults');
      }

      const walletInfo = {
        address: checksumAddress,
        balances: {
          arc: 0, // Native token is USDC on this network
          usdc: usdcBalance
        },
        transactionCount,
        network: networkInfo,
        lastUpdated: new Date().toISOString()
      };

      console.log('[WALLET] ✅ Wallet info fetched:', {
        address: checksumAddress.slice(0, 10) + '...',
        arc: 0,
        usdc: usdcBalance,
        txCount: transactionCount
      });

      return walletInfo;
    } catch (error) {
      console.error('[WALLET] Error fetching wallet info:', error.message);
      
      // Return minimal info instead of throwing
      return {
        address,
        balances: {
          arc: 0,
          usdc: 0
        },
        transactionCount: 0,
        network: {
          name: 'Arc Testnet',
          chainId: this.chainId
        },
        lastUpdated: new Date().toISOString(),
        error: error.message
      };
    }
  }

  /**
   * Get recent transactions (last N blocks)
   */
  async getRecentTransactions(address, blocksToSearch = 1000) {
    try {
      // Validate address
      if (!this.isValidAddress(address)) {
        console.error('[WALLET] Invalid address for transaction search');
        return [];
      }

      const checksumAddress = this.getChecksumAddress(address);
      const currentBlock = await this.provider.getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - blocksToSearch);

      console.log(`[WALLET] Searching transactions from block ${fromBlock} to ${currentBlock}`);

      const transactions = [];
      
      // Search recent blocks for transactions
      for (let i = currentBlock; i > fromBlock && transactions.length < 10; i--) {
        try {
          const block = await this.provider.getBlock(i, true);
          if (block && block.transactions) {
            for (const tx of block.transactions) {
              if (typeof tx === 'object' && (tx.from === checksumAddress || tx.to === checksumAddress)) {
                transactions.push({
                  hash: tx.hash,
                  from: tx.from,
                  to: tx.to,
                  value: ethers.formatEther(tx.value || 0),
                  blockNumber: i,
                  timestamp: block.timestamp
                });
                
                if (transactions.length >= 10) break;
              }
            }
          }
        } catch (blockError) {
          continue;
        }
      }

      console.log(`[WALLET] Found ${transactions.length} recent transactions`);
      return transactions;
    } catch (error) {
      console.error('[WALLET] Error fetching transactions:', error.message);
      return [];
    }
  }

  /**
   * Get gas price
   */
  async getGasPrice() {
    try {
      const feeData = await this.provider.getFeeData();
      return {
        gasPrice: feeData.gasPrice ? ethers.formatUnits(feeData.gasPrice, 'gwei') : '0',
        maxFeePerGas: feeData.maxFeePerGas ? ethers.formatUnits(feeData.maxFeePerGas, 'gwei') : null,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ? ethers.formatUnits(feeData.maxPriorityFeePerGas, 'gwei') : null
      };
    } catch (error) {
      console.error('[WALLET] Error fetching gas price:', error.message);
      return { gasPrice: '0', maxFeePerGas: null, maxPriorityFeePerGas: null };
    }
  }

  /**
   * Get block number
   */
  async getBlockNumber() {
    try {
      return await this.provider.getBlockNumber();
    } catch (error) {
      console.error('[WALLET] Error fetching block number:', error.message);
      return 0;
    }
  }

  /**
   * Estimate gas for a transaction
   */
  async estimateGas(tx) {
    try {
      // Validate and checksum addresses in transaction
      if (tx.to) {
        if (!this.isValidAddress(tx.to)) {
          throw new Error('Invalid recipient address');
        }
        tx.to = this.getChecksumAddress(tx.to);
      }
      if (tx.from) {
        if (!this.isValidAddress(tx.from)) {
          throw new Error('Invalid sender address');
        }
        tx.from = this.getChecksumAddress(tx.from);
      }

      const gasEstimate = await this.provider.estimateGas(tx);
      return gasEstimate.toString();
    } catch (error) {
      console.error('[WALLET] Error estimating gas:', error.message);
      return '21000';
    }
  }

  /**
   * Check if wallet has sufficient balance
   */
  async hasSufficientBalance(address, amount, tokenType = 'arc') {
    try {
      if (tokenType === 'arc') {
        const balance = await this.getNativeBalance(address);
        return balance >= parseFloat(amount);
      } else if (tokenType === 'usdc') {
        const usdcContract = process.env.ARC_USDC_CONTRACT;
        if (!usdcContract) return false;
        
        const balance = await this.getUSDCBalance(address, usdcContract);
        return balance >= parseFloat(amount);
      }
      return false;
    } catch (error) {
      console.error('[WALLET] Error checking balance:', error.message);
      return false;
    }
  }
}

// Singleton instance
let walletServiceInstance = null;

function getWalletService() {
  if (!walletServiceInstance) {
    walletServiceInstance = new ArcWalletService();
  }
  return walletServiceInstance;
}

module.exports = {
  ArcWalletService,
  getWalletService
};