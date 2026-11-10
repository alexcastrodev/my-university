---
version: 1.0
updatedAt: 2026-11-04
title: "Agrupamento Baseado em Densidade com DBSCAN"
summary: "Os pontos core, de borda e de ruído do DBSCAN, alcançabilidade por densidade, como escolher eps e minPts, e clusters de forma arbitrária."
---
## Objetivos de Aprendizagem

- Enunciar as definições de ponto core, de borda e de ruído, e dizer se `MinPts` conta o próprio ponto no artigo original e no scikit-learn.
- Acompanhar o DBSCAN à mão num conjunto pequeno e conferir com `sklearn.cluster.DBSCAN`.
- Mostrar quais partes da saída dependem da ordem de visita e quais não dependem.
- Escolher `eps` num gráfico ordenado de k-distance sem o erro de um a mais ou a menos.
- Dizer com precisão o que se sabe e o que não se sabe sobre o tempo de execução do DBSCAN.
- Dizer quando clusters de densidades diferentes derrotam um `eps` único, e mostrar que a diferença de densidade sozinha não basta.

## Contexto e Motivação

`k-means-clustering` atribui cada ponto ao centro mais próximo, então seus clusters são células convexas. `gaussian-mixture-models-and-the-em-algorithm` admite formas alongadas, mas ainda ajusta uma gaussiana por cluster. Os dois dão um lugar a todo ponto, de forma suave no caso da mistura, então nenhum consegue dizer "este ponto não pertence a nada". `hierarchical-clustering` mostrou o single linkage seguindo formas conectadas, e também qualquer ponte fina. O DBSCAN, de Ester, Kriegel, Sander e Xu (1996), mantém a ideia de conexão e acrescenta um requisito de densidade: um cluster só cresce por pontos com vizinhos suficientes. O número de clusters não é entrada, e pontos em regiões esparsas recebem o rótulo de ruído.

## Teoria Central

### Definições e a convenção de contagem

Fixe `Eps` e `MinPts`. Ester et al. definem a vizinhança de $p$ no banco $D$ como

$$N_{Eps}(p)=\{q\in D\mid \mathrm{dist}(p,q)\le Eps\}.$$

Como $\mathrm{dist}(p,p)=0$, **$p$ pertence à própria vizinhança**. Um ponto é **core** se $\lvert N_{Eps}(p)\rvert\ge MinPts$. O scikit-learn segue isso: `min_samples` "includes the point itself", o teste é `>=`, e distâncias exatamente iguais a `eps` contam. Gan e Tao (2015) adotam a mesma convenção. Um texto que conta só os outros pontos tem um `MinPts` uma unidade menor para os mesmos clusters.

- $p$ é **diretamente alcançável por densidade** a partir de $q$ se $p\in N_{Eps}(q)$ e $q$ é core.
- $p$ é **alcançável por densidade** a partir de $q$ se existe uma cadeia $q=p_1,\dots,p_n=p$ em que cada passo é direto. Todos os pontos da cadeia, exceto talvez o último, são core, então essa relação não é simétrica.
- $p$ e $q$ são **conectados por densidade** se ambos são alcançáveis por densidade a partir de algum ponto $o$.
- Um **cluster** é um conjunto não vazio $C$ maximal (se $p\in C$ e $q$ é alcançável por densidade a partir de $p$, então $q\in C$) e conexo (todos os pares em $C$ são conectados por densidade).
- **Ruído** é todo ponto fora de qualquer cluster. Um ponto de **borda** está num cluster, mas não é core.

**Propriedade (Ester et al., Lemas 1 e 2).** Se $p$ é core, o conjunto dos pontos alcançáveis por densidade a partir de $p$ é um cluster, e todo cluster é igual a esse conjunto para qualquer um de seus pontos core. A hipótese importa: partindo de um ponto de borda, nada é alcançável, então o mesmo procedimento não devolve cluster algum.

### O algoritmo

Para cada ponto não classificado, consulte sua vizinhança. Se não for core, marque-o como ruído por enquanto, pois ele pode virar ponto de borda depois. Se for core, abra um cluster e expanda a partir dos vizinhos: cada um que for core acrescenta os próprios vizinhos. São no máximo $n$ consultas de região.

### O que depende da ordem de visita

A condição de core vem de contagens, e a de ruído vem de não pertencer a cluster algum, então nenhuma das duas depende da ordem, e pela propriedade acima o agrupamento dos pontos core também não. A exceção é um ponto de borda a até `Eps` de pontos core de dois clusters. Pelas definições, ele pertence aos dois. Ester et al. o atribuem ao cluster descoberto primeiro e dizem que essas situações são raras. A formulação de Gan e Tao deixa os clusters se sobreporem nesses pontos. O `sklearn.cluster.DBSCAN` devolve um rótulo por ponto, então sua resposta depende da ordem das linhas.

