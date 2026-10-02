---
version: 1.0
updatedAt: 2026-08-20
title: "MongoDB Search e Vector Search: $search, $vectorSearch e Recuperação para RAG"
summary: MongoDB Search e MongoDB Vector Search (antes Atlas Search / Atlas Vector Search) são busca full-text e busca semântica ANN/HNSW apoiadas em Lucene, servidas por um processo mongot separado e sincronizado via change streams. São eventualmente consistentes, limitadas pela memória ocupada pelo índice vetorial e, desde o MongoDB 8.2, disponíveis em implantações autogerenciadas e não só no Atlas, embora com um conjunto de recursos materialmente mais restrito que a plataforma gerenciada.
---
## Objective

Entender os dois motores de busca que o MongoDB acoplou ao pipeline de agregação (busca full-text via `$search` e busca vetorial semântica via `$vectorSearch`), como os dois são servidos por um *processo separado* (`mongot`, construído sobre o Apache Lucene) em vez de pelo `mongod` e seus índices B-tree, o que uma definição de índice de busca realmente declara (analyzers e mapeamentos para texto; `numDimensions`, `similarity` e `quantization` para vetores), como o caminho de consulta ANN/HNSW difere de um `IXSCAN` exato, e onde isso se encaixa em um pipeline de retrieval-augmented generation. É uma capacidade posterior a 2019: a 3ª edição de *MongoDB: The Definitive Guide* (a fonte dos outros conceitos de MongoDB deste lote) não a cobre, porque na publicação esses estágios não existiam no produto.

> **Nomenclatura, segundo a documentação atual.** O MongoDB renomeou os dois recursos: a documentação agora diz **MongoDB Search** e **MongoDB Vector Search** em vez de *Atlas Search* e *Atlas Vector Search*, justamente porque eles deixaram de ser exclusivos do Atlas (veja os Trade-offs). Os nomes dos estágios (`$search`, `$searchMeta`, `$vectorSearch`) não mudaram, e as URLs antigas em `/docs/atlas/atlas-search/` e `/docs/atlas/atlas-vector-search/` ainda levam às páginas renomeadas.

## Use Cases

- Substituir um cluster Elasticsearch acoplado cuja única função era servir a caixa de busca de um catálogo de produtos. A proposta do MongoDB é exatamente esta: "busca full-text embutida que oferece uma experiência integrada e escalável para construir recursos de aplicação baseados em relevância e elimina a necessidade de rodar um sistema de busca separado ao lado do banco." Um sistema a menos para sincronizar, um sistema a menos para proteger.
- Construir um campo de busca tolerante a erros de digitação e com autocompletar: fuzzy matching, casamento de frases, `autocomplete`, faceting e highlighting são operadores e opções do `$search`, não coisas que você monta à mão com `$regex` torcendo para dar certo.
- Recuperação semântica onde o casamento por palavra-chave estruturalmente não funciona: uma busca de tickets de suporte que deveria trazer "cartão recusado no checkout" para a consulta "o pagamento continua falhando", mesmo sem as duas compartilharem termos. A busca vetorial "retorna resultados com base no significado semântico, ou subjacente, dos seus dados… encontra vetores próximos da sua consulta em um espaço multidimensional."
- A metade de recuperação de um chatbot RAG sobre os seus próprios documentos: gerar embeddings dos trechos e armazená-los na escrita, gerar o embedding da pergunta do usuário na leitura, rodar `$vectorSearch` para os trechos mais próximos e então entregar esses trechos a um LLM como contexto.
- Trabalho de recomendação e deduplicação que na verdade é busca de vizinhos mais próximos: "encontre produtos semanticamente parecidos com este", ou "este documento novo é quase uma duplicata de algo que já temos", em que o vetor *é* a função de similaridade.
- Relevância híbrida: uma única consulta que roda tanto um `$search` léxico quanto um `$vectorSearch` semântico sobre a mesma coleção e funde as duas listas ranqueadas com `$rankFusion` (reciprocal rank fusion) ou `$scoreFusion` (relative score fusion), porque a recuperação puramente semântica perde em silêncio casamentos exatos de tokens como SKUs e códigos de erro.
- Busca semântica filtrada que continua correta: `$vectorSearch` aceita um documento `filter` avaliado *antes* da comparação vetorial, então "os dez documentos semanticamente mais parecidos **deste tenant, de 2024 em diante**" é um único estágio, e não uma busca vetorial seguida de um `$match` que joga fora a maior parte do seu `limit`.

