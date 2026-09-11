const { ethers } = require("ethers");
const abi = require("../abi/ResearchMarketplace.json");
const { CONTRACT_ADDRESS, USDC_ADDRESS, RPC_URL, EXPLORER_URL } = require("./config");

const ERC20_ABI = ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"];

function createChain(privateKey) {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(privateKey, provider);
  const marketplace = new ethers.Contract(CONTRACT_ADDRESS, abi, wallet);
  const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);

  async function balances() {
    const [eth, usdcRaw] = await Promise.all([provider.getBalance(wallet.address), usdc.balanceOf(wallet.address)]);
    return {
      eth: ethers.formatEther(eth),
      ethWei: eth,
      usdc: ethers.formatUnits(usdcRaw, 6),
      usdcUnits: usdcRaw,
    };
  }

  async function openDispute(listingId) {
    const tx = await marketplace.openDispute(listingId);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, url: `${EXPLORER_URL}/tx/${receipt.hash}` };
  }

  async function getPurchase(listingId) {
    const p = await marketplace.getPurchase(listingId, wallet.address);
    return { timestamp: Number(p.timestamp), status: Number(p.status) };
  }

  return { wallet, address: wallet.address, provider, marketplace, balances, openDispute, getPurchase };
}

function keccakOf(content) {
  return ethers.keccak256(ethers.toUtf8Bytes(content));
}

function revertReason(err) {
  return err?.reason || err?.shortMessage || err?.info?.error?.message || err?.message || "Transaction failed";
}

module.exports = { createChain, keccakOf, revertReason, ethers };
