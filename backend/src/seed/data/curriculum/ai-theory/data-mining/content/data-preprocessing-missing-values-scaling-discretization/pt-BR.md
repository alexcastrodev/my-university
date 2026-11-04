---
version: 1.0
updatedAt: 2026-11-04
title: "Pré-processamento de Dados: Valores Faltantes, Escala, Discretização"
summary: "Limpeza de dados antes da mineração: mecanismos de valores faltantes e imputação, escala min-max e z-score, discretização e o vazamento causado por ajustar um passo de pré-processamento no conjunto inteiro."
---
## Objetivos de Aprendizagem

- Enunciar as definições de MCAR, MAR e MNAR e como diferem do texto de Rubin de 1976.
- Dizer o que os dados observados mostram ou não sobre o mecanismo e medir o viés de cada tratamento sob cada mecanismo.
- Aplicar escala min-max, z-score e robusta e discretizar por largura e por frequência, apontando as variantes que mudam os números.
- Medir o vazamento de ajustar um passo no conjunto inteiro e dizer quando ele é grande.

## Contexto e Motivação

`the-kdd-process-and-the-data-mining-task-taxonomy` mostrou um único valor marcador desfazendo uma regressão. Esta lição é o passo 3 daquele processo. O tratamento certo de um valor faltante depende do motivo da falta, e escala e faixas têm variantes que mudam a saída. Todos esses passos aprendem com dados, então encontram a regra de `training-test-and-validation-splits`: o que é medido em dados separados não pode ter sido usado no ajuste. Esta lição estende essa regra ao pré-processamento.

## Teoria Central

### Por que os valores faltam

Seja $Y$ o dado completo, dividido em observado $Y_{obs}$ e faltante $Y_{mis}$, e seja $R$ o registro de quais entradas foram observadas. Na forma usada pela maioria dos autores posteriores:

$$\begin{aligned}
\text{MCAR:}\quad & P(R\mid Y_{obs},Y_{mis})=P(R)\\
\text{MAR:}\quad & P(R\mid Y_{obs},Y_{mis})=P(R\mid Y_{obs})\\
\text{MNAR:}\quad & P(R\mid Y_{obs},Y_{mis})\ \text{ainda depende de }Y_{mis}
\end{aligned}$$

Em **MCAR**, a falta não se relaciona com os dados: um coletor perde registros em horários aleatórios. Em **MAR**, ela depende só de valores registrados: pessoas mais velhas pulam mais a pergunta de renda, e a idade está registrada. Em **MNAR**, depende do próprio valor não registrado, mesmo dado o que está registrado: quem ganha muito esconde a renda. O mecanismo também é relativo às colunas disponíveis: registrar uma variável que explica a falta pode transformar MNAR em MAR.

**Aviso de variante.** Rubin (1976) introduziu "missing at random" e "observed at random" e não usou o termo MCAR. Seaman et al. (2013) citam a frase dele: "The missing data are missing at random if for each possible value of the parameter φ, the conditional probability of the observed pattern of missing data, given the missing data and the value of the observed data, is the same for all possible values of the missing data". Isso trata do padrão realizado, sob um modelo hipotético. A maioria dos autores posteriores usa uma condição mais forte, sobre todos os padrões e valores, o "everywhere MAR" de Seaman et al., e as fórmulas acima são lidas assim. O resultado prático, no resumo do relatório de Rubin: em inferência bayesiana, o processo da falta pode em geral ser ignorado se e somente se os dados são MAR e os parâmetros "independentes".

### O que os dados observados podem e não podem dizer

- **Podem rejeitar MCAR.** Em MCAR, linhas com e sem entrada faltante diferem só por acaso nas colunas observadas, então uma diferença clara o refuta.
- **Não podem confirmar MCAR.** Um teste sem diferença pode estar olhando a coluna errada (Exemplo 1).
- **Não podem separar MAR de MNAR.** Molenberghs et al. (2008) mostram que "each MNAR model fit to a set of observed data can be reproduced exactly by an MAR counterpart", embora os dois prevejam valores diferentes para o que não foi observado.

