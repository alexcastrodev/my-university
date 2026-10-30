---
version: 1.0
updatedAt: 2026-10-29
title: "Embeddings e Busca Vetorial com Microsoft.Extensions.VectorData"
summary: Gere embeddings com IEmbeddingGenerator sobre o Ollama, compare vetores com TensorPrimitives, meça prefixos de tarefa, cache e entradas ruins, e grave e busque vetores com o mesmo código em InMemory e SQLite (sqlite-vec), vendo por que o score muda de sentido entre providers.
---
## Objective

Um embedding transforma texto em um vetor de floats de tamanho fixo, e textos
de significado próximo ganham vetores próximos. `IEmbeddingGenerator<string,
Embedding<float>>` (Microsoft.Extensions.AI) gera os vetores e o
Microsoft.Extensions.VectorData grava e busca. Esta lição roda os dois contra
um Ollama local com `embeddinggemma:300m` e mede tamanho, norma, batch,
similaridade, prefixos, cache, entrada ruim, e por que o mesmo código de busca
devolve scores de sentido oposto em dois providers. Pacotes:
Microsoft.Extensions.AI e Microsoft.Extensions.VectorData.Abstractions 10.11.0,
OllamaSharp 5.5.0, CommunityToolkit.VectorData.InMemory 1.0.1,
CommunityToolkit.VectorData.SqliteVec 1.0.3-preview (prerelease, sem versão
estável), System.Numerics.Tensors e Microsoft.Extensions.Caching.Memory
10.0.14, sobre o Ollama 0.40.12.

## Use Cases

- Busca semântica em FAQs ou tickets escritos com outras palavras.
- A etapa de recuperação do RAG: achar os poucos trechos que valem ir ao modelo.
- Deduplicação: marcar dois tickets cujos vetores estão mais perto que um limite.
- Prototipar com um store em processo e depois trocar por um provider de banco
  sem reescrever o código de busca.

## Deep Dive

### Um gerador no Ollama, batch e similaridade

