---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Learn the four strategies the book gives for modeling many-to-many relationships in a single DynamoDB table — shallow duplication, adjacency list, materialized graph, and normalization with multiple requests — and, more importantly, learn the one question that decides between them: **is the information about the relationship immutable?** Many-to-many is where DynamoDB is at its weakest ("Many-to-many relationships are one of the more difficult areas for DynamoDB to handle"), and the strategies are ordered by how much mutability they can tolerate, not by elegance.

## Use Cases

- Modeling students and classes, movies and actors, or social-media follows — the book's own three examples of the shape — where you need to query *both* sides of the relationship and there is no linking table to join through.
- Deciding whether a list attribute on the parent item is enough (shallow duplication) or whether the relationship deserves its own item (adjacency list), before you commit to a `PK`/`SK` template you can't change later.
- Designing the inverted / flipped secondary index that makes the second direction of a many-to-many relationship readable in one `Query`, and knowing when to use `GSI1PK`/`GSI1SK` instead of literally flipping `PK` and `SK`.
- Reviewing a design where a display name change fans out into thousands of writes, and recognizing it as the exact situation the book says to solve with normalization plus `BatchGetItem` rather than more duplication.
- Evaluating whether a "graph-shaped" workload genuinely belongs in DynamoDB at all, or whether the materialized graph is being used as a substitute for a graph database.

## Deep Dive

### Why many-to-many is the hard case

A many-to-many relationship is one where "one type of object may belong to multiple instances of a different type of object and vice versa." The book's three examples: students and classes (a student takes many classes, a class has many students), movies and actors (a movie has many actors, an actor performs in many movies), and social-media friendships (each Twitter user can follow and be followed by many users).

The difficulty is stated precisely: **"Many-to-many relationships are tricky because you often want to query both sides of the relationship."** With students and classes, one access pattern fetches a student and that student's schedule; a *different* access pattern fetches a class and all the students in it. "This is the main challenge of many-to-many access patterns."

In a relational database you handle this with a linking table — each object table has a one-to-many relationship with the linking table, and you traverse both to find related records. DynamoDB cannot: "There are no joins in DynamoDB so spreading them across multiple tables and combining them at query time won't work." So the entire chapter is about how to *pre-join* the data at write time such that both directions are single-request reads.

### 1. Shallow duplication

The first strategy duplicates only a *subset* of the related entity's attributes onto the parent item. The book's example: classes and students, where the access pattern is "fetch a class and all of the students in the class" — but "when fetching information about a class, you don't need detailed information about each student. You only need a subset of information, such as a name or an ID. Our user interface will then provide a link to click on the student for someone that wants more detailed information."

Concretely, the Class item gets a `Students` attribute of type list containing the names of the enrolled students. That access pattern is now a **single `GetItem`** — not even a `Query`.

The strategy works when *both* of two properties hold:

1. **There is a limited number of related entities.** DynamoDB items have a 400 KB limit, so — exactly like the "denormalization with a complex attribute" strategy from the one-to-many chapter — this fails with a high or unbounded number of related entities.
2. **The duplicated information is immutable.** "If the information is frequently changing, you will spend a lot of time looking for all the references to the data and updating accordingly. This will result in additional write capacity needs and potential data integrity issues." The book flags its own example against this test: copying the student's *name* is fine because a name is immutable (or close to it); if the access pattern needed the student's GPA or graduation date, "this strategy wouldn't work as well."

And a limitation that's easy to miss: **shallow duplication only solves one direction.** You still have to model "fetch a student and all classes the student is enrolled in" separately. But that's progress — "by using this pattern, you have taken out one side of the many-to-many relationship. You can now handle the other side using one of the one-to-many relationship strategies from the previous chapter."

### 2. Adjacency list

The second strategy is the one that generalizes. You model each top-level entity as an item, **you also model the relationship itself as an item**, and then you arrange the keys so that a single request returns the top-level entity together with its relationship items.

The book's example is movies and actors, with three item types:

| Item type | `PK` | `SK` |
|---|---|---|
| Movie | `MOVIE#<MovieName>` | `MOVIE#<MovieName>` |
| Actor | `ACTOR#<ActorName>` | `ACTOR#<ActorName>` |
| Role | `MOVIE#<MovieName>` | `ACTOR#<ActorName>` |

Movie and Actor are the top-level items; **the Role item *is* the many-to-many relationship** between them. Because a Role shares its partition key with its Movie, the Movie item and all of its Role items land in the same item collection — so "we can fetch a movie and actor roles that played in the movie with a single request by making a `Query` API call that uses `PK = MOVIE#<MovieName>` in the key condition expression."