Logo, a escolha se apoia em conhecimento externo: uma amostra de acompanhamento dos não respondentes, como o dado foi coletado (um sensor com teto conhecido) ou uma análise de sensibilidade sob vários desvios supostos de MAR. Um modelo MNAR ajustado não resolve a questão, porque a forma dele já é uma suposição inverificável.

### Tratamentos

- **Análise de casos completos** descarta linhas. Pode enviesar uma média, mas isso depende do alvo: quando a falta depende só de um preditor, a inclinação da regressão sobrevive (Exemplo 1).
- **Imputação pela média** preserva a média observada, não consegue aumentar a dispersão e baixou a correlação em todas as execuções do Exemplo 1.
- **Imputação por regressão** preenche $\hat y(x)$. Recupera a média em MAR com o preditor no modelo, mas os valores ficam sobre a reta, então a correlação passa da verdade. Somar um resíduo sorteado (imputação por regressão estocástica) restaura a dispersão em MAR, não em MNAR (Exemplo 1: 8,90 contra 10,79 verdadeiros).
- **Imputação múltipla** repete o sorteio várias vezes, sorteando de novo os parâmetros da regressão além do resíduo, e combina os resultados, levando a incerteza do preenchimento aos erros padrão finais. Repetir só o sorteio do resíduo ainda subestima essa incerteza (Van Buuren, seção 3.2).

### Escala

| Nome | Fórmula | Resultado nos dados do ajuste |
|---|---|---|
| Min-max | $x'=(x-x_{min})/(x_{max}-x_{min})$ | exatamente $[0,1]$ |
| Z-score | $z=(x-\bar x)/s$ | média 0, $s$ igual a 1 |
| Robusta | $r=(x-\mathrm{mediana})/\mathrm{IQR}$ | mediana 0, IQR igual a 1 |

Três variantes pesam. `StandardScaler` divide pelo desvio padrão populacional (`ddof=0`), enquanto `pandas.Series.std` usa $n-1$. `RobustScaler` usa os quartis lineares do NumPy, uma regra entre várias. E a última coluna tem hipóteses. Vale só nos dados do ajuste: um valor novo pode sair de $[0,1]$. Um divisor também pode ser zero: numa coluna constante nas três, e na escala robusta em qualquer coluna com IQR 0, como `1 1 1 1 9`. O scikit-learn então divide por 1, de modo que uma coluna constante vira zeros e o IQR igual a 1 não vale.

As três são afins (deslocam e reescalam), então uma coluna assimétrica continua assimétrica. Métodos de distância são sensíveis à escala, então a escolha importa (veja `similarity-and-distance-measures`). Uma árvore de decisão não é: reescalar uma coluna move limiares sem mudar a partição das linhas.

### Discretização

A discretização de **largura igual** corta a amplitude em $k$ intervalos de largura $(x_{max}-x_{min})/k$, então um outlier estica as faixas. A de **frequência igual** corta em quantis, e empates podem impedir contagens iguais. A **supervisionada** escolhe os cortes usando o alvo, então é um passo que lê o alvo, no sentido da próxima seção. As bordas dependem de convenções (Exemplo 4).

### Vazamento

A regra: tudo o que aprende com dados é ajustado só no treino e depois aplicado ao resto. Na validação cruzada, isso é ajustar dentro de cada fold, o que `make_pipeline(SimpleImputer(), StandardScaler(), model)` sob `cross_val_score` faz sozinho. O Exemplo 5 mede o tamanho do erro. Os Exemplos 1 a 4 são exploratórios, sem modelo em avaliação, então ajustam em tudo o que veem.

## Exemplos Resolvidos

### Exemplo 1: três mecanismos, medidos

Tome $n=100.000$ e `rng = numpy.random.default_rng(42)`. Sorteie nesta ordem `age = rng.normal(45, 12, n)`, `e = rng.normal(0, 8, n)`, `u = rng.random(n)`, com `income = 20 + 0.6 * age + e`. Uma renda falta quando `u < p`, com o mesmo `u` abaixo e $\sigma$ a função logística. Verdade: média 46,99, desvio padrão 10,79, correlação com a idade 0,669.

