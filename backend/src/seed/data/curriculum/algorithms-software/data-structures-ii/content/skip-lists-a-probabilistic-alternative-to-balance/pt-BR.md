---
version: 1.0
updatedAt: 2026-09-13
title: Skip Lists: Uma Alternativa Probabilística ao Balanceamento
summary: Uma hierarquia de listas encadeadas ordenadas, onde cada nível superior "pula" mais elementos que o nível abaixo, atinge O(log n) esperado sem invariante de balanceamento e sem rotações, trocando garantia de pior caso por uma garantia probabilística muito favorável.
---
## Objetivos de Aprendizagem

- Descrever uma skip list como uma hierarquia de listas encadeadas ordenadas, onde cada nível mais alto "pula" mais elementos que o nível abaixo dele.
- Explicar como uma skip list atinge tempo de busca esperado O(log n) usando aleatoriedade em vez de um invariante de balanceamento mantido manualmente.
- Contrastar essa filosofia de design (aceitar aleatoriedade, ganhar balanceamento de graça em expectativa) com árvores AVL e rubro-negras (impor um invariante exato, pagar por isso com rotações).
- Enunciar por que William Pugh introduziu skip lists em 1990 explicitamente como uma alternativa a árvores balanceadas, e nomear a troca que essa alternativa faz.
- Identificar pelo menos um sistema em produção que escolhe skip lists em vez de uma árvore balanceada para uma estrutura ordenada.

## Contexto e Motivação

Os últimos conceitos desta disciplina responderam a uma pergunta de duas formas diferentes: como impedir que uma árvore binária de busca degrade para altura O(n), usando o fator de balanceamento numérico da AVL ou o invariante de cor da rubro-negra. As duas respostas compartilham um formato comum: acompanhar alguma informação extra em cada nó, e executar uma quantidade limitada, mas não nula, de lógica de rotação depois de cada inserção ou remoção para manter o invariante dessa informação satisfeito. Esse formato não é a única forma de resolver o problema subjacente, e vale ser honesto sobre seu custo: os dois esquemas exigem uma análise de casos correta e completamente trabalhada para inserção e remoção, e errar essa análise de casos é uma fonte real e bem documentada de bugs em implementações feitas do zero.

Em 1990, William Pugh publicou um artigo curto com um título que também serve de nome para este conceito: "Skip Lists: A Probabilistic Alternative to Balanced Trees" (Skip Lists: Uma Alternativa Probabilística a Árvores Balanceadas). Sua observação foi que uma estrutura muito mais simples, construída inteiramente com listas encadeadas simples comuns, atinge o mesmo desempenho esperado O(log n) de uma árvore balanceada, sem rotações, sem bits de cor, e sem nenhuma análise de casos, pagando por isso com um custo único e bem compreendido: abrir mão da garantia de *pior caso* e se contentar com uma garantia *esperada*, respaldada por uma probabilidade tão favorável que, na prática, não representa um risco real. Este conceito constrói a estrutura em si; os próximos dois derivam por que a aleatorização de fato entrega essa garantia e detalham as operações.

## Teoria Central

### A ideia: uma hierarquia de "vias expressas"

Uma **skip list** parte de algo já familiar: uma única lista encadeada simples e ordenada, o nível 0, contendo todos os elementos em ordem. Buscar apenas nessa lista custa O(n) no pior caso, exatamente como uma BST desbalanceada degenerada em uma linha. A correção é construir listas encadeadas adicionais sobre o nível 0, cada uma um subconjunto *mais esparso* do nível abaixo dela, cada uma ainda ordenada, cada uma conectada ao nível 0 por ponteiros verticais nos elementos que ela contém:

```
Nível 3:  HEAD ------------------------------------> 40 --------------------> NIL
Nível 2:  HEAD ----------------> 20 ----------------> 40 --------------------> NIL
Nível 1:  HEAD ------> 10 ----->  20 ----------------> 40 --------> 55 ------> NIL
Nível 0:  HEAD -> 5 -> 10 -> 15 -> 20 -> 25 -> 30 -> 35 -> 40 -> 45 -> 50 -> 55 -> NIL
```

