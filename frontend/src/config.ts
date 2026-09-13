import { defineChain } from 'viem';

function env(key: string): string {
  return (import.meta.env[key] as string | undefined) ?? '';
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

function envAddress(key: string): `0x${string}` {
  const v = env(key);
  return (v && v.startsWith('0x') ? v : ZERO_ADDRESS) as `0x${string}`;
}

export const sourceChain = defineChain({
  id: Number(env('VITE_SOURCE_CHAIN_EVM_ID') || 11155111),
  name: env('VITE_SOURCE_CHAIN_NAME') || 'Ethereum Sepolia',
  nativeCurrency: { name: env('VITE_SOURCE_CHAIN_SYMBOL') || 'ETH', symbol: env('VITE_SOURCE_CHAIN_SYMBOL') || 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [env('VITE_SOURCE_CHAIN_RPC_URL') || 'https://ethereum-sepolia-rpc.publicnode.com'] } },
  blockExplorers: {
    default: { name: 'Explorer', url: env('VITE_SOURCE_CHAIN_EXPLORER') || 'https://sepolia.etherscan.io' },
  },
  testnet: true,
});

// Chain id 102031 and RPC confirmed from docs.creditcoin.org/environments/testnet — not guessed.
export const creditcoinChain = defineChain({
  id: Number(env('VITE_CREDITCOIN_EVM_ID') || 102031),
  name: 'Creditcoin CC3 Testnet',
  nativeCurrency: { name: env('VITE_CREDITCOIN_SYMBOL') || 'tCTC', symbol: env('VITE_CREDITCOIN_SYMBOL') || 'tCTC', decimals: 18 },
  rpcUrls: { default: { http: [env('VITE_CREDITCOIN_RPC_URL') || 'https://rpc.cc3-testnet.creditcoin.network/'] } },
  blockExplorers: {
    default: {
      name: 'Blockscout',
      url: env('VITE_CREDITCOIN_EXPLORER') || 'https://creditcoin-testnet.blockscout.com',
    },
  },
  testnet: true,
});

export const contracts = {
  auxiliaryAssetVault: envAddress('VITE_AUXILIARY_ASSET_VAULT_ADDRESS'),
  collateralManager: envAddress('VITE_COLLATERAL_MANAGER_ADDRESS'),
  riskScoreOracle: envAddress('VITE_RISK_SCORE_ORACLE_ADDRESS'),
};

export const isDeployed =
  contracts.auxiliaryAssetVault !== ZERO_ADDRESS &&
  contracts.collateralManager !== ZERO_ADDRESS &&
  contracts.riskScoreOracle !== ZERO_ADDRESS;

// Category/status enums must match contracts/sol/AssetTypes.sol exactly.
export const ASSET_CATEGORIES = ['Invoice', 'Real Estate', 'Carbon Credit', 'Other'] as const;
export const PLEDGE_STATUS = ['Active', 'Released', 'Liquidated'] as const;

// USD values are stored on-chain as fixed-point with 8 decimals (matches Chainlink-style feeds —
// see AssetTypes.sol's comment on AssetPledge.valueUSD).
export const USD_DECIMALS = 8;
