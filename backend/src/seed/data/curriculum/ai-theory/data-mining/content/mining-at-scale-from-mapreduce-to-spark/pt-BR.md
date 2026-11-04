---
version: 1.0
updatedAt: 2026-11-04
title: "Mineração em Escala: de MapReduce a Spark"
summary: "O que muda quando padrões e clusters não cabem mais na memória: rodadas de MapReduce, o modelo em memória do Spark, mineração paralela de padrões frequentes e k-means. Mahout aparece só como nota de livro vs hoje."
---
## Objetivos de Aprendizagem

- Contar rodadas de MapReduce e jobs de Spark para A-Priori, SON, PFP e k-means, e ler uma contagem de jobs corretamente.
- Implementar SON em Spark, provar que ele não tem falsos negativos e mostrar a prova falhando sem sua hipótese.
- Manter SON e PFP separados: um divide as cestas, o outro divide o espaço de busca.
- Descrever o que `FPGrowth` e `KMeans` do MLlib executam, e o que o modo local não consegue medir.

## Contexto e Motivação

`frequent-itemsets-and-the-apriori-algorithm`, `fp-growth` e `k-means-clustering` supõem que os dados cabem em uma máquina. Uma coisa que quebra é a memória: Mining of Massive Datasets (MMDS) dá $2n^2$ bytes para um arranjo triangular de contagens de pares sobre $n$ itens, com 4 bytes por contagem, então um milhão de itens pede cerca de 2 TB antes de qualquer poda. A outra são as passagens: o tempo de execução é proporcional às passagens vezes o tamanho do arquivo.

`the-mapreduce-programming-model` roda uma passagem em muitas máquinas, e `mapreduce-fault-tolerance-locality-and-stragglers` mostra como ela sobrevive a falhas. Esta lição conta as passagens de cada algoritmo e pergunta o que muda quando elas compartilham memória.

## Teoria Central

### Rodadas, jobs e stages

Uma **rodada de MapReduce** é um job no sentido de `the-mapreduce-programming-model`: map, shuffle, reduce e saída no sistema de arquivos. Um **job de Spark** é uma unidade de trabalho que uma ação submete, em geral uma por ação, embora algumas submetam mais (`takeSample` conta antes de amostrar). Um job se divide em **stages** a cada shuffle. Assim, uma rodada costuma corresponder a um job de dois stages, e um `count` sem shuffle é um job de um stage.

### O modelo em memória do Spark

Zaharia et al. (2012) colocam o problema: na maioria dos frameworks da época, "the only way to reuse data between computations (e.g., between two MapReduce jobs) is to write it to an external stable storage system". Um RDD é uma coleção particionada construída por transformações de granularidade grossa. O Spark as registra como **linhagem**, então uma partição perdida é recalculada a partir das de origem, a mesma ideia de rodar de novo uma tarefa de map a partir do seu pedaço de entrada, estendida a uma cadeia de etapas. `cache()` guarda um RDD calculado em memória para jobs seguintes.

**Livro vs hoje.** Os speedups desse artigo pertencem à sua configuração: Hadoop 0.20.2, 100 GB, 2012. Depois da primeira iteração, em 100 máquinas, o Spark foi 25,3 vezes mais rápido que o Hadoop em regressão logística, e em k-means, em que a computação domina o tempo de iteração, de 1,9 a 3,2 vezes.

### SON: dividir as cestas

O MMDS atribui o nome SON a Savasere, Omiecinski e Navathe e dá sua forma em MapReduce, com duas passagens. Um pedaço com fração $p$ das cestas é minerado em memória com limiar $ps$. A união dos resultados locais é o **conjunto de candidatos**, e uma segunda passagem conta cada candidato em todas as cestas.

**Teorema (sem falsos negativos).** Suponha que os pedaços particionem as cestas, que o pedaço $i$ tenha limiar $t_i$ com $\sum_i t_i\le s$ e que cada pedaço seja minerado por completo. Então todo itemset com contagem total de pelo menos $s$ é candidato.