### Escolhendo os parâmetros

Ester et al. plotam a distância de cada ponto ao seu $k$-ésimo vizinho mais próximo, em ordem decrescente, tomam `Eps` no primeiro "vale" e fixam `MinPts` em 4 para dados bidimensionais, relatando que $k$ maiores mudaram pouco o gráfico nos experimentos deles. Deixam a escolha do limiar para uma pessoa.

Atenção aos deslocamentos. O $k$-dist deles exclui $p$, então um ponto com $k$-dist no máximo `Eps` tem pelo menos $k+1$ pontos na vizinhança. No scikit-learn, `NearestNeighbors(n_neighbors=m).fit(X).kneighbors(X)` inclui cada ponto como seu primeiro vizinho, e a última coluna é o limiar exato para `min_samples=m`: um ponto é core exatamente quando esse valor é no máximo `eps`. Chamar `kneighbors()` sem argumento exclui o próprio ponto e dá a distância um vizinho adiante.

### Quando um limiar único de densidade falha

O DBSCAN usa um só `Eps` e um só `MinPts` para todos os clusters. Ester et al. enunciam a restrição: dois conjuntos com pelo menos a densidade do cluster mais rarefeito só ficam separados se a distância entre eles for maior que `Eps`. Seja $e$ o menor `Eps` que conecta o cluster mais esparso, e $g$ a menor distância entre dois clusters que precisam continuar separados.

**Condição.** Um único ajuste só pode recuperar todos os clusters se $e<g$. A diferença de densidade sozinha, portanto, não é a falha: ela ocorre quando o cluster esparso exige um `Eps` de pelo menos a distância entre dois outros clusters. O Exemplo 4 roda os dois casos.

A hipótese de densidade importa. No Exemplo 2, conte o ponto em 2 no cluster esquerdo: a distância dele ao cluster direito é 1, igual a `eps`, e os clusters continuam separados, porque esse ponto não é core.

### Tempo de execução: afirmação, correção, réplica

Ester et al. afirmam um tempo *médio* de $O(n\log n)$, supondo vizinhanças pequenas em relação ao espaço dos dados, de modo que uma consulta na R*-tree custe $O(\log n)$ em média.

- Gan e Tao (2015), seguindo Gunawan (2013), chamam a cota de afirmação equivocada (*mis-claim*): $n$ consultas de intervalo custam $O(n^2)$ no pior caso, e se todos os pontos estão a até `Eps` uns dos outros, só a saída dessas consultas já é quadrática.
- Para $d=2$, eles creditam a Gunawan (2013) um algoritmo genuinamente $O(n\log n)$. Para $d\ge3$, provam uma cota inferior condicional: $\Omega(n^{4/3})$, a menos que USEC ($d=3,4$) ou o problema de Hopcroft ($d\ge5$) possam ser resolvidos em $o(n^{4/3})$. Também apresentam o DBSCAN $\rho$-aproximado, com tempo esperado $O(n)$ para $d$ fixo e $\rho$ constante.
- Schubert et al. (2017), uma réplica cujos autores incluem os quatro autores originais, argumentam no resumo que a crítica cabe à suposição sobre o desempenho dos índices, não ao algoritmo. Relatam também que os métodos de 2015 não parecem oferecer benefício prático quando os parâmetros são bem escolhidos.

O algoritmo original é, portanto, quadrático no pior caso, e execuções rápidas exigem um índice que funcione e um `eps` que mantenha as vizinhanças pequenas. O próprio benchmark de Ester et al., em dados geográficos de pontos, foi de 3,1 s com 1252 pontos a 41,7 s com 12512, um fator de 13,5 para dez vezes mais dados. A documentação do scikit-learn traz um alerta à parte: sua implementação guarda todas as vizinhanças, então a memória pode chegar a $O(n^2)$ quando `eps` é grande e `min_samples` é baixo.

## Exemplos Resolvidos

### Exemplo 1: à mão, com `Eps=1.5`, `MinPts=4`

```text
A(0,0)  B(1,0)  C(0,1)  D(1,1)  E(2,1)  F(4,1)
G(6,0)  H(7,0)  I(6,1)  J(7,1)  K(11,4)
```

As distâncias não nulas que importam são 1 e $\sqrt2$, depois 2, então nenhuma distância é igual a `Eps`. Contagens de vizinhança, com o próprio ponto:

```text
ponto  vizinhança    contagem  papel
A      A B C D       4         core
B      A B C D E     5         core
C      A B C D       4         core
D      A B C D E     5         core
E      B D E         3         borda (de B e D)
F      F             1         ruído
G-J    G H I J       4         core
K      K             1         ruído
```

Visitando a partir de $A$: $A$ é core, então o cluster recebe $A,B,C,D$, e $B$ acrescenta $E$. $E$ não é core e não acrescenta nada. $F$ é ruído. $G$ é core e gera o segundo cluster. $K$ é ruído. `DBSCAN(eps=1.5, min_samples=4)` devolve `[0 0 0 0 0 -1 1 1 1 1 -1]`.

A convenção muda a resposta. Com `min_samples=5`, a leitura "4 vizinhos além de si mesmo", o conjunto core encolhe para $B,D$ e o grupo $G,H,I,J$ vira ruído: `[0 0 0 0 0 -1 -1 -1 -1 -1 -1]`.

O deslocamento também: $A$ é core em 1,5, e `kneighbors(X)` com 4 lhe dá 1,4142. O `kneighbors()` sem o próprio ponto dá 2,2361, o que sugeriria, errado, que $A$ não é core.

### Exemplo 2: um ponto de borda que troca de dono

Onze pontos numa reta: $0;\ 0{,}25;\ 0{,}5;\ 0{,}75;\ 1$, depois $2$, depois $3;\ 3{,}25;\ 3{,}5;\ 3{,}75;\ 4$, com `eps=1`, `min_samples=4`. As contagens são `5 5 5 5 6 3 6 5 5 5 5`, então o ponto em 2 é de borda, ao alcance dos pontos core em 1 e 3.

```text
ordem das linhas   cluster do ponto em 2       pontos core
como listado       esquerdo                    10
invertida          direito                     10
```

Em 1000 ordens de linhas `rng.permutation(11)` de um só `rng = numpy.random.default_rng(0)`, ele entrou no cluster esquerdo 504 vezes e no direito 496. O conjunto core ficou igual em todas, pois só depende de contagens.

### Exemplo 3: clusters não convexos

Use `make_moons(n_samples=400, noise=0.05, random_state=0)`, com `MinPts=4`. O 4-dist sem o próprio ponto tem percentil 99 de 0,136 e máximo de 0,151, sem cauda isolada, então um valor perto de 0,15 é a escolha natural. Essa é a receita do artigo, um vizinho além do necessário: a coluna exata para `min_samples=4`, da seção acima, tem máximo de 0,140, então 0,15 é um valor seguro, não o exato.

```text
eps     clusters  ruído  ARI
0.05       34      125   0.034
0.10        3        3   0.920
0.15        2        0   1.000
0.30        2        0   1.000
0.50        1        0   0.000

KMeans(2, n_init=10, random_state=0)                ARI 0.274
GaussianMixture(2, n_init=5, random_state=0), full  ARI 0.503
```

O ARI é definido em `cluster-validation`, e 1 significa exatamente as luas verdadeiras. O DBSCAN nunca vê os rótulos, que só pontuam esta execução exploratória.

### Exemplo 4: um cluster esparso e uma distância pequena derrotam um `eps` único

Com um só `rng = numpy.random.default_rng(42)`, sorteie 150 pontos de cada uma de três gaussianas esféricas, nesta ordem, com `rng.normal(center, sigma, (150, 2))`: $A$ em $(0,0)$ e $B$ em $(1{,}2;\ 0)$ com $\sigma=0{,}15$, e $C$ em $(6,6)$ com $\sigma=1$. Varra `eps` de 0,05 a 2,00 em passos de 0,01, com `min_samples=5`.

```text
eps    clusters  A,B separados?  pedaços de C  ruído em C  ARI
0.13      2      sim             0             150         0.967
0.33      9      sim             7              46         0.812
0.34      6      não             5              46         0.405
0.57      2      não             1              14         0.528
```

Os pontos mais próximos de $A$ e $B$ estão a 0,333, então eles só se separam abaixo disso, como Ester et al. preveem para conjuntos mais próximos que `Eps`. $C$ só vira um pedaço único a partir de 0,57, embora seu maior pedaço já tenha 102 dos 150 pontos em 0,36. Enquanto $A$ e $B$ ficam separados, esse pedaço tem no máximo 65 pontos, então nenhum `eps` da varredura faz as duas coisas. A primeira linha é a armadilha: seu ARI de 0,967 vem de $C$ inteiro rotulado como ruído, e o ARI trata o rótulo de ruído como mais um cluster. Ester et al. apontam o problema da fusão e sugerem uma execução recursiva com `MinPts` maior. Um método hierárquico de densidade lida com estes dados: `HDBSCAN(min_cluster_size=20)` encontra 3 clusters com 1 ponto de ruído, ARI 0,99.

