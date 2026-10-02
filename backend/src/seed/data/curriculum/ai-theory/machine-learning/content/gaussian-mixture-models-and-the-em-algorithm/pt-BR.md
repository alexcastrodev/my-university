---
version: 1.0
updatedAt: 2026-09-06
title: Modelos de Mistura Gaussiana e o Algoritmo EM
summary: Uma generalização mais suave e probabilística do k-means, em que cada ponto recebe uma probabilidade de pertencer a cada uma de várias distribuições normais sobrepostas, ajustadas alternando entre estimar essas probabilidades (passo E) e reajustar as distribuições para corresponder a elas (passo M).
---
## Objetivos de Aprendizagem

- Explicar como um modelo de mistura gaussiana generaliza o k-means atribuindo a cada ponto uma probabilidade suave de pertencer a cada cluster, em vez de uma única atribuição rígida.
- Enunciar os dois passos do algoritmo EM (passo E e passo M) e explicar o que cada um calcula.
- Rastrear à mão um passo E e um passo M completos num pequeno exemplo resolvido.
- Explicar em que sentido o k-means é um caso especial e simplificado de um modelo de mistura gaussiana ajustado pelo EM.

## Contexto e Motivação

O k-means, recém-visto, atribui cada ponto a exatamente um cluster, uma atribuição **rígida** sem nenhuma noção de incerteza. Clusters reais, porém, muitas vezes se sobrepõem: um ponto que fica entre dois grupos visualmente distintos é genuinamente ambíguo, e forçá-lo para um cluster ou para o outro descarta informação real. Um modelo de mistura gaussiana (GMM) torna isso mais suave e expressivo: em vez de `k` centros de cluster, ele ajusta `k` distribuições gaussianas completas (reaproveitando a distribuição normal já vista em `foundations/probability-statistics`, agora em sua forma multivariada) e, em vez de uma atribuição rígida de 0/1, dá a cada ponto uma probabilidade de pertencer a cada cluster.

## Teoria Central

### O modelo

Um GMM supõe que os dados são gerados por uma mistura de `k` distribuições gaussianas, cada uma com sua própria média `μⱼ`, covariância `Σⱼ` e peso de mistura `πⱼ` (a proporção geral dos dados que vem do cluster `j`, com `Σⱼ πⱼ = 1`). A densidade de probabilidade geral num ponto `x` é:

```text
p(x) = Σⱼ πⱼ · N(x; μⱼ, Σⱼ)
```

Ajustar um GMM significa estimar todos os parâmetros `πⱼ`, `μⱼ` e `Σⱼ` a partir de dados não rotulados, um problema de estimação genuinamente mais difícil que ajustar uma única gaussiana (como a GDA fez antes nesta disciplina, com rótulos de classe conhecidos), porque a atribuição "qual cluster gerou este ponto" agora também é desconhecida e precisa ser estimada junto com os parâmetros das distribuições.

### O algoritmo EM

O **algoritmo Expectation-Maximization (EM)** ajusta um GMM alternando entre dois passos, em paralelo direto com o laço atribuir/atualizar do k-means, mas numa forma suave e probabilística:

- **Passo E (Expectation)**: dadas as estimativas atuais dos parâmetros, calcular, para cada ponto e cada cluster, a probabilidade de aquele ponto pertencer àquele cluster (sua "responsabilidade"), uma atribuição suave, e não rígida.
- **Passo M (Maximization)**: dadas essas atribuições suaves, recalcular a média, a covariância e o peso de mistura de cada cluster como uma média *ponderada* sobre todos os pontos, ponderada pela responsabilidade deles por aquele cluster.

Esses dois passos são repetidos até os parâmetros pararem de mudar de forma significativa, exatamente como o k-means repete atribuir/atualizar até convergir. O EM tem a garantia comprovada de nunca diminuir a verossimilhança geral dos dados a cada passo, a mesma garantia de melhora monotônica que tornou demonstrável a convergência do k-means.

### O k-means como caso especial de GMM/EM

O k-means pode ser visto como um limite simplificado e "rígido" de um GMM ajustado pelo EM: se a covariância de todo cluster for forçada a ter a mesma forma fixa e esférica, e as responsabilidades suaves do passo E forem forçadas a ser exatamente 0 ou exatamente 1 (arredondando cada ponto para seu único cluster mais provável) em vez de probabilidades genuínas, o procedimento EM acima se reduz exatamente ao laço atribuir/atualizar do k-means. GMM/EM é a versão mais geral e probabilística, ao custo de um modelo mais difícil de ajustar e com mais parâmetros (uma matriz de covariância completa por cluster, em vez de só um centro).

## Exemplos Resolvidos

