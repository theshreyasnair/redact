// The seller agent's two Claude calls. Both system prompts are exported.
const { z } = require("zod");
const { askJson } = require("./llm");

const CATEGORIES = ["Jailbreaks", "Capability Discoveries", "Safety Failures", "IP Violations", "Benchmark Findings"];

const DRAFT_SYSTEM_PROMPT = `You write marketplace listings for research findings that buyers pay for before seeing. The description must make a serious buyer want to pay, and must not let them reconstruct the finding without paying. Include what kind of thing was found, which model or system, how it was measured, and what the buyer receives. Do not include the actual technique, the actual numbers that constitute the finding, or anything a reader could act on. Title under 120 characters. Description 60 to 120 words. Price in USDC between 0.05 and 1.00 based on specificity, reproducibility, and how hard the finding would be to obtain independently.`;

const LEAK_CHECK_SYSTEM_PROMPT = `You are a buyer who has not paid. From this description alone, could you reproduce or act on the finding? List any concrete technique, number, or artifact the description gives away. Be strict.`;

const DraftSchema = z.object({
  title: z.string().max(120),
  description: z.string(),
  category: z.enum(CATEGORIES),
  suggestedPriceUsdc: z.number().min(0.05).max(1),
  priceReason: z.string(),
});

const LeakCheckSchema = z.object({
  reconstructable: z.boolean(),
  leakedDetails: z.array(z.string()),
  reason: z.string(),
});

/**
 * Draft call. `avoid` is a list of details a previous leak check flagged;
 * they are appended as "do not include these".
 */
async function draftListing({ finding, avoid = [] }) {
  const parts = [
    `Allowed categories: ${CATEGORIES.join(", ")}`,
    "",
    `Finding:\n<finding>\n${finding}\n</finding>`,
  ];
  if (avoid.length) {
    parts.push("", "A leak check flagged these details in a previous draft. Do not include these:", ...avoid.map((d) => `- ${d}`));
  }
  return askJson(DRAFT_SYSTEM_PROMPT, parts.join("\n"), DraftSchema, 4096);
}

/** Leak check call. Sees the description only. */
async function leakCheck({ description }) {
  return askJson(LEAK_CHECK_SYSTEM_PROMPT, `Description:\n${description}`, LeakCheckSchema, 2048);
}

module.exports = { CATEGORIES, DRAFT_SYSTEM_PROMPT, LEAK_CHECK_SYSTEM_PROMPT, draftListing, leakCheck };
