import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { sourceChain, creditcoinChain } from './config';

export const wagmiConfig = createConfig({
  chains: [sourceChain, creditcoinChain],
  connectors: [injected()],
  transports: {
    [sourceChain.id]: http(),
    [creditcoinChain.id]: http(),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
