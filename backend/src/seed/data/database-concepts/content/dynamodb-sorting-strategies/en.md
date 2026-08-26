---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Learn how DynamoDB actually orders the items it returns, and how to design a sort key so that order is the one your access pattern needs. The chapter states the two rules up front: "you must use a composite primary key. Second, all ordering must be done with the sort key of a particular item collection." Underneath that rule is a mechanical fact worth internalizing: within a partition, "items within an item collection are stored as a B-tree which allow for O(log n) time complexity on search. This B-tree is arranged in lexicographical order according to the sort key, and it's what you'll be using for sorting." Every strategy in this concept — timestamp formats, `ScanIndexForward`, zero-padding, hierarchical sort keys — is a way of shaping what gets written into that sort key so the B-tree's natural order matches the order your application wants to read back. The sibling concept, [DynamoDB Filtering Strategies: Sparse Indexes and Composite Sort Keys](/database-concepts/dynamodb-filtering-strategies-sparse-indexes-composite-sort-keys), covers the same composite-sort-key *mechanics* (concatenating attributes into one key) for a different *goal* (filtering on two attributes in one `Query`); this concept reuses that same tool but points it at ordering.

## Use Cases

- A ticket-tracking app that needs "most recently updated tickets first" per organization, without breaking DynamoDB's rule that primary key attributes are immutable on update.
- A leaderboard or a feed that needs newest-first (or highest-score-first) results — the textbook use for `ScanIndexForward=False`.
- An IoT dashboard that needs "the Device plus its 10 most recent Readings" in a single `Query`, which requires deciding whether the parent Device item sorts before or after its children.
- A SaaS table where one access pattern needs an Organization's Users in alphabetical order while another needs that same Organization's Teams in any order — both sharing one item collection, one on each side of the parent item.
- A sort key like `READING#<number>` where the number is stored as text and needs to sort numerically ("Reading #10" must come after "Reading #2", not before it).
- A unique, URL-friendly identifier that must also sort chronologically — order confirmation numbers, deal IDs, migration record IDs — without a separate `CreatedAt` attribute to sort on.

## Deep Dive

### Lexicographical sorting is not alphabetical sorting

DynamoDB only sorts on the sort key, and only scalar types (string, number, binary) are allowed there. Numbers sort numerically, as expected. Strings and binary sort "in order of UTF-8 bytes" — which the book calls, as a simplification, lexicographical order: "This order is basically dictionary order with two caveats: 1. All uppercase letters come before lowercase letters. 2. Numbers and symbols (e.g. `#` or `$`) are relevant too." The book's own example is its author's surname: "Imagine you had Jimmy Dean, Laura Dern, and me [DeBrie] in an item collection using our last names. If you forgot about capitalization, it might turn out as follows... You might be surprised to see that DeBrie came before Dean! This is due to the casing — uppercase before lowercase." The fix is discipline, not a DynamoDB feature: "you should standardize your sort keys in all uppercase or all lowercase values... You can then hold the properly-capitalized value in a different attribute in your item."

That same byte-order rule is what makes the `#` prefix trick from the filtering concept double as an ordering trick here — `#` sorts before uppercase letters, so a `#TEAM#<Name>` sort key value sorts before `ORG#<Name>`, without needing a value comparison. Composite sort keys and prefix markers are one mechanism; filtering and ordering are just two different uses of it.

### Timestamps: sortable, human-readable, or both

"Your choice needs to be sortable. In this case, either epoch timestamps or ISO-8601 will do. What you absolutely cannot do is use something that's not sortable, such as a display-friendly format like 'May 26, 1988'." Beyond sortability, the book prefers ISO-8601 for a debugging reason, with a caveat: "I prefer to use ISO-8601 timestamps because they're human-readable if you're debugging items in the DynamoDB console. That said, it can be tough to decipher items in the DynamoDB console if you have a single-table design" — a nod to [single-table design](/database-concepts/dynamodb-single-table-design)'s cost of readability.

### Unique, sortable IDs: KSUIDs

A recurring need is a unique identifier that also sorts chronologically — a problem plain UUIDs don't solve, since UUIDv4 is random and carries no time ordering. The book's recommendation is the KSUID (K-Sortable Unique Identifier): "it's a unique identifier that is prefixed with a timestamp but also contains enough randomness to make collisions very unlikely. In total, you get a 27-character string that is more unique than a UUIDv4 while still retaining lexicographical sorting." A KSUID string like `1YnlHOfSSk3DhX4BR6lMAceAo1V` decodes to an embedded timestamp plus a random payload — one field that's simultaneously a primary-key-safe unique ID and a sort key that orders chronologically, no separate `CreatedAt` attribute required. (ULID is a newer, more widely-adopted design with the same goal — see Documentation Links.)

### Immutable sort keys: don't put a changing value in the primary key

