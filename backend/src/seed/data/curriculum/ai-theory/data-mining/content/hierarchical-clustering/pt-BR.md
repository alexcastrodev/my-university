---
version: 1.0
updatedAt: 2026-11-04
title: "Agrupamento Hierárquico"
summary: "Agrupamento aglomerativo e divisivo, linkage single, complete, average e Ward, como ler um dendrograma e em que isso difere do k-means."
---
## Objetivos de Aprendizagem

- Definir linkage single, complete, average, Ward e centroid pela distância entre clusters que cada um minimiza numa fusão.
- Rodar o agrupamento aglomerativo à mão num conjunto pequeno, ler o dendrograma e conferir a tabela de fusões do SciPy.
- Dizer exatamente qual altura de fusão o SciPy reporta para Ward e conferi-la contra um aumento de soma de quadrados calculado diretamente.
- Explicar chaining, inversões e por que Ward precisa de distâncias euclidianas, cada um com uma execução que o mostre.
- Informar o custo de tempo de um método hierárquico junto com o algoritmo que o atinge, e comparar o resultado com o k-means.

## Contexto e Motivação

`k-means-clustering` pede $k$ antes de começar, e outro $k$ significa nova execução a partir de novos centros iniciais. O agrupamento hierárquico produz uma família aninhada de partições, uma para cada $k$ de $n$ até 1, numa única execução. Escolher $k$ vira escolher onde cortar uma árvore. O preço é que toda fusão é permanente, e que "a distância entre dois clusters" tem várias definições, que dão árvores diferentes nos mesmos dados. A distância entre pontos vem de `similarity-and-distance-measures`.

## Teoria Central

### Aglomerativo e divisivo

O agrupamento **aglomerativo** começa com $n$ clusters unitários e funde repetidamente o par de clusters mais próximo, $n-1$ fusões no total. O **divisivo** começa com tudo num só cluster e vai dividindo. Um primeiro passo divisivo exato precisa avaliar $2^{n-1}-1$ divisões em duas partes não vazias (31 para $n=6$), então os métodos divisivos práticos usam alguma heurística. O `BisectingKMeans` do scikit-learn, por exemplo, divide um cluster por vez com 2-means. O resto desta lição é aglomerativo.

### Linkage: a distância entre clusters

Para clusters $A$ e $B$ com centroides $c_A,c_B$ e distância entre pontos $d$:

| Linkage | Distância entre clusters |
|---|---|
| single | $\min_{a\in A,\,b\in B} d(a,b)$ |
| complete | $\max_{a\in A,\,b\in B} d(a,b)$ |
| average (UPGMA) | $\frac{1}{\lvert A\rvert\lvert B\rvert}\sum_{a\in A}\sum_{b\in B} d(a,b)$ |
| centroid (UPGMC) | $\lVert c_A-c_B\rVert_2$ |
| Ward | $\sqrt{\frac{2\lvert A\rvert\lvert B\rvert}{\lvert A\rvert+\lvert B\rvert}}\,\lVert c_A-c_B\rVert_2$ |

Existem também weighted e median, cujos valores dependem da ordem das fusões. A linha de Ward é a forma que o SciPy reporta, como escrita em Müllner (2011). O critério de Ward é fundir o par que menos aumenta a soma total de quadrados dentro dos clusters, a mesma grandeza com que o k-means trabalha. Para $\mathrm{SSE}(S)=\sum_{x\in S}\lVert x-c_S\rVert^2$, o aumento tem forma fechada:

$$\Delta(A,B)=\mathrm{SSE}(A\cup B)-\mathrm{SSE}(A)-\mathrm{SSE}(B)=\frac{\lvert A\rvert\lvert B\rvert}{\lvert A\rvert+\lvert B\rvert}\lVert c_A-c_B\rVert^2.$$

