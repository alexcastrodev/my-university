---
version: 1.0
updatedAt: 2026-11-04
title: "k-Vizinhos Mais Próximos (k-NN)"
summary: "O k-NN como aprendizado preguiçoso: classificação e regressão por vizinhos, escolha de k, empates, a cota de Cover e Hart com suas hipóteses, a maldição da dimensionalidade medida e as estruturas de índice que tornam as consultas viáveis."
---
## Objetivos de Aprendizagem

- Enunciar a regra do k-NN para classificação e regressão.
- Resolver empates de distância e de voto, inclusive empates de voto com $k$ ímpar.
- Escolher $k$ por validação cruzada, com o scaler dentro dos folds.
- Enunciar a cota de Cover e Hart e a condição da concentração de distâncias com suas hipóteses, medir as duas e quebrar cada uma.
- Decidir, por medição, quando um índice em árvore vence a varredura linear.

## Contexto e Motivação

`similarity-and-distance-measures` definiu as distâncias. O k-NN é o jeito mais direto de usar uma delas: para prever um ponto novo, encontre os pontos de treino mais próximos e deixe que eles respondam. Nos termos de `the-supervised-unsupervised-and-reinforcement-taxonomy`, é aprendizado supervisionado, para classificação e regressão. Seu $k$ conta vizinhos rotulados e não tem relação com o $k$ de `k-means-clustering`, um número de clusters.

O k-NN é **preguiçoso** (lazy): o ajuste só guarda os dados e o trabalho passa para a previsão.

## Teoria Central

### A regra

Tome pares de treino $(x_1,y_1),\dots,(x_n,y_n)$, uma distância $d$ (euclidiana aqui) e uma consulta $q$. Seja $N_k(q)$ o conjunto de índices dos $k$ pontos de treino mais próximos. Então

$$\hat y_{\text{class}}(q)=\arg\max_c\sum_{i\in N_k(q)}w_i\,\mathbf 1[y_i=c],\qquad \hat y_{\text{reg}}(q)=\frac{\sum_{i\in N_k(q)}w_iy_i}{\sum_{i\in N_k(q)}w_i}.$$

O voto uniforme usa $w_i=1$. A ponderação por distância usa $w_i=1/d(q,x_i)$, que é `weights="distance"` no scikit-learn. Um ponto de treino a distância 0 dividiria por zero, então o scikit-learn dá peso 1 aos vizinhos a distância zero e 0 aos demais. Uma varredura linear custa $O(nd)$ por consulta para $n$ pontos em $d$ dimensões, e os $n$ pontos ficam em memória.

### Empates fazem parte do algoritmo

A fórmula deixa dois empates indefinidos.

- **Empate de distância.** $N_k(q)$ não é único quando a $k$-ésima e a $(k+1)$-ésima distâncias são iguais. O guia do scikit-learn avisa que o resultado passa a depender da ordem dos dados de treino.
- **Empate de voto.** O $\arg\max$ não é único. Com duas classes e pesos uniformes, um $k$ ímpar elimina o caso, porque duas contagens de soma ímpar são diferentes. Com três classes não elimina: $k=3$ pode dar 1-1-1 e $k=5$ pode dar 2-2-1.

O scikit-learn resolve o empate de voto uniforme pegando a primeira classe na ordem dos rótulos.

### Escolhendo k

Com $k=1$, a previsão acompanha cada ponto de treino, e a acurácia de treino é 1, salvo se pontos idênticos tiverem rótulos diferentes. Com $k=n$ e pesos uniformes, toda consulta recebe a mesma resposta, a classe majoritária ou a média global. É `the-bias-variance-tradeoff`: $k$ pequeno tem viés baixo e variância alta, e $k$ grande, o contrário. A acurácia de treino não escolhe $k$, então quem escolhe é `cross-validation`, com o scaler reajustado em cada fold, como `data-preprocessing-missing-values-scaling-discretization` exige.

### A cota de Cover e Hart

