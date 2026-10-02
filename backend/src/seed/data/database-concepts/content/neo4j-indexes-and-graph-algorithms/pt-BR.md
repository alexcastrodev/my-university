---
version: 1.0
updatedAt: 2026-08-20
title: "Índices e Algoritmos de Grafos no Neo4j: Das Buscas via REST ao Dijkstra"
summary: Como o serviço de indexação separado do Neo4j (índices de nó chave-valor e full-text/Lucene) e suas primitivas nativas de busca de caminhos tornam buscas e consultas de caminho mais curto recursos de primeira classe, e não código do lado do cliente, percorrido pelo exercício shortestPath() de Kevin Bacon do livro, por um rastro de Dijkstra em grafo ponderado feito do zero, e por como tanto a antiga API REST de indexação quanto a opção única dijkstra deram lugar ao CREATE INDEX/CREATE FULLTEXT INDEX apoiado no schema e à biblioteca muito maior de algoritmos Graph Data Science.
---
## Objective

Entender as duas coisas que o Neo4j acrescenta quando você vai além do CRUD básico em Cypher: **índices**, que dão busca rápida de um nó por propriedade em vez de ler o grafo inteiro, e **algoritmos de grafos**, que transformam "encontre o caminho" ou "quão conectado é este nó" de um programa do lado do cliente que você teria que escrever em algo que o banco roda nativamente. O próprio enquadramento do livro é o motivo de os dois pertencerem a um único conceito: "Embora o Neo4j não seja fundamentalmente orientado a schema como os bancos relacionais, índices e constraints vão ajudar a manter suas consultas rápidas e seu grafo são. Eles são absolutamente obrigatórios se você quer rodar o Neo4j em produção." A busca de caminhos recebe o mesmo tratamento de "aqui isto é cidadão de primeira classe": um caminho mais curto entre dois nós é uma chamada de função Cypher no Neo4j, enquanto a mesma pergunta é uma CTE recursiva em SQL ou uma busca em largura no lado da aplicação acoplada a um banco de documentos.

## Use Cases

- Encontrar um nó por um valor de propriedade sem percorrer o grafo inteiro: o exemplo do índice `authors` do livro, com chave `name`, retornando os dados reais do nó em uma única chamada em vez de um `MATCH` que precisa inspecionar todos os nós.
- Montar uma consulta no estilo busca ("me dê todos os livros cujo nome começa com Jeeves") com um índice invertido full-text, em vez de tentar simular busca por prefixo com predicados de string do Cypher sobre uma propriedade sem índice.
- Responder "quantos graus de separação há entre estas duas pessoas" sem escrever um algoritmo de travessia por conta própria: o exercício de seis graus de Kevin Bacon do livro, rodado inteiramente na função `shortestPath()` do Cypher sobre um dataset de filmes de 63.042 nós.
- Reconhecer que a notação com asterisco do Cypher (`[:ACTS_IN*1..4]`) conta *saltos*, não "graus" no sentido humano, e reescrever uma consulta de acordo: a própria pegadinha do livro, em que o "grau" de ator para ator é na verdade dois saltos (ator→filme→ator).
- Escolher um algoritmo de busca de caminhos via REST (`shortestPath`, `allPaths`, `allSimplePaths`, `dijkstra`) para uma necessidade específica de travessia, e saber que o caminho mais curto ponderado (Dijkstra) é uma opção nomeada e disponível, mesmo onde o livro não percorre seu funcionamento interno.
- Explicar a um time por que uma consulta de "distância entre dois nós", que parece trivial em um modelo de grafo, vira uma CTE recursiva desajeitada em um schema relacional, ou uma busca em largura no lado da aplicação sobre documentos em um banco de documentos.

## Deep Dive

### O serviço de indexação do Neo4j é uma coisa separada do próprio grafo

A mecânica do livro, da época de 2018, roda inteiramente sobre a interface REST do Neo4j, e a descrição importa porque explica *por que* a indexação parece diferente no Neo4j em relação a um banco relacional: "Diferente de outros índices de banco de dados, em que você faz as consultas mais ou menos do mesmo jeito que sem eles, os índices do Neo4j têm um caminho diferente, porque o serviço de indexação é na verdade um serviço separado." Um índice relacional é invisível para a consulta que você escreve: você faz o `SELECT` do mesmo jeito com ou sem ele, e o planejador decide. O modelo de indexação do Neo4j no livro é explícito: você consulta o *índice* diretamente, na URL dele, e ele devolve os dados do nó em vez da URL que você guardou originalmente.

