---
version: 1.0
updatedAt: 2026-10-29
---
## Objective

An embedding turns text into a fixed-length vector of floats so that texts
with close meaning get close vectors. `IEmbeddingGenerator<string,
Embedding<float>>` (Microsoft.Extensions.AI) produces them and
Microsoft.Extensions.VectorData stores and searches them, each behind one
abstraction. This lesson runs both against a local Ollama with
`embeddinggemma:300m` and measures size, norm, batching, similarity, task
prefixes, caching, bad input, and why the same search code returns scores
with opposite meaning on two providers. Packages: Microsoft.Extensions.AI and
Microsoft.Extensions.VectorData.Abstractions 10.11.0, OllamaSharp 5.5.0,
CommunityToolkit.VectorData.InMemory 1.0.1, CommunityToolkit.VectorData.SqliteVec
1.0.3-preview (prerelease, no stable exists), System.Numerics.Tensors and
Microsoft.Extensions.Caching.Memory 10.0.14, on Ollama 0.40.12.

## Use Cases

- Semantic search over FAQs or tickets whose wording differs from the user's.
- The retrieval step of RAG: find the few chunks worth sending to the model.
- Deduplication: flag two tickets whose vectors are closer than a threshold.
- Prototyping with an in-process store, then moving to a database provider
  without rewriting the search code.

## Deep Dive

### A generator on Ollama, batching and similarity

