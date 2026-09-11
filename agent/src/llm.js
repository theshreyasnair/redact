const Anthropic = require("@anthropic-ai/sdk");
const { z } = require("zod");
const { zodOutputFormat } = require("@anthropic-ai/sdk/helpers/zod");
const { MODEL } = require("./config");

const SCORING_SYSTEM_PROMPT = `You are a buyer's analyst for a marketplace of LLM research findings. You decide whether a listing is worth paying for before anyone has seen the content. You only see the seller's pitch and their track record.

Be skeptical. Sellers write descriptions to sell. A vague description ("a powerful new jailbreak", "surprising capability") with no specifics about the model, the method, or the evidence is a warning sign. Concrete details (named models, version numbers, what was tried, what the observed behavior was, how it was measured) are a good sign.

Weight seller reputation. totalSales is how many buyers have paid. disputesLost is how many of those buyers proved the seller did not deliver. A seller with several sales and zero lost disputes has earned some trust. A seller with lost disputes has not. A seller with zero sales is unknown, not trusted; do not treat "new" as neutral for expensive listings.

Score relevance from 0 to 10 for how directly the listing addresses the research goal. Score credibility from 0 to 10 for how likely the content delivers what the description claims. Set worth_buying to true only when both are strong enough that paying the listed price is a reasonable bet. Give one sentence of reasoning.`;

const EVALUATION_SYSTEM_PROMPT = `You are judging whether purchased research content delivered what its listing promised. You see the listing description (the promise), the full content (the delivery), and the buyer's research goal.

Judge the content on its own terms. It must contain something the description promised and something a reader could not have written from the description alone. Flag content that is vague, generic, or padded. Flag content that restates the description without adding method, evidence, or specifics. Flag content that describes something widely known or easily found in public documentation, papers, or common practice; set already_public to true in that case.

delivered is true only if the content substantively meets the description. quality is 0 to 10 for how useful the content is toward the research goal: specificity, reproducibility, and evidence count; length and confidence do not. Give two sentences of reasoning at most.`;

const ScoreSchema = z.object({
  relevance: z.number().min(0).max(10),
  credibility: z.number().min(0).max(10),
  worth_buying: z.boolean(),
  reason: z.string(),
});

const EvaluationSchema = z.object({
  delivered: z.boolean(),
  quality: z.number().min(0).max(10),
  already_public: z.boolean(),
  reason: z.string(),
});

const client = new Anthropic();

async function askJson(system, user, schema, maxTokens) {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(schema) },
  });
  if (response.stop_reason === "refusal") {
    throw new Error(`Model refused: ${response.stop_details?.explanation || "no explanation"}`);
  }
  if (!response.parsed_output) throw new Error("Model returned no parseable JSON");
  return response.parsed_output;
}

/** Scoring call. Runs before purchase, on public listing data only. */
async function scoreListing({ goal, listing }) {
  const rep = listing.reputation || { totalSales: 0, totalDisputes: 0, disputesLost: 0 };
  const user = [
    `Research goal: ${goal}`,
    "",
    "Listing:",
    `  title: ${listing.title}`,
    `  category: ${listing.category}`,
    `  price: ${listing.price} USDC`,
    `  description: ${listing.description || "(none)"}`,
    "",
    "Seller reputation:",
    `  totalSales: ${rep.totalSales}`,
    `  totalDisputes: ${rep.totalDisputes}`,
    `  disputesLost: ${rep.disputesLost}`,
  ].join("\n");
  return askJson(SCORING_SYSTEM_PROMPT, user, ScoreSchema, 2048);
}

/** Evaluation call. Runs after purchase, on the revealed content. */
async function evaluateContent({ goal, listing, content }) {
  const user = [
    `Research goal: ${goal}`,
    "",
    `Listing description (what was promised):\n${listing.description || "(none)"}`,
    "",
    `Delivered content:\n<content>\n${content}\n</content>`,
  ].join("\n");
  return askJson(EVALUATION_SYSTEM_PROMPT, user, EvaluationSchema, 4096);
}

module.exports = { SCORING_SYSTEM_PROMPT, EVALUATION_SYSTEM_PROMPT, scoreListing, evaluateContent };
