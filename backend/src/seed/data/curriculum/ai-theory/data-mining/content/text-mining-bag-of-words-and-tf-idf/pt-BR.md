---
version: 1.0
updatedAt: 2026-11-04
title: "Mineração de Texto: Bag of Words e TF-IDF"
summary: "Como transformar texto em vetores: tokenização, stop words, stemming, bag of words, ponderação TF-IDF e similaridade de cosseno entre documentos."
---
## Objetivos de Aprendizagem

- Transformar texto bruto em uma matriz documento-termo, nomeando a escolha feita em cada etapa: tokenização, stop words, stemming.
- Rodar o stemmer de Porter e apontar onde ele junta palavras sem relação e onde separa palavras relacionadas.
- Calcular o idf de livro-texto e o idf suavizado do scikit-learn com normalização L2 no mesmo corpus, e explicar por que os números diferem.
- Provar que o cosseno de vetores normalizados em L2 é igual ao produto escalar deles, e mostrar o que quebra quando falta uma hipótese.
- Ajustar o idf em um conjunto de documentos e aplicá-lo a documentos novos sem vazamento, e lidar com um documento cujo vetor é zero.

## Contexto e Motivação

Os métodos vistos até aqui nesta disciplina, de `k-nearest-neighbors` a `outlier-detection-quartiles-distance-based-density-based`, partem de linhas de números. Texto não chega assim. `similarity-and-distance-measures` trata do cosseno, e esta lição constrói os vetores de texto que ele compara.

A construção parece mecânica e não é. Cada etapa é uma decisão de modelagem que muda quais documentos contam como parecidos, e a fórmula mais famosa da área, TF-IDF, tem várias definições. No corpus abaixo, três pipelines razoáveis dão vizinhos mais próximos diferentes para o mesmo documento. Um número apresentado como "o TF-IDF" diz pouco até a variante ser nomeada.

## Teoria Central

### Tokens e stop words

Um **token** é a unidade que o pipeline vai contar. A tokenização costuma ser uma expressão regular, e ela tem opinião. O padrão default do scikit-learn, `(?u)\b\w\w+\b`, mantém sequências de dois ou mais caracteres de palavra, então `a b2 x-ray C++ don't` vira `['b2', 'ray', 'don']`: o `x` de `x-ray` e o `C` de `C++` somem.

**Stop words** são palavras muito comuns removidas antes da contagem. Remover é uma decisão, não uma limpeza. O guia do scikit-learn avisa que há "several known issues" na própria lista `english`. Com essa lista, "this is good" e "this is not good" viram ambos o único token `good`, e uma tarefa que depende de negação perde a negação.

### Stemming

Um **stemmer** corta sufixos por regra. Um **lematizador** usa vocabulário e morfologia para devolver a forma de dicionário. O stemmer de Porter (1980), descrito em Manning, Raghavan e Schütze (IIR) como cinco fases de redução de palavras aplicadas em sequência, devolve cadeias que não precisam ser palavras: `studies` vira `studi`. O NLTK traz três modos, e eles discordam em algumas palavras. O próprio Porter recomenda não usar a forma original de 1980, segundo a documentação do NLTK, e o default do NLTK acrescenta mudanças próprias. Por isso, uma tabela de stems precisa nomear o modo.

### Bag of words

Depois do pré-processamento, um corpus de $n$ documentos sobre um vocabulário de $m$ termos vira uma matriz $X$ de tamanho $n\times m$, com $x_{dt}$ igual ao número de vezes que o termo $t$ ocorre no documento $d$. O modelo guarda contagens e descarta a ordem: "dog bites man" e "man bites dog" recebem vetores idênticos e cosseno 1. Acrescentar bigramas com `ngram_range=(1, 2)` separa os dois, e o cosseno cai para 0,6, ao preço de um vocabulário maior. A maioria das entradas de $X$ é zero, e é por isso que essas matrizes são guardadas em formato esparso.

### TF-IDF, no plural

A frequência do termo sozinha premia palavras frequentes em todo lugar. A frequência inversa de documento reduz um termo conforme a quantidade de documentos que o contêm, usando $\text{df}(t)$, o número de documentos com $t$. As fontes diferem nos detalhes:

| Fonte | tf | idf | Tratamento do comprimento |
|---|---|---|---|
| IIR, seções 6.2.1 e 6.2.2 | contagem bruta | $\log(N/\text{df})$, base 10 na tabela do livro | nenhum no peso; o cosseno divide pelos comprimentos |
| scikit-learn, default | contagem bruta | $\ln\frac{1+n}{1+\text{df}}+1$ | norma L2 em cada linha |
| scikit-learn, `smooth_idf=False` | contagem bruta | $\ln\frac{n}{\text{df}}+1$ | norma L2 em cada linha |
| Leskovec, Rajaraman e Ullman (MMDS), seção 1.3.1 | contagem sobre a contagem máxima do documento | $\log_2(N/n_i)$ | divisão pelo máximo, dentro do tf |