`Microsoft.Extensions.AI.Ollama` is deprecated on NuGet ("the OllamaSharp
package is recommended"). `OllamaApiClient` implements both `IChatClient` and
`IEmbeddingGenerator`. A `DelegatingHandler` on its `HttpClient` counts the
HTTP requests:

```csharp
IEmbeddingGenerator<string, Embedding<float>> gen =
    new OllamaApiClient(httpClientWithCounter, "embeddinggemma:300m");
Embedding<float> one = await gen.GenerateAsync("The cat sleeps on the sofa.");
float norm = TensorPrimitives.Norm(one.Vector.Span);     // Vector is ReadOnlyMemory<float>
string[] batch = ["The cat sleeps on the sofa.", "A kitten is napping on the couch.",
                  "Quarterly tax filing deadlines for small businesses."];
GeneratedEmbeddings<Embedding<float>> all = await gen.GenerateAsync(batch);
// v = the three vectors as float[]
float cos = TensorPrimitives.CosineSimilarity(v[0], v[1]);
float dot = TensorPrimitives.Dot(v[0], v[1]);
```

```text
Dimensions: 768, norm 1.0000
batch of 3: 3 embeddings, 1 HTTP request(s), usage input tokens: 31
POST /api/embed {"model":"embeddinggemma:300m","input":["The cat sleeps on the sofa.", ...]}
cos(cat, kitten) = 0.80  dot = 0.80
cos(cat, tax)    = 0.20  dot = 0.20
```

Identical in 3 of 3 runs. A batch is one `/api/embed` request, and its first
vector was bit-for-bit the single-call vector. Ollama returns unit-length
vectors here, so dot product equals cosine (the cheaper one is enough).
Unrelated is not 0: across this lesson unrelated sentences scored 0.18 to
0.32. `/api/show` reports `embedding_length 768` and `context_length 2048`.

### Task prefixes for embeddinggemma

The model card recommends `task: search result | query: {content}` for
queries and `title: {title | "none"} | text: {content}` for documents. On 6
FAQ sentences and 6 queries (2 shown):

```text
NO prefixes
  "how do I reset my password":  d0:0.78 d3:0.42 d4:0.32 ...  gap1-2 0.35
  "when will I receive my bill": d2:0.56 d4:0.40 d1:0.27 ...  gap1-2 0.16
WITH prefixes
  "how do I reset my password":  d0:0.61 d3:0.32 d4:0.12 ...  gap1-2 0.29
  "when will I receive my bill": d2:0.45 d4:0.23 d1:0.05 ...  gap1-2 0.22
```

In 3 of 3 runs the top result was the same for all 6 queries, documents
ranked 3 to 6 fell from 0.18 to 0.32 down to -0.04 to 0.18 with prefixes, and
the first-to-second gap grew on 3 queries and shrank on 3. Prefixes changed
the scale, not the ranking: a threshold tuned under one convention is wrong
under the other.

### Caching with UseDistributedCache

```csharp
var cached = new EmbeddingGeneratorBuilder<string, Embedding<float>>(gen)
    .UseDistributedCache(new MemoryDistributedCache(
        Options.Create(new MemoryDistributedCacheOptions())))
    .Build();
```

```text
first call: 1 HTTP request(s)
second call: 1 HTTP request(s), same vector: True
batch [cached, new]: 2 HTTP request(s) total; last body: ... "input":["A brand new sentence."]
```

The cache works per item: in a mixed batch only the missing string went out.

### Empty and oversized input

```text
empty: dims 768, norm 1.0000      (whitespace only: the same)
1000 words: dims 768, input tokens 1003
3000 words: dims 768, input tokens 2048
```

No exception: an empty string gets a valid-looking vector, and text past the
2048-token context is cut silently. Ollama's `truncate: false` makes it fail;
OllamaSharp copies an `AdditionalProperties` entry onto the request:

```csharp
new EmbeddingGenerationOptions { AdditionalProperties = new() { ["truncate"] = false } }
// OllamaSharp.Models.Exceptions.OllamaException: the input length exceeds the context length
```

### The record and two providers

The current names are `VectorStore`, `VectorStoreCollection<TKey, TRecord>`
and the attributes below (the older `VectorStoreRecordKey` and
`IVectorStoreRecordCollection<,>` fail with CS0246). A `string` vector
property is embedded by the store's generator on upsert and search:

```csharp
class Faq
{
    [VectorStoreKey] public int Id { get; set; }
    [VectorStoreData(IsIndexed = true)] public string Category { get; set; } = "";
    [VectorStoreData] public string Text { get; set; } = "";
    [VectorStoreVector(768)] public string Embedding => Text;   // 768 = the model
}
```

`Microsoft.SemanticKernel.Connectors.InMemory` and `.SqliteVec` are deprecated
on NuGet as renamed to `CommunityToolkit.VectorData.*`. One line picks one:

```csharp
VectorStore store = provider == "sqlite"
    ? new SqliteVectorStore($"Data Source={dbPath}", new() { EmbeddingGenerator = gen })
    : new InMemoryVectorStore(new() { EmbeddingGenerator = gen });
var faq = store.GetCollection<int, Faq>("faq");
await faq.EnsureCollectionExistsAsync();
await faq.UpsertAsync(rows);                               // 6 records
await foreach (var r in faq.SearchAsync(text, top: 3))
    Console.WriteLine($"{r.Record.Id} {r.Record.Category} score {r.Score:F4}");
```

Both ran on macOS arm64 (`sqlite-vec` ships an osx-arm64 `vec0.dylib`); each
sent 1 embedding request for the 6-record upsert. Searching record 4's text:

```text
[InMemoryVectorStore]          [SqliteVectorStore]
  4 account  score 1.0000        4 account  score 0.0000
  1 account  score 0.3838        1 account  score 0.6162
  3 billing  score 0.1973        3 billing  score 0.8027
```

Same ranking, opposite scale. InMemory defaults to cosine similarity (higher
is better). SQLite created `vec0(Id INTEGER PRIMARY KEY, Embedding FLOAT[768]
distance_metric=cosine)` and returns cosine distance, `1 - similarity` (lower
is better). A threshold like `r.Score > 0.5` inverts when the provider changes.
With `DistanceFunction` set explicitly (identical text / unrelated text):

| DistanceFunction | InMemory | SQLite |
| --- | --- | --- |
| CosineSimilarity | 1.0000 / 0.1614 | NotSupportedException |
| CosineDistance | -0.0000 / 0.8386 | 0.0000 / 0.8386 |
| DotProductSimilarity | 1.0000 / 0.1614 | NotSupportedException |
| EuclideanDistance | 0.0000 / 1.2951 | 0.0000 / 1.2951 |
| ManhattanDistance | NotSupportedException | 0.0000 / 28.2211 |

SQLite says `Distance function 'CosineSimilarity' for VectorStoreVectorProperty
'Embedding' is not supported by the SQLite connector.` `IndexKind.Hnsw` raised
no error anywhere and changed nothing (SQLite created the same `vec0` table).

Filter, get and delete work the same on both:

```csharp
var hits = faq.SearchAsync("how do I reset my password", top: 3,
    new() { Filter = r => r.Category == "billing" });  // InMemory: 5 (0.3199), 3 (0.2746)
await faq.GetAsync(4);      // Passwords must contain at least twelve characters.
await faq.DeleteAsync(4);   // then GetAsync(4) returns null
```

The filter is a LINQ expression each provider translates (SQLite created
`faq_Category_index` for the `IsIndexed` property and returned the same two
records). Unfiltered, the top hit was record 1 (0.7754): filters keep weak
matches, so a score threshold still matters.

### Limits: dimensions, brute force, model changes

A record declared `[VectorStoreVector(512)]` while the model returns 768:

```text
InMemory: upsert succeeded, search ok, score 1
SQLite:   VectorStoreException: Call to vector store failed.
  inner SqliteException: SQLite Error 1: 'Dimension mismatch for inserted vector
  for the "Embedding" column. Expected 512 dimensions but received 768.'
```

InMemory never checked the size. The docs warn: "Avoid using the InMemory
provider for testing, as there can be important differences between this
provider and your production database", and suggest Testcontainers.

Both stores scaled like a full scan: on random unit vectors (shared machine,
orders only) InMemory took about 5 ms per search at 20,000 records and 23 ms
at 100,000, SQLite about 22 ms and 96 ms. Server providers (PgVector, Azure
AI Search, Qdrant, Cosmos DB) were not run. Vectors from two models are not
comparable even at equal length, so a new model means re-embedding every
record (reasoning, not measured: `qwen3:4b-instruct` answered `/api/embed`
with HTTP 501).

## Trade-offs

- **Score semantics belong to the provider.** Compare scores only within one
  provider and distance function, and pin `DistanceFunction` on the vector
  property so a provider swap fails loudly instead of inverting thresholds.
- **InMemory is a prototype, not a test double.** It skipped the dimension
  check SQLite enforced and rejects `ManhattanDistance`.
- **SqliteVec is a preview with sharp edges.** In 1.0.3-preview a record with
  only key and vector failed on upsert (`near ")": syntax error`), and keys
  `[0, 1]` in one batch failed (`UNIQUE constraint failed on vec_raw primary
  key`) while `[1, 2]` worked.
- **Cache embeddings, one cache per model.** A model change must not serve old vectors.
- **Silent truncation hides content.** Chunk long documents before embedding
  (the RAG lesson) or send `truncate: false` to fail instead.

## Documentation Links

- [Use the IEmbeddingGenerator interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/iembeddinggenerator) (doc)
- [How embeddings extend your AI model's reach, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/conceptual/embeddings) (doc)
- [Vector databases for .NET AI apps, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/vector-stores/overview) (doc)
- [Vector search using vector store providers, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/vector-stores/vector-search) (doc)
- [Retrieval-augmented generation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/conceptual/rag) (doc)
- [EmbeddingGemma model card, Google AI for Developers](https://ai.google.dev/gemma/docs/embeddinggemma/model_card) (doc)
