---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Learn three techniques that Alex DeBrie's "The DynamoDB Book" groups into a single "grab bag" chapter because none of them fits the relationship, filtering, sorting, or migration strategies covered elsewhere — but all three come up constantly in real applications. First, how to enforce uniqueness on an attribute that isn't part of your primary key, since "in DynamoDB, if you want to ensure a particular attribute is unique, you need to build that attribute directly into your primary key structure," and a primary key can only prove uniqueness on itself, not on a second, independent attribute like an email address. Second, how to fake an auto-incrementing sequential ID — something DynamoDB has no native support for — using an atomic counter item and a two-step write. Third, how DynamoDB pagination actually works: a cursor built from `LastEvaluatedKey`/`ExclusiveStartKey`, not the `OFFSET`/`LIMIT` page-number model most developers bring with them from SQL.

## Use Cases

- A signup flow where both a `username` and an `email` address must be unique across the whole application, but only the username is part of the item's primary key.
- A project-tracking or ticketing feature (Jira issues, GitHub issue numbers, order numbers) where users expect a human-readable, sequential, per-project number rather than a UUID or KSUID.
- An API endpoint returning a user's order history, most-recent-first, where the client needs to fetch "the next 10" without re-scanning everything it already saw.
- Any access pattern where a `Query` against a single item collection is too large to return in one round trip and must be split into a stream of bounded pages a client walks in order.

## Deep Dive

### Ensuring uniqueness on two or more attributes

DynamoDB gives you exactly one built-in uniqueness guarantee: the combination of partition key and sort key. Nothing else is unique by default, and nothing stops you from writing two items with the same `Email` attribute value as long as their primary keys differ.

The book's starting example is a user table keyed so the username is guaranteed unique:

- `PK`: `USER#<Username>`
- `SK`: `USER#<Username>`

A `PutItem` with `ConditionExpression: attribute_not_exists(PK)` on creation is enough to guarantee no two users share a username.

The tempting-but-wrong next move is to fold the email into the same key, e.g. `SK: EMAIL#<email>`. The book is explicit about why this fails:

> "It's the combination of a partition key and sort key that makes an item unique within the table. Using this key structure, you're confirming that an email address will only be used once for a given username. Now you've lost the original uniqueness properties on the username, as someone else could sign up with the same username and a different email address!"

The fix is a second, independent item that exists purely to occupy a primary key slot, combined with a transaction so both uniqueness checks succeed or fail together:

```python
response = client.transact_write_items(
    TransactItems=[
        {
            'Put': {
                'TableName': 'UsersTable',
                'Item': {
                    'PK': {'S': 'USER#alexdebrie'},
                    'SK': {'S': 'USER#alexdebrie'},
                    'Username': {'S': 'alexdebrie'},
                    'FirstName': {'S': 'Alex'},
                    # ... rest of the user's attributes ...
                },
                'ConditionExpression': 'attribute_not_exists(PK)'
            }
        },
        {
            'Put': {
                'TableName': 'UsersTable',
                'Item': {
                    'PK': {'S': 'USEREMAIL#alex@debrie.com'},
                    'SK': {'S': 'USEREMAIL#alex@debrie.com'}
                },
                'ConditionExpression': 'attribute_not_exists(PK)'
            }
        }
    ]
)
```

Each `Put` carries its own `ConditionExpression: attribute_not_exists(PK)`, so the transaction as a whole only succeeds if *neither* the username nor the email is already taken. If either condition fails, `TransactWriteItems` rolls back the entire request — no user is created and no email is reserved.

Note what the second item is: a bare marker with no user attributes at all. "You can do this if you will only access a user by a username and never by an email address. The email address item is essentially just a marker that tracks whether the email has been used." If you *do* need to look a user up by email, you'd duplicate the full set of user attributes onto that second item instead — but the book warns against it: "I'd avoid this if possible. Now every update to the user item needs to be a transaction to update both items. It will increase the cost of your writes and the latency on your requests." The marker-item version is the one to reach for unless a genuine "find user by email" access pattern forces the duplicated version.

### Handling sequential IDs

