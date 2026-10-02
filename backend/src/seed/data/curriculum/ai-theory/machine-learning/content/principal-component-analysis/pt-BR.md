---
version: 1.0
updatedAt: 2026-09-06
title: Análise de Componentes Principais
summary: Comprimir dados de alta dimensão em suas poucas direções mais informativas, que são literalmente os autovetores da própria matriz de covariância dos dados. É a garantia exata sobre matrizes simétricas já provada na disciplina de álgebra linear deste currículo, agora posta em uso direto.
---
## Objetivos de Aprendizagem

- Explicar o objetivo da redução de dimensionalidade: resumir dados de alta dimensão usando muito menos dimensões e preservando o máximo possível da sua variação.
- Enunciar com precisão como os componentes principais são definidos como direções de variância máxima e como isso se liga diretamente aos autovetores da matriz de covariância dos dados.
- Calcular à mão os componentes principais de um pequeno conjunto de dados 2D, usando os autovalores e autovetores da sua matriz de covariância.
- Explicar como os próprios autovalores quantificam quanta variância cada componente principal captura e como isso orienta a escolha de quantos componentes manter.

## Contexto e Motivação

`foundations/mathematics-for-computing` provou, no conceito `eigenvalues-of-symmetric-matrices`, uma garantia genuinamente nada óbvia: uma matriz simétrica sempre tem autovalores reais e autovetores ortogonais, e sinalizou explicitamente, na época, que essa garantia exata "está por baixo da PCA e de todo problema de otimização construído sobre uma matriz simétrica". Este conceito é onde essa referência adiantada finalmente é resgatada: a análise de componentes principais pega a matriz de covariância de um conjunto de dados (sempre simétrica, por construção), e seus autovetores, garantidamente ortogonais, se revelam exatamente as direções ao longo das quais os dados mais variam, em ordem decrescente.

## Teoria Central

### O objetivo: redução de dimensionalidade que preserva a variância

Dados com muitas features (dimensões), a PCA procura um número menor de direções novas e sintéticas, os **componentes principais**, que capturem o máximo possível da variância original dos dados. O primeiro componente principal é a única direção ao longo da qual os dados mais variam; o segundo é a direção de maior variância seguinte, com a restrição de ser ortogonal (em ângulo reto) ao primeiro; e assim por diante. Projetar os dados originais de alta dimensão em só os primeiros componentes principais os comprime em muito menos dimensões, descartando a variação menos informativa.

### Por que os autovetores da matriz de covariância são exatamente a resposta

Dados com matriz de covariância `Σ` (uma matriz simétrica, já que a covariância é sempre simétrica entre qualquer par de features), pode-se mostrar que a direção de variância máxima é exatamente o autovetor de `Σ` com o maior autovalor. Isso não é coincidência nem aproximação: é consequência direta do fato já provado de que os autovetores de uma matriz simétrica são ortogonais e seus autovalores são reais. Isso garante que os componentes principais (os autovetores do topo) fiquem automaticamente em ângulo reto entre si e que cada autovalor meça diretamente a quantidade de variância capturada na direção do seu autovetor correspondente.

### Escolhendo quantos componentes manter

Cada autovalor `λᵢ` da matriz de covariância é igual à variância capturada pelo componente principal correspondente. A proporção da variância total capturada ao manter os `m` componentes do topo é:

```text
(λ₁ + λ₂ + ... + λₘ) / (λ₁ + λ₂ + ... + λₙ)
```

em que o denominador soma todos os `n` autovalores originais. Uma prática comum é manter componentes suficientes para reter, digamos, 95% da variância total: um critério direto e calculável, em vez de uma escolha arbitrária de quantas dimensões manter.

## Exemplos Resolvidos

### Exemplo 1: PCA num pequeno conjunto de dados 2D, à mão

Considere dados 2D com matriz de covariância:

```text
Σ = [[4, 2],
     [2, 3]]
```

Encontrando os autovalores pela equação característica `det(Σ − λI) = 0`:

```text
(4−λ)(3−λ) − 4 = 0
λ² − 7λ + 12 − 4 = 0
λ² − 7λ + 8 = 0
λ = (7 ± √(49−32)) / 2 = (7 ± √17) / 2 ≈ (7 ± 4.123) / 2

λ₁ ≈ 5.56,   λ₂ ≈ 1.44
```

Resolver `(Σ − λ₁I)v = 0` para o autovetor em `λ₁ ≈ 5.56` dá uma direção de aproximadamente `v₁ ≈ (0.79, 0.62)` (normalizada): este é o primeiro componente principal, a direção de variância máxima. O segundo componente principal `v₂`, garantidamente ortogonal a `v₁` pela propriedade das matrizes simétricas já provada em `foundations/mathematics-for-computing`, aponta aproximadamente para `(−0.62, 0.79)`.

### Exemplo 2: calculando a variância retida

Usando os autovalores do Exemplo 1, a proporção da variância total capturada ao manter só o primeiro componente principal:

```text
λ₁ / (λ₁ + λ₂) = 5.56 / (5.56 + 1.44) = 5.56 / 7.00 ≈ 0.794
```

Manter só o equivalente a uma das duas dimensões originais de informação (como uma única direção sintética nova) retém cerca de 79.4% da variância total dos dados: uma base real e quantitativa para decidir se reduzir de 2 dimensões para 1 é uma simplificação aceitável numa dada aplicação, generalizando diretamente para decidir quantas de muitas dimensões originais manter.

## Equívocos Comuns e Armadilhas

- **"A PCA seleciona um subconjunto das features originais."** Não seleciona: os componentes principais são direções novas e sintéticas, cada uma normalmente uma combinação linear de *todas* as features originais, e não uma seleção de algumas features originais com descarte das outras (essa abordagem alternativa é a seleção de features, uma técnica diferente).
- **"Mais componentes principais sempre significam um modelo melhor."** Manter mais componentes retém mais da variância original, mas anula o propósito da redução de dimensionalidade (simplificação, redução de ruído, visualização). O número certo de componentes a manter é uma troca, orientada pelo critério de variância retida do Exemplo 2, e não simplesmente "o máximo possível".
- **"A PCA exige rótulos, como os classificadores vistos antes nesta disciplina."** A PCA é inteiramente não supervisionada: ela só olha para a estrutura de covariância das próprias features, sem referência a nenhuma variável-alvo `y`, exatamente como o k-means e o GMM antes dela no bloco não supervisionado desta disciplina.

## Resumo

A análise de componentes principais encontra direções novas e sintéticas de variância máxima em dados de alta dimensão calculando os autovetores da matriz de covariância dos dados, uma aplicação direta da garantia já provada em `foundations/mathematics-for-computing` de que os autovetores de uma matriz simétrica são ortogonais e seus autovalores são reais. Cada autovalor quantifica diretamente quanta variância o componente principal correspondente captura, dando uma base precisa e calculável para decidir quantos componentes manter ao comprimir os dados em menos dimensões.

## Documentation Links

- [Stanford CS229: Course Syllabus](https://cs229.stanford.edu/syllabus-autumn2018.html): lista a PCA como a técnica culminante da unidade de aprendizado não supervisionado do curso.
- [MIT 18.065: Syllabus (OCW)](https://ocw.mit.edu/courses/18-065-matrix-methods-in-data-analysis-signal-processing-and-machine-learning-spring-2018/pages/syllabus/): o mesmo curso de álgebra linear aplicada já citado para autovalores de matrizes simétricas, que deriva a PCA diretamente dessa propriedade.
