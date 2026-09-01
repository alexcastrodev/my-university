---
version: 1.0
updatedAt: 2026-08-14
title: "K-Means Clustering e o Procedimento de Lloyd"
description: "K-means clustering é NP-hard, então o procedimento de Lloyd se contenta com uma heurística de busca local com terminação provada — atribuindo pontos alternadamente ao centro mais próximo e recalculando cada centro como o centroide do seu cluster — até que a atribuição pare de mudar."
---
## Objetivo

Entenda o problema do k-means clustering e o procedimento de Lloyd para resolvê-lo: dado um conjunto S de n pontos em R^d e um número alvo de clusters k, encontre k pontos centrais que minimizem a soma das distâncias ao quadrado de cada ponto ao seu centro mais próximo. Este é um tópico novo na plataforma em mais de um sentido — ele vem do Capítulo 33, "Machine-Learning Algorithms," que o CLRS adicionou inteiramente na 4ª edição, e é a primeira incursão da plataforma em conteúdo algorítmico adjacente a ML. O núcleo técnico continua estritamente algorítmico, porém: k-means em si é NP-hard, então o procedimento de Lloyd é uma heurística de busca local — ele itera "atribua pontos ao centro mais próximo, depois recalcule os centros como centroides" até que nada mude, e provadamente termina e nunca aumenta o objetivo, mas só garante um mínimo local, não o global.

## Casos de Uso

- Agrupar pontos de dados por similaridade como um passo de pré-processamento para descobrir estrutura — os próprios exemplos do CLRS são agrupar estrelas celestes por temperatura/tamanho/características espectrais, e agrupar fragmentos de fala gravada para revelar o conjunto de sotaques presentes.
- Quantização vetorial para compressão com perdas: reduzir o número de cores distintas necessárias para representar uma fotografia para que ela possa ser codificada com muito menos bits por pixel.
- Qualquer cenário em que você tenha n exemplos com o mesmo conjunto de atributos e queira particioná-los em k grupos disjuntos de exemplos mutuamente similares, sem exigir um algoritmo exato em tempo polinomial (um clustering localmente ótimo é aceitável).

## Aprofundamento

### Vetores de características e a medida de dissimilaridade

Cada um dos n exemplos é representado como um vetor de características d-dimensional x = (x1, x2, ..., xd), um ponto em R^d. Em vez de definir similaridade diretamente, o CLRS define seu oposto — a dissimilaridade δ(x, y) entre dois pontos, tomada como a distância euclidiana ao quadrado:

```java
// δ(x, y) = ||x - y||^2 = soma de a=1..d de (x[a] - y[a])^2
static double dissimilarity(double[] x, double[] y) {
    double sum = 0.0;
    for (int a = 0; a < x.length; a++) {
        double diff = x[a] - y[a];
        sum += diff * diff;
    }
    return sum;
}
```

A escolha da distância euclidiana ao quadrado (equação 33.1) não é obrigatória — é uma escolha convencional e matematicamente conveniente, e outras medidas de dissimilaridade (como a distância simples, não elevada ao quadrado) são possíveis. Antes do clustering, os valores de atributo costumam ser escalados ou normalizados para que nenhum atributo isolado domine os outros — por exemplo, uma transformação linear mapeando o valor mínimo de um atributo para 0 e o máximo para 1, ou escalonando de forma que cada atributo tenha média 0 e variância unitária. Isso importa porque as escalas brutas dos atributos podem diferir enormemente: o próprio exemplo do CLRS é latitude (variando de -90 a +90) versus longitude (variando de -180 a +180), uma diferença de fator 2, e ele observa que atributos como coeficiente de rendimento escolar versus renda familiar podem diferir muito mais.

### O objetivo do k-means, e por que ele só é resolvível até um ótimo local

Um k-clustering de S é uma decomposição em k subconjuntos disjuntos (clusters) ⟨S(1), S(2), ..., S(k)⟩, definidos por uma sequência de k centros C = ⟨c(1), ..., c(k)⟩ via a *regra do centro mais próximo*: um ponto x pertence ao cluster S(ℓ) só se δ(x, c(ℓ)) é a dissimilaridade mínima a qualquer um dos k centros (empates quebrados arbitrariamente, mas nunca reatribuindo um ponto a menos que seu novo centro seja *estritamente* mais próximo que o antigo). O problema do k-means pede a sequência de centros C que minimiza

```
f(S, C) = soma sobre x em S de min{ δ(x, c(j)) : 1 <= j <= k }
        = soma sobre l=1..k, soma sobre x em S(l) de δ(x, c(l))          (equação 33.2)
```

Existe um algoritmo em tempo polinomial para k-means? Provavelmente não — o problema é NP-hard. Então, em vez do mínimo global, o procedimento de Lloyd encontra um mínimo *local*, caracterizado por duas propriedades necessárias (mas não suficientes):