The other direction comes from a secondary index that **flips the composite key elements**: in the index, the partition key is `SK` and the sort key is `PK`. "Now our Actor item is in the same item collection as the actor's Role items, allowing us to fetch an Actor and all roles in a single request."

This is a genuine graph structure, not a metaphor: the Movie and Actor items are nodes, the Role items are edges, and a `Query` on one partition key *is* a one-hop traversal. That's what the animation below walks through — two movies, two actors, three roles, seven items total: one `Query` on the base table gets a movie and its roles, one `Query` on the flipped index gets an actor and his roles.

```viz
type: graph
node MTOY ToyStory 0 1
node MCAST CastAway 0 4
node RTA Role1 2 0
node RTH Role2 2 2
node RCH Role3 2 4
node AALLEN Allen 4 0
node AHANKS Hanks 4 3
edge MTOY RTA directed
edge MTOY RTH directed
edge MCAST RCH directed
edge AALLEN RTA directed
edge AHANKS RTH directed
edge AHANKS RCH directed
---
visit MTOY | Query the base table with PK = MOVIE#ToyStory. First item back is the Movie item itself (SK = MOVIE#ToyStory), carrying the mutable attributes -- box office receipts, IMDB score.
traverse MTOY RTA | Same item collection, so the same Query response: Role1, SK = ACTOR#TimAllen. It sorts before ACTOR#TomHanks, so it comes back first.
visit RTA | A Role item IS the edge. It holds only what is true about the performance -- the character played, the billing order -- and none of that ever changes.
traverse MTOY RTH | Next item in the collection: Role2, SK = ACTOR#TomHanks.
visit RTH | One Query has now returned the Movie plus every Role in it. No join, no second call: the pre-join was materialized at write time.
mark MCAST | Cast Away sits under a different partition key, so that Query never read it and was never charged for it.
visit AHANKS | Opposite direction now: Query the inverted index (index PK = SK, index SK = PK) with ACTOR#TomHanks. His Actor item, with its own mutable attributes, comes back first.
traverse AHANKS RTH | In the index, Hanks and his Role items share an item collection. Role2 again -- the exact same physical item, read from the other side.
traverse AHANKS RCH | And Role3, his role in Cast Away. One Query: the actor plus every movie he was in.
visit RCH | Nothing was duplicated to make both directions work. Only the keys were rearranged by the index.
traverse MCAST RCH | Walking Role3 back the other way reaches the Cast Away Movie item -- the shared Hanks node is what makes this many-to-many rather than two separate one-to-manys.
visit MCAST | Cast Away's own collection on the base table answers "who was in Cast Away" with its own single Query, same as Toy Story did.
traverse AALLEN RTA | Tim Allen's collection in the index holds Role1 only -- an actor with one credit is just the degenerate case of the same shape.
visit AALLEN | Seven items, two Query calls, every node reached. That is the whole adjacency list.
```

The property that makes this pattern good is worth stating carefully, because it is the reason it beats shallow duplication: **it lets you mix mutable and immutable information in both access patterns.** The Movie item has attributes that change over time — total box office receipts, IMDB score. The Actor item has mutable attributes too, such as total upvotes received. "With this setup, we can edit the mutable parts—the Movie and Actor items—without editing the immutable Role items. The immutable items are copied into both item collections, giving you a full look at the data while keeping updates to a minimum."

Hence the condition: "This pattern works best when the information about the relationship between the two is immutable." A movie role is ideal — nothing about the role an actor played changes after the fact.

One practical note on the index. Flipping `PK` and `SK` wholesale is often called an **inverted index**, but "if you have other items in your table, you may not want to flip the `PK` and `SK` for those items, as this may not enable the access patterns you want." The fix is to create two new attributes, `GSI1PK` and `GSI1SK`, holding the flipped values *only* on the items in the many-to-many relationship, and index those. Sparse-index behavior does the rest: items without the attributes simply don't appear.

### 3. Materialized graph

"A powerful but less-commonly used strategy." A graph is nodes and edges — a node is an object or concept (a person, a place, a thing), and edges indicate relationships between nodes. A person is a node, the city of Omaha, Nebraska is a node, and "one person might live in Omaha, Nebraska and that relationship would be represented by an edge."

The DynamoDB shape: create your nodes as an item collection in the base table, then use a secondary index to **reshuffle those items and group them according to particular relationships**. The book's example is its author's own data — Node ID `156` is the Person node for Alex DeBrie, and rather than one item with every attribute, it's broken across several items: one for the day he was married, one for his job, with the same done for his wife and for Atticus Finch.

