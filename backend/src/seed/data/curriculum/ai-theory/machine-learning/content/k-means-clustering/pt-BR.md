---
version: 1.0
updatedAt: 2026-09-06
title: Clusterização K-Means
summary: O primeiro algoritmo não supervisionado desta disciplina. Sem rótulo algum, ele alterna entre atribuir cada ponto ao mais próximo de k centros de cluster e recalcular cada centro como a média dos pontos atribuídos a ele, até nada mais se mover.
---
## Objetivos de Aprendizagem

- Explicar o que a clusterização pede, dados apenas dados não rotulados: agrupar pontos de modo que pontos dentro de um grupo sejam mais parecidos entre si que pontos de grupos diferentes.
- Enunciar o algoritmo k-means com precisão: inicializar k centros e então alternar entre atribuir pontos e recalcular centros.
- Rastrear à mão várias iterações do k-means num pequeno conjunto de dados 2D até a convergência.
- Explicar por que o k-means não tem garantia de encontrar a melhor clusterização global e por que o número de clusters k precisa ser escolhido de antemão.

## Contexto e Motivação

Todo modelo visto até agora nesta disciplina foi supervisionado, treinado com dados em que cada exemplo já traz um rótulo ou valor-alvo conhecido. A clusterização k-means é o primeiro algoritmo genuinamente não supervisionado desta disciplina: dados apenas vetores de features brutos, sem rótulo algum, ela pede ao modelo que descubra sozinho uma estrutura de agrupamento. É uma mudança real no que "aprender" sequer significa: não há verdade de referência contra a qual conferir uma atribuição de clusters, apenas uma noção interna do que torna um agrupamento bom (pontos perto do centro do próprio cluster e longe dos centros dos outros clusters).

## Teoria Central

### O algoritmo

O k-means agrupa `N` pontos em `k` clusters (`k` escolhido de antemão) pelo seguinte procedimento iterativo:

1. **Inicializar**: escolher `k` centros de cluster iniciais (comumente, `k` pontos aleatórios do conjunto de dados).
2. **Atribuir**: atribuir cada ponto ao centro mais próximo (pela distância euclidiana).
3. **Atualizar**: recalcular cada centro como a média de todos os pontos atualmente atribuídos a ele.
4. **Repetir** os passos 2 e 3 até as atribuições pararem de mudar (convergência).

### Por que isso converge

Cada iteração do k-means só pode diminuir (ou deixar inalterada) a soma total, dentro dos clusters, das distâncias ao quadrado dos pontos ao centro atribuído. O passo de atribuição leva cada ponto ao centro atual mais próximo (o que não pode aumentar esse total), e o passo de atualização recalcula cada centro como a média dos pontos atribuídos a ele, que é comprovadamente o único ponto que minimiza a distância total ao quadrado até aquele conjunto específico de pontos (o que também não pode aumentar esse total). Como esse total é limitado inferiormente por zero e nunca aumenta, o algoritmo tem garantia de convergir para uma atribuição estável, embora não necessariamente para o ótimo global.

### Por que o resultado depende da inicialização, e como escolher k

Como o k-means só diminui o objetivo a partir do estado atual, ele pode convergir para um **ótimo local**: uma inicialização aleatória diferente dos centros iniciais pode levar a uma clusterização final diferente, algumas melhores que outras. Na prática, o k-means é executado várias vezes a partir de inicializações aleatórias diferentes, e a execução com a menor distância total final é a que fica. Escolher o próprio `k` é um problema à parte: uma heurística comum, o "método do cotovelo", traça a distância total dentro dos clusters contra valores crescentes de `k` e procura o ponto em que acrescentar mais clusters deixa de reduzir esse total de forma significativa. É um julgamento de retornos decrescentes, e não um cálculo exato.

## Exemplos Resolvidos

### Exemplo 1: rastreando o k-means até a convergência em 6 pontos

