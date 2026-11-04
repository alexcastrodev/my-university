---
version: 1.0
updatedAt: 2026-11-04
title: "O Processo KDD e a Taxonomia de Tarefas de Mineração de Dados"
summary: "O processo KDD, dos dados brutos ao conhecimento validado, e a taxonomia de tarefas com classificação, regressão, clustering, associação e detecção de anomalias, indicando onde este currículo cobre cada uma."
---
## Objetivos de Aprendizagem

- Separar o KDD, o processo inteiro, da mineração de dados, um passo dentro dele, e dizer o que "válido", "novo", "útil" e "compreensível" exigem de um padrão.
- Percorrer os nove passos do KDD numa tabela pequena e mostrar um passo posterior devolvendo o trabalho a um anterior.
- Enquadrar uma tarefa em classificação, regressão, clustering, associação ou detecção de anomalias a partir da pergunta feita, e achar onde o currículo a cobre.
- Comparar esta lista de cinco tarefas com a lista de seis métodos de Fayyad et al. e explicar por que as listas mudam de uma fonte para outra.
- Mostrar com uma execução com semente que uma nota alta nos dados pesquisados não torna um padrão válido.

## Contexto e Motivação

`the-supervised-unsupervised-and-reinforcement-taxonomy` separou os problemas de aprendizado pelo feedback disponível. Esta disciplina faz uma pergunta vizinha: como uma tabela vira algo sobre o qual uma pessoa pode agir, e o que pode dar errado no caminho? A maior parte desse risco fica fora do algoritmo. Um código errado numa coluna, uma pergunta ligada à tarefa errada ou um padrão achado depois de testar mil candidatos podem produzir um resultado de aparência limpa.

Fayyad, Piatetsky-Shapiro e Smyth organizaram essa visão em 1996. Esta lição usa o vocabulário deles para enquadrar a disciplina e situar cada tarefa no currículo. Os algoritmos vêm nas lições seguintes.

## Teoria Central

### KDD é o processo, mineração de dados é um passo

O artigo de 1996 define: "KDD is the nontrivial process of identifying valid, novel, potentially useful, and ultimately understandable patterns in data". Cada palavra é explicada no próprio artigo:

- **Nontrivial (não trivial)**: envolve alguma busca ou inferência. Calcular uma quantidade predefinida, como uma média, não conta.
- **Valid (válido)**: o padrão se sustenta "on new data with some degree of certainty", ou seja, em dados novos, com algum grau de certeza.
- **Novel (novo)**: novo ao menos para o sistema e, de preferência, para o usuário.
- **Potentially useful (potencialmente útil)**: traz algum benefício ao usuário ou à tarefa.
- **Understandable (compreensível)**: se não de imediato, depois de algum pós-processamento.

**Mineração de dados** é algo mais estreito: o passo que aplica algoritmos de descoberta para enumerar padrões dentro de limites práticos de computação. O artigo também define **conhecimento** com modéstia, como um padrão que passa de um limiar de interesse escolhido pelo usuário, e avisa que isso não é uma definição filosófica. Quem fixa a régua é a aplicação, não o algoritmo.

### Os nove passos

A numeração é do artigo, e o texto aqui é um resumo:

| Passo | Trabalho | Retomado em |
|---|---|---|
| 1 | Entender o domínio e o objetivo | todo projeto |
| 2 | Criar o conjunto de dados alvo | `data-warehouses-data-marts-and-olap` |
| 3 | Limpar e pré-processar, inclusive campos faltantes | `data-preprocessing-missing-values-scaling-discretization` |
| 4 | Reduzir e projetar: escolher atributos úteis | `principal-component-analysis` |
| 5 | Ligar o objetivo a um método de mineração | `choosing-a-mining-technique-a-decision-guide` |
| 6 | Escolher o algoritmo e os modelos da busca | as lições de método abaixo |
| 7 | Minerar: buscar padrões | as lições de método abaixo |
| 8 | Interpretar, com possível retorno a qualquer dos passos 1 a 7 | `cluster-validation`, `evaluation-metrics-precision-recall-and-roc` |
| 9 | Agir: usar, embutir ou relatar o conhecimento, resolvendo conflitos com o que se acreditava antes | fora do algoritmo |