O `Microsoft.Extensions.AI.Ollama` está deprecated no NuGet ("the OllamaSharp
package is recommended"). O `OllamaApiClient` implementa tanto `IChatClient`
quanto `IEmbeddingGenerator`. Um `DelegatingHandler` no `HttpClient` dele conta
as requisições HTTP:

```csharp
IEmbeddingGenerator<string, Embedding<float>> gen =
    new OllamaApiClient(httpClientWithCounter, "embeddinggemma:300m");
Embedding<float> one = await gen.GenerateAsync("The cat sleeps on the sofa.");
float norm = TensorPrimitives.Norm(one.Vector.Span);     // Vector é ReadOnlyMemory<float>
string[] batch = ["The cat sleeps on the sofa.", "A kitten is napping on the couch.",
                  "Quarterly tax filing deadlines for small businesses."];
GeneratedEmbeddings<Embedding<float>> all = await gen.GenerateAsync(batch);
// v = os três vetores como float[]
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

Idêntico em 3 de 3 execuções. Um batch é uma requisição `/api/embed`, e o
primeiro vetor saiu bit a bit igual ao da chamada única. Com norma 1, produto
escalar é igual a cosseno (o mais barato basta). Sem relação não é 0: nesta
lição, frases sem relação ficaram entre 0.18 e 0.32. O `/api/show` informa
`embedding_length 768` e `context_length 2048`.

### Prefixos de tarefa do embeddinggemma

O model card recomenda `task: search result | query: {content}` para consultas e
`title: {title | "none"} | text: {content}` para documentos. Com 6 frases de FAQ
e 6 consultas (2 mostradas):

```text
NO prefixes
  "how do I reset my password":  d0:0.78 d3:0.42 d4:0.32 ...  gap1-2 0.35
  "when will I receive my bill": d2:0.56 d4:0.40 d1:0.27 ...  gap1-2 0.16
WITH prefixes
  "how do I reset my password":  d0:0.61 d3:0.32 d4:0.12 ...  gap1-2 0.29
  "when will I receive my bill": d2:0.45 d4:0.23 d1:0.05 ...  gap1-2 0.22
```

Em 3 de 3 execuções o primeiro resultado foi o mesmo nas 6 consultas, os
documentos nas posições 3 a 6 caíram de 0.18 a 0.32 para -0.04 a 0.18 com
prefixos, e a distância entre o primeiro e o segundo aumentou em 3 consultas e
diminuiu em 3. Os prefixos mudaram a escala, não o ranking: um limite ajustado
numa convenção está errado na outra.

### Cache com UseDistributedCache

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

O cache funciona por item: num batch misto só a string que faltava saiu.

### Entrada vazia e grande demais

```text
empty: dims 768, norm 1.0000      (whitespace only: the same)
1000 words: dims 768, input tokens 1003
3000 words: dims 768, input tokens 2048
```

Nenhuma exceção: uma string vazia ganha um vetor com cara de válido, e o texto
que passa do contexto de 2048 tokens é cortado em silêncio. O `truncate: false`
do Ollama faz falhar; o OllamaSharp copia uma entrada de `AdditionalProperties`
para a requisição:

```csharp
new EmbeddingGenerationOptions { AdditionalProperties = new() { ["truncate"] = false } }
// OllamaSharp.Models.Exceptions.OllamaException: the input length exceeds the context length
```

### O record e dois providers

Os nomes atuais são `VectorStore`, `VectorStoreCollection<TKey, TRecord>` e os
atributos abaixo (os antigos `VectorStoreRecordKey` e
`IVectorStoreRecordCollection<,>` falham com CS0246). Um vetor do tipo `string`
vira embedding pelo gerador do store no upsert e na busca:

```csharp
class Faq
{
    [VectorStoreKey] public int Id { get; set; }
    [VectorStoreData(IsIndexed = true)] public string Category { get; set; } = "";
    [VectorStoreData] public string Text { get; set; } = "";
    [VectorStoreVector(768)] public string Embedding => Text;   // 768 = o modelo
}
```

`Microsoft.SemanticKernel.Connectors.InMemory` e `.SqliteVec` estão deprecated
no NuGet, renomeados para `CommunityToolkit.VectorData.*`. Uma linha escolhe:

```csharp
VectorStore store = provider == "sqlite"
    ? new SqliteVectorStore($"Data Source={dbPath}", new() { EmbeddingGenerator = gen })
    : new InMemoryVectorStore(new() { EmbeddingGenerator = gen });
var faq = store.GetCollection<int, Faq>("faq");
await faq.EnsureCollectionExistsAsync();
await faq.UpsertAsync(rows);                               // 6 registros
await foreach (var r in faq.SearchAsync(text, top: 3))
    Console.WriteLine($"{r.Record.Id} {r.Record.Category} score {r.Score:F4}");
```

Os dois rodaram no macOS arm64 (o `sqlite-vec` traz `vec0.dylib` de osx-arm64)
e mandaram 1 requisição de embedding no upsert. Buscando o texto do registro 4:

```text
[InMemoryVectorStore]          [SqliteVectorStore]
  4 account  score 1.0000        4 account  score 0.0000
  1 account  score 0.3838        1 account  score 0.6162
  3 billing  score 0.1973        3 billing  score 0.8027
```

Mesmo ranking, escala oposta. O InMemory usa similaridade de cosseno por padrão
(maior é melhor). O SQLite criou `vec0(Id INTEGER PRIMARY KEY, Embedding
FLOAT[768] distance_metric=cosine)` e devolve distância de cosseno, 1 menos a
similaridade (menor é melhor): um limite como `r.Score > 0.5` se inverte. Com
`DistanceFunction` explícito (texto idêntico / texto sem relação):

| DistanceFunction | InMemory | SQLite |
| --- | --- | --- |
| CosineSimilarity | 1.0000 / 0.1614 | NotSupportedException |
| CosineDistance | -0.0000 / 0.8386 | 0.0000 / 0.8386 |
| DotProductSimilarity | 1.0000 / 0.1614 | NotSupportedException |
| EuclideanDistance | 0.0000 / 1.2951 | 0.0000 / 1.2951 |
| ManhattanDistance | NotSupportedException | 0.0000 / 28.2211 |

O SQLite diz `Distance function 'CosineSimilarity' for VectorStoreVectorProperty
'Embedding' is not supported by the SQLite connector.` O `IndexKind.Hnsw` não
deu erro nos dois e não mudou nada (o SQLite criou a mesma tabela `vec0`).

Filtro, get e delete funcionam igual nos dois:

```csharp
var hits = faq.SearchAsync("how do I reset my password", top: 3,
    new() { Filter = r => r.Category == "billing" });  // InMemory: 5 (0.3199), 3 (0.2746)
await faq.GetAsync(4);      // Passwords must contain at least twelve characters.
await faq.DeleteAsync(4);   // depois GetAsync(4) devolve null
```

O filtro é uma expressão LINQ que cada provider traduz (o SQLite criou
`faq_Category_index` para a propriedade `IsIndexed` e devolveu os mesmos dois
registros). Sem filtro, o primeiro foi o registro 1 (0.7754): o filtro mantém
resultados fracos, então um limite de score continua necessário.

### Limites: dimensões, força bruta, troca de modelo

Um record com `[VectorStoreVector(512)]` enquanto o modelo devolve 768:

```text
InMemory: upsert succeeded, search ok, score 1
SQLite:   VectorStoreException: Call to vector store failed.
  inner SqliteException: SQLite Error 1: 'Dimension mismatch for inserted vector
  for the "Embedding" column. Expected 512 dimensions but received 768.'
```

O InMemory nem conferiu o tamanho. A documentação avisa: "Avoid using the
InMemory provider for testing, as there can be important differences between
this provider and your production database", e sugere Testcontainers.

Os dois escalaram como varredura completa: com vetores unitários aleatórios
(máquina compartilhada, só ordem de grandeza) o InMemory levou cerca de 5 ms
por busca com 20.000 registros e 23 ms com 100.000, o SQLite cerca de 22 ms e
96 ms. Providers de servidor (PgVector, Azure AI Search, Qdrant, Cosmos DB) não
foram executados. Vetores de dois modelos não são comparáveis nem com o mesmo
tamanho, então um modelo novo exige refazer todos os embeddings (raciocínio,
não medição: o `qwen3:4b-instruct` respondeu ao `/api/embed` com HTTP 501).

## Trade-offs

- **A semântica do score pertence ao provider.** Compare scores só no mesmo
  provider e função de distância, e fixe `DistanceFunction` no vetor para que
  a troca de provider falhe alto em vez de inverter os limites.
- **InMemory é protótipo, não dublê de teste.** Ele pulou a checagem de
  dimensão que o SQLite aplicou e rejeita `ManhattanDistance`.
- **SqliteVec é um preview com arestas.** No 1.0.3-preview um record só com
  chave e vetor falhou no upsert (`near ")": syntax error`), e as chaves
  `[0, 1]` num mesmo batch falharam (`UNIQUE constraint failed on vec_raw
  primary key`) enquanto `[1, 2]` funcionou.
- **Cache de embeddings, um por modelo.** Trocar de modelo não serve vetor velho.
- **Truncamento silencioso esconde conteúdo.** Divida documentos longos antes
  do embedding (a lição de RAG) ou mande `truncate: false` para falhar.

## Documentation Links

- [Use the IEmbeddingGenerator interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/iembeddinggenerator) (doc)
- [How embeddings extend your AI model's reach, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/conceptual/embeddings) (doc)
- [Vector databases for .NET AI apps, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/vector-stores/overview) (doc)
- [Vector search using vector store providers, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/vector-stores/vector-search) (doc)
- [Retrieval-augmented generation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/conceptual/rag) (doc)
- [EmbeddingGemma model card, Google AI for Developers](https://ai.google.dev/gemma/docs/embeddinggemma/model_card) (doc)
