require("dotenv").config();

// Model is a constant so it can be swapped in one place.
const MODEL = "claude-sonnet-4-6";

const CONTRACT_ADDRESS = "0xf88Fc7df9C728A306097d1dDA85325A97162c90d";
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const RPC_URL = "https://sepolia.base.org";
const NETWORK_CAIP2 = "eip155:84532";
const EXPLORER_URL = "https://sepolia.basescan.org";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    }
  }
  return out;
}

function loadConfig(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const goal = args.goal ?? process.env.RESEARCH_GOAL;
  const budget = Number(args.budget ?? process.env.BUDGET_USDC);
  const minScore = Number(args["min-score"] ?? process.env.MIN_SCORE ?? 6);
  const backendUrl = (args.backend ?? process.env.BACKEND_URL ?? "http://localhost:4021").replace(/\/$/, "");
  // --listing <id>: skip discovery and scoring, buy this one listing directly.
  const listing = args.listing !== undefined ? Number(args.listing) : null;

  const problems = [];
  if (!goal || !goal.trim()) problems.push("RESEARCH_GOAL is empty (set it in .env or pass --goal)");
  if (!(budget > 0)) problems.push("BUDGET_USDC must be a positive number (or pass --budget)");
  if (!(minScore >= 0 && minScore <= 10)) problems.push("MIN_SCORE must be between 0 and 10");
  if (listing !== null && !(Number.isInteger(listing) && listing > 0)) problems.push("--listing must be a positive integer listing id");
  if (!process.env.AGENT_PRIVATE_KEY) problems.push("AGENT_PRIVATE_KEY is missing");
  if (!process.env.ANTHROPIC_API_KEY) problems.push("ANTHROPIC_API_KEY is missing");
  if (problems.length) throw new Error(problems.join("\n"));

  return {
    goal: goal.trim(),
    budget,
    minScore,
    backendUrl,
    listing,
    privateKey: process.env.AGENT_PRIVATE_KEY,
  };
}

module.exports = { MODEL, CONTRACT_ADDRESS, USDC_ADDRESS, RPC_URL, NETWORK_CAIP2, EXPLORER_URL, parseArgs, loadConfig };
