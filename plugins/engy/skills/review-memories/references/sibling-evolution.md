# Sibling evolution — enrich linked memories on promotion

After a successful `promoteMemory`, walk the new memory's `linkedMemories[]` and propose 0–3 keyword or theme additions to each sibling. Runs inline (no subagent) after every `approve`, `edit`, or `supersede`. Silent on skips — only logs when an enrichment is actually written.

## When this runs

After `promoteMemory` returns. Use `linkedMemories` directly from the MCP response (the server awaits the auto-linker before returning). Do **not** re-query the memory.

If `linkedMemories` is empty, skip this step entirely — autoLink either failed silently or found no siblings above the similarity threshold.

## Per-sibling procedure

For each sibling path in the response's `linkedMemories` (cap at 5, permanent memories only):

1. **Resolve numeric id.** `updatePermanentMemory` requires a numeric `id`. Resolve with:
   ```
   mcp__Engy__listMemories({ workspaceId, compact: false })
   // then find the entry whose filePath matches the sibling path
   ```
   If id cannot be resolved, skip this sibling.

2. **Read current keywords and themes** from the resolved row, or from the similarity-check results in step 3b.

3. **Apply this reasoning:**
   > "The newly promoted memory says: `<title> — <keywords> — <themes>`. The sibling memory says: `<sibling title> — <sibling keywords> — <sibling themes>`. Does the newly promoted memory reveal a genuine new connection that enriches this sibling's meaning? If yes, propose 0–3 keyword or theme additions that reflect this connection. Be conservative: only add terms you are high-confidence about. Additions only — never remove existing keywords or themes."

4. **If 1–3 high-confidence additions exist:**
   - Call `mcp__Engy__updatePermanentMemory({ id: <sibling id>, keywords: <full merged list>, themes: <full merged list> })`.
   - Pass the **full merged arrays** (existing + additions), not just the delta.
   - Log: `Enriched sibling "<sibling title>" — added: <terms>`.

5. **If no high-confidence addition exists**, skip the sibling silently.

## Hard constraints

- Maximum **3 additions** per sibling (keywords + themes combined).
- Additions only — never remove existing keywords or themes.
- Skip if the term is already present in the sibling's existing keywords or themes.
- Skip fleeting memories and reference files — only permanent memories with a resolvable `id`.

## Why bother

Most memory systems are purely additive — a new node is created and edges are drawn, but existing nodes stay untouched. Enriching linked siblings' metadata with what the new memory teaches improves multi-hop retrieval: queries that should reach the sibling now find it through the enriched terms. Promotion is the right moment because the memory now has its final keywords and themes.