Seja $R^*$ o risco de Bayes, o menor erro que uma regra pode atingir conhecendo a distribuição verdadeira. Seja $R(n)$ o erro esperado do 1-NN com $n$ pares de treino e $R=\lim_{n\to\infty}R(n)$.

**Teorema (Cover e Hart, 1967).** Suponha que:

1. os pares de treino e o par de teste sejam independentes e identicamente distribuídos;
2. $x$ assuma valores num espaço métrico separável;
3. as $M$ densidades de classe sejam tais que, com probabilidade um, $x$ seja ponto de continuidade de todas elas ou ponto de probabilidade não nula;
4. a perda seja 0-1, com $k=1$ fixo quando $n\to\infty$.

Então

$$R^*\le R\le R^*\Big(2-\frac{M}{M-1}R^*\Big),$$

o que, para $M=2$, dá $R\le 2R^*(1-R^*)$, e essas cotas são as mais justas possíveis para essa classe de distribuições. O resultado é sobre o limite: não dá taxa e nada diz sobre $n$ finito. Para $k$ ímpar fixo com duas classes, as cotas superiores justas do artigo caem com $k$ na direção de $R^*$.

### Concentração de distâncias, e sua condição

Fixe o número $n$ de pontos de dados e deixe um parâmetro $m$, em geral a dimensão, indexar uma sequência de distribuições. Para cada $m$, os pontos $P_{m,1},\dots,P_{m,n}$ são sorteados de forma independente de uma mesma distribuição $F_m$, e a consulta $Q_m$ é sorteada de forma independente deles, de uma distribuição que pode ser outra. Seja $d_m$ uma função não negativa de um ponto e uma consulta. Chame de $\text{DMIN}_m$ e $\text{DMAX}_m$ as distâncias da consulta ao ponto mais próximo e ao mais distante.

**Teorema (Beyer et al., 1999).** Sob essas hipóteses, se para alguma constante $0<p<\infty$

$$\lim_{m\to\infty}\operatorname{var}\left(\frac{d_m(P_{m,1},Q_m)^p}{E\big[d_m(P_{m,1},Q_m)^p\big]}\right)=0,$$

então, para todo $\varepsilon>0$, $\lim_{m\to\infty}P\big[\text{DMAX}_m\le(1+\varepsilon)\,\text{DMIN}_m\big]=1$.

O artigo afirma, deixando a análise para seu relatório técnico, que a condição vale para coordenadas IID com momentos finitos até a ordem $\lceil 2p\rceil$ sob uma métrica $L_p$ e para alguns workloads correlacionados, e que falha quando todas as dimensões são cópias umas das outras. Seu workload de dois graus de liberdade também não a satisfaz. O teorema não dá taxa, os autores viram o efeito já com 10 a 15 dimensões e concluem que o workload deve ser conferido por amostragem.

### Estruturas de índice

Uma **k-d tree** divide os dados por uma coordenada de cada vez. Uma **ball tree** aninha hiperesferas, então sua poda usa a desigualdade triangular, sem divisões alinhadas aos eixos. As duas são exatas: a consulta pula qualquer região mais distante que a melhor $k$-ésima distância atual. O guia do scikit-learn dá $O[DN]$ para a força bruta e cerca de $O[D\log N]$ para a k-d tree abaixo de umas 20 dimensões, subindo para perto de $O[DN]$ acima disso, e `algorithm="auto"` escolhe força bruta acima de 15 dimensões, entre outras condições. A ligação com a concentração é uma inferência: quando toda distância está perto da $k$-ésima melhor, poucas regiões podem ser puladas.

Métodos aproximados, como grafos HNSW, trocam exatidão por velocidade, e Beyer et al. avisam que a aproximação pode agravar a instabilidade.

## Exemplos Resolvidos

### Exemplo 1: empates, à mão e no scikit-learn

A consulta é $q=(0,0)$, com sete pontos de treino:

| Ponto | $x$ | Rótulo | Alvo | $d(q,x)$ |
|---|---|---|---|---|
| P1 | (1, 0) | B | 10 | 1 |
| P2 | (0, 2) | C | 20 | 2 |
| P3 | (-3, 0) | A | 30 | 3 |
| P4 | (0, -3) | B | 40 | 3 |
| P5 | (4, 3) | A | 50 | 5 |
| P6 | (5, -1) | C | 60 | 5,099 |
| P7 | (-4, 4) | C | 70 | 5,657 |

Para $k=3$, P3 e P4 empatam no terceiro lugar. `KNeighborsClassifier` (scikit-learn 1.9.1), com `algorithm="brute"` e com `"kd_tree"`, dá:

```text
row order         k  weights    neighbors         prediction
P3 before P4      3  uniform    P1 P2 P3          A   (votes 1-1-1, first label)
P4 before P3      3  uniform    P1 P2 P4          B   (votes B 2, C 1)
P3 before P4      3  distance   P1 P2 P3          B   (B 1.000, C 0.500, A 0.333)
P4 before P3      3  distance   P1 P2 P4          B   (B 1.333, C 0.500)
either            5  uniform    P1 to P5          A   (votes 2-2-1, first label)
either            7  uniform    all               C   (votes C 3, A 2, B 2)
```

Trocar duas linhas mudou a classe em $k=3$, e os dois empates de voto aconteceram com $k$ ímpar. Aqui ficou o ponto empatado que vem primeiro, mas isso é um resultado, não uma regra: quem decide é uma rotina interna de seleção. Nas 5.040 ordens de linhas com coordenadas float, a linha anterior ficou em 4.500 na força bruta e na k-d tree. Com coordenadas inteiras, a força bruta segue outro caminho de código e a manteve em 3.720.

A regressão com $k=3$ na primeira ordem dá $(10+20+30)/3=20$ com pesos uniformes e $(10+10+10)/(1+\tfrac12+\tfrac13)=16{,}36$ com pesos por distância.

### Exemplo 2: escolhendo k no Wine

`sklearn.datasets.load_wine` tem 178 linhas, 13 atributos e 3 classes. Separe 25% com `train_test_split(..., stratify=y, random_state=0)` e rode `StratifiedKFold(5, shuffle=True, random_state=0)` nas outras 133 linhas. As colunas escaladas usam `StandardScaler` mais k-NN num único pipeline:

```text
k    train acc (scaled)   CV acc (scaled)    CV acc (raw features)
1    1.000                0.918 +- 0.049     0.758
3    0.947                0.933 +- 0.049     0.728
5    0.977                0.955 +- 0.043     0.713
15   0.962                0.955 +- 0.044     0.751
51   0.962                0.970 +- 0.028     0.714
101  0.617                0.399 +- 0.019     0.445
```

Sem escala, `proline` (desvio padrão 314) define as distâncias. Cada fold treina com cerca de 106 linhas, então $k=101$ fica perto do voto majoritário e desaba. Entre estes seis valores, a maior média está em $k=51$, mas a distância para $k=5$ é menor que um desvio padrão entre folds. Uma varredura de $k=1$ a 105 empata $k=38$ com $k=51$ em 0,9701 e põe $k=27$ em 0,9698, então os dados não fixam $k$ com precisão. O $k=51$ escolhido fez 0,956 nas 45 linhas separadas, usadas uma só vez, como `cross-validation` exige.

Ajustar o scaler nas 133 linhas antes dos folds deixou cinco destas linhas iguais e moveu $k=3$ de 0,933 para 0,925. De $k=1$ a 105, mudou a média em 61 valores, para cima em 42 e para baixo em 19, em até 0,030. O vazamento pode ser invisível num $k$ e não em outro, então o pipeline fica.

### Exemplo 3: a cota numa distribuição de respostas conhecidas

