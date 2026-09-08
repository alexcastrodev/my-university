---
version: 1.0
updatedAt: 2026-08-20
title: "Storage Attached Indexes: Consertando o Problema de Índice Secundário e Materialized View do Cassandra"
summary: Explica o Storage-Attached Indexing (SAI), o índice secundário integrado ao motor de armazenamento do Cassandra 5.0, o que ele conserta em relação ao índice secundário nativo mais antigo (2i) e às materialized views (precipícios de cardinalidade, falhas de tombstone, custo de armazenamento por coluna, risco de consistência da desnormalização), como o anexo de índice por SSTable funciona mecanicamente, a sintaxe CQL, e seus ângulos mais novos de análise de texto e busca vetorial (ANN), além de onde seus próprios limites ainda te empurram de volta para o design de tabela orientado a query.
---
## Objective

Entender o que o Storage-Attached Indexing (SAI) de fato mudou quando foi lançado como um recurso de destaque do Apache Cassandra 5.0: um índice secundário que é construído dentro do próprio motor de armazenamento, indexando memtables e SSTables diretamente, em vez de escrever em uma tabela sombra escondida. Aprender o que especificamente ele conserta em relação às duas formas mais antigas de consultar uma coluna que não é chave de partição (o índice secundário nativo legado, 2i, e a materialized view), e onde seus próprios limites ainda te empurram de volta para o design de tabela orientado a query.

## Use Cases

- Filtrar por uma coluna que não faz parte da partition key (`country`, `status`, um intervalo de `age`) sem construir e manter manualmente uma segunda tabela moldada por query para isso.
- Substituir um `CREATE INDEX` legado (2i) que ficou lento ou está lançando falhas de limite de tombstone, em uma coluna cuja cardinalidade não se encaixa no estreito ponto ideal do 2i.
- Indexar várias colunas na mesma tabela de forma barata: o SAI compartilha estruturas de índice em disco por SSTable, então uma segunda e terceira coluna indexada custam muito menos do que a primeira, ao contrário do 2i, onde toda coluna indexada é sua própria tabela escondida.
- Servir busca de texto com insensibilidade a maiúsculas/minúsculas, normalização Unicode, ou tokenização básica via um analisador embutido ou customizado, sem erguer um sistema de busca separado para isso.
- Adicionar busca vetorial de vizinho mais próximo aproximado (ANN), `ORDER BY ... ANN OF [...]`, para embeddings armazenados em uma coluna nativa `VECTOR`, para cargas de trabalho de RAG e busca por similaridade.
- Aparar a cauda longa de variantes de query de baixo tráfego em um modelo de dados existente, enquanto as queries de alto tráfego ainda ganham sua própria tabela feita sob medida: o SAI estreita a margem, não substitui a modelagem orientada a query.

## Deep Dive

### O jeito antigo, e o que de fato havia de errado com ele

O modelo de dados do Cassandra é centrado em partição: `SELECT ... WHERE` é eficiente exatamente quando restringe a partition key, porque esse é o único predicado que o coordenador pode usar para rotear a query para o punhado de nós que possuem o dado. Filtrar por qualquer outra coisa sempre precisou de ajuda, e o Cassandra oferecia dois tipos antes do SAI, cada um com custos reais e documentados.

**Índices secundários legados (2i)** são o `CREATE INDEX` nativo original do Cassandra. A documentação oficial é direta sobre seu ponto ideal e suas bordas: "índices nativos são melhores em uma tabela com muitas linhas que contêm o valor indexado." Ultrapasse esse ponto ideal em qualquer direção e ele quebra. Em uma coluna de alta cardinalidade (mais próxima de única por linha), "uma query entre os campos incorre em muitos seeks para pouquíssimos resultados", porque o índice ainda precisa fazer fan-out e checar réplicas por todo o cluster para um punhado de correspondências. Em uma coluna de baixa cardinalidade, é a falha oposta: "criar um índice em uma coluna de cardinalidade extremamente baixa, como uma coluna booleana, não faz sentido", já que um valor de índice agora mapeia para uma fração enorme da tabela, produzindo partições de índice de tamanho excessivo e quentes. Também existe uma armadilha operacional rígida: "o banco de dados armazena tombstones no índice até que o limite de tombstone atinja 100 mil células", depois do que "a query que usa o valor indexado vai falhar" completamente, que é exatamente o que acontece com um índice 2i em uma coluna que é frequentemente atualizada ou deletada. Cada índice 2i também é, mecanicamente, sua própria tabela escondida que duplica dado e trabalho de consistência por coluna indexada, então uma tabela com três índices legados paga esse custo de armazenamento e escrita três vezes.

