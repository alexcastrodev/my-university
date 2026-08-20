---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Understand the property graph model that makes Neo4j a genuinely different way of thinking about data than the relational, document, or wide-column models covered elsewhere in this track: data as **nodes** (with labels and properties) connected by **relationships** (with a type, a direction, and their own properties) — plus the Cypher query language's core CRUD vocabulary (`CREATE`, `MATCH`, `WHERE`, `RETURN`, `MERGE`, `DELETE`/`DETACH DELETE`) for building and querying that graph.

## Use Cases

- Explaining to a team that has only ever modeled data relationally why a many-to-many relationship with its own attributes (a rating a publication gave a wine, a "friends since" date between two people) belongs on the relationship itself in Neo4j, not in a join table.
- Recognizing when a domain is "whiteboard friendly" — heavy on how things connect (social graphs, recommendation engines, fraud rings, org charts, bills of materials) rather than heavy on aggregating uniform rows — and is therefore a candidate for a graph model instead of forcing it through relational JOINs.
- Reading or writing a Cypher `MATCH` pattern and recognizing it as an actual graph traversal (follow this relationship type, in this direction, to nodes with this label) rather than a SQL-style filter over a flat table.
- Knowing why `CREATE` blindly duplicates on every run, while `MERGE` is the "match this pattern, and only create it if it doesn't already exist" verb — the difference that keeps a script safe to re-run.
- Understanding why Neo4j refuses to `DELETE` a node that still has relationships attached, and reaching for `DETACH DELETE` when the intent really is "remove this node and everything connecting it."

## Deep Dive

### A bungee cord, not a filing cabinet

The book's own framing for Neo4j's whole reason for existing: "A bungee cord is a helpful tool because you can use it to tie together the most disparate of things, no matter how awkwardly shaped or ill fitting they may be. In a lot of ways, Neo4j is the bungee cord of databases, a system intended not so much to store information about things as to tie them together and record their connections with each other." Neo4j "focuses more on the relationships between values than on the commonalities among sets of values (such as collections of documents or tables of rows)."

That single sentence is the pivot away from every other model in this track. A relational table and a MongoDB collection both organize data around *sets of similar things* — rows that share columns, documents that share a rough shape — and treat a connection between two things as a foreign key or an embedded reference: a pointer that has to be resolved (via a JOIN, or an application-level lookup) before it means anything. A property graph organizes data around the connections themselves. The relationship is not metadata about the model; it is a first-class citizen with its own identity, its own type, and its own properties, sitting in the database exactly as concretely as the two nodes it connects.

### Whiteboard friendly

Neo4j is described as "whiteboard friendly" because "virtually any diagram that you can draw using boxes and lines on a whiteboard can be stored in Neo4j." The book's running example is a wine-suggestion engine: wines categorized by variety, region, winery, vintage, and designation, cross-referenced with publications that write about them and people who like them. Modeled relationally, this becomes a category table and a many-to-many join between a winery's wines and some combination of categories and other data — technically correct, but not how anyone actually thinks about the domain. Modeled on a whiteboard, it is just boxes (Wine, Winery, Publication, Person) connected by labeled arrows (produced, reported_on, likes) — and that whiteboard sketch *is* the Neo4j data model, with no translation step in between.

The book ties this directly to schema flexibility: "There's an old saying in the relational database world: on a long enough timeline, all fields become optional. Neo4j handles this implicitly by providing values and structure only where necessary. If a wine blend has no vintage, add a bottle year and point the vintages to the blend node instead. In graph databases such as Neo4j there is simply no schema to adjust." Two nodes can carry the same label with entirely different property sets, the same way two documents can live in one MongoDB collection with different shapes — but here the added freedom extends to relationships too: a `likes` relationship between a person and a wine needs no properties at all, while a `reported_on` relationship between a publication and a wine can carry a `rating`.

### Nodes and relationships: the vocabulary

The book is explicit that Neo4j's terminology diverges slightly from mathematical graph theory on purpose: "In Cypher, as in mathematical graph theory, graph data points are called nodes. Unlike in graph theory, however, graphs in Cypher consist of nodes rather than vertices (as they are called in graph theory) and connections between nodes are called relationships (rather than edges)." A node "is conceptually similar" to the networking sense of the word — "a vertex between edges that may hold data" — and that data is "stored as a set of key-value pairs (as in many other non-relational databases we've talked about)." A node in Neo4j behaves, property-wise, a lot like a MongoDB document. What is new is the relationship: not a foreign key pointing somewhere, but an object in its own right, with a type, a direction, and — same as a node — its own properties.

### Labels are not types

Creating a node in the web console or `cypher-shell` looks like this:

```
CREATE (w:Wine {name: "Prancing Wolf", style: "ice wine", vintage: 2015})
```

