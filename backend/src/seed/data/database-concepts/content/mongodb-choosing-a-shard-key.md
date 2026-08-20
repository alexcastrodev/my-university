---
version: 1.0
updatedAt: 2026-08-20
---
## Objective

Learn how to pick the field (or two) that decides where every document in a sharded collection physically lives. The book opens the chapter with the stakes: "The most important task when using sharding is choosing how your data will be distributed," and immediately adds the constraint that makes it consequential — "Once you shard a collection you cannot change your shard key, so it is important to choose correctly." The chapter is organized around three things: a set of questions to answer about your own workload *before* looking at any candidate key, three shapes a key's distribution can take (ascending, random, location-based) with the failure mode each one produces, and four concrete strategies (hashed, GridFS-hashed, firehose, multi-hotspot) plus the escape hatches — zones and manual `moveChunk` — for when automatic distribution isn't what you want.

## Use Cases

- Sharding a collection for the first time and needing to decide between `{"_id": 1}`, `{"username": "hashed"}`, and a compound key — where picking the wrong one means a full re-migration later, not a config change.
- Diagnosing a sharded cluster where one shard is doing all the write work and the balancer never seems to catch up: the classic symptom of an ascending shard key (a `date` field, an `ObjectId`, an imported autoincrement id).
- Sharding a GridFS bucket, where both of the indexes MongoDB creates for you on `fs.chunks` happen to be ascending keys and therefore both wrong.
- Needing data residency guarantees — keeping EU users' documents on EU-hosted shards for GDPR — which is a location-based shard key plus zone sharding, not an application-layer concern.
- Running a heterogeneous cluster where one shard is far more powerful than the others, and wanting the fast machine to absorb all new writes (the "firehose") or to host only one latency-critical collection.
- Being handed a candidate shard key with three distinct values (`"logLevel"`, a country code, a status enum) and needing to explain why cardinality caps how far the collection can ever be split.
- Reviewing a sharded design at the point where a decision is still cheap — before the collection has data — because the chapter's real argument is that this is a design-time decision with a migration-shaped cost if you get it wrong.

## Deep Dive

### Taking stock: answer four questions about your workload first

The chapter refuses to start with candidate keys. It starts with your workload, because "to choose a good shard key, you need to understand your workload and how your shard key is going to distribute your application's requests." And it is honest that reading about it is not enough: "This can be difficult to picture, so try to work out some examples — or, even better, try it out on a backup dataset with sample traffic. This section has lots of diagrams and explanations, but there is no substitute for trying it on your own data."

For each collection you plan to shard, answer:

1. **How many shards are you planning to grow to?** "A three-shard cluster has a great deal more flexibility than a thousand-shard cluster. As a cluster gets larger, you should not plan to fire off queries that can hit all shards, so almost all queries must include the shard key." This is the question that quietly eliminates most candidate keys: a query without the shard key is a scatter-gather across every shard, which is tolerable at three shards and ruinous at a thousand.
2. **Are you sharding to decrease read or write latency?** Latency is "how long something takes; e.g., a write takes 20 ms, but you need it to take 10 ms." Fixing latency "usually involves sending requests to geographically closer or more powerful machines" — which points at location-based keys and zones.
3. **Are you sharding to increase read or write throughput?** Throughput is "how many requests the cluster can handle at the same time; e.g., the cluster can do 1,000 writes in 20 ms, but you need it to do 5,000 writes in 20 ms." Fixing throughput "usually involves adding more parallelization and making sure that requests are distributed evenly across the cluster" — which points at random or hashed keys.
4. **Are you sharding to increase system resources** (more RAM per GB of data)? "If so, you want to keep the working set size as small as possible."

The four answers are not trivia; they are the scoring function. Latency and throughput pull in opposite directions from each other, and the working-set answer pulls against randomness. A key can only be evaluated once you know which of the four you are actually buying.

### Ascending shard keys, and the hot chunk they create

"Ascending shard keys are generally something like a `date` field or `ObjectId` — anything that steadily increases over time. An autoincrementing primary key is another example of an ascending field, albeit one that doesn't show up in MongoDB much (unless you're importing from another database)."

Shard on `"_id"` in a collection using `ObjectId`s and the key space gets cut into chunks of `_id` ranges, distributed across (say) three shards in a random order. Now insert a document. Which chunk gets it? "The answer is the chunk with the range `ObjectId("5112fae0b4a4b396ff9d0ee5")` through `$maxKey`. This is called the **max chunk**, as it is the chunk containing `$maxKey`."

And then the sentence the whole chapter is built to avoid: "If we insert another document, it will also be in the max chunk. In fact, every subsequent insert will be into the max chunk! Every insert's `_id` field will be closer to infinity than the previous one (because `ObjectId`s are always ascending), so they will all go into the max chunk."

