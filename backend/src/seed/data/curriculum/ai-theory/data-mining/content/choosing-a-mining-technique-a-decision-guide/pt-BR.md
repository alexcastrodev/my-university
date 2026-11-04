---
version: 1.0
updatedAt: 2026-11-04
title: "Escolhendo uma Técnica de Mineração: Um Guia de Decisão"
summary: "Um guia de decisão para toda a disciplina: a partir dos dados e da pergunta, escolher uma tarefa de mineração e uma técnica, e dizer o que invalidaria o resultado."
---
## Objetivos de Aprendizagem

- Transformar uma pergunta numa tarefa de mineração, nomeando a decisão, a unidade de análise e a existência ou não de um alvo.
- Escolher uma técnica dentro da tarefa a partir das propriedades dos dados, usando as falhas medidas de cada método.
- Escrever, antes de rodar qualquer coisa, o resultado que invalidaria a conclusão.
- Construir uma referência do que o acaso produz, para regras e para clusters, e dizer o que ela preserva e o que destrói.
- Reconhecer quando a pergunta pertence a uma consulta SQL ou a aprendizado supervisionado, e não à mineração.

## Contexto e Motivação

A maioria das técnicas desta disciplina produz saída sobre dados sem padrão nenhum: k-means devolve $k$ grupos sempre que os dados têm pelo menos $k$ pontos distintos, LOF dá nota a todas as linhas e Apriori lista o que passar do limiar. As lições anteriores mediram o que isso significa. O lift chegou a 13,99 em itens independentes em `association-rules-support-confidence-lift`, ruído teve um melhor $k$ em `cluster-validation`, um corpus sem tópicos alcançou silhouette 0,540 em `a-text-clustering-pipeline-end-to-end`, e em `the-kdd-process-and-the-data-mining-task-taxonomy` a melhor de 1000 colunas de ruído marcou 0,67 onde foi encontrada e 0,40 fora dali.

Escolher uma técnica, portanto, tem duas metades. Uma é casar o método com a pergunta e os dados. A outra é decidir de antemão o que mostraria que a saída é vazia. Este guia cobre as duas. Ele não ensina os métodos de novo: cada linha aponta para a lição que faz isso, e `choosing-and-validating-a-model-a-decision-guide` é a contraparte para modelos supervisionados.

## Teoria Central

### Quatro perguntas antes de qualquer técnica

1. **Que decisão muda com a resposta?** Se nenhuma ação depende do resultado, nada indica quando a análise terminou.
2. **Qual é a unidade?** Um cliente, uma visita, uma sessão, um documento. A unidade define o grão da tabela (`data-warehouses-data-marts-and-olap`) e o que "parecido" ou "junto" pode significar. Itens comprados numa visita e itens comprados por um cliente ao longo de um ano são cestas diferentes, e dão regras diferentes.
3. **Existe um alvo?** Se as linhas têm um rótulo conhecido que as novas devem receber, o problema é supervisionado. Vá para `choosing-and-validating-a-model-a-decision-guide`, com `k-nearest-neighbors` como baseline.
4. **Como isto ficaria se não houvesse nada ali?** Responda antes de rodar. Depois, qualquer saída é fácil de explicar.

Uma pergunta de formato conhecido, como receita por região no último trimestre, é consulta e não tarefa de mineração: `GROUP BY` responde exatamente.

### Da pergunta à tarefa

| Pergunta | Tarefa | Comece por | Invalidada por |
|---|---|---|---|
| Que rótulo ou valor uma nova linha terá? | Classificação, regressão | `k-nearest-neighbors`, `choosing-and-validating-a-model-a-decision-guide` | Nota em dados separados que não supera um baseline simples |
| Quais itens ocorrem juntos? | Associação | `frequent-itemsets-and-the-apriori-algorithm`, `fp-growth`, `association-rules-support-confidence-lift` | Lift perto de 1 em cestas separadas, ou tantas regras quanto em cestas embaralhadas |
| Estas linhas formam grupos? | Clustering | A próxima tabela | Nota que não supera a de dados sem grupos, ou grupos diferentes numa segunda amostra |
| Quais linhas não se encaixam? | Detecção de anomalias | `outlier-detection-quartiles-distance-based-density-based` | Casos plantados com rank baixo, ou linhas marcadas que a inspeção mostra serem comuns |

Texto é um tipo de dado, não outra tarefa: `text-mining-bag-of-words-and-tf-idf` transforma documentos em vetores, e as mesmas linhas passam a valer, como em `a-text-clustering-pipeline-end-to-end`. Toda linha depende ainda da preparação de `data-preprocessing-missing-values-scaling-discretization` e de uma medida de `similarity-and-distance-measures`. Uma distância escolhida por padrão continua sendo uma decisão.

### Escolhendo um método de clustering

