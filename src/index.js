/**
 * Bitcoin to MarsCoin Atomic Swap Platform
 * Main entry point for the application
 */

// Import core modules
const swapCoordinator = require('./core/swap-coordinator');
const bitcoinHtlc = require('./core/bitcoin-htlc');
const marscoinHtlc = require('./core/marscoin-htlc');

// Import config
const config = require('./config');

// Export the API for programmatic use
module.exports = {
  swapCoordinator,
  bitcoinHtlc,
  marscoinHtlc,
  config
};