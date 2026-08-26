---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Understand the two things Neo4j adds once you move past basic Cypher CRUD: **indexes**, which give fast lookup of a node by property instead of scanning the whole graph, and **graph algorithms**, which turn "find the path" or "how connected is this node" from a client-side program you'd have to write yourself into something the database runs natively. The book's own framing is the reason both belong in one concept: "Although Neo4j isn't fundamentally schema-driven the way that relational databases are, indexes and constraints will help keep your queries nice and fast and your graph sane. They are an absolute must if you want to run Neo4j in production." Path-finding gets the same "this is a first-class citizen here" treatment — a shortest path between two nodes is one Cypher function call in Neo4j, where the same question is a recursive CTE in SQL or an application-side breadth-first search bolted onto a document store.

## Use Cases

- Looking up a node by a property value without walking the whole graph — the book's `authors` index example, keyed by `name`, returning the actual node data from a single call instead of a `MATCH` that has to inspect every node.
- Building a search-style query ("give me all books whose name begins with Jeeves") with a full-text inverted index, rather than trying to fake prefix search with Cypher string predicates over an unindexed property.
- Answering "how many degrees of separation lie between these two people" without writing a traversal algorithm yourself — the book's six-degrees-of-Kevin-Bacon exercise, run entirely in Cypher's `shortestPath()` function over a 63,042-node movie dataset.
- Recognizing that Cypher's star notation (`[:ACTS_IN*1..4]`) counts *hops*, not "degrees" in the human sense, and rewriting a query accordingly — the book's own gotcha, where actor-to-actor "degree" is really two hops (actor→movie→actor).
- Choosing a REST path-finding algorithm (`shortestPath`, `allPaths`, `allSimplePaths`, `dijkstra`) for a specific traversal need, and knowing that weighted shortest-path (Dijkstra) is a named, available option even where the book doesn't walk through its internals.
- Explaining to a team why a "distance between two nodes" query that looks trivially simple in a graph model becomes an awkward recursive CTE in a relational schema, or an application-side BFS over documents in a document store.

## Deep Dive

### Neo4j's indexing service is a separate thing from the graph itself

The book's 2018-era mechanics run entirely over Neo4j's REST interface, and the description matters because it explains *why* indexing feels different in Neo4j than in a relational database: "Unlike other database indexes where you perform queries in much the same way as without one, Neo4j indexes have a different path because the indexing service is actually a separate service." A relational index is invisible to the query you write — you `SELECT` the same way with or without one, and the planner decides. The book's Neo4j indexing model is explicit: you query the *index* directly, at its own URL, and it hands back node data rather than the URL you originally stored.

The simplest form is a key-value index — "You key the index by some node data, and the value is a REST URL, which points to the node in the graph." The book's own trace: create an index named `authors`, POST a key/value pair pointing at a node —

```
$ curl -X POST http://localhost:7474/db/data/index/node/authors \
  -H "Content-Type: application/json" \
  -d '{
     "uri": "http://localhost:7474/db/data/node/9",
     "key": "name",
     "value": "P.G.+Wodehouse"
  }'
```

— and retrieve it with a plain `GET` on `/db/data/index/node/authors/name/P.G.+Wodehouse`, which "doesn't return the URL we specified but rather the actual node data." You can have as many named indexes as you like, and — a detail easy to miss — "indexes can also be built on edges like we did previously; you just have to replace the instances of node in the URLs with relationship."

Beyond key-value lookup, the book covers a second index type built on Lucene: "Neo4j provides a full-text search inverted index, so you can perform queries like this: 'Give me all books that have names beginning with Jeeves.'" Building it means naming it explicitly as full-text-typed (`{"type": "fulltext", "provider": "lucene"}`), populating it the same way as the key-value index, and querying it with actual Lucene syntax (`?query=name:P*`) rather than a JSON key/value GET.

### Path-finding as a REST primitive