| Método | Você fornece | Encontra | Quebra em | Custo |
|---|---|---|---|---|
| k-means (`k-means-clustering`) | $k$ | Grupos compactos | Formas alongadas ou aninhadas | Uma passada pelos dados por iteração |
| Ward (`hierarchical-clustering`) | Dados euclidianos, um corte | Grupos compactos, todos os $k$ de uma vez | As mesmas formas, e fusões não se desfazem | A matriz de distâncias $\Theta(n^2)$ costuma ser o limite |
| Single linkage (`hierarchical-clustering`) | Uma distância, um corte | Cadeias e formas arbitrárias | Pontes e pontos soltos | Tempo quadrático |
| DBSCAN (`density-based-clustering-with-dbscan`) | `Eps`, `MinPts` | Formas arbitrárias, mais ruído | Grupos densos mais próximos entre si do que o `Eps` de que um grupo esparso precisa | Pior caso quadrático no algoritmo original |

### Escolhendo uma regra de outliers

Comece pelo que "não se encaixa" significa. A regra dos quartis olha uma coluna por vez: é barata e fácil de explicar, e não enxerga uma linha cujos valores são normais separadamente e raros em conjunto. Regras baseadas em distância veem a linha inteira, mas usam uma única escala global. LOF compara um ponto com seus próprios vizinhos e não tem limiar universal. Se uma linha marcada é erro ou é o achado depende de onde os dados vieram, não da nota.

### Apriori ou FP-Growth

Com o mesmo limiar os dois devolvem os mesmos itemsets, então essa escolha muda o custo e não a resposta. Nos tempos de `fp-growth`, cada um venceu em parte das linhas, então meça nos dados e na implementação que você tem. O limiar é a escolha que muda a resposta, como mostra o Exemplo 2.

### Quantos dados

Os custos em escala são memória para contadores e passadas pelos dados (`mining-at-scale-from-mapreduce-to-spark`). Uma amostra basta quando o padrão buscado é comum, e pode perder por completo um padrão raro, então itemsets raros e eventos raros precisam dos dados inteiros. Vá para um cluster de máquinas quando os dados ou os contadores não couberem mais em uma só. O cluster muda o custo e os modos de falha; não torna um resultado válido, e os testes deste guia continuam valendo.

### O que uma referência preserva e o que destrói

Uma referência é uma versão dos dados sem a estrutura alegada e com o resto preservado. A parte difícil é escolher o que preservar.

- **Regras:** embaralhe cada coluna de item separadamente. Isso preserva a frequência de cada item e destrói a coocorrência. Também muda o tamanho das cestas. Swap randomization preserva os totais de linha e de coluna (Zaki e Meira, capítulo 12).
- **Clusters:** sorteie de uma Gaussiana com a média e a covariância dos dados. Isso preserva a correlação e destrói os grupos.
- **Texto:** um corpus de controle sem tópicos, como em `a-text-clustering-pipeline-end-to-end`.
- **Outliers:** plante casos do tipo que interessa e veja o rank deles. Isso nada diz sobre outros tipos.

Passar por uma referência elimina uma explicação, o acaso sob aquele modelo. Não mostra que o padrão é útil nem causal.

## Exemplos Resolvidos

Todas as execuções usam scikit-learn 1.9.1, mlxtend 0.25.0 e NumPy 2.5.4.

### Exemplo 1: uma pergunta, três formas

Três conjuntos de 600 pontos, cada um em z-score: `make_blobs(600, centers=3, cluster_std=0.6, random_state=7)`; `make_moons(600, noise=0.05, random_state=7)`; e `make_blobs([300, 300], centers=[[0, 0], [6, 0]], cluster_std=[0.3, 1.8], random_state=7)`. k-means (`n_init=10`, `random_state=7`) e os dois linkages recebem o $k$ verdadeiro. DBSCAN usa `eps=0.3`, `min_samples=5` nos três. A tabela mostra o ARI contra os rótulos que geraram os dados.

```text
                 k-means    Ward   single   DBSCAN
blobs              1.000   1.000    1.000    1.000
moons              0.489   0.522    1.000    1.000
two densities      0.902   0.973    0.000    0.892
```

Nenhuma coluna vence todas as linhas. Single linkage é perfeito em moons e marca 0,000 em duas densidades, onde seu corte separa um ponto solto dos outros 599. O 0,892 do DBSCAN vem de 37 pontos do blob difuso marcados como ruído, que o ARI conta como um terceiro rótulo; nos outros 563 pontos seu ARI é 1,000. A tabela favorece todos os métodos com um $k$ ou um `eps` que uma análise real teria de descobrir, e o ARI só existe aqui porque os rótulos foram gerados. A função da tabela é essa: registrar qual método serve a qual forma, de modo que a forma dos dados precisa ser examinada primeiro.