Logo, a altura em `scipy.cluster.hierarchy.linkage(X, 'ward')` é $\sqrt{2\Delta}$, não $\Delta$. As variantes divergem aqui. O `hclust` do R tem `"ward.D2"`, que eleva as dissimilaridades ao quadrado antes de atualizar e coincide com o SciPy, e `"ward.D"`, que não faz isso. Murtagh e Legendre (2014) mostram que `"ward.D"` só implementa o critério de Ward quando recebe distâncias ao quadrado, e que a raiz quadrada dessas alturas coincide então com as de `"ward.D2"`. O `AgglomerativeClustering(compute_distances=True)` do scikit-learn reporta os mesmos valores do SciPy.

### Lendo um dendrograma

Cada nó interno fica na altura da sua fusão. Duas folhas têm **distância cofenética** igual à altura do seu nó comum mais baixo. Um corte horizontal na altura $t$ dá a partição cujos clusters são as subárvores abaixo de $t$. Os dois filhos de um nó podem trocar de lugar livremente, então leia a altura em que dois pontos se juntam, não a proximidade com que suas folhas foram desenhadas.

### Quando as alturas nunca diminuem

**Propriedade (Müllner 2011).** Se, para todos os clusters disjuntos $I,J,K$,

$$d(I,J)\le\min\{d(I,K),d(J,K)\}\ \Rightarrow\ d(I,J)\le d(I\cup J,K),$$

então a sequência de alturas de fusão não pode diminuir. Single, complete, average, weighted e Ward satisfazem isso, e também a propriedade mais forte de **redutibilidade**, com $\min\{d(I,K),d(J,K)\}\le d(I\cup J,K)$ à direita. Centroid e median não satisfazem, e podem produzir uma **inversão**, uma fusão mais baixa que a anterior. Um dendrograma com inversão não tem corte horizontal consistente. O Exemplo 4 mostra a condição falhando.

### Custo, por algoritmo

O custo é de um algoritmo, não do "agrupamento hierárquico". Todos estes partem de uma matriz de dissimilaridades armazenada, com $\Theta(n^2)$ entradas.

| Algoritmo | Linkages | Tempo |
|---|---|---|
| primitivo: busca em todos os pares a cada fusão | qualquer | $\Theta(n^3)$ |
| baseado em MST | single | $\Theta(n^2)$ |
| nearest-neighbor chain | complete, average, weighted, Ward | $\Theta(n^2)$ |
| genérico com fila de prioridade | qualquer, inclusive centroid e median | melhor caso $\Theta(n^2)$, cota de pior caso $O(n^3)$ |

Esses valores são de Müllner (2011). A nearest-neighbor chain depende da redutibilidade, então centroid e median não podem usá-la: entre os algoritmos rápidos, só o genérico atende a eles. A documentação do SciPy lista $O(n^2)$ para seu código de MST e de nearest-neighbor chain, $O(n^3)$ para um algoritmo ingênuo em centroid e median, e memória $O(n^2)$ para todos.

## Exemplos Resolvidos

### Exemplo 1: quatro linkages em seis pontos

Tome pontos numa reta, com todas as execuções no SciPy 1.18:

```text
A=0  B=1  C=3  D=7  E=8.5  F=14.5
```

Dois pares de distâncias empatam (6 e 7,5), mas nenhuma decisão de fusão depende deles. As duas primeiras fusões são iguais em todos: $AB$ em 1, depois $DE$ em 1,5. Depois $C$ entra em $AB$, com $d(C,AB)$ igual a 2 no single, 3 no complete e 2,5 no average. A saída:

```text
fusão   single          complete        average          Ward
1       A+B      1.0    A+B      1.0    A+B       1.0    A+B       1.0
2       D+E      1.5    D+E      1.5    D+E       1.5    D+E       1.5
3       C+AB     2.0    C+AB     3.0    C+AB      2.5    C+AB      2.8868
4       DE+ABC   4.0    F+DE     7.5    DE+ABC    6.4167 F+DE      7.7942
5       F+resto  6.0    ABC+DEF 14.5    F+resto  10.6    ABC+DEF  15.0111
k=2     ABCDE | F       ABC | DEF       ABCDE | F        ABC | DEF
```

Confira uma altura do average: $d(DE,ABC)=(7+6+4+8{,}5+7{,}5+5{,}5)/6=38{,}5/6=6{,}4167$. Cortar a árvore do complete em $t=5$ dá $ABC\mid DE\mid F$, e em $t=2$ dá $AB\mid C\mid DE\mid F$. Nessa árvore, a distância cofenética de $A$ e $E$ é 14,5, bem acima da distância entre eles, 8,5.

