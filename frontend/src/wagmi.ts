import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { sourceChain, creditcoinChain } from './config';

const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const CREDITCOIN_RPC = 'https://rpc.cc3-testnet.creditcoin.network/';

export const wagmiConfig = createConfig({
  chains: [sourceChain, creditcoinChain],
  connectors: [injected()],
  transports: {
    [11155111]: http(SEPOLIA_RPC),
    [102031]: http(CREDITCOIN_RPC),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
