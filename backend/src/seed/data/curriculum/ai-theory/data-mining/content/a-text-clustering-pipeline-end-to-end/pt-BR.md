---
version: 1.0
updatedAt: 2026-11-04
title: "Um Pipeline de Clusterização de Texto de Ponta a Ponta"
summary: "Um pipeline completo, de documentos brutos a TF-IDF, redução de dimensionalidade, clusterização e avaliação, terminando na leitura dos termos principais de cada cluster."
---
## Objetivos de Aprendizagem

- Montar TF-IDF, SVD truncada, normalização e k-means em um único `Pipeline` do scikit-learn e reproduzir sua saída a partir de um corpus com semente.
- Dizer por que `TruncatedSVD` sobre TF-IDF difere do PCA de `principal-component-analysis`, e medir a diferença.
- Reportar o índice de Rand ajustado contra rótulos conhecidos, conferi-lo à mão pela tabela de contingência e ler os termos principais de cada cluster.
- Dizer o que uma boa pontuação não prova, usando como controle um corpus sem nenhum tópico.

## Contexto e Motivação

`text-mining-bag-of-words-and-tf-idf` produziu vetores de documentos, `k-means-clustering` agrupa vetores e `cluster-validation` pontua agrupamentos. Esta lição junta os três em um corpus que o leitor pode regenerar exatamente, porque um resultado de clusterização que não pode ser rodado de novo não pode ser questionado.

Os rótulos abaixo só existem porque o corpus é sintético: eles permitem dar nota à execução. Clusterização de texto real é exploratória e não tem esses rótulos, então a segunda metade da lição pergunta o que uma execução assim estabelece e o que não estabelece.

## Teoria Central

### As quatro etapas, e por que nesta ordem

1. **TF-IDF** transforma documentos em linhas esparsas normalizadas em L2, na variante default do scikit-learn.
2. **SVD truncada** projeta essas linhas em $c$ direções.
3. **Normalizer** reescala cada linha projetada para comprimento unitário.
4. **k-means** agrupa as linhas.

A etapa 3 existe por causa desta identidade: para vetores unitários,

$$\lVert u-v\rVert^2=\lVert u\rVert^2+\lVert v\rVert^2-2\,u\cdot v=2-2\cos(u,v),$$

então a distância euclidiana entre vetores unitários é função apenas do cosseno. A hipótese é comprimento unitário, e a projeção a destrói: as linhas de TF-IDF têm norma 1, e na execução abaixo as linhas projetadas vão de 0,443 a 0,922. Normalizar recupera a identidade entre documentos. Ela não vale exatamente contra os centroides, que são médias de vetores unitários e tiveram normas de 0,756 a 0,798 aqui, então isto é próximo de agrupar por cosseno e não é k-means esférico.

### O que a SVD truncada calcula, e o que não calcula

Escreva $X=U\Sigma V^T$. Manter os $c$ maiores valores singulares dá $X_c=U_c\Sigma_cV_c^T$, e pelo teorema de Eckart-Young $X_c$ tem o menor erro de Frobenius entre as matrizes de posto no máximo $c$. As novas coordenadas de cada documento são a linha de $U_c\Sigma_c$.

**TruncatedSVD sobre TF-IDF não centraliza os dados.** O PCA, como `principal-component-analysis` o define, toma autovetores da matriz de covariância, e a covariância é medida em torno da média. Logo, o PCA é a SVD de $X-\bar x$, em que $\bar x$ é a linha média, enquanto `TruncatedSVD` é a SVD do próprio $X$. A referência do scikit-learn diz: "Contrary to PCA, this estimator does not center the data before computing the singular value decomposition." O motivo é a esparsidade. Subtrair $\bar x$ explicitamente escreve um valor não nulo em cada entrada zero, o que deixaria a matriz densa. Alguns solvers evitam isso centralizando de forma implícita, como o `PCA` com `svd_solver="arpack"` em entrada esparsa, enquanto o `TruncatedSVD` simplesmente não centraliza.