### `$vectorSearch` na prática

```js
db.embedded_movies.aggregate([
  {
    $vectorSearch: {
      index: "vector_index",
      path: "plot_embedding",
      queryVector: [0.0123, -0.0456, /* … 2048 floats … */],
      numCandidates: 150,
      limit: 10,
      filter: { $and: [{ genres: "Action" }, { year: { $gte: 2000 } }] }
    }
  },
  {
    $project: {
      _id: 0,
      title: 1,
      score: { $meta: "vectorSearchScore" }
    }
  }
]);
```

## Deep Dive

### Um segundo processo, um segundo tipo de índice

O fato estrutural mais importante, e o que explica quase todos os trade-offs abaixo, é que nenhum desses recursos vive dentro do `mongod`. Eles são servidos pelo `mongot`:

> "O `mongot` é o processo do MongoDB Search e do MongoDB Vector Search que alimenta os estágios de agregação `$search`, `$searchMeta` e `$vectorSearch`. Construído sobre o Apache Lucene, o `mongot` roda como um processo separado do `mongod`."

Vale ler literalmente as três funções documentadas dele, porque cada uma tem uma consequência:

> - "Sincroniza dados de índice a partir do `mongod` por uma conexão permanente orientada por change streams."
> - "Mantém os índices de busca em armazenamento dedicado."
> - "Atende consultas de busca repassadas pelo `mongod`. Os clientes nunca se conectam diretamente ao `mongot`."

Sincronização orientada por change streams significa que os índices de busca são **eventualmente consistentes** com a coleção: uma escrita fica durável no `mongod` antes que o `mongot` necessariamente a tenha indexado. Armazenamento dedicado significa que um índice de busca não é uma B-tree nos seus arquivos do WiredTiger; é um índice Lucene com disco e orçamento de memória próprios. E "repassadas pelo `mongod`" é o motivo de isso ainda parecer uma agregação comum do ponto de vista do driver: você nunca abre uma segunda conexão nem aprende uma segunda linguagem de consulta.

O caminho da consulta, segundo a documentação de implantação: a consulta chega ao `mongod` (ou `mongos`), o `mongod` a roteia para um `mongot`, "o processo `mongot` faz a busca e o cálculo de score e retorna os IDs dos documentos e outros metadados de busca dos resultados que casaram ao seu processo `mongod` correspondente. O processo `mongod` então faz implicitamente uma busca do documento completo para os resultados que casaram e retorna os resultados ao cliente." Essa busca implícita final é um custo real, e é por isso que os dois estágios suportam `returnStoredSource: true`: servir uma projeção direto do `mongot` e pular por completo a ida ao `mongod`.

Um índice de busca é, portanto, um objeto genuinamente diferente de um índice comum, não uma variante dele. O MongoDB faz a distinção assim:

> "Embora tanto os índices do MongoDB Search quanto os índices do MongoDB tornem a recuperação de dados mais rápida, eles são diferentes. Como o índice no fim de um livro, um índice de busca é um mapeamento entre termos e os documentos que contêm esses termos. Índices de busca também contêm outros metadados relevantes, como as posições dos termos nos documentos."

Eles são gerenciados por helpers próprios (`createSearchIndex`, `updateSearchIndex`, `dropSearchIndex`, `getSearchIndexes` e o estágio de agregação `$listSearchIndexes`), nunca por `createIndex`, e o `getIndexes()` não os mostra.

### `$search`: full-text, e a decisão do analyzer

`$search` "faz uma busca full-text no campo ou nos campos especificados. O campo ou campos precisam estar cobertos por um índice do MongoDB Search." Sua forma é um operador (ou um coletor) mais opções:

```js
db.movies.aggregate([
  {
    $search: {
      index: "default",
      compound: {
        must:   [{ text: { query: "sci-fi thriller", path: "plot" } }],
        should: [{ text: { query: "blade runner", path: "title", score: { boost: { value: 3 } } } }]
      },
      highlight: { path: "plot" },
      scoreDetails: true
    }
  },
  { $limit: 10 },
  { $project: { title: 1, score: { $meta: "searchScore" }, highlights: { $meta: "searchHighlights" } } }
]);
```

