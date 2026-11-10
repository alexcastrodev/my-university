---
version: 1.0
updatedAt: 2026-11-04
title: "Medidas de Similaridade e Distância"
summary: "Distância e similaridade para dados numéricos, binários e de texto: Euclidiana, Manhattan, Minkowski, Jaccard, Hamming e cosseno, e por que a escolha e a escala mudam o resultado."
---
## Objetivos de Aprendizagem

- Enunciar os quatro axiomas de uma métrica e dizer quais medidas comuns os satisfazem.
- Mostrar um contraexemplo da desigualdade triangular para a distância cosseno, a Euclidiana ao quadrado e a de Minkowski com $p<1$.
- Escolher entre Jaccard, coincidência simples, Hamming e cosseno para dados binários e de texto, mostrando como a escolha muda o resultado.
- Ler as convenções de SciPy e scikit-learn, que diferem dos livros e entre si.
- Mostrar com uma execução que as unidades, a escala e o valor de $p$ mudam, cada um, qual vizinho é o mais próximo.
- Explicar por que uma não métrica pode ser um bom ranking e uma base quebrada para poda.

## Contexto e Motivação

Vizinhos mais próximos, clustering hierárquico, DBSCAN e escores de outlier partem de uma única escolha: o que significa "perto". `the-dot-product-and-vector-norms` deu a norma Euclidiana e o ângulo entre vetores. Esta lição pergunta quais medidas se comportam como distâncias, o que quebra quando não se comportam e quanto a resposta depende de decisões tomadas antes de rodar qualquer algoritmo. `data-preprocessing-missing-values-scaling-discretization` deu as fórmulas de escala, e aqui elas mudam resultados.

## Teoria Central

### O que faz uma métrica

Uma **métrica** num conjunto é uma função $d$ tal que, para todos $x,y,z$:

$$\begin{aligned}
&d(x,y)\ge0, \qquad d(x,y)=0\iff x=y,\\
&d(x,y)=d(y,x), \qquad d(x,y)\le d(x,z)+d(z,y).
\end{aligned}$$

A última é a **desigualdade triangular**: um desvio por $z$ não pode ser mais curto. É ela que permite a um algoritmo pular trabalho. Se $d(q,z)$ e $d(z,x)$ são conhecidas, então $\lvert d(q,z)-d(z,x)\rvert$ é uma cota inferior para $d(q,x)$, então, quando essa cota alcança a melhor distância achada até ali, $x$ pode ser descartado sem calcular $d(q,x)$. Ball trees e a busca por pivôs se apoiam nessa cota.

### Dados numéricos: a família de Minkowski

$$d_p(x,y)=\Big(\sum_{i=1}^n\lvert x_i-y_i\rvert^p\Big)^{1/p}$$

Com $p=1$ esta é a distância de Manhattan, com $p=2$ a Euclidiana e, no limite $p\to\infty$, a de Chebyshev, $\max_i\lvert x_i-y_i\rvert$.

**Propriedade.** Para $p\ge1$, $d_p$ é uma métrica em $\mathbb R^n$; a desigualdade triangular é a desigualdade de Minkowski. A hipótese importa. Para $0<p<1$ e $n\ge2$ a desigualdade triangular falha, pois a bola unitária deixa de ser convexa (Exemplo 1). O MMDS escreve "for any constant $r$" ao definir a norma $L_r$, sem essa condição, então leia com $r\ge1$ em mente. Elevar ao quadrado também quebra a propriedade: a distância Euclidiana ao quadrado não é uma métrica, embora dê o mesmo ranking de vizinhos que a Euclidiana. `k-means-clustering` minimiza distâncias ao quadrado, e tudo bem, porque um objetivo não precisa ser uma métrica.

### Conjuntos e vetores binários

Para dois vetores binários, seja $m_{11}$ a contagem de posições em que ambos têm 1, $m_{10}$ e $m_{01}$ as discordâncias e $m_{00}$ as posições em que ambos têm 0.

