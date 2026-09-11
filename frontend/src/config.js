// Backend base URL. Set VITE_BACKEND_URL to override; defaults to the Phala CVM.
export const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ||
  "https://ff8a24a714e59bd01118016b7c342f7ee2e1ab1d-4021.dstack-pha-prod5.phala.network";

export const CONTRACT_ADDRESS = "0xf88Fc7df9C728A306097d1dDA85325A97162c90d";
export const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const CHAIN_ID = 84532;
export const CHAIN_ID_HEX = "0x14a34";
export const NETWORK_CAIP2 = "eip155:84532";
export const RPC_URL = "https://sepolia.base.org";
export const EXPLORER_URL = "https://sepolia.basescan.org";
// Alias kept for callers that reference BLOCK_EXPLORER.
export const BLOCK_EXPLORER = EXPLORER_URL;

export const CHAIN_PARAMS = {
  chainId: CHAIN_ID_HEX,
  chainName: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: [RPC_URL],
  blockExplorerUrls: [EXPLORER_URL],
};

export const CATEGORIES = [
  "Jailbreaks",
  "Capability Discoveries",
  "Safety Failures",
  "IP Violations",
  "Benchmark Findings",
];

export const STATS_REFRESH_MS = 15_000;
