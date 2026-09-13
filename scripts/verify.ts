/**
 * Verifies deployed contracts on Blockscout explorers.
 *
 * Usage: npx ts-node scripts/verify.ts
 *
 * Requires contracts to be deployed first (scripts/deploy.ts) and addresses
 * filled in .env. Uses Blockscout's standard contract verification API
 * (compatible with Etherscan API format).
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ override: true });

const CC_EXPLORER = 'https://creditcoin-testnet.blockscout.com';
const SOURCE_EXPLORER = process.env.SOURCE_CHAIN_EXPLORER || 'https://sepolia.etherscan.io';

interface VerifyRequest {
  address: string;
  contractName: string;
  contractFile: string;
  constructorArgs: string; // ABI-encoded
  explorer: string;
  chain: string;
}

function loadSource(contractFile: string): string {
  const filePath = path.join(__dirname, '..', 'contracts', 'sol', contractFile);
  return fs.readFileSync(filePath, 'utf-8');
}

function loadArtifact(contractFile: string, contractName: string) {
  const artifactPath = path.join(__dirname, '..', 'out', contractFile, `${contractName}.json`);
  const raw = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
  return raw;
}

async function verifyOnBlockscout(req: VerifyRequest): Promise<boolean> {
  const artifact = loadArtifact(req.contractFile, req.contractName);

  // Use standard JSON input verification (most reliable for multi-file projects)
  const compilerInput = artifact.metadata?.settings
    ? JSON.stringify({
        language: 'Solidity',
        sources: artifact.metadata.sources || {},
        settings: artifact.metadata.settings,
      })
    : null;

  // Fallback to flattened source verification
  const apiUrl = `${req.explorer}/api`;

  const params = new URLSearchParams({
    module: 'contract',
    action: 'verifysourcecode',
    contractaddress: req.address,
    sourceCode: loadSource(req.contractFile),
    contractname: req.contractName,
    compilerversion: 'v0.8.28+commit.7893614a',
    optimizationUsed: '1',
    runs: '200',
    constructorArguements: req.constructorArgs,
    evmversion: 'default',
  });

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await response.json();
    if (data.status === '1' || data.message === 'OK') {
      console.log(`  [OK] ${req.contractName} verified on ${req.chain}`);
      console.log(`       ${req.explorer}/address/${req.address}#code`);
      return true;
    } else {
      console.log(`  [WARN] ${req.contractName} verification response: ${data.result || data.message}`);
      console.log(`         Try manual verification at: ${req.explorer}/address/${req.address}/contract-verifications/new`);
      return false;
    }
  } catch (err: any) {
    console.log(`  [SKIP] ${req.contractName}: ${err.message}`);
    console.log(`         Verify manually at: ${req.explorer}/address/${req.address}/contract-verifications/new`);
    return false;
  }
}

async function verifyWithForge(
  contractPath: string,
  contractName: string,
  address: string,
  constructorArgs: string,
  rpcUrl: string,
  explorerUrl: string,
): Promise<void> {
  const { execSync } = await import('child_process');
  const cmd = [
    'forge verify-contract',
    address,
    `contracts/sol/${contractPath}:${contractName}`,
    `--verifier blockscout`,
    `--verifier-url "${explorerUrl}/api/"`,
    constructorArgs ? `--constructor-args ${constructorArgs}` : '',
    '--watch',
  ]
    .filter(Boolean)
    .join(' ');

  console.log(`  Running: ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    console.log(`  [OK] ${contractName} verified at ${explorerUrl}/address/${address}#code`);
  } catch {
    console.log(`  [WARN] Forge verification failed. Try manually at:`);
    console.log(`         ${explorerUrl}/address/${address}/contract-verifications/new`);
  }
}

async function main() {
  const vaultAddr = process.env.AUXILIARY_ASSET_VAULT_ADDRESS;
  const managerAddr = process.env.COLLATERAL_MANAGER_ADDRESS;
  const oracleAddr = process.env.RISK_SCORE_ORACLE_ADDRESS;
  const riskEngineKey = process.env.RISK_ENGINE_PRIVATE_KEY;

  if (!vaultAddr || !managerAddr || !oracleAddr) {
    console.error('Contract addresses not set in .env. Deploy first with: npx ts-node scripts/deploy.ts');
    process.exit(1);
  }

  console.log('\nVerifying contracts via forge verify-contract (Blockscout)...\n');

  // 1. AuxiliaryAssetVault (no constructor args)
  console.log('1. AuxiliaryAssetVault on source chain');
  await verifyWithForge(
    'AuxiliaryAssetVault.sol',
    'AuxiliaryAssetVault',
    vaultAddr,
    '',
    process.env.SOURCE_CHAIN_RPC_URL || '',
    SOURCE_EXPLORER,
  );

  // 2. RiskScoreOracle (constructor arg: scorer address)
  console.log('\n2. RiskScoreOracle on Creditcoin');
  if (riskEngineKey) {
    const { ethers } = await import('ethers');
    const scorerAddress = new ethers.Wallet(riskEngineKey).address;
    const encodedArgs = ethers.AbiCoder.defaultAbiCoder().encode(['address'], [scorerAddress]);
    await verifyWithForge(
      'RiskScoreOracle.sol',
      'RiskScoreOracle',
      oracleAddr,
      encodedArgs,
      process.env.CREDITCOIN_RPC_URL || '',
      CC_EXPLORER,
    );
  } else {
    console.log('  [SKIP] RISK_ENGINE_PRIVATE_KEY not set — cannot derive scorer address for constructor args.');
  }

  // 3. CollateralManager (constructor arg: oracle address)
  console.log('\n3. CollateralManager on Creditcoin');
  const { ethers } = await import('ethers');
  const encodedOracleArg = ethers.AbiCoder.defaultAbiCoder().encode(['address'], [oracleAddr]);
  await verifyWithForge(
    'CollateralManager.sol',
    'CollateralManager',
    managerAddr,
    encodedOracleArg,
    process.env.CREDITCOIN_RPC_URL || '',
    CC_EXPLORER,
  );

  console.log('\nDone. Check the explorer links above for verification status.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