As duas famílias se comportam de modo diferente nos extremos. No IIR, um termo presente em todos os documentos tem idf 0 e desaparece. No scikit-learn, o mesmo termo tem idf 1 e fica. O guia do scikit-learn também chama $\log\frac{n}{1+\text{df}}$ de "standard textbook notation", que é uma quinta forma e não é a do IIR nem a do MMDS. Num termo presente em todos os documentos de um corpus de quatro documentos, ela dá $\ln(4/5)=-0{,}2231$, um peso negativo.

A base do logaritmo pede cuidado. Na forma do IIR, trocar a base multiplica todos os pesos por uma constante, então os cossenos não mudam: base 10 e base 2 dão os mesmos valores no corpus abaixo. Na forma do scikit-learn o 1 somado não escala, então a base faria diferença, e a biblioteca fixa o logaritmo natural.

### Cosseno e produto escalar

Para vetores não nulos, $\cos(u,v)=\dfrac{u\cdot v}{\lVert u\rVert\,\lVert v\rVert}$.

**Propriedade.** Se $\lVert u\rVert=\lVert v\rVert=1$, então $\cos(u,v)=u\cdot v$. Em geral, com $\hat u=u/\lVert u\rVert$ e $\hat v=v/\lVert v\rVert$,

$$\hat u\cdot\hat v=\frac{u\cdot v}{\lVert u\rVert\,\lVert v\rVert}=\cos(u,v),$$

pois o produto escalar é linear em cada argumento, e $\lVert\hat u\rVert=1$ faz o denominador de $\cos(\hat u,\hat v)$ valer 1. Multiplicar um vetor por um fator positivo não muda seu cosseno. Dobrar um documento, portanto, muda as contagens e não a direção.

Duas hipóteses sustentam isso: os dois vetores são não nulos, e os dois têm comprimento unitário. O Exemplo 4 mostra cada uma falhando. Com pesos não negativos o cosseno também fica em $[0,1]$, e vale 0 exatamente quando os documentos não têm termo em comum com peso positivo.

## Exemplos Resolvidos

### Exemplo 1: de frases a uma matriz

Quatro documentos, em minúsculas, tokenizados com `[a-z]+`, com a lista de stop words `the, a, and, of, to, in`, e stemming pelo `PorterStemmer` do NLTK 3.9.1 no modo default. O corpus fica em inglês porque o stemmer é para inglês:

```text
d1  The cluster stores data and the store holds data logs.
    cluster store data store hold data log
d2  Clustering the stored data reveals customer groups.
    cluster store data reveal custom group
d3  Customers of the store buy data plans.
    custom store buy data plan
d4  The store sells data plans and data drives.
    store sell data plan data drive
```

```text
     buy cluster custom data drive group hold log plan reveal sell store
d1     0       1      0    2     0     0    1   1    0      0    0     2
d2     0       1      1    1     0     1    0   0    0      1    0     1
d3     1       0      1    1     0     0    0   0    1      0    0     1
d4     0       0      0    2     1     0    0   0    1      0    1     1
df     1       2      2    4     1     1    1   1    2      1    1     4
```

A matriz tem 21 entradas não nulas em 48. `CountVectorizer(token_pattern="[a-z]+")` sobre as cadeias pré-processadas devolve as mesmas linhas. O stemmer já deixou sua marca: `customers` virou `custom`, e `stored` (o verbo) se fundiu com `store` (a loja).

### Exemplo 2: o que o Porter junta e o que ele deixa escapar

Uma execução do `PorterStemmer()` do NLTK 3.9.1 no modo default:

```text
over-conflation (unrelated meanings, one stem)
  university universe universal           -> univers
  organization organ organic              -> organ
  general generous generic generate       -> gener
  experiment experience                   -> experi

under-conflation (related words, different stems)
  ran -> ran       run running runs -> run
  mouse -> mous    mice -> mice
  good -> good     better -> better
  matrix -> matrix    matrices -> matric
  analysis -> analysi  analyses -> analys  analyze -> analyz
  europe -> europ     european -> european
```

Os modos diferem em algumas palavras, então um resultado só é reproduzível com o modo nomeado:

```text
word     NLTK_EXTENSIONS   MARTIN_EXTENSIONS   ORIGINAL_ALGORITHM
lying    lie               ly                  ly
dying    die               dy                  dy
skies    sky               ski                 ski
news     news              new                 new
fly      fli               fly                 fly
```

### Exemplo 3: o mesmo corpus sob cada idf