Relational databases hand you an auto-incrementing primary key for free; DynamoDB does not. "With DynamoDB, this is not the case. You use meaningful identifiers, like usernames, product names, etc., as unique identifiers for your items." But user-facing sequential numbers are still a real requirement — Jira issue numbers, GitHub issue numbers, order numbers — so the book builds one out of two DynamoDB primitives: an atomic counter and a follow-up write.

Using the book's Jira-style example — Projects that contain sequentially-numbered Issues — the two-step process is:

```python
resp = client.update_item(
    TableName='JiraTable',
    Key={
        'PK': {'S': 'PROJECT#my-project'},
        'SK': {'S': 'PROJECT#my-project'}
    },
    UpdateExpression="SET #count = #count + :incr",
    ExpressionAttributeNames={"#count": "IssueCount"},
    ExpressionAttributeValues={":incr": {"N": "1"}},
    ReturnValues='UPDATED_NEW'
)

current_count = resp['Attributes']['IssueCount']['N']

resp = client.put_item(
    TableName='JiraTable',
    Item={
        'PK': {'S': 'PROJECT#my-project'},
        'SK': {'S': f"ISSUE#{current_count}"},
        'IssueTitle': {'S': 'Build DynamoDB data model'}
        # ... other attributes ...
    }
)
```

Step one increments `IssueCount` on the parent Project item and, via `ReturnValues='UPDATED_NEW'`, hands back the post-increment value in the same response — no separate read needed to learn the new count. Step two uses that value to build the new Issue item's sort key (`ISSUE#<n>`) and writes it. The `UpdateItem` in step one is atomic regardless of how many concurrent requests hit it, so two issues created at the same instant can never collide on the same number.

The book is upfront about the cost of this pattern: "This isn't the best since you're making two requests to DynamoDB in a single access pattern. However, it can be a way to handle auto-incrementing IDs when you need them." It's a deliberate trade of an extra round trip for a feature (contiguous, human-facing sequence numbers) DynamoDB has no native way to provide.

### Pagination

DynamoDB's approach to pagination is a genuinely different mental model from `OFFSET`/`LIMIT`, not just a different API shape for the same idea. "In a relational database, you may use a combination of OFFSET and LIMIT to handle pagination. DynamoDB does pagination a little differently, but it's pretty straightforward." Pagination in DynamoDB is almost always pagination through a single item collection via `Query`.

Take an e-commerce table where `Order` items live under `PK: USER#<username>` with a roughly-chronological `OrderId` (a KSUID) as the sort key. The first page of a user's most recent orders:

```python
resp = client.query(
    TableName='Ecommerce',
    KeyConditionExpression='#pk = :pk AND #sk < :sk',
    ExpressionAttributeNames={'#pk': 'PK', '#sk': 'SK'},
    ExpressionAttributeValues={
        ':pk': {'S': 'USER#alexdebrie'},
        ':sk': {'S': 'ORDER$'}
    },
    ScanIndexForward=False,
    Limit=5
)
```

`ScanIndexForward=False` walks the sort key backward (newest first) and `Limit=5` caps the page at five items. To fetch the *next* page, the client needs a cursor — and DynamoDB's cursor is the primary key of the last item it saw, round-tripped back on the next request as `ExclusiveStartKey`. The book bakes that cursor straight into a URL: `.../orders?before=1YRfXS14inXwIJEf9tO5hWnL2pi`, then reissues the query with the sort-key condition anchored on that last-seen `OrderId` instead of the sentinel `ORDER$` value:

```python
resp = client.query(
    TableName='Ecommerce',
    KeyConditionExpression='#pk = :pk AND #sk < :sk',
    ExpressionAttributeNames={'#pk': 'PK', '#sk': 'SK'},
    ExpressionAttributeValues={
        ':pk': {'S': 'USER#alexdebrie'},
        ':sk': {'S': 'ORDER#1YRfXS14inXwIJEf9tO5hWnL2pi'}
    },
    ScanIndexForward=False,
    Limit=5
)
```