A forma mais simples é um índice chave-valor: "Você usa algum dado do nó como chave do índice, e o valor é uma URL REST que aponta para o nó no grafo." O rastro do próprio livro: crie um índice chamado `authors`, faça POST de um par chave/valor apontando para um nó:

```
$ curl -X POST http://localhost:7474/db/data/index/node/authors \
  -H "Content-Type: application/json" \
  -d '{
     "uri": "http://localhost:7474/db/data/node/9",
     "key": "name",
     "value": "P.G.+Wodehouse"
  }'
```

e recupere-o com um simples `GET` em `/db/data/index/node/authors/name/P.G.+Wodehouse`, que "não retorna a URL que especificamos, e sim os dados reais do nó." Você pode ter quantos índices nomeados quiser e, um detalhe fácil de não perceber, "índices também podem ser construídos sobre arestas, como fizemos antes; basta trocar as ocorrências de node nas URLs por relationship."

Além da busca chave-valor, o livro cobre um segundo tipo de índice construído sobre o Lucene: "O Neo4j oferece um índice invertido de busca full-text, então você pode fazer consultas como esta: 'Me dê todos os livros com nomes que começam com Jeeves.'" Construí-lo significa nomeá-lo explicitamente como do tipo full-text (`{"type": "fulltext", "provider": "lucene"}`), populá-lo do mesmo jeito que o índice chave-valor e consultá-lo com sintaxe Lucene de verdade (`?query=name:P*`) em vez de um GET de chave/valor em JSON.

### Busca de caminhos como primitiva REST

O livro trata "encontre o caminho entre dois nós" como uma operação REST com um algoritmo nomeado, não como algo que você escreve: faça POST na URL `/paths` de um nó com um alvo, um filtro de tipo de relacionamento e o nome de um algoritmo. "As outras escolhas de algoritmo de caminho são allPaths, allSimplePaths e dijkstra." É um reconhecimento direto, ainda que breve, de que o caminho mais curto ponderado é uma primitiva real e disponível, e o livro é franco ao não ir além: "Você encontra informações sobre esses algoritmos na documentação online, mas uma cobertura detalhada está fora do escopo deste livro." O Deep Dive deste conceito percorre o próprio algoritmo de Dijkstra abaixo, sobre um pequeno grafo ponderado, para preencher exatamente essa lacuna.

### A busca de caminhos do próprio Cypher: `shortestPath()` e o problema de Kevin Bacon

A peça central do Dia 2 troca a interface REST pela função embutida `shortestPath()` do Cypher, rodada contra um dataset real de filmes de 63.042 nós (12.862 filmes, mais de 44.000 atores). O ponto que o livro quer mostrar é que o Cypher já tem algoritmos de grafos sérios embutidos: você não percorre uma árvore de nós à mão:

```cypher
MATCH (bacon:Actor {name: "Kevin Bacon"}), (penn:Actor {name: "Sean Penn"}),
p = shortestPath((bacon)-[:ACTS_IN*]-(penn))
RETURN length(p);
```

Dois resultados desse dataset valem ser levados adiante como intuição de como os grafos "se espalham": um grau a partir de Kevin Bacon (colegas de elenco) alcança 304 atores; dois graus (`[:ACTS_IN*1..4]`, já que cada "grau" humano é na verdade dois saltos no grafo, passando por um nó `Movie` intermediário) alcançam 9.096: "o quociente entre 2 graus e 1 grau é de cerca de 79." Em seis graus, 93,4% de todo o conjunto de atores é alcançável, o que o livro achou "só um pouco mais alto que a porcentagem de atores a até 6 graus" quando rodou a mesma consulta sem limite de profundidade nenhum, o que significa que quase todo mundo conectado a Kevin Bacon nesse dataset está a até seis saltos.