Aqui $N=4$. Os valores vêm das fórmulas, e vetores normalizados em L2 construídos com as duas colunas do scikit-learn batem com o `TfidfTransformer` dentro de $1{,}2\times10^{-16}$:

```text
df   textbook log10(N/df)   sklearn ln((1+n)/(1+df))+1   sklearn ln(n/df)+1
1    0.6021                 1.9163                       2.3863
2    0.3010                 1.5108                       1.6931
4    0                      1                            1
```

Agora o documento $d_1$, com contagens cluster 1, data 2, hold 1, log 1, store 2:

```text
term      textbook tf-idf   sklearn raw tf-idf   sklearn after L2
cluster   0.3010            1.5108               0.3599
data      0                 2.0000               0.4764
hold      0.6021            1.9163               0.4564
log       0.6021            1.9163               0.4564
store     0                 2.0000               0.4764
```

A coluna L2 é a coluna bruta dividida pela norma $\sqrt{1{,}5108^2+2^2+1{,}9163^2+1{,}9163^2+2^2}=4{,}1984$. Na forma de livro-texto, $d_1$ fica com três coordenadas. No scikit-learn fica com as cinco, e `data` pesa mais que `cluster`, porque contagem 2 vezes idf 1 supera contagem 1 vezes idf 1,5108.

### Exemplo 4: o vizinho mais próximo depende da variante

Cossenos de cada par, sem empate de vizinho mais próximo em nenhuma linha da segunda tabela. "Unstemmed" mantém as minúsculas e a lista de stop words do Exemplo 1, pula o stemmer e aplica a ponderação default do scikit-learn:

```text
pair     counts   textbook   sklearn   sklearn no-smooth   unstemmed
d1,d2    0.6155   0.1054     0.4012    0.3329              0.1012
d1,d3    0.5394   0          0.2978    0.2314              0.2235
d1,d4    0.6396   0          0.3737    0.2898              0.3146
d2,d3    0.5477   0.1291     0.3589    0.3037              0.0653
d2,d4    0.4330   0          0.2103    0.1563              0.1169
d3,d4    0.6325   0.1361     0.4317    0.3649              0.4268
```

```text
nearest neighbor of   counts   textbook   sklearn   sklearn no-smooth   unstemmed
d1                    d4       d2         d2        d2                  d4
d2                    d1       d3         d1        d1                  d4
d3                    d4       d4         d4        d4                  d4
d4                    d1       d3         d3        d3                  d3
```

Veja $d_2$. Na forma de livro-texto, $d_2$ compartilha só `cluster` com $d_1$ e só `custom` com $d_3$, ambos com idf 0,3010, então os dois numeradores valem $0{,}0906$. Quem decide são os denominadores: $0{,}9031\times0{,}9519$ contra $0{,}7374\times0{,}9519$, o que dá 0,1054 e 0,1291, e $d_3$ vence por ser o vetor mais curto. No scikit-learn os termos apagados voltam. Os numeradores viram $2{,}2826+2+2=6{,}2826$ com $d_1$ e $2{,}2826+1+1=4{,}2826$ com $d_3$, e $d_1$ vence. Sem stemming, `clustering` deixa de casar com `cluster`, e $d_2$ passa para $d_4$. Nenhuma das respostas é a certa em geral: com quatro documentos, df é um sinal grosseiro, e essas trocas mostram quanto a escolha pesa quando há pouca evidência.

**Produto escalar.** Na matriz do scikit-learn normalizada em L2, `X @ X.T` reproduz exatamente a coluna sklearn, por exemplo $0{,}4012$ para $d_1,d_2$. As duas hipóteses falham assim.

- Vetores não normalizados: nos pesos brutos do scikit-learn, o produto escalar de $d_1$ e $d_2$ é $6{,}2826$, que não é um cosseno. O cosseno de $2d_1$ com o $d_1$ original continua 1, enquanto o produto escalar bruto vai de $17{,}63$ para $35{,}25$.
- Vetor zero: no Exemplo 5, um documento não tem peso em lugar nenhum, sua norma é 0 e o cosseno é $0/0$. `cosine_similarity` devolve 0 ali por convenção, e esse 0 significa "indefinido", não "sem relação".

### Exemplo 5: documentos novos

Ajuste em $d_1,\dots,d_4$ e depois só transforme, passando cada texto novo pelo mesmo pré-processamento antes:

```text
new text               stems             sklearn vector               cosine with d1..d4
quantum entanglement   quantum entangl   zero vector                  0 0 0 0
data store             data store        data 0.7071, store 0.7071    0.6737 0.3792 0.4420 0.5547
```