Três detalhes desse estágio merecem atenção. `index` é *opcional e tem padrão `"default"`*, e o MongoDB avisa que ele "não retorna resultados se você errar o nome do índice ou se o índice especificado ainda não existir", a causa número um de um `$search` que retorna nada em silêncio. `scoreDetails: true` dá uma decomposição por documento de como o score do Lucene foi montado, o caminho mais rápido para responder "por que este resultado está em terceiro". E os metadados não voltam nos documentos de resultado: `$search` "retorna apenas os resultados da sua consulta. Os resultados de metadados… são guardados na variável de agregação `$$SEARCH_META`", com a restrição de que `$$SEARCH_META` "não pode ser usada depois do estágio `$lookup` ou `$unionWith` em nenhum pipeline."

Indexar texto é onde está o trabalho real de design, porque é uma decisão de tokenização, não uma decisão de lista de campos:

> "Quando você cria um índice de busca, o Atlas Search transforma seus dados em uma sequência de *tokens* ou *termos*. Um *analyzer* facilita esse processo… Os detalhes da tokenização dependem do idioma e podem exigir escolhas adicionais. Qual analyzer usar depende dos seus dados e da sua aplicação."

Os mapeamentos podem ser **dinâmicos** (indexar todo campo indexável dinamicamente, conveniente e caro) ou **estáticos** (você nomeia os campos e seus tipos). Os analyzers embutidos cobrem os idiomas comuns; analyzers customizados existem para todo o resto. Errar o analyzer não é um bug de desempenho, é um bug de *relevância*, e aparece como "buscar 'correndo' não casa com 'correu'" em vez de consultas lentas.

### `$vectorSearch`: embeddings, HNSW e os dois modos de busca

A busca vetorial faz uma pergunta diferente. Em vez de casar termos, ela compara posições em um espaço de alta dimensão:

> "Embeddings vetoriais são vetores que você usa para representar seus dados. Esses embeddings capturam relações significativas nos seus dados e permitem tarefas como busca semântica e recuperação. Você cria embeddings vetoriais passando seus dados por um modelo de embedding."

Note onde o trabalho acontece: *você* passa os dados por um modelo de embedding. O MongoDB armazena e busca os arrays resultantes; produzi-los é uma preocupação separada (veja os Trade-offs). A única exceção é o recurso em preview **Automated Embedding**, em que um campo de índice do tipo `autoEmbed` faz o `mongot` chamar um modelo da Voyage AI por você: o único caminho em que o próprio MongoDB gera os vetores.

Um índice vetorial é declarado com `type: "vectorSearch"` e um array `fields`. A sintaxe literal:

```js
{
  "fields": [
    {
      "type": "vector",
      "path": "<field-to-index>",
      "numDimensions": <number-of-dimensions>,
      "similarity": "euclidean | cosine | dotProduct",
      "quantization": "none | scalar | binary",
      "indexingMethod": "flat | hnsw",
      "hnswOptions": {
        "maxEdges": <number-of-connected-neighbors>,
        "numEdgeCandidates": <number-of-nearest-neighbors>
      }
    },
    { "type": "filter", "path": "<field-to-index>" }
  ],
  "nestedRoot": "<embedded-document-field-name>",
  "storedSource": { "include|exclude": ["<field-name>"] }
}
```

Os detalhes verificados:

| Opção | Valores permitidos | Observações |
|---|---|---|
| `similarity` | `euclidean`, `cosine`, `dotProduct` | Exatamente três, obrigatório para um campo `vector`. `euclidean` é o único que também suporta vetores `binData(int1)`. |
| `numDimensions` | `1` a `8192` | Limite rígido: os embeddings precisam ter "comprimento menor ou igual a 8192 dimensões." A quantização binária exige um múltiplo de 8. |
| `quantization` | `none` (padrão), `scalar`, `binary` | `scalar` reduz a RAM do índice em cerca de 3,75×; `binary` em cerca de 24×. |
| `indexingMethod` | `hnsw` (padrão), `flat` | |
| `hnswOptions.maxEdges` | `16`-`64` (padrão `16`) | Arestas por nó do grafo HNSW. |
| `hnswOptions.numEdgeCandidates` | `100`-`3200` (padrão `100`) | Nós avaliados ao procurar vizinhos. |
| tipo BSON do vetor | array de `double`, ou `BinData` com subtipo vetorial `float32`, `int8` ou `int1` | `binData` reduz em 66% o armazenamento em disco dos vetores no `mongod`. |
| campos `type: "filter"` | qualquer caminho escalar indexado | Só esses caminhos podem ser usados no `filter` do `$vectorSearch`. |