Uma lição de corretude afiada e fácil de não ver fica bem ao lado desse resultado: consultar `shortestPath` para Bacon e Sean Penn retornou um comprimento de 2 saltos, embora, "segundo o IMDB, os senhores Bacon e Penn tenham atuado juntos em Mystic River": um salto. O algoritmo estava correto; os dados estavam incompletos. `MATCH (m:Movie {name: "Mystic River"}) RETURN count(DISTINCT m)` retornou `0`: o filme simplesmente não estava no dataset. A moral do próprio livro: "então talvez ainda não use esses resultados para se exibir no seu próximo jantar." Um algoritmo de caminho mais curto é sempre tão curto quanto o grafo que você de fato deu a ele.

A outra pegadinha é a duplicação: "Rodar a consulta anterior sem usar `DISTINCT` resulta em uma contagem de 313" em vez de 304, porque "há alguns atores que estão a dois graus de Kevin Bacon mais de uma vez": vários filmes em comum produzem vários caminhos até o mesmo ator. O `DISTINCT` não é cosmético aqui; sem ele, as contagens de espalhamento ficam simplesmente erradas.

### Vendo o Dijkstra rodar de verdade: um rastro de caminho mais curto ponderado

O livro cita `dijkstra` como algoritmo de caminho via REST, mas não percorre sua mecânica. Eis o próprio algoritmo, rastreado sobre um pequeno grafo ponderado de seis cidades e nove rotas com pesos, encontrando a rota mais curta de Denver a Boston. Cada passo ou **relaxa** uma aresta (propõe ou melhora uma distância provisória até um vizinho) ou **fixa** uma cidade (trava sua distância final, de forma gulosa, quando ela é o menor valor provisório ainda não fixado):

```viz
type: graph
node A Denver 0 1
node D Omaha 1 0
node B Chicago 2 0
node C Dallas 1 2
node E Atlanta 2 2
node F Boston 3 1
edge A B
edge A D
edge D B
edge D C
edge B C
edge B E
edge C E
edge C F
edge E F
---
visit A | O Dijkstra começa em Denver com distância provisória 0; todas as outras cidades começam em infinito, não fixadas.
traverse A B | Relaxa Denver-Chicago (peso 4): a distância provisória de Chicago passa a ser 0+4=4.
traverse A D | Relaxa Denver-Omaha (peso 2): a distância provisória de Omaha passa a ser 0+2=2.
mark D | Omaha (2) é a menor distância provisória entre as cidades não fixadas; fixe-a de forma permanente. Este é o passo guloso do Dijkstra: depois que um nó é fixado, sua distância nunca pode melhorar.
visit D | A cidade atual passa a ser Omaha (distância fixada 2); explore suas arestas em seguida.
traverse D B | Relaxa Omaha-Chicago (peso 1): 2+1=3 é melhor que os 4 atuais de Chicago, então Chicago passa a 3.
traverse D C | Relaxa Omaha-Dallas (peso 5): 2+5=7; Dallas ainda não tinha distância provisória, então passa a 7.
mark B | Chicago (3) agora é a menor distância não fixada; fixe-a em 3, alcançada via Omaha, e não pela aresta direta de Denver, que só oferecia 4.
visit B | A cidade atual passa a ser Chicago (distância fixada 3).
traverse B C | Relaxa Chicago-Dallas (peso 1): 3+1=4 é melhor que os 7 de Dallas, então Dallas passa a 4.
traverse B E | Relaxa Chicago-Atlanta (peso 7): 3+7=10; Atlanta ainda não tinha distância provisória, então passa a 10.
mark C | Dallas (4) é a menor não fixada; fixe-a em 4, via Chicago.
visit C | A cidade atual passa a ser Dallas (distância fixada 4).
traverse C E | Relaxa Dallas-Atlanta (peso 3): 4+3=7 é melhor que os 10 de Atlanta, então Atlanta passa a 7.
traverse C F | Relaxa Dallas-Boston (peso 6): 4+6=10; Boston ainda não tinha distância provisória, então passa a 10.
mark E | Atlanta (7) é a menor não fixada; fixe-a em 7, via Dallas, e não pelo relaxamento anterior a partir de Chicago, que só oferecia 10.
visit E | A cidade atual passa a ser Atlanta (distância fixada 7).
traverse E F | Relaxa Atlanta-Boston (peso 1): 7+1=8 é melhor que os 10 de Boston, então Boston passa a 8.
mark F | Boston (8) é a única cidade não fixada restante; fixe-a em 8. O Dijkstra termina: a menor distância de Denver a Boston é 8.
visit F | Refazer os predecessores de Boston até Denver dá o caminho vencedor Denver-Omaha-Chicago-Dallas-Atlanta-Boston, pesos 2+1+1+3+1=8; os mesmos relaxamentos que definiram a distância final de cada cidade também traçam o caminho.
```