`Wine` here is a **label**, and the book is careful to draw the line: "Wine and Publication were labels applied to the nodes, not types. We could create a node with the label Wine that had a completely different set of properties. Labels are extremely useful for querying purposes... but Neo4j doesn't require you to have predefined types. If you do want to enforce types, you'll have to do that at the application level." A label is a tag used for indexing and pattern-matching, not a schema constraint — the same "structure without a fixed shape" idea as MongoDB's collections, just attached to individual nodes rather than to a whole collection.

### CRUD in Cypher

Cypher statements share a recognizable shape: "`MATCH [some set of nodes and/or relationships] WHERE [some set of properties holds] RETURN [some set of results captured by the MATCH and WHERE clauses]`." Reading and navigating the whole graph is `MATCH (n) RETURN n` — the book calls this "kind of like a `SELECT * FROM entire_graph` statement."

**Creating a relationship** always requires first `MATCH`ing the two endpoint nodes, then `CREATE`ing the connection between the variables bound by that match:

```
MATCH (p:Publication {name: "Wine Expert Monthly"}),
    (w:Wine {name: "Prancing Wolf", vintage: 2015})
CREATE (p)-[r:reported_on]->(w)
```

The arrow syntax `-[r:reported_on]->` encodes all three things a relationship needs at once: a type (`reported_on`), a direction (left node to right node), and a bound variable (`r`) for attaching properties or returning it later. Relationship properties can be set after the fact with `SET`, or inline at creation time — `CREATE (p)-[r:reported_on {rating: 97}]->(w)` — exactly like a node's property map.

**Querying by pattern** is where Cypher stops resembling SQL. The `-->` operator walks a relationship in a direction regardless of type: `MATCH (p:Person {name: "Alice"})-->(n) RETURN n` returns everything Alice points at. Constraining the pattern by label and returning a specific property looks like `MATCH (p:Person {name: "Alice"})-->(other:Person) RETURN other.name`. `WHERE` filters on properties the same way SQL does, but Cypher spells inequality `<>` rather than `!=`: `MATCH (p:Person) WHERE p.name <> 'Patty' RETURN p`. Multi-hop patterns chase relationships transitively in a single statement — the book's "friends of friends" query, `MATCH (fof:Person)-[:friends]-(f:Person)-[:friends]-(p:Person {name: "Patty"}) RETURN fof.name`, walks two `friends` relationships in one pattern and returns everyone two hops from Patty, with no self-join, no recursive CTE, and no application-side loop.

**`MERGE`** is Cypher's match-or-create verb — an upsert for graph patterns. Where `CREATE` always inserts a new node or relationship (running the same `CREATE` statement twice produces two nodes), `MERGE` first tries to `MATCH` the given pattern and only falls back to `CREATE` if nothing matched, making a script that builds out a graph safe to re-run without duplicating data. `MERGE` also supports `ON CREATE SET` and `ON MATCH SET` clauses to apply different property updates depending on which branch actually ran.

**Deleting** has a sharp edge the book calls out directly: "you can't delete a node that still has relationships associated with it." Removing a connected node is therefore a two-step dance — delete the relationship, then the node:

```
MATCH ()-[r:short_lived_relationship]-()
  DELETE r
MATCH (e:EphemeralNode)
  DELETE e
```

And to wipe an entire graph in one shot, relationships have to be matched and deleted alongside their nodes: `MATCH (n) OPTIONAL MATCH (n)-[r]-() DELETE n, r` — with the book's own warning attached: "beware! This command will delete the entire graph that you're working with."

### A MATCH is a traversal, not a filter

This is the point where the graph model stops being a metaphor. In a relational engine, `WHERE` filters rows out of a table scan or an index range; there's no "walking" involved. In Neo4j, `MATCH (a:Person {name:"Alice"})-[:KNOWS]->(b) RETURN b` really does execute as a graph traversal: the engine looks up `Alice` once (via a label+property index, the same mechanism the book's constraint section relies on), then follows the physical `KNOWS` relationship pointers stored on that node outward, hop by hop, exactly the way a `MATCH` pattern with more `-->` segments (or a variable-length `[:KNOWS*]`) keeps walking further out. The trace below builds a small `Person`/`KNOWS` graph rooted at Alice and walks it exactly this way: one hop for Alice's direct contacts, a second hop for friends-of-friends, and a third hop beyond that — the same shape as the book's own "friends of friends of Alice" query, just followed one relationship at a time instead of collapsed into a single multi-hop pattern.