### Exemplo 2: a altura de Ward é $\sqrt{2\Delta}$

Para cada fusão de Ward acima, calcule diretamente o SSE do cluster fundido e subtraia:

```text
fusão    SSE(união)  Delta      sqrt(2 Delta)  altura scipy  SSE acumulado
A+B        0.5         0.5        1.0           1.0            0.5
D+E        1.125       1.125      1.5           1.5            1.625
C+AB       4.6667      4.1667     2.8868        2.8868         5.7917
F+DE      31.5        30.375      7.7942        7.7942        36.1667
ABC+DEF  148.8333    112.6667    15.0111       15.0111       148.8333
```

Todas as alturas batem, e os deltas somam o SSE total dos seis pontos, 148,8333. Assim, `Z[:,2]**2/2` somado até uma fusão dá o SSE dentro dos clusters daquele corte. Uma atualização de Lance-Williams como a de `"ward.D"`, rodada sobre distâncias ao quadrado, dá $1;\ 2{,}25;\ 8{,}3333;\ 60{,}75;\ 225{,}3333$, cujas raízes quadradas são as alturas do SciPy. Sobre distâncias sem elevar ao quadrado, dá $1;\ 1{,}5;\ 3;\ 8{,}5;\ 19$, que não batem com nenhuma das duas.

### Exemplo 3: chaining no single linkage

Monte 29 pontos: duas grades unitárias $3\times3$, o bloco $L$ em $x\in\{0,1,2\}$ e o bloco $R$ em $x\in\{12,13,14\}$, com $y\in\{0,1,2\}$; dez pontos de ponte em $y=1$, espaçados de 0,9, de $x=2{,}9$ a $x=11$; e um ponto isolado em $(-1{,}5;\ 1)$. Corte cada árvore em $k=2$:

```text
linkage    com ponte: tamanhos   L e R juntos?   sem ponte: tamanhos
single     28 + 1                sim             9 + 10
complete   13 + 16               não             9 + 10
average    13 + 16               não             9 + 10
Ward       13 + 16               não             9 + 10
```

Sem a ponte, todo linkage separa os blocos, e o single tem sua fusão mais alta em 10. Dez pontos em fila derrubam essa fusão para 1, porque o single linkage só olha o par mais próximo, e uma corrente de passos curtos une grupos distantes. Para $k=2$ só resta cortar fora o ponto isolado, na altura 1,5. Os outros linkages mantêm os blocos separados e dividem a ponte em 6 e 4. Chaining só é defeito quando o objetivo são grupos compactos: `density-based-clustering-with-dbscan` mantém a ideia de seguir pontos conectados e acrescenta um requisito de densidade. Muitas alturas aqui empatam em 1,0, então `fcluster(Z, 3, 'maxclust')` na árvore do single devolve 2 clusters, não 3: ele não divide dentro de um empate.

### Exemplo 4: uma inversão no centroid linkage

Três pontos: $(0,0)$, $(1,0)$, $(0{,}5;\ 0{,}9)$. Os dois primeiros estão à distância 1, e cada um a $1{,}0296$ do terceiro. Eles se fundem na altura 1, e o centroide deles, $(0{,}5;\ 0)$, está a apenas $0{,}9$ do terceiro ponto:

```text
método     alturas        is_monotonic
centroid   1.0   0.9      False
median     1.0   0.9      False
average    1.0   1.0296   True
Ward       1.0   1.0392   True
```

A hipótese falha aqui: $d(I,J)=1$ está abaixo das outras duas distâncias, mas $d(I\cup J,K)=0{,}9<1$. O nó pai fica abaixo do filho, e `fcluster(Z, 0.95, 'distance')` devolve três clusters unitários, embora exista um nó em 0,9.

### Exemplo 5: Ward precisa de distâncias euclidianas