- **Centro ótimo para um cluster dado (Teorema 33.1).** Para um cluster fixo não vazio S(ℓ), o único centro c(ℓ) que minimiza a soma das distâncias ao quadrado de seus pontos é o *centroide* (média) do cluster — para cada atributo a, c(ℓ)_a = (1 / |S(ℓ)|) * soma sobre x em S(ℓ) de x_a. A prova deriva a quadrática convexa em c(ℓ)_a e a iguala a zero, o que recai exatamente na média.
- **Clusters ótimos para centros dados (Teorema 33.2).** Dada uma sequência fixa de k centros, o clustering que minimiza o objetivo é exatamente o produzido pela regra do centro mais próximo — atribuindo cada ponto ao cluster cujo centro é o mais próximo dele. A prova é imediata: cada ponto contribui para a soma exatamente uma vez, por meio de qualquer cluster ao qual esteja atribuído, então atribuí-lo ao seu centro mais próximo minimiza sua própria contribuição.

### O procedimento de Lloyd: alternar os dois passos ótimos até nada mudar

O procedimento de Lloyd apenas itera as duas operações acima — atribuir pontos a clusters via a regra do centro mais próximo, depois recalcular cada centro como o centroide do seu cluster — até que a atribuição pare de mudar:

```java
// Procedimento de Lloyd, seguindo os quatro passos numerados do CLRS.
// Entrada: S, um conjunto de pontos em R^d; k, o número de clusters.
// Saída: um k-clustering de S e seus k centros.
double[][] centers = pickKRandomPointsFrom(S);   // passo 1: centros iniciais, k pontos aleatórios de S
int[] assignment = new int[S.length];            // todo ponto começa no cluster 0

while (true) {
    // passo 2: atribui cada ponto ao cluster com o centro mais próximo
    // (nunca reatribui a menos que o novo centro seja *estritamente* mais próximo que o antigo)
    boolean changed = reassignByNearestCenter(S, centers, assignment);

    // passo 3: para se o passo 2 não fez nenhuma mudança
    if (!changed) {
        return new Clustering(assignment, centers);
    }

    // passo 4: recalcula cada centro como o centroide do seu cluster
    // (o vetor zero se um cluster estiver vazio), depois volta ao passo 2
    centers = recomputeCentroids(S, assignment, k);
}
```

Um cluster pode voltar vazio do passo 4, especialmente quando muitos pontos de entrada são idênticos, caso em que seu centro é definido como o vetor zero. O procedimento de Lloyd tem terminação garantida: pelo Teorema 33.1, recalcular centros como centroides nunca pode aumentar f(S, C), e um ponto só é reatribuído quando isso diminui f(S, C) estritamente. Então toda iteração exceto a última diminui estritamente o objetivo, e como existe apenas um número finito de k-clusterings possíveis de S (no máximo k^n deles), o procedimento não pode rodar para sempre. Na prática, rodá-lo até precisar de k^n iterações é impraticável, então é comum parar assim que a redução percentual em f(S, C) da última iteração cai abaixo de um limiar — e, como o procedimento de Lloyd só garante um ótimo local, uma estratégia comum para achar um *bom* clustering é rodá-lo várias vezes a partir de centros iniciais aleatórios diferentes e manter o melhor resultado.

Uma iteração custa O(dkn) tempo para atribuir pontos a clusters via a regra do centro mais próximo (cada um dos n pontos comparado contra k centros, cada comparação custando O(d)), e O(dn) tempo para recalcular centros como centroides (cada ponto contribui para exatamente uma soma corrente de um cluster). Então o tempo de execução total, ao longo de T iterações, é O(Tdkn).

### Exemplo resolvido: quantização vetorial para compressão de foto

O CLRS aplica o procedimento de Lloyd à *quantização vetorial*: reduzir o número de cores distintas necessárias para representar uma fotografia para que ela comprima mais (ainda que com perdas). A foto de exemplo tem 700 pixels de largura por 500 pixels de altura — 350.000 pixels no total — cada um originalmente codificado como uma tripla RGB de 24 bits (três valores de 8 bits), dando um espaço inicial de até 2^24 cores possíveis por pixel (a foto real tem 79.083 cores distintas, já que muitos pixels se repetem). Aqui, os "pontos" sendo agrupados são as próprias cores dos pixels, cada uma um ponto no espaço tridimensional de valores RGB. Rodar o procedimento de Lloyd comprime a imagem para um espaço de apenas k cores distintas — o livro mostra resultados para k = 4, 16, 64 e 256 — onde esses valores de k *são* os centros dos clusters. Cada pixel pode então ser representado com apenas ⌈lg k⌉ bits em vez de 24: 2 bits para k = 4, 4 bits para k = 16, 6 bits para k = 64, 8 bits para k = 256. Uma tabela auxiliar, a "paleta," acompanha a imagem comprimida, contendo os k centros de cluster de 24 bits, e é usada para mapear o valor comprimido de cada pixel de volta a uma cor RGB de 24 bits na descompressão. O livro reporta o valor do objetivo f e a contagem de iterações que o procedimento de Lloyd levou para convergir em cada k: f ≈ 1,29×10^9 em 31 iterações para k = 4, f ≈ 3,31×10^8 em 36 iterações para k = 16, f ≈ 5,50×10^7 em 59 iterações para k = 64, e f ≈ 1,52×10^7 em 104 iterações para k = 256 — o objetivo encolhendo conforme k cresce, ao custo de mais iterações para convergir e mais bits por pixel.