$$J=\frac{m_{11}}{m_{11}+m_{10}+m_{01}},\qquad \mathrm{SMC}=\frac{m_{11}+m_{00}}{n},\qquad H=m_{10}+m_{01}$$

A **similaridade de Jaccard** $J$ é $\lvert A\cap B\rvert/\lvert A\cup B\rvert$ em conjuntos e ignora ausências compartilhadas. A **distância de Jaccard** $1-J$ é uma métrica em conjuntos finitos, com $d(\emptyset,\emptyset)=0$ por convenção, já que $J$ é 0/0 nesse caso. O MMDS prova a desigualdade triangular com minhash: $1-J$ é a probabilidade de um minhash aleatório separar os dois conjuntos. A **coincidência simples** (SMC) conta ausências compartilhadas como concordância. A **distância de Hamming** $H$ conta as posições diferentes e é uma métrica em cadeias de mesmo comprimento; não é definida para comprimentos diferentes.

### Cosseno: duas "distâncias cosseno" diferentes

A similaridade do cosseno é $\cos(x,y)=x\cdot y/(\lVert x\rVert\lVert y\rVert)$, definida para vetores não nulos. Duas distâncias levam esse nome:

- **$1-\cos(x,y)$**: a forma de SciPy e scikit-learn. Não é uma métrica.
- **O ângulo $\arccos(\cos(x,y))$**: a forma do MMDS, que a chama de distância cosseno. Satisfaz a desigualdade triangular. O MMDS diz que "do not distinguish between a vector and a multiple of that vector", isto é, não distingue um vetor de um múltiplo dele, e o segundo axioma exige isso: em vetores crus o ângulo é zero para $x\ne y$ quando um é múltiplo positivo do outro. Logo, a métrica vive em direções ou, de modo equivalente, em vetores unitários.

Uma frase dizendo que "a distância cosseno é uma métrica" e outra dizendo que não é podem estar ambas certas, com definições diferentes.

### Resumo do status

| Medida | Domínio | Métrica? | Motivo |
|---|---|---|---|
| Euclidiana, Manhattan, Chebyshev | $\mathbb R^n$ | sim | desigualdade de Minkowski, $p\ge1$ |
| Minkowski, $0<p<1$ | $\mathbb R^n$, $n\ge2$ | não | triangular falha, Exemplo 1 |
| Euclidiana ao quadrado | $\mathbb R^n$ | não | triangular falha, Exemplo 1 |
| Distância de Jaccard | conjuntos finitos | sim | argumento de minhash no MMDS |
| Hamming | cadeias de mesmo comprimento | sim | cada passo precisa de uma posição trocada |
| $1-\cos$ | vetores não nulos | não | triangular falha; também $d=0$ para $x\ne y$ |
| Ângulo | direções | sim | composição de rotações no MMDS |

### Convenções das bibliotecas

Executado na SciPy 1.18.1 e no scikit-learn 1.9.1:

```text
chamada                                resultado  nota
scipy hamming([1,0,1,1], [1,1,0,1])    0.5        uma fracao, nao a contagem 2
scipy jaccard([0,0,0], [0,0,0])        0.0        definido como zero para dois vetores nulos
scipy jaccard([1,2,0], [1,3,0])        0.0        entradas lidas como booleanos (SciPy 1.15+; antes dava 0.5)
scipy cosine([0,0], [1,1])             nan        vetor nulo
sklearn cosine_distances, mesma entrada 1.0       vetor nulo recebe similaridade 0
```

## Exemplos Resolvidos

Sempre que um vizinho mais próximo é apontado abaixo, as distâncias comparadas não têm empate, então nenhuma regra de desempate entra em jogo.

### Exemplo 1: três contraexemplos

Cada um foi calculado com `scipy.spatial.distance`. Violar a desigualdade triangular significa que o ponto do meio dá um caminho mais curto.

```text
medida             x       z       y       d(x,z)   d(z,y)   soma     d(x,y)
1 - cos            (1,0)   (1,1)   (0,1)   0.2929   0.2929   0.5858   1.0000
Euclidiana^2       (0)     (1)     (2)     1        1        2        4
Minkowski p=0.5    (0,0)   (1,0)   (1,1)   1        1        2        4
```

