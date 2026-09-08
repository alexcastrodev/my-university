---
version: 1.0
updatedAt: 2026-08-20
title: "Busca Vetorial e o Tipo VECTOR: Embeddings Nativos no Cassandra 5.0"
summary: Explica a busca vetorial nativa do Cassandra 5.0, o tipo CQL VECTOR<type, dimension> que armazena um embedding como um valor de coluna de comprimento fixo normal, e a query ORDER BY ... ANN OF ... que encontra seus vizinhos mais próximos aproximados. Mostra que a busca vetorial não é um subsistema separado, mas sim Storage-Attached Indexing (SAI) aplicado a vetores, a mesma sintaxe CREATE INDEX ... USING 'sai', o mesmo comportamento de anexação por SSTable e de planejador de query do SAI para índices de texto e numéricos, mas apoiada em um grafo JVector (um primo próximo do HNSW, inspirado no DiskANN) em vez de um trie ou uma árvore k-d.
---
## Objective

Entender a busca vetorial nativa do Cassandra 5.0: o tipo CQL `VECTOR<type, dimension>`, que armazena um embedding diretamente como um valor de coluna, e a query `ORDER BY ... ANN OF ...`, que encontra seus vizinhos mais próximos aproximados. Nenhuma das duas peças é um subsistema separado acoplado ao Cassandra: a coluna vector é um tipo CQL de comprimento fixo normal, e a query ANN é respondida pelo Storage-Attached Indexing (SAI), a mesma arquitetura de índice integrada ao motor de armazenamento que indexa colunas de texto e numéricas. Busca vetorial é o tipo de índice do SAI aplicado a vetores, não um mecanismo paralelo com seu próprio motor de armazenamento, caminho de escrita, ou planejador de query.

## Use Cases

- Retrieval-augmented generation (RAG): incorporar (embed) trechos de documento em uma coluna `VECTOR` no momento da escrita, incorporar a pergunta do usuário no momento da query, e rodar `ORDER BY ... ANN OF [...]` para puxar os trechos mais próximos como contexto de LLM, sem erguer um banco de dados vetorial separado ao lado do Cassandra.
- Busca semântica sobre conteúdo que correspondência por palavra-chave estruturalmente não capta: exibir um chamado de suporte sobre "cartão recusado no checkout" para uma busca por "pagamento continua falhando", porque os embeddings estão próximos, mesmo que nenhum termo corresponda.
- Recomendação e detecção de quase-duplicatas: "produtos semanticamente similares a este" ou "esse novo documento está perto de algo já armazenado" é exatamente uma query ANN, uma vez que os dois lados são incorporados.
- Adicionar busca vetorial a uma tabela que já tem outros índices SAI e uma partition key normal, para que um único `SELECT` possa restringir por tenant ou partição primeiro e então classificar por similaridade de embedding dentro desse conjunto restringido, em vez de rodar uma varredura vetorial de tabela inteira.
- Manter o embedding, seu texto de origem, e seus metadados (autor, timestamp, ID de tenant) na mesma linha da mesma tabela que o SAI já indexa, em vez de sincronizar um armazenamento de documento com um índice vetorial externo.

## Deep Dive

### O tipo `VECTOR` é um tipo CQL normal, não um caso especial

Segundo a referência de tipos CQL, um vector é "um array não nulo de comprimento fixo, achatado, de valores float." A sintaxe declarada é `vector<float, dimension>` (sem diferenciar maiúsculas/minúsculas, comumente escrita `VECTOR<FLOAT, dimension>`), e apenas elementos `float` são suportados: não existe `vector<int, ...>` nem `vector<double, ...>`. Valores usam a mesma sintaxe de literal entre colchetes de uma list CQL:

```sql
CREATE TABLE cycling.comments_vs (
  id uuid,
  comment text,
  comment_vector VECTOR<FLOAT, 5>,
  PRIMARY KEY (id)
);

INSERT INTO cycling.comments_vs (id, comment, comment_vector)
  VALUES (uuid(), 'Great climb!', [0.45, 0.09, 0.01, 0.2, 0.11]);
```