**Materialized views** são a outra resposta pré-SAI: uma cópia desnormalizada da tabela base, gerenciada pelo servidor, com chave diferente, para que uma query que não conseguisse atingir a partition key da tabela base consiga atingir a da view em vez disso. Elas resolvem o problema de forma de query, mas ao custo de uma segunda tabela que o Cassandra mantém sincronizada para você, e "para você" acabou sendo a pegadinha. Materialized views permanecem marcadas como experimentais anos depois de sua introdução na 3.0 e são desabilitadas por padrão a partir do Cassandra 4.0 (`materialized_views_enabled: false` no `cassandra.yaml`), porque manter uma cópia desnormalizada consistente com escritas, deleções, e repairs da tabela base é genuinamente difícil de acertar no nível do motor. O fallback prático que a maioria dos times usa em vez disso (tabelas desnormalizadas construídas à mão, escritas manualmente a cada escrita na tabela base) resolve o mesmo problema sem o rótulo experimental, mas torna a consistência entre tabelas inteiramente trabalho da sua própria aplicação: sem chaves estrangeiras, sem deleção em cascata, nada que detecte uma escrita que atualizou uma tabela e perdeu outra.

Ambos os caminhos compartilham a mesma causa raiz: uma cláusula `WHERE` em uma coluna que não é chave de partição não tinha uma resposta eficiente e nativa do motor. Você ou pagava os custos de cardinalidade e tombstone do 2i, ou pagava o custo operacional de manter uma segunda tabela sincronizada você mesmo.

### O que o SAI é, mecanicamente

O Storage-Attached Indexing foi lançado como um **recurso GA do Apache Cassandra 5.0** (atualmente na versão de patch 5.0.8). O nome é o design: o índice é *anexado ao armazenamento*, em vez de viver em uma tabela escondida separada. Segundo a documentação oficial, "o SAI está profundamente integrado ao motor de armazenamento e indexa as memtables em memória e as SSTables em disco conforme são escritas." Concretamente: conforme o dado aterrissa em uma memtable, valores de coluna indexada vão para um índice em memória junto com ele; quando essa memtable descarrega para uma SSTable, o SAI escreve componentes de índice (para colunas de string, postings em disco referenciadas através de um trie ordenado por bytes; para colunas numéricas, uma árvore k-d balanceada) que vivem ao lado, e são compactados junto com, o próprio dado da SSTable. Não há segunda tabela, nenhum caminho de escrita separado, nenhuma agenda de compaction separada para sair de sincronia.

Esse anexo por SSTable é o que conserta o problema de custo-por-coluna do 2i. A documentação descreve isso diretamente: "o uso de disco do SAI cresce apenas marginalmente conforme mais colunas são indexadas em uma tabela/SSTable", porque ele "compartilha elementos de índice comuns a uma SSTable." Três índices SAI em uma tabela não são três tabelas escondidas: eles compartilham a contabilidade subjacente no nível da SSTable.

A sintaxe é um `CREATE INDEX` normal:

```sql
CREATE TABLE cycling.cyclist_semi_pro (
  id int,
  firstname text,
  lastname text,
  age int,
  country text,
  registration date,
  PRIMARY KEY (id)
);

CREATE INDEX lastname_sai_idx ON cycling.cyclist_semi_pro (lastname)
  USING 'sai'
  WITH OPTIONS = {'case_sensitive': 'false', 'normalize': 'true', 'ascii': 'true'};

CREATE INDEX age_sai_idx ON cycling.cyclist_semi_pro (age) USING 'sai';
```

