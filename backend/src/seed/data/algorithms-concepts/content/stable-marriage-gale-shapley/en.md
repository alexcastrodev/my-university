---
version: 1.0
updatedAt: 2026-08-14
---
## Objective

Understand the **stable-marriage problem**: given a complete bipartite graph `G = (V, E)` with vertex partition `V = L ∪ R` (`|L| = |R| = n`), where every vertex additionally carries a ranking of every vertex on the other side, find a matching of `L` to `R` that is **stable** — no two unmatched-to-each-other vertices both prefer each other over their assigned partners. Cormen, Leiserson, Rivest, Stein frame this as a direct extension of the bipartite-matching problem from Section 25.1: there, the goal was just *a* maximum matching; here, each vertex's ranking of the other side lets you ask which matching is *most desirable*. The **Gale-Shapley algorithm** is the simple procedure that always produces a stable matching, no matter what rankings the vertices supply.

## Use Cases

- Any complete bipartite graph where both sides rank the other side and you need a matching nobody has an incentive to break — the general shape the stable-marriage problem models, independent of the "marriage" framing.
- The National Resident Matching Program — matching medical residents to hospitals — is CLRS's cited real-world instance, though it differs from the plain stable-marriage setup in two ways the text calls out: a hospital can take on multiple residents, and the number of residents need not equal the number of hospitals, so the base algorithm needs modification to fit it.
- Deciding, among several valid matchings of a bipartite graph, which one to actually assign — stability filters out matchings that would immediately be undone by a pair "opting out" of their assignments and pairing up on their own.

## Deep Dive

### From bipartite matching to stable matching: blocking pairs

CLRS sets up the problem on a complete bipartite graph `G = (V, E)` with `V = L ∪ R`, `|L| = |R| = n`, containing an edge from every vertex in `L` to every vertex in `R`. Each vertex in `L` has an ordered list ranking all vertices in `R`, and vice versa. Traditionally `L` is viewed as a set of women and `R` as a set of men, each ranking all members of the other side by desirability.

The goal is to pair up women and men — a matching — so that if a woman and a man are *not* matched to each other, at least one of them prefers their assigned partner. If a woman and a man are not matched to each other but each prefers the other over their assigned partner, they form a **blocking pair**: they have an incentive to opt out of their assigned pairing and get together on their own. A matching with no blocking pair is **stable**; a matching with a blocking pair is **unstable**.

### Worked example — a unique stable matching

Four women — Wanda, Emma, Lacey, and Karen — and four men — Oscar, Davis, Brent, and Hank — have these preferences:

```
Wanda: Brent, Hank, Oscar, Davis
Emma:  Davis, Hank, Oscar, Brent
Lacey: Brent, Davis, Hank, Oscar
Karen: Brent, Hank, Davis, Oscar
Oscar: Wanda, Karen, Lacey, Emma
Davis: Wanda, Lacey, Karen, Emma
Brent: Lacey, Karen, Wanda, Emma
Hank:  Lacey, Wanda, Emma, Karen
```

A stable matching for this instance is:

```
Lacey and Brent
Wanda and Hank
Karen and Davis
Emma and Oscar
```