```text
mecanismo  p                       falta    media dos      imputacao    inclinacao  dif. idade  Welch
                                            casos compl.   regressao    compl.      (falt-obs)  p
MCAR       0.4                     0.400    47.05          47.03        0.599       -0.07       0.36
MAR        sigma((age-45)/6-0.5)   0.422    43.30          47.03        0.602      +14.69       <1e-300
MNAR       sigma((income-47)/5-.5) 0.429    41.23          43.19        0.457      +10.02       <1e-300
MNAR-e     sigma(e/4-0.5)          0.426    42.84          42.83        0.601       -0.04       0.57
```

A imputação por regressão usa a idade. A linha MAR erra por 3,69 com casos completos e se recupera com a regressão, e a inclinação dos casos completos, 0,602, fica no 0,6 verdadeiro. A linha MNAR melhora só em parte. Na última linha, a idade não se relaciona com a falta, então o teste de Welch nada acha ($p=0{,}57$), imputar pela idade nada faz, e a média erra por 4,15. Dispersão e correlação depois de imputar:

```text
                       verdade MCAR    MAR     MNAR    MNAR-e
DP, imputacao media    10.79   8.36    7.56    6.51    7.37
DP, estocastica        10.79   10.78   10.80   8.90    9.71
corr, imputacao media  0.669   0.519   0.362   0.405   0.568
corr, regressao        0.669   0.758   0.765   0.722   0.828
```

Os resíduos estocásticos são `default_rng(7).normal(0, s, n)`, com $s$ o desvio padrão dos resíduos dos casos completos, sorteados para todas as linhas, somados só onde a renda falta, e o gerador reiniciado a cada mecanismo.

### Exemplo 2: mesmos dados observados, resposta diferente

Seja $X\in\{0,1\}$ sempre observado e $Y\in\{0,1\}$ às vezes faltante. Isto é tudo o que os dados mostram:

```text
       P(Y=0, observado)  P(Y=1, observado)  P(Y faltante)
X=0    0.30               0.10               0.10
X=1    0.15               0.15               0.20
```

A tabela não diz como a massa "faltante" se divide entre $Y=0$ e $Y=1$. Duas escolhas, em aritmética exata:

```text
                                       Modelo A (MAR)   Modelo B (MNAR)
P(Y=1 | X, faltante)                   0.25, 0.50       0.80, 0.80
P(observado | X=0, Y=0)                0.8              15/16 = 0.9375
P(observado | X=0, Y=1)                0.8              5/9 = 0.5556
P(observado | X=1, Y=0)                0.6              15/19 = 0.7895
P(observado | X=1, Y=1)                0.6              15/31 = 0.4839
P(Y=1)                                 0.375            0.49
```

No Modelo B, $P(Y=1)=0{,}10+0{,}10(0{,}8)+0{,}15+0{,}20(0{,}8)=0{,}49$. Os dois reproduzem cada célula da tabela observada, então nenhum teste nela escolhe entre eles.

### Exemplo 3: uma coluna, três escalas

A coluna é `2, 4, 4, 5, 7, 9, 100`, com média 18,714, $s=33{,}251$ (`ddof=0`) ou $35{,}915$ (`ddof=1`), mediana 5 e quartis lineares 4 e 8.

```text
x             2       4       4       5       7       9       100
min-max       0.000   0.020   0.020   0.031   0.051   0.071   1.000
z, ddof=0    -0.503  -0.443  -0.443  -0.412  -0.352  -0.292   2.445
z, ddof=1    -0.465  -0.410  -0.410  -0.382  -0.326  -0.270   2.263
robusta      -0.75   -0.25   -0.25    0.00    0.50    1.00    23.75
```

