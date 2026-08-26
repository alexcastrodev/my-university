---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Learn how to filter data in DynamoDB without paying for it twice. The chapter opens with the constraint that shapes everything else in it: "filtering in DynamoDB is almost exclusively focused on your primary key. You have to understand how to model, query, and index your primary keys in order to get the most out of DynamoDB." The goal here is the two techniques that turn that constraint into an advantage — **composite sort keys** (concatenating two attributes into one sort key so a single `Query` can filter on both) and **sparse indexes** (a GSI that only contains the subset of items that have its key attributes, so the index itself does the filtering) — and why both beat reaching for a `FilterExpression`, which the book warns "is applied after items are read, meaning you pay for all of the items that get filtered out."

## Use Cases

- A customer's order history where the UI needs "all CANCELLED orders between July 1 and September 30" — filtering on two attributes (status, date) in one request, where a plain sort key on date alone would force scanning every order and discarding non-matches.
- A SaaS table with Organizations and Users where an access pattern needs "all Admins in this Organization" — a small, rare subset of a potentially large item collection — without reading every User item to throw most of them away.
- An e-commerce table with Customers, Orders, and InventoryItems interleaved in the same partitions, where a marketing job needs "every Customer" — one entity type pulled out of a multi-entity table without a full-table `Scan`.
- Deciding, at the API-design stage, whether a "filter by status" query parameter should compile to a key condition (composite sort key) or a `FilterExpression` — the choice that determines whether `Limit=10` reliably returns 10 items or requires overfetching and follow-up requests.
- Reviewing an existing access pattern that leans on `FilterExpression` for a low-selectivity condition over a large result set, and recognizing it as a modeling gap to fix with a GSI, not a query-time optimization to tune.

## Deep Dive

### Composite sort keys: concatenation as a data-modeling tool

A composite sort key is not the same thing as a composite primary key — the book is careful to flag the naming collision: "A composite primary key is a technical term of when a primary key has two elements: a partition key and a sort key. A composite sort key is a term of art to indicate a sort key value that contains two or more data elements within it."

The motivating example: an e-commerce table where `CustomerId` is the partition key, and users want a report of orders filtered by both `OrderStatus` and a date range. Filtering only on date (a simple sort key) would return every status and force discarding most of it after the fact — "For customers that have placed a lot of orders, this could be an expensive operation to retrieve all orders and filter out the ones that don't match."

The fix: derive a new attribute, `OrderStatusDate`, by concatenating `OrderStatus` and `OrderDate` with a separator — `CANCELLED#2019-07-01T00:00:00.000000` — and build a GSI with `CustomerId` as partition key and `OrderStatusDate` as sort key. The query becomes a single `KeyConditionExpression`:

```python
result = dynamodb.query(
    TableName='CustomerOrders',
    IndexName="OrderStatusDateGSI",
    KeyConditionExpression="#c = :c AND #osd BETWEEN :start and :end",
    ExpressionAttributeNames={
        "#c": "CustomerId",
        "#osd": "OrderStatusDate"
    },
    ExpressionAttributeValues={
        ":c": { "S": "2b5a41c0" },
        ":start": { "S": "CANCELLED#2019-07-01T00:00:00.000000" },
        ":end": { "S": "CANCELLED#2019-10-01T00:00:00.000000" }
    }
)
```

The pattern only works in one direction, and the book states the two conditions precisely:

1. "You always want to filter on two or more attributes in a particular access pattern."
2. "One of the attributes is an enum-like value."

Order matters because of how the resulting values sort: "Notice how our items are sorted in our secondary index. They are sorted first by the OrderStatus, then by the OrderDate. This means we can do an exact match on that value and use more fine-grained filtering on the second value." Reversing it breaks the pattern entirely: "This pattern would not work in reverse. If you made your composite sort key to be `<OrderDate>#<OrderStatus>`, the high cardinality of the OrderDate value would intersperse items such that the OrderStatus property would be useless." The low-cardinality field has to come first so equal-prefix items cluster together for the range condition on the second field to mean anything.