### Exemplo 1: um cálculo de responsabilidade suave

Suponha que um ponto `x` tenha verossimilhança `0.8` sob a gaussiana ajustada do cluster 1 e `0.2` sob a do cluster 2, com pesos de mistura iguais `π₁ = π₂ = 0.5`. O passo E calcula a responsabilidade do cluster 1 por este ponto usando o teorema de Bayes, a mesma fórmula já usada na GDA e no Naive Bayes antes nesta disciplina:

```text
responsabilidade(cluster 1) = (π₁ · 0.8) / (π₁ · 0.8 + π₂ · 0.2) = 0.4 / (0.4 + 0.1) = 0.4/0.5 = 0.8
responsabilidade(cluster 2) = 1 − 0.8 = 0.2
```

Este ponto é atribuído 80% ao cluster 1 e 20% ao cluster 2, uma atribuição suave que o k-means jamais conseguiria expressar, já que o k-means teria forçado este ponto inteiramente para o cluster 1.

### Exemplo 2: uma atualização do passo M usando responsabilidades suaves

Suponha que 3 pontos tenham responsabilidades pelo cluster 1 de `0.9, 0.8, 0.1`, respectivamente, com posições `x₁=(2,2), x₂=(3,3), x₃=(9,9)`. O passo M recalcula a média do cluster 1 como uma média ponderada pelas responsabilidades:

```text
μ₁ = (0.9·x₁ + 0.8·x₂ + 0.1·x₃) / (0.9 + 0.8 + 0.1)
   = (0.9·(2,2) + 0.8·(3,3) + 0.1·(9,9)) / 1.8
   = ((1.8+2.4+0.9)/1.8, (1.8+2.4+0.9)/1.8)
   = (5.1/1.8, 5.1/1.8) ≈ (2.83, 2.83)
```

O ponto distante `x₃` ainda contribui para a média, mas só ponderado pela sua pequena responsabilidade de 0.1, uma atração bem menor que a dos dois pontos atribuídos com mais confiança a este cluster. É exatamente o tipo de influência gradual, ponderada por probabilidade, que uma atribuição rígida do k-means não consegue representar.

## Equívocos Comuns e Armadilhas

- **"GMM/EM sempre encontra uma clusterização melhor que o k-means."** O GMM é mais expressivo (consegue ajustar clusters alongados, sobrepostos e de formatos diferentes, que a suposição esférica do k-means não consegue), mas também tem mais parâmetros para estimar e é proporcionalmente mais propenso a overfitting em conjuntos de dados pequenos; e, assim como o k-means, o EM só garante convergência para um ótimo local, não para o global.
- **"O passo E e o passo M são dois cálculos independentes que poderiam rodar em qualquer ordem."** Eles são estritamente sequenciais e interdependentes: o passo E precisa das estimativas atuais dos parâmetros para calcular as responsabilidades, e o passo M precisa dessas responsabilidades para atualizar os parâmetros; a saída de cada passo é a entrada direta do seguinte.
- **"Responsabilidades suaves são só um pequeno refinamento das atribuições rígidas de cluster."** Como mostra o Exemplo 1, responsabilidades suaves carregam uma informação genuinamente diferente (incerteza sobre pontos ambíguos perto da fronteira de um cluster) que uma atribuição rígida de 0/1 descarta por completo. Essa é a diferença real e substantiva entre k-means e GMM, e não apenas uma diferença cosmética.

## Resumo

Um modelo de mistura gaussiana generaliza o k-means ajustando `k` distribuições gaussianas completas em vez de `k` pontos isolados e atribuindo a cada ponto uma responsabilidade suave e probabilística por cada cluster, em vez de uma atribuição rígida. O algoritmo EM ajusta esse modelo alternando um passo E (calcular as responsabilidades dados os parâmetros atuais, pela mesma maquinaria do teorema de Bayes usada na GDA e no Naive Bayes) e um passo M (atualizar os parâmetros como médias ponderadas pelas responsabilidades), em paralelo direto com o laço atribuir/atualizar do k-means, e comprovadamente o generalizando, com o k-means recuperável como um caso especial, de atribuição rígida, desse arcabouço mais geral.

## Documentation Links

- [Stanford CS229: Course Syllabus](https://cs229.stanford.edu/syllabus-autumn2018.html): lista modelos de mistura gaussiana e EM como o sucessor direto do k-means na unidade de aprendizado não supervisionado do curso.
- [Caltech CS 156: Learning From Data](https://work.caltech.edu/telecourse.html): o mesmo curso cujo enquadramento de classificação baseado no teorema de Bayes (via GDA) informa diretamente o cálculo de responsabilidade do passo E aqui.