À mão: no primeiro, $1-1/\sqrt2=0{,}2929$. No terceiro, $(\sqrt1+\sqrt1)^2=4$. Os mesmos três pontos mostram o conserto para o cosseno: os ângulos são $45^\circ$, $45^\circ$ e $90^\circ$, e $45+45\ge90$ vale com igualdade. $1-\cos$ também falha no axioma da identidade: $d((1,2),(2,4))=0$ para dois vetores diferentes.

### Exemplo 2: uma checagem aleatória, que não é prova

Tome `rng = numpy.random.default_rng(0)`, sorteie `X = rng.normal(size=(20000, 3, 5))` (20.000 trios de pontos em 5 dimensões) e depois `B = rng.integers(0, 2, (20000, 3, 20)).astype(bool)`. Uma violação é $d(a,b)>d(a,c)+d(c,b)+10^{-12}$.

```text
medida             violacoes em 20000
Euclidiana         0
Manhattan          0
Chebyshev          0
Minkowski p=3      0
angulo             0
Hamming (em B)     0
Jaccard (em B)     0
Euclidiana^2       2538
1 - cos            1617
Minkowski p=0.5    451
```

Zero violações não provam nada, e por isso a coluna de métrica se apoia em argumentos para todos os pontos, não em amostras. Para o ângulo, o próprio MMDS diz que a desigualdade triangular "is best argued by physical reasoning". Uma única violação refuta a propriedade, e as não métricas falham com frequência, não só em pontos construídos.

### Exemplo 3: $p$ muda o vizinho mais próximo

Consulta na origem, $A=(3,3)$, $B=(4{,}5;\,0)$:

```text
p            0.5      1      2       4       infinito
d(A)         12.00    6.00   4.24    3.57    3.00
d(B)         4.50     4.50   4.50    4.50    4.50
mais proximo B        B      A       A       A
```

$d_p(A)=3\cdot2^{1/p}$, então elas se cruzam onde $2^{1/p}=1{,}5$, em $p=1{,}71$. Um $p$ baixo penaliza espalhar uma diferença por várias coordenadas, e um $p$ alto só olha a maior delas.

### Exemplo 4: dados binários e ausências compartilhadas

Num catálogo de 1000 itens, $A=\{1,2\}$, $B=\{1,2,3\}$ e $C=\{4,5\}$:

```text
par    m11 m10 m01 m00   Jaccard   SMC     cosseno  Hamming   scipy hamming
A,B    2   0   1   997   0.667     0.999   0.816    1         0.001
A,C    0   2   2   996   0.000     0.996   0.000    4         0.004
```

A coincidência simples dá 0,996 a $A$ e $C$, embora não compartilhem item nenhum, porque quase todos os itens faltam nos dois. Em dados esparsos em que o 1 é o evento raro, como cestas ou documentos, Jaccard ou cosseno servem melhor. SMC combina com dados em que os dois valores carregam informação.

### Exemplo 5: cosseno e tamanho do documento

Com contagens de termos $q=(2,1,0)$, $d_1=(20,10,0)$ e $d_2=(1,2,1)$, $d_1$ é $q$ repetido dez vezes:

```text
           Euclidiana  1 - cos
q a d1     20.12       0.0000
q a d2     1.73        0.2697
```

A Euclidiana escolhe $d_2$ e o cosseno escolhe $d_1$. O que os separa é o tamanho: em texto, um documento mais longo em geral não é outro assunto, e por isso `text-mining-bag-of-words-and-tf-idf` usa cosseno. Em vetores unitários as duas visões concordam, pois $\lVert u-v\rVert^2=2(1-\cos(u,v))$: aqui $2(0{,}2697)=0{,}5394$ é a distância ao quadrado entre os vetores normalizados. Logo, a distância Euclidiana em vetores unitários, $\sqrt{2(1-\cos)}$, ordena exatamente como $1-\cos$ e é uma métrica de verdade.