The ticket-tracking example is the concept's clearest cautionary tale. A first design puts `UpdatedAt` directly in the sort key so a `Query` naturally returns tickets by recency. It breaks immediately: "you may not change any elements of the primary key. In this case, your primary key includes the `UpdatedAt` field, which changes whenever you update a ticket. Thus, anytime you update a ticket item, we would need first to delete the existing ticket item, then create a new ticket item with the updated primary key. We have caused a needlessly complicated operation and one that could result in data loss if you don't handle your operations correctly."

The fix is to keep the base table's sort key on something immutable (`TicketId`) and let a secondary index carry the volatile ordering attribute (`UpdatedAt`) instead: "Each item from the base table is copied into the secondary index... We can use the Query API against our secondary index to satisfy our 'Fetch most recently updated tickets' access pattern. More importantly, we don't need to worry about complicated delete + create logic when updating an item." The lesson generalizes: if the attribute you want to sort by changes often, don't make it (or a composite key containing it) part of the base table's primary key — project it into a GSI's sort key instead, where DynamoDB re-copies the item automatically on every update.

### Ascending vs. descending: `ScanIndexForward`

By default a `Query` reads a sort key's B-tree left to right — ascending: "starting at aardvark and going toward zebra," or for timestamps, "starting at the year 1900 and working toward the year 2020." Setting `ScanIndexForward=False` reverses the traversal, "useful for a number of occasions, such as when you want to get the most recent timestamps or you want to find the highest scores on the leaderboard."

The subtlety appears when you combine this with a one-to-many relationship co-located in a single item collection — the same technique the filtering concept uses for "assembling different collections" via prefix markers, now aimed at controlling where the parent item lands relative to its children. In the IoT example — a Device item plus its Reading items — a naive `DEVICE#...` / `READING#...` sort key puts the Device *before* all Readings, because `D` sorts before `R`. Query that collection forward and you get the *oldest* readings first, which is backwards from what "most recent 10 readings" needs. The book's fix is a `#` prefix on the Reading items: "Now we can use the Query API to fetch the Device item and the most recent Reading items by starting at the end of our item collection and using the `ScanIndexForward=False` property." The general principle: "When you are co-locating items for one-to-many or many-to-many relationships, be sure to consider the order in which you want the related items returned so that your parent itself is located accordingly."

### Two relational access patterns, opposite directions, one item collection

Taking that a step further: a single item collection can serve *two* one-to-many relationships in *opposite* sort directions, if the parent item sits between them. The book's SaaS example puts an Organization's Team items on one side and User items on the other, using `#TEAM#<Name>` (sorts before the parent) and `USER#<Name>` (sorts after it), with the Org item itself at `ORG#<OrgName>` in the middle:

```python
result = dynamodb.query(
    TableName='SaaSTable',
    KeyConditionExpression="#pk = :pk AND #sk <= :sk",
    ExpressionAttributeNames={"#pk": "PK", "#sk": "SK"},
    ExpressionAttributeValues={
        ":pk": {"S": "ORG#MCDONALDS"},
        ":sk": {"S": "ORG#MCDONALDS"}
    },
    ScanIndexForward=False
)
```

"This goes to our partition and finds all items less than or equal to the sort key value for our Org item. Then it scans backward to pick up all the Team items." The mirror query — `#sk >= :sk` with `ScanIndexForward=True` (the default) — fetches the Org plus all User items in alphabetical order. One item collection, two independent orderings, "by no means necessary, but it will save you additional secondary indexes in your table."

### Zero-padding: forcing numeric order out of a string sort key

Whenever a sort key mixes a type prefix with a number — `<ItemType>#<Number>` — that number is compared as text, not arithmetic, and lexicographic comparison of digit strings does not match numeric order: "lexicographic sorting evaluates one character at a time, from left to right. When it is compared '10' to '2', the first digit of 10 ('1') is before the first digit of 2 ('2'), so 10 was placed before 2." Reading #10 lands before Reading #2 — visibly wrong.

The fix is to fix the width: pad every number to the same number of digits with leading zeros, so `"10"` becomes `"00010"` and `"2"` becomes `"00002"`, and now they compare correctly character by character. The only design decision is choosing the width up front, because it can't be changed later without a migration: "The big factor here is to make sure your padding is big enough to account for any growth... I'd recommend going to the maximum number of related items you could ever imagine someone having, then adding 2-3 digits beyond that... You may also want to have an alert condition in your application code that lets you know if a particular count gets to more than X% of your maximum."

### Faking ascending order: the zero-padded difference

The book's most advanced pattern solves a narrow but real problem: two one-to-many relationships off the same parent, both using a numeric ID, where you want to fetch *both* in the *same* direction (say, both descending by ID) inside a *single* item collection — normally impossible, since one relationship's ascending order is the other's descending order relative to the parent's position.

