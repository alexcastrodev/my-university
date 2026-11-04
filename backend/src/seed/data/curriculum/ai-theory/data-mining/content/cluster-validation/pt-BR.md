---
version: 1.0
updatedAt: 2026-11-04
title: "Validação de Clusters"
summary: "Validação interna e externa com silhouette, Davies-Bouldin e índice de Rand ajustado, como escolher o número de clusters e quando essas métricas enganam."
---
## Objetivos de Aprendizagem

- Separar validação interna (sem rótulos) de validação externa (com rótulos) e dizer o que cada uma consegue estabelecer.
- Calcular a silhouette à mão, incluindo a faixa válida de $k$ e a convenção para clusters unitários, e conferir com o scikit-learn.
- Calcular o índice de Davies-Bouldin à mão, na variante que o scikit-learn usa.
- Calcular o índice de Rand ajustado por contagem de pares, enunciar o modelo de permutação por trás dele e mostrar que ele pode ser negativo.
- Mostrar com execuções que a silhouette pode preferir uma resposta errada e que ruído puro ainda produz um melhor $k$.

## Contexto e Motivação

`k-means-clustering` escolhe $k$ com um cotovelo na distância total dentro dos clusters. `hierarchical-clustering` deixa $k$ para um corte. `density-based-clustering-with-dbscan` deixa para o `eps`. Qualquer um deles devolve rótulos para qualquer entrada (os do DBSCAN podem ser só ruído), então sobra uma pergunta: esta partição reflete estrutura, ou o algoritmo a impôs? Os índices de validação dão números para essa pergunta, mas cada número embute uma suposição sobre o que é um bom cluster. A inércia usada no cotovelo ilustra o limite: ela cai conforme $k$ cresce até em dados sem estrutura (Exemplo 5).

Todos os exemplos aqui são exploratórios, sem separação de treino e teste: os índices pontuam os mesmos dados que foram agrupados. Rótulos externos servem só para pontuar, nunca para ajustar.

## Teoria Central

### Índices internos

Índices internos usam só os dados e a partição.

**Silhouette** (Rousseeuw 1987). Para o ponto $i$ no cluster $C$ com $\lvert C\rvert\ge2$, seja $a(i)$ sua distância média aos *outros* pontos de $C$, e $b(i)$ o menor valor, entre os outros clusters, de sua distância média aos pontos daquele cluster:

$$s(i)=\frac{b(i)-a(i)}{\max\{a(i),b(i)\}}.$$

Sob as suposições usuais de distância, com $a(i),b(i)$ não ambos nulos, $-1\le s(i)\le1$. Perto de 1 significa bem dentro do cluster, perto de 0 significa numa fronteira, e negativo significa mais perto, em média, de outro cluster. O escore é a média de $s(i)$ sobre os pontos, que difere da média das médias por cluster.

*Faixa.* O índice exige $2\le k\le n-1$. Com $k=1$, $b(i)$ não tem outro cluster para usar. Com $k=n$, todo ponto é unitário e nada é medido. O scikit-learn levanta `ValueError` nos dois casos.

*Clusters unitários.* Para um ponto sozinho no cluster, $a(i)$ não está definido, e a convenção é $s(i)=0$. O scikit-learn implementa exatamente isso.

**Davies-Bouldin**, na variante do scikit-learn. Com centroide $c_i$ e $S_i$ a distância euclidiana média dos pontos do cluster $i$ a $c_i$,

$$R_{ij}=\frac{S_i+S_j}{\lVert c_i-c_j\rVert},\qquad DB=\frac1k\sum_{i=1}^k\max_{j\ne i}R_{ij}.$$

Menor é melhor, e 0 é o mínimo. Ele depende de centroides, então herda a geometria deles.

### Índices externos

Dada uma partição de referência $U$ e um agrupamento $V$, conte pares de pontos. Com entradas de contingência $n_{ij}$, somas de linha $a_i$ e somas de coluna $b_j$, defina

$$\text{Index}=\sum_{ij}\binom{n_{ij}}{2},\quad A=\sum_i\binom{a_i}{2},\quad B=\sum_j\binom{b_j}{2}.$$

O **índice de Rand** é a fração de pares em que $U$ e $V$ concordam. Sua fraqueza é um patamar alto: partições sem relação pontuam bem acima de 0 (Exemplo 3). O **índice de Rand ajustado** de Hubert e Arabie (1985) subtrai o valor esperado ao acaso:

$$\mathrm{ARI}=\frac{\text{Index}-\mathbb E[\text{Index}]}{\tfrac12(A+B)-\mathbb E[\text{Index}]},\qquad \mathbb E[\text{Index}]=\frac{AB}{\binom n2}.$$

**O modelo de acaso.** A esperança supõe o modelo de permutação: partições sorteadas com o número de clusters e os tamanhos dos clusters fixos, o que dá uma distribuição hipergeométrica generalizada para a tabela (Vinh et al. 2010). Sob ele, o ARI tem valor esperado 0 e é no máximo 1, atingindo 1 em partições idênticas. Nada faz de 0 uma cota inferior: concordância abaixo do acaso dá ARI **negativo**.