```viz
type: graph
node ALICE Alice 1 2
node BOB Bob 3 1
node CAROL Carol 3 3
node DANA Dana 5 1
node EVE Eve 5 3
node FRANK Frank 7 1
edge ALICE BOB directed
edge ALICE CAROL directed
edge BOB DANA directed
edge CAROL EVE directed
edge DANA FRANK directed
---
visit ALICE | MATCH (a:Person {name: "Alice"}) anchors the pattern -- Neo4j uses a label+property index lookup to jump straight to Alice's node rather than scanning every Person.
traverse ALICE BOB | -[:KNOWS]-> is followed as a pointer chase, not a join: Cypher walks the physical KNOWS relationship record straight from Alice to Bob.
mark BOB | Bob matches (a)-[:KNOWS]->(b) and joins the result set for "everyone Alice knows" directly.
traverse ALICE CAROL | The engine walks Alice's other outgoing KNOWS relationship just as directly, with no separate index lookup needed -- the relationship itself is the access path.
mark CAROL | Carol also matches and joins the result set.
traverse BOB DANA | Extending the pattern to (a)-[:KNOWS*2]->(b) walks one more hop, from Bob to Dana, the same pointer-chasing way.
mark DANA | Dana is two hops from Alice -- a friend of a friend, not yet in the one-hop result set.
traverse CAROL EVE | The same second hop from Carol's side of the graph.
mark EVE | Eve is also a friend of a friend.
traverse DANA FRANK | A third hop, three degrees out from Alice.
mark FRANK | However far the variable-length KNOWS* pattern reaches, every hop is a pointer chase, never a join -- this is the mechanical reason graph-shaped queries stay fast as they get deeper.
```

Compare this to how the same "who does Alice know, two hops out" question would run relationally: a self-join on a `friendships` table (or two joins across a junction table), with the query planner deciding whether an index makes that join cheap. Here there is no join to plan — the relationship pointers *are* the index, which is exactly why the book frames Cypher's multi-hop patterns as reading "like plain English" rather than like nested SQL.

### Indexes and constraints, briefly