A consulta é um estágio que precisa vir primeiro no pipeline. `index`, `path`, `queryVector` e `limit` são obrigatórios; depois você escolhe um modo:

- **ANN**: o padrão. O MongoDB "suporta busca aproximada de vizinhos mais próximos (ANN) com o algoritmo Hierarchical Navigable Small Worlds." Exige `numCandidates`, limitado a **10.000**, que é o tamanho da fila de prioridade que o HNSW percorre. A orientação é direta: "Recomendamos especificar um `numCandidates` pelo menos 20 vezes maior que o número de documentos a retornar (`limit`) para aumentar a precisão e reduzir as discrepâncias entre os resultados das suas consultas ENN e ANN." O recall esperado com um `numCandidates` bem escolhido fica em torno de 90-95% de sobreposição com os resultados exatos.
- **ENN**: `exact: true`, e então `numCandidates` é proibido. Ele "busca exaustivamente todos os embeddings indexados", o que a documentação recomenda apenas para benchmark de precisão, coleções com menos de cerca de 10.000 documentos, ou um pré-filtro seletivo o suficiente para deixar menos de ~5% dos dados.

Esse padrão ANN é a ruptura conceitual com tudo no conceito de índices: um `IXSCAN` é *exato*, e um plano encontra as chaves que casam ou não encontra. Uma travessia HNSW é *aproximada por construção*: pode perder um vizinho mais próximo verdadeiro, e `numCandidates` é o botão que troca latência por recall. "Correto" aqui é um parâmetro de ajuste, não uma garantia.

Os resultados trazem um score de similaridade entre 0 e 1 (0 = baixo, 1 = alto), calculado segundo a função `similarity` do índice e lido via `{ $meta: "vectorSearchScore" }`. O pré-filtro acontece dentro do estágio; pós-filtrar com um `$match` no score depois é permitido, mas joga fora trabalho que você já pagou. `filter` suporta apenas um conjunto fixo de operadores (`$eq`, `$ne`, `$gt`, `$lt`, `$gte`, `$lte`, `$in`, `$nin`, `$exists`, `$not`, `$nor`, `$and`, `$or`), e a documentação avisa que um pré-filtro estreito demais "pode ser restritivo demais", excluindo resultados semanticamente relevantes antes que eles possam competir.

Os dois estágios carregam as mesmas restrições de pipeline: só podem ser o primeiro estágio e não podem ser usados em uma definição de view nem em um sub-pipeline de `$facet` (`$vectorSearch` também não pode aparecer em um sub-pipeline de `$lookup`, embora `$lookup` possa consumir seus resultados).

### O padrão RAG, como o MongoDB o documenta

O próprio tutorial de RAG do MongoDB nomeia três etapas, e a divisão entre elas é o padrão que vale memorizar.

**1. Ingestão.** "Carregue, processe e divida seus dados em trechos para prepará-los para a sua aplicação RAG. Dividir em trechos (chunking) significa separar seus dados em partes menores para uma recuperação ideal." Depois, "converta seus dados em embeddings vetoriais usando um modelo de embedding" e armazene cada embedding "como um campo ao lado dos outros dados da sua coleção." Os embeddings ficam ao lado do documento que descrevem, e essa adjacência é todo o argumento para usar um banco operacional como repositório de vetores.

```python
docs_to_insert = [
    {"text": doc.page_content, "embedding": get_embedding(doc.page_content)}
    for doc in documents
]
collection.insert_many(docs_to_insert)
```

**2. Recuperação.** "Para recuperar documentos relevantes com o MongoDB Vector Search, você converte a pergunta do usuário em embeddings vetoriais e roda uma consulta de busca vetorial contra os dados da sua coleção MongoDB para encontrar os documentos com os embeddings mais parecidos." O invariante crítico: a consulta precisa ter o embedding gerado pelo *mesmo modelo, com a mesma dimensionalidade* dos documentos armazenados. Troque de modelo de embedding e todo vetor da coleção perde o sentido em relação às suas consultas: é um re-embedding completo e uma reindexação, não uma migração.