### Exemplo 6: a escala muda o vizinho mais próximo

Cinco clientes de referência e uma consulta:

```text
linha  age   income
A      31    58000
B      62    52500
C      45    90000
D      25    30000
E      55    70000
Q      30    52000
```

À mão, em unidades cruas, $d(Q,B)=\sqrt{32^2+500^2}=501{,}02$ e $d(Q,A)=\sqrt{1^2+6000^2}=6000{,}00$. Cada escalador abaixo foi ajustado só nas cinco linhas de referência, sem a consulta, com médias de z-score $(43{,}6;\ 60100)$ e desvios padrão $(13{,}966;\ 19800)$.

```text
escala               ordem dos vizinhos com distancias
unidades cruas       B 501.02, A 6000.00, E 18000.02, D 22000.00, C 38000.00
renda em milhares    A 6.08, D 22.56, E 30.81, B 32.00, C 40.85
z-score              A 0.311, D 1.167, E 2.008, C 2.199, B 2.291
min-max              A 0.104, D 0.391, E 0.739, C 0.752, B 0.865
```

Em unidades cruas, o cliente mais próximo de alguém de 30 anos tem 62 anos, porque um dólar pesa mais que um ano. Mudar só a unidade da renda inverte isso: a distância não é invariante a unidades, então ficar com o "cru" também é uma decisão. Quando um escalador é usado dentro de um modelo, ajuste-o só nos dados de treino.

Os escaladores também podem discordar entre si. Para as linhas de referência $(19,7)$, $(0,7)$, $(16,7)$, $(15,10)$, $(42,11)$ e a consulta $(6,19)$, o z-score escolhe $(15,10)$ a 5,205 em vez de $(42,11)$ a 5,306, enquanto a min-max escolhe $(42,11)$ a 2,176 em vez de $(15,10)$ a 2,260. O outlier 42 estica a amplitude da min-max mais que o desvio padrão.

A escala não é automaticamente certa, porque dá peso igual a toda coluna. Tome `rng = numpy.random.default_rng(0)`, $n=2000$, `x = rng.normal(0, s, n)`, `y = x > 0`, inverta `y` onde `rng.random(n) < 0.1` e acrescente `rng.normal(0, t, (n, 3))` como três colunas de ruído. Com 5-NN, as 1000 primeiras linhas para treino e o z-score ajustado nelas, a acurácia de teste nas outras 1000 linhas é:

```text
coluna de sinal   colunas de ruido   cru     z-score
s = 1000          t = 0.01           0.898   0.852
s = 0.01          t = 1000           0.508   0.852
```

Quando o ruído por acaso tem a escala pequena, o z-score o promove e a acurácia cai. Quando o ruído tem a escala grande, o z-score resgata o sinal. Nos dois casos, a escolha embute uma afirmação sobre quais colunas importam.

### Exemplo 7: uma não métrica quebra a poda

Tome `rng = numpy.random.default_rng(0)` e normalize para comprimento unitário `D = rng.normal(size=(2000, 8))`, depois `Q = rng.normal(size=(1000, 8))`, depois um pivô `p = rng.normal(size=8)`. Para cada consulta, visite os itens em ordem crescente da cota $\lvert d(q,p)-d(x,p)\rvert$ e pare quando a cota alcançar a melhor distância achada. O vizinho verdadeiro é o item de maior produto escalar.

```text
distancia  vizinho errado (em 1000 consultas)   distancias calculadas por consulta (de 2000)
1 - cos    402                                  332
angulo     0                                    1113
```

A busca com a não métrica parece três vezes mais barata e devolve a resposta errada em 40% das vezes, já que a sua "cota" não é cota. O ângulo paga pela correção. As bibliotecas se protegem disso. No scikit-learn 1.9.1, `BallTree(X, metric="cosine")` levanta `ValueError`, e `NearestNeighbors(metric="cosine")` recorre à força bruta, assim como `p=0.5`, com o aviso "Mind that for 0 < p < 1, Minkowski metrics are not distance metrics".

## Equívocos Comuns e Armadilhas