Two consequences follow, and the book calls them "interesting (and often undesirable)":

- **All of your writes are routed to one shard.** Not most — all. "This chunk will be the only one growing and splitting, as it is the only one that receives inserts." New chunks "fall off" the max chunk as it grows, but the new max chunk is still on the same shard, still receiving 100% of inserts.
- **The balancer has to work much harder than it should.** "This pattern often makes it more difficult for MongoDB to keep chunks evenly balanced because all the chunks are being created by one shard. Therefore, MongoDB must constantly move chunks to other shards instead of correcting the small imbalances that might occur in more evenly distributed systems."

The book notes one server-side mitigation that landed shortly before it was written: "In MongoDB 4.2, the move of the autosplit functionality to the shard primary `mongod` added top chunk optimization to address the ascending shard key pattern. The balancer will decide in which other shard to place the top chunk. This helps avoid a situation in which all new chunks are created on just one shard." Read that carefully — it spreads out where new *chunks* are created; it does not spread out where new *writes* go. At any instant there is still exactly one max chunk on exactly one shard.

### Randomly distributed shard keys

"At the other end of the spectrum are randomly distributed shard keys. Randomly distributed keys could be usernames, email addresses, UUIDs, MD5 hashes, or any other key that has no identifiable pattern in your dataset."

The book does not argue this from theory; it runs it. Shard on a random `x` between 0 and 1, insert 10,000 documents, and count where each one landed:

```
> for (var i = 0; i < 10000; i++) {
...     var id = ObjectId();
...     db.random.insert({"_id" : id, "x" : Math.random()});
...     findShard(id);
... }
> servers
{
    "spock:30001" : 2942,
    "spock:30002" : 4332,
    "spock:30000" : 2726
}
```

Note that even with 10,000 truly random inserts the result is 2726 / 2942 / 4332, not a tidy 3333 each — chunk boundaries land where they land. The property that matters isn't perfect evenness, it's that "as writes are randomly distributed, the shards should grow at roughly the same rate, limiting the number of migrates that need to occur."

The cost is stated in one sentence and it is easy to skip past: "The only downside to randomly distributed shard keys is that MongoDB isn't efficient at randomly accessing data beyond the size of RAM. However, if you have the capacity or don't mind the performance hit, random keys nicely distribute load across your cluster." That is question 4 from the previous section coming due — a random key maximizes write spread and maximizes working-set size at the same time.

### Location-based shard keys and zones

"Location-based shard keys may be things like a user's IP, latitude and longitude, or address." The book widens the definition immediately: "They're not necessarily related to a physical location field: the 'location' might be a more abstract way that data should be grouped together. In any case, a location-based key is a key where documents with some similarity fall into a range based on this field." The payoff is twofold — "putting data close to its users and keeping related data together on disk" — plus a third reason that has only grown since 2019: "It may also be a legal requirement to remain compliant with GDPR or other similar data privacy legislation. MongoDB uses Zoned Sharding to manage this."

Sharding on an IP address, the book pins the US Postal Service's `56.*.*.*` block to `shard0000` and Apple's `17.*.*.*` block to either `shard0000` or `shard0002`, and doesn't care where anything else lives:

```
> sh.addShardToZone("shard0000", "USPS")
> sh.addShardToZone("shard0000", "Apple")
> sh.addShardToZone("shard0002", "Apple")
> sh.updateZoneKeyRange("test.ips", {"ip" : "056.000.000.000"},
... {"ip" : "057.000.000.000"}, "USPS")
> sh.updateZoneKeyRange("test.ips", {"ip" : "017.000.000.000"},
... {"ip" : "018.000.000.000"}, "Apple")
```

Two details in that snippet are load-bearing. First, the ranges are half-open — the USPS rule "attaches all IPs greater than or equal to 56.0.0.0 and less than 57.0.0.0 to the shard zoned `USPS`". Second, the IPs are stored **zero-padded as strings** (`"056.000.000.000"`, not `"56.0.0.0"`), because a range-partitioned shard key on a string field is ordered lexicographically; without the padding, `"6.0.0.0"` sorts after `"56.0.0.0"` and the zone ranges would be meaningless. A location-based key only works if the field's natural sort order matches the grouping you want.

And zones are advisory, not immediate: "When the balancer moves chunks, it will attempt to move chunks with those ranges to those shards. Note that this process is not immediate. Chunks that were not covered by a zone key range will be moved around normally."

The book flags a then-new improvement worth knowing: "In MongoDB 4.0.3+, you can define the zones and the zone ranges prior to sharding a collection, which populates chunks for both the zone ranges and for the shard key values as well as performing an initial chunk distribution of these. This greatly reduces the complexity for sharded zone setup." Define zones first, then shard — otherwise you pay for migrating data that was placed before the rules existed.