A esperança nula descreve um único sorteio com os tamanhos dos clusters fixos. Escolha o melhor de muitos e a hipótese cai (Exemplo 3).

O ARI também trata qualquer rótulo recebido como cluster, inclusive o `-1` do DBSCAN. O Exemplo 4 de `density-based-clustering-with-dbscan` mostrou esse efeito.

### Escolhendo $k$

A receita comum roda um agrupamento para cada $k$ e fica com o melhor índice. Isso responde "de qual $k$ este índice gosta na saída deste algoritmo", pergunta mais estreita que "quantos grupos existem". Três verificações ajudam: comparar com uma referência nula (Exemplo 5), inspecionar os próprios clusters e testar se outro algoritmo concorda.

## Exemplos Resolvidos

### Exemplo 1: silhouette e Davies-Bouldin à mão

Pontos numa reta: $0,1,2\mid6,7\mid12$, três clusters.

```text
x     a      b      s
0     1.5    6.5    0.7692
1     1.0    5.5    0.8182
2     1.5    4.5    0.6667
6     1.0    5.0    0.8000
7     1.0    5.0    0.8000
12    -      -      0  (unitário)
```

Para $x=0$: $a=(1+2)/2=1{,}5$, $b=\min\{(6+7)/2,\ 12\}=6{,}5$, então $s=5/6{,}5$. A média sobre os pontos é $0{,}6423$, e `silhouette_score` concorda. A média das médias por cluster seria $0{,}5171$. Rótulo único e todos os rótulos diferentes levantam `ValueError: Number of labels is ... Valid values are 2 to n_samples - 1 (inclusive)`.

Para Davies-Bouldin, os centroides são $1;\ 6{,}5;\ 12$ e $S=(0{,}6667;\ 0{,}5;\ 0)$. Então $R_{12}=1{,}1667/5{,}5=0{,}2121$, $R_{13}=0{,}6667/11=0{,}0606$, $R_{23}=0{,}5/5{,}5=0{,}0909$. Os máximos por cluster são $0{,}2121;\ 0{,}2121;\ 0{,}0909$, cuja média é $0{,}1717$, igual a `davies_bouldin_score`.

### Exemplo 2: ARI por contagem de pares, e um valor negativo

Sejam $U=$ `0000111122` e $V=$ `0001111222`.

$$\begin{pmatrix}3&1&0\\0&3&1\\0&0&2\end{pmatrix}$$

$\text{Index}=3+3+1=7$. Linhas de tamanho $4,4,2$ dão $A=13$, e colunas de tamanho $3,4,3$ dão $B=12$. Com $\binom{10}{2}=45$, a esperança é $13\cdot12/45=3{,}4667$, então

$$\mathrm{ARI}=\frac{7-3{,}4667}{12{,}5-3{,}4667}=0{,}3911,$$

e `adjusted_rand_score` concorda, enquanto o índice de Rand é $0{,}7556$.

Para $U=$ `0011` e $V=$ `0101`, toda entrada da tabela é 1, então $\text{Index}=0$, $A=B=2$, a esperança é $4/6$ e $\mathrm{ARI}=(0-\tfrac23)/(2-\tfrac23)=-0{,}5$. As duas partições discordam mais do que o modelo espera.

### Exemplo 3: o patamar do acaso, por simulação

Tome 10 clusters de 10 pontos cada, como `labels = numpy.repeat(numpy.arange(10), 10)`, e compare `labels` com `rng.permutation(labels)` 1000 vezes, a partir de um só `rng = numpy.random.default_rng(0)`.

```text
índice de Rand médio  0.8347
ARI médio             0.0001   (dp 0.0142, mín -0.0364, máx 0.0467)
```

Um índice de Rand de 0,83 aqui não carrega informação, porque dominam os pares em clusters diferentes. Agora selecione. Para tamanhos $10,5,5$ ($n=20$), `default_rng(0)` de novo dá ARI médio de $0{,}0009$ em 1000 permutações, e a melhor delas chega a $0{,}4855$. Um escore alto escolhido entre muitas tentativas não é evidência.

### Exemplo 4: a silhouette prefere a resposta errada

Use as duas luas, `make_moons(n_samples=400, noise=0.05, random_state=0)`, e `KMeans(k, n_init=10, random_state=0)`.

```text
partição             silhouette   Davies-Bouldin   ARI contra as luas
luas verdadeiras     0.3310       1.1600           1.0000
k-means, k=2         0.4900       0.7803           0.2738
k-means, k=3         0.4297       0.8829           0.2854
k-means, k=6         0.5089       0.6102           0.2836
k-means, k=8         0.5327       0.5473           0.2478
k-means, k=10        0.5205       0.5490           0.1989
```

A partição verdadeira é a pior nos dois índices internos, e $k=8$ é a melhor nos dois. Eles premiam blocos convexos, compactos e separados, e uma lua não é compacta nem convexa: suas duas pontas ficam longe uma da outra, então $a(i)$ é grande. O DBSCAN recupera exatamente essas luas, e a silhouette colocaria esse resultado abaixo do k-means.

