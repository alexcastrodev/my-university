---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Understand the six concrete rules Alex DeBrie gives for turning a finished access-pattern-first entity-relationship model — the output of the process in *[DynamoDB Data Modeling: An Access-Patterns-First Approach](/database-concepts/dynamodb-data-modeling-approach)* — into working application code and an actual `CreateTable` call: keeping indexing attributes separate from application attributes, pushing all DynamoDB-specific code to the boundary of the application, never sharing an attribute across two different indexes, tagging every item with its entity type, writing small debug scripts per access pattern, and — only for the largest tables — shortening attribute names.

## Use Cases

- Reviewing a pull request that adds a data-access layer for a new DynamoDB-backed service, and checking whether the raw `GetItem`/`PutItem` calls leak past the repository/data module into business logic — the book's boundary rule made concrete.
- Deciding, after finishing the entity chart and key design from [`dynamodb-data-modeling-approach`](/database-concepts/dynamodb-data-modeling-approach), whether to reuse the sort key value as a GSI sort key too ("just point `GSI1` at `PK` and `SK`") to save a few bytes per item — and knowing why the book says not to.
- Setting up a background ETL / migration script (see [`dynamodb-migration-strategies-for-single-table-design`](/database-concepts/dynamodb-migration-strategies-for-single-table-design)) and needing a cheap way to select only the entity type being migrated out of a single overloaded table.
- Debugging a production incident where a `Query` against a GSI returns the wrong items, and needing a fast, repeatable way to reproduce the access pattern from the command line instead of re-clicking through the AWS console each time.
- Estimating storage cost for a table projected to hold billions of items, and deciding whether attribute-name shortening is worth the added complexity at your actual scale — versus a smaller table where it plainly isn't.
- Writing the actual `CreateTable` call (or its CDK/Terraform/CloudFormation equivalent) for a model that was designed on paper, and wanting a short pre-flight checklist rather than guessing at attribute types.

## Deep Dive

### Where this chapter sits: after the model, before the code

The book is explicit about the ratio of effort: *"90% of the work of using DynamoDB happens in the planning stage, before you write a single line of code."* That planning stage — the ERD, the access-pattern chart, the primary-key design — is [`dynamodb-data-modeling-approach`](/database-concepts/dynamodb-data-modeling-approach). This chapter is the other 10%: *"At some point, however, you need to move from model to implementation. This chapter includes guidance on how to implement your DynamoDB data model in your application code."* It's a checklist for the moment the paper model becomes a `CreateTable` call and a data-access layer, not a modeling technique in its own right.

### Rule 1 — Separate application attributes from indexing attributes

An item pulled straight off a single-table design looks like this:

```json
{
    "PK": { "S": "USER#alexdebrie" },
    "SK": { "S": "USER#alexdebrie" },
    "GSI1PK": { "S": "ORG#facebook" },
    "GSI1SK": { "S": "USER#alexdebrie" },
    "Username": { "S": "alexdebrie" },
    "FirstName": { "S": "Alex" },
    "LastName": { "S": "DeBrie" },
    "OrganizationName": { "S": "Facebook" }
}
```

DeBrie draws a hard line between the first four attributes and the rest: *"the first four attributes are all related to my DynamoDB data model but have no meaning in my application business logic. I refer to these as 'indexing attributes,' as they're only there for indexing your data in DynamoDB."* `Username`, `FirstName`, and the rest are **application attributes** — the things the business logic actually cares about.

The dependency only runs one direction. Application attributes are allowed to inform indexing attributes — here `Username` fills in the `USER#` template for `PK`, `SK`, and `GSI1SK` — but not the reverse: *"I recommend against going the other way. Don't think that you can remove the Username attribute from your item since it's already encoded into your PK. It adds complexity and risks data loss if you change your data model and indexing attributes in the future."* The book accepts the storage cost of this duplication explicitly: *"It will result in slightly larger item sizes due to duplicated data, but I think it's worth it."*

### Rule 2 — Implement your data model at the very boundary of your application

The raw item above has two problems for anyone writing business logic against it: it's cluttered with indexing attributes that mean nothing outside DynamoDB, and every value is wrapped in a type-descriptor map (`{"S": "..."}`). DeBrie's fix is architectural, not cosmetic — push all of that translation to one narrow layer:

```python
def get_user(username):
    resp = client.get_item(
        TableName='AppTable',
        Key={ 'PK': { 'S': f'USER#{username}' }}
    )
    return User(
        username=resp['Item']['Username']['S'],
        first_name=resp['Item']['FirstName']['S'],
        last_name=resp['Item']['LastName']['S'],
    )
```

The core of the application only ever sees `data.get_user(username='alexdebrie')` returning a plain `User` object — it never constructs a `PK`, never unwraps a `{"S": ...}` map, never knows a `GSI1PK` exists. *"All interaction with DynamoDB should be handled in the data module that is at the boundary of your application... Write that DynamoDB logic once, at the edge of your application, and operate on application objects the rest of the time."* This is the same boundary idea a repository or DAO layer gives you over a relational database — the difference is how much translation work happens at that boundary, because DynamoDB's key-templating and type-wrapping have no equivalent in a plain SQL row.

### Rule 3 — Don't reuse attributes across multiple indexes

Looking at the same item again, `SK` and `GSI1SK` hold the identical value `USER#alexdebrie`. The obvious "optimization" is to stop writing `GSI1SK` at all and define `GSI1` with a key schema of `GSI1PK` + `SK` — reusing the base table's sort key as the index's sort key. DeBrie is blunt: *"Don't do this."*

The saved storage is real but small, and the cost is structural: *"it will make your data modeling more difficult. If you have multiple entity types in your application, you'll tie yourself in knots trying to make the attributes work across multiple different indexes. Further, if you do need to add additional access patterns or migrate data, this will make it more difficult."* His replacement rule is mechanical and easy to enforce in review: *"For each global secondary index you use, give it a generic name of `GSI<Number>`. Then, use `GSI<Number>PK` and `GSI<Number>SK` for your attribute types."* One index, one dedicated pair of attributes, always — no cross-wiring, even when two values happen to coincide today.

### Rule 4 — Add a `Type` attribute to every item

Because entity type in a single-table design lives inside the *value* of `PK`/`SK` (`USER#...` vs. `ORDER#...`), it's not something you can filter on cheaply or eyeball at a glance. DeBrie's fix is a plain string attribute written onto every item:

```python
def save_user(user: User):
    resp = client.put_item(
        TableName='AppTable',
        Item={
          'PK': { 'S': f'USER#{User.username}' },
          'SK': { 'S': f'USER#{User.username}' },
          'GSI1PK': { 'S': f'ORG#{User.org_name}' },
          'GSI1SK': { 'S': f'USER#{User.username}' },
          'Type': { 'S': 'User' },
          'Username': { 'S': User.username },
          'FirstName': { 'S': User.first_name},
          'LastName': { 'S': User.last_name},
        }
    )
    return user
```

He gives three concrete reasons to bother, beyond just orienting yourself in the AWS console:

- **Migrations.** The strategies in [`dynamodb-migration-strategies-for-single-table-design`](/database-concepts/dynamodb-migration-strategies-for-single-table-design) often require a background ETL job that scans the table and decorates existing items with new indexing attributes — but usually only for one entity type at a time. *"I like to use a filter expression on the Type attribute when scanning my table to ensure I'm only getting the items that I need. It simplifies the logic in my ETL script."*
- **Analytics exports.** DynamoDB is not built for OLAP queries, so analytics means exporting to Redshift or S3/Athena — and a single table holding every entity type is exactly wrong shape for a relational analytics engine. *"After your initial export of data, you'll want to 're-normalize' it by moving your different entity types into their own tables. Having a Type attribute makes it easier to write the transformation query and find the right items to move around."*
- **Console legibility.** A quick, low-cost way to tell what you're looking at while debugging in the AWS console.

### Rule 5 — Write scripts to help debug access patterns

Single-table design makes ad-hoc debugging harder than in a relational database: *"your items are all jumbled together in the same table. You're accessing items from DynamoDB via indexed attributes rather than the application attributes that you're used to in your application. Finally, you may be using shortened attribute names that require translation to map it back to your actual application attribute names."*

The recommended fix is a small CLI script per access pattern, sitting on top of the same data module from Rule 2:

```python
# scripts/get_user.py
import click
import data

@click.command()
@click.option('--username', help='Username of user to retrieve.')
def get_user(username):
    user = data.get_user(username)
    print(user)

if __name__ == '__main__':
    get_user()
```