O CLRS também roda um segundo exemplo, sem foto: agrupando n = 49 pontos (as capitais dos 48 estados americanos continentais mais o Distrito de Columbia, cada um com latitude e longitude como seus dois atributos) em k = 4 clusters, começando pelas capitais de Arkansas, Kansas, Louisiana e Tennessee como os centros iniciais. O objetivo f cai de 3659,13 no clustering inicial, ao longo das iterações, até 1395,73, onde permanece inalterado entre a 10ª e a 11ª iteração — ponto em que o procedimento de Lloyd termina.

### O framework geral de machine learning que o procedimento de Lloyd ilustra

O CLRS enquadra k-means como uma instância de um padrão comum a muitos algoritmos de machine learning: primeiro, defina um espaço de hipóteses como uma sequência de parâmetros θ, onde cada θ escolhe uma hipótese específica h_θ (para k-means, θ é o vetor dk-dimensional dos k centros de cluster, e h_θ é "agrupe cada ponto com qualquer centro de cluster que esteja mais próximo dele"); segundo, defina uma medida f(E, θ) de quão mal h_θ se ajusta aos dados de treino E, onde menor é melhor (para k-means, isso é exatamente f(S, C) da equação 33.2); terceiro, use um procedimento de otimização para encontrar um θ* que (pelo menos localmente) minimiza f(E, θ*) — para k-means, esse procedimento de otimização é o próprio procedimento de Lloyd, e θ* é a sequência de centros C que ele retorna.

## Trade-offs

- **Só ótimo local, sem garantia global** — k-means (encontrar o C que minimiza globalmente f(S, C)) é NP-hard, então o procedimento de Lloyd se contenta com um mínimo local: cada cluster tem um centro ótimo (centroide), e cada ponto está em seu cluster mais próximo — condições necessárias mas não suficientes para o verdadeiro ótimo global. A própria forma do livro de lidar com isso é rodar o procedimento de Lloyd várias vezes a partir de centros iniciais aleatórios diferentes e manter qualquer que seja a execução que produza o menor f.
- **k precisa ser dado, não descoberto** — o CLRS presume que k é fornecido como entrada; observa que algumas variantes do problema de clustering derivam k do próprio procedimento em vez disso, mas essa variante não é o que o procedimento de Lloyd aqui resolve.
- **O limite de iteração de pior caso k^n é impraticável, então execuções reais usam um limiar de parada antecipada** — a prova de terminação só garante que o procedimento para dentro de no máximo k^n iterações (o número de k-clusterings possíveis de n pontos), o que seria impraticável se realmente alcançado; na prática, as execuções são interrompidas assim que a redução percentual em f(S, C) entre iterações cai abaixo de um limiar.
- **A medida de dissimilaridade e o escalonamento de atributos são decisões de julgamento, não fixadas pelo algoritmo** — a distância euclidiana ao quadrado é convencional e matematicamente conveniente (é o que torna o centroide o centro provadamente ótimo, pelo Teorema 33.1), mas o CLRS é explícito ao dizer que é uma escolha arbitrária — por exemplo, usar distância simples (não ao quadrado) é igualmente legítimo para um problema como o exemplo das capitais estaduais. Da mesma forma, se e como normalizar atributos (min-max para [0,1] vs. média-0/variância-unitária) fica a cargo do praticante, e pular isso quando os atributos têm escalas muito diferentes deixa um atributo dominar o cálculo de dissimilaridade.
- **Clusters vazios são uma possibilidade real** — se muitos pontos de entrada são idênticos (ou, mais geralmente, se um centro acaba não sendo o mais próximo de nenhum ponto), o passo 4 define o centro daquele cluster como o vetor zero em vez de deixá-lo indefinido; esse é o comportamento esperado, não um bug a se prevenir.

## Documentation Links

- [Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th Edition, Section 33.1 "Clustering", pp. 1005-1014](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