Duas restrições decorrem diretamente de "comprimento fixo": todo valor em uma coluna `VECTOR` precisa ter exatamente a contagem de dimensão declarada, e elementos não podem ser atualizados individualmente: `UPDATE ... SET comment_vector = [...]` substitui o vector inteiro, não há escrita por posição. Uma coluna vector também pode ser adicionada a uma tabela existente com `ALTER TABLE ... ADD comment_vector VECTOR<FLOAT, 5>`.

### Indexando: isso é SAI, não um motor separado

Uma coluna `VECTOR` não é consultável por similaridade até ter um índice, e esse índice é criado exatamente da forma que qualquer outro índice SAI é criado (`CREATE INDEX ... USING 'sai'`), porque busca vetorial *é* o suporte a `VECTOR` do SAI, usando a mesma arquitetura de índice por SSTable, anexada ao motor de armazenamento, documentada para índices SAI de texto e numéricos:

```sql
CREATE INDEX ann_index ON cycling.comments_vs (comment_vector)
  USING 'sai'
  WITH OPTIONS = { 'similarity_function': 'DOT_PRODUCT' };
```

`similarity_function` aceita `DOT_PRODUCT`, `COSINE`, ou `EUCLIDEAN`, e deveria combinar com a forma que o modelo de embedding que produziu os vetores espera que a distância seja medida: um modelo normalizado para similaridade de cosseno dá classificações sem sentido sob distância Euclidiana, e vice-versa. Por baixo dos panos, o índice vetorial do SAI não usa as mesmas estruturas em disco que usa para texto (tries) ou números (árvores k-d); segundo a documentação oficial de conceitos de busca vetorial, "o SAI usa o JVector, um algoritmo para busca de Vizinho Mais Próximo Aproximado (ANN) e primo próximo do Hierarchical Navigable Small World (HNSW)." O JVector "atinge esse objetivo criando uma hierarquia de grafos, onde cada nível da hierarquia corresponde a um grafo 'small world' que é navegável", e "é inspirado no DiskANN, uma biblioteca ANN apoiada em disco, para armazenar os grafos em disco": um índice de grafo construído e compactado junto com a SSTable, o mesmo modelo de anexação que o conceito irmão de SAI descreve para índices de texto e numéricos, só que com uma estrutura em disco diferente, adequada para travessia de grafo de vizinho mais próximo, em vez de buscas por intervalo ou prefixo.

### Consultando: `ORDER BY ... ANN OF ...`

A query substitui um predicado de igualdade ou intervalo por uma ordenação de similaridade:

```sql
SELECT * FROM cycling.comments_vs
  ORDER BY comment_vector ANN OF [0.15, 0.1, 0.1, 0.35, 0.55]
  LIMIT 3;
```

`LIMIT` não é opcional: uma query sem ele falha completamente, e é limitado: a documentação afirma que "o limite precisa ser 1.000 ou menos." "ANN" é a palavra operativa: a documentação é explícita ao dizer que isso retorna uma aproximação, "na maioria dos casos produz resultados quase tão bons quanto a correspondência exata", e que "buscas de menos-similar não são suportadas": você só pode pedir os vizinhos mais próximos, nunca os mais distantes.

Para recuperar a pontuação de similaridade real, em vez de apenas uma classificação implícita, o SAI expõe funções escalares correspondentes (`similarity_dot_product`, `similarity_cosine`, `similarity_euclidean`), chamáveis contra a mesma coluna e vector de query usados no `ORDER BY`:

```sql
SELECT id, comment, similarity_cosine(comment_vector, [0.2, 0.15, 0.3, 0.2, 0.05]) AS score
FROM cycling.comments_vs
ORDER BY comment_vector ANN OF [0.2, 0.15, 0.3, 0.2, 0.05]
LIMIT 3;
```