**3. Geração.** "Depois de fazer uma busca vetorial para recuperar os documentos relevantes, você fornece a pergunta do usuário junto com os documentos relevantes como contexto para o LLM, para que ele gere uma resposta mais precisa." O papel do MongoDB termina na etapa 2; a etapa 3 é a sua chamada ao LLM.

Para recuperação híbrida, `$rankFusion` (MongoDB 8.0+) combina listas ranqueadas por reciprocal rank fusion (`reciprocal_rank = 1 / (r + rank_constant)`, com `rank_constant` fixo em `60`), enquanto `$scoreFusion` (8.3+) funde os scores reais após normalização (`none`, `sigmoid` ou `minMaxScaler`). Os sub-pipelines só podem conter `$search`, `$vectorSearch`, `$match`, `$sort` ou `$geoNear`; eles rodam em série, não em paralelo; precisam mirar uma única coleção; e nenhum dos dois estágios suporta paginação ou `$project`. `$rerank`, que reordena os resultados por relevância com um cross-encoder, é **exclusivo do Atlas**.

### Memória é a restrição de dimensionamento

Uma linha governa o planejamento de capacidade: "O MongoDB Vector Search mantém o índice inteiro em memória." Não "prefere manter": mantém. A pegada por vetor documentada torna a conta concreta: um vetor de 1536 dimensões do OpenAI `text-embedding-ada-002` custa 6 kB em precisão total; um vetor de 2048 dimensões do Voyage `voyage_3_large` custa 8 kB como `float`, 2,14 kB como `int8`, 0,334 kB como `int1`. "O espaço necessário escala linearmente com o número de vetores que você indexa e com a dimensionalidade dos vetores." Dez milhões de vetores de 1536 dimensões são, portanto, da ordem de 60 GB de RAM antes dos metadados, e é por isso que a quantização não é uma micro-otimização, mas a diferença entre um tier de busca e quatro.

A quantização coloca os vetores comprimidos na RAM e mantém cópias de fidelidade total no disco para o rescoring e para o ENN, então ela muda a *proporção* que você precisa provisionar: o MongoDB recomenda "aproximadamente uma proporção de 4:1 entre armazenamento e RAM para quantização escalar, ou de 24:1 para quantização binária", além de disco livre igual a 125% do tamanho estimado do índice. No Atlas, a recomendação para nós de busca dedicados é RAM "pelo menos 10% maior que o tamanho total dos seus índices do MongoDB Vector Search."

## Trade-offs

