import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { sourceChain, creditcoinChain } from './config';

export const wagmiConfig = createConfig({
  chains: [sourceChain, creditcoinChain],
  connectors: [injected()],
  transports: {
    [sourceChain.id]: http(sourceChain.rpcUrls.default.http[0]),
    [creditcoinChain.id]: http(creditcoinChain.rpcUrls.default.http[0]),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
