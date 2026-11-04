---
version: 1.0
updatedAt: 2026-11-04
title: "FP-Growth"
summary: "Mineração de itemsets frequentes sem geração de candidatos: construção da FP-tree com uma ordem fixa de itens, mineração por bases de padrões condicionais e medição de quando isso vence o Apriori e de quando a árvore deixa de comprimir."
---
## Objetivos de Aprendizagem

- Construir à mão uma FP-tree e sua tabela de cabeçalho a partir de uma ordem fixa de itens, com desempate declarado.
- Minerar a árvore por bases de padrões condicionais e explicar por que cada itemset frequente é encontrado exatamente uma vez.
- Mostrar num conjunto pequeno que FP-Growth, Apriori, força bruta e `mlxtend` devolvem o mesmo conjunto.
- Dizer o que limita o tamanho da árvore e o que não limita, e quando a árvore deixa de comprimir.
- Separar algoritmo de implementação numa comparação de tempos.

## Contexto e Motivação

`frequent-itemsets-and-the-apriori-algorithm` deixou dois custos no Apriori: uma passada pelos dados por nível e um conjunto de candidatos que pode ficar grande muito antes da saída. O FP-Growth (Han, Pei e Yin, 2000) elimina a geração de candidatos. Ele percorre os dados duas vezes para montar uma árvore de prefixos e depois faz os padrões crescerem por recursão sobre essa árvore. Esta lição usa as 10 vagas de emprego daquela lição, minsup 3 e sua notação $\sigma$ para contagens de suporte. A mineração é exploratória, sem divisão entre treino e teste.

## Teoria Central

### A FP-tree

Uma **FP-tree** tem uma raiz nula, e cada outro nó guarda um item, uma contagem e um **node-link** para o próximo nó do mesmo item. A **tabela de cabeçalho** tem uma entrada por item frequente, apontando para o primeiro nó da lista encadeada daquele item. A construção faz duas varreduras:

1. Na primeira, conte os itens, descarte os infrequentes e fixe uma ordem global.
2. Na segunda, ordene os itens frequentes de cada transação por essa ordem e insira a lista ordenada a partir da raiz. Prefixos comuns reaproveitam nós e somam às suas contagens, e um sufixo novo cria nós novos.

A contagem de um nó é o número de transações cuja lista ordenada passa por ele.

### A ordem e seu desempate

O artigo ordena os itens por suporte decrescente e lista os empates de seu exemplo sem regra declarada. Esta lição fixa a regra: **$\sigma$ decrescente, empates em ordem alfabética**. A regra precisa ser explícita porque outro desempate dá outra árvore. A correção exige uma ordem por árvore: todos os caminhos de uma árvore, inclusive das condicionais, seguem a mesma ordem. Uma árvore condicional pode ter ordem própria, como mostra a Variante abaixo, desde que a recursão percorra os itens daquela árvore de baixo para cima.

A ordem decrescente é uma heurística para aumentar o compartilhamento, pois itens frequentes perto da raiz têm mais chance de cair em prefixos comuns. Ela não garante a menor árvore. Para as transações `abc`, `bc`, `a`, `acd`, `cd`, `acd` com minsup 1, a ordem por suporte c, a, d, b dá 7 nós, enquanto c, d, b, a dá 6.

### Tamanho da árvore

**Lema 2.2 do artigo.** Sem contar a raiz, o número de nós é no máximo o total de ocorrências de itens frequentes na base, e a altura é no máximo o maior número de itens frequentes numa transação.

Cada transação acrescenta no máximo um nó por item frequente, o que dá as duas cotas. Assim, a árvore nunca é exponencial nos dados, e nesse sentido estrito ela é segura. A cota conta nós, não bytes, e um nó é bem maior que uma entrada numa lista de transações. Ele também não diz nada sobre a recursão que vem depois.

### Mineração: bases de padrões condicionais

Percorra os itens de baixo para cima na ordem. Para um item $i$:

1. Siga seus node-links. Para cada nó, o caminho da raiz até o pai dele, com a contagem do nó, é uma entrada da **base de padrões condicional** de $i$.
2. Conte os itens da base, com essas contagens como pesos, e fique com os que alcançam minsup. Construa com eles uma **FP-tree condicional**.
3. Informe $\{i\}$ com seu suporte e faça a recursão na árvore condicional, com $i$ anexado a tudo que for encontrado.