- **Isto não é mais exclusivo do Atlas, mas "autogerenciado" significa que agora você opera um segundo daemon.** A resposta honesta de 2026, conferida na documentação atual, é que `$search`, `$searchMeta` e `$vectorSearch` estão "disponíveis no… MongoDB Atlas; em implantações do MongoDB Enterprise na versão 8.2 ou posterior com o Kubernetes Operator; em implantações do MongoDB Community na versão 8.2 ou posterior." O Community recebe um tarball Linux ou uma imagem de contêiner para o `mongot`; o Enterprise o recebe via Kubernetes Operator, e "o MongoDB Enterprise não suporta implantações do `mongot` como tarball ou contêiner independentes." Então a antiga objeção de lock-in de fornecedor de fato enfraqueceu, mas leia no que você está entrando. O `mongot` é só Linux `x86_64`/`aarch64` (sem binários nativos para Windows ou macOS, sem ppc64le, sem s390x); não há pacote `apt`/`yum` e o tarball não traz unit do `systemd`; upgrades, mudanças de configuração e a rotação de credenciais X.509 e SCRAM "exigem um restart do `mongot`"; o `mongot` "não oferece criptografia em repouso nativa em nível de aplicação", deixando para você criptografar o sistema de arquivos; TLS validado por FIPS não é suportado; você configura à mão o TLS e a autenticação entre `mongod` e `mongot`; um replica set com vários `mongot` precisa de um load balancer **L7**, porque "um balanceador L4 não consegue distribuir o tráfego no nível do stream gRPC"; e topologias shardeadas só são suportadas via Kubernetes Operator no Enterprise: "o MongoDB Controllers for Kubernetes Operator não suporta arquiteturas shardeadas com o Community Edition." O Atlas continua sendo o caminho de menor atrito; hospedar por conta própria agora é *possível*, não *equivalente*.
- **Os conjuntos de recursos são próximos, mas não idênticos.** A própria comparação do MongoDB diz que o comportamento das consultas, o "scoring e ranking baseados em Lucene", os analyzers, os sinônimos e as opções de quantização são "iguais no Atlas e no autogerenciado." As lacunas: `$rerank` está "disponível apenas no Atlas"; a opção de índice `nestedRoot` "não é suportada no `mongot` autogerenciado"; a saída de `$listSearchIndexes` tem formato diferente; a UI de Search Metrics, os alertas gerenciados, os dashboards e a retenção de FTDC/logs não existem no autogerenciado (você conecta o Prometheus ao endpoint `/metrics` do `mongot`); e o Automated Embedding está em Preview nas duas plataformas. Note também que a versão mínima corta *para os dois lados*: o `mongot` 1.70.1 suporta o MongoDB Server 8.2 e 8.3, mas explicitamente **não** o 8.0, então adotar a busca autogerenciada pode forçar um upgrade do servidor, e não o contrário.
- **O MongoDB não resolve a geração de embeddings por você.** Com exceção do caminho `autoEmbed` em preview (apenas modelos da Voyage AI, apenas a modalidade de texto, com limite de truncamento automático de 32.000 tokens e `path`/`model`/`numDimensions` imutáveis após a criação), você fornece o modelo de embedding e paga por cada chamada, na ingestão *e* em toda consulta. É um segundo fornecedor, um segundo orçamento de latência, um segundo limite de taxa e um segundo modo de falha no seu caminho de leitura. Também é um risco de versionamento: trocar de modelo invalida todo vetor armazenado, porque uma consulta com embedding do modelo B não pode ser comparada com documentos com embedding do modelo A. Reserve um re-embedding completo mais a reconstrução do índice como o custo de algum dia mudar de ideia; a documentação torna isso irreversível por design para campos `autoEmbed`, em que `model` e `numDimensions` não podem ser editados.
- **Reconstruções de índice são um evento de escala, não um detalhe em segundo plano.** Como o `mongot` mantém o índice vetorial inteiro em memória em armazenamento dedicado, mudanças de capacidade são caras: "Escalar o cluster adicionando nós de busca ou mudando o tier de busca dispara uma reconstrução completa do índice do MongoDB Search." O Atlas suaviza isso na AWS e no Azure restaurando "uma cópia recente do seu índice no S3 ou no Azure Blob Storage em vez de reconstruí-lo", mantendo os arquivos de índice por até 14 dias, mas essa otimização não está disponível no Google Cloud nem quando a criptografia em repouso gerenciada pelo cliente está ativa nos nós de busca. Migrar para nós de busca dedicados tem a mesma forma: o Atlas "não atende consultas nos nós até construir com sucesso todos os índices." No autogerenciado não existe atalho nenhum, e um downgrade de versão principal do `mongot` "exige uma ressincronização entre `mongod` e `mongot`." Os índices de busca também não estão nos seus backups em nenhum sentido útil: nas duas plataformas, "os índices de busca no `mongot` podem ser reconstruídos a partir de dados restaurados de snapshots do banco MongoDB": reconstruídos, não restaurados.
- **Rodar a busca nos nós do banco é explicitamente uma escolha que não é de produção.** Por padrão o Atlas inicia o `mongot` "no mesmo nó que roda o processo `mongod` quando você cria seu primeiro índice do MongoDB Vector Search", e compartilha a RAM: em `M10`/`M20`/`M30`, apenas 75% sobra para tudo que não é o banco, dando a um `M10` cerca de 1 GB para o índice vetorial. O próprio veredito do MongoDB sobre essa topologia: "Você pode ter disputa de recursos entre o processo de banco `mongod` e o processo de busca `mongot`… Recomendamos este modelo de implantação apenas para ambientes de teste e prototipação." Produção significa `M10` ou superior mais nós de busca dedicados `S30` ou superiores (uma segunda linha na fatura), e na AWS e no Azure esses nós só existem em parte das regiões, o que pode restringir onde você implanta o próprio cluster.
- **Contra um banco vetorial dedicado, "já estamos no MongoDB" é o argumento inteiro, e muitas vezes basta.** A vantagem real não é a qualidade do ANN; é que o embedding vive no mesmo documento que os dados, então `filter` por tenant/data/status, a busca do documento completo, transações e seu driver e controle de acesso existentes vêm de graça, sem pipeline de escrita dupla para manter dois sistemas consistentes. Pinecone, Weaviate, Qdrant e afins geralmente vão dar mais botões, mais algoritmos de índice e um ajuste mais agressivo de recall/latência; o pgvector dá o mesmo argumento de colocalização se o seu sistema de registro for o Postgres. A superfície exposta pelo MongoDB aqui é deliberadamente estreita: três métricas de similaridade, HNSW ou flat, dois parâmetros de HNSW, três modos de quantização, 8192 dimensões no máximo, `numCandidates` limitado a 10.000. Para a maioria das cargas de aplicação isso é suficiente e a economia operacional domina; para uma carga em que a qualidade da recuperação é crítica, em escala muito grande, faça benchmark antes de presumir paridade. Escolher o MongoDB aqui deveria ser uma decisão de colocalização, não uma decisão de "melhor motor ANN".
- **Consistência eventual e resultados aproximados são duas mudanças semânticas reais.** O `mongot` indexa via change streams, então um documento que você acabou de escrever pode ainda não aparecer em um resultado de `$search` ou `$vectorSearch`: ler as próprias escritas não vale para a busca como vale para o `find()`. E o ANN é aproximado: a mesma consulta pode retornar um conjunto um pouco diferente à medida que o grafo HNSW evolui, com cerca de 90-95% de recall em relação aos resultados exatos nas configurações recomendadas. Nenhum dos dois é um defeito, mas os dois quebram premissas trazidas das consultas indexadas comuns, e nenhum dos dois pertence a um caminho de código que precisa de uma resposta exata e completa; para isso, use um índice comum e `find()`, ou aceite o custo do ENN.
- **Os limites de quantidade de índices e de tier mordem cedo em implantações pequenas.** Clusters gratuitos permitem "no máximo 3 índices (de busca ou vetoriais, somados)", clusters Flex 10, com um teto rígido de 2.500 por cluster. Somado às restrições de que você "não pode misturar os tipos `vector` e `autoEmbed` na mesma definição de índice", não pode indexar o mesmo campo de embedding duas vezes e não pode indexar embeddings aninhados dentro de arrays de documentos, um design com vários modelos, ou com vários tenants por índice, pode ficar sem vagas de índice em um tier gratuito ou Flex muito antes de ficar sem dados.

