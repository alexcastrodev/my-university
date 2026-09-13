---
version: 1.0
updatedAt: 2026-09-13
title: Altura Esperada de Skip Lists e Por Que a Aleatorização Funciona
summary: A probabilidade de um elemento alcançar o nível k é (1/2)^k, o que dá altura esperada Θ(log n) e custo de busca esperado O(log n), uma garantia sobre os lançamentos de moeda internos, não sobre a entrada, tornando o pior caso impossível de ser forçado por qualquer chamador.
---
## Objetivos de Aprendizagem

- Derivar a probabilidade de um dado elemento alcançar o nível `k`: exatamente (1/2)^k, diretamente do processo de lançamento de moeda independente.
- Derivar o número esperado de elementos no nível `k`, e usá-lo para argumentar que a altura esperada da skip list é O(log n).
- Enunciar, e dar a intuição para, o custo de busca esperado de O(log n), relacionando o número de níveis ao número de movimentos de "descer" que uma busca executa.
- Explicar precisamente sobre o que se está tirando a média quando o desempenho de uma skip list é chamado de "esperado": execuções repetidas com lançamentos de moeda independentes, não execuções repetidas sobre diferentes distribuições de entrada.
- Comparar as constantes envolvidas (em expectativa) com os limites de pior caso de árvores AVL e rubro-negras, e enunciar honestamente o que a aleatorização compra e o que ela custa.

## Contexto e Motivação

Os dois conceitos anteriores construíram a estrutura da skip list e detalharam completamente sua mecânica de busca, inserção e remoção, mas toda afirmação sobre desempenho até agora ("O(log n) esperado") foi apenas declarada, não derivada. Este conceito fecha essa lacuna com dois cálculos curtos e genuinamente esclarecedores: primeiro, exatamente quantos elementos se espera que alcancem um dado nível, o que explica por que o próprio número de níveis é esperado ser O(log n); e segundo, por que o custo de uma busca está diretamente ligado ao número de níveis, dando busca esperada O(log n) (e, já que inserção e remoção reaproveitam a mesma passada descendente, o mesmo limite esperado para elas também). Este é o mesmo estilo de raciocínio probabilístico já usado em outro lugar neste currículo para o tempo de execução esperado O(n log n) do quicksort randomizado, aplicado aqui à forma de uma estrutura de dados em vez da contagem de comparações de um algoritmo de ordenação.

## Teoria Central

### A probabilidade de um elemento alcançar o nível k

Relembre o processo de atribuição de nível: um elemento está sempre no nível 0, e para cada nível acima disso, um lançamento de moeda honesta independente decide se ele é promovido mais um nível (continuando em cara, parando em coroa). Alcançar o nível `k` (para `k ≥ 1`) exige que a moeda dê "promover" `k` vezes seguidas, um evento cuja probabilidade, já que cada lançamento é independente, é simplesmente o produto de `k` probabilidades individuais de um meio cada:

```
P(elemento alcança o nível k) = (1/2)^k
```

Isso é uma consequência direta do processo de lançamento de moeda definido no primeiro conceito deste tópico, não uma suposição adicional: é exatamente o mesmo raciocínio de perguntar "qual é a probabilidade de tirar cara quatro vezes seguidas", aplicado a "quantas vezes seguidas esse elemento é promovido".

### Número esperado de elementos no nível k

Com `n` elementos totais na skip list, e cada um independentemente alcançando o nível `k` com probabilidade `(1/2)^k`, a linearidade da esperança (somando a contribuição individual, possivelmente fracionária, de cada elemento para a contagem, sem precisar que os resultados dos elementos sejam relacionados de outra forma) dá o número esperado de elementos presentes no nível `k`:

```
E[elementos no nível k] = n · (1/2)^k
```

Isso mostra imediatamente por que os níveis encolhem geometricamente subindo: o nível 0 tem (em expectativa) todos os `n` elementos, o nível 1 tem `n/2`, o nível 2 tem `n/4`, e assim por diante, correspondendo exatamente à imagem de "via expressa" do primeiro conceito, agora respaldada por uma fórmula de fato em vez de apenas um diagrama.

### Por que a altura esperada é O(log n)