*Prova.* Se $I$ não é candidato, então $c_i<t_i$ em cada pedaço, logo $\sum_i c_i<\sum_i t_i\le s$. $\square$

A primeira passagem pode gerar falsos positivos, e esse é o motivo da segunda. O Exemplo 1 quebra a hipótese dos limiares.

### PFP: dividir o espaço de busca

PFP (Li et al., 2008) divide o trabalho de mineração, não as cestas, em três fases de MapReduce. A primeira conta os itens e produz a F-list, ordenada por frequência, e os itens são então divididos em grupos em um computador só. Na segunda, com cada cesta na ordem da F-list, como na Figura 1 do artigo, o mapper emite para cada grupo presente o prefixo que termina no item mais à direita daquele grupo. Cada reducer constrói uma FP-tree e faz crescer só os padrões dos seus itens, guardando os $K$ de maior suporte. A terceira fase os agrega num top $K$ por item.

**Por que não é preciso verificar.** Um padrão pertence ao grupo do seu item mais raro $x$, o sufixo. Toda cesta que contém o padrão envia a esse grupo um prefixo que chega pelo menos até $x$, o que mantém todos os itens do padrão, então a contagem achada ali é a verdadeira. A hipótese é uma única ordem global de itens, e é por isso que a contagem precisa terminar antes.

| | SON | PFP |
|---|---|---|
| O que é dividido | cestas em pedaços | espaço de busca em grupos de itens |
| Limiar numa tarefa | reduzido para $ps$ | o $s$ global no Spark; o reducer do artigo guarda um top $K$ |
| O que a tarefa devolve | candidatos, talvez falsos | padrões finais com contagens finais |
| Passagem de verificação | obrigatória | nenhuma |
| Rodadas de MapReduce | 2 | 3 no artigo |

### O que o MLlib executa

**FPGrowth.** O guia do Spark diz: "PFP distributes the work of growing FP-trees based on the suffixes of transactions". O código do Spark 4.3.0 difere do artigo: um grupo é a posição do item módulo o número de partições, um padrão é mantido quando seu item sufixo pertence à partição, e não há heap de top-$K$ nem rodada de agregação. Voltam todos os padrões que atingem $\lceil\text{minSupport}\cdot n\rceil$.

**KMeans.** O guia do Spark diz: "The MLlib implementation includes a parallelized variant of the k-means++ method called kmeans||." Cada iteração de Lloyd é um shuffle. k-means++ precisa de $k$ passagens, uma por centro. Bahmani et al. (2012) amostram cada ponto com probabilidade $\ell\,d^2(x,C)/\phi_X(C)$, com $\phi_X(C)$ o custo total sob os centros atuais, o que acrescenta cerca de $\ell$ centros por rodada, e depois reagrupam os centros com pesos até sobrarem $k$. A garantia deles leva $O(\log\psi)$ rodadas, com $\psi$ o custo inicial, e eles relatam que poucas bastam na prática. Os defaults do Spark diferem: na versão 4.3.0, `initSteps` é 2, $\ell$ é $2k$ e o reagrupamento é um k-means++ com pesos no driver.

### Livro vs hoje: Apache Mahout

O código antigo do Mahout, nas palavras do site, é o "Mahout Classic (Samsara and MapReduce) codebase", que "is in maintenance mode". Em novembro de 2026, o site diz que o trabalho do projeto "centers on quantum machine learning in Python", seu blog anunciou o QuMat v0.6.0 em junho de 2026, e o Apache Attic não o lista. Um livro que apresenta o Mahout como biblioteca de mineração com MapReduce descreve aquele código antigo.

## Exemplos Resolvidos

Tudo rodou em Spark 4.3.0 com configurações default em `local[4]`, com Java 21 e Python 3.13.5.

### Exemplo 1: SON em Spark, e como quebrá-lo

Doze cestas em dois pedaços de seis, limiar global $s=4$, então cada pedaço usa 2:

```python
import itertools
from collections import Counter
from operator import add
from pyspark.sql import SparkSession

spark = SparkSession.builder.master("local[4]").getOrCreate()
sc = spark.sparkContext
B = [["bread", "eggs", "tea"], ["coffee", "sugar"], ["bread", "milk", "sugar"],
     ["bread", "coffee", "tea"], ["bread", "coffee", "tea"], ["coffee", "sugar"],
     ["eggs", "coffee", "sugar"], ["bread", "eggs", "coffee", "tea"], ["milk", "tea"],
     ["milk", "sugar"], ["bread", "coffee", "tea"], ["eggs", "coffee", "tea"]]

def frequent(baskets, t):
    baskets = [set(b) for b in baskets]
    counts = Counter(i for b in baskets for i in b)
    level, out = {(i,): c for i, c in counts.items() if c >= t}, {}
    while level:
        out.update(level)
        items = sorted({i for c in level for i in c})
        k = len(next(iter(level))) + 1
        cands = [c for c in itertools.combinations(items, k)
                 if all(x in level for x in itertools.combinations(c, k - 1))]
        level = {c: n for c in cands if (n := sum(set(c) <= b for b in baskets)) >= t}
    return out

def son(rdd, n, s):
    def local(chunk):
        chunk = list(chunk)
        return frequent(chunk, len(chunk) * s / n).keys()
    cand = rdd.mapPartitions(local).distinct().collect()
    pairs = rdd.flatMap(lambda b: [(c, 1) for c in cand if set(b).issuperset(c)])
    return cand, pairs.reduceByKey(add).filter(lambda kv: kv[1] >= s).collectAsMap()

sc.setJobGroup("son", "")
cand, final = son(sc.parallelize(B, 2), 12, 4)
print(len(sc.statusTracker().getJobIdsForGroup("son")), len(cand), len(final),
      final == frequent(B, 4))
```

```text
2 14 9 True
```

São 2 jobs (4 stages), 14 candidatos e 9 itemsets frequentes, igual à mineração exata. Um dos 5 falsos positivos é `milk`, com contagem 2 no segundo pedaço e contagem total 3.

**Limiares que somam mais que $s$.** Mantenha 4 em cada pedaço, de modo que somem 8. Os candidatos caem para 3, e 6 dos 9 itemsets frequentes se perdem, entre eles `eggs`, com contagens 1 e 3 nos dois pedaços. Nenhuma segunda passagem recupera o que a primeira nunca propôs.

**Ordem.** Os falsos positivos dependem dos pedaços. As mesmas cestas dão 14 candidatos como listadas, 15 com `sorted(B)` e 17 com `random.Random(1).sample(B, 12)`, todos exatos. A ordem aleatória não ajudou aqui, então estas execuções mostram só que a contagem muda com os pedaços.

### Exemplo 2: PFP à mão, nas mesmas cestas

A F-list é `coffee 8, tea 7, bread 6, sugar 5, eggs 4`, e `milk` sai com 3. Essas contagens não têm empate. Com duas partições, posição módulo 2 dá grupo 0 = `coffee, bread, eggs` e grupo 1 = `tea, sugar`. A cesta `bread eggs coffee tea` ordenada fica `coffee tea bread eggs`. Varrendo da direita, `eggs` abre o grupo 0 com a cesta inteira, e `tea` abre o grupo 1 com `coffee tea`.

As cestas geram 10 cestas condicionais para o grupo 0 e 12 para o grupo 1, então os 30 itens filtrados viram 46 itens enviados. Cada grupo minera com limiar 4 e mantém um padrão só quando seu item mais raro está no grupo:

```text
group 0: finds 8, keeps 6  bread 6, coffee 8, eggs 4, bread coffee 4,
                           bread tea 5, bread coffee tea 4
group 1: finds 4, keeps 3  sugar 5, tea 7, coffee tea 5
```

A união tem 9 padrões, nenhum repetido, e toda contagem é final, sem segunda passagem. Esta reprodução em Python, `frequent(B, 4)` e `pyspark.ml.fpm.FPGrowth(minSupport=4/12, numPartitions=2)` devolvem os mesmos itemsets e contagens.