Run as `python scripts/get_user.py --username alexdebrie`, it prints the fetched `User`. For a single-item fetch this looks like overkill, but DeBrie's point is about the access patterns that aren't a single `GetItem`: *"if you're retrieving multiple related items from a global secondary index with complex conditions on the sort key, these little scripts can be lifesavers. Write them at the same time you're implementing your data model."* Writing the script alongside the data-access code, rather than after a bug report, is the actual habit being recommended.

### Rule 6 — Shorten attribute names to save storage (advanced, largest tables only)

The last rule looks like it contradicts Rule 3, but it doesn't — it targets a different set of attributes. Rule 3 says never share an *indexing* attribute across indexes; Rule 6 says you may abbreviate *application* attribute names, because Rule 2 already guarantees nothing outside the data-access layer ever touches those names directly:

```python
def save_user(user: User):
    resp = client.put_item(
        TableName='AppTable',
        Item={
          'PK': { 'S': f'USER#{User.username}' },
          'SK': { 'S': f'USER#{User.username}' },
          'GSI1PK': { 'S': f'ORG#{User.org_name}' },
          'GSI1SK': { 'S': f'USER#{User.username}' },
          'u': { 'S': User.username },
          'fn': { 'S': User.first_name},
          'ln': { 'S': User.last_name},
        }
    )
    return user
```

`Username` becomes `u`, `FirstName` becomes `fn`. DeBrie is careful to flag this as opt-in, not a default: *"this is a pretty advanced pattern that I would recommend only for the largest tables and for those that are heavily into the DynamoDB mindset... Because your application will never be touching these abbreviated names, it's safe to make these abbreviations."* The rehydration step — turning `fn` back into `first_name` on read — belongs entirely inside the same boundary layer from Rule 2, so the rest of the application never sees the abbreviation. His closing scope note: *"For the marginal application, the additional attribute names won't be a meaningful cost difference. However, if you plan on storing billions and trillions of items in DynamoDB, this can make a difference with storage."*

### Reading this as a pre-`CreateTable` checklist

Put together, the six rules resolve into a short pre-flight list before you actually call `CreateTable` (or write the CDK/Terraform/CloudFormation equivalent) for a model finished under [`dynamodb-data-modeling-approach`](/database-concepts/dynamodb-data-modeling-approach):

1. Every key attribute in your entity chart is named generically — `PK`, `SK`, `GSI1PK`, `GSI1SK`, `GSI2PK`, ... — never after a specific entity's field.
2. No GSI's key schema reuses a base-table or another index's attribute (Rule 3) — each index gets its own dedicated `PK`/`SK` pair, written explicitly on every item that belongs in it.
3. Every item type in the design carries a `Type` attribute in its write path.
4. There is exactly one module/package where `AttributeDefinitions`, `KeySchema`, and every SDK call live — no other part of the codebase imports the DynamoDB client directly.
5. A debug script exists (or is planned) for each nontrivial access pattern, especially ones hitting a GSI with sort-key conditions.
6. Attribute-name shortening is a deliberate, scale-driven decision, not a default — skip it unless the table is genuinely headed for billions of items.

### Book vs. today

The mechanics described here are unchanged since 2020 — `PK`/`SK` overloading, GSI attribute isolation, and the boundary-layer pattern are exactly how the AWS SDKs and `CreateTable` still work. Two things around the edges of "actually writing the `CreateTable` call" are worth flagging:

> **AWS now actively steers new tables toward on-demand billing, which the book doesn't mention at all.** The `CreateTable` API's `BillingMode` parameter still defaults to `PROVISIONED` when omitted (in which case `ProvisionedThroughput` is required) — that hasn't changed. What has changed is the guidance: the current API reference states outright, *"We recommend using `PAY_PER_REQUEST` for most DynamoDB workloads,"* and the AWS console now creates new tables in on-demand mode by default. In 2020, on-demand pricing was two years old and still a secondary option; today it's the recommended starting point, and the pre-flight checklist above should include "pick `PAY_PER_REQUEST` unless you already know you need provisioned capacity" alongside DeBrie's six rules.
> **Rule 2's boundary pattern now has first-party tooling in some SDKs, but the discipline is still yours to enforce.** The AWS SDK for Java v2's Enhanced DynamoDB Client and similar object-mapper layers in other SDKs can automate part of the type-wrapping/unwrapping Rule 2 describes by hand in Python. That reduces the boilerplate of the boundary layer but doesn't remove the need for one — a `@DynamoDbBean`-annotated class is still DynamoDB-shaped, and the discipline of never letting it leak past the data-access layer into business logic is exactly Rule 2, tooling or not.

