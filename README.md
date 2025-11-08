# 🤖 ArcBot AI - Intelligent Cryptocurrency Payment Assistant

<div align="center">

![ArcBot AI](https://img.shields.io/badge/ArcBot-AI%20Powered-00D4FF?style=for-the-badge&logo=ethereum&logoColor=white)
![Version](https://img.shields.io/badge/version-1.0.0-blue?style=for-the-badge)
![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)
![Arc Blockchain](https://img.shields.io/badge/Arc-Testnet-purple?style=for-the-badge)

**Voice-Activated AI Assistant for Blockchain Payments**

[Features](#-features) • [Demo](#-demo) • [Installation](#-installation) • [Documentation](#-documentation) • [Contributing](#-contributing)

</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Key Features](#-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Getting Started](#-getting-started)
- [Configuration](#-configuration)
- [API Documentation](#-api-documentation)
- [Smart Contract](#-smart-contract)
- [Security](#-security)
- [Cross-Border Remittances](#-cross-border-remittances)
- [Deployment](#-deployment)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🌟 Overview

**ArcBot AI** is a sophisticated, voice-activated cryptocurrency payment platform that combines conversational AI, blockchain technology, and intelligent automation. Built on the Arc blockchain testnet, it enables users to execute payments, schedule transactions, and send cross-border remittances using natural language commands.

### Why ArcBot?

- 🎤 **Voice-First Interface** - Control payments hands-free with natural speech
- 🧠 **AI-Powered Memory** - Remembers your payment history and preferences
- 🔐 **Enterprise Security** - Multi-layer fraud detection and risk scoring
- 🌍 **Global Remittances** - Send to 7 African countries with minimal fees (1.5% vs 5-10%)
- ⚡ **Real-Time Execution** - Instant payments with blockchain transparency
- 📅 **Smart Scheduling** - One-time and recurring payment automation

---

## ✨ Features

### Core Capabilities

#### 🎙️ Voice-Activated Payments
- **Always-On Listening** - Continuous voice recognition without wake words
- **Natural Language Processing** - Understands conversational payment requests
- **Real-Time Feedback** - Visual and audio confirmation of commands
- **Browser-Based** - No additional software required

#### 💰 Payment Management
- **Instant Transfers** - Send USDC on Arc blockchain in seconds
- **Payment Scheduling** - Schedule one-time or recurring payments
- **Saved Recipients** - Quick access to frequent contacts
- **Transaction History** - Complete audit trail with blockchain verification

#### 🧠 AI Memory System
- **Contextual Awareness** - Remembers past 30 days of transactions
- **Spending Analytics** - Track patterns and frequent recipients
- **Temporal Queries** - "What did I spend last Friday?"
- **Smart Suggestions** - Learns your payment habits

#### 🌍 Cross-Border Remittances
Support for **7 African Countries**:
- 🇰🇪 **Kenya** (KES) - M-Pesa integration
- 🇳🇬 **Nigeria** (NGN) - Bank transfers
- 🇿🇦 **South Africa** (ZAR) - Instant EFT
- 🇬🇭 **Ghana** (GHS) - Mobile money
- 🇺🇬 **Uganda** (UGX) - Mobile money
- 🇹🇿 **Tanzania** (TZS) - M-Pesa
- 🇷🇼 **Rwanda** (RWF) - MTN Mobile Money

**Benefits:**
- 💸 **Low Fees**: 1.5% vs traditional 5-10%
- ⚡ **Fast Delivery**: 5-15 minutes vs 1-3 days
- 📱 **Direct to Mobile**: No bank account needed
- 💱 **Real-Time Rates**: Live exchange rate updates

#### 🔐 Security Features
- **AI-Powered Fraud Detection** - Real-time risk scoring
- **Transaction Limits** - Configurable daily/single transaction caps
- **Velocity Checks** - Detect unusual spending patterns
- **Blacklist Screening** - Block known malicious addresses
- **2FA Support** - Additional verification for high-risk transactions
- **Audit Trail** - Immutable on-chain decision logging

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │   AI Face    │  │ Voice Input  │  │ Chat UI      │ │
│  │  Animation   │  │ Web Speech   │  │ Dashboard    │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└────────────────────────┬────────────────────────────────┘
                         │ REST API
┌────────────────────────▼────────────────────────────────┐
│              Backend (Node.js + Express)                │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Payment Engine  │  AI Chat  │  Scheduler       │  │
│  │  Thirdweb x402   │  Memory   │  Firebase        │  │
│  └──────────────────────────────────────────────────┘  │
└──┬──────────┬──────────┬──────────┬────────────┬───────┘
   │          │          │          │            │
   ▼          ▼          ▼          ▼            ▼
┌─────┐  ┌─────────┐ ┌──────┐ ┌─────────┐ ┌──────────┐
│ Arc │  │Cloudflare│ │Firebase│ │Security │ │ElevenLabs│
│Testnet  │ AI      │ │Firestore│ │Monitor │ │   TTS    │
└─────┘  └─────────┘ └──────┘ └─────────┘ └──────────┘
```

### Component Overview

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Frontend** | React 18 + TypeScript | User interface with 3D animations |
| **Backend API** | Node.js + Express | Payment processing & orchestration |
| **AI Engine** | Cloudflare Workers AI | Natural language understanding |
| **Blockchain** | Arc Testnet + Solidity | Transaction execution & logging |
| **Database** | Firebase Firestore | User data & scheduling |
| **Payment Rails** | Thirdweb x402 | Blockchain payment abstraction |
| **Voice** | Web Speech API | Voice recognition |
| **TTS** | ElevenLabs | Text-to-speech synthesis |

---

## 🛠️ Tech Stack

### Frontend
- **React 18** - Modern UI framework
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Utility-first styling
- **Lucide React** - Beautiful icons
- **Web Speech API** - Voice recognition
- **Web Audio API** - Lip-sync animation

### Backend
- **Node.js 18+** - JavaScript runtime
- **Express.js** - Web framework
- **Ethers.js** - Blockchain interaction
- **Axios** - HTTP client
- **Firebase Admin SDK** - Database & auth

### Blockchain
- **Solidity ^0.8.30** - Smart contract language
- **Arc Blockchain** - Layer 2 testnet
- **Thirdweb x402** - Payment infrastructure
- **USDC** - Stablecoin payments

### AI & Services
- **Cloudflare Workers AI** - LLM inference
- **ElevenLabs** - Voice synthesis
- **Firebase Firestore** - Real-time database
- **Firebase Cloud Functions** - Scheduled jobs

---

## 🚀 Getting Started

### Prerequisites

```bash
# Required
Node.js >= 18.0.0
npm >= 8.0.0 or yarn >= 1.22.0

# Optional
Firebase CLI (for deployment)
Git
```

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/arcbot-ai.git
cd arcbot-ai
```

2. **Install dependencies**
```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

3. **Configure environment variables**

Create `.env` in the backend directory:

```env
# Wallet Configuration
USER_WALLET_ADDRESS=0xYourWalletAddress
ARC_USDC_CONTRACT=0x3C3380cdFb94dFEEaA41cAD9F58254AE380d752D

# Cloudflare AI
CLOUDFLARE_WORKER_URL=https://your-worker.workers.dev

# Firebase
FIREBASE_CREDENTIALS_PATH=./firebase-credentials.json

# Blockchain
DECISION_CONTRACT_ADDRESS=0xYourContractAddress
PRIVATE_KEY=0xYourPrivateKey

# API Services
ELEVENLABS_KEY=sk_your_key_here

# Server
PORT=4000
CORS_ORIGIN=http://localhost:3000
```

4. **Set up Firebase**
- Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
- Enable Firestore Database
- Download service account credentials
- Save as `firebase-credentials.json` in backend directory

5. **Deploy Smart Contract (optional)**
```bash
cd contracts
npx hardhat compile
npx hardhat run scripts/deploy.js --network arc-testnet
```

6. **Start the application**

```bash
# Terminal 1 - Backend
cd backend
npm run dev

# Terminal 2 - Frontend
cd frontend
npm start
```

7. **Access the application**
- Open browser to `http://localhost:3000`
- Allow microphone access for voice features

---

## ⚙️ Configuration

### Firebase Setup

1. **Firestore Collections**
```javascript
// Required collections
- scheduled_payments
- payment_history
- saved_transfers
- security_alerts
- security_checks
```

2. **Security Rules**
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /scheduled_payments/{payment} {
      allow read, write: if request.auth != null;
    }
    match /payment_history/{history} {
      allow read: if request.auth != null;
      allow write: if false; // Server-only
    }
  }
}
```

### Cloudflare Worker Deployment

```bash
# Deploy AI chat worker
cd cloudflare-worker
wrangler publish
```

### Smart Contract Deployment

```solidity
// Deploy to Arc testnet
npx hardhat run scripts/deploy.js --network arc-testnet

// Verify contract
npx hardhat verify --network arc-testnet DEPLOYED_ADDRESS
```

---

## 📚 API Documentation

### Core Endpoints

#### User Profile
```http
GET /api/me
```
Returns wallet balance, address, and user preferences.

**Response:**
```json
{
  "id": "demo-user",
  "wallet": {
    "address": "0x...",
    "balance": 100.50,
    "arcBalance": 5.25,
    "transactionCount": 42
  },
  "agent": {
    "personality": "balanced",
    "dailyLimit": 500
  }
}
```

#### Execute Payment
```http
POST /api/thirdweb/payment/send
Content-Type: application/json

{
  "to": "0xRecipientAddress",
  "amount": 10.50,
  "currency": "USDC",
  "description": "Payment for services"
}
```

**Response:**
```json
{
  "success": true,
  "txHash": "0x...",
  "explorerUrl": "https://...",
  "newBalance": 90.00
}
```

#### AI Chat
```http
POST /api/chat
Content-Type: application/json
X-User-ID: demo-user

{
  "messages": [
    {
      "role": "user",
      "content": "Send 0.001 USDC to 0x64EE..."
    }
  ]
}
```

**Response:** Server-Sent Events (SSE)
```
data: {"content": "I'll prepare"}
data: {"content": " that payment"}
data: [DONE]
```

#### Schedule Payment
```http
POST /api/scheduler/schedule
Content-Type: application/json
X-User-ID: demo-user

{
  "payee": "0x...",
  "amount": 50,
  "currency": "USDC",
  "scheduledDate": "2025-11-15T10:00:00Z",
  "recurring": {
    "enabled": true,
    "frequency": "monthly"
  }
}
```

### Remittance Endpoints

#### Get Exchange Rates
```http
GET /api/remittance/rates
```

#### Send Remittance
```http
POST /api/remittance/send
Content-Type: application/json

{
  "country": "Kenya",
  "countryCode": "KE",
  "recipientName": "Jane Doe",
  "phoneNumber": "+254712345678",
  "amount": 50,
  "currency": "USDC",
  "deliveryMethod": "mobile_money"
}
```

### Security Endpoints

#### Get Security Profile
```http
GET /api/security/profile
X-User-ID: demo-user
```

#### Get Security Alerts
```http
GET /api/security/alerts?limit=20
X-User-ID: demo-user
```

[View Full API Documentation →](./docs/API.md)

---

## 📜 Smart Contract

### ArcBotDecisionLogger.sol

The smart contract provides immutable logging of all AI payment decisions on the Arc blockchain.

#### Key Features
- **Decision Logging** - Records AI payment decisions
- **Status Tracking** - Updates decision status (LOGGED, EXECUTED, FAILED, CANCELLED)
- **Agent Management** - Authorization system for AI agents
- **Audit Trail** - Complete transaction history
- **IPFS Integration** - Detailed rationale stored on IPFS

#### Contract Functions

```solidity
// Log a new decision
function logDecision(
    string memory decisionId,
    string memory actionSummary,
    string memory rationaleCID,
    string memory txRef,
    uint256 totalAmount,
    uint8 riskScore
) external returns (bool)

// Update decision status
function updateDecisionStatus(
    string memory decisionId,
    DecisionStatus newStatus,
    string memory txRef
) external returns (bool)

// Query decision
function getDecision(string memory decisionId) 
    external view returns (Decision memory)

// Get agent statistics
function getAgentStats(address agent) 
    external view returns (
        uint256 totalDecisions,
        uint256 totalVolume,
        bool isAuthorized
    )
```

#### Deployment

```bash
# Compile
npx hardhat compile

# Deploy to Arc testnet
npx hardhat run scripts/deploy.js --network arc-testnet

# Verify
npx hardhat verify --network arc-testnet DEPLOYED_ADDRESS
```

[View Contract Source →](./contracts/ArcBotDecisionLogger.sol)

---

## 🔐 Security

### Multi-Layer Protection

#### 1. AI-Powered Fraud Detection
```javascript
const securityCheck = await securityMonitor.checkTransaction({
  userId: 'demo-user',
  recipient: '0x...',
  amount: 100,
  timestamp: Date.now()
});

// Returns: { recommendation: 'APPROVE|WARN|BLOCK', riskScore: 0.45 }
```

#### 2. Transaction Limits
- **Single Transaction**: 500 USDC (default)
- **Daily Volume**: 1,000 USDC (default)
- **Hourly Rate**: 10 transactions/hour

#### 3. Risk Scoring
```javascript
Risk Score = f(
  amount,
  velocity,
  recipient_reputation,
  user_history,
  blacklist_check
)

// 0.0 - 0.3: Low risk (auto-approve)
// 0.3 - 0.7: Medium risk (warn user)
// 0.7 - 1.0: High risk (require 2FA)
```

#### 4. Blacklist Screening
- Known scam addresses
- Sanctioned wallets
- Reported fraud addresses
- Real-time updates from security partners

#### 5. Velocity Monitoring
- Tracks transaction frequency
- Detects unusual patterns
- Rate limiting per user
- Automatic cooldown periods

### Best Practices

- 🔑 **Never commit private keys** - Use environment variables
- 🛡️ **Enable 2FA** - For high-risk transactions
- 📊 **Monitor alerts** - Review security dashboard regularly
- 🔄 **Update regularly** - Keep dependencies current
- 🔐 **Secure Firebase** - Use strict security rules

---

## 🌍 Cross-Border Remittances

### Supported Countries

| Country | Currency | Rate (per USDC) | Delivery Time | Methods |
|---------|----------|-----------------|---------------|---------|
| 🇰🇪 Kenya | KES | 129 | 5-15 min | M-Pesa, Bank |
| 🇳🇬 Nigeria | NGN | 1,550 | 30 min - 2hr | Bank, Mobile |
| 🇿🇦 South Africa | ZAR | 18.5 | 5-15 min | EFT, Bank |
| 🇬🇭 Ghana | GHS | 15.5 | 5-15 min | Mobile, Bank |
| 🇺🇬 Uganda | UGX | 3,700 | 5-15 min | Mobile, Bank |
| 🇹🇿 Tanzania | TZS | 2,500 | 5-15 min | M-Pesa, Bank |
| 🇷🇼 Rwanda | RWF | 1,350 | 5-15 min | MTN, Bank |

### Fee Comparison

| Service | Fee | Speed | Delivery |
|---------|-----|-------|----------|
| **ArcBot AI** | **1.5%** | **5-15 min** | **Direct to wallet** |
| Western Union | 5-10% | 1-3 days | Cash pickup |
| MoneyGram | 4-8% | 1-2 days | Cash pickup |
| Bank Wire | 3-5% | 2-5 days | Bank account |

### Example Usage

```javascript
// Voice command
"Arc, send $100 to my mom in Kenya"

// AI Response with remittance request
REMITTANCE_REQUEST: {
  "recipientName": "Mom",
  "country": "Kenya",
  "phoneNumber": "+254712345678",
  "amount": 100,
  "receiveAmount": 12900,
  "receiveCurrency": "KES",
  "exchangeRate": 129,
  "platformFee": 1.00,
  "networkFee": 0.25,
  "totalFees": 1.25,
  "deliveryMethod": "mobile_money"
}

// Mom receives 12,900 KES in 5-15 minutes
```

---

## 🚀 Deployment

### Frontend (Vercel)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
cd frontend
vercel --prod
```

### Backend (Railway / Render)

```bash
# Railway
railway login
railway init
railway up

# Or Render
# Connect GitHub repo at render.com
# Add environment variables
# Deploy automatically on push
```

### Cloudflare Worker

```bash
cd cloudflare-worker
wrangler publish
```

### Firebase Functions

```bash
firebase deploy --only functions
```

### Docker Deployment

```dockerfile
# Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 4000
CMD ["node", "server.js"]
```

```bash
# Build and run
docker build -t arcbot-backend .
docker run -p 4000:4000 --env-file .env arcbot-backend
```

---

## 🧪 Testing

### Run Tests

```bash
# Backend tests
cd backend
npm test

# Frontend tests
cd frontend
npm test

# Smart contract tests
cd contracts
npx hardhat test
```

### Test Coverage

```bash
# Generate coverage report
npm run test:coverage
```

### Manual Testing Checklist

- [ ] Voice recognition works in Chrome/Edge/Safari
- [ ] Payment execution completes successfully
- [ ] Scheduled payments trigger on time
- [ ] AI memory recalls past transactions
- [ ] Security alerts trigger for high-risk transactions
- [ ] Cross-border remittances calculate correct fees
- [ ] Blockchain logging records decisions
- [ ] TTS audio plays correctly

---

## 🤝 Contributing

We welcome contributions! Please follow these guidelines:

### Development Workflow

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/amazing-feature
   ```
3. **Make your changes**
4. **Write tests**
5. **Commit with conventional commits**
   ```bash
   git commit -m "feat: add amazing feature"
   ```
6. **Push to your fork**
   ```bash
   git push origin feature/amazing-feature
   ```
7. **Open a Pull Request**

### Commit Convention

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes
- `refactor:` - Code refactoring
- `test:` - Test additions/changes
- `chore:` - Maintenance tasks

### Code Style

- **ESLint** - JavaScript linting
- **Prettier** - Code formatting
- **TypeScript** - Type safety
- **Solhint** - Solidity linting

---

## 📖 Documentation

- [API Reference](./docs/API.md)
- [Architecture Guide](./docs/ARCHITECTURE.md)
- [Smart Contract Documentation](./docs/CONTRACTS.md)
- [Security Best Practices](./docs/SECURITY.md)
- [Deployment Guide](./docs/DEPLOYMENT.md)
- [Troubleshooting](./docs/TROUBLESHOOTING.md)

---

## 🐛 Known Issues

- Voice recognition requires HTTPS in production
- ElevenLabs TTS has rate limits (fallback to browser TTS)
- Arc testnet occasionally has network congestion
- Firebase Firestore quota limits on free tier

See [Issues](https://github.com/yourusername/arcbot-ai/issues) for full list.

---

## 🗺️ Roadmap

### Q1 2025
- [ ] Multi-language support (Spanish, French, Swahili)
- [ ] Mobile app (React Native)
- [ ] NFT transfer support
- [ ] Group payment splitting

### Q2 2025
- [ ] DeFi integration (swaps, staking)
- [ ] Mainnet deployment
- [ ] Advanced analytics dashboard
- [ ] Invoice generation

### Q3 2025
- [ ] AI-powered expense categorization
- [ ] Tax reporting tools
- [ ] Multi-chain support
- [ ] Enterprise features

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

```
MIT License

Copyright (c) 2025 ArcBot AI Team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction...
```


## 🙏 Acknowledgments

- [Arc Blockchain](https://arc.io) - Layer 2 infrastructure
- [Thirdweb](https://thirdweb.com) - Payment rails
- [Cloudflare](https://cloudflare.com) - AI inference
- [Firebase](https://firebase.google.com) - Backend services
- [ElevenLabs](https://elevenlabs.io) - Voice synthesis
- [OpenAI](https://openai.com) - AI research inspiration



## ⚠️ Disclaimer

This is experimental software. Use at your own risk. Always verify transactions before confirming. Never share your private keys. Test thoroughly on testnet before using with real funds.

---

<div align="center">

**Made with ❤️ by the ArcBot AI Team**

[⭐ Star us on GitHub](https://github.com/yourusername/arcbot-ai) • [🐦 Follow on Twitter](https://twitter.com/arcbotai) • [📖 Read the Docs](https://docs.arcbot.ai)

</div>