À mão, $(9-2)/98=0{,}071$ e $(100-5)/4=23{,}75$. O outlier espreme seis valores em $[0;\,0{,}071]$ na min-max, e a escala robusta os mantém separados. Com a min-max ajustada só nos seis primeiros valores, 100 vira 14,0 e 1 vira $-0{,}143$, ambos fora de $[0,1]$. As regras de quartil também diferem: nesta coluna, $Q_3$ é 8 (`linear`), 7 (`lower`), 9 (`higher`) ou 8,67 (`median_unbiased`).

### Exemplo 4: as mesmas faixas não são as mesmas

Idades `18 22 22 22 25 30 31 35 40 42 44 47 52 58 90`, três faixas. A largura é $(90-18)/3=24$, então uma borda interna cai exatamente em 42.

```text
metodo                                bordas                     contagens  faixa de 42
pandas.cut                            17.928, 42, 66, 90         10 4 1     0
KBinsDiscretizer uniform              18, 42, 66, 90             9 5 1      1
pandas.qcut                           18, 28.33, 42.67, 90       5 5 5      1
KBinsDiscretizer quantile avg. i-CDF  18, 30, 44, 90             5 5 5      1
```

`pandas.cut` fecha as faixas à direita, enquanto `KBinsDiscretizer` as fecha à esquerda, então a mesma borda manda 42 para faixas diferentes. `pandas.cut` também baixa a primeira borda em 0,1% da amplitude para incluir 18. O valor 90 deixa quase vazia a faixa superior de largura igual. A linha de quantil de `KBinsDiscretizer` usa o padrão `"averaged_inverted_cdf"` do scikit-learn 1.9.1, e `quantile_method="linear"` dá as bordas de `qcut`.

Empates quebram a frequência igual. Para `1 1 1 1 1 1 2 3 4 5`, as bordas das três faixas são 1, 1, 2, 5. `pandas.qcut` levanta `ValueError: Bin edges must be unique`, salvo com `duplicates="drop"`, e `KBinsDiscretizer` descarta a faixa vazia. Os dois então devolvem duas faixas, mas o lado fechado muda o destino do valor 2: `pandas.qcut` dá contagens 7 e 3, e `KBinsDiscretizer` com o padrão dá 6 e 4. Com `quantile_method="linear"` ele dá 7 e 3, só porque o arredondamento deixa a borda em 2,000000000000001.

### Exemplo 5: qual o tamanho do vazamento?

Cada linha ajusta o passo em todos os dados, roda validação cruzada de 5 folds só no modelo ("tudo") e compara com o pipeline, em média sobre as sementes de 0 a 199, com `default_rng(s)` para os dados e `KFold(5, shuffle=True, random_state=s)`. As duas primeiras linhas usam `Z = rng.normal(size=(n + 20000, 10))`, `y = (Z[:, 0] + Z[:, 1] + rng.normal(size=n + 20000) > 0)` e `X = Z * numpy.geomspace(1, 1000, 10)`, e as 20.000 linhas extras medem a acurácia verdadeira. As células faltantes são `rng.random(X.shape) < 0.3`, sorteadas depois de `y`. Nas três últimas linhas, as colunas são sorteadas primeiro, `rng.integers(0, 100, n)` para as categorias ou `rng.normal(size=(n, p))` para as colunas numéricas, e depois `y = rng.integers(0, 2, n)`, que é ruído puro, então a acurácia verdadeira é 0,5. `SelectKBest` usa o padrão `f_classif`. A target-mean encoding troca uma categoria pela média de `y` no treino, e uma categoria inédita pela média geral. Logit é `LogisticRegression(max_iter=1000)`.

```text
passo, depois modelo         dados                               tudo    pipeline  verdade  diferenca (EP)
z-score, 5-NN                n=100, 10 colunas                   0.677   0.677     0.683    +0.0002 (0.0013)
imputacao media, z, 5-NN     idem, 30% das celulas faltam, MCAR  0.610   0.612     0.619    -0.0022 (0.0019)
target-mean encoding, logit  n=1000, 100 categorias, y ruido     0.621   0.502     0.500    +0.1197 (0.0012)
SelectKBest(10), logit       n=1000, 100 colunas, y ruido        0.562   0.501     0.500    +0.0616 (0.0013)
SelectKBest(20), logit       n=100, 1000 colunas, y ruido        0.823   0.497     0.500    +0.3259 (0.0043)
```