**Hipótese.** Pule a ordenação, e a reprodução devolve 7 de 9: `bread tea` e `bread coffee tea` somem, porque uma cesta escrita `bread coffee tea` põe `tea` no fim, e o prefixo para o grupo de `bread` fica curto.

### Exemplo 3: rodadas e jobs

Os jobs vêm de `sc.statusTracker().getJobIdsForGroup`. A coluna de MapReduce segue a definição de cada algoritmo, já que nenhum job de Hadoop rodou. As três primeiras linhas usam as 12 cestas em 2 partições, com o FPGrowth lendo `sc.parallelize([(b,) for b in B], 2).toDF(["items"])`. As duas últimas usam os pontos do Exemplo 4 em `sc.parallelize(lines, 4)`, com `seed=1` no KMeans:

```text
algorithm           MapReduce rounds    Spark jobs   stages run
A-Priori on RDDs    3 (one per level)   3            6
SON on RDDs         2                   2            4
FPGrowth            3 in the paper      4            6
Lloyd on RDDs       5 (one per iter)    5            10
KMeans (k-means||)  not defined here    20           30
```

- **A-Priori.** O nível 2 conta 10 candidatos e mantém 3, o nível 3 conta 1 e o mantém, e o nível 4 não tem candidatos, então nenhum job roda.
- **FPGrowth.** O `fit` mostra 3 jobs: duas chamadas `count` de contabilidade e a contagem de itens. O quarto, a construção das árvores, só roda quando `freqItemsets` é lido. Assim, 2 jobs são rodadas do algoritmo.
- **KMeans.** Os 20 jobs são 2 da camada de DataFrame para a escolha do solver, 2 de uma chamada de `takeSample`, 2 passos de `sum` mais `collect`, 1 `countByValue` para os pesos, 9 iterações de Lloyd e 2 da camada de DataFrame para o resumo.

### Exemplo 4: cache, k-means paralelo e disposições

Quatro nuvens gaussianas:

```python
import numpy as np

rng = np.random.default_rng(11)
true_c = np.array([[0, 0], [6, 0], [0, 6], [6, 6]], float)
lab = rng.integers(0, 4, 20000)
X = true_c[lab] + rng.normal(size=(20000, 2))
lines = [f"{a:.6f},{b:.6f}" for a, b in X]
```

Um Lloyd escrito à mão em `sc.parallelize(lines, 4)`, analisando cada linha em um `map`, parte dos quatro primeiros pontos e para quando nenhum centro se move mais de $10^{-4}$. Um acumulador conta as chamadas de análise, e nenhuma tarefa rodou de novo:

```text
           iterations   jobs   records parsed
no cache   5            5      100000  (5 x n)
.cache()   5            5       20000  (1 x n)
```

Um Lloyd em NumPy com o mesmo início dá as mesmas 5 iterações e centros. Sem `cache()`, cada job recalcula a entrada, o formato de uma cadeia de jobs de MapReduce relendo o arquivo.

`KMeans(k=4, seed=s)` para $s$ de 1 a 10, em DataFrames com cache dos mesmos pontos (`rows` os guarda analisados). A semente escolhe pontos por posição, então a disposição das linhas muda a execução:

```text
layout                                 k-means||            random
                                       iters  mean jobs     iters  mean jobs
sc.parallelize(lines, 4), parsed       3-9    15.3          4-13   13.0
createDataFrame(rows).repartition(4)   3-4    14.8          6-18   14.8
createDataFrame(rows).coalesce(1)      3-4    12.8          4-18   12.1
sc.parallelize(rows, 8)                3-10   15.4          5-16   14.1
```

`createDataFrame(rows)` sozinho, com 4 partições, repete a primeira linha. Os 100 ajustes, contando os dois modos e essa quinta disposição, chegaram ao custo 39770,13, igual ao de `sklearn.cluster.KMeans(n_clusters=4, n_init=10, random_state=0)`.

