import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { ContractFactory, ethers } from 'ethers';

dotenv.config({ override: true });

/** Loads a Foundry build artifact (run `forge build` first) and returns {abi, bytecode}. */
function loadArtifact(contractFile: string, contractName: string) {
  const artifactPath = path.join(__dirname, '..', 'out', contractFile, `${contractName}.json`);
  const raw = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
  return { abi: raw.abi, bytecode: raw.bytecode.object as string };
}

async function main() {
  const sourceChainRpcUrl = process.env.SOURCE_CHAIN_RPC_URL;
  const ccRpcUrl = process.env.CREDITCOIN_RPC_URL;
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  const riskEngineKey = process.env.RISK_ENGINE_PRIVATE_KEY;
  const sourceChainKey = Number(process.env.SOURCE_CHAIN_KEY);

  // Second source chain is OPTIONAL — only deployed if both vars are set. See the README
  // "Honesty note on multi-chain" section: which second CC3-Testnet-attested chain to use here is
  // unconfirmed, so this defaults to single-chain unless you fill these in yourself.
  const sourceChain2RpcUrl = process.env.SOURCE_CHAIN_2_RPC_URL;
  const sourceChain2Key = Number(process.env.SOURCE_CHAIN_2_KEY);
  const deploySecondChain = !!sourceChain2RpcUrl && !isNaN(sourceChain2Key);

  if (!sourceChainRpcUrl) throw new Error('SOURCE_CHAIN_RPC_URL not set');
  if (!ccRpcUrl) throw new Error('CREDITCOIN_RPC_URL not set');
  if (!deployerKey) throw new Error('DEPLOYER_PRIVATE_KEY not set');
  if (!riskEngineKey) throw new Error('RISK_ENGINE_PRIVATE_KEY not set');
  if (isNaN(sourceChainKey)) throw new Error('SOURCE_CHAIN_KEY not set');

  const sourceProvider = new ethers.JsonRpcProvider(sourceChainRpcUrl);
  const ccProvider = new ethers.JsonRpcProvider(ccRpcUrl);
  const sourceDeployer = new ethers.Wallet(deployerKey, sourceProvider);
  const ccDeployer = new ethers.Wallet(deployerKey, ccProvider);
  const riskEngineWallet = new ethers.Wallet(riskEngineKey);

  const totalSteps = deploySecondChain ? 5 : 4;
  let step = 1;

  console.log(`${step++}/${totalSteps} Deploying AuxiliaryAssetVault on source chain 1 (key ${sourceChainKey})...`);
  const vaultArtifact = loadArtifact('AuxiliaryAssetVault.sol', 'AuxiliaryAssetVault');
  const vaultFactory = new ContractFactory(vaultArtifact.abi, vaultArtifact.bytecode, sourceDeployer);
  const vault = await vaultFactory.deploy();
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log(`   AuxiliaryAssetVault deployed at ${vaultAddress}`);

  let vault2Address: string | undefined;
  if (deploySecondChain) {
    console.log(`${step++}/${totalSteps} Deploying AuxiliaryAssetVault on source chain 2 (key ${sourceChain2Key})...`);
    const source2Provider = new ethers.JsonRpcProvider(sourceChain2RpcUrl);
    const source2Deployer = new ethers.Wallet(deployerKey, source2Provider);
    const vault2Factory = new ContractFactory(vaultArtifact.abi, vaultArtifact.bytecode, source2Deployer);
    const vault2 = await vault2Factory.deploy();
    await vault2.waitForDeployment();
    vault2Address = await vault2.getAddress();
    console.log(`   AuxiliaryAssetVault deployed at ${vault2Address}`);
  }

  console.log(`${step++}/${totalSteps} Deploying RiskScoreOracle on Creditcoin...`);
  const oracleArtifact = loadArtifact('RiskScoreOracle.sol', 'RiskScoreOracle');
  const oracleFactory = new ContractFactory(oracleArtifact.abi, oracleArtifact.bytecode, ccDeployer);
  const oracle = await oracleFactory.deploy(riskEngineWallet.address);
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log(`   RiskScoreOracle deployed at ${oracleAddress} (scorer = ${riskEngineWallet.address})`);

  console.log(`${step++}/${totalSteps} Deploying CollateralManager on Creditcoin...`);
  const managerArtifact = loadArtifact('CollateralManager.sol', 'CollateralManager');
  const managerFactory = new ContractFactory(managerArtifact.abi, managerArtifact.bytecode, ccDeployer);
  const manager = await managerFactory.deploy(oracleAddress);
  await manager.waitForDeployment();
  const managerAddress = await manager.getAddress();
  console.log(`   CollateralManager deployed at ${managerAddress}`);

  console.log(`${step++}/${totalSteps} Registering source vault(s) on CollateralManager...`);
  const registerTx = await (manager as any).registerSourceVault(sourceChainKey, vaultAddress);
  await registerTx.wait();
  console.log(`   Registered chain key ${sourceChainKey} -> ${vaultAddress}`);
  if (deploySecondChain && vault2Address) {
    const registerTx2 = await (manager as any).registerSourceVault(sourceChain2Key, vault2Address);
    await registerTx2.wait();
    console.log(`   Registered chain key ${sourceChain2Key} -> ${vault2Address}`);
  }

  console.log('\nAdd these to .env:\n');
  console.log(`AUXILIARY_ASSET_VAULT_ADDRESS=${vaultAddress}`);
  if (deploySecondChain && vault2Address) console.log(`AUXILIARY_ASSET_VAULT_2_ADDRESS=${vault2Address}`);
  console.log(`COLLATERAL_MANAGER_ADDRESS=${managerAddress}`);
  console.log(`RISK_SCORE_ORACLE_ADDRESS=${oracleAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
