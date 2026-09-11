# Corvid-3 loses long-context retrieval accuracy after a single mid-context table

## Summary

Corvid-3 (the 70B release, API version 2026-05) scores well on standard needle-in-a-haystack retrieval, but its accuracy collapses when the haystack contains one markdown table of at least 40 rows placed before the needle. We measured a drop from 97.4% to 61.2% exact-match retrieval at 64k context, with the effect growing as the table moves closer to the needle.

## Setup

- 600 synthetic documents, 48k to 96k tokens each, built from public-domain prose.
- One "needle" sentence with a random six-digit code inserted at a random depth between 30% and 90%.
- Condition A: no table. Condition B: a 40-row, 6-column markdown table of fake shipment records inserted between 500 and 4000 tokens before the needle.
- Query: "What is the code mentioned in the document?" Scored by exact match on the six digits.
- Five runs per document at temperature 0. Same prompts against Corvid-3 Mini and the previous Corvid-2.5 as controls.

## Results

| Model | Condition A | Condition B |
|---|---|---|
| Corvid-3 70B | 97.4% | 61.2% |
| Corvid-3 Mini | 91.0% | 88.7% |
| Corvid-2.5 | 93.8% | 92.1% |

The gap widens when the table is within 1000 tokens of the needle (48.9%) and nearly closes when the table is more than 8000 tokens away (94.0%). Replacing the markdown table with the same data as CSV text reduces the drop by about half. Wrong answers are usually digits copied from the table, not hallucinated codes.

## Reproduction

The generator script, the 600 document seeds, and the raw per-run outputs are included. A full rerun costs about 40 USD in API credit and takes under two hours.