The book treats "find the path between two nodes" as a REST operation with a named algorithm, not something you write: POST to a node's `/paths` URL with a target, a relationship type filter, and an algorithm name. "The other path algorithm choices are allPaths, allSimplePaths, and dijkstra." That's a direct, if brief, acknowledgment that weighted shortest-path is a real, available primitive — the book is candid about not going further: "You can find information on these algorithms in the online documentation, but detailed coverage is outside the scope of this book." This concept's Deep Dive traces Dijkstra's algorithm itself below, over a small weighted graph, to fill exactly that gap.

### Cypher's own path-finding: `shortestPath()` and the Kevin Bacon problem

Day 2's centerpiece swaps the REST interface for Cypher's built-in `shortestPath()` function, run against a real 63,042-node movie dataset (12,862 movies, over 44,000 actors). The point the book is making is that Cypher already has serious graph algorithms baked in — you don't traverse a node tree by hand:

```cypher
MATCH (bacon:Actor {name: "Kevin Bacon"}), (penn:Actor {name: "Sean Penn"}),
p = shortestPath((bacon)-[:ACTS_IN*]-(penn))
RETURN length(p);
```

Two results from that dataset are worth carrying forward as intuition for how graphs "fan out": one degree from Kevin Bacon (co-stars) reaches 304 actors; two degrees (`[:ACTS_IN*1..4]`, since each human "degree" is really two graph hops through an intervening `Movie` node) reaches 9,096 — "the quotient between 2 degrees and 1 degree is about 79." By six degrees, 93.4% of the entire actor set is reachable, which the book found "just a little bit higher than the percentage of actors within 6 degrees" when it ran the same query with no depth bound at all — meaning almost anyone connected to Kevin Bacon at all in that dataset is within six hops.

A sharp, easy-to-miss correctness lesson sits right next to that result: querying `shortestPath` for Bacon and Sean Penn returned a length of 2 hops even though, "according to IMDB, Messieurs Bacon and Penn starred together in Mystic River" — one hop. The algorithm was correct; the data was incomplete. `MATCH (m:Movie {name: "Mystic River"}) RETURN count(DISTINCT m)` returned `0` — the movie simply wasn't in the dataset. The book's own moral: "so maybe don't use these results to show off at your next dinner party just yet." A shortest-path algorithm is only ever as short as the graph you actually gave it.

The other gotcha is duplication: "Running the previous query without using `DISTINCT` results in a count of 313" instead of 304, because "there are a few actors who are within two degrees of Kevin Bacon more than once" — multiple shared movies produce multiple paths to the same actor. `DISTINCT` isn't cosmetic here; without it, fan-out counts are simply wrong.

### Watching Dijkstra actually run: a weighted shortest-path trace

The book names `dijkstra` as a REST path algorithm but doesn't walk through its mechanics. Here's the algorithm itself, traced over a small weighted graph of six cities and nine weighted routes, finding the shortest route from Denver to Boston. Each step either **relaxes** an edge (proposes or improves a tentative distance to a neighbor) or **settles** a city (locks in its final distance, greedily, once it's the smallest tentative value left unsettled):

```viz
type: graph
node A Denver 0 1
node D Omaha 1 0
node B Chicago 2 0
node C Dallas 1 2
node E Atlanta 2 2
node F Boston 3 1
edge A B
edge A D
edge D B
edge D C
edge B C
edge B E
edge C E
edge C F
edge E F
---
visit A | Dijkstra starts at Denver with tentative distance 0; every other city starts at infinity, unsettled.
traverse A B | Relax Denver-Chicago (weight 4): Chicago's tentative distance becomes 0+4=4.
traverse A D | Relax Denver-Omaha (weight 2): Omaha's tentative distance becomes 0+2=2.
mark D | Omaha (2) is the smallest tentative distance among unsettled cities -- settle it permanently. This is Dijkstra's greedy step: once a node is settled its distance can never improve.
visit D | Current city becomes Omaha (settled distance 2); explore its edges next.
traverse D B | Relax Omaha-Chicago (weight 1): 2+1=3 beats Chicago's current 4, so Chicago updates to 3.
traverse D C | Relax Omaha-Dallas (weight 5): 2+5=7; Dallas had no tentative distance yet, so it becomes 7.
mark B | Chicago (3) is now the smallest unsettled distance -- settle it at 3, reached via Omaha, not the direct Denver edge that only offered 4.
visit B | Current city becomes Chicago (settled distance 3).
traverse B C | Relax Chicago-Dallas (weight 1): 3+1=4 beats Dallas's 7, so Dallas updates to 4.
traverse B E | Relax Chicago-Atlanta (weight 7): 3+7=10; Atlanta had no tentative distance yet, so it becomes 10.
mark C | Dallas (4) is smallest unsettled -- settle it at 4, via Chicago.
visit C | Current city becomes Dallas (settled distance 4).
traverse C E | Relax Dallas-Atlanta (weight 3): 4+3=7 beats Atlanta's 10, so Atlanta updates to 7.
traverse C F | Relax Dallas-Boston (weight 6): 4+6=10; Boston had no tentative distance yet, so it becomes 10.
mark E | Atlanta (7) is smallest unsettled -- settle it at 7, via Dallas, not the earlier Chicago relaxation that only offered 10.
visit E | Current city becomes Atlanta (settled distance 7).
traverse E F | Relax Atlanta-Boston (weight 1): 7+1=8 beats Boston's 10, so Boston updates to 8.
mark F | Boston (8) is the only unsettled city left -- settle it at 8. Dijkstra terminates: the shortest distance from Denver to Boston is 8.
visit F | Retracing predecessors from Boston back to Denver gives the winning path Denver-Omaha-Chicago-Dallas-Atlanta-Boston, weights 2+1+1+3+1=8 -- the same relaxations that set each city's final distance also trace out the path.
```

Notice what made Denver→Omaha→Chicago 3 beat Denver→Chicago 4: Dijkstra never commits to the first edge it sees. It only settles a city once nothing unsettled could possibly offer a shorter route — the same discipline that, run over Neo4j's graph structure instead of a hand-drawn one, is what `dijkstra` as a REST path algorithm (or `shortestPath()` in Cypher, for the unweighted case) is doing under the hood.

### Book vs today

> **The REST interface this entire chapter is built on was removed in Neo4j 4.0.** Every command in the book — `POST /db/data/node`, `POST /db/data/index/node/authors`, `POST /db/data/node/9/paths` with an `algorithm` field — targets the legacy HTTP REST API. Neo4j's own migration documentation confirms the REST API was removed starting with Neo4j 4.0, in favor of Cypher and procedures executed over the HTTP query API or the Bolt protocol via official drivers.
> **The book's key-value and full-text node indexes are exactly the "legacy/manual/auto index" family Neo4j has been retiring.** Current Neo4j documentation states plainly that "all APIs, surfaces and features related to explicit/auto/manual/legacy indexes are deprecated for removal," with schema indexes and native full-text indexes as the replacement. In current Cypher, creating an index looks like `CREATE [RANGE] INDEX [index_name] [IF NOT EXISTS] FOR (n:Label) ON (n.property)` — a Cypher statement against the graph's schema, not a POST to a separately addressed indexing service — and full-text search is its own first-class `CREATE FULLTEXT INDEX` command rather than a Lucene-backed index type you configure by hand.
> **`shortestPath()` and `allShortestPaths()` still work, but are now "legacy" next to newer syntax.** The Cypher functions the book's Kevin Bacon exercise relies on remain available in current Neo4j, but current Cypher documentation frames them as not GQL-conformant and points toward the newer keyword-based `SHORTEST` / `ALL SHORTEST` pattern syntax as the forward-looking equivalent. The underlying idea — shortest path as a query-language primitive — hasn't changed; the surface syntax has grown a second, preferred form.
> **The single named `dijkstra` REST option grew into an entire separate library.** The book lists `dijkstra` as one of four path-finding choices baked into the REST `/paths` endpoint. Today that idea has become the **Graph Data Science (GDS) library**, a much larger, separately maintained catalog exposed as Cypher procedures: dedicated Dijkstra Source-Target and Dijkstra Single-Source algorithms, an **A\* Shortest Path** algorithm (Dijkstra with a geospatial heuristic), **Yen's k-shortest-paths** algorithm (which "for k = 1... behaves exactly like Dijkstra's shortest path algorithm"), breadth-first and depth-first search, plus entire categories the book never touches at all — centrality (PageRank and others), community detection, node similarity, and machine-learning link-prediction pipelines. The book's four-item REST menu was a preview of what is now a dedicated analytics product.

## Trade-offs

- **A graph database makes "find the path" a language primitive; SQL and document stores make it a program you write.** `shortestPath()` is one Cypher function call over a 63,042-node dataset; the same question against a relational schema needs a recursive common table expression walking a self-referencing foreign key, and against a document store it typically means pulling documents into application code and running your own breadth-first search. The book's whole Day 2 exercise is really a demonstration that the graph model *is* the win here — the traversal isn't bolted on, it's what the storage model was for.
- **The book's own indexing model — a separate REST-addressed indexing service — traded discoverability for a real operational cost, which is exactly why it's the part of this chapter that's since been retired.** Querying an index at its own URL instead of transparently through normal queries meant the index had to be explicitly managed, populated, and remembered as a separate resource per index name — real friction, and precisely what schema-backed `CREATE INDEX` and native full-text indexes were built to eliminate.
- **`shortestPath()`'s correctness is only as good as the graph you built.** The book's Bacon-and-Penn result (2 hops instead of the real-world 1) wasn't an algorithm bug — it was a missing `Mystic River` node. Every shortest-path or traversal algorithm answers "shortest path *in the graph as stored*," which is a different, narrower claim than "shortest path in reality," and the gap between the two is invisible unless you go looking for it.
- **Cypher's star-notation traversal (`[:ACTS_IN*1..4]`) is powerful and easy to miscount.** It saves you from writing an explicit multi-hop `MATCH` chain, but it counts relationship hops, not the human concept of "degrees" — the book's own first attempt at "two degrees from Kevin Bacon" undercounted because a person-to-person degree is two hops through an intervening node. The convenience is real; so is the off-by-a-factor-of-two trap that comes with it.
- **`DISTINCT` is a correctness requirement in graph fan-out queries, not a style preference.** Multiple relationship paths to the same node (two actors sharing more than one movie) produce duplicate rows by design — that's what a graph honestly returns when asked "who is reachable" without deduplication. Skipping `DISTINCT` doesn't just look messy; it silently inflates counts, as the book's own 313-vs-304 discrepancy shows.
- **Moving path-finding out of a handful of built-in options and into a dedicated GDS library buys algorithmic breadth at the cost of a second thing to install and operate.** The REST `dijkstra` option the book describes needed nothing beyond the running server. Today's much larger algorithm catalog — A*, Yen's, PageRank, community detection, ML pipelines — lives in Graph Data Science, a separate library with its own in-memory graph projections, memory budget, and operational surface layered on top of the base database.

## Documentation Links

- [Luc Perkins, Eric Redmond, and Jim R. Wilson, "Seven Databases in Seven Weeks", 2nd Edition (Pragmatic Bookshelf, 2018) — Chapter 6, "Neo4J", Day 2: "REST, Indexes, and Algorithms"](https://pragprog.com/titles/rwdata2/seven-databases-in-seven-weeks-second-edition/) — doc
- [Neo4j Cypher Manual — Create, Show, and Drop Indexes](https://neo4j.com/docs/cypher-manual/current/indexes/search-performance-indexes/managing-indexes/) — doc
- [Neo4j Upgrade and Migration Guide — Breaking Changes Between Neo4j 4.4 and Neo4j 5 (legacy indexes, REST API removal)](https://neo4j.com/docs/upgrade-migration-guide/current/version-5/migration/breaking-changes/) — doc
- [Neo4j Cypher Manual — Deprecations, Additions, Removals, and Compatibility (shortestPath/allShortestPaths vs SHORTEST)](https://neo4j.com/docs/cypher-manual/current/deprecations-additions-removals-compatibility/) — doc
- [Neo4j Graph Data Science Documentation — Graph Algorithms (pathfinding, centrality, community detection, similarity)](https://neo4j.com/docs/graph-data-science/current/algorithms/) — doc
- [Neo4j Graph Data Science Documentation — Dijkstra Source-Target Shortest Path](https://neo4j.com/docs/graph-data-science/current/algorithms/dijkstra-source-target/) — doc