## Trade-offs

- **The boundary-layer discipline (Rule 2) is easy to state and easy to erode.** The first time someone needs "just one more field" from a `GetItem` response in a hurry, the shortest path is to reach into `response['Item']['SomeAttr']['S']` from inside a handler instead of extending the data module. Every instance of that shortcut is a place where changing the table's key design later requires hunting through business logic instead of touching one file. Treat any DynamoDB SDK import outside the designated data-access module as a code-review finding, not a style preference.
- **The generic `PK`/`SK`/`GSI<N>PK` convention (Rules 1 and 3) trades self-description for correctness under change.** A table where key attributes are named after the convention is unreadable in the AWS console without the entity chart in hand — you cannot tell what `PK = "ORG#facebook"` means without the mapping document. But the alternative — naming a GSI's key `Username` because that's what it holds for one entity type — breaks the moment a second entity type needs that same index, which is precisely the scenario single-table design exists to support. The illegibility is the cost of keeping the design extensible; the entity chart from [`dynamodb-data-modeling-approach`](/database-concepts/dynamodb-data-modeling-approach) is not optional documentation here, it's the only key.
- **The `Type` attribute is nearly free and easy to forget under time pressure.** It costs a few bytes per item and one extra line in every write path, and DeBrie's three justifications (ETL filtering, analytics re-normalization, console legibility) don't pay off until a migration or an export actually happens — which can be months after the table went live. Skipping it at launch to save a line of code is the kind of decision that looks free right up until the first migration script has to be written without it, at which point recovering entity type requires parsing every item's `PK` template instead of one filter expression.
- **Debug scripts (Rule 5) are a real engineering investment competing with feature work, and the payoff is asymmetric by access pattern.** For a plain `GetItem` by primary key, a script barely earns its keep — you could just as easily use the AWS console or CLI. For a `Query` against a GSI with a `begins_with` or `between` sort-key condition, reproducing the exact request by hand each time is slow and error-prone, and that's where the book's "lifesaver" claim holds. Writing scripts uniformly for every access pattern is wasted effort; skipping them for the multi-condition ones is where teams actually get burned during an incident.
- **Attribute-name shortening (Rule 6) is the one rule the book itself hedges hardest on, and that hedge should be taken seriously.** The storage saved by turning `FirstName` into `fn` is genuinely marginal below billions of items, while the cost is permanent: every developer reading a raw item in the console or in logs now needs a name-mapping table in their head, and the rehydration logic is one more thing that can drift out of sync between read and write paths. Applying this rule on a table with a few million items is optimizing a cost that doesn't exist yet while paying a comprehension tax that does.
- **None of these six rules are enforced by DynamoDB itself.** Nothing stops a `PutItem` call from writing an item without a `Type` attribute, reusing a `SK` value as a GSI sort key, or bypassing the data-access module entirely — the table accepts whatever shape you send it. That's the same trade-off single-table design makes everywhere else: the flexibility that lets you overload a partition key to pre-join data is the same flexibility that lets a rushed change quietly violate every rule in this chapter. The checklist substitutes for a constraint the database won't give you, which is also why it belongs in code review, not just in a chapter you read once.

## Documentation Links

- [Alex DeBrie, "The DynamoDB Book", v1.0.1 (2020) — Chapter 9, "From modeling to implementation", p. 164-173](https://www.dynamodbbook.com/) — doc
- [AWS Documentation — CreateTable API Reference (BillingMode, KeySchema, GlobalSecondaryIndexes)](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_CreateTable.html) — doc
- [AWS Documentation — Read/Write Capacity Mode (Provisioned vs. On-Demand)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadWriteCapacityMode.html) — doc
- [AWS Documentation — Best Practices for Using Secondary Indexes in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-indexes.html) — doc
- [AWS Documentation — DynamoDB Enhanced Client (AWS SDK for Java 2.x)](https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/dynamodb-enhanced-client.html) — doc
- [AWS Documentation — Exporting DynamoDB Table Data to Amazon S3](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/S3DataExport.HowItWorks.html) — doc