### Busca híbrida: combinando `ANN OF` com outros predicados

Como o índice vetorial é um índice SAI como qualquer outro, uma query pode restringir por uma partition key ou outra coluna indexada por SAI e classificar por similaridade dentro desse conjunto restringido na mesma declaração; o comportamento de planejador de query SAI que o conceito irmão descreve (escolher o índice mais seletivo, combinar mais de um via um Query Plan) se aplica aqui também. O documento de design CEP-30 da Apache para busca vetorial ANN dá a forma disso:

```sql
SELECT id, v FROM keyspace.table
  WHERE tenant_id = 1
  ORDER BY v ANN OF [0.2, 0.2]
  LIMIT 4
  ALLOW FILTERING;
```

O SAI aplica o filtro não vetorial antes ou depois da busca vetorial, dependendo da seletividade estimada: um filtro altamente seletivo (digamos, uma partition key específica) restringe o conjunto de candidatos antes que a busca no grafo rode, o que é tanto mais rápido quanto mais preciso do que varrer o índice vetorial da tabela inteira e filtrar depois. Como em qualquer query SAI, restringir a partition key primeiro é o caminho rápido; um `ORDER BY ... ANN OF` global sem restrição de partition key precisa alcançar mais longe pelo índice vetorial do cluster, a mesma física de qualquer outra query SAI que não seja de partition key.

### Modelagem de dados: a parte que não é sintaxe de índice

A orientação oficial de modelagem de dados para busca vetorial é na verdade sobre os próprios embeddings, não sobre a mecânica do Cassandra: "uma busca vetorial só funciona quando os vetores têm as mesmas dimensões", já que comparações de cosseno e produto escalar exigem dimensionalidade correspondente, e misturar embeddings de modelos diferentes é explicitamente sinalizado como arriscado: "comparar embeddings de Word2Vec com embeddings de BERT poderia ser problemático porque esses modelos têm arquiteturas diferentes." O padrão recomendado é manter o material de origem e os metadados do embedding na mesma linha: "armazene metadados relevantes sobre um vector em outras colunas na sua tabela... se seu vector é uma imagem, armazene a imagem original na mesma tabela", que é um encaixe natural para o modelo de linha larga do Cassandra, e é exatamente o que as tabelas de exemplo CQL acima já fazem, mantendo `comment` ao lado de `comment_vector`.

### A mesma necessidade, a resposta nativa de um produto diferente

Todo banco de dados importante neste projeto de expansão NoSQL adicionou aproximadamente a mesma capacidade por volta da mesma época, pela mesma razão (RAG e busca semântica se tornaram uma carga de trabalho comum), mas cada um a lançou como uma extensão natural de seu próprio modelo de armazenamento, em vez de adotar um design comum. A resposta do MongoDB (veja `mongodb-atlas-search-and-vector-search`) é `$vectorSearch`, um estágio de agregação servido por um processo *separado* baseado em Lucene (`mongot`) ao lado do `mongod`, com opções de índice como `numDimensions` e `similarity` declaradas em uma definição de índice de busca e um documento `filter` avaliado antes da comparação vetorial. A resposta do Cassandra mantém tudo dentro do mesmo motor que já armazena e compacta a linha: o vector é um tipo CQL nativo sentado em uma coluna comum, e o índice ANN é apenas mais um índice SAI compartilhando o comportamento de anexação por SSTable, planejador de query, e combinação com `WHERE` do SAI: não há um segundo processo nem um documento de definição de índice separado para manter sincronizado com o schema.

## Trade-offs