## Documentation Links

- [MongoDB Documentation: MongoDB Search (formerly Atlas Search) Overview](https://www.mongodb.com/docs/search/): doc
- [MongoDB Documentation: MongoDB Vector Search Overview](https://www.mongodb.com/docs/vector-search/): doc
- [MongoDB Documentation: $vectorSearch Aggregation Stage](https://www.mongodb.com/docs/vector-search/query/aggregation-stages/vector-search-stage/): doc
- [MongoDB Documentation: $search Aggregation Stage](https://www.mongodb.com/docs/search/query/aggregation-stages/search/): doc
- [MongoDB Documentation: How to Index Fields for Vector Search](https://www.mongodb.com/docs/vector-search/index/vector-search-type/): doc
- [MongoDB Documentation: Retrieval-Augmented Generation (RAG) with MongoDB](https://www.mongodb.com/docs/vector-search/tutorials/rag/): doc
- [MongoDB Documentation: How to Perform Hybrid Search](https://www.mongodb.com/docs/vector-search/hybrid-search/hybrid-search-overview/): doc
- [MongoDB Documentation: Review Deployment Options for Vector Search](https://www.mongodb.com/docs/vector-search/deployment/deployment-options/): doc
- [MongoDB Documentation: MongoDB Search and Vector Search on Self-Managed Deployments](https://www.mongodb.com/docs/search/self-managed/current/): doc
- [MongoDB Documentation: Known Limitations for Self-Managed mongot](https://www.mongodb.com/docs/search/self-managed/current/limitations/): doc
- [MongoDB Documentation: Compatibility and Requirements for mongot](https://www.mongodb.com/docs/search/self-managed/current/deployment/compatibility-requirements/): doc
- [MongoDB Documentation: Vector Quantization](https://www.mongodb.com/docs/vector-search/about/vector-quantization/): doc