A altura da skip list é o nível mais alto que tem pelo menos um elemento nele. Igualando a contagem esperada `n · (1/2)^k` a uma pequena constante (digamos, 1) e resolvendo para `k`, obtém-se o nível em que a contagem esperada cai para cerca de um elemento:

```
n · (1/2)^k = 1
2^k = n
k = log₂ n
```

Isso é uma heurística, não uma prova rigorosa do limite (uma derivação totalmente rigorosa usa um limite de cauda apropriado sobre o máximo de `n` variáveis aleatórias geométricas, o que é padrão mas mais elaborado do que esta disciplina precisa reproduzir por completo), mas identifica corretamente a quantidade chave e sua ordem: a altura esperada de uma skip list construída a partir de `n` elementos é Θ(log n), a mesma ordem da altura de *pior caso* de uma árvore AVL ou rubro-negra, alcançada aqui puramente através do processo de lançamento de moeda, sem contabilidade, sem rotações, e sem invariante para verificar.

### Por que o custo de busca esperado também é O(log n)

Uma busca, como detalhado no conceito anterior, faz exatamente uma de duas coisas a cada passo: mover para a direita no nível atual, ou descer um nível. O número de movimentos de "descer" ao longo de uma busca inteira é limitado pela própria altura da skip list, no máximo uma descida por nível, então essa contagem é O(log n) pelo argumento de altura recém dado. O número de movimentos de "mover para a direita" é limitado, em expectativa, por uma pequena constante por nível: intuitivamente, uma vez que uma busca desceu para um dado nível, ela só pode ter chegado logo depois do último elemento "marco" que aquele nível promoveu do nível abaixo, então em média são necessários apenas um pequeno número constante de movimentos para a direita antes de encontrar o alvo ou precisar descer novamente (esse é o mesmo raciocínio de distribuição geométrica usado para derivar o número esperado de elementos em cada nível, aplicado aqui a "quão longe à direita antes que o próximo elemento promovido apareça"). Combinar um limite O(log n) em descidas com um limite esperado O(1) por nível em movimentos para a direita dá um custo de busca esperado geral de O(log n), e como inserção e remoção reaproveitam essa mesma passada descendente (como mostrou o conceito anterior), elas herdam o mesmo limite esperado O(log n).

### Sobre o que "esperado" de fato tira a média

Vale ser preciso sobre a aleatoriedade sendo mediada aqui, já que é um ponto comum de confusão. O limite esperado O(log n) de uma skip list é uma média sobre os lançamentos de moeda que a própria implementação da skip list faz internamente, no momento da inserção, não uma média sobre diferentes entradas possíveis ou ordens de inserção. Isso significa que o limite vale *independentemente de quais valores são inseridos ou em que ordem*, em contraste marcante com uma BST comum e desbalanceada, cujo pior caso O(n) é especificamente disparado por uma *entrada* azarada (inserção em ordem crescente), algo que um chamador hostil ou azarado pode de fato causar. Nenhum chamador, por mais adversarial que seja, consegue forçar uma skip list ao seu pior caso O(n) (teoricamente possível, mas extremamente improvável), porque esse pior caso exigiria que os próprios lançamentos de moeda internos da skip list conspirassem contra ela, algo inteiramente fora do controle de qualquer chamador. Essa é exatamente a mesma garantia que o limite esperado O(n log n) do quicksort randomizado oferece contra ordenações de entrada adversariais, aplicada aqui à forma de uma estrutura de dados em vez das escolhas de pivô de um algoritmo de ordenação.

## Exemplos Resolvidos

### Exemplo 1: calculando populações esperadas de nível para n = 1.000.000

**Problema:** Para uma skip list contendo n = 1.000.000 elementos, calcule o número esperado de elementos nos níveis 0, 10 e 20, e a altura esperada.

**Nível 0:** E = 1.000.000 · (1/2)^0 = 1.000.000 (todo elemento, como esperado).

**Nível 10:** E = 1.000.000 · (1/2)^10 = 1.000.000 / 1024 ≈ 976,6 elementos.

**Nível 20:** E = 1.000.000 · (1/2)^20 = 1.000.000 / 1.048.576 ≈ 0,95 elementos, já próximo do limiar de "cerca de um elemento" usado para estimar a altura.

**Altura esperada:** k = log₂(1.000.000) ≈ 19,9, consistente com o cálculo do nível 20 mostrando que a contagem esperada acabou de cair abaixo de um elemento ali, correspondendo precisamente à afirmação O(log n) para esse n.