### Exemplo 2: doze regras, um fato

```python
rng = numpy.random.default_rng(7)
n, p = 2000, [.30, .15, .35, .25, .40, .20, .30, .25]    # itens A a H
T = rng.random((n, 8)) < p
T[:, 1] = numpy.where(T[:, 0], rng.random(n) < .70, rng.random(n) < .10)
```

Só existe uma dependência: B acompanha A. As regras saíram de `apriori` nas primeiras 1000 cestas, mantendo confiança de pelo menos 0,3 e lift de pelo menos 1,2. Uma regra se sustenta se seu lift for pelo menos 1,2 nas últimas 1000 cestas. A última coluna minera 200 embaralhamentos das cestas de treino, com sementes 1000 a 1199, nos mesmos limiares.

```text
        todas    regras com A e B      outras regras     regras embaralhadas
minsup  regras   qtde   sustentam     qtde  sustentam     mediana    max
 0.05     12       12       12           0       0            0        7
 0.02     31       27       26           4       0           13       44
 0.01     94       63       57          31       2         45.5      143
```

Em 0,05 todas as regras se sustentam, com lift de 2,23 a 2,72 no treino e de 2,35 a 2,88 fora dele, e as doze afirmam o mesmo fato: regras como $\{B,C\}\to A$ são A e B mais um item independente. Conte fatos, não regras. Baixar o limiar para 0,01 multiplicou as regras por cerca de 8 e não acrescentou fato algum, já que o gerador não contém outra dependência. Nesse limiar, cestas sem dependência nenhuma dão uma mediana de 45,5 regras. Dados separados e embaralhamento respondem a perguntas diferentes: o primeiro pergunta se a regra persiste, e o segundo, quantas regras esses limiares produzem do acaso. Um embaralhamento chegou a 7 regras em 0,05, então mediana 0 não é garantia.

### Exemplo 3: uma referência para clusters

Tome os blobs do Exemplo 1. Com k-means como no Exemplo 1, construa uma cópia com cada coluna embaralhada e um sorteio de uma Gaussiana com a mesma média e covariância, ambos de `default_rng(7)`, nessa ordem. Estabilidade é a mediana e o mínimo do ARI, nas sementes $s=0,\dots,49$, entre k-means ajustados em duas metades aleatórias, cada um predizendo as 600 linhas, com `default_rng(s)` separando as linhas e `random_state=s` no k-means.

```text
                        silhouette em k                    estabilidade, k=3
                      2      3      4      5      6         mediana    min
dados               0.769  0.755  0.682  0.618  0.497        1.000   1.000
colunas embaralh.   0.460  0.552  0.627  0.634  0.647        0.992   0.765
Gaussiana           0.523  0.473  0.442  0.430  0.407        0.786   0.329
```

Em 100 sorteios da Gaussiana, com sementes 0 a 99, o silhouette em $k=3$ foi de 0,445 a 0,516, muito abaixo dos 0,755 dos dados. Esse é o teste passando.

A linha embaralhada teria enganado. Ela marca 0,647 em $k=6$ com estabilidade 1,000 nesse $k$ (mínimo 0,989), porque a primeira coluna tem três modas separadas e a segunda tem duas, e o embaralhamento preserva ambas. O resultado é uma grade $3\times2$ de seis grupos, com o pico do silhouette exatamente em seis. Embaralhar colunas testa, portanto, estrutura além das marginais, e não estrutura em geral.

Mais duas leituras. A linha Gaussiana tem estabilidade 0,786, porque uma partição de uma elipse se repete bem, então uma partição estável não precisa ser real. E o silhouette prefere $k=2$ nos dados, 0,769 contra 0,755, enquanto o ARI é 0,571 em $k=2$ e 1,000 em $k=3$. A referência diz que os grupos existem. Ela não escolhe o $k$.

### Exemplo 4: outliers que nenhuma coluna mostra

Tome 990 linhas com `rng = numpy.random.default_rng(7)`, `z = rng.normal(size=(990, 2))`, primeira coluna $z_1$ e segunda coluna $0{,}98z_1+\sqrt{1-0{,}98^2}\,z_2$. Plante 10 linhas fora da diagonal: $(\pm1{,}5,\mp1{,}5)$, $(\pm1,\mp1)$, $(\pm2,\mp1)$, $(\pm1{,}5,\mp0{,}5)$, $(\pm0{,}5,\mp1{,}5)$.

```text
regra dos quartis, por coluna, quartis padrão do NumPy, cercas perto de -2.6 e 2.6
    marcou 7 linhas, 0 delas plantadas
LOF, 20 vizinhos
    as 10 linhas plantadas no top 10
    menor plantada 5.94, maior normal 3.91, mediana das normais 1.02
```

