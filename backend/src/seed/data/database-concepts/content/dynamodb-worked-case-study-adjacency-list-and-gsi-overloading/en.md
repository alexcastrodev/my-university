---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Watch the adjacency-list pattern and GSI overloading survive contact with a real, "beefy" data model. The companion concept on many-to-many strategies teaches the adjacency list in isolation, with a clean two-entity example (movies and actors) where both directions flip cleanly through one secondary index. This concept is the stress test: Alex DeBrie's Chapter 21 re-creates GitHub's core metadata — Repos, Issues, Pull Requests, Comments, Reactions, Forks, Users, Organizations, Payment Plans — with 24 access patterns across nine entity types on one table. The chapter never once needs a fifth strategy. Instead it shows what actually happens when you run out of room in a single item collection: you don't invent a new pattern, you add another generically-named secondary index and let a different pair of entities overload it. By the end, the humble Repo item is carrying primary-key attributes plus three separate GSI key pairs, each one dedicated to a different relationship, and DeBrie says so explicitly: "Our Repo item is already pretty busy on the primary key, as it's handling relationships for both Issues and Stars... It's using GSI1 to handle Repo + Pull Requests, and it's using GSI2 to handle the hierarchical Fork relationship. Accordingly, we'll need to add a third secondary index."

## Use Cases

- Reviewing a design where one entity (here, Repo) is the hub of three or four different relationships, and deciding whether each relationship gets its own secondary index or whether two can share one — the same question this chapter answers for Issues vs. Pull Requests.
- Modeling a many-to-many relationship where the two directions have wildly different cardinality — GitHub's Users-to-Organizations, where a user belongs to a bounded handful of orgs but an org can have thousands of users — and picking a different strategy for each direction instead of forcing one pattern onto both.
- Designing a self-referential one-to-many relationship where the child is also, from a different vantage point, a full instance of the parent type — GitHub's Fork, which is a Repo pointing at another Repo — and needing to keep that pointer out of the base table's primary key.
- Auditing a table where an entity participates in `GSI1PK`/`GSI1SK`, `GSI2PK`/`GSI2SK`, and `GSI3PK`/`GSI3SK` simultaneously, and needing a mental model for why each index exists and what would break if one were dropped.
- Deciding, mid-design, whether a "relationship" needs to be a queryable item at all, or whether a filter expression, a denormalized counter, or a transaction is the cheaper fit — the four small decisions this chapter makes around Issue/PR status, star counts, and reaction counts.

## Deep Dive

### The shape of the problem before any keys get chosen

The chapter's ERD has nine entity types and 24 access patterns, grouped as Repo basics (get/create/list Repos, Issues, Pull Requests; fork a Repo; list Forks), Interactions (comment, react, star), User management (create User/Organization, manage membership), and Accounts & Repos (list Repos for an Account). DeBrie works through his usual three questions — simple or composite primary key, what's unusual about the requirements, which entity to model first — and lands on four "interesting requirements" worth naming because each one drives a specific technique later:

1. **A shared ID namespace.** Issue and Pull Request numbers are drawn from the same counter within a Repo — "if you had a repository with two issues and three pull requests, the next issue that was opened would receive an ID of 6."
2. **A shared name namespace.** Users and Organizations can't collide on name, because a repo is addressed as `<owner>/<repo>` regardless of whether the owner is a User or an Organization.
3. **A fork is a repo.** "A Fork for one person is a Repo for another." The one-to-many relationship between a Repo and its Forks has to be modeled without polluting the Repo's own primary key, because a forked Repo needs its own independent Issues, Pull Requests, and Stars.
4. **Reference counts and polymorphic targets.** Stars, Forks, and eight kinds of Reactions all need fast counts on the parent, and Reactions can target an Issue, a Pull Request, or a Comment interchangeably.

None of these get solved with a fifth many-to-many strategy. They get solved by combining the one-to-many and many-to-many toolkits the sibling concepts already cover — which is the point: a real model is mostly composition, not new invention.

### GSI overloading, entity by entity

`dynamodb-single-table-design` establishes that a table's `PK`/`SK` are overloaded by design — a generic name whose meaning depends on which entity's template produced the value. This case study shows the same trick applied to secondary indexes, and it's the more instructive version because you watch the *same physical Repo item* pick up a fourth overload as the model grows.

**Base table — Repo + Issue.** The Repo's one-to-many relationships (Issues, Pull Requests, Forks) are all unbounded, so denormalization is out; each needs the primary-key-plus-`Query` strategy from the one-to-many chapter. But that strategy's "parent in the middle" trick — sorting the parent between two differently-ordered children — only works for *one* relationship per item collection, because both Issues and Pull Requests need descending order and there's no way to place the Repo item so both directions read correctly at once. DeBrie picks Issues for the base table:

| Entity | `PK` | `SK` |
|---|---|---|
| Repo | `REPO#<Owner>#<RepoName>` | `REPO#<Owner>#<RepoName>` |
| Issue | `REPO#<Owner>#<RepoName>` | `ISSUE#<ZeroPaddedIssueNumber>` |

