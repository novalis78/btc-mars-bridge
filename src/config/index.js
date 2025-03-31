/**
 * Configuration Module
 * Handles loading and managing configuration for the application
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Default configuration
const defaultConfig = {
  // Bitcoin settings
  bitcoin: {
    network: 'testnet', // 'mainnet', 'testnet', 'regtest'
    rpc: {
      host: '127.0.0.1',
      port: 18332, // 8332 for mainnet, 18332 for testnet
      username: '',
      password: ''
    },
    confirmations: 1, // Required confirmations for swap
    timeoutDuration: 7200, // 2 hours in seconds
    fee: 1000, // Fee in satoshis
  },
  
  // MarsCoin settings
  marscoin: {
    network: 'testnet', // 'mainnet', 'testnet'
    rpc: {
      host: '127.0.0.1',
      port: 18555, // 8327 for mainnet, 18555 for testnet
      username: '',
      password: ''
    },
    confirmations: 1, // Required confirmations for swap
    timeoutDuration: 3600, // 1 hour in seconds
    fee: 0.0001, // Fee in MarsCoin
  },
  
  // Application settings
  app: {
    dataDir: path.join(os.homedir(), '.btc-mars-bridge'),
    swapDatabase: 'swaps.json',
    logLevel: 'info',
    port: 3000,
  }
};

// Configuration storage
let config = { ...defaultConfig };

/**
 * Load configuration from file
 */
function loadConfig(configPath) {
  // Default config path
  if (!configPath) {
    configPath = path.join(config.app.dataDir, 'config.json');
  }
  
  // Create default config directory if it doesn't exist
  if (!fs.existsSync(config.app.dataDir)) {
    fs.mkdirSync(config.app.dataDir, { recursive: true });
  }
  
  // Try to load existing config
  try {
    if (fs.existsSync(configPath)) {
      const loadedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config = {
        ...defaultConfig,
        ...loadedConfig,
        // Merge nested objects instead of replacing them
        bitcoin: { ...defaultConfig.bitcoin, ...loadedConfig.bitcoin },
        marscoin: { ...defaultConfig.marscoin, ...loadedConfig.marscoin },
        app: { ...defaultConfig.app, ...loadedConfig.app }
      };
      console.log(`Configuration loaded from ${configPath}`);
    } else {
      // Save default config if none exists
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
      console.log(`Default configuration saved to ${configPath}`);
    }
  } catch (error) {
    console.error(`Error loading configuration: ${error.message}`);
    console.log('Using default configuration');
  }
  
  return config;
}

/**
 * Save current configuration to file
 */
function saveConfig(configPath) {
  if (!configPath) {
    configPath = path.join(config.app.dataDir, 'config.json');
  }
  
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`Configuration saved to ${configPath}`);
    return true;
  } catch (error) {
    console.error(`Error saving configuration: ${error.message}`);
    return false;
  }
}

/**
 * Update configuration values
 */
function updateConfig(newConfig) {
  // Deep merge configuration
  if (newConfig.bitcoin) {
    config.bitcoin = { ...config.bitcoin, ...newConfig.bitcoin };
    if (newConfig.bitcoin.rpc) {
      config.bitcoin.rpc = { ...config.bitcoin.rpc, ...newConfig.bitcoin.rpc };
    }
  }
  
  if (newConfig.marscoin) {
    config.marscoin = { ...config.marscoin, ...newConfig.marscoin };
    if (newConfig.marscoin.rpc) {
      config.marscoin.rpc = { ...config.marscoin.rpc, ...newConfig.marscoin.rpc };
    }
  }
  
  if (newConfig.app) {
    config.app = { ...config.app, ...newConfig.app };
  }
  
  return config;
}

/**
 * Get the current configuration
 */
function getConfig() {
  return config;
}

// Initialize by loading configuration
loadConfig();

module.exports = {
  loadConfig,
  saveConfig,
  updateConfig,
  getConfig
};