As duas primeiras diferenças ficam a menos de dois erros padrão de zero: aqui, com folds aleatórios, não se detectou vazamento de escala nem de imputação pela média. Esses passos estimam no máximo dois números por coluna e nunca leem `y`. As notas do pipeline ficam abaixo da verdade por outro motivo: ele treina em 80 linhas, não 100.

Os outros três passos leem `y`, então os rótulos de teste moldam os atributos, e em ruído puro toda a diferença é vazamento: de 0,06 a 0,33 aqui. A última linha é um caso de estresse, com muito mais colunas que linhas, não um resultado típico. Um pipeline acrescenta uma linha de código e elimina a dúvida. Todos os folds foram aleatórios, então a tabela nada diz sobre dados ordenados no tempo.

## Equívocos Comuns e Armadilhas

- **"MAR significa que os valores faltam ao acaso."** MAR permite dependência forte de colunas registradas: a diferença de idade no Exemplo 1 foi de 14,69 anos.
- **"Sem diferença entre os grupos, é MCAR."** A linha MNAR-e passou com $p=0{,}57$ e uma média errada por 4,15.
- **"Imputar pela média é inofensivo porque a média fica."** Em MCAR, isso baixou a correlação de 0,669 para 0,519.

## Resumo

A falta depende de nada (MCAR), de valores registrados (MAR) ou dos próprios valores faltantes (MNAR). Os dados observados podem refutar MCAR, não podem confirmá-lo e não separam MAR de MNAR. A regressão recuperou uma média em MAR e não em MNAR, e a imputação pela média encolheu a dispersão em todas as execuções. Os escaladores são afins e prometem suas faixas só nos dados do ajuste, e as faixas de discretização diferem entre bibliotecas. Ajuste todo passo só nos dados de treino, sobretudo os que leem o alvo: a diferença foi 0,0002 na escala e até 0,33 em seleção de atributos sobre ruído.

## Documentation Links

- [Seaman et al. (2013), What Is Meant by "Missing at Random"?](https://arxiv.org/pdf/1306.2812): a frase de Rubin e MAR realizado e em todo lugar.
- [Rubin, Inference and Missing Data (ETS record, 1975)](https://www.ets.org/research/policy_research_reports/publications/report/1975/hrri.html): o resumo da versão em relatório do artigo de 1976.
- [Molenberghs et al. (2008), Every missingness not at random model has a missingness at random counterpart with equal fit](https://researchonline.lshtm.ac.uk/id/eprint/7959): registro e resumo.
- [Van Buuren, Flexible Imputation of Missing Data, section 1.2](https://stefvanbuuren.name/fimd/sec-MCAR.html): os três mecanismos em termos simples.
- [Van Buuren, section 3.2](https://stefvanbuuren.name/fimd/sec-linearnormal.html): regressão estocástica e sorteio de parâmetros comparados.
- [Van Buuren, section 3.8](https://stefvanbuuren.name/fimd/sec-nonignorable.html): dados não ignoráveis e análise de sensibilidade.
- [scikit-learn, Common pitfalls and recommended practices](https://scikit-learn.org/stable/common_pitfalls.html): vazamento no pré-processamento e pipelines.
- [scikit-learn, Preprocessing data](https://scikit-learn.org/stable/modules/preprocessing.html): os escaladores.
- [scikit-learn, KBinsDiscretizer](https://scikit-learn.org/stable/modules/generated/sklearn.preprocessing.KBinsDiscretizer.html): estratégias de faixas e métodos de quantil.
- [pandas, pandas.cut](https://pandas.pydata.org/docs/reference/api/pandas.cut.html): faixas fechadas à direita e a extensão da amplitude.
- [pandas, pandas.qcut](https://pandas.pydata.org/docs/reference/api/pandas.qcut.html): faixas por quantis e bordas duplicadas.