Cada valor plantado é comum na própria coluna, e só a combinação é rara, então uma regra por coluna não consegue achá-lo. O teste cobre um tipo de anomalia: linhas plantadas longe da diagonal nada dizem sobre um grupo coeso de fraude dentro da região normal.

### Exemplo 5: uma decisão do começo ao fim

Uma equipe de suporte tem 80.000 tickets em texto livre, sem categorias, e pergunta o que automatizar primeiro.

1. **Decisão:** qual categoria recebe uma resposta automática. **Unidade:** o ticket.
2. **Alvo:** nenhum ainda, pois não há categorias, então isto não é classificação.
3. **Técnica:** vetores de texto e clustering, como em `a-text-clustering-pipeline-end-to-end`, ajustados em um mês de tickets.
4. **Invalidação, escrita antes:** um corpus de controle dá a mesma nota; clusters ajustados no mês seguinte não coincidem; ou uma pessoa que leia 30 tickets por cluster não consegue nomeá-lo.
5. **Próximo passo:** depois que pessoas nomearem as categorias, existem rótulos e o problema virou supervisionado. O laço de `the-kdd-process-and-the-data-mining-task-taxonomy` volta ao início com outra tarefa.

A técnica foi a menor dessas escolhas. O tamanho da categoria, do qual a decisão depende, também precisa ser contado, e o tamanho de um cluster é só uma estimativa dele.

## Equívocos Comuns e Armadilhas

- **"A nota mais alta escolhe o método."** Um índice interno premia sua própria noção de cluster, e em `cluster-validation` clusters não convexos podiam fazer a partição verdadeira parecer a pior. No Exemplo 3 o melhor silhouette escolheu o $k$ errado.
- **"Mais regras significam mais conhecimento."** No Exemplo 2 a contagem subiu de 12 para 94 com um único fato nos dados: 63 regras o repetem e 31 não têm nada por trás. Relate os fatos e relate o que os mesmos limiares produzem em dados embaralhados.
- **"Um clustering estável é um clustering real."** Uma única Gaussiana alcançou estabilidade mediana de 0,786 no Exemplo 3.
- **"Qualquer embaralhamento é um nulo."** Uma referência preserva o que preserva. Embaralhar colunas manteve as modas do Exemplo 3 e construiu uma grade de grupos falsos.
- **"Passar no teste prova que o padrão importa."** Uma referência descarta um modelo de acaso. Regras e clusters descrevem coocorrência nos dados minerados, e uma afirmação causal precisa de um desenho capaz de sustentá-la.
- **"Dados grandes devem ir primeiro para um cluster de máquinas."** Muitas das escolhas aqui podem ser feitas numa amostra, com as contagens exatas depois. O cluster responde à mesma pergunta com outro custo.

## Resumo

Escolha nesta ordem: a decisão, a unidade, se existe alvo e como seria o vazio. Uma consulta responde perguntas conhecidas e o aprendizado supervisionado responde às rotuladas. Associação, clustering e detecção de anomalias cobrem o resto, e texto entra por meio de vetores. Nenhum método de clustering venceu todas as formas no Exemplo 1. Doze regras carregaram um único fato no Exemplo 2, e baixar o limiar acrescentou repetições desse fato e regras que o acaso também produz, mas nenhum fato novo. No Exemplo 3 os dados superaram sua referência Gaussiana, enquanto embaralhar colunas teria relatado seis grupos falsos, então a referência deve ser escolhida pelo que destrói. No Exemplo 4 nenhuma regra por coluna enxergava o que o LOF achou. Passar num teste assim elimina uma explicação e deixa a decisão com quem fez a pergunta.

## Documentation Links

- [Fayyad, Piatetsky-Shapiro, and Smyth (1996), From Data Mining to Knowledge Discovery in Databases](https://ojs.aaai.org/aimagazine/index.php/aimagazine/article/view/1230): a visão de processo e a exigência de que padrões continuem válidos em dados novos.
- [Zaki and Meira, Data Mining and Machine Learning, chapter 12](https://dataminingbook.info/book_html/chap12/book.html): avaliação de padrões e regras, testes de permutação sobre um conjunto inteiro de padrões e swap randomization.
- [Zaki and Meira, Data Mining and Machine Learning, chapter 17](https://dataminingbook.info/book_html/chap17/book.html): validação de clustering, estabilidade e tendência a agrupar.
- [scikit-learn: comparing clustering algorithms on toy datasets](https://scikit-learn.org/stable/auto_examples/cluster/plot_cluster_comparison.html): o comportamento de vários algoritmos em formas diferentes.
- [scikit-learn: clustering user guide](https://scikit-learn.org/stable/modules/clustering.html): panorama dos métodos, com parâmetros e escalabilidade.
- [mlxtend, association_rules](https://rasbt.github.io/mlxtend/user_guide/frequent_patterns/association_rules/): as métricas de regras usadas no Exemplo 2.