O nível 0 tem todos os elementos. O nível 1 pula alguns. O nível 3 pula quase todos, funcionando como uma via expressa direta até um punhado de elementos "marco". Uma busca começa no canto superior esquerdo (a cabeça do nível mais alto) e repete uma regra simples: mover para a direita enquanto o próximo elemento do nível atual ainda for menor que o alvo, e descer um nível assim que mover para a direita ultrapassaria o alvo. Cada nível pelo qual se desce já descartou tudo à esquerda, então a busca nunca precisa voltar atrás, apenas mover para a direita e para baixo, até pousar no nível 0 no alvo (ou logo antes dele).

Essa é exatamente a mesma ideia de um índice remissivo no final de um livro: o nível 0 é o texto completo, e cada nível acima dele é um índice mais grosseiro apontando para o nível abaixo, permitindo que o leitor pule direto para a vizinhança certa em vez de escanear página por página.

### De onde vêm os níveis: uma moeda para cada elemento

O diagrama acima não é construído por nenhum planejamento cuidadoso e deliberado. Cada elemento, no momento em que é inserido, recebe um **nível** por meio de lançamentos de uma moeda honesta: ele sempre existe no nível 0, e enquanto a moeda continuar dando "promover" (cara, digamos), ele é adicionado também ao próximo nível acima, parando na primeira vez que a moeda der "parar" (coroa). Concretamente: o nível 0 sempre recebe o elemento; um lançamento de moeda honesta decide se ele também vai para o nível 1; se for, outro lançamento decide se ele também vai para o nível 2; e assim por diante. Isso significa que, em expectativa, metade de todos os elementos chega ao nível 1, um quarto chega ao nível 2, um oitavo chega ao nível 3, e assim por diante: exatamente a estrutura cada vez mais esparsa que o diagrama mostra, produzida por nada além de lançamentos de moeda independentes no momento da inserção, sem coordenação entre elementos e sem nenhuma etapa de rebalanceamento.

Como o nível de cada elemento é decidido uma única vez, de forma independente, e nunca revisitado, uma skip list nunca precisa "consertar" nada depois de uma inserção ou remoção da forma como uma rotação conserta um invariante quebrado de AVL ou rubro-negra. Não existe invariante para quebrar em primeiro lugar, apenas uma distribuição de probabilidade que, em expectativa, mantém a estrutura no formato que o diagrama mostra.

### Por que isso é chamado de "probabilístico", e não de "seleção aleatória de dados"

Vale ser preciso sobre o que a aleatoriedade está de fato fazendo aqui, já que é fácil confundir com ideias não relacionadas, como a escolha de pivô do quicksort randomizado. O quicksort randomizado usa aleatoriedade para evitar uma entrada de pior caso *adversarial*; uma skip list usa aleatoriedade para construir a *forma inteira da estrutura em si*. Os lançamentos de moeda não são uma defesa contra uma sequência hostil de inserções (não há nenhuma comparação sendo aleatorizada), eles são o mecanismo literal que decide, nível por nível, quais elementos existem onde. Uma skip list construída a partir do mesmo conjunto de elementos, inseridos na mesma ordem, terá uma forma estruturalmente diferente de uma execução para outra, puramente porque os lançamentos de moeda saíram diferentes, e isso é proposital: nenhum adversário, por mais cuidadosamente que escolha uma ordem de inserção, consegue forçar uma forma ruim, porque a forma nunca dependeu da ordem, apenas de lançamentos de moeda independentes que o adversário não pode prever ou controlar.

## Exemplos Resolvidos

### Exemplo 1: rastreando uma busca manualmente

**Problema:** Usando a skip list diagramada na Teoria Central, busque o valor `35`, listando cada movimento.

**Rastreamento:** Comece no nível 3, na cabeça. O próximo elemento no nível 3 é `40`, que é maior que `35`, então desça para o nível 2 sem mover para a direita. No nível 2, o próximo depois da cabeça é `20`, que é menor que `35`, então mova para a direita até `20`. A partir de `20` no nível 2, o próximo é `40`, maior que `35`, então desça para o nível 1. No nível 1, a partir de `20`, o próximo é `40`, ainda maior que `35`, então desça para o nível 0. No nível 0, a partir de `20`, o próximo é `25` (menor que `35`, mova para a direita), depois `30` (menor que `35`, mova para a direita), depois `35`: encontrado.

**Total de comparações:** 6 (três verificações de "maior, desça" e três de "menor, mova para a direita"), contra uma lista de 12 elementos, aproximadamente da ordem de log₂(12) ≈ 3,6 níveis de trabalho, em vez de até 12 comparações que uma varredura linear simples do nível 0 sozinho poderia custar.