A geometria pode quebrar um índice de vez. Em `make_circles(n_samples=400, factor=0.5, noise=0.03, random_state=0)`, a partição verdadeira tem silhouette $0{,}1135$ e Davies-Bouldin $796{,}3$: os dois anéis têm quase o mesmo centroide, então o denominador $\lVert c_i-c_j\rVert$ quase some. O k-means com $k=2$ tem silhouette $0{,}3531$ e ARI $-0{,}0025$, valor negativo que diz que ele não fez melhor que o acaso.

Rótulos de ruído criam outra armadilha. `silhouette_score` trata `-1` como cluster. Para `DBSCAN(eps=0.08, min_samples=4)` nas luas, com 21 pontos de ruído, dá $0{,}2291$ com o ruído incluído e $0{,}2771$ sem ele. Diga qual dos dois você reporta.

### Exemplo 5: ruído ainda tem um melhor $k$

Sorteie 300 pontos uniformes no quadrado unitário com `numpy.random.default_rng(7).random((300, 2))` e rode `KMeans(k, n_init=10, random_state=0)`. Não há clusters.

```text
k    silhouette   Davies-Bouldin   inércia
2    0.3689       1.127            29.05
3    0.3858       0.853            18.48
4    0.4042       0.783            11.96
5    0.3944       0.827             9.77
6    0.3867       0.809             8.34
8    0.3625       0.833             5.90
10   0.3662       0.793             4.69
```

Tomado ao pé da letra, isso diz $k=4$. A inércia cai a cada passo, e a inércia ótima só pode cair conforme $k$ cresce, em quaisquer dados. Uma referência nula dá a escala do número. Em 100 conjuntos uniformes como esse, sorteados em sequência de um só `default_rng(8)`, cada um buscado em $k=2,\dots,10$ com o mais barato `KMeans(k, n_init=3, random_state=0)`, a melhor silhouette teve mediana de $0{,}414$ e percentil 95 de $0{,}437$, e $k=4$ venceu 66 vezes (de 63 a 67 com quatro outras escolhas de `random_state`), então um quadrado parece favorecer quatro células. O conjunto acima, rodado de novo com esses mesmos ajustes, chega a $0{,}4039$ em $k=4$, então seu escore é normal para ruído. Em contraste, três blocos de `make_blobs(n_samples=300, centers=3, cluster_std=0.8, random_state=0)`, reescalados ao quadrado unitário com `minmax_scale` e agrupados com `KMeans(3, n_init=10, random_state=0)`, chegam a $0{,}5568$, acima dessa faixa. Esta referência é uma escolha entre várias: uniforme numa caixa é uma hipótese nula específica, e dados com atributos correlacionados precisam de uma compatível.

## Equívocos Comuns e Armadilhas

- **"Silhouette alta prova que os clusters são reais."** O Exemplo 5 dá 0,40 em ruído. O valor precisa de uma referência.
- **"ARI 0 é o pior escore."** É o nível do acaso, e existem valores negativos.
- **"Rótulos aleatórios dão índice de Rand perto de 0."** Dão cerca de 0,83 no Exemplo 3.
- **"Índices internos são neutros."** Silhouette e Davies-Bouldin pontuam compacidade baseada em distância, o que favorece formas do tipo k-means.
- **"Rótulos externos são a verdade."** São uma partição. Um agrupamento que discorda pode ter achado outra estrutura, ou nenhuma.

## Resumo

Índices internos pontuam uma partição contra uma noção geométrica de compacidade e separação. A silhouette exige $2\le k\le n-1$ e define $s(i)=0$ para clusters unitários, e o Davies-Bouldin do scikit-learn usa centroides e distâncias médias. Índices externos precisam de uma referência, e o ARI corrige o índice de Rand sob o modelo de permutação, com valor esperado 0, máximo 1 e valores negativos possíveis. Clusters não convexos podem fazer a partição verdadeira parecer a pior, e ruído sempre tem um melhor $k$, então um número de validação diz pouco sem uma referência do que o acaso produz.

## Documentation Links

- [scikit-learn: clustering performance evaluation](https://scikit-learn.org/stable/modules/clustering.html): guia do usuário para índice de Rand, ARI, silhouette e Davies-Bouldin, com suas referências.
- [scikit-learn: silhouette_score](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.silhouette_score.html): a implementação e sua faixa válida de rótulos.
- [Vinh, Epps, and Bailey (2010): Information Theoretic Measures for Clusterings Comparison](https://jmlr.csail.mit.edu/papers/volume11/vinh10a/vinh10a.pdf): medidas de contagem de pares, o ARI e o modelo de permutação usado na correção pelo acaso.
- [Wikipedia: Silhouette (clustering)](https://en.wikipedia.org/wiki/Silhouette_%28clustering%29): a definição, incluindo o caso de clusters de tamanho 1.
