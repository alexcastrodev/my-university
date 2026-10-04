---
version: 1.0
updatedAt: 2026-09-07
title: "Escolhendo um Índice: Hash vs. B+Tree"
summary: "Um guia de decisão concreto construído a partir dos números de custo reais dos quatro conceitos anteriores: uma carga de trabalho só de igualdade, sem consultas por intervalo, favorece a busca O(1) de um índice hash, enquanto qualquer coisa que precise de varreduras por intervalo, iteração ordenada ou saída ordenada precisa da travessia O(log n) de uma B+Tree, conferido com `mongodb-indexing-fundamentals` de `database-concepts`, que documenta um sistema real de produção usando por padrão índices B+Tree exatamente por esse motivo, a mesma família estrutural construída aqui do zero."
---
## Objetivos de Aprendizagem

- Comparar índices hash e B+Trees no eixo exato que os separa: o suporte a consultas por intervalo e a ordenação.
- Aplicar um procedimento de decisão concreto para escolher entre os dois para uma dada carga de trabalho.
- Explicar por que um sistema real frequentemente mantém os dois tipos de índice em colunas diferentes da mesma tabela.
- Conectar esta decisão ao padrão de indexação documentado de um sistema real de produção.

## Contexto e Motivação

Os quatro conceitos anteriores construíram duas estruturas de índice completas e independentes respondendo à mesma pergunta subjacente ("encontre a(s) tupla(s) que correspondem a esta chave sem varrer toda página") usando estratégias genuinamente diferentes, com pontos fortes genuinamente diferentes. Este conceito não introduz mecânica nova; ele fecha o bloco de indexação tornando a escolha entre os dois explícita, concreta e no formato de um procedimento de decisão, exatamente o tipo de julgamento que um projetista real de schema precisa fazer para toda coluna considerada para indexação.

## Teoria Central

### O único eixo que de fato decide

Toda outra característica de desempenho de índices hash e B+Trees é próxima o suficiente na prática para não ser o fator decisivo. A diferença real e estrutural é **se o índice preserva alguma relação de ordem entre as chaves**:

- Um **índice hash** destrói deliberadamente a ordenação: uma boa função hash espalha as chaves de modo que duas chaves numericamente adjacentes fiquem, com alta probabilidade, longe uma da outra na ordem dos buckets. Isso compra buscas por igualdade em tempo esperado O(1) (`hash-indexes`), mas torna impossível responder um predicado de intervalo, um `ORDER BY` na coluna indexada ou uma correspondência de prefixo. Qualquer consulta que precise de "tudo entre X e Y" ou "em ordem" não ganha benefício algum e precisa recorrer a uma varredura completa.
- Uma **B+Tree** preserva a ordenação por construção: toda folha guarda uma sequência ordenada de chaves, e as folhas são ligadas em ordem (`b-plus-trees-structure-and-search`). Isso custa um O(logₘ n) ligeiramente maior para uma busca por igualdade isolada, comparado ao O(1) de um índice hash, mas responde diretamente consultas por intervalo, iteração ordenada e correspondências de prefixo, encontrando o ponto de partida uma vez e depois andando pela cadeia de folhas.

### Um procedimento de decisão concreto

Dada uma coluna sendo considerada para um índice, pergunte: as consultas contra ela vão algum dia precisar de algo além de igualdade exata? Se genuinamente nunca (um ID substituto buscado um valor por vez, por exemplo), a busca O(1) de um índice hash é estritamente melhor, sem desvantagem real. Se consultas por intervalo, ordenação ou correspondência de prefixo aparecerem em qualquer lugar da carga de trabalho esperada, mesmo que ocasionalmente, uma B+Tree é a única das duas que consegue atendê-las, e o seu custo de busca por igualdade (um pequeno número constante de buscas de página extras em relação a um índice hash) é um preço modesto e previsível por essa flexibilidade. É exatamente por isso que as B+Trees, e não os índices hash, são o tipo de índice padrão em essencialmente todo SGBD relacional de propósito geral: a maioria das cargas de trabalho reais mistura predicados de igualdade e de intervalo de forma imprevisível, e uma B+Tree trata os dois razoavelmente bem, enquanto um índice hash trata só um dos dois.

### Sistemas reais frequentemente constroem os dois

Nada impede uma tabela de ter um índice B+Tree numa coluna e um índice hash em outra: eles são estruturas independentes, por coluna. Uma tabela pode ter uma B+Tree em `created_at` (suportando consultas por intervalo como "pedidos dos últimos 7 dias") e um índice hash em `session_token` (uma busca pura por igualdade, sem uso concebível de intervalo), cada um escolhido exatamente pelo procedimento de decisão acima, aplicado separadamente a cada coluna indexada com base em como aquela coluna específica é de fato consultada.

## Exemplos Resolvidos

### Exemplo 1: uma carga de trabalho só de igualdade favorecendo um índice hash