**Crescimento por fragmentos (Lema 3.1).** Se $\alpha$ é um itemset, $B$ é sua base de padrões condicional e $\beta$ é um itemset em $B$, então $\sigma_D(\alpha\cup\beta)=\sigma_B(\beta)$. Isso vale porque $B$ reúne exatamente as ocorrências de $\alpha$ com os itens acima dele. Por consequência, $\alpha\cup\beta$ é frequente em $D$ exatamente quando $\beta$ é frequente em $B$.

Com uma ordem global, cada itemset frequente é informado uma vez: seu último item nessa ordem escolhe o primeiro ramo da recursão, o penúltimo escolhe o segundo, e assim por diante. O artigo tem também um atalho que enumera diretamente uma árvore de caminho único (Lema 3.2). A execução passo a passo abaixo não o usa, para que todo passo apareça.

Nada é gerado e testado, mas o trabalho mudou de lugar em vez de sumir: se $2^m-1$ itemsets são frequentes, a recursão ainda precisa informar todos.

**Variante.** Esta lição mantém a ordem global dentro das árvores condicionais. O `mlxtend` reordena cada árvore condicional pelas contagens locais. As árvores diferem, e o conjunto minerado não.

## Exemplos Resolvidos

### Exemplo 1: construindo a árvore

As contagens de itens são D 8, S 8, K 7, J 6, P 4 e G 1. G é descartado. D e S empatam, e a regra alfabética põe D primeiro, então a ordem é **D, S, K, J, P**. Listas ordenadas:

```text
T1  D S K J      T6   D S K
T2  D S K J P    T7   D P
T3  D S K J      T8   D S
T4  D J P        T9   S K J P
T5  D S K        T10  S K J
```

Inseri-las nessa sequência dá a árvore e a tabela de cabeçalho:

```text
root
|-- D:8
|   |-- S:6
|   |   `-- K:5
|   |       `-- J:3
|   |           `-- P:1
|   |-- J:1
|   |   `-- P:1
|   `-- P:1
`-- S:2
    `-- K:2
        `-- J:2
            `-- P:1

