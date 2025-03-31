# Bitcoin-MarsCoin Atomic Swap Platform

A trustless, decentralized platform that enables users to swap Bitcoin for MarsCoin using atomic swaps with Hashed Timelock Contracts (HTLCs).

## Project Description

This project provides a secure mechanism for atomic swaps between Bitcoin and MarsCoin blockchains. The platform ensures security through cryptographic mechanisms that guarantee either both transactions complete successfully or both are refunded, without requiring trust in a centralized entity.

## Features

- Trustless atomic swaps between Bitcoin and MarsCoin
- Command-line interface for managing swaps
- Secure implementation of Hashed Timelock Contracts (HTLCs)
- Support for mainnet and testnet
- Automatic verification of transaction confirmations
- Timelock-based refund mechanism

## Installation

```bash
# Clone the repository
git clone https://github.com/your-username/btc-mars-bridge.git
cd btc-mars-bridge

# Install dependencies
npm install

# Make the CLI executable
chmod +x bin/btc-mars-swap

# Optional: Install globally
npm link
```

## Usage

### Command Line Interface

```bash
# Run the CLI
npm run cli

# Or if installed globally
btc-mars-swap
```

### Programmatic API

```javascript
const { swapCoordinator } = require('btc-mars-bridge');

// Initialize a swap
const swap = await swapCoordinator.initiateSwap({
  initiatorBtcAddress: 'your-btc-address',
  participantMarscoinAddress: 'participant-marscoin-address',
  btcAmount: 100000, // satoshis
  marscoinAmount: 10.0
});

console.log(`Swap initiated with ID: ${swap.id}`);
console.log(`Bitcoin HTLC Address: ${swap.btcHtlc.address}`);
console.log(`MarsCoin HTLC Address: ${swap.marscoinHtlc.address}`);
```

## License

ISC License