The same mechanism, without the enum requirement, powers the simpler "assembling different collections" pattern from earlier in the chapter: prefixing sort keys with type markers like `ISSUE#`, `REPO#`, `STAR#` inside one item collection, then bounding a `Query` with `#sk <= :sk` or `#sk >= :sk` anchored on the `REPO#` value to fetch a Repo plus only its Issues (or only its Stars) — filtering by exploiting sort order rather than by matching a value.

### Sparse indexes: the index that leaves items out on purpose

A secondary index only contains items from the base table that have every attribute in that index's key schema — "When you write an item into your base table, DynamoDB will copy that item into your secondary index if it has the elements of the key schema for your secondary index. Crucially, if an item doesn't have those elements, it won't be copied into the secondary index." A sparse index is one where this exclusion is deliberate: "a sparse index is one that intentionally excludes certain items from your table to help satisfy a query."

The book distinguishes an *incidentally* sparse index — an overloaded GSI shared by several entity types where one type simply has fewer access patterns and so is underrepresented — from an *intentionally* sparse one, which shows up in two shapes:

**1. Global filter on a subset of one entity type.** An Organization/Member SaaS table needs "all Admin Users in this Organization." Instead of tagging every User with a role and filtering after the read, only *Admin* Users get `GSI1SK = "Admin"` written at all — regular Members simply don't have the attribute, so they never land in the index: "we would add an attribute to only those User items which have Administrator privileges in their Organization... Charlie Munger does not [have a GSI1SK value], as he is not an admin." The `Query` against that GSI returns nothing but Admins — no filter step needed, because the non-matching items were never copied in.

**2. Isolating a single entity type across a multi-entity table.** In a table interleaving Customers, Orders, and InventoryItems, marketing wants "every Customer" for an email blast. Scanning the base table and discarding non-Customers "is a big waste of time and of my table's read capacity." Instead, only Customer items get a `CustomerIndexId` attribute; the GSI keyed on that attribute ends up containing Customers exclusively, so even a `Scan` against that narrow index is cheap because there's nothing else in it to walk past.

Both shapes share the same trick: push the filtering decision to *write time* (which items get the key attribute) instead of *read time* (which items get discarded after being read). The book notes the second shape "does not work with index overloading" — it needs a dedicated index projecting one entity type, whereas the Admin-filter shape deliberately reuses an already-overloaded index.

### Why `FilterExpression` isn't the answer to either problem

Both techniques exist because the obvious alternative — a `FilterExpression` — filters *after* the read: "a filter expression is applied after items are read, meaning you pay for all of the items that get filtered out and you are subject to the 1MB results limit before your filter is evaluated. Because of this, you cannot count on filter expressions to save a bad model. Filter expressions are, at best, a way to slightly improve the performance of a data model that already works well." The book's own threshold for when a `FilterExpression` is still acceptable: "at least a 30-40% hit rate on my filter OR if the total result size before the filter is pretty small... If your hit rate is lower than that and you have a large result set, you're wasting a ton of extra read capacity just to throw it all away."

There's a second, subtler cost beyond wasted capacity: `Limit` stops counting *before* the filter runs, so a paginated API that promises "10 items per page" can't guarantee it under a `FilterExpression` — "you don't know how many items you will need to fetch to ensure you get ten orders to return to the client... you'll likely need to vastly overfetch your items or have cases where you make follow-up requests." A composite sort key sidesteps this entirely: "you know that you can add a `Limit=10` parameter into your request and retrieve exactly ten items," because the filtering already happened via the key condition, not after the fact.

The chapter closes its filtering taxonomy with client-side filtering — pulling a small (sub-1MB), already-narrowed result set to the application and letting it handle arbitrary conditions, sorts, or full-text search. The book quotes Rick Houlihan on the rationale: "the browser is sitting in a 99% idle loop. Give it something to do!" This is explicitly a last resort for cases where the filter itself is awkward to model (a calendar's free/busy gaps) or the dataset is already small — not a substitute for the key-based strategies above on a large item collection.

### Book vs today: sparse indexes still current, composite sort keys got a native alternative

**Sparse indexes are unchanged and still the recommended pattern.** AWS's current developer guide has a dedicated best-practices page titled "Take advantage of sparse indexes," describing the identical mechanism the book documents: a GSI's key attributes act as an implicit filter, since only items carrying every key attribute get copied into the index. The companion "Overloading Global Secondary Indexes" page also matches the book's terminology precisely. Nothing about this mechanic has changed since 2020.

**Composite sort keys gained a native alternative in late 2025.** As of November 2025, AWS added multi-attribute composite keys for GSIs: partition keys and sort keys can each be composed of up to four attributes (previously exactly one each), for up to eight attributes total in a key schema. AWS's own framing of the change directly addresses the manual-concatenation technique this chapter teaches: "you no longer need to manually concatenate values into synthetic keys, which sometimes result in the need to backfill data before adding new indexes." With native multi-attribute keys, conditions can be applied left-to-right across the actual attributes (e.g., query by `UserId`, then narrow by `Country`, then `State`, then `City`) instead of parsing a hand-built `OrderStatus#OrderDate` string.

This doesn't invalidate the chapter's reasoning — the underlying logic (low-cardinality field first, enum-like values work best, the goal is a key condition instead of a filter) still applies identically to a native multi-attribute key. What changes is the *mechanics*: no more building and maintaining a derived string attribute by hand at write time, and no backfill migration required just to add the extra filtering dimension to an existing index. The concatenation pattern from the book remains valid (and is still the only option on base-table primary keys and on tables/GSIs that haven't adopted the new feature), but for a new GSI on a table using a current DynamoDB SDK, multi-attribute keys are now the more direct way to get the same result.

## Trade-offs

- **Composite sort keys buy multi-attribute filtering at the cost of a derived, hand-maintained attribute (unless using native multi-attribute keys).** Every write has to correctly (re)compute the concatenated value, and the ordering of the concatenated parts is a one-way design decision — get the enum-first ordering backwards and the whole pattern collapses, with no query-time fix available; you'd need to backfill a new attribute and a new index.
- **Sparse indexes trade write-time discipline for read-time cheapness.** The filtering logic moves from "evaluate a condition on every read" to "decide whether to write an attribute on each write" — which means a bug in write-path logic (an Admin flag not set, a `CustomerIndexId` accidentally added to a non-Customer item) silently corrupts the index's completeness rather than surfacing as a query error.
- **Both techniques are only cheaper than `FilterExpression` when the filter condition is knowable at write time.** They work great for status/role/type flags known when the item is created or updated. They don't help with filters computed from data the application doesn't have yet at write time (e.g., "orders that will become overdue by end of day") — for genuinely dynamic conditions, `FilterExpression` or client-side filtering remain the only options, with their attendant costs.
- **The book's 30-40% hit-rate threshold for `FilterExpression` is a rule of thumb, not a hard cutoff.** It's a reasonable trigger for asking "should this be a sparse index or composite key instead?" but the real question is always the size of the discarded, billed-for portion of the read — a filter with an 80% hit rate against a 5MB pre-filter result set is still expensive in absolute terms, threshold or not.
- **Native multi-attribute keys (2025+) remove the concatenation maintenance burden but are not retroactive.** Existing tables and GSIs built with the concatenation pattern keep working exactly as documented — nothing forces a migration — but adopting the newer mechanism on an existing index means creating a new GSI and migrating traffic to it, the same operational cost as any other secondary-index change.

## Documentation Links

- [Alex DeBrie, "The DynamoDB Book", v1.0.1 (2020) — Chapter 13, "Strategies for filtering", p. 209-232](https://www.dynamodbbook.com/) — doc
- [AWS Documentation — Take Advantage of Sparse Indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-indexes-general-sparse-indexes.html) — doc
- [AWS Documentation — Best Practices for Using Sort Keys to Organize Data](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-sort-keys.html) — doc
- [AWS Documentation — Overloading Global Secondary Indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-gsi-overloading.html) — doc
- [AWS What's New — Amazon DynamoDB now supports multi-attribute composite keys in global secondary indexes (November 2025)](https://aws.amazon.com/about-aws/whats-new/2025/11/amazon-dynamodb-multi-attribute-composite-keys-global-secondary-indexes) — doc
- [AWS Documentation — Best Practices for Using Secondary Indexes in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-indexes.html) — doc
- [AWS Documentation — Filter Expressions for Query and Scan](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.FilterExpression.html) — doc