A `Query` with `ScanIndexForward=False` returns the Repo item and its most recent Issues in one request — the same item-collection mechanic the single-table-design concept walks through for Users and Orders.

**GSI1 — Repo + Pull Request.** Pull Requests lost the coin flip for the base table, so they get their own item (`PK`/`SK` built from `<Owner>#<RepoName>#<PRNumber>`, unique on its own) plus a second set of key attributes that only exist to place it alongside its Repo in an index:

| Entity | `GSI1PK` | `GSI1SK` |
|---|---|---|
| Repo | `REPO#<Owner>#<RepoName>` | `REPO#<Owner>#<RepoName>` |
| Pull Request | `REPO#<Owner>#<RepoName>` | `PR#<ZeroPaddedPRNumber>` |

This is GSI overloading in its plainest form: `GSI1PK` holds a Repo's own identity when written by a Repo item, and a *foreign* pointer back to the owning Repo when written by a Pull Request item. Two structurally different entity types share one generically-named attribute so that a single `Query` on the index returns both.

**GSI2 — the Fork hierarchy, where one entity overloads itself twice.** Forks can't be a first-class entity with their own item collection, because "a fork to one person is a repo to another" — the Fork *is* a Repo item. So GSI2 is built entirely out of Repo items, and the Repo item's own `GSI2PK`/`GSI2SK` attributes change meaning depending on the Repo's own state:

| Case | `GSI2PK` | `GSI2SK` |
|---|---|---|
| Original Repo | `REPO#<Owner>#<RepoName>` | `#REPO#<RepoName>` |
| Forked Repo | `REPO#<OriginalOwner>#<RepoName>` | `FORK#<Owner>` |

An original Repo's `GSI2PK` points at itself; a forked Repo's `GSI2PK` points at someone *else's* Repo entirely, grouping every fork of a given original into one item collection with the original sorted first (the `#` prefix on its `GSI2SK` forces that). This is the same attribute name doing two different jobs on the same entity type depending on a boolean the application has to get right at write time — there's no schema to enforce it.

**GSI3 — Account + Repo, added only because GSI1 and GSI2 were already spoken for.** The last access pattern, "fetch all Repos for an Account," needs its own item collection sorted by `UpdatedAt`. The Repo item can't reuse `GSI1PK`/`GSI1SK` (busy grouping it with Pull Requests) or `GSI2PK`/`GSI2SK` (busy grouping it with Forks), so a third GSI is the only option:

| Entity | `GSI3PK` | `GSI3SK` |
|---|---|---|
| User / Organization | `ACCOUNT#<AccountName>` | `ACCOUNT#<AccountName>` |
| Repo | `ACCOUNT#<AccountName>` | `+#<UpdatedAt>` |

Stack all four together and the Repo item alone carries: base-table `PK`/`SK` (shared with Issues), `GSI1PK`/`GSI1SK` (shared with Pull Requests), `GSI2PK`/`GSI2SK` (shared with Forks — of itself), and `GSI3PK`/`GSI3SK` (shared with its owning Account). Four overloaded key pairs, four different partners, one item.

### Adjacency list applied unevenly — Users and Organizations

The sibling concept's adjacency-list example (movies and actors) is symmetric: both directions go through a `Query`, one on the base table, one on a fully flipped secondary index. GitHub's Users-to-Organizations relationship is many-to-many too, but DeBrie deliberately treats its two directions differently, because their cardinality and mutability aren't symmetric:

- **User → Organizations (bounded, near-immutable): shallow duplication, not adjacency list.** "We don't have use cases where we need to fetch a User and detailed information about all Organizations... It wouldn't burden many Users to say they could only belong to, say, 40 Organizations." So the User item just gets an `Organizations` map attribute — org name to role — read with a single `GetItem`. No relationship item, no index.
- **Organization → Users (unbounded, keeps growing): a real relationship item, adjacency-list style.** "It's less reasonable to limit the number of Users that belong to an Organization... we don't want to use the denormalization strategy for Memberships." So Membership gets its own item, sharing the Organization's partition key:

| Entity | `PK` | `SK` |
|---|---|---|
| User / Organization | `ACCOUNT#<AccountName>` | `ACCOUNT#<AccountName>` |
| Membership | `ACCOUNT#<OrganizationName>` | `MEMBERSHIP#<UserName>` |

A `Query` on an Organization's item collection returns the Organization plus every Membership — one direction of the adjacency list, exactly as the sibling concept describes for Movie + Role. But there's no flipped GSI for the other direction, because the other direction was already solved more cheaply by shallow duplication. The lesson the sibling concept states in the abstract — "the four strategies are not exclusive, and the best designs mix them" — is what this design actually does, per direction, on a single relationship.

There's a second twist worth noting: User and Organization share an identical primary-key template (`ACCOUNT#<AccountName>` / `ACCOUNT#<AccountName>`), because they compete for the same name namespace (interesting requirement #2 above) and both need the same downstream access patterns (own Repos, own Payment Plan). A plain `Type` attribute — the same convention the single-table-design concept flags from Chapter 9 — is what tells them apart, since the key alone can't.

### Supporting techniques that show up alongside the two named patterns

These aren't the chapter's headline techniques, but they're what makes the adjacency list and GSI overloading usable in practice, and they recur constantly in real single-table designs:

- **Emulating an auto-increment.** Issue/PR numbers need a counter with no native DynamoDB equivalent. The fix is two requests: `UpdateItem` with `ReturnValues='UPDATED_NEW'` to atomically increment `IssuesAndPullRequestCount` on the Repo item and read back the new value, then `PutItem` for the Issue or PR using that value as its sort key. DeBrie is upfront that this costs an extra round trip: "it's the best way to get an auto-incrementing number that you use when creating a new item."
- **Filtering instead of modeling the filter into the key.** Open/Closed status for Issues and PRs is handled with a `FilterExpression`, not a key attribute, because there are only two values and pages are small (25 items). The chapter flags this as a bet to revisit in production rather than a settled answer.
- **Reference counts via `TransactWriteItems`.** Starring a Repo writes the Star item and increments `StarCount` on the Repo atomically — "the second part should not happen without the first." Reaction counts use the same transaction shape, plus a `Reactions` string-set attribute (via `ADD` with a `NOT contains` condition) to stop a user reacting with the same emoji twice.
- **A polymorphic edge that exists only to be checked, not queried.** The Reaction item's key — `<TargetType>REACTION#<Owner>#<RepoName>#<TargetIdentifier>#<UserName>` for both `PK` and `SK` — folds Issue, Pull Request, and Comment targets into one template. Unlike a Role item in the adjacency list, nobody ever queries this item collection; it exists purely as the other half of the transaction that guards against a duplicate reaction. Not every relationship item is there to be read.

## Trade-offs

- **GSI overloading multiplies write amplification per participating entity, and it's easy to undercount how many indexes one entity ends up in.** The Repo item here writes to the base table plus three GSIs on every mutation that touches its shared attributes — four physical write paths for what an ERD draws as one node. Estimating capacity from "one item per Repo" undercounts by 4x before you've added a fifth relationship.
- **The "parent in the middle" trick is a one-time budget per item collection, and this chapter shows exactly what happens when you spend it.** Issues and Pull Requests both wanted descending order in the same collection as their Repo; only one could have it. Recognizing that budget as already spent is what tells you a new GSI is needed — not a redesign of the base table.
- **Overloading the same attribute with two different meanings on the same entity type (GSI2 on Repo) is powerful and has zero enforcement.** An original Repo's `GSI2PK` points at itself; a forked Repo's `GSI2PK` points at a different Repo entirely. Get the conditional wrong at write time — write a fork with the original-Repo template, or vice versa — and the item lands in the wrong item collection with no error, no constraint, and no query that will surface the mistake until someone notices a fork missing from a list. This is the single-table-design concept's "referential integrity moves into your application" cost, concentrated onto one attribute.
- **Splitting a many-to-many relationship's two directions across different strategies is the right call here, but it doubles the number of decisions you have to get right.** Users-to-Organizations works because DeBrie tested each direction against the mutability/cardinality bar independently (bounded-and-shallow vs. unbounded-and-growing) rather than picking one strategy for the whole relationship. That's more design work than the sibling concept's symmetric movies-and-actors example, and it's easy to skip the second half of the analysis and default both directions to whichever pattern you reached for first.
- **A relationship item that exists only for a transaction (the Reaction edge) is cheap to model but easy to forget when reasoning about the table.** It has no query access pattern, so it won't show up in an access-pattern-first review unless you remember it exists to prevent double-counting, not to be read.
- **At 24 access patterns and nine entity types, the entity chart itself becomes load-bearing documentation.** DeBrie rebuilds it three times over the chapter as new attributes get added; without it, tracking which entity writes to which of `PK`/`SK`, `GSI1PK`/`GSI1SK`, `GSI2PK`/`GSI2SK`, and `GSI3PK`/`GSI3SK` — and why — is not something you can hold in your head. Treat the chart as a required deliverable of the design, not incidental notation.

## Documentation Links

- [Alex DeBrie, "The DynamoDB Book", v1.0.1 (2020) — Chapter 21, "Recreating GitHub's Backend", p. 369-412](https://www.dynamodbbook.com/) — doc
- [AWS Documentation — Best Practices for Managing Many-to-Many Relationships (adjacency list, materialized graph)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-adjacency-graphs.html) — doc
- [AWS Documentation — Global Secondary Indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html) — doc
- [AWS Documentation — DynamoDB Transactions (TransactWriteItems)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html) — doc
- [AWS Documentation — Best Practices for Designing and Using Partition Keys Effectively](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html) — doc