(`USING 'sai'` e `USING 'StorageAttachedIndex'` são a mesma implementação: o nome curto e o nome de classe de índice customizado totalmente qualificado.) Com esses índices em vigor, queries que antes precisavam de `ALLOW FILTERING` ou de uma tabela extra inteira rodam diretamente:

```sql
SELECT * FROM cycling.cyclist_semi_pro WHERE lastname = 'Eppinger';
SELECT * FROM cycling.cyclist_semi_pro WHERE age <= 23;
SELECT * FROM cycling.cyclist_semi_pro
  WHERE registration > '2010-01-01' AND registration < '2015-12-31' LIMIT 10;
```

No momento da leitura, segundo a documentação de conceitos do SAI, o coordenador escolhe "o índice mais seletivo" para restringir a busca primeiro, depois, ao contrário do 2i, que usa "no máximo um índice de coluna... por query", o SAI pode combinar múltiplos índices em uma única query através do que a documentação chama de Query Plan, iterando e mesclando streams de mais de um índice antes de recorrer a pós-filtragem. Ainda existem bordas reais: o SAI "vai processar até dois índices SAI" combinados por `AND` antes de começar a pós-filtrar o resto, só funciona com `Murmur3Partitioner`, tem um teto (por padrão) de 10 índices por tabela (`sai_indexes_per_table_failure_threshold`), não pode ser definido em uma partition key de coluna única, e, mesma física do 2i, uma query em uma coluna genuinamente de alta cardinalidade com um `LIMIT` maior do que o número de linhas correspondentes ainda pode forçar uma varredura entre réplicas. O SAI torna a filtragem fora da partition key eficiente; não revoga o fato de que só a partition key roteia uma query para um pequeno conjunto de nós.

### Análise de texto e busca vetorial: os dois ângulos mais novos do SAI

Duas capacidades se constroem diretamente sobre o mesmo motor de índice por SSTable e valem a pena nomear porque são especificamente coisas que o 2i e as materialized views nunca ofereceram de forma alguma, não apenas fizeram pior.

**Análise de texto.** Índices de texto do SAI podem ir além de igualdade de correspondência exata usando a API Lucene Java Analyzer: definir uma opção `index_analyzer` (um nome embutido, ou uma especificação JSON combinando um tokenizer com filtros e filtros de caractere opcionais) permite que um índice de texto tokenize, normalize maiúsculas/minúsculas, e normalize valores tanto para indexação quanto para correspondência em tempo de query. É explicitamente restrito, porém: o SAI "fornece análise de texto básica, não busca de texto completo"; para o conjunto de recursos de um motor de busca genuíno, a documentação te aponta para outro lugar.

**Busca vetorial.** O Cassandra 5.0 também introduziu um tipo de coluna nativo `VECTOR<type, dimension>`, e o SAI é o que o indexa para queries de vizinho mais próximo aproximado (ANN):

```sql
CREATE TABLE cycling.comments_vs (
  id uuid,
  comment text,
  comment_vector VECTOR<FLOAT, 5>,
  PRIMARY KEY (id)
);

CREATE INDEX ann_index ON cycling.comments_vs (comment_vector)
  USING 'sai'
  WITH OPTIONS = { 'similarity_function': 'DOT_PRODUCT' };

SELECT * FROM cycling.comments_vs
  ORDER BY comment_vector ANN OF [0.15, 0.1, 0.1, 0.35, 0.55]
  LIMIT 3;
```

`similarity_function` aceita `DOT_PRODUCT`, `COSINE`, ou `EUCLIDEAN`. Esse é o recurso que colocou o Cassandra 5.0 na mesma conversa que bancos de dados vetoriais dedicados, para cargas de trabalho de RAG apoiadas em embeddings, e existe especificamente porque a arquitetura de índice no nível do motor de armazenamento do SAI tinha onde anexar uma estrutura no estilo árvore k-d, algo que nem o modelo de tabela escondida do 2i, nem o modelo de desnormalização de uma materialized view, poderiam ter suportado.