Os dois stems do primeiro texto estão fora do vocabulário, então o vetor é zero. Com o idf de livro-texto, "data store" também é um vetor zero, já que seus dois termos têm idf 0, enquanto o scikit-learn encontra $d_1$ como o mais próximo.

O idf é aprendido dos dados, então pertence ao lado de treino de `training-test-and-validation-splits`. Se "data store" entrar no ajuste como quinto documento, $\text{idf}(\text{cluster})$ vai de 1,5108 para 1,6931, e os vetores dos documentos originais mudam por causa de um documento que deveria ser desconhecido. Num estudo exploratório sem conjunto separado não há vazamento a evitar, e ajustar em todos os documentos é uma escolha legítima, desde que declarada.

## Equívocos Comuns e Armadilhas

- **"TF-IDF é uma fórmula só."** O Exemplo 3 mostra três conjuntos de valores de idf no mesmo corpus, e o Exemplo 4 mostra esses conjuntos discordando sobre um vizinho mais próximo. Nomeie a variante.
- **"A normalização faz parte do TF-IDF."** É uma etapa separada que o scikit-learn liga por default. Com `norm=None`, o produto escalar deixa de ser cosseno.
- **"Produto escalar de vetores TF-IDF é cosseno."** Só depois da normalização L2, e só para vetores não nulos.
- **"Cosseno 0 significa que os documentos não têm relação."** Significa que não há termo em comum com peso positivo. Com o idf de livro-texto, $d_1$ e $d_3$ têm cosseno 0 e compartilham `data` e `store`.
- **"Um stem é a raiz da palavra."** `univers` junta três sentidos e `matric` não é palavra. Inspecione os stems dos termos que importam para a tarefa.
- **"Remover stop words é sempre seguro."** Removeu a negação em "this is not good".
- **"Ajuste o vetorizador em tudo, é só contagem."** Ele aprende o vocabulário e o idf. Ajuste nos documentos de treino.

## Resumo

Texto vira número por uma cadeia de escolhas: um padrão de token, uma lista de stop words, um stemmer num modo nomeado e uma ponderação. O stemmer de Porter funde `university` e `universe` e deixa `ran` separado de `run`. Bag of words descarta a ordem. Num corpus de quatro documentos, o idf de um termo presente em todos é 0 na forma do IIR e 1 no scikit-learn, e essa diferença mudou o vizinho mais próximo de $d_2$. A normalização L2 faz o produto escalar igualar o cosseno, desde que o vetor não seja nulo, e um documento fora do vocabulário é o jeito comum de obter um vetor zero. O idf é ajustado nos documentos de treino e só aplicado aos novos. `a-text-clustering-pipeline-end-to-end` leva esses vetores a uma clusterização completa.

## Documentation Links

- [IIR 6.2.1, Inverse document frequency (archived copy)](https://web.archive.org/web/20250124112038/https://nlp.stanford.edu/IR-book/html/htmledition/inverse-document-frequency-1.html): a definição de df e idf e a nota sobre a base do logaritmo.
- [IIR 6.2.2, Tf-idf weighting (archived copy)](https://web.archive.org/web/20250312161632/https://nlp.stanford.edu/IR-book/html/htmledition/tf-idf-weighting-1.html): o peso tf-idf como produto.
- [IIR 6.3.1, Dot products (archived copy)](https://web.archive.org/web/20250306122857/https://nlp.stanford.edu/IR-book/html/htmledition/dot-products-1.html): similaridade de cosseno e normalização de comprimento.
- [IIR 2.2.4, Stemming and lemmatization (archived copy)](https://web.archive.org/web/20241229085036/https://nlp.stanford.edu/IR-book/html/htmledition/stemming-and-lemmatization-1.html): a diferença entre os dois e as fases do algoritmo de Porter.
- [Mining of Massive Datasets, chapter 1 (archived copy)](https://web.archive.org/web/20240314014513/http://infolab.stanford.edu/~ullman/mmds/ch1n.pdf): a variante TF.IDF com tf normalizado pelo máximo e logaritmo de base 2.
- [scikit-learn, Feature extraction](https://scikit-learn.org/stable/modules/feature_extraction.html): padrões de token, avisos sobre stop words e as fórmulas exatas de tf-idf com um exemplo numérico.
- [scikit-learn, TfidfTransformer](https://scikit-learn.org/stable/modules/generated/sklearn.feature_extraction.text.TfidfTransformer.html): os parâmetros `norm`, `smooth_idf` e `use_idf`.
- [NLTK, nltk.stem.porter](https://www.nltk.org/api/nltk.stem.porter.html): os três modos do stemmer e o que cada um contém.
- [The Porter Stemming Algorithm](https://tartarus.org/martin/PorterStemmer/): a página de Martin Porter sobre o algoritmo e suas implementações.