### Hashed shard keys

This is the chapter's answer to the ascending-key hotspot: "For loading data as fast as possible, hashed shard keys are the best option. A hashed shard key can make any field randomly distributed, so it is a good choice if you're going to be using an ascending key in a lot of queries but want writes to be randomly distributed."

The price is named in the very next sentence: "The trade-off is that you can never do a targeted range query with a hashed shard key. If you will not be doing range queries, though, hashed shard keys are a good option."

Setting one up is two commands — a hashed index, then the shard:

```
> db.users.createIndex({"username" : "hashed"})
> sh.shardCollection("app.users", {"username" : "hashed"})
{ "collectionsharded" : "app.users", "ok" : 1 }
```

Hashed sharding does something range sharding can't: on an empty collection, it pre-splits. "If you create a hashed shard key on a nonexistent collection, `shardCollection` behaves interestingly: it assumes that you want evenly distributed chunks, so it immediately creates a bunch of empty chunks and distributes them around your cluster." With three shards, `sh.status()` shows two chunks each, and the boundaries are worth staring at:

```
shard key: { "username" : "hashed" }
chunks:
    shard0000       2
    shard0001       2
    shard0002       2
{ "username" : { "$MinKey" : true } }  -->> { "username" : NumberLong("-6148914691236517204") }  on : shard0000
{ "username" : NumberLong("-6148914691236517204") } -->> { "username" : NumberLong("-3074457345618258602") } on : shard0000
{ "username" : NumberLong("-3074457345618258602") } -->> { "username" : NumberLong(0) } on : shard0001
{ "username" : NumberLong(0) } -->> { "username" : NumberLong("3074457345618258602") } on : shard0001
{ "username" : NumberLong("3074457345618258602") } -->> { "username" : NumberLong("6148914691236517204") } on : shard0002
{ "username" : NumberLong("6148914691236517204") } -->> { "username" : { "$MaxKey" : true } } on : shard0002
```

Those `NumberLong` values are not arbitrary. `3074457345618258602` is 2^64 / 6, so the six boundaries are exactly the signed 64-bit integer space cut into six equal ranges — two per shard. That is the whole mechanism in one screenful: **hashed sharding does not hash-and-modulo into a shard; it hashes the key into a 64-bit number and then range-partitions the hash space.** The chunk ranges are ranges of hash values, and the chunk-to-shard assignment is the balancer's business, exactly as with any other shard key. The benefit of priming: "there are no documents in the collection yet, but when you start inserting them, writes should be evenly distributed across the shards from the get-go. Ordinarily, you would have to wait for chunks to grow, split, and move to start writing to other shards."

The animation below walks that mechanism with the chapter's own running field — `username` on `app.users` — six usernames arriving in alphabetical order, six chunks (two per shard, as in the `sh.status()` output above), and each username's hash deciding which of the six hash-space ranges it falls into.

**The hash function in this animation is illustrative — it shows the mechanism, not MongoDB's real one.** MongoDB's hashed index computes a 64-bit hash whose exact bit-level algorithm is an internal implementation detail, not a publicly specified function you can reimplement; if you need the real value for a document, ask the server with `convertShardKeyToHashed()` rather than computing it yourself. The animation therefore uses the visualization engine's built-in `hash()` (Java's `String.hashCode()`) over a 32-bit space, purely to make "one key in, one deterministic hash-space range out" visible. Do not read the specific chunk assignments as anything MongoDB would produce; read the *shape* of the result.

```viz
type: formula
capacity = 6
chunkSize = 4294967296 / capacity
slot = floor((hash(item) + 2147483648) / chunkSize)
---
aliceroberts
bjornsvensson
carlos_mendes
dpatel
emma.wu
fatima_zahra
```