item  support  node-link chain (node counts)
D     8        8
S     8        6, 2
K     7        5, 2
J     6        3, 1, 2
P     4        1, 1, 1, 1
```

As contagens de cada cadeia somam o suporte do item, o que serve de conferência rápida. São 12 nós para 33 ocorrências de itens frequentes, razão de 2,75.

O desempate muda a árvore. Com S antes de D, a raiz tem `S:8` e `D:2` como filhos, ainda com 12 nós nestes dados. A ordem crescente P, J, K, D, S dá 18 nós. Entre as 120 ordens dos cinco itens, o número de nós vai de 12 a 18, e as ordens por suporte decrescente alcançam o mínimo aqui. Como mostra o exemplo do `abc`, esse resultado não é garantido.

### Exemplo 2: minerando a árvore

De baixo para cima, com minsup 3:

```text
suffix  sigma  conditional pattern base          items kept     found next
P       4      DSKJ:1  DJ:1  D:1  SKJ:1          D:3 J:3        JP, DP
JP      3      D:2                               none (D:2)     nothing
DP      3      empty                                            nothing
J       6      DSK:3  D:1  SK:2                  D:4 S:5 K:5    JK, JS, DJ
JK      5      DS:3  S:2                         D:3 S:5        JKS, DJK
JKS     5      D:3                               D:3            DJKS
DJKS    3      empty                                            nothing
DJK     3      empty                                            nothing
JS      5      D:3                               D:3            DJS
DJS     3      empty                                            nothing
DJ      4      empty                                            nothing
K       7      DS:5  S:2                         D:5 S:7        KS, DK
KS      7      D:5                               D:5            DKS
DKS     5      empty                                            nothing
DK      5      empty                                            nothing
S       8      D:6                               D:6            DS
DS      6      empty                                            nothing
D       8      empty                                            nothing
```

Cada uma das 18 linhas informa um itemset. A linha JP é onde aparece o DJP do Apriori: na base de JP, D tem contagem 2, então DJP para ali. O Apriori gerou esse candidato e o contou numa passada, enquanto aqui é uma soma sobre uma lista curta. A primeira linha também mostra que a base de `P` tem K:2 e S:2, abaixo de 3. São os infrequentes KP e PS da execução do Apriori.

### Exemplo 3: o mesmo conjunto

O FP-Growth acima, o Apriori, uma varredura por força bruta dos 63 subconjuntos e `mlxtend.frequent_patterns.fpgrowth(df, min_support=0.3)` da versão 0.25.0 devolvem os mesmos 18 itemsets com as mesmas contagens. Nestes dados, o `mlxtend` põe S acima de D, ou seja, desempata ao contrário e constrói outra árvore com a mesma saída. Um desempate afeta a árvore e nunca a resposta.

### Exemplo 4: tempos em conjuntos nomeados

Quatro arquivos do repositório FIMI, sem filtro: `chess` (3.196 transações, 75 itens, 37 por transação), `connect` (67.557, 129, 43), `mushroom` (8.124, 119, 23) e `T10I4D100K` (100.000, 870, cerca de 10). As duas funções vêm do `mlxtend` 0.25.0, com Python 3.13.5 e NumPy 2.5.4 num Apple M1 Pro e um DataFrame booleano denso. Cada entrada é a mediana de 3 processos novos, sem o tempo de carga. Em cada linha, as duas funções devolveram itemsets idênticos. As duas últimas colunas são contagens, independentes de máquina e biblioteca: "counted" são os candidatos do Apriori com suporte calculado e "ratio" é definido no Exemplo 5.

```text
dataset      minsup  itemsets  apriori s  fpgrowth s  counted  ratio
chess        0.90    622       0.009      0.018       747      245
chess        0.85    2669      0.024      0.028       2892     141
chess        0.80    8227      0.088      0.054       8632     79
chess        0.75    20993     0.273      0.109       21736    35
connect      0.95    2201      0.194      0.370       2453     8053
connect      0.90    27127     3.179      0.490       27522    6142
mushroom     0.30    2735      0.041      0.053       3150     68
T10I4D100K   0.02    155       2.123      0.810       12805    2.11
T10I4D100K   0.01    385       17.130     1.614       70996    1.55
T10I4D100K   0.005   1073      40.193     2.107       162690   1.45
```

O Apriori venceu 4 das 10 linhas, todas em arquivos densos com menos de 3.000 itemsets, onde há poucos candidatos, embora as margens em `chess` sejam de milissegundos. O FP-Growth venceu o resto, por 19 vezes na última linha, e sua vantagem cresceu conforme o suporte caiu em `chess` e `T10I4D100K`. O resultado também fala destas implementações: o Apriori do `mlxtend` gera candidatos em Python puro e os conta com aritmética de colunas em NumPy, e seu `fpgrowth` é uma árvore em Python puro, então outro par de implementações mudaria esses números. O artigo relatou o FP-Growth cerca de uma ordem de grandeza mais rápido que o Apriori em bases grandes, com seus conjuntos sintéticos T25:I10:D10K e T25:I20:D100K e código próprio em C++ num PC Pentium de 450 MHz. Essa é outra medição, e as duas não devem ser lidas como um único resultado.

### Exemplo 5: quando a árvore deixa de comprimir

Defina a **razão** como as ocorrências de itens frequentes divididas pelos nós da árvore, com a ordem do Exemplo 1 e empates resolvidos pelo id do item. A última coluna inverte essa ordem.

```text
dataset      minsup  occurrences  nodes    ratio    nodes, ascending order
connect      0.50    2219609      5715     388.38   49471
chess        0.75    66700        1898     35.14    4748
retail       0.01    236563       31035    7.62     56531
retail       0.005   327499       106286   3.08     173049
T10I4D100K   0.02    482909       229245   2.11     246108
T10I4D100K   0.005   936679       646062   1.45     702753
```

`retail` é o arquivo do FIMI com 88.162 transações e 16.470 itens, não cronometrado acima. O artigo apresenta o Connect-4 a 50% como vitrine, com 2.219.609 ocorrências e 13.449 nós, razão de 165,04. O arquivo `connect` do FIMI, com as mesmas 67.557 transações, dá a mesma contagem de ocorrências, mas 5.715 nós numa árvore por suporte decrescente. Não há empates entre seus 38 itens frequentes, e uma contagem direta de prefixos distintos confirma esse número. A causa da diferença não é conhecida, pois o artigo não traz código, e sem empates a ordem aqui é forçada. Os dois resultados mostram compressão de duas ordens de grandeza.

A árvore deixa de comprimir quando as transações compartilham poucos prefixos: muitos itens, transações curtas e limiar baixo. Os próprios autores notam: "for databases with mostly short transactions, the reduction ratio is not that high." Em `T10I4D100K` a 0,005 há 69 nós para cada 100 ocorrências. Um nó guarda pelo menos um item, uma contagem, um node-link e um ponteiro para o pai, contra um inteiro por ocorrência numa lista simples. Assim, como inferência a partir desses campos e não como resultado do artigo, uma razão abaixo de 4, mais ou menos, significa que a árvore gasta mais memória que a lista que ela substitui.

Compressão e velocidade são questões separadas. `chess` a 0,90 tem razão 245 e o Apriori venceu, enquanto `T10I4D100K` a 0,005 tem razão 1,45 e o FP-Growth venceu por 19 vezes. Os dois contam quase os mesmos pares: 160.648 dos 161.596 pares de itens frequentes coocorrem pelo menos uma vez, e o primeiro nível da recursão do FP-Growth mantém uma contagem exatamente para esses. Como inferência a partir dessas contagens, a diferença é o custo de cada contagem: um par de colunas de 100.000 linhas no Apriori, contra 4,1 milhões de incrementos no total ao longo dos caminhos da árvore. A memória também entra nesse número. O `mlxtend` avalia os 161.596 pares num único `np.all(X[:, combin], axis=2)`, cerca de 32 GB de dados booleanos no M1 Pro de 16 GB. Com minsup 0,02, a mesma expressão precisa de 2,4 GB por essa conta, e o processo teve pico de 2,7 GB. Assim, as linhas de 17 s e 40 s incluem pressão de memória, e as 19 vezes valem para esta execução. Se a árvore não couber na memória, a resposta do próprio artigo é particionar a base, e `mining-at-scale-from-mapreduce-to-spark` retoma esse ponto.

## Equívocos Comuns e Armadilhas

- **"O FP-Growth sempre vence o Apriori."** Ele perdeu 4 de 10 linhas no Exemplo 4, com estas implementações.
- **"A árvore é sempre pequena."** Em `T10I4D100K` a 0,005 ela tem 646.062 nós para 936.679 ocorrências.
- **"Boa compressão significa FP-Growth mais rápido."** O Exemplo 5 mostra o par oposto.
- **"Empates na ordem podem ser ignorados."** Eles mudam a árvore, e uma execução sem regra não pode ser reproduzida. Não mudam o conjunto minerado.
- **"Sem candidatos significa tempo polinomial."** A saída pode ter $2^m-1$ itemsets, e a recursão precisa informar cada um.

## Resumo

O FP-Growth guarda a parte frequente de cada transação numa árvore de prefixos construída em duas varreduras, com uma ordem fixa de itens, aqui suporte decrescente com empates alfabéticos. Depois minera de baixo para cima por bases de padrões condicionais, apoiado no fato de que o suporte de $\alpha\cup\beta$ na base de dados é igual ao suporte de $\beta$ na base condicional de $\alpha$. Nos dados da lição, achou os mesmos 18 itemsets do Apriori, da força bruta e do `mlxtend`, a partir de uma árvore de 12 nós. O tamanho da árvore tem como cota as ocorrências de itens frequentes, e dados esparsos chegam mais perto dessa cota: 69% dela em `T10I4D100K` a 0,005, contra cerca de 0,26% em `connect` a 0,50, com limiares diferentes. Os tempos em conjuntos nomeados se dividiram nos dois sentidos e a compressão não previu o vencedor, então a comparação precisa ser medida nos dados e na implementação em uso.

## Documentation Links

- [Han, Pei e Yin (2000), Mining Frequent Patterns without Candidate Generation](https://hanj.cs.illinois.edu/pdf/sigmod00.pdf): definição da FP-tree, lemas, FP-growth, os números do Connect-4 e o estudo de desempenho.
- [Zaki e Meira, Data Mining and Machine Learning, capítulo 8](https://dataminingbook.info/book_html/chap8/book.html): construção da FP-tree e o método de projeção do FPGrowth.
- [mlxtend, fpgrowth](https://rasbt.github.io/mlxtend/user_guide/frequent_patterns/fpgrowth/): a função usada nos Exemplos 3 e 4.
- [mlxtend, apriori](https://rasbt.github.io/mlxtend/user_guide/frequent_patterns/apriori/): a função comparada no Exemplo 4.
- [Frequent Itemset Mining Dataset Repository](https://fimi.uantwerpen.be/data/): os arquivos `chess`, `connect`, `mushroom`, `retail` e `T10I4D100K`.