Em todas as disposições, o k-means|| teve a faixa de iterações mais estreita e a média menor, de 3,8 a 4,4 contra 7,0 a 8,8. Sua média de jobs nunca foi menor, porém: empatou com random em uma disposição e ficou acima nas outras, porque a inicialização custa 5 jobs extras. Em quatro nuvens separadas os dois chegam ao mesmo custo, então estas execuções não mostram ganho de qualidade.

**Hipótese.** Com os 30 pontos `[0., 5., 10.] * 10` e $k=4$, sementes 1 a 40, k-means|| devolveu 3 centros em todas, e random devolveu 3 em 24 sementes e 2 em 16, porque uma amostra de quatro pontos pode não pegar um dos valores. O valor de $k$ é um pedido, não uma garantia.

**O que o modo local não mostra.** `local[4]` são quatro threads em uma JVM. Shuffles nunca atravessam uma rede e nenhuma máquina pode falhar, então um tempo de relógio aqui não diz nada sobre speedup em cluster, e nenhum é dado. As contagens se transferem.

## Equívocos Comuns e Armadilhas

- **"SON e PFP são duas versões da mesma coisa."** O SON divide cestas e verifica candidatos em uma segunda passagem. O PFP divide o espaço de busca e não verifica nada.
- **"Baixe o limiar de qualquer jeito e o SON continua exato."** A garantia exige limiares que somem no máximo $s$. Limiares que não foram reduzidos perderam 6 de 9 itemsets.

## Resumo

Em escala, os custos são memória para contadores e passagens pelos dados. A-Priori leva uma rodada por nível. SON leva duas, sem falsos negativos quando os limiares somam no máximo $s$. PFP divide a busca por item sufixo sob uma única ordem global, então cada grupo devolve contagens finais: três fases no artigo, duas rodadas com shuffle no Spark. Lloyd leva uma rodada por iteração, e `cache()` reduziu os registros analisados de 5 vezes para 1 vez $n$. O KMeans do Spark usa k-means|| com 2 passos por default, o que manteve as iterações numa faixa mais estreita que a inicialização aleatória em todas as disposições testadas, enquanto sua média de jobs foi de empatada com random a 2,3 acima. O modo local valida contagens, não speedup em cluster.

## Documentation Links

- [Mining of Massive Datasets, chapter 6 (archived copy)](https://web.archive.org/web/20241120025442/http://infolab.stanford.edu/~ullman/mmds/ch6.pdf): passagens do A-Priori, memória para contagens e o algoritmo SON com sua forma em MapReduce.
- [Li et al. (2008): PFP, Parallel FP-Growth for Query Recommendation](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/34668.pdf): shards dependentes de grupo e as três fases.
- [Bahmani et al. (2012): Scalable K-Means++](https://theory.stanford.edu/~sergei/papers/vldb12-kmpar.pdf): o algoritmo k-means|| e sua garantia.
- [Zaharia et al. (2012): Resilient Distributed Datasets](https://www.usenix.org/system/files/conference/nsdi12/nsdi12-final138.pdf): RDDs, linhagem e medições contra o Hadoop.
- [Spark, Frequent Pattern Mining](https://spark.apache.org/docs/latest/ml-frequent-pattern-mining.html): `FPGrowth` e seus parâmetros.
- [Spark, Clustering](https://spark.apache.org/docs/latest/ml-clustering.html): `KMeans` e k-means||.
- [Spark source, mllib FPGrowth.scala at v4.3.0](https://github.com/apache/spark/blob/v4.3.0/mllib/src/main/scala/org/apache/spark/mllib/fpm/FPGrowth.scala): posições de item e o filtro de sufixo.
- [Spark source, mllib KMeans.scala at v4.3.0](https://github.com/apache/spark/blob/v4.3.0/mllib/src/main/scala/org/apache/spark/mllib/clustering/KMeans.scala): os passos de k-means||.
- [Apache Mahout](https://mahout.apache.org/): a declaração do projeto sobre seu foco e o status do Mahout Classic.
- [Apache Mahout blog](https://mahout.apache.org/blog): posts recentes de lançamento.
- [Apache Attic](https://attic.apache.org/): a lista de projetos Apache aposentados.