Note o que fez Denver→Omaha→Chicago com 3 vencer Denver→Chicago com 4: o Dijkstra nunca se compromete com a primeira aresta que vê. Ele só fixa uma cidade quando nada não fixado poderia oferecer uma rota mais curta: a mesma disciplina que, rodando sobre a estrutura de grafo do Neo4j em vez de uma desenhada à mão, é o que `dijkstra` como algoritmo de caminho via REST (ou `shortestPath()` no Cypher, para o caso sem pesos) faz por baixo.

### Livro vs hoje

> **A interface REST sobre a qual este capítulo inteiro é construído foi removida no Neo4j 4.0.** Todo comando do livro (`POST /db/data/node`, `POST /db/data/index/node/authors`, `POST /db/data/node/9/paths` com um campo `algorithm`) mira a antiga API HTTP REST. A própria documentação de migração do Neo4j confirma que a API REST foi removida a partir do Neo4j 4.0, em favor de Cypher e procedures executados pela API HTTP de consultas ou pelo protocolo Bolt via drivers oficiais.
> **Os índices de nó chave-valor e full-text do livro são exatamente a família de índices "legacy/manual/auto" que o Neo4j vem aposentando.** A documentação atual do Neo4j afirma com todas as letras que "todas as APIs, superfícies e recursos relacionados a índices explicit/auto/manual/legacy estão descontinuados para remoção", com índices de schema e índices full-text nativos como substitutos. No Cypher atual, criar um índice é `CREATE [RANGE] INDEX [index_name] [IF NOT EXISTS] FOR (n:Label) ON (n.property)`, uma instrução Cypher contra o schema do grafo, e não um POST para um serviço de indexação endereçado separadamente, e a busca full-text é seu próprio comando de primeira classe, `CREATE FULLTEXT INDEX`, em vez de um tipo de índice apoiado em Lucene configurado à mão.
> **`shortestPath()` e `allShortestPaths()` ainda funcionam, mas agora são "legados" diante da sintaxe mais nova.** As funções Cypher em que o exercício de Kevin Bacon do livro se apoia continuam disponíveis no Neo4j atual, mas a documentação atual do Cypher as apresenta como não conformes ao GQL e aponta para a sintaxe de padrão mais nova, baseada nas palavras-chave `SHORTEST` / `ALL SHORTEST`, como o equivalente voltado para o futuro. A ideia por baixo (caminho mais curto como primitiva da linguagem de consulta) não mudou; a sintaxe de superfície ganhou uma segunda forma, preferida.
> **A opção REST nomeada `dijkstra` cresceu e virou uma biblioteca separada inteira.** O livro lista `dijkstra` como uma de quatro escolhas de busca de caminhos embutidas no endpoint REST `/paths`. Hoje essa ideia virou a **biblioteca Graph Data Science (GDS)**, um catálogo muito maior, mantido separadamente e exposto como procedures Cypher: algoritmos dedicados Dijkstra Source-Target e Dijkstra Single-Source, um algoritmo **A\* Shortest Path** (Dijkstra com uma heurística geoespacial), o algoritmo de **k caminhos mais curtos de Yen** (que "para k = 1... se comporta exatamente como o algoritmo de caminho mais curto de Dijkstra"), busca em largura e em profundidade, além de categorias inteiras que o livro nunca toca: centralidade (PageRank e outros), detecção de comunidades, similaridade de nós e pipelines de machine learning para predição de links. O menu REST de quatro itens do livro era uma prévia do que hoje é um produto de análise dedicado.

## Trade-offs