Current AWS documentation describes exactly this loop, unchanged from the book: run a `Query`, check the response for a `LastEvaluatedKey`, and if present, pass it back verbatim as the next request's `ExclusiveStartKey`; when a response has no `LastEvaluatedKey`, you've reached the end. One nuance the book's chapter doesn't spell out, but that AWS's current docs are explicit about: a non-empty `LastEvaluatedKey` only means the previous `Query` stopped at a page boundary (the 1 MB cap or your `Limit`) — it does not guarantee more *matching* items remain. This matters most when a `FilterExpression` is in play, since the 1 MB/`Limit` cap is enforced on what's read *before* the filter runs, so a page can come back with zero filtered results and still carry a `LastEvaluatedKey` telling you to keep paging.

The upshot for anyone used to SQL: there's no way to jump straight to "page 6" the way `OFFSET 50 LIMIT 10` would let you — DynamoDB's cursor only knows how to continue from the last item it handed you, not to seek to an arbitrary position in the collection.

## Trade-offs

- **Uniqueness via a marker item is cheap; uniqueness via a duplicated item is not.** A bare marker item (just a primary key, no attributes) costs almost nothing extra and only comes into play at write time. Duplicating the user's attributes onto the email-tracking item so it's independently readable means every future update to the user must become a transaction touching both items — more write cost, more latency, and more ways for the two copies to drift if a caller forgets the second write.
- **`TransactWriteItems` bills for two operations per item, win or lose.** DynamoDB performs an underlying prepare and an underlying commit for every item in a transaction, so a two-item uniqueness transaction consumes capacity as if it were four writes — and it consumes that capacity even when a `ConditionCheck` fails and the whole transaction is cancelled. Since September 2022, a single transaction can bundle up to 100 actions (up from the original 25), so this pattern scales to more than two unique attributes without needing multiple round trips — but each additional attribute is still two more billed writes.
- **Atomic-counter sequential IDs cost an extra round trip and create a single hot item.** The `UpdateItem`-then-`PutItem` pattern is not a single request the way a normal write is, and every new item in that project or collection contends for atomic updates to the *same* counter item, which becomes a write hotspot under high concurrency. Current practitioner guidance largely treats DynamoDB auto-increment counters as something to reach for only when a genuinely user-facing sequential number is required — preferring UUIDs, ULIDs, or KSUIDs (which the book itself already favors elsewhere for chronological sort keys) whenever the ID doesn't need to be human-readable and gapless.
- **`SET #count = #count + :incr` and the `ADD` update-expression verb are both atomic for numeric counters.** The book's counter example uses `SET`, while AWS's own current atomic-counter code examples use `ADD #count :incr`. Both are single-item, atomically-applied updates with identical race-safety; `ADD` is the older, narrower verb (numbers and sets only), while `SET` is the more general one used everywhere else in the book's expression examples — a stylistic choice, not a correctness difference.
- **Cursor-based pagination is efficient but inflexible.** `LastEvaluatedKey`/`ExclusiveStartKey` pagination never has to compute or skip past rows the way `OFFSET` does in SQL, so it stays fast and cheap no matter how deep a client pages. The cost is that it only supports "give me the next page from where I left off" — there's no way to compute "page 42" without having walked pages 1 through 41 first, so a UI that promises jump-to-page-N navigation needs a different design (or an approximate, non-cursor index) rather than raw DynamoDB pagination.

## Documentation Links

- [Alex DeBrie, "The DynamoDB Book", v1.0.1 (2020) — Chapter 16, "Additional Strategies", p. 269-278](https://www.dynamodbbook.com/) — doc
- [AWS Documentation — Amazon DynamoDB Transactions: How it Works (TransactWriteItems)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html) — doc
- [AWS What's New — Amazon DynamoDB now supports up to 100 actions per transaction (Sept 2022)](https://aws.amazon.com/about-aws/whats-new/2022/09/amazon-dynamodb-supports-100-actions-per-transaction) — doc
- [AWS Documentation — Paginating Table Query Results in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.Pagination.html) — doc
- [AWS Documentation — Update Expressions (SET, REMOVE, ADD, DELETE)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.UpdateExpressions.html) — doc
- [AWS Code Library — Use Atomic Counter Operations in DynamoDB with an AWS SDK](https://docs.aws.amazon.com/code-library/latest/ug/dynamodb_example_dynamodb_Scenario_AtomicCounterOperations_section.html) — doc