Não é a diferença de densidade que quebra esta execução. Mantenha os mesmos sorteios e desloque $B$ ao longo do eixo $x$, de modo que seu centro fique em $(s,0)$. Repita a varredura e guarde os valores de `eps` em que $A$ e $B$ são um cluster cada, e $C$ é um pedaço único com pelo menos 130 pontos:

```text
s      dist. A-B  eps que funciona  ruído nas pontas   ARI nas pontas
1.20   0.333      nenhum
1.44   0.567      nenhum
1.45   0.577      0.57              14                 0.957
1.50   0.627      0.57 a 0.62       14 a 8             0.957 a 0.974
2.00   1.124      0.57 a 1.12       14 a 1             0.957 a 0.997
12.0   11.12      0.57 a 2.00       14 a 0             0.957 a 1.000
```

Aqui $e=0{,}57$, e a janela vai de $e$ até logo abaixo da distância (a varredura para em 2,00), então ela abre exatamente quando $g>e$. As densidades são as mesmas em todas as linhas. Remover $B$ de vez também funciona: $A$ e $C$ sozinhos dão 2 clusters em `eps=0.57`, com 14 pontos de ruído, todos em $C$, e ARI 0,915.

### Exemplo 5: quanto custa um `eps` grande

Sorteie $n$ pontos uniformes no quadrado unitário com um só gerador, `rng = numpy.random.default_rng(1)` e depois `rng.random((n, 2))` para $n=2000,4000,8000$ nessa ordem, sem nova semente. Conte o total de pontos devolvidos pelas $n$ consultas, com o próprio ponto:

```text
n       eps=0.01   eps=0.1     eps=1.5
2000      3204     116284      4000000
4000      8996     463632     16000000
8000     28178    1861904     64000000
```

Em `eps=1.5`, toda consulta devolve os $n$ pontos, então a saída é exatamente $n^2$, seja qual for o índice. Em `eps=0.1`, dobrar $n$ quadruplica a saída, porque um `eps` fixo sobre dados mais densos significa vizinhanças maiores. O `eps` pequeno só adia isso: sua vizinhança média cresce de 1,6 para 3,5 pontos na tabela, perto de $1+(n-1)\pi\,\mathrm{eps}^2$.

## Equívocos Comuns e Armadilhas

- **"O DBSCAN é $O(n\log n)$."** Esse é o caso médio do artigo, com um índice que funcione e vizinhanças pequenas.
- **"Pontos de borda tornam o DBSCAN aleatório."** Pontos core e ruído são fixados pelos dados. O cluster de um ponto de borda compartilhado depende da ordem das linhas, não do acaso: a mesma ordem dá os mesmos rótulos.
- **"Ruído significa outlier."** Ruído depende de `eps` e `MinPts`: no Exemplo 4, um bloco real vira ruído. `outlier-detection-quartiles-distance-based-density-based` trata outliers diretamente.

## Resumo

O DBSCAN cresce clusters por pontos core, os que têm pelo menos `MinPts` pontos a até `Eps`, contando a si mesmos, tanto no artigo quanto no scikit-learn. Pontos core e ruído independem da ordem de visita, ao contrário de um ponto de borda compartilhado por dois clusters. Os clusters podem ter qualquer forma, mas um limiar único de densidade falha quando um cluster esparso exige um `eps` maior que a distância entre dois clusters densos. O valor $O(n\log n)$ é uma média sob uma suposição sobre o índice: o pior caso do algoritmo original é quadrático, $d=2$ tem um algoritmo realmente $O(n\log n)$, e $d\ge3$ tem uma cota condicional $\Omega(n^{4/3})$.

## Documentation Links

- [Ester et al. (1996): A Density-Based Algorithm for Discovering Clusters](https://cdn.aaai.org/KDD/1996/KDD96-037.pdf): as definições, o algoritmo, a heurística de k-dist e a afirmação sobre o caso médio.
- [Gan and Tao (2015): DBSCAN Revisited](https://www.cse.cuhk.edu.hk/~taoyf/paper/sigmod15-dbscan.pdf): a análise de pior caso, a cota inferior condicional e o DBSCAN aproximado.
- [Schubert: list of ACM papers with authorized access](https://www.vitavonni.de/research/acm.html): os links gratuitos do autor para a ACM, entre eles DBSCAN Revisited, Revisited (Schubert et al. 2017).
- [scikit-learn: DBSCAN](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.DBSCAN.html): parâmetros, a convenção de contagem e a nota sobre memória.
- [scikit-learn: HDBSCAN](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.HDBSCAN.html): o método hierárquico de densidade usado no Exemplo 4.