This matching has no blocking pair. For example, even though Karen prefers Brent and Hank to her partner Davis, Brent prefers his partner Lacey to Karen, and Hank prefers his partner Wanda to Karen — so neither Karen-Brent nor Karen-Hank blocks the matching. In fact this stable matching is unique for this instance: if instead the last two pairs were Emma-Davis and Karen-Oscar, then Karen and Davis would form a blocking pair (they aren't paired together, Karen prefers Davis to Oscar, and Davis prefers Karen to Emma) — so that alternative matching is unstable.

### Stable matchings need not be unique

Stability doesn't pin down a single answer in general. With three women — Monica, Phoebe, and Rachel — and three men — Chandler, Joey, and Ross:

```
Monica:  Chandler, Joey, Ross
Phoebe:  Joey, Ross, Chandler
Rachel:  Ross, Chandler, Joey
Chandler: Phoebe, Rachel, Monica
Joey:     Rachel, Monica, Phoebe
Ross:     Monica, Phoebe, Rachel
```

there are three stable matchings:

| Matching 1 | Matching 2 | Matching 3 |
|---|---|---|
| Monica and Chandler | Phoebe and Chandler | Rachel and Chandler |
| Phoebe and Joey | Rachel and Joey | Monica and Joey |
| Rachel and Ross | Monica and Ross | Phoebe and Ross |

In matching 1, all women get their first choice and all men get their last choice; matching 2 is the opposite; in matching 3, everyone gets their second choice. When all the women (or all the men) get their first choice there plainly cannot be a blocking pair, and matching 3 can also be verified to have none.

### The Gale-Shapley algorithm

The Gale-Shapley algorithm always finds a stable matching, for any rankings the participants provide. It has two mirror-image variants, "woman-oriented" and "man-oriented"; CLRS presents the woman-oriented version and notes that the man-oriented version just reverses the roles of men and women.

Every participant starts **free**. A free woman proposes to a man; when a man is first proposed to he goes from free to **engaged**, and once engaged he stays engaged (though not necessarily to the same woman). If an engaged man receives a proposal from a woman he prefers to his current partner, he breaks that engagement — the abandoned woman becomes free again — and becomes engaged to the new proposer instead. Each woman proposes down her preference list, in order, skipping men she's already proposed to, stopping only once she's engaged; if she later becomes free again she resumes down her list. The algorithm terminates once everyone is engaged:

```
GALE-SHAPLEY(men, women, rankings)
1  assign each woman and man as free
2  while some woman w is free
3      let m be the first man on w's ranked list to whom she has not proposed
4      if m is free
5          w and m become engaged to each other (and not free)
6      elseif m ranks w higher than the woman w' he is currently engaged to
7          m breaks the engagement to w', who becomes free
8          w and m become engaged to each other (and not free)
9      else m rejects w, with w remaining free
10 return the stable matching consisting of the engaged pairs
```

Line 2 allows a choice — any free woman may be selected — and the algorithm produces a stable matching regardless of that choice (see Theorem 25.11 below).

**Tracing it on the Wanda/Emma/Lacey/Karen/Oscar/Davis/Brent/Hank example**, one possible sequence of iterations:

1. Wanda proposes to Brent. Brent is free, so they become engaged.
2. Emma proposes to Davis. Davis is free, so they become engaged.
3. Lacey proposes to Brent. Brent is engaged to Wanda but prefers Lacey; he breaks the engagement (Wanda becomes free), and Lacey and Brent become engaged.
4. Karen proposes to Brent. Brent is engaged to Lacey, whom he prefers to Karen; he rejects Karen, who remains free.
5. Karen proposes to Hank. Hank is free, so they become engaged.
6. Wanda proposes to Hank. Hank is engaged to Karen but prefers Wanda; he breaks the engagement (Karen becomes free), and Wanda and Hank become engaged.
7. Karen proposes to Davis. Davis is engaged to Emma but prefers Karen; he breaks the engagement (Emma becomes free), and Karen and Davis become engaged.
8. Emma proposes to Hank. Hank is engaged to Wanda, whom he prefers to Emma; he rejects Emma, who remains free.
9. Emma proposes to Oscar. Oscar is free, so they become engaged.

At this point everyone is engaged, the while loop terminates, and the procedure returns exactly the stable matching shown earlier (Lacey-Brent, Wanda-Hank, Karen-Davis, Emma-Oscar).

### Correctness: Gale-Shapley always terminates with no blocking pair

**Theorem 25.9.** The procedure always terminates and returns a stable matching.

*Termination.* By contradiction: if the loop never terminates, some woman stays free forever. For that to happen she must have proposed to every man and been rejected by each — but a man can only reject when he's already engaged, so all men would be engaged. Once engaged, a man never becomes free again, and there are equally many women as men, so every woman would have to be engaged too — contradicting the assumption she stayed free. For the *bound* on iterations: each of the `n` women goes through at most `n` men in her ranking, so the loop runs at most `n²` iterations.

*No blocking pairs.* Once a man `m` is engaged, all his subsequent actions occur in lines 6–8: any time he breaks an engagement, it's for a woman he prefers to the one he drops. Suppose woman `w` ends up matched to `m` but prefers some `m'`. Since `w` ranks `m'` above `m`, she must have proposed to `m'` before `m`, and `m'` either rejected her (already engaged to someone he preferred) or accepted and later broke it off (for someone he preferred even more). Either way `m'` ends up with a partner he prefers to `w`, so `w` and `m'` cannot be a blocking pair. Hence the returned matching has none.

**Corollary 25.10.** Given rankings for `n` women and `n` men, Gale-Shapley can be implemented to run in `O(n²)` time.

### Optimality: proposer-optimal, and provably worst for the other side

Line 2's free choice of which woman proposes next raises the question of whether different choices produce different stable matchings.

**Theorem 25.11.** Regardless of how free women are chosen in line 2, Gale-Shapley always returns the *same* stable matching — and in it, each woman has the best partner possible in *any* stable matching for that instance.

The proof (by contradiction) considers the first moment, across the whole execution, that any man rejects a partner who belongs to some other stable matching `M'`; it shows that moment can't actually happen without forcing a blocking pair in `M'`, which would make `M'` not stable after all — so no woman can ever do better than what Gale-Shapley gives her.

**Corollary 25.12.** There can be stable matchings that Gale-Shapley never returns. In the Monica/Phoebe/Rachel/Chandler/Joey/Ross example above, three different stable matchings exist for the same rankings, but a call to Gale-Shapley returns only one of them (matching 1, where every woman gets her first choice — consistent with Theorem 25.11).

**Corollary 25.13.** In the matching Gale-Shapley returns, each *man* has the worst partner possible in any stable matching. This follows from Theorem 25.11: if some man `m` preferred a partner `w'` from a different stable matching `M'` over his Gale-Shapley partner `w`, then since `w` is `w`'s best possible partner in any stable matching, `w` must prefer `m` to her `M'`-partner — making `w` and `m` a blocking pair in `M'`, contradicting `M'`'s stability.

### A structurally different relative: the stable-roommates problem

CLRS also poses the **stable-roommates problem**: same idea — blocking pairs, stable matching — but on a *complete graph*, not a bipartite one, with an even number of vertices, each ranking every other person (no "two sides"). For four people — Wendy, Xenia, Yolanda, and Zelda:

```
Wendy:   Xenia, Yolanda, Zelda
Xenia:   Wendy, Zelda, Yolanda
Yolanda: Wendy, Zelda, Xenia
Zelda:   Xenia, Yolanda, Wendy
```

the matching {Wendy-Xenia, Yolanda-Zelda} is stable. But unlike the bipartite stable-marriage problem — where Theorem 25.9 guarantees a stable matching always exists — the text notes the stable-roommates problem can have instances for which **no** stable matching exists at all.

## Trade-offs

- **Stability is not uniqueness** — a given set of rankings can admit several distinct stable matchings (the Monica/Phoebe/Rachel/Chandler/Joey/Ross example has three), so "find a stable matching" and "find the stable matching" are different problems; Gale-Shapley solves only the former, deterministically returning one specific stable matching.
- **Proposer-optimal is also non-proposer-pessimal** — the same algorithm that gives every woman (the proposing side) her best achievable partner across all stable matchings simultaneously gives every man (the proposed-to side) his *worst* achievable partner (Theorem 25.11, Corollary 25.13). Which side proposes is not a neutral implementation detail; it decides who the algorithm favors.
- **Free choice in line 2 doesn't threaten determinism** — the order in which free women are selected to propose can vary arbitrarily, but Theorem 25.11 guarantees the final matching is identical regardless, so implementations are free to pick any convenient order (e.g. a queue of free women) without affecting the result.
- **The bipartite structure is what guarantees a solution exists** — relax it to the stable-roommates problem (a complete graph, everyone ranking everyone, no two sides) and CLRS notes a stable matching can fail to exist at all; the small Wendy/Xenia/Yolanda/Zelda instance above does have one, but it's an example, not a guarantee for every instance of that variant.
- **The textbook version assumes equal counts and one partner each** — real deployments like the National Resident Matching Program need the algorithm modified for a hospital taking `r_h ≥ 1` residents and for the two sides having unequal sizes, per CLRS's own framing of that scenario.

## Documentation Links

- [Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th Edition, Section 25.2 "The stable-marriage problem", pp. 716-723](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