Pular a média tem consequência visível. A energia total se divide em

$$\lVert X\rVert_F^2=n\lVert\bar x\rVert^2+\lVert X-\bar x\rVert_F^2,$$

e $\bar x$ não é pequeno quando todas as entradas de $X$ são não negativas. Por Perron-Frobenius aplicado a $X^TX$, o primeiro vetor singular à direita de uma matriz não negativa pode ser escolhido com todas as entradas não negativas, então ele não tem sinais opostos com que contrastar tópicos. Ele tende a se gastar na direção da média, e o Exemplo 4 mede com que proximidade.

### Tudo o que é aprendido vai em um só Pipeline

Vocabulário, idf, vetores singulares e centroides são todos aprendidos dos dados. Em um único `Pipeline`, `pipe.fit(train)` aprende tudo com os documentos de treino e `pipe.predict(test)` só aplica. Ajustar o vetorizador antes de dividir vazaria o df de teste para os vetores de treino. Numa clusterização puramente exploratória de um corpus fixo não há conjunto de teste, e ajustar em tudo é normal, desde que o relatório diga isso.

## Exemplos Resolvidos

### Exemplo 1: a execução completa

Este script é completo. Rodou em Python 3.13.5, com scikit-learn 1.9.1 e NumPy 2.5.4. Cada tópico tem sua lista de palavras, algumas são compartilhadas de propósito (`bank`, `trade`, `fish`, `rain`, `season`), e cada token vem do tópico com probabilidade 0,35, ou de uma lista comum no caso contrário:

```python
import numpy as np
from sklearn.cluster import KMeans
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import adjusted_rand_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import Normalizer

TOPICS = {
    "finance": "bank loan credit rate market stock bond fund price trade".split(),
    "rivers":  "bank river water flood stream fish boat rain delta trade".split(),
    "sports":  "match team goal coach league score player season fan trade".split(),
    "cooking": "recipe oven flour butter salt sauce pan rain season fish".split(),
}
COMMON = "report new year people time local day week city group".split()

def make_corpus(n_per_topic=100, seed=42, p_topic=0.35):
    rng = np.random.default_rng(seed)
    docs, labels = [], []
    for label, words in enumerate(TOPICS.values()):
        for _ in range(n_per_topic):
            n = rng.integers(6, 15)
            picks = [rng.choice(words) if rng.random() < p_topic else rng.choice(COMMON)
                     for _ in range(n)]
            docs.append(" ".join(picks))
            labels.append(label)
    return docs, np.array(labels)

docs, y = make_corpus()
train, test, y_train, y_test = train_test_split(
    docs, y, test_size=0.25, stratify=y, random_state=0)

pipe = Pipeline([
    ("tfidf", TfidfVectorizer()),
    ("svd", TruncatedSVD(n_components=10, random_state=0)),
    ("norm", Normalizer(copy=False)),
    ("km", KMeans(n_clusters=4, n_init=10, random_state=0)),
])
pipe.fit(train)
pred = pipe.named_steps["km"].labels_

print("first doc:", docs[0])
print("ARI train:", round(adjusted_rand_score(y_train, pred), 3))
print("ARI test: ", round(adjusted_rand_score(y_test, pipe.predict(test)), 3))

terms = pipe.named_steps["tfidf"].get_feature_names_out()
centers = pipe.named_steps["svd"].inverse_transform(pipe.named_steps["km"].cluster_centers_)
for c, row in enumerate(centers):
    top = terms[np.argsort(row)[::-1][:6]]
    print(f"cluster {c} size {(pred == c).sum()}:", " ".join(top))
for c, row in enumerate(centers - centers.mean(axis=0)):
    top = terms[np.argsort(row)[::-1][:6]]
    print(f"cluster {c} minus mean:", " ".join(top))
```