The trick: instead of storing the number itself (zero-padded), store the zero-padded *difference* from the maximum possible value. For width 5 and an ID of `157`, the padded difference is `99999 − 157 = 99842`. Store `99842` instead of `00157`, and now larger IDs (which should sort "more recent," i.e., first) produce *smaller* stored strings, so reading the item collection *forward* from the parent yields IDs in descending order — ascending traversal faking descending order. As the book puts it: "Notice that I changed the SK structure of the Reading items so that the parent Device item is now at the top of our item collection. Now we can fetch the Device and the most recent Readings by starting at Device and reading forward, even though we're actually getting the readings in descending order according to their ReadingId." The book is candid about how niche this is — "you may not ever have a need for this in practice" — and frames the real payoff as a demonstration of composability: "the best takeaway you can get from this strategy is how flexible DynamoDB can be if you combine multiple strategies. Once you learn the basics, you can glue them together in unique ways to solve your problem."

### Book vs today: `ScanIndexForward` and sort-key ordering are unchanged

AWS's current `Query` API reference states the ordering rule in essentially the book's own words: "`Query` results are always sorted by the sort key value. If the data type of the sort key is Number, the results are returned in numeric order; otherwise, the results are returned in order of UTF-8 bytes. By default, the sort order is ascending. To reverse the order, set the `ScanIndexForward` parameter to false." The current developer guide's sort-key best-practices page independently confirms the version-control and hierarchical-prefix patterns this chapter teaches — including the same zero-prefix ("`v0_`") trick for "always fetch the latest version first" — and a 2024 AWS Database Blog post on sort-key design walks through the identical `ScanIndexForward=False` "most recent first" pattern against a GSI. Nothing about the ordering mechanics — ascending-by-default, `ScanIndexForward` to reverse, numeric-vs-UTF-8 comparison rules — has changed since the book's 2020 edition. This is a genuinely stable corner of the DynamoDB API; the composite-sort-key *concatenation* technique this chapter also leans on gained a native alternative in late 2025 (multi-attribute composite keys on GSIs), covered in the sibling filtering concept, but that change is about how you build a compound key, not about how sort order itself works once you have one.

## Trade-offs

- **Zero-padding requires committing to a width up front, with no cheap way back.** Underestimate the maximum count and every ID beyond the padded width breaks the ordering silently (no error — just wrong sort order) until you migrate the attribute and rebuild any index built on it. The book's own advice — pad for the largest count you can imagine, then add 2-3 digits, and alert well before you get close — is a hedge against a decision you can't easily reverse.
- **Immutable-primary-key discipline pushes volatile sort attributes into a GSI, which costs an index.** The ticket-tracking fix (base table sorts on `TicketId`, GSI sorts on `UpdatedAt`) trades the delete+recreate hazard for an extra secondary index to create, project, and pay for — cheap compared to a data-loss bug, but not free.
- **KSUIDs (or ULIDs) buy sortable uniqueness at the cost of a non-standard ID format.** Unlike a UUID, a KSUID/ULID string embeds a timestamp that's recoverable by decoding it — a minor information leak (roughly when the record was created) that a random UUID doesn't have, worth considering for IDs exposed to end users.
- **The "two relational access patterns, one item collection" and "faking ascending order" strategies save index count at the cost of readability.** Both rely on exactly where a `#`-prefixed or numerically-inverted sort key value happens to fall relative to a parent item — correct, but nowhere near self-documenting; a future maintainer reading the raw table needs the comment or the doc explaining *why* the SK looks like that, not just what it is.
- **`ScanIndexForward=False` changes *traversal* order, not query cost.** It's free in the sense that it doesn't add read capacity or an extra index, but it only produces a useful ordering if the sort key was already designed to put the desired items at the end of the item collection — it can't fix a sort key that wasn't shaped for the access pattern in the first place.

## Documentation Links

- [Alex DeBrie, "The DynamoDB Book", v1.0.1 (2020) — Chapter 14, "Strategies for sorting", p. 234-252](https://www.dynamodbbook.com/) — doc
- [AWS Documentation — Query (API Reference), ScanIndexForward and sort-order semantics](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Query.html) — doc
- [AWS Documentation — Best Practices for Using Sort Keys to Organize Data](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-sort-keys.html) — doc
- [AWS Database Blog — Effective data sorting with Amazon DynamoDB](https://aws.amazon.com/blogs/database/effective-data-sorting-with-amazon-dynamodb/) — doc
- [AWS Documentation — Key Condition Expressions for the Query Operation](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.KeyConditionExpressions.html) — doc
- [Segment — ksuid: K-Sortable Globally Unique IDs](https://github.com/segmentio/ksuid) — doc
- [ULID Specification — Universally Unique Lexicographically Sortable Identifier](https://github.com/ulid/spec) — doc