Here `capacity` is the number of chunks the hash space is cut into (six, matching the book's primed cluster), `chunkSize` is 2^32 / 6 — the illustrative stand-in for the book's 2^64 / 6 — and `slot` is the chunk whose hash range contains this username's hash. Walk the trace and four properties fall out; all four are true of real hashed sharding:

- **Alphabetically adjacent inputs land nowhere near each other.** The usernames arrive in ascending order — `aliceroberts`, `bjornsvensson`, `carlos_mendes`, ... — and they scatter across chunks 0, 4, 2, 1, 0, 2. That scattering *is* the fix for the ascending-key problem: the whole reason to hash is that the ordering of the input tells you nothing about the ordering of the hash.
- **Which is exactly why range queries die.** `db.users.find({username: {$gte: "a", $lt: "c"}})` covers two adjacent usernames here and they sit in two different chunks on two different shards. Extend it to a real collection and a range over usernames touches essentially every chunk in the cluster. This is the book's "you can never do a targeted range query with a hashed shard key," made concrete: the range is contiguous in *username* space and shredded in *hash* space, and hash space is the only thing chunk boundaries know about.
- **Placement is deterministic, and equality queries stay targeted.** `dpatel` hashes to chunk 1 on this insert and on every subsequent read. Hashing costs you range queries but not point queries — `mongos` hashes the value in a `find({username: "dpatel"})`, finds the one chunk whose range contains that hash, and routes to the one shard holding it.
- **Six documents is far too few to look even, and that is the honest lesson.** The trace puts three usernames on `shard0000` (chunks 0-1), two on `shard0001` (chunks 2-3), one on `shard0002` (chunks 4-5). Compare the book's own 10,000-insert experiment: 2726 / 2942 / 4332. Hashing gives you *statistical* evenness at volume, not a guarantee at any given moment — and it gives you nothing at all if the field's cardinality is low, because the hash of one value is one value and therefore one chunk.

The book closes the section with three limitations, all still worth memorizing: "First, you cannot use the `unique` option. As with other shard keys, you cannot use array fields. Finally, be aware that floating-point values will be rounded to whole numbers before hashing, so 1 and 1.999999 will both be hashed to the same value." That last one is a genuine footgun — a hashed shard key on a `double` field silently collapses every fractional value in an integer bucket into one hash.

### Hashed shard keys for GridFS

The book warns about the vocabulary first: "the term 'chunks' is overloaded since GridFS splits files into chunks and sharding splits collections into chunks," so it says "GridFS chunks" and "sharding chunks" throughout.

The setup is a nice worked example of the whole chapter, because the two obvious candidate keys are both wrong for the same reason. "GridFS collections are generally excellent candidates for sharding, as they contain massive amounts of file data. However, neither of the indexes that are automatically created on `fs.chunks` are particularly good shard keys: `{"_id" : 1}` is an ascending key and `{"files_id" : 1, "n" : 1}` picks up `fs.files`'s `_id` field, so it is also an ascending key." Both give you the max-chunk hotspot.

The fix, and why it is the right one: "if you create a hashed index on the `"files_id"` field, each file will be randomly distributed across the cluster, and a file will always be contained in a single chunk. This is the best of both worlds: writes will go to all shards evenly and reading a file's data will only ever have to hit a single shard."

That is the general principle behind every good hashed key: hash the field that identifies the *unit you read together*. Every GridFS chunk of one file shares one `files_id`, so hashing `files_id` distributes files across the cluster while keeping each file's bytes contiguous on one shard. Hash `_id` instead and you'd get the same even write spread and scatter every file's chunks across every shard.

```
> db.fs.chunks.createIndex({"files_id" : "hashed"})
> sh.shardCollection("test.fs.chunks", {"files_id" : "hashed"})
{ "collectionsharded" : "test.fs.chunks", "ok" : 1 }
```

As for `fs.files`: "it may or may not need to be sharded, as it will be much smaller than `fs.chunks`. You can shard it if you would like, but it is not likely to be necessary."

### The firehose strategy

Sometimes the max-chunk hotspot is what you want. "If you have some servers that are more powerful than others, you might want to let them handle proportionally more load than your less-powerful servers. For example, suppose you have one shard that can handle 10 times the load of your other machines. Luckily, you have 10 other shards. You could force all inserts to go to the more powerful shard, and then allow the balancer to move older chunks to the other shards. This would give lower-latency writes."

You do it by deliberately pinning the top chunk with a zone:

```
> sh.addShardToZone("<shard-name>", "10x")
> sh.updateZoneKeyRange("<dbName.collName>", {"_id" : ObjectId()},
... {"_id" : MaxKey}, "10x")
```

"Now all inserts will be routed to this last chunk, which will always live on the shard zoned `10x`." But the range you just pinned is *now through infinity*, and it never expires on its own: "ranges from now through infinity will be trapped on this shard unless we modify the zone key range." So the strategy needs a daily job that walks the pin forward — fetch the zone whose `max` is `MaxKey`, set its `min` to a fresh `ObjectId()`, save it — "then all of the previous day's chunks would be able to move to other shards."

The second downside is about growth: "it requires some changes to scale. If your most powerful server can no longer handle the number of writes coming in, there is no trivial way to split the load between this server and another." A firehose has exactly one nozzle.

And then the chapter's flattest rule: "If you do not have a high-performance server to firehose into or you are not using zone sharding, do not use an ascending key as the shard key. If you do, all writes will go to a single shard."

### Multi-hotspot: random first, ascending second

This section names the tension the rest of the chapter dances around: "Standalone `mongod` servers are most efficient when doing ascending writes. This conflicts with sharding, in that sharding is most efficient when writes are spread over the cluster." Ascending writes are good for one machine (append at the end of the index, hot pages stay hot) and terrible for a cluster. Hashing is good for the cluster and gives up locality *within* each shard.

Multi-hotspot buys both: "The technique described here basically creates multiple hotspots — optimally several on each shard — so that writes are evenly balanced across the cluster but, within a shard, ascending."

The mechanism is a compound shard key with a specific shape:

- **First field: "a rough, random value with low-ish cardinality."** The book's figure uses a US state. "You can picture each value in the first part of the shard key as a chunk... if you insert enough data, you should eventually have approximately one chunk per random value."
- **Second field: an ascending key** (`_id`). "This means that within a chunk, values are always increasing... Thus, if you had one chunk per shard, you'd have the perfect setup: ascending writes on every shard."

The sizing of that first field is the whole craft, and the book gives both failure modes. Too few hotspots: "having n chunks with n hotspots spread across n shards isn't very extensible: add a new shard and it won't get any writes because there's no hotspot chunk to put on it." Too many: "having, say, a thousand hotspots on a shard will end up being equivalent to random writes." The target is "a few hotspot chunks per shard (to give you room to grow), but not too many."

One mechanical detail explains why the pattern is stable rather than degenerating: "Once a chunk is split, only one of the new chunks will be a hotspot chunk: the other chunk will essentially be 'dead' and never grow again." Each `(state, _id)` chunk grows at its top edge until it splits; the lower half is frozen forever and the upper half keeps taking ascending inserts. "You can picture this setup as each chunk being a stack of ascending documents. There are multiple stacks on each shard, each ascending until the chunk is split. If the stacks are evenly distributed across the shards, writes will be evenly distributed."

### Shard key rules and guidelines

The framing is the most useful sentence in the section: "Determining which key to shard on and creating shard keys should be reminiscent of indexing because the two concepts are similar. In fact, often your shard key may just be the index you use most often (or some variation on it)." Your query patterns already told you what the shard key should be — you wrote them down as indexes.

**Limitations.**

- "Shard keys cannot be arrays. `sh.shardCollection()` will fail if any key has an array value, and inserting an array into that field is not allowed."
- "Once inserted, a document's shard key value may be modified unless the shard key field is an immutable `_id` field. In older versions of MongoDB prior to 4.2, it was not possible to modify a document's shard key value."
- "Most special types of indexes cannot be used for shard keys. In particular, you cannot shard on a geospatial index. Using a hashed index for a shard key is allowed."

**Cardinality.** "Whether your shard key jumps around or increases steadily, it is important to choose a key with values that will vary. As with indexes, sharding performs better on high-cardinality fields. If, for example, you had a `"logLevel"` key that had only values `"DEBUG"`, `"WARN"`, or `"ERROR"`, MongoDB wouldn't be able to break up your data into more than three chunks (because there would be only three different values for the shard key)."

Three distinct values means three chunks means at most three shards can hold data, forever — and hashing does not save you, because hashing a three-valued field produces three hashes. The fix is compounding: "If you have a key with little variation and want to use it as a shard key anyway, you can do so by creating a compound shard key on that key and a key that varies more, like `"logLevel"` and `"timestamp"`. It is important that the combination of keys has high cardinality." Note that this is the multi-hotspot shape again — low-cardinality prefix, high-cardinality ascending suffix.

### Controlling data distribution: zones per collection, and manual sharding

"Sometimes, automatic data distribution will not fit your requirements." The book gates the whole section up front: "As your cluster gets larger or busier, these solutions become less practical. However, for small clusters, you may want more control."

**Zoning whole collections.** "MongoDB evenly distributes collections across every shard in your cluster, which works well if you're storing homogeneous data. However, if you have a log collection that is 'lower value' than your other data, you might not want it taking up space on your more expensive servers. Or, if you have one powerful shard, you might want to use it for only a real-time collection." Instead of building separate clusters, zone the shards and then map an entire collection's key range — `MinKey` to `MaxKey` — onto a zone:

```
> sh.addShardToZone("shard0000", "high")
> sh.addShardToZone("shard0004", "low")
> sh.addShardToZone("shard0005", "low")
> sh.updateZoneKeyRange("super.important", {"<shardKey>" : MinKey},
... {"<shardKey>" : MaxKey}, "high")
> sh.updateZoneKeyRange("some.logs", {"<shardKey>" : MinKey},
... {"<shardKey>" : MaxKey}, "low")
```

"This says, 'for negative infinity to infinity for this collection, store it on shards tagged `high`.' This means that no data from the `super.important` collection will be stored on any other server. Note that this does not affect how other collections are distributed: they will still be evenly distributed between this shard and the others." The log collection "will now be split evenly between `shard0004` and `shard0005`."

Four operational notes the book is careful about:

- It is not instant: "Assigning a zone key range to a collection does not affect it instantly. It is an instruction to the balancer stating that, when it runs, these are the viable targets to move the collection to."
- Shards can carry many zones at once — the book zones all five non-`high` shards as `"whatever"` to express "anywhere but the fast box." "Shards can have as many zones as you need."
- There is no dynamic placement: "You cannot assign collections dynamically — i.e., you can't say, 'when a collection is created, randomly home it to a shard.' However, you could have a cron job that went through and did this for you."
- Emptying a zone strands the data rather than freeing it: `sh.removeShardFromZone()` undoes an assignment, but "if you remove all shards from zones described by a zone key range... the balancer won't distribute the data anywhere because there aren't any valid locations listed. All the data will still be readable and writable; it just won't be able to migrate until you modify your tags or tag ranges." To retire a range use `sh.removeRangeFromZone()`, and note that "the range specified must be an exact match to a range previously defined for the namespace."

**Manual sharding.** "Sometimes, for complex requirements or special situations, you may prefer to have complete control over which data is distributed where. You can turn off the balancer if you don't want data to be automatically distributed and use the `moveChunk` command to manually distribute data."

```
> sh.stopBalancer()
> while(sh.isBalancerRunning()) { print("waiting..."); sleep(1000); }
> db.chunks.find()                    // in the config database
> sh.moveChunk("test.manual.stuff",
... {user_id: NumberLong("-1844674407370955160")}, "test-rs1")
```

Stopping the balancer is asynchronous — "if there is currently a migrate in progress, this setting will not take effect until the migrate has completed" — hence the polling loop. `moveChunk` takes the **lower bound** of the chunk plus the destination shard name.

The book then argues against everything it just showed you: "unless you are in an exceptional situation, you should use MongoDB's automatic sharding instead of doing it manually. If you end up with a hotspot on a shard that you weren't expecting, you might end up with most of your data on that shard." And the specific trap: "do not combine setting up unusual distributions manually with running the balancer. If the balancer detects an uneven number of chunks it will simply reshuffle all of your work to get the collection evenly balanced again. If you want uneven distribution of chunks, use the zone sharding technique." Manual placement with the balancer on isn't a partial win — it's work that gets silently undone.

### Book vs. today

The chapter's *reasoning* has aged extremely well: the four workload questions, the three distribution shapes, the hotspot mechanics, the cardinality rule, and the zone recipes are all still exactly how you think about this. Several mechanical facts around it have moved.

> **"Once you shard a collection you cannot change your shard key" is the one claim that is no longer true, and it is the chapter's opening premise.** Two server features arrived after the book: `refineCollectionShardKey` (MongoDB 4.4) lets you *append* suffix fields to an existing shard key — useful precisely for the cardinality fix above, turning `{logLevel: 1}` into `{logLevel: 1, timestamp: 1}` in place — and `reshardCollection` (MongoDB 5.0) performs a full online resharding onto a completely different shard key. MongoDB 8.0 went further, adding `unshardCollection` and `moveCollection` and making resharding substantially faster. So the decision is reversible now, which is a real change. It is not, however, cheap: resharding rewrites every document in the collection into a new distribution, needs headroom for a second copy, and is an operations project rather than a config change. Treat the book's rule as sound *engineering* advice with an outdated absolute — choose as if you can't change it, and be glad you can.

> **`ensureIndex()` is gone; use `createIndex()`.** The GridFS snippet in the book reads `db.fs.chunks.ensureIndex({"files_id" : "hashed"})`. `ensureIndex` was deprecated in MongoDB 3.0 and removed in MongoDB 5.0; the code sample above uses `createIndex`, which is what the book's own hashed-`username` example already used. A pure rename, no behavior change.

> **Compound hashed shard keys removed the book's main hashed-key restriction.** The book notes that "as of this writing, `mongos` cannot use a subset of the compound index as a shard key," which is why the GridFS setup needs a dedicated single-field hashed index on `files_id`. MongoDB 4.4 added compound hashed indexes: a compound shard key may now contain exactly one hashed field alongside range fields, in any position. This matters most for the multi-hotspot and zone patterns — you can now write a shard key like `{region: 1, userId: "hashed"}` and get zone-able, range-queryable placement on the prefix with hashed spread inside it, which in 2019 required choosing one or the other.

> **The chunk-counting mental model has been replaced by data size.** The book's narrative — chunks "falling off" the max chunk via autosplit, and "if the balancer detects an uneven **number** of chunks it will simply reshuffle all of your work" — describes the pre-6.0 balancer. MongoDB 6.0 changed the balancer to even out *data size* per shard rather than chunk count, and auto-splitting was subsequently removed (chunks are now split only as part of migration). The consequences of an ascending shard key are unchanged — one shard still absorbs every insert — but "count the chunks per shard" is no longer how you diagnose imbalance; `sh.status()`, `db.collection.getShardDistribution()`, and `sh.balancerCollectionStatus()` report on size. The 4.2 "top chunk optimization" note is history rather than current mechanics.

> **The 10,000-insert `findShard` snippet won't run as written.** It reads `db.random.find({_id:id}).explain()` and then walks `explain.shards[i][0].server` — that is the legacy `explain` output format, replaced by the `queryPlanner`/`executionStats` structure in MongoDB 3.0. The experiment is still worth reproducing; do it with `db.collection.getShardDistribution()` or `explain("executionStats")` instead. The measured *result* — roughly, not exactly, even — is the durable part.

> **Zones are unchanged.** `sh.addShardToZone()`, `sh.updateZoneKeyRange()`, `sh.removeShardFromZone()`, and `sh.removeRangeFromZone()` are all still the current API, and the "define zones before sharding to pre-populate chunks" behavior the book credits to 4.0.3+ is still how you're told to do it. This is worth saying plainly rather than hedging: the zone recipes in this chapter, including the firehose, can be typed into a current cluster as written.

> **Hashed-key limitations: mostly unchanged, one worth restating precisely.** No `unique` option and no array fields still hold. The floating-point warning also still holds and is still documented — a hashed index truncates a `double` to a 64-bit integer before hashing, so `1` and `1.999999` really do collide. On the hash itself: MongoDB has never published the algorithm as a reimplementable specification, which is why the animation above is framed as illustrative; `convertShardKeyToHashed()` is the supported way to obtain a real hashed value.

## Trade-offs

- **An ascending shard key concentrates 100% of inserts on one shard, and the cluster cannot fix it for you.** This is the chapter's central failure mode and it deserves the sharpest statement: with an `ObjectId` or `date` shard key, "every subsequent insert will be into the max chunk," so a ten-shard cluster has the write throughput of one shard. The damage is not only throughput — the balancer is now permanently in catch-up mode, "constantly mov[ing] chunks to other shards instead of correcting the small imbalances that might occur in more evenly distributed systems," which means continuous migration traffic competing with your workload for exactly as long as you keep inserting. The 4.2 top-chunk optimization spreads where new chunks are *created*, not where writes *go*. And the reason people keep choosing this key anyway is that it is genuinely the best choice for a single `mongod` — ascending inserts append to the hot end of the index and keep the working set tiny — so the pull toward it is real, not ignorance. The book's rule is unambiguous: unless you are deliberately running the firehose strategy onto an oversized shard, "do not use an ascending key as the shard key."
- **Hashing fixes the hotspot by destroying range-query locality, and that trade cannot be partially taken.** "You can never do a targeted range query with a hashed shard key" — walk the animation above and see why: two alphabetically adjacent usernames land in different chunks on different shards, so `{username: {$gte: "a", $lt: "c"}}` becomes a scatter-gather across the cluster. `mongos` has to broadcast, every shard scans, and the results are merged. Point queries survive (hash the value, route to one shard) but ranges, sorted pagination on the shard key, and "give me everything from last Tuesday" do not. The second cost is quieter and the book names it in the random-key section: random access defeats caching, and "MongoDB isn't efficient at randomly accessing data beyond the size of RAM." So hashing trades write-throughput and even growth for read locality and working-set size. Choose it when your reads are predominantly single-document lookups by the shard key; choose against it when a meaningful share of reads are ranges — and if the answer is "both," compound hashed shard keys (4.4+) let you scope the hashing to a range-partitioned prefix instead of the whole key.
- **The decision has migration-shaped cost, which changes the *process* even now that it is reversible.** The book's "you cannot change your shard key" is now false in the narrow sense — `refineCollectionShardKey` (4.4) appends suffix fields, `reshardCollection` (5.0) rewrites onto an entirely new key, and 8.0 made both faster — but resharding a live collection rewrites every document into a new distribution, wants capacity headroom for a second copy while it runs, and is scheduled as an operations project. Compare that to the alternative it replaced (dump, drop, re-shard, restore, with downtime) and it is an enormous improvement; compare it to `ALTER TABLE` and it is not in the same category. The practical consequence is process, not code: the cheap moment to get this right is *before* the collection has data, when the book's advice — "try it out on a backup dataset with sample traffic," because "there is no substitute for trying it on your own data" — costs a day instead of a quarter. This is among the most consequential early decisions in a sharded deployment precisely because everything downstream (which queries are targeted, which are broadcast, how the working set behaves, whether you can zone for residency) is derived from it.
- **Cardinality is a hard ceiling on how far a collection can ever be split, and it is invisible until you need the next shard.** A `"logLevel"` shard key with three values yields at most three chunks — "MongoDB wouldn't be able to break up your data into more than three chunks" — no matter how many shards you add or how large the collection grows. Nothing errors; the cluster simply stops being able to rebalance, and one chunk grows until it becomes a jumbo chunk the balancer refuses to move. Hashing does not help, because the hash of three values is three values. The fix — compound the low-cardinality field with something that varies, `{logLevel: 1, timestamp: 1}` — works, and is now applicable in place via `refineCollectionShardKey`, but note that it converts the key into the multi-hotspot shape with all of that pattern's tuning attached: too few distinct prefixes and new shards get no writes, too many and you have random writes with extra steps.
- **Zones give you placement control and take away the balancer's ability to help you.** Pinning a collection to a zone is the only real answer for data residency (GDPR) and for heterogeneous hardware, and the API is stable and pleasant. But every zone rule is a constraint the balancer must satisfy, and constraints compose badly: pin `MinKey`-to-`MaxKey` of a collection to one zone and that collection's growth is now bounded by that zone's capacity, with no automatic relief. Empty a zone by accident and the data becomes immovable rather than redistributed — "the balancer won't distribute the data anywhere because there aren't any valid locations listed. All the data will still be readable and writable; it just won't be able to migrate." The firehose strategy inherits the worst version of this: the pinned range runs "from now through infinity," so a cron job walking the pin forward is not a nice-to-have but load-bearing infrastructure, and if it stops, every chunk you ever write is trapped on one shard.
- **Manual `moveChunk` is the option that looks like control and is usually self-deleting work.** Turning off the balancer and placing chunks by hand is available, documented, and almost always wrong: "unless you are in an exceptional situation, you should use MongoDB's automatic sharding." The failure is not subtle — leave the balancer running and "if the balancer detects an uneven number of chunks it will simply reshuffle all of your work"; turn it off and you have accepted permanent responsibility for rebalancing a system whose data distribution changes every second. And it does not degrade gracefully as the cluster grows, which is why the book gates the whole section: "as your cluster gets larger or busier, these solutions become less practical." If you want uneven distribution, express it declaratively with zones so the balancer enforces your intent instead of fighting it.
- **Sharding for latency and sharding for throughput want different keys, and you have to pick which one you're buying.** The four opening questions are not a checklist, they're a disambiguation. Lower write latency points at location-based keys and zones — put the data near the user or on the faster machine — which by construction produces uneven distribution. Higher write throughput points at hashed or random keys, which by construction produce even distribution and destroy locality. A small working set points at ascending keys, which produce the hotspot. There is no key that wins all three, and the multi-hotspot pattern is the book's best attempt at a compromise (cluster-even, shard-ascending) at the price of being the hardest one to tune: the low-cardinality prefix has to be sized against your current *and* future shard count, and both failure modes — too few hotspots, too many — are silent.

## Documentation Links

- [Shannon Bradshaw, Eoin Brazil, and Kristina Chodorow, "MongoDB: The Definitive Guide", 3rd Edition (O'Reilly, 2020) — Chapter 16, "Choosing a Shard Key", p. 340-359](https://www.oreilly.com/library/view/mongodb-the-definitive/9781491954454/) — doc
- [MongoDB Documentation — Choose a Shard Key](https://www.mongodb.com/docs/manual/core/sharding-choose-a-shard-key/) — doc
- [MongoDB Documentation — Hashed Sharding](https://www.mongodb.com/docs/manual/core/hashed-sharding/) — doc
- [MongoDB Documentation — Ranged Sharding](https://www.mongodb.com/docs/manual/core/ranged-sharding/) — doc
- [MongoDB Documentation — Shard Keys (cardinality, frequency, monotonicity)](https://www.mongodb.com/docs/manual/core/sharding-shard-key/) — doc
- [MongoDB Documentation — Reshard a Collection (reshardCollection)](https://www.mongodb.com/docs/manual/core/sharding-reshard-a-collection/) — doc
- [MongoDB Documentation — Refine a Shard Key (refineCollectionShardKey)](https://www.mongodb.com/docs/manual/core/sharding-refine-a-shard-key/) — doc
- [MongoDB Documentation — Zones and Zone Sharding](https://www.mongodb.com/docs/manual/core/zone-sharding/) — doc
- [MongoDB Documentation — Sharded Cluster Balancer](https://www.mongodb.com/docs/manual/core/sharding-balancer-administration/) — doc
- [MongoDB Documentation — Data Partitioning with Chunks](https://www.mongodb.com/docs/manual/core/sharding-data-partitioning/) — doc
- [MongoDB Documentation — Hashed Indexes](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-hashed/) — doc
- [MongoDB Documentation — Shard a GridFS Data Store](https://www.mongodb.com/docs/manual/tutorial/shard-gridfs-data/) — doc
