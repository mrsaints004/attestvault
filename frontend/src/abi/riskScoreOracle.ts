// Hand-written to match contracts/sol/RiskScoreOracle.sol exactly.
export const RISK_SCORE_ORACLE_ABI = [
  {
    type: 'function',
    name: 'scoreOf',
    stateMutability: 'view',
    inputs: [{ name: 'borrower', type: 'address' }],
    outputs: [{ name: '', type: 'uint16' }],
  },
  {
    type: 'function',
    name: 'DEFAULT_SCORE',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint16' }],
  },
  {
    type: 'event',
    name: 'ScoreUpdated',
    inputs: [
      { name: 'borrower', type: 'address', indexed: true },
      { name: 'oldScore', type: 'uint16', indexed: false },
      { name: 'newScore', type: 'uint16', indexed: false },
    ],
  },
] as const;