A figura 1 do artigo desenha cinco etapas como uma cadeia para a frente, com setas tracejadas de retorno, e o texto avisa que ela omite "the potential multitude of iterations and loops": o processo "can involve significant iteration and can contain loops between any two steps". Ele também diz que, embora a maior parte do trabalho anterior tenha se concentrado no passo 7, "the other steps are as important (and probably more so) for the successful application of KDD in practice". Essa frase é um julgamento do artigo, não uma medição.

### Cinco tarefas e como distingui-las

O artigo divide os objetivos de descoberta em **predição** de valores desconhecidos e **descrição** de padrões para pessoas, e avisa que a fronteira não é nítida. Esta disciplina trabalha com cinco tarefas:

| Tarefa | Pergunta | Coluna alvo? | Primeira checagem de validade | Neste currículo |
|---|---|---|---|---|
| Classificação | Qual classe predefinida? | sim, categórica | acurácia, precisão e recall em dados separados | `logistic-regression-and-decision-boundaries`, `decision-trees`, `k-nearest-neighbors` |
| Regressão | Qual número? | sim, numérica | erro em dados separados | `linear-regression-as-least-squares` |
| Clustering | Que grupos existem? | não | índices internos, estabilidade, leitura do domínio | `k-means-clustering`, `hierarchical-clustering`, `density-based-clustering-with-dbscan`, `cluster-validation` |
| Associação | O que ocorre junto? | não | suporte, confiança e lift em transações novas | `frequent-itemsets-and-the-apriori-algorithm`, `fp-growth`, `association-rules-support-confidence-lift` |
| Detecção de anomalias | Que linhas não se encaixam? | em geral não | inspeção do que foi marcado | `outlier-detection-quartiles-distance-based-density-based` |

O teste é a pergunta, não a tabela. Nos termos de `the-supervised-unsupervised-and-reinforcement-taxonomy`, as duas primeiras são supervisionadas e o clustering é não supervisionado. Aquela lição não cita associação nem detecção de anomalias, que na forma usual também não têm coluna alvo. Com rótulos de anomalia confiáveis, a tarefa vira uma classificação desbalanceada. O aprendizado por reforço fica fora da lista porque a mineração parte de dados já coletados, não de um agente que age para obtê-los.

**As fontes divergem, e esta lista é uma escolha.** Fayyad et al. apresentam seis métodos primários: classificação, regressão, clustering, sumarização, modelagem de dependência e detecção de mudança e desvio. Associação não tem título próprio ali: o artigo cita "Fast Discovery of Association Rules" dentro de sumarização, como fonte de regras de resumo. A detecção de anomalias fica mais perto da detecção de mudança e desvio deles, cujo texto fala de mudanças em relação a valores anteriores ou normativos. Nenhuma das duas listas é uma partição provada do campo.

**Livro vs hoje.** O processo de 1996 termina em agir sobre o conhecimento. O CRISP-DM, metodologia da indústria cuja primeira versão foi apresentada em março de 1999, tem seis fases: entendimento do negócio, entendimento dos dados, preparação dos dados, modelagem, avaliação e implantação. A prática atual dá muito mais peso ao que vem depois da implantação. O guia de MLOps do Google Cloud (revisado em 2024-08-28) diz que "models can decay in more ways than conventional software systems", e por isso estatísticas dos dados e o desempenho em produção são acompanhados depois do lançamento. O laço de 1996 continua servindo, mas agora segue rodando depois do lançamento.

## Exemplos Resolvidos

### Exemplo 1: uma tabela, cinco perguntas

Doze clientes, com visitas por mês, gasto mensal em dólares, se cancelaram (`churned`) e uma cesta:

```text
id   visits spend churned basket
c01  12     310   0       bread milk butter
c02  10     280   0       bread butter
c03  11     295   0       bread butter eggs
c04  9      260   0       milk eggs
c05  13     330   0       bread milk butter
c06  8      240   1       bread butter
c07  3      90    1       milk
c08  2      70    1       eggs
c09  4      110   1       bread
c10  3      95    0       milk eggs
c11  2      60    1       bread milk
c12  4      9999  1       eggs
```