```text
first doc: week report bond week week price
ARI train: 0.886
ARI test:  0.87
cluster 0 size 70: credit new week bond time price
cluster 1 size 85: new flood local trade year people
cluster 2 size 70: week group coach day match city
cluster 3 size 75: salt year flour report new city
cluster 0 minus mean: credit bond price loan stock market
cluster 1 minus mean: flood water delta stream fish boat
cluster 2 minus mean: coach match team fan score player
cluster 3 minus mean: salt flour sauce pan butter oven
```

Se a primeira linha sair diferente em outra máquina, o corpus também é outro. O NumPy promete o mesmo fluxo para a mesma semente apenas no mesmo build e na mesma máquina, então outra versão pode mudar os dígitos abaixo.

### Exemplo 2: o ARI, à mão

A tabela de contingência do treino, com tópicos nas linhas e clusters nas colunas (300 documentos):

```text
          c0   c1   c2   c3
finance   69    6    0    0
rivers     1   74    0    0
sports     0    4   70    1
cooking    0    1    0   74
```

Na forma de contagem de pares de `cluster-validation`, $\text{Index}=\sum_{ij}\binom{n_{ij}}{2}=10184$, $A=\sum_i\binom{a_i}{2}=11100$, $B=\sum_j\binom{b_j}{2}=11175$, $\binom{300}{2}=44850$ e $\mathbb E[\text{Index}]=AB/44850=2765{,}72$. Então

$$\mathrm{ARI}=\frac{10184-2765{,}72}{\tfrac12(11100+11175)-2765{,}72}=0{,}886,$$

o que bate com `adjusted_rand_score`. Os documentos separados (25 por tópico) dão 0,870 com a mesma fórmula. A maior parte dos erros vai para o cluster 1, o de rios, que tem 85 documentos para 75 verdadeiros. As listas de palavras explicam isso só em parte: rios compartilha `bank` e `trade` com finanças (6 documentos migraram), `trade` com esportes (4), e `fish` e `rain` com culinária (1). As palavras compartilhadas sozinhas não explicam as contagens.

### Exemplo 3: lendo os termos principais

Os centroides brutos da saída são difíceis de ler: `new`, `week`, `city` e outras palavras comuns lotam as listas. A retroprojeção por $V_c$ devolve um centroide no espaço de termos, e como nada foi centralizado, esse centroide ainda contém a média do corpus. Palavras comuns são 63,8% dos 3973 tokens do corpus, então ficam bem colocadas em todo centroide.

Subtrair a média dos quatro centroides deixa o que separa os clusters. As quatro listas passam a se ler como finanças, rios, esportes e culinária, e cada um dos seis primeiros termos vem da lista correspondente. Isso é um recurso de leitura e não muda os clusters.

### Exemplo 4: SVD truncada contra PCA, nesta matriz

Matriz de treino: 300 documentos, 44 termos, 2340 entradas não nulas (densidade 0,177).

```text
top right singular vector, sign fixed         0 negative entries of 44
cosine(SVD1, mean row)                        0.9983
SVD1 share of ||X||_F^2 (sigma_1^2 / total)   0.2258
n ||mean||^2 share of ||X||_F^2               0.2148
cosine(PCA1, SVD1)                            0.0307
cosine(PCA1, SVD2)                            0.9991
cosine(PCA2, SVD3)                            0.9969
nonzero entries after centering               13200 of 13200
```

O primeiro eixo da SVD é, na prática, a direção da média, e o primeiro eixo do PCA coincide com o segundo eixo da SVD. Assim, $c=10$ aqui rende cerca de nove direções de contraste entre documentos.

Uma conferência mostra que a centralização é a diferença que importa. `TruncatedSVD` com `algorithm="arpack"` rodado na matriz densa centralizada devolve os valores singulares do `PCA`: 3,970334, 3,886058, 3,520336, 3,227739 nos dois.