The secondary index is where it pays off. In the index, new groupings appear: the partition for the date **May 28, 2011** contains an edge from both him and his wife, representing the wedding — "You could imagine other items in there to represent births, deaths, or other important events." The `JOB|Attorney` partition holds two items, one per person with that job. Critically, "the `NodeId` is present on both items, so you could make follow-up requests to reconstitute the parent node by querying the base table for the given Node Id" — the index gives you the edge, the base table gives you the node.

The verdict is useful precisely because it's unenthusiastic: "The materialized graph pattern can be useful for highly-connected data that has a variety of relationships. You can quickly find a particular type of entity and all the entities that relate to it. That said, I don't have a deeper example that shows the materialized graph in practice, as it's a pretty niche pattern."

### 4. Normalization and multiple requests

The escape hatch, for "when there is information that is highly mutable and heavily duplicated across your related items. In this situation, you might need to bite the bullet and make multiple requests to your database."

The book's canonical example is a Twitter-style follow graph. The "people I'm following" screen shows, for each followed user, their **display name** and **profile description** — both mutable. If each following relationship were a self-contained DynamoDB item carrying that display data, then "we would need to update a user's follower items each time the user changed their display name or profile. This could add a ton of write traffic as some users have thousands or even millions of followers!"

So — "rather than having all that write thrashing, we can do a little bit of normalization (eek!)":

| Item type | `PK` | `SK` |
|---|---|---|
| User | `USER#<Username>` | `USER#<Username>` |
| Following | `USER#<Username>` | `FOLLOWING#<Username>` |

The Following item is deliberately **sparse** — "it contains only the basics about the relationship between the two users," the username and perhaps when the follow started. Reads then become a two-step process:

1. **`Query`** the user's item collection to fetch the User item plus the initial Following items — who they are, and the first page of who they follow.
2. **`BatchGetItem`** the detailed User items for each Following item found, which "will provide the authoritative information about the followed user, such as the display name and profile."

The book does not dress this up: "Note that this isn't ideal as we're making multiple requests to DynamoDB. However, there's no better way to handle it. If you have highly-mutable many-to-many relationships in DynamoDB, you'll likely need to make multiple requests at read time."

The second example is the one worth stealing, because it's a *hybrid*: an e-commerce shopping cart. When a customer adds an item, you duplicate some of it into the cart — size, price, item number. But "as the user goes to check out, you need to go back to the authoritative source to find the current price and whether it's in stock." Shallow duplication is good enough to render the cart badge and an estimated total; the authoritative read happens once, at the moment correctness actually matters.

### The chapter's own summary

| Strategy | Notes | Relevant examples |
|---|---|---|
| Shallow duplication | Good when a parent entity only needs minimal information about related entities | Chapter 20 |
| Adjacency list | Good when information about the relationship is immutable or infrequently changing | Chapter 21 |
| Materialized graph | Good for highly-interconnected data with a variety of relationships | Knowledge graph |
| Normalization and multiple requests | Fallback option for when you have highly-mutable data contained in the relationship | Social network recommendations |

Read down the "Notes" column and the ordering is a mutability gradient: minimal-and-immutable, immutable relationship, many relationship types, highly mutable.

### Book vs. today: the patterns are now AWS's own, and AWS itself now names the exit

Nothing here has been deprecated — this chapter reads as current. Two things have firmed up since April 2020:

> **Adjacency list and materialized graph are AWS's official vocabulary, with the same shape.** The DynamoDB Developer Guide page *Best practices for managing many-to-many relationships* documents exactly these two patterns by name. Its adjacency-list example is invoices and bills rather than movies and actors, but the mechanics are identical — top-level entities are partition keys, "any relationships with other entities (edges in a graph) are represented as an item within the partition by setting the value of the sort key to the target entity ID," and "to look up all invoices that contain a part of a bill, create a global secondary index on the table's sort key." AWS also names the advantage the book emphasizes: **minimal data duplication**. The materialized graph section goes further than the book does, spelling out an overloaded `Data` attribute indexing dates, names, places, and skills in one GSI, a `TypeTarget` composite (`Friend-Person-2`) for reverse lookups, and an explicit warning to shard large aggregations (birthdate, skill) across logical partitions to avoid hot keys.

> **AWS now tells you when to leave.** DeBrie called the materialized graph "a pretty niche pattern" and offered no deep example; AWS's own guidance now closes that loop — "if you need to query highly connected datasets or traverse multiple nodes (multi-hop queries) with millisecond latency, consider using Amazon Neptune," a purpose-built graph engine, and it recommends Neptune specifically for real-time second- and third-level relationship aggregations. So the honest 2026 reading of section 12.3 is: it's a legitimate pattern for one-hop-plus-reshuffle graph reads inside a table you already have, and a signal to evaluate a graph database if you find yourself wanting two hops.