- **O índice vetorial compartilha a arquitetura do SAI, mas não suas estruturas em disco.** Índices SAI de texto usam tries, índices SAI numéricos usam árvores k-d, e índices SAI vetoriais usam um grafo JVector: três layouts físicos diferentes sob uma sintaxe `CREATE INDEX ... USING 'sai'` e um modelo de anexação de armazenamento. Entender o SAI de forma geral (o conceito irmão `cassandra-storage-attached-indexes`) explica o planejador de query e o comportamento de anexação aqui, mas não os internos de busca em grafo.
- **`similarity_function` precisa combinar com a forma que os embeddings foram produzidos, e o Cassandra não consegue checar isso por você.** Escolher `EUCLIDEAN` para vetores que um modelo de embedding espera que sejam comparados com `COSINE` produz uma classificação que roda sem erro e é simplesmente errada: esse é um contrato no nível da aplicação, não algo que o schema reforça.
- **ANN significa aproximado, e a API só vai em uma direção.** Resultados são "quase tão bons quanto" o vizinho mais próximo exato, não exatos, e queries de "menos-similar" não são suportadas de forma alguma: não existe um `ORDER BY ... ANN OF ... DESC` para encontrar as linhas mais dissimilares.
- **`LIMIT` é obrigatório e limitado a 1.000.** Uma query vetorial sem `LIMIT` falha completamente, em vez de assumir algum número grande por padrão, e nenhum `LIMIT` acima de 1.000 é aceito: isso descarta "só busque tudo ordenado por similaridade" como um padrão.
- **Sobrescritas ou deleções frequentes na coluna vector degradam a qualidade da busca, não só a velocidade.** A documentação é explícita ao dizer que busca vetorial "funciona de forma ótima em tabelas sem sobrescritas ou deleções" da coluna vector, e que uma coluna sob rotatividade deveria esperar resultados mais lentos: um índice de grafo lida melhor com cargas de trabalho de anexação-e-consulta em regime permanente do que com uma com alta taxa de atualização na própria coluna indexada.
- **Filtragem híbrida precisa de `ALLOW FILTERING` e ainda é um filtro, não uma combinação de graça.** Combinar `ANN OF` com uma cláusula `WHERE` em uma coluna que não é a partition key completa ainda pede ao Cassandra que avalie um predicado fora de seu caminho rápido centrado em partição; um `WHERE` que restringe a partition key primeiro é materialmente mais rápido do que uma varredura vetorial global seguida de pós-filtragem, a mesma regra de qualquer outra query SAI.
- **Isso é "bom o suficiente para pular erguer um segundo sistema" para cargas de trabalho comuns de RAG e busca semântica, não a superfície de ajuste de um banco de dados vetorial feito sob medida.** O JVector é um motor ANN real e competitivo (o mesmo por trás do DataStax Astra DB), mas a busca vetorial do Cassandra expõe uma escolha de função de similaridade no momento da indexação e nenhum botão de ajuste adicional no próprio CQL: comparável em espírito à análise de texto do SAI ser "análise de texto básica, não busca de texto completo".

## Documentation Links

- [Apache Cassandra Documentation, Vector Search Overview](https://cassandra.apache.org/doc/latest/cassandra/vector-search/overview.html) - doc
- [Apache Cassandra Documentation, Vector Search Concepts](https://cassandra.apache.org/doc/latest/cassandra/vector-search/concepts.html) - doc
- [Apache Cassandra Documentation, Working with Vector Search](https://cassandra.apache.org/doc/latest/cassandra/vector-search/vector-search-working-with.html) - doc
- [Apache Cassandra Documentation, Vector Search Data Modeling](https://cassandra.apache.org/doc/latest/cassandra/vector-search/data-modeling.html) - doc
- [Apache Cassandra Documentation, Vector Search Quickstart](https://cassandra.apache.org/doc/latest/cassandra/getting-started/vector-search-quickstart.html) - doc
- [Apache Cassandra Documentation, CQL Data Types (VECTOR)](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/types.html) - doc
- [Apache Cassandra Documentation, Storage-Attached Indexing (SAI) Overview](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/indexing/sai/sai-overview.html) - doc
- [Apache Cassandra Wiki, CEP-30: Approximate Nearest Neighbor (ANN) Vector Search via Storage-Attached Indexes](https://cwiki.apache.org/confluence/pages/viewpage.action?pageId=255069753) - doc