Neo4j "doesn't enable you to enforce hard schemas the way that relational databases do," but indexes and constraints add optional structure per label/property pair: an index speeds up lookups on a property without changing how queries are written, and a uniqueness constraint (`CREATE CONSTRAINT ON (w:Wine) ASSERT w.name IS UNIQUE` in the book's syntax) rejects writes that would violate it — and, notably, is checked retroactively against existing data the moment it's created. As the book puts it, "although Neo4j isn't fundamentally schema-driven the way that relational databases are, indexes and constraints will help keep your queries nice and fast and your graph sane. They are an absolute must if you want to run Neo4j in production."

### Book vs today

The book documents Neo4j 3.1.4 (2018-era). Checked against current Neo4j/Cypher documentation:

> **Index and constraint DDL syntax has changed; the old forms were removed, not just deprecated.** The book's `CREATE INDEX ON :Wine(name)` / `DROP INDEX ON :Wine(name)` and `CREATE CONSTRAINT ON (w:Wine) ASSERT w.name IS UNIQUE` were Cypher 3.x syntax. Current Neo4j replaces `ON` with `FOR` and `ASSERT` with `REQUIRE`, and supports an optional name and `IF NOT EXISTS`: `CREATE INDEX [index_name] [IF NOT EXISTS] FOR (n:Wine) ON (n.name)` and `CREATE CONSTRAINT [constraint_name] [IF NOT EXISTS] FOR (w:Wine) REQUIRE w.name IS UNIQUE`. Running the book's exact syntax against a current server doesn't just warn — it throws: *"Invalid constraint syntax, ON and ASSERT should not be used. Replace ON with FOR and REQUIRE."* Scripts written against the book's syntax need updating, not just a suppressed deprecation notice.
> **`DETACH DELETE` exists in current Cypher and does what the book's manual two-step avoids.** `DETACH DELETE e` deletes a node and every relationship attached to it in one statement, rather than requiring the relationship-then-node dance Day 1 teaches. Whether `DETACH DELETE` was already present in the 3.1.4 release the book uses isn't confirmable from current documentation (which doesn't retain that kind of version history) — treat the book's two-step version as a deliberate teaching choice that makes the node/relationship distinction concrete, not evidence the syntax didn't exist yet. Either way, current best practice for "delete this node and everything connecting it" is the one-line `DETACH DELETE` form.
> **The core `CREATE (n:Label {props})` / `(a)-[r:TYPE]->(b)` syntax, `MATCH`/`WHERE`/`RETURN`, and `MERGE`'s match-or-create semantics are unchanged.** `MERGE` today also supports `ON CREATE SET` / `ON MATCH SET` clauses for branching property updates by which path actually ran — a natural next step past this concept's CRUD basics, not present in the book's excerpt. This is the stable core of Cypher across the whole 3.x-to-current span — everything else this concept teaches still works verbatim.
> **Cypher is no longer just "Neo4j's query language" — it's the direct ancestor of an ISO standard.** The book calls Cypher "Neo4j-specific," true at the time. Neo4j contributed Cypher to the openCypher initiative in 2015 so other graph databases could implement it, and in April 2024 ISO published **GQL (Graph Query Language)** — ISO/IEC 39075:2024 — as a formal international standard for property graph querying, the first new ISO database language standard since SQL. GQL was built directly on Cypher's foundation, with Neo4j engineers among the core standards-committee contributors; Neo4j's own framing is that "if you're already using Cypher or openCypher, you're already 95% there" toward GQL. Neo4j has since introduced "Cypher 25," an edition that aligns more closely with GQL syntax and semantics and is opted into per-query or per-session rather than replacing the classic dialect outright.
> **Neo4j dropped semantic versioning for CalVer starting January 2025.** There is no longer a single "Neo4j 5.x" to cite as current — releases are now dated like `2025.01` or `2026.07`, making "Neo4j 5" legacy branding for anyone checking documentation going forward.

## Trade-offs

- **Relationship-as-first-class-object is the entire value proposition — and it's also the modeling discipline you now own.** A relational many-to-many join table is an implementation detail; a Cypher relationship with its own type, direction, and properties is the model. That's exactly what makes rating-a-review or friends-since-a-date natural to store — but it also means every relationship needs a real, deliberate name and direction chosen up front (`reported_on`, `likes`, `friends`), the same design responsibility MongoDB pushes onto "embed or reference," just expressed through relationship types instead of document boundaries.
- **No schema means fast iteration and no safety net.** Adding a node with the `Wine` label and a wildly different property set than every other `Wine` node "just works" — nothing stops it. That is the same trade-off the document model makes (see the MongoDB concept in this track): dozens of shapes coexist without a migration, and nothing catches a typo'd property name at write time. Indexes and constraints claw back some of that safety per label/property pair, but they are opt-in, not the default.
- **Multi-hop pattern matching that reads like plain English is genuinely different from a relational JOIN, not just prettier syntax.** `MATCH (fof)-[:friends]-(f)-[:friends]-(p {name:"Patty"})` walks two relationships in one statement with no self-join and no recursive CTE. The cost of that expressiveness is that a graph query's performance depends on the shape and density of the actual relationships traversed — a "friend of a friend" query stays cheap on a sparse social graph and gets expensive fast on a dense one (a celebrity with a million followers), the same way a relational JOIN gets expensive on an unindexed foreign key, just discovered by a different mechanism.
- **`CREATE` vs `MERGE` is a sharp, easy-to-miss edge for anyone coming from `INSERT`.** Running the same `CREATE (w:Wine {name:"X"})` statement twice creates two separate Wine nodes with identical properties — there is no implicit primary key deduplicating them the way a relational `INSERT` would collide on one. `MERGE` gives you match-or-create semantics, but reaching for `CREATE` out of habit (because it reads like `INSERT`) silently duplicates data instead of erroring.
- **The relationship-before-node deletion rule is a correctness guardrail that reads as friction until you understand why.** Refusing to delete a node with live relationships attached prevents silently orphaned relationship records pointing at nothing — a graph-native equivalent of a foreign-key constraint, enforced unconditionally rather than only when you happen to declare one. `DETACH DELETE` is the convenience escape hatch once you've decided that's actually what you want.

## Documentation Links

- [Eric Redmond and Jim R. Wilson, "Seven Databases in Seven Weeks", 2nd Edition (Pragmatic Bookshelf, 2018) — Chapter 6, "Neo4J", Introduction and Day 1: "Graphs, Cypher, and CRUD"](https://pragprog.com/titles/rwdata2/seven-databases-in-seven-weeks-second-edition/) — doc
- [Neo4j Documentation — Cypher Manual: Clauses (CREATE, MATCH, WHERE, RETURN, MERGE, DELETE, DETACH DELETE)](https://neo4j.com/docs/cypher-manual/current/clauses/) — doc
- [Neo4j Documentation — Managing Indexes](https://neo4j.com/docs/cypher-manual/current/indexes/search-performance-indexes/managing-indexes/) — doc
- [Neo4j Documentation — Constraints: Examples](https://neo4j.com/docs/cypher-manual/current/constraints/examples/) — doc
- [Neo4j Documentation — GQL Conformance](https://neo4j.com/docs/cypher-manual/current/appendix/gql-conformance/) — doc
- [Neo4j Blog — openCypher, GQL, and the Cypher Implementation](https://neo4j.com/blog/cypher-and-gql/opencypher-gql-cypher-implementation/) — doc
- [ISO/IEC 39075:2024 — Information technology — Database languages — GQL](https://www.iso.org/standard/76120.html) — doc