Pontos: `A=(1,1), B=(1,2), C=(2,1), D=(8,8), E=(8,9), F=(9,8)`, com `k=2`, centros iniciais `c₁=(1,1)` (=A), `c₂=(9,8)` (=F).

```text
Iteração 1, atribuir:
  A,B,C estão mais perto de c₁=(1,1)  →  cluster 1
  D,E,F estão mais perto de c₂=(9,8)  →  cluster 2
Atualizar:
  c₁ = média(A,B,C) = ((1+1+2)/3, (1+2+1)/3) = (1.33, 1.33)
  c₂ = média(D,E,F) = ((8+8+9)/3, (8+9+8)/3) = (8.33, 8.33)

Iteração 2, atribuir:
  O centro mais próximo de cada ponto não muda (A,B,C continuam mais perto de c₁; D,E,F de c₂)
  → atribuições idênticas às da iteração 1 → CONVERGIU
```

Duas iterações chegam a uma clusterização estável e sensata: os dois grupos visualmente óbvios (perto da origem e perto de (8,8)) são recuperados exatamente.

### Exemplo 2: um caso em que o k-means empaca num ótimo local ruim

Suponha, em vez disso, que os dois centros iniciais caiam por acaso dentro do mesmo grupo visualmente óbvio (por exemplo, `c₁=(1,1)`, `c₂=(1,2)`, ambos perto do cluster A/B/C). O passo de atribuição pode dividir o grupo A/B/C entre os dois centros e juntar D, E, F com o centro de que cada um estiver mais perto, produzindo uma clusterização que não corresponde de jeito nenhum à estrutura óbvia de dois grupos, e as iterações seguintes, partindo dessa inicialização ruim, podem nunca recuperá-la. É exatamente por isso que executar o k-means a partir de várias inicializações aleatórias diferentes e ficar com o melhor resultado é prática padrão, e não um refinamento opcional.

## Equívocos Comuns e Armadilhas

- **"O k-means sempre encontra a melhor clusterização possível."** Ele só tem garantia de convergir para *um* ótimo local e, como mostra o Exemplo 2, uma inicialização ruim pode produzir um resultado claramente subótimo; várias reinicializações aleatórias são a mitigação padrão e necessária.
- **"O k-means consegue descobrir sozinho o número certo de clusters."** `k` precisa ser escolhido antes de executar o algoritmo; o k-means vai produzir exatamente `k` clusters quer os dados tenham naturalmente essa quantidade de grupos ou não, forçando uma divisão ou fusão que não reflete a estrutura real se `k` for mal escolhido.
- **"Como não há verdade de referência, qualquer resultado de clusterização é igualmente válido."** Embora não exista uma única resposta "correta" como na classificação supervisionada, o próprio objetivo interno do algoritmo (a distância total dentro dos clusters) ainda dá um escore objetivo e comparável entre execuções diferentes ou valores diferentes de `k`, mesmo sem rótulos externos.

## Resumo

O k-means agrupa dados não rotulados em `k` grupos alternando entre atribuir cada ponto ao centro atual mais próximo e recalcular cada centro como a média dos pontos atribuídos a ele, convergindo comprovadamente porque cada passo só pode diminuir a distância total dentro dos clusters. Ele não tem garantia de atingir o ótimo global (inicializações aleatórias diferentes podem convergir para ótimos locais diferentes, às vezes ruins), e o número de clusters `k` precisa ser escolhido de antemão, normalmente por uma heurística de retornos decrescentes. É o primeiro algoritmo genuinamente não supervisionado desta disciplina, avaliado por um objetivo interno, e não por alguma verdade de referência externa.

## Documentation Links

- [Stanford CS229: Course Syllabus](https://cs229.stanford.edu/syllabus-autumn2018.html): lista o k-means como porta de entrada da unidade de aprendizado não supervisionado do curso.
- [James, Witten, Hastie & Tibshirani: An Introduction to Statistical Learning](https://www.statlearning.com/): o Capítulo 10 (Unsupervised Learning) cobre o k-means junto com a heurística do método do cotovelo para escolher k.