### Exemplo 5: quais etapas se justificaram

ARI de teste na semente 42 e depois a média das sementes de corpus 0 a 9, com a mesma divisão e os mesmos ajustes de k-means:

```text
pipeline                   seed 42   mean of seeds 0-9
counts                     0.018     0.005
counts + L2                0.058     0.000
TF-IDF, norm=None          0.735     0.795
TF-IDF, L2                 0.864     0.897
TF-IDF, SVD 10             0.771     0.905
TF-IDF, SVD 10, L2         0.870     0.905
```

O idf é a etapa que importa: sem ele os tokens comuns dominam, e normalizar contagens não ajuda. O Normalizer parece valer 0,10 na semente 42 e nada na média, o que é um alerta sobre ler uma semente só. A SVD acrescenta cerca de 0,01 à média aqui, e um vocabulário de 44 termos lhe dá pouco a comprimir, então esta execução não mostra seu valor em vocabulários reais. No pipeline completo, nesses dez corpora, o ARI de treino foi de 0,854 a 0,965 e o de teste de 0,819 a 0,947. No corpus 42, dez valores de `random_state` (0 a 9) para SVD e k-means deram ARI de treino de 0,886 ou 0,887 e ARI de teste de 0,870 em todos.

O número de componentes pesa até certo ponto. ARI de teste por $c$ na semente 42: 0,316 para 2, 0,613 para 3, 0,794 para 5, 0,870 para 10, 0,815 para 20. As médias de dez sementes são 0,329, 0,700, 0,867, 0,905, 0,899, então a queda em 20 é desta divisão, e a partir de cerca de $c=8$ a curva fica plana. Com $c=2$, um eixo é a média, então quatro tópicos dividem um único eixo de contraste. Escolher $c$ por essa linha usa rótulos e o conjunto de teste, o que `training-test-and-validation-splits` proíbe, e $c=10$ é o máximo dessa linha. A estimativa mais justa do método é a média de dez sementes, 0,905, já que aqueles corpora não tiveram papel na escolha de $c$.

A pontuação também depende de como o corpus foi configurado. Com `p_topic` em 0,25, 0,35 e 0,50, a semente 42 dá ARI de teste 0,524, 0,870 e 0,947. O ARI mede a dificuldade do gerador tanto quanto o pipeline.

### Exemplo 6: um corpus sem tópicos

Junte todas as palavras de tópico em uma lista e gere de novo, de modo que todo documento venha da mesma distribuição:

```python
pooled = sum(TOPICS.values(), [])
TOPICS.clear()
TOPICS["all"] = pooled
noise, _ = make_corpus(n_per_topic=400)
```

O mesmo pipeline, nos 300 documentos de treino do corpus com tópicos e nos 400 documentos de ruído, com silhouette medido no espaço reduzido e normalizado (`pipe[:-1].transform`) e no espaço TF-IDF:

```text
corpus   c    silhouette, reduced   silhouette, TF-IDF   ARI vs topics
topics   2    0.556                 0.032                0.324
noise    2    0.540                 0.007                no labels
topics   10   0.222                 0.085                0.886
noise    10   0.096                 0.032                no labels
```

O ruído com $c=2$ marca 0,540, mais que o dobro dos 0,222 do pipeline que recuperou os tópicos. A causa é o próprio pipeline. Normalizar linhas bidimensionais põe todo ponto num círculo, e como o eixo da média ocupa uma dimensão, todos os documentos de ruído caem num arco de 98 graus, que o k-means fatia com capricho. O silhouette então mede a geometria que o pipeline criou. No espaço TF-IDF os mesmos rótulos marcam 0,007.

Clusters de ruído também vêm com histórias. Com $c=2$, subtrair a média dá listas como `group city bond time week market` e `local day rain fan year new`, e um leitor esperançoso conseguiria dar nome a elas.