A fórmula de atualização de Ward supõe entrada euclidiana, porque a forma fechada de $\Delta$ supõe. O SciPy recusa `linkage(X, 'ward', metric='cityblock')`, e o scikit-learn levanta `ValueError` para `metric='manhattan'`. Uma matriz condensada pré-calculada não é verificada. Em $(0,0),(1,3),(4,1),(5,5),(9,2),(10,7)$:

```text
entrada               fusão 2      fusão 3       alturas                         sqrt(2 Delta) dessas fusões
Euclidiana            {3º}+{1,2}   {4º}+{5º}     3.16 4.08 5.00 5.32 12.40       3.16 4.08 5.00 5.32 12.40
Manhattan, em matriz  {3º}+{4º}    {5º}+{6º}     4.00 5.00 6.00 8.51 15.84       3.16 4.12 5.10 6.04 12.01
```

A execução com Manhattan devolve uma árvore sem nenhum aviso, mas suas alturas não são aumento de SSE de coisa alguma, e suas fusões são outras.

### Exemplo 6: fusões gulosas contra o k-means

Em $2,5,7,16,26,34,38$, o corte de Ward em $k=2$ é $\{2,5,7\}\mid\{16,26,34,38\}$, com SSE 295,67. Força bruta nas 63 divisões dá $\{2,5,7,16\}\mid\{26,34,38\}$, com SSE 183,67. A causa é uma fusão inicial. Com os clusters $\{2,5,7\},\{16\},\{26\},\{34,38\}$, juntar 16 e 26 custa $\Delta=50$, menos que 26 com $\{34,38\}$ (66,67) ou 16 com $\{2,5,7\}$ (96,33). Essa fusão nunca é desfeita. `KMeans(2, n_init=10, random_state=0)` chega a 183,67, e nestes dados o k-means iniciado nos centroides de Ward também chega, em 2 iterações.

## Equívocos Comuns e Armadilhas

- **"As alturas sempre crescem subindo a árvore."** Isso só vale sob a condição acima. Centroid e median podem inverter.
- **"Um dendrograma é único."** Empates o fazem depender da ordem de entrada. Para $0,1,2$ com complete linkage, o SciPy dá $\{0,1\}\mid\{2\}$, e para os mesmos pontos listados como $2,1,0$ dá $\{1,2\}\mid\{0\}$.
- **"O agrupamento hierárquico dispensa decidir $k$."** A árvore adia a decisão para o corte. `cluster-validation` trata disso.

## Resumo

O agrupamento aglomerativo faz $n-1$ fusões irreversíveis, e o linkage define o que é "mais próximo". Single segue correntes, complete e Ward preferem grupos compactos, e centroid pode inverter. A altura de Ward no SciPy é $\sqrt{2\Delta}$, exige entrada euclidiana e tem escala diferente da de outras ferramentas. O tempo é $\Theta(n^2)$ com os algoritmos de MST e nearest-neighbor chain, e a matriz $\Theta(n^2)$ costuma ser o limite. Comparado ao k-means, o método dá todos os $k$ de uma vez, sem início aleatório, mas um corte guloso pode ter SSE bem pior que o ótimo.

## Documentation Links

- [Müllner (2011): Modern hierarchical, agglomerative clustering algorithms](https://arxiv.org/abs/1109.2378): fórmulas de atualização, redutibilidade, inversões e a complexidade de cada algoritmo.
- [Murtagh and Legendre (2011, published 2014): Ward's Hierarchical Clustering Method: Clustering Criterion and Agglomerative Algorithm](https://arxiv.org/abs/1111.6285): as duas implementações de Ward e o que cada uma exige como entrada.
- [SciPy: scipy.cluster.hierarchy.linkage](https://docs.scipy.org/doc/scipy/reference/generated/scipy.cluster.hierarchy.linkage.html): definições de linkage, a matriz de saída, notas de complexidade e o requisito euclidiano.
- [R: hclust](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/hclust.html): as opções `ward.D` e `ward.D2` e os métodos não monotônicos.
- [scikit-learn: AgglomerativeClustering](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.AgglomerativeClustering.html): a implementação e sua restrição de métrica para Ward.
- [scikit-learn: BisectingKMeans](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.BisectingKMeans.html): um método divisivo baseado em 2-means repetido.
