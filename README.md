# Bitcoin-MarsCoin Atomic Swap Platform

A trustless, decentralized platform that enables users to swap Bitcoin for MarsCoin using atomic swaps with Hashed Timelock Contracts (HTLCs).

## Project Description

This project provides a secure mechanism for atomic swaps between Bitcoin and MarsCoin blockchains. The platform ensures security through cryptographic mechanisms that guarantee either both transactions complete successfully or both are refunded, without requiring trust in a centralized entity.

The primary use case is for service providers who own MarsCoin to facilitate exchanges with customers who want to trade their Bitcoin for MarsCoin, though it supports swaps in both directions.

## How It Works

The atomic swap uses Hashed Timelock Contracts (HTLCs) on both blockchains:

1. A secret preimage is generated along with its SHA256 hash
2. Two HTLCs are created:
   - The Bitcoin HTLC: Customer locks BTC, Provider can claim with the preimage
   - The MarsCoin HTLC: Provider locks MarsCoin, Customer can claim with the preimage
3. The provider reveals the preimage by claiming the Bitcoin, which allows the customer to claim the MarsCoin
4. If the swap doesn't complete, timelocks ensure both parties can reclaim their funds after a timeout period

## Features

- Trustless atomic swaps between Bitcoin and MarsCoin
- Command-line interface for managing swaps
- Secure implementation of Hashed Timelock Contracts (HTLCs)
- Support for mainnet and testnet
- Automatic verification of transaction confirmations
- Timelock-based refund mechanism
- Configuration options for RPC connections, fees, and confirmation requirements

## Installation

```bash
# Clone the repository
git clone https://github.com/novalis78/btc-mars-bridge.git
cd btc-mars-bridge

# Install dependencies
npm install

# Make the CLI executable
chmod +x bin/btc-mars-swap

# Optional: Install globally
npm link
```

## Configuration

On first run, a default configuration file will be created at `~/.btc-mars-bridge/config.json`. You can edit this file directly or use the CLI to configure settings:

```json
{
  "bitcoin": {
    "network": "testnet",
    "rpc": {
      "host": "127.0.0.1",
      "port": 18332,
      "username": "",
      "password": ""
    },
    "confirmations": 1,
    "timeoutDuration": 7200,
    "fee": 1000
  },
  "marscoin": {
    "network": "testnet",
    "rpc": {
      "host": "127.0.0.1",
      "port": 18555,
      "username": "",
      "password": ""
    },
    "confirmations": 1,
    "timeoutDuration": 3600,
    "fee": 0.0001
  },
  "app": {
    "dataDir": "~/.btc-mars-bridge",
    "swapDatabase": "swaps.json",
    "logLevel": "info",
    "port": 3000
  }
}
```

## Usage

### Command Line Interface

```bash
# Run the CLI
npm run cli

# Or if installed globally
btc-mars-swap
```

### Swap Workflow for a Service Provider (Owner of MarsCoin)

1. **Initiate a new swap**
   - Enter your Bitcoin and MarsCoin addresses
   - Enter customer's Bitcoin and MarsCoin addresses
   - Specify Bitcoin amount (in satoshis) and MarsCoin amount
   - The system will generate Bitcoin and MarsCoin HTLC addresses

2. **Fund the MarsCoin HTLC**
   - Send MarsCoin to the generated MarsCoin HTLC address
   - Wait for the customer to send Bitcoin to the Bitcoin HTLC address

3. **Verify funding**
   - Check swap status to ensure both HTLCs are properly funded
   - Ensure transactions have the required number of confirmations

4. **Complete the swap**
   - Use the "Complete swap" option to claim the Bitcoin, revealing the preimage
   - The customer can then use the preimage to claim the MarsCoin

5. **Refund (if needed)**
   - If the swap doesn't complete, you can use the refund option once the timelock expires
   - This will return your MarsCoin to your original address

### Programmatic API

```javascript
const { swapCoordinator } = require('btc-mars-bridge');
const bitcoin = require('bitcoinjs-lib');

// Initialize a swap
const swap = await swapCoordinator.initiateSwap({
  initiatorBtcAddress: 'your-btc-address',
  initiatorMarscoinAddress: 'your-marscoin-address',
  participantBtcAddress: 'customer-btc-address',
  participantMarscoinAddress: 'customer-marscoin-address',
  btcAmount: 100000, // satoshis
  marscoinAmount: 10.0,
  timeoutDuration: 3600, // 1 hour in seconds
  bitcoinNetwork: bitcoin.networks.testnet,
  marscoinNetwork: { name: 'marscoin-testnet' }
});

console.log(`Swap initiated with ID: ${swap.id}`);
console.log(`Bitcoin HTLC Address: ${swap.btcHtlc.address}`);
console.log(`MarsCoin HTLC Address: ${swap.marscoinHtlc.address}`);

// Verify funding status
const fundingStatus = await swapCoordinator.verifySwapFunding(
  swap, 
  btcClient, 
  marscoinClient,
  2, // Bitcoin confirmations required
  2  // MarsCoin confirmations required
);

if (fundingStatus.funded) {
  console.log("Swap is fully funded and confirmed!");
}

// Complete the swap (as the MarsCoin provider)
const claimResult = await swapCoordinator.completeSwap(
  swap,
  btcClient,
  marscoinClient,
  {
    initiatorBtcPrivateKey: 'your-btc-private-key',
    btcFee: 1000
  }
);

if (claimResult.success) {
  console.log(`Successfully claimed Bitcoin! Preimage is now public: ${claimResult.preimage}`);
}
```

## Security Considerations

- **Private Keys**: Never share your private keys or include them in code repositories.
- **Confirmations**: Ensure you wait for sufficient blockchain confirmations before considering a transaction final.
- **Timelocks**: The Bitcoin timelock is set to be longer than the MarsCoin timelock to prevent situations where the refund periods overlap in a way that could cause loss of funds.
- **Public Networks**: Be cautious when using this on public networks; always start with testnet and small amounts.

## License

ISC License