O que separa os dois corpora é o controle, não a pontuação. Com $c=10$, o silhouette do corpus com tópicos tem pico em $k=4$ (0,222, contra 0,183 em $k=3$ e 0,201 em $k=5$), enquanto no ruído ele sobe devagar de 0,091 em $k=2$ a 0,112 em $k=8$, sem pico. Rodar o mesmo pipeline num corpus com a estrutura removida é um teste barato.

**O que este resultado não provaria.**

- Que o método funciona em texto real. Os tópicos foram plantados, e um ARI de 0,886 diz que o pipeline os recupera nessa mistura de palavras.
- Que os quatro clusters são a verdade sobre um corpus. O ARI mede concordância com uma partição, e existem outras partições válidas.
- Que $k=4$ seria encontrado sem ajuda. Aqui ele foi dado, a partir do gerador.
- Que um cluster explica alguma coisa. Termos principais descrevem coocorrência, sem leitura causal.
- Que 0,870 é a pontuação esperada. É uma divisão de um corpus.

## Equívocos Comuns e Armadilhas

- **"TruncatedSVD sobre TF-IDF é PCA."** Não centraliza. No Exemplo 4 seu primeiro eixo foi a direção da média, com cosseno 0,9983, e o primeiro eixo do PCA foi o segundo dela.
- **"Os termos principais de um centroide dizem do que o cluster trata."** Centroides brutos repetem a média do corpus. Compare com os outros centroides.
- **"Silhouette alto significa clusters reais."** O ruído marcou 0,540 com $c=2$. Calcule contra um controle, e também no espaço original.
- **"Silhouette baixo significa falta de estrutura."** O pipeline com ARI 0,886 marcou 0,222.

## Resumo

Um `Pipeline` ajusta TF-IDF, `TruncatedSVD`, `Normalizer` e `KMeans` nos documentos de treino. Num corpus com semente, de 400 documentos e quatro tópicos plantados, ele chegou a ARI 0,886 no treino e 0,870 nos documentos separados, com média de 0,905 no teste em dez sementes. `TruncatedSVD` não centraliza, então seu primeiro eixo ficou na direção da média (cosseno 0,9983) e o primeiro eixo do PCA coincidiu com o segundo dela (0,9991). Subtrair a média dos centroides revela os tópicos. O idf fez a maior parte do trabalho aqui. Em texto sem tópicos, o mesmo pipeline chegou a silhouette 0,540 com $c=2$, com listas de termos que parecem tópicos, e é por isso que um corpus de controle pertence a um relatório deste tipo.

## Documentation Links

- [scikit-learn, TruncatedSVD](https://scikit-learn.org/stable/modules/generated/sklearn.decomposition.TruncatedSVD.html): o estimador, a nota sobre não centralizar e seus dois solvers.
- [scikit-learn, PCA](https://scikit-learn.org/stable/modules/generated/sklearn.decomposition.PCA.html): a contraparte centralizada usada na comparação, com os solvers que aceitam entrada esparsa.
- [scikit-learn, Clustering text documents using k-means](https://scikit-learn.org/stable/auto_examples/text/plot_document_clustering.html): o pipeline de LSA e k-means da própria biblioteca, em um conjunto público.
- [scikit-learn, Pipeline](https://scikit-learn.org/stable/modules/generated/sklearn.pipeline.Pipeline.html): encadeamento de transformadores e um estimador final, ajustados juntos.
- [scikit-learn, adjusted_rand_score](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.adjusted_rand_score.html): a métrica conferida à mão no Exemplo 2.
- [IIR 18.3, Low-rank approximations (archived copy)](https://web.archive.org/web/20250320044806/https://nlp.stanford.edu/IR-book/html/htmledition/low-rank-approximations-1.html): o teorema de Eckart-Young no contexto da SVD.
- [NumPy, Compatibility policy for random](https://numpy.org/doc/stable/reference/random/compatibility.html): as condições em que uma semente reproduz um fluxo.
