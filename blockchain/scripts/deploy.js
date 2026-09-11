const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // The recorder is the backend address authorized to call recordPurchase.
  // Defaults to the deployer; override with RECORDER_ADDRESS in .env.
  const recorder = process.env.RECORDER_ADDRESS || deployer.address;
  console.log("Recorder address:", recorder);

  const ResearchMarketplace = await hre.ethers.getContractFactory("ResearchMarketplace");
  const marketplace = await ResearchMarketplace.deploy(recorder);
  await marketplace.waitForDeployment();

  const address = await marketplace.getAddress();
  console.log("ResearchMarketplace deployed to:", address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