Cinco perguntas, executadas em scikit-learn 1.9.1 e NumPy. O modelo logístico é `make_pipeline(StandardScaler(), LogisticRegression())` com os padrões, então o z-score é ajustado dentro de cada fold do leave-one-out. O k-means lê as duas colunas numéricas depois de um z-score em todas as linhas, o que é exploratório, com `n_init=10` e `random_state=0`. A cerca do IQR vai de $Q_1-1{,}5\,\mathrm{IQR}$ a $Q_3+1{,}5\,\mathrm{IQR}$, com os quartis lineares padrão do NumPy.

```text
tarefa          metodo                     resultado
classificacao   logistica, leave-one-out   9 de 12 corretos
regressao       spend ~ visits, MQO        spend = 1805.34 - 117.59 visits, R^2 = 0.030
clustering      k-means, k = 2             grupos de tamanho 11 e 1
associacao      bread -> butter, contagem  suporte 5/12, confianca 5/7, lift 1.71
anomalia        cerca IQR em spend         Q1 93.75, Q3 298.75, cercas -213.75 e 606.25, marca c12
```

O lift aqui é $\frac{5/12}{(7/12)(5/12)}=\frac{12}{7}=1{,}71$: pão e manteiga aparecem juntos mais vezes do que a independência preveria nessas linhas. Com doze linhas, todo número é ilustração, não evidência.

### Exemplo 2: o passo 8 devolve o trabalho ao passo 3

Ler os resultados é o passo 8, e eles parecem errados. O gasto cai quando as visitas sobem, os grupos são um cliente contra os demais e o $R^2$ fica perto de zero. A linha marcada explica os três: 9999 não é um gasto, é um marcador de "desconhecido". Esse julgamento vem de saber como o dado foi registrado (passo 1), não da cerca, que só diz que o valor é incomum.

De volta ao passo 3, o valor é marcado como faltante e c12 sai das tarefas que leem `spend`. Tudo o que vem depois roda de novo:

```text
tarefa          antes (12 linhas)                     depois (11 linhas com gasto real)
classificacao   9 de 12 corretos                      9 de 11 corretos (erros: c06, c10)
regressao       spend = 1805.34 - 117.59 visits       spend = 18.01 + 25.22 visits
                R^2 = 0.030, LOOCV MAE 1697.1         R^2 = 0.989, LOOCV MAE 10.6
clustering      tamanhos 11, 1                        tamanhos 6 (c01-c06), 5 (c07-c11)
anomalia        c12 marcado                           nada marcado (cercas -200, 580)
associacao      sem mudanca: nunca le spend e mantem as 12 cestas
```

O dano foi desigual. Regressão e clustering mudaram por completo. A classificação manteve os mesmos dois erros nas linhas que restaram, então continua com nove acertos, e a taxa subiu de 0,75 para 0,82 só porque c12, que ela errava, saiu da tabela. A associação não se mexeu. Retirar c12 também é uma decisão com a sua própria suposição, examinada em `data-preprocessing-missing-values-scaling-discretization`. Se um valor extremo é erro ou é o achado, esse é o assunto de `outlier-detection-quartiles-distance-based-density-based`.

### Exemplo 3: "válido" quer dizer em dados novos

O artigo avisa: "Blind application of data-mining methods (rightly criticized as data dredging in the statistical literature) can be a dangerous activity, easily leading to the discovery of meaningless and invalid patterns." Esta execução mostra o efeito. Tome `rng = numpy.random.default_rng(2026)` e, nesta ordem, `y = rng.integers(0, 2, 200)`, `X = rng.integers(0, 2, (200, 1000))` e `planted = numpy.where(rng.random(200) < 0.75, y, 1 - y)`. As 1000 colunas de `X` são ruído. A coluna plantada concorda com `y` em 75% das vezes. A regra candidata de uma coluna prevê `y` por aquele bit, invertido se isso pontuar melhor nas 100 primeiras linhas. A busca usa essas 100 linhas, e as outras 100 ficam separadas.

```text
regra                  acuracia, 100 linhas pesquisadas   acuracia, 100 linhas separadas
coluna plantada        0.76                               0.74
melhor coluna de ruido 0.67                               0.40
```