### Exemplo 2: atribuindo níveis por lançamento de moeda durante a inserção

**Problema:** Um novo elemento, `27`, é inserido. Simule sua atribuição de nível dada a sequência de lançamentos cara, cara, coroa (lendo cada lançamento como "promover" para cara, "parar" para coroa).

**Rastreamento:** `27` sempre pousa no nível 0 (nenhum lançamento de moeda é necessário para isso). O primeiro lançamento (cara) o promove ao nível 1. O segundo lançamento (cara) o promove ao nível 2. O terceiro lançamento (coroa) interrompe a promoção: `27` não chega ao nível 3. Atribuição final de nível: `27` existe nos níveis 0, 1 e 2, e a operação de inserção da skip list (detalhada no próximo conceito) o encaixa na posição ordenada em cada um desses três níveis.

## Equívocos Comuns e Armadilhas

- **"A altura de uma skip list cresce sem limites conforme mais elementos são inseridos."** Em expectativa ela cresce como O(log n), o mesmo que uma árvore balanceada, porque cada nível adicional exige uma sequência de lançamentos de moeda exponencialmente menos provável (uma implementação real e prática também limita o nível máximo a aproximadamente log₂(n) para evitar desperdiçar espaço em níveis que nenhum elemento alcançará de forma realista).
- **"Já que os níveis são aleatórios, uma skip list não tem nenhuma garantia real de desempenho."** Ela tem uma garantia *probabilística*: O(log n) esperado para busca, inserção e remoção, com um pior caso de O(n) que é possível em princípio (toda moeda poderia dar "parar" imediatamente para todo elemento) mas tão extraordinariamente improvável para qualquer n realista que não é uma preocupação prática, exatamente no mesmo sentido em que o pior caso O(n²) do quicksort é uma possibilidade real que essencialmente nunca acontece com seleção de pivô randomizada.
- **"Skip lists e tabelas hash resolvem o mesmo problema."** Uma tabela hash troca ordem por velocidade (busca esperada O(1), mas nenhuma noção significativa de "a próxima chave maior"); uma skip list mantém os elementos totalmente ordenados (suportando consultas de intervalo, "encontre o próximo elemento depois de X," e iteração ordenada) ao custo de O(log n) em vez de busca esperada O(1). Elas não competem pelo mesmo trabalho; o conceito de encerramento desta disciplina retoma exatamente esse tipo de comparação de "para que cada estrutura de fato serve".
- **"Todo elemento que chega ao nível 1 foi especialmente escolhido para ser um bom marco."** Nenhuma seleção acontece além de lançamentos de moeda independentes; não existe noção de escolher elementos "importantes", e uma skip list construída a partir dos mesmos elementos em uma ordem de inserção diferente (ou com resultados de moeda diferentes) promoverá um subconjunto diferente, mas igualmente eficaz.

## Resumo

Uma skip list resolve o mesmo problema que árvores AVL e rubro-negras, mantendo busca, inserção e remoção em O(log n), usando um mecanismo inteiramente diferente: uma hierarquia de listas encadeadas ordenadas, onde o nível 0 contém todos os elementos e cada nível acima dele contém um subconjunto mais esparso, ainda ordenado, conectado por ponteiros verticais. Qual nível um elemento alcança é decidido uma única vez, na inserção, por uma sequência de lançamentos de moeda independentes (promover em cara, parar em coroa), produzindo uma estrutura balanceada em expectativa, sem invariante para manter e sem lógica de rotação para acertar. Isso troca uma garantia de pior caso por uma garantia probabilística respaldada por chances genuinamente favoráveis, o mesmo tipo de troca que o artigo de Pugh de 1990 deixou explícito no próprio título, e é exatamente a troca que sistemas em produção como os sorted sets do Redis fazem ao escolher uma skip list em vez de uma árvore balanceada para uma estrutura ordenada. O próximo conceito detalha busca, inserção e remoção mecanicamente; o seguinte deriva precisamente por que a altura esperada realmente é O(log n).

## Documentation Links

- [Pugh, W. (1990). "Skip Lists: A Probabilistic Alternative to Balanced Trees." Communications of the ACM.](https://epaperpress.com/sortsearch/download/skiplist.pdf): paper
- [Redis Documentation: Sorted Sets](https://redis.io/docs/latest/develop/data-types/sorted-sets/): doc