O exemplo de Cover e Hart tem duas classes igualmente prováveis, com densidades $2x$ e $2(1-x)$ em $[0,1]$, então $x$ é uniforme e $P(\text{classe }1\mid x)=x$. Assim, $R^*=\int_0^1\min(x,1-x)\,dx=\tfrac14$, o limite é $R=\int_0^12x(1-x)\,dx=\tfrac13$ e a cota é $2\cdot\tfrac14\cdot\tfrac34=\tfrac38$. Para $k$ ímpar, o limite é um voto binomial em cada $x$, integrado numericamente. Simulando com `numpy.random.default_rng(0)` reiniciado em cada $n$, sorteando $x$ e depois os rótulos com `rng.uniform(0, 1, n) < x`, para $n$ pares de treino e depois 200.000 pares de teste, com um único sorteio para todos os $k$:

```text
k     exact limit   n=100,000   n=2,000,000
1     0.3333        0.3336      0.3322
3     0.3000        0.2986      0.3006
5     0.2857        0.2848      0.2849
51    0.2547        0.2540      0.2563
201   0.2512        0.2503      0.2527
```

O 1-NN se fixa em 0,333, entre 0,25 e 0,375, e $k$ maior anda na direção de $R^*$.

### Exemplo 4: retire uma hipótese

**$n$ finito em mais dimensões.** Tome duas classes igualmente prováveis, $x$ gaussiano com covariância identidade e médias que diferem só na coordenada 1, em $-1$ e $+1$. As outras coordenadas são ruído, então $d$ não muda $R^*=\Phi(-1)=0{,}1587$. A cota é 0,2670 e o limite do 1-NN, por integração numérica, é 0,2248. Erro do 1-NN, com `default_rng(0)` reiniciado em cada célula e 20.000 pontos de teste:

```text
d    n=100   n=1,000  n=10,000  n=100,000
1    0.225   0.219    0.232     0.223
20   0.313   0.279    0.280     0.263
```

Em $d=20$, o erro fica acima da cota até $n=10.000$ e ainda bem acima do limite em $n=100.000$.

**Pares não identicamente distribuídos.** Seja $x$ uniforme em $[0,1]$ com rótulo verdadeiro $\mathbf 1[x>0{,}5]$, então $R^*=0$ e a cota diz $R=0$. Troque 20% dos rótulos de treino e mantenha limpos os de teste. Com $n=10^6$, `default_rng(0)` e 200.000 pontos de teste, o erro foi 0,202 para $k=1$, 0,058 para $k=5$ e 0 para $k=101$. Treino e teste já não compartilham a distribuição, então a garantia acabou e o 1-NN copia o ruído.

### Exemplo 5: medindo a concentração, e quebrando-a

Use $n=1000$ pontos, 200 consultas, distância euclidiana e `numpy.random.default_rng(0)` reiniciado em cada célula. *Uniform* são coordenadas IID uniformes. *Plane* é o workload de dois graus de liberdade de Beyer, $X_i=a_iU_1+b_iU_2$, em que $a_i,b_i$ são constantes em $(-1,1)$, aqui sorteadas de forma uniforme uma vez por célula, e $U_1,U_2$ são uniformes em $(0,1)$ para cada ponto. *Cauchy* são coordenadas IID de Cauchy padrão, sem média nem variância finitas. *Clustered* tem 10 centros uniformes, ruído gaussiano de desvio padrão 0,01 e cada consulta dentro de um cluster. As células mostram a média de DMAX/DMIN e, entre parênteses, a amostra de $\operatorname{var}(d^2/E[d^2])$:

```text
m      uniform        plane          Cauchy          clustered
2      92.5 (0.71)    113.3 (1.09)   12961 (92)      1019 (0.81)
10     3.86 (0.14)    94.7 (0.72)    1297 (498)      77.9 (0.32)
20     2.41 (0.07)    91.4 (0.73)    2544 (661)      54.0 (0.19)
100    1.43 (0.014)   97.9 (0.77)    986 (118)       36.0 (0.12)
1000   1.12 (0.0014)  96.2 (0.69)    318 (109)       31.3 (0.11)
```

Só *uniform* acompanha o limite do teorema. Em $m=100$, 189 das 200 consultas tiveram DMAX a até 1,5 vez DMIN, e em $m=1000$, todas. *Plane* não muda com $m$, porque a dimensão intrínseca continua 2. *Cauchy* mostra que IID sozinho não basta: falta a hipótese de momentos, uma coordenada enorme domina cada distância e a razão segue nas centenas. *Clustered* mantém o contraste porque o cluster da consulta está muito mais perto que o resto.