> **PartiQL changes nothing here.** DynamoDB gained PartiQL support in late 2020, after the book shipped, so the chapter never mentions it. It gives you SQL-*looking* statements but adds **no joins** — which means the linking-table approach the chapter rules out on page one is still ruled out. The adjacency list is still how you get a join-shaped answer.

## Trade-offs

- **The adjacency list is the right default, and it still bakes in a query direction.** It's the pattern the book leans on for its two biggest worked examples (Chapters 19-21) and the one AWS documents first, because it duplicates almost nothing and answers both directions in one `Query` each. But "both directions" costs a GSI, and the GSI's key attributes are a design-time decision: the base table's `PK`/`SK` template — `MOVIE#<MovieName>` / `ACTOR#<ActorName>` — encodes which side is the partition. A third relationship direction, or a relationship with a *third* entity type, is a new set of key attributes backfilled onto every existing Role item. What looks like a symmetric graph is really two asymmetric access patterns you chose in advance.
- **The adjacency list's immutability condition is on the *edge*, and edges mutate more often than you'd think.** "This pattern works best when the information about the relationship between the two is immutable." A movie role genuinely qualifies. An order line item with a fulfillment status, a class enrollment with a grade, a team membership with a role that gets promoted — those don't, and every mutable attribute on an edge item that also lives on a node item is a fan-out write you now own. Test your candidate relationship against the movie-role bar honestly before adopting the pattern; "infrequently changing" (the summary table's wording) is doing real work in that sentence.
- **Shallow duplication caps out fast, and it caps out silently.** Two hard walls: the 400 KB item limit, and immutability. Neither announces itself in dev — a Class item with twelve students in a list attribute works beautifully, and so does the code path that writes it. The failure arrives in production as either an item-size rejection on a popular class or a support ticket about a stale name. And it only ever solves *one* direction, so it is a half-strategy by construction: you always pair it with something else. Its right use is the one the book models with the shopping cart — a cheap approximate read now, with an authoritative read later at the point where being wrong is expensive.
- **The materialized graph buys expressiveness with write-path complexity you maintain by hand.** Every edge is an item, every edge item needs its GSI attributes set correctly for the reshuffle to work, and deleting a node means finding and deleting every edge that points at it — with no cascade, no foreign key, and no transaction that spans more items than `TransactWriteItems` allows. AWS's own guidance layers more on: overloaded index attributes, a `TypeTarget` composite, and a deliberate sharding strategy for high-cardinality aggregations. The book's "pretty niche pattern" plus the absence of a deeper worked example is a fair warning: the read patterns are impressive, the write-side bookkeeping is entirely yours, and multi-hop traversal — the thing people actually want a graph for — is still not something this gives you.
- **Normalization with multiple requests is a legitimate answer, not a failure.** It deserves naming plainly because the single-table-design culture around DynamoDB treats extra round trips as defeat. The book doesn't: "there's no better way to handle it." When relationship data is highly mutable and heavily duplicated, the write amplification of keeping it fresh is strictly worse than the read amplification of fetching it — a display-name change that fans out to a million follower items is not a trade you win by being clever. The cost is real and should be sized honestly: one `Query` plus one `BatchGetItem` per page of results, `BatchGetItem` bounded at 100 items and 16 MB per call, partial responses to handle via `UnprocessedKeys`, no cross-request consistency, and a latency floor of two sequential round trips instead of one.
- **The four strategies are not exclusive, and the best designs mix them.** The shopping-cart example is shallow duplication *and* an authoritative re-read. The Twitter example is normalization for the mutable fields while the Following item still carries the immutable ones. Choosing per-attribute — which fields are immutable enough to duplicate, which must be read from the source — gets you further than choosing one strategy per relationship.
- **Every one of these strategies moves referential integrity into your application, and many-to-many is where that hurts most.** A relational linking table has two foreign keys and a cascade. Here, an edge item can point at a node that no longer exists, an inverted index can be missing `GSI1PK` on an item someone wrote through a path that forgot to set it, and nothing in the database will tell you. That's the standing cost of pre-joining at write time; the many-to-many case just has twice as many pointers to get wrong.

## Documentation Links

- [Alex DeBrie, "The DynamoDB Book", v1.0.1 (2020) — Chapter 12, "Strategies for many-to-many relationships", p. 200-214](https://www.dynamodbbook.com/) — doc
- [AWS Documentation — Best Practices for Modeling Relational Data in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-relational-modeling.html) — doc
- [AWS Documentation — Best Practices for Managing Many-to-Many Relationships (adjacency list, materialized graph)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-adjacency-graphs.html) — doc
- [AWS Documentation — Global Secondary Indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html) — doc
- [AWS Documentation — BatchGetItem API reference (100 item / 16 MB limits)](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchGetItem.html) — doc