Uma tabela `Sessions` é consultada exclusivamente por `WHERE session_token = ?`; nenhuma consulta por intervalo sobre tokens de sessão jamais tem sentido (os tokens são strings aleatórias opacas, sem semântica de ordem com a qual uma aplicação se importe). Um índice hash em `session_token` dá buscas esperadas O(1) sem desvantagem, já que a ordenação que uma B+Tree preservaria nunca é usada por nenhuma consulta contra esta coluna.

### Exemplo 2: uma carga de trabalho pesada em intervalos exigindo uma B+Tree

Uma tabela `Orders` é frequentemente consultada com `WHERE order_date BETWEEN ? AND ?` e `ORDER BY order_date`. Um índice hash em `order_date` seria ativamente inútil para as duas: o processador de consultas não teria como usá-lo e recorreria a uma varredura completa do heap file. Uma B+Tree em `order_date`, por contraste, responde a consulta por intervalo diretamente, encontrando a folha que guarda o início do intervalo e andando para frente pela cadeia de folhas, e responde o `ORDER BY` de graça (a cadeia de folhas já retorna as linhas na ordem das chaves), ao custo modesto de O(logₘ n) em vez de O(1) no caso raro de uma consulta de fato precisar de uma correspondência exata de uma única data.

### Exemplo 3: o padrão real documentado do MongoDB, conferido

`mongodb-indexing-fundamentals`, de `database-concepts`, documenta que o tipo de índice padrão do MongoDB é uma B+Tree, usada tanto para índices de campo único quanto para compostos, com o planejador de consultas escolhendo entre os índices disponíveis com base no formato da consulta: exatamente a mesma família estrutural (e o raciocínio subjacente idêntico: a maioria das cargas de trabalho reais eventualmente precisa de acesso por intervalo ou ordenado em pelo menos algum campo indexado) construída do zero nos quatro conceitos anteriores desta disciplina. Índices hash também existem no MongoDB, mas como uma escolha mais estreita e opcional para campos genuinamente só de igualdade (usados notavelmente de forma interna para sharding numa chave de shard com hash, especificamente para espalhar as escritas de maneira uniforme), um sistema real de produção chegando de forma independente ao padrão idêntico que o procedimento de decisão deste conceito prevê.

## Equívocos Comuns e Armadilhas

- **"Uma B+Tree é só um índice hash estritamente melhor, então por que alguém usa índices hash?"** Uma B+Tree não é estritamente melhor: a sua busca por igualdade, embora ainda rápida, custa mais E/Ss de página no pior caso que o O(1) de um índice hash, e para uma carga de trabalho genuinamente só de igualdade e de alto throughput (o exemplo de `Sessions` acima), essa diferença é real e vale a pena aproveitar, e não um erro de arredondamento. As duas estruturas fazem um trade-off genuíno, e não uma dominância estrita.
- **"Uma vez que você indexa uma coluna com um tipo, não pode indexá-la com o outro também."** Uma única coluna pode ter simultaneamente um índice hash e um índice B+Tree se a carga de trabalho genuinamente se beneficiar dos dois padrões de acesso. O otimizador de consultas, vários conceitos adiante, é exatamente o componente responsável por escolher qual índice disponível (se algum) melhor atende uma consulta específica no momento da execução.
- **"Escolher um tipo de índice é uma decisão única que nunca precisa ser revista."** O tipo de índice certo é uma propriedade da *carga de trabalho de consultas*, e não dos próprios dados: uma coluna indexada só com hash porque se acreditava ser só de igualdade pode depois precisar de suporte a intervalos quando uma nova funcionalidade introduzir uma consulta por intervalo contra ela, e nesse ponto o tipo de índice genuinamente precisa mudar, e não só ser ajustado.

## Resumo

A escolha entre um índice hash e uma B+Tree se resume a exatamente um fato estrutural: um índice hash destrói a ordenação das chaves para comprar buscas por igualdade O(1), enquanto uma B+Tree preserva a ordenação (a um custo modesto de O(logₘ n) na busca por igualdade) para suportar consultas por intervalo, saída ordenada e correspondência de prefixo que um índice hash não consegue atender de forma alguma. Uma carga de trabalho só de igualdade deveria usar um índice hash; qualquer outra coisa precisa de uma B+Tree, uma decisão que `mongodb-indexing-fundamentals`, de `database-concepts`, mostra um sistema real de produção tomando de forma independente, ao usar B+Trees por padrão e tratar os índices hash como uma escolha estreita e opcional para campos genuinamente só de igualdade.

## Documentation Links

- [CMU 15-445/645: Indexes & Filters I Slides](https://15445.courses.cs.cmu.edu/fall2025/slides/08-indexes1.pdf): cobre as duas estruturas de índice lado a lado, sustentando a afirmação deste conceito de que a preservação da ordenação, e não a velocidade bruta de busca, é o fator decisivo entre elas.
- [Berkeley CS186: Course Notes (B+Trees, Hashing)](https://cs186berkeley.net/notes/): a comparação das notas do curso entre os trade-offs de B+Tree e de índice hash, sustentando o procedimento de decisão e os exemplos de carga de trabalho de igualdade vs. intervalo deste conceito.
