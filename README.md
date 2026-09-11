# Redact
Redact is a marketplace for LLM research findings where the buyer pays before seeing anything, and the content sits in a hardware enclave that the operator isn't able to read. Disputes are settled by code rather than running in that same enclave.
## Chosen Vertical
I chose LLM research findings for my vertical, including areas like jailbreaks, capability discoveries, and safety failures. These are worth money only while they're secret, so a researcher can't sell without destroying it, and a buyer can't evaluate without seeing it. 
I chose this vertical because of the recent news surrounding LLM developments. Just this past week, OpenAI solved the Navier-Stokes problem, but a mathematician argued that OpenAI used his private chats with Codex to train their model. OpenAI wouldn't rule it out, and he had no way to know what happened to his work. Redact solves that problem by giving researchers a timestamped on-chain commitment, a way to sell without revealing, and a place to hold the content that operator can't read.

## Trust Assumptions
The seller can't swap content after listing, because the hash is on-chain before anyone pays. Additionally, the buyer can't read without payin, since the content is AES-256-GCM encrypted with a key derived inside an Intel TDX enclave, and the attestation endpoint proves which code holds it. The dispute arbitrator is that same attested code. All of this is enforced.
We are trusting Coinbase's x402 facilitator to settle payments honestly, the LLM arbitrator's judgement (since it's not determinstic), and Intel TDX and Phala's key management to do what they say.

## Biggest Design Decision
The biggest design decision that I made was to use x402 instead of an escrow contract. Escrow would hold funds through the dispute window, which is a textbook example of trustless design. I didn't build it because here, the buyers are agents, and an agent buying a hundred things an hour needs payment to be an HTTP status code. With x402, the buyer agent's whole payment path is one wrapped fetch. The cost, however, is that settlement is immediate, so a lost dispute can't claw back money; instead, it affects the seller's on-chain reputation. This is the metric that matters for a market where sellers with track records sell to labs.

## Limitations
There are some limitations. The first is that the backend wallet is the on-chain seller for every listing. The real seller's address is stored off-chain, so pretutation accrues to one address and every listing shows the same score.  If I had more time, I would implement the fix simply by making the seller hash client-side, call createListing from their own wallet, and post content with a signature. 
The second limtiation is that recordPurchase fires before x402 settlement finishes. If settlement fails after, the buyer is the on-chain owner without the content. The ordering should be flipped in production.