## Trade-offs

- **O SAI é um índice secundário estritamente melhor, não uma revogação da modelagem centrada em partição.** Ele conserta os precipícios de cardinalidade e o custo de armazenamento por coluna do 2i, e conserta a fragilidade operacional das materialized views não precisando de uma segunda tabela de forma alguma, mas uma query que não restringe a partition key ainda precisa alcançar mais do cluster do que uma query que restringe. Se um padrão de query é genuinamente quente, uma tabela moldada pela query com a partition key certa ainda é a resposta certa; o SAI é para aparar a cauda longa de padrões de acesso secundários, não para pular o design de modelo de dados.
- **Combinar mais de dois predicados indexados por SAI degrada graciosamente, não de graça.** `AND` entre dois índices SAI permanece conduzido por índice; um terceiro predicado em diante recorre à pós-filtragem: ainda correto, mas não mais obtendo o benefício completo de todo índice envolvido. Uma query com quatro cláusulas `WHERE` em quatro índices SAI não é quatro vezes mais seletiva do que parece.
- **Os extremos de cardinalidade que prejudicam o 2i ainda podem prejudicar a *latência* do SAI, ainda que ele não falhe mais completamente.** Um `LIMIT` maior do que o número de linhas correspondentes em um predicado de baixa seletividade, ou uma correspondência de igualdade em uma coluna de alta cardinalidade quase única, ainda pode exigir tocar em uma grande fatia do cluster; o SAI torna essa varredura eficiente, em vez de patológica, mas ainda é uma varredura.
- **Um mapeamento de coluna-para-índice 1 para 1 significa que o SAI não faz indexação composta.** Cada índice SAI cobre exatamente uma coluna; múltiplas colunas indexadas em uma tabela são múltiplos índices separados que o planejador de query combina no momento da leitura, não um único índice composto da forma que um banco de dados relacional poderia oferecer.
- **Análise de texto e busca vetorial são capacidades reais, não substitutos completos de suas contrapartes dedicadas.** O suporte a analisador do SAI é explicitamente "análise de texto básica, não busca de texto completo", e sua busca vetorial ANN é uma capacidade genuinamente útil dentro do banco de dados para buscas no estilo RAG, mas não carrega a superfície de ajuste de um banco de dados vetorial feito sob medida. Trate ambos como "bons o suficiente para evitar um segundo sistema em casos comuns", não como um substituto direto para o Elasticsearch ou um armazenamento vetorial dedicado em escala séria.
- **Apenas `Murmur3Partitioner` e um teto de índice por tabela são restrições reais de implantação.** Um cluster com um partitioner diferente não pode usar o SAI de forma alguma, e o teto padrão de 10 índices por tabela (`sai_indexes_per_table_failure_threshold`) é um guardrail que vale a pena conhecer antes que uma migração de schema adicione um quinto ou sexto índice e comece a falhar.

## Documentation Links

- [Apache Cassandra Documentation, Storage-Attached Indexing (SAI) Overview](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/indexing/sai/sai-overview.html) - doc
- [Apache Cassandra Documentation, Storage-Attached Indexing (SAI) Concepts](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/indexing/sai/sai-concepts.html) - doc
- [Apache Cassandra Documentation, Storage-Attached Indexing (SAI) Quickstart](https://cassandra.apache.org/doc/latest/cassandra/getting-started/sai-quickstart.html) - doc
- [Apache Cassandra Documentation, SAI FAQ](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/indexing/sai/sai-faq.html) - doc
- [Apache Cassandra Documentation, When to Use an Index (legacy secondary indexes, 2i)](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/indexing/2i/2i-when-to-use.html) - doc
- [Apache Cassandra Documentation, Vector Search Quickstart](https://cassandra.apache.org/doc/latest/cassandra/getting-started/vector-search-quickstart.html) - doc
- [Apache Cassandra Blog, Apache Cassandra 5.0 Features: Storage Attached Indexes](https://cassandra.apache.org/_/blog/Apache-Cassandra-5.0-Features-Storage-Attached-Indexes.html) - doc