- **"A distância cosseno é uma métrica" ou "não é".** Diga qual. $1-\cos$ não é, e o ângulo é, em direções.
- **"Uma não métrica é inútil."** Como ranking, $1-\cos$ serve, e a Euclidiana ao quadrado ordena os vizinhos exatamente como a Euclidiana. O que falha é qualquer passo que dependa da desigualdade triangular, como no Exemplo 7.
- **"A distância de Minkowski funciona para qualquer $p$."** A fórmula calcula para qualquer $p>0$. As propriedades de métrica exigem $p\ge1$.
- **"Escalar é sempre certo."** O Exemplo 6 mostra a acurácia caindo de 0,898 para 0,852.
- **"Dados sem escala são neutros."** Dados sem escala pesam as colunas pelas unidades. Trocar dólares por milhares mudou o vizinho mais próximo.
- **"Similaridade de 0,996 significa parecido."** A coincidência simples deu isso a duas cestas sem nada em comum.
- **"O nome na biblioteca é o do livro."** O Hamming da SciPy é uma fração e, desde a SciPy 1.15, o Jaccard dela lê inteiros como booleanos.

## Resumo

Uma métrica é não negativa, zero só para pontos idênticos, simétrica e obedece à desigualdade triangular. Minkowski com $p\ge1$, Jaccard em conjuntos, Hamming em cadeias de mesmo comprimento e o ângulo em direções são métricas. $1-\cos$, a Euclidiana ao quadrado e Minkowski com $p<1$ não são, cada uma com um contraexemplo de três pontos. "Distância cosseno" nomeia duas medidas, então confira a definição antes de chamá-la de métrica. A escolha da medida e da escala muda resultados: $p$ trocou um vizinho em 1,71, a coincidência simples deu 0,996 a cestas disjuntas e trocar a renda para milhares substituiu um vizinho de 62 anos por um de 31. A escala é uma afirmação sobre quais colunas importam e pode ajudar ou atrapalhar. Uma não métrica pode ordenar bem, mas a poda triangular sobre $1-\cos$ devolveu o vizinho errado em 402 de 1000 consultas. A distância Euclidiana em vetores unitários dá o mesmo ranking com uma métrica de verdade.

## Documentation Links

- [Leskovec, Rajaraman, and Ullman, Mining of Massive Datasets, chapter 3 (archived copy)](https://web.archive.org/web/2023/http://infolab.stanford.edu/~ullman/mmds/ch3n.pdf): a seção 3.5 sobre axiomas de distância, normas $L_r$ e distâncias de Jaccard, cosseno e Hamming.
- [SciPy, scipy.spatial.distance.cosine](https://docs.scipy.org/doc/scipy/reference/generated/scipy.spatial.distance.cosine.html): a definição $1-\cos$.
- [SciPy, scipy.spatial.distance.jaccard](https://docs.scipy.org/doc/scipy/reference/generated/scipy.spatial.distance.jaccard.html): entradas booleanas e a convenção para vetores nulos.
- [SciPy, scipy.spatial.distance.hamming](https://docs.scipy.org/doc/scipy/reference/generated/scipy.spatial.distance.hamming.html): a fração de posições que discordam.
- [SciPy, scipy.spatial.distance.minkowski](https://docs.scipy.org/doc/scipy/reference/generated/scipy.spatial.distance.minkowski.html): a distância da norma $p$.
- [scikit-learn, cosine_distances](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.pairwise.cosine_distances.html): a definição par a par como um menos a similaridade do cosseno.
- [scikit-learn, BallTree](https://scikit-learn.org/stable/modules/generated/sklearn.neighbors.BallTree.html): o índice em árvore e suas métricas válidas.
- [scikit-learn, NearestNeighbors](https://scikit-learn.org/stable/modules/generated/sklearn.neighbors.NearestNeighbors.html): como a métrica e o algoritmo são escolhidos.
- [scikit-learn, StandardScaler](https://scikit-learn.org/stable/modules/generated/sklearn.preprocessing.StandardScaler.html): o escalador usado no Exemplo 6.