Concentração também não é falha de classificação. Com 1000 pontos, rótulos de `rng.integers(0, 2, n)`, duas dimensões gaussianas de variância 1 com médias de classe a 4 de distância na primeira, `default_rng(0)` reiniciado em cada rodada e 5-NN com `StratifiedKFold(5, shuffle=True, random_state=0)`, a acurácia foi 0,969. Acrescentar 998 atributos de ruído gaussiano padrão a levou a 0,754. Mergulhar as duas dimensões em 1000 por um mapa ortonormal manteve 0,969, pois as distâncias não mudam.

### Exemplo 6: quando um índice ajuda

Tome 100.000 pontos uniformes de `default_rng(0)`, $k=5$, `leaf_size=40` e 300 consultas avulsas, com `OMP_NUM_THREADS=1` num Apple M1 Pro, chamadas Python incluídas. A tabela mostra chamadas de distância divididas por $n$, de `get_n_calls()`, e microssegundos por consulta. A contagem da ball tree inclui uma distância por nó visitado, e por isso passa de 1: em $d=50$ ela visita os 100.000 pontos e os 4.095 nós.

```text
d     kd calls/n   ball calls/n   kd us   ball us   brute us
2     0.0009       0.0029         31      33        887
5     0.0058       0.0285         35      48        981
10    0.0588       0.2439         125     252       1109
20    0.9147       1.0408         2722    2283      1495
50    1.0000       1.0410         8740    8071      2281
```

Em $d=20$, as duas árvores visitam quase todos os pontos e perdem para a varredura. A dimensão sozinha não decide isso: 100.000 pontos de um quadrado bidimensional, mergulhados em 50 dimensões por um mapa ortonormal aleatório (o $Q$ de uma fatoração QR de uma matriz gaussiana), deram 0,0011 chamada da k-d tree por ponto e 42 microssegundos, contra 2307 na força bruta.

## Equívocos Comuns e Armadilhas

- **"Um $k$ ímpar evita empates."** Só empates de voto, e só com duas classes e votos uniformes. Empates de distância continuam em qualquer $k$.
- **"O 1-NN é no máximo duas vezes pior que o melhor classificador."** Isso vale no limite, sob as hipóteses. O Exemplo 4 mostra dados finitos acima da cota.
- **"Vizinho mais próximo não faz sentido em alta dimensão."** Depende da condição. *Plane* e *clustered* mantêm o contraste em $m=1000$.

## Resumo

O k-NN guarda os dados e responde pelos $k$ pontos mais próximos, e seus empates pedem uma regra declarada. $k$ é uma escolha entre viés e variância, feita por validação cruzada. Cover e Hart dão a cota de no máximo $2R^*$ para o erro limite do 1-NN sob suas hipóteses, sem afirmar nada sobre $n$ finito. Beyer et al. mostram que as distâncias se concentram quando sua variância relativa some, o que vale para dados uniformes e falha em dados de baixa dimensão ou sem momentos. Árvores ajudam em baixa dimensão intrínseca, então meça o contraste.

## Documentation Links

- [Cover e Hart (1967), Nearest Neighbor Pattern Classification](https://isl.stanford.edu/~cover/papers/transIT/0021cove.pdf): a cota, suas hipóteses e o exemplo das densidades triangulares.
- [Beyer et al. (1999), When Is "Nearest Neighbor" Meaningful?](https://members.loria.fr/MOBerger/Enseignement/Master2/Exposes/beyer.pdf): o teorema da instabilidade, workloads e experimentos.
- [scikit-learn, guia Nearest Neighbors](https://scikit-learn.org/stable/modules/neighbors.html): algoritmos, árvores e complexidade.
- [Malkov e Yashunin, Hierarchical Navigable Small World graphs](https://arxiv.org/abs/1603.09320): busca aproximada de vizinhos em grafos.