### Exemplo 2: comparando com o limite rubro-negro para o mesmo n

**Problema:** Compare a altura esperada dessa skip list (≈20, do Exemplo 1) com o limite de altura de pior caso da árvore rubro-negra para o mesmo n = 1.000.000 (calculado em um conceito anterior como ≈40).

**Comparação:** A altura *esperada* da skip list (≈20) é notavelmente menor que o limite de altura de *pior caso* da árvore rubro-negra (≈40) para o mesmo n, embora essa não seja bem uma comparação direta: uma é uma cifra de caso médio e a outra um limite superior garantido. O que é diretamente comparável é a ordem de crescimento: ambas são Θ(log n), e ambas, na prática, entregam desempenho rápido e previsível para cargas de trabalho reais desse tamanho, alcançado através de mecanismos inteiramente diferentes (lançamentos de moeda versus invariantes impostos).

## Equívocos Comuns e Armadilhas

- **"O(log n) esperado significa que a skip list é geralmente mais rápida que uma árvore rubro-negra."** Os dois limites medem coisas diferentes (altura esperada com pior caso ilimitado mas improvável, versus altura de pior caso garantida) e não são diretamente comparáveis da forma enunciada; a comparação numérica do Exemplo 2 é ilustrativa para um n específico, não uma afirmação geral de que uma estrutura é "mais rápida" que a outra em todos os casos.
- **"O limite de altura O(log n) é derivado da mesma forma rigorosa que o limite de Fibonacci da AVL."** A derivação neste conceito é uma heurística (igualar a contagem esperada a uma constante e resolver), capturando corretamente a ordem de crescimento mas não sendo um limite de alta probabilidade totalmente rigoroso; uma derivação completa existe na literatura (via limites de cauda ao estilo Chernoff) mas está além do que este conceito precisa para estabelecer a intuição chave.
- **"Desempenho esperado significa que a skip list se comporta de forma inconsistente de execução para execução de um jeito que importa na prática."** A expectativa é sobre lançamentos de moeda internos com uma distribuição de probabilidade tão concentrada em torno de log n (para qualquer n razoavelmente grande) que as alturas observadas variam muito pouco de execução para execução na prática; não é o mesmo tipo de imprevisibilidade que, digamos, cache misses ou pausas de garbage collection.
- **"Já que a busca é O(log n) esperado, toda busca individual também é, sempre."** Qualquer busca individual poderia, em um pior caso extremamente improvável, levar O(n) (se os lançamentos de moeda acontecessem de produzir uma estrutura quase inteiramente achatada sem níveis superiores significativos); "esperado" descreve a média sobre o processo de construção aleatório, não uma garantia por chamada.

## Resumo

Todo elemento alcança o nível k com probabilidade (1/2)^k, uma consequência direta de precisar de k lançamentos de moeda "promover" consecutivos, e a linearidade da esperança transforma isso em uma contagem esperada de n·(1/2)^k elementos no nível k. Igualar essa contagem a uma pequena constante e resolver mostra que a altura esperada da skip list é Θ(log n), e como o custo de uma busca é limitado por essa altura (descidas) mais uma pequena constante por nível (movimentos para a direita), busca, inserção e remoção herdam todas um custo esperado O(log n). Crucialmente, essa expectativa é tomada sobre os próprios lançamentos de moeda internos da skip list, não sobre a entrada ou a ordem de inserção, então nenhum chamador, adversarial ou não, consegue forçar o pior caso O(n) (teoricamente possível, mas exponencialmente improvável), a mesma garantia que o quicksort randomizado oferece para ordenação. Isso encerra o argumento a favor de skip lists como uma alternativa genuína e fundamentada a árvores AVL e rubro-negras: mesma ordem esperada de crescimento, mecânica radicalmente mais simples, ao custo de uma garantia de pior caso trocada por uma garantia probabilística extraordinariamente favorável.

## Documentation Links

- [Pugh, W. (1990). "Skip Lists: A Probabilistic Alternative to Balanced Trees." Communications of the ACM.](https://epaperpress.com/sortsearch/download/skiplist.pdf): paper
- [Stanford CS166 - Data Structures](https://web.stanford.edu/class/cs166): doc