Na mesma execução, 68 colunas de ruído chegaram a pelo menos 0,60 nas linhas pesquisadas, e a média delas nas linhas separadas foi 0,498. Nas sementes de 0 a 99, com `default_rng(seed)` sorteando `y` e depois 1000 colunas de ruído do mesmo jeito, a melhor coluna de ruído (empates vão para o menor índice) teve média de 0,671 nas linhas pesquisadas (mínimo 0,64, máximo 0,73) e 0,501 nas linhas separadas.

Uma única coluna de ruído tem desvio padrão de 0,05 em 100 linhas, então 0,67 fica a cerca de 3,4 desvios padrão, algo comum para a melhor de 1000 tentativas. É o risco de muitas hipóteses de `training-test-and-validation-splits`, agora com uma busca por padrões no lugar de uma busca por modelos. Só a coluna de dados separados distingue o padrão real dos sortudos. Aqui o sinal foi plantado, então o resultado pode ser comparado com a verdade, algo que dados reais não oferecem.

## Equívocos Comuns e Armadilhas

- **"KDD e mineração de dados são sinônimos."** O uso cotidiano costuma tratá-los assim. No artigo de 1996, mineração de dados é o passo 7 de um processo de nove, e essa distinção é chamada de ponto central.
- **"O processo é um pipeline."** Ele tem laços. O Exemplo 2 voltou do passo 8 ao passo 3 por causa de um único valor.
- **"A tarefa pertence aos dados."** O Exemplo 1 fez cinco perguntas à mesma tabela. Quem escolhe a tarefa é a pergunta.
- **"Uma nota forte nos dados pesquisados mostra um padrão."** A melhor coluna de ruído fez 0,67 e depois 0,40 nas linhas separadas.
- **"Limpar melhora todo resultado."** No Exemplo 2, nenhuma resposta da classificação mudou nas 11 linhas restantes, e a associação não mudou. A limpeza muda o que depende do valor ruim.
- **"Lift ou cluster explicam o porquê."** Lift 1,71 diz que pão e manteiga coocorrem nessas cestas. Clusters dizem que clientes se parecem. Nenhum dos dois diz que uma variável causa outra.
- **"Estas cinco tarefas são a lista padrão."** Fayyad et al. dão seis, com outros nomes. Confira o que uma fonte quer dizer antes de comparar.

## Resumo

KDD é o caminho inteiro dos dados ao conhecimento, e a mineração de dados é o seu sétimo passo. Fayyad et al. pedem que os padrões sejam válidos em dados novos, inéditos, potencialmente úteis e compreensíveis, e definem conhecimento em relação a limiares fixados pelo usuário. Os nove passos formam um laço, não uma linha: no Exemplo 2, um único valor marcador desfez uma regressão e um clustering, e a interpretação devolveu o trabalho à limpeza. As cinco tarefas desta disciplina são classificação, regressão, clustering, associação e detecção de anomalias, escolhidas pela pergunta e não pela tabela, e outras fontes dividem o campo de outro jeito. Um padrão achado por busca precisa de dados novos antes de contar: a melhor de 1000 colunas de ruído fez 0,67 onde foi achada e 0,40 fora dali.

## Documentation Links

- [Fayyad, Piatetsky-Shapiro, and Smyth (1996), From Data Mining to Knowledge Discovery in Databases](https://ojs.aaai.org/aimagazine/index.php/aimagazine/article/view/1230): as definições, os nove passos e os seis métodos primários.
- [Wikipedia, Cross-industry standard process for data mining](https://en.wikipedia.org/wiki/Cross-industry_standard_process_for_data_mining): as seis fases do CRISP-DM, a data da primeira versão e a iteração entre as fases.
- [Google Cloud, MLOps: Continuous delivery and automation pipelines in machine learning](https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning): o que o monitoramento acrescenta depois da implantação.
- [NumPy, numpy.percentile](https://numpy.org/doc/stable/reference/generated/numpy.percentile.html): os métodos de quartil, inclusive o linear padrão usado aqui.
- [scikit-learn, Cross-validation](https://scikit-learn.org/stable/modules/cross_validation.html): o leave-one-out, o particionador usado na execução.