- **Um banco de grafos torna "encontre o caminho" uma primitiva da linguagem; SQL e bancos de documentos tornam isso um programa que você escreve.** `shortestPath()` é uma chamada de função Cypher sobre um dataset de 63.042 nós; a mesma pergunta contra um schema relacional precisa de uma common table expression recursiva percorrendo uma chave estrangeira autorreferenciada, e contra um banco de documentos normalmente significa trazer documentos para o código da aplicação e rodar sua própria busca em largura. Todo o exercício do Dia 2 do livro é, na verdade, uma demonstração de que o modelo de grafo *é* a vitória aqui: a travessia não é um acoplamento, é para isso que o modelo de armazenamento existe.
- **O próprio modelo de indexação do livro, um serviço de indexação separado e endereçado via REST, trocou facilidade de descoberta por um custo operacional real, e é exatamente por isso que esta é a parte do capítulo que foi aposentada.** Consultar um índice na própria URL dele, em vez de de forma transparente pelas consultas normais, significava que o índice precisava ser gerenciado, populado e lembrado explicitamente como um recurso separado por nome de índice: atrito real, e exatamente o que o `CREATE INDEX` apoiado no schema e os índices full-text nativos foram feitos para eliminar.
- **A corretude de `shortestPath()` é tão boa quanto o grafo que você construiu.** O resultado de Bacon e Penn do livro (2 saltos em vez do 1 do mundo real) não foi um bug do algoritmo: foi um nó `Mystic River` ausente. Todo algoritmo de caminho mais curto ou de travessia responde "caminho mais curto *no grafo como está armazenado*", uma afirmação diferente e mais estreita que "caminho mais curto na realidade", e a distância entre as duas é invisível a menos que você vá procurar.
- **A travessia com asterisco do Cypher (`[:ACTS_IN*1..4]`) é poderosa e fácil de contar errado.** Ela poupa você de escrever uma cadeia `MATCH` explícita de vários saltos, mas conta saltos de relacionamento, não o conceito humano de "graus": a primeira tentativa do próprio livro de "dois graus a partir de Kevin Bacon" contou de menos porque um grau de pessoa para pessoa são dois saltos passando por um nó intermediário. A conveniência é real; a armadilha de errar por um fator de dois que vem junto também.
- **`DISTINCT` é um requisito de corretude em consultas de espalhamento em grafos, não uma preferência de estilo.** Vários caminhos de relacionamento até o mesmo nó (dois atores que dividem mais de um filme) produzem linhas duplicadas por design: é o que um grafo devolve honestamente quando perguntado "quem é alcançável" sem deduplicação. Pular o `DISTINCT` não só fica bagunçado; infla as contagens em silêncio, como mostra a própria discrepância de 313 contra 304 do livro.
- **Tirar a busca de caminhos de um punhado de opções embutidas e levá-la para uma biblioteca GDS dedicada compra amplitude de algoritmos ao custo de mais uma coisa para instalar e operar.** A opção REST `dijkstra` que o livro descreve não precisava de nada além do servidor rodando. O catálogo de algoritmos muito maior de hoje (A*, Yen, PageRank, detecção de comunidades, pipelines de ML) vive no Graph Data Science, uma biblioteca separada com suas próprias projeções de grafo em memória, orçamento de memória e superfície operacional por cima do banco base.

## Documentation Links

- [Luc Perkins, Eric Redmond e Jim R. Wilson, "Seven Databases in Seven Weeks", 2ª edição (Pragmatic Bookshelf, 2018): Capítulo 6, "Neo4J", Dia 2: "REST, Indexes, and Algorithms"](https://pragprog.com/titles/rwdata2/seven-databases-in-seven-weeks-second-edition/): doc
- [Neo4j Cypher Manual: Create, Show, and Drop Indexes](https://neo4j.com/docs/cypher-manual/current/indexes/search-performance-indexes/managing-indexes/): doc
- [Neo4j Upgrade and Migration Guide: Breaking Changes Between Neo4j 4.4 and Neo4j 5 (legacy indexes, REST API removal)](https://neo4j.com/docs/upgrade-migration-guide/current/version-5/migration/breaking-changes/): doc
- [Neo4j Cypher Manual: Deprecations, Additions, Removals, and Compatibility (shortestPath/allShortestPaths vs SHORTEST)](https://neo4j.com/docs/cypher-manual/current/deprecations-additions-removals-compatibility/): doc
- [Neo4j Graph Data Science Documentation: Graph Algorithms (pathfinding, centrality, community detection, similarity)](https://neo4j.com/docs/graph-data-science/current/algorithms/): doc
- [Neo4j Graph Data Science Documentation: Dijkstra Source-Target Shortest Path](https://neo4j.com/docs/graph-data-science/current/algorithms/dijkstra-source-target/): doc
