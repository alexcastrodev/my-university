---
version: 1.0
updatedAt: 2026-09-06
title: "Ensembles: Bagging, Boosting e Random Forests"
summary: Combinar muitas árvores individualmente fracas ou com overfitting num único modelo forte. O bagging tira a média de muitas árvores independentes e de alta variância para cancelar seu ruído, enquanto o boosting constrói árvores em sequência, cada uma corrigindo os erros da anterior.
---
## Objetivos de Aprendizagem

- Explicar o princípio geral por trás dos métodos de ensemble: combinar muitos modelos individualmente imperfeitos num só, que se sai melhor que qualquer membro isolado.
- Descrever o bagging (bootstrap aggregating) e explicar, com precisão, por que tirar a média de muitos modelos independentes de alta variância reduz a variância sem mudar o viés.
- Descrever como uma random forest acrescenta amostragem de features ao bagging e por que isso melhora as árvores com bagging simples.
- Descrever a estratégia fundamentalmente diferente do boosting (correção sequencial de erros) e contrastá-la diretamente com o bagging.

## Contexto e Motivação

O conceito anterior terminou observando que uma árvore de decisão sem restrições é um modelo de alta variância: precisa nos seus próprios dados de treino, mas sensível a exatamente qual amostra foi usada para treiná-la. Os métodos de ensemble tratam disso não restringindo uma árvore isolada (como fazem a poda ou os limites de profundidade), mas treinando *muitas* árvores e combinando suas previsões. Isso transforma a própria instabilidade que torna uma árvore profunda isolada pouco confiável numa vantagem, já que árvores instáveis diferentes tendem a cometer erros diferentes, que se cancelam parcialmente quando se tira a média.

## Teoria Central

### Bagging: tirando a média de muitos modelos independentes de alta variância

O **bootstrap aggregating (bagging)** sorteia muitas amostras bootstrap (amostras aleatórias do mesmo tamanho do conjunto de treino original, sorteadas com reposição) a partir dos dados de treino, ajusta uma árvore de decisão profunda e sem restrições separada a cada amostra bootstrap e combina suas previsões por média (para regressão) ou voto da maioria (para classificação). Como cada árvore vê uma amostra bootstrap um pouco diferente, cada uma comete erros um pouco diferentes; tirar a média de muitas dessas árvores reduz o componente de *variância* do erro de previsão (da decomposição viés-variância desta disciplina) sem aumentar o viés de forma significativa, já que as árvores, em média, continuam ajustando o mesmo padrão subjacente verdadeiro.

### Random forests: bagging mais aleatoriedade nas features

Uma **random forest** acrescenta mais uma fonte de aleatoriedade ao bagging: em cada divisão de cada árvore, só um subconjunto aleatório das features disponíveis é considerado como candidato, em vez de todas as features. Isso descorrelaciona deliberadamente ainda mais as árvores. Sem isso, se uma feature é muito fortemente preditiva, quase toda árvore do bagging escolheria dividir por ela perto da raiz, tornando as árvores altamente correlacionadas entre si e limitando quanto a média consegue reduzir a variância (tirar a média de estimativas correlacionadas reduz menos a variância que tirar a média de estimativas independentes). Forçar cada árvore a às vezes ignorar a melhor feature isolada produz um ensemble mais diverso e, empiricamente, uma redução de variância melhor.

### Boosting: correção sequencial de erros, uma estratégia totalmente diferente

O **boosting** adota uma abordagem fundamentalmente diferente das árvores paralelas e independentes do bagging. O boosting constrói árvores **em sequência**, e cada nova árvore é treinada especificamente para corrigir os erros do ensemble construído até ali, por exemplo ajustando a próxima árvore aos erros *residuais* das previsões do ensemble atual (como no gradient boosting), de modo que cada acréscimo concentra o esforço computacional exatamente onde o modelo está mais fraco no momento. Diferente das árvores individualmente profundas e de alta variância do bagging, o boosting normalmente usa árvores muito rasas (às vezes uma única divisão) como membros individuais, já que cada uma só precisa corrigir um pequeno pedaço do erro restante, e não modelar o padrão inteiro sozinha.

## Exemplos Resolvidos

### Exemplo 1: bagging reduzindo a variância pela média

Suponha que 5 árvores individualmente de alta variância, cada uma treinada numa amostra bootstrap diferente, prevejam o preço de uma casa como: `210k, 195k, 230k, 180k, 225k` (preço verdadeiro: 208k). Tirando a média:

```text
Previsão com bagging = (210 + 195 + 230 + 180 + 225) / 5 = 1040 / 5 = 208k
```

A média cai muito perto do valor verdadeiro, mesmo com as árvores individuais variando de 180k a 230k: uma ilustração real e calculável da redução de variância pela média, em que o erro de cada árvore se cancela em parte contra os erros das outras na direção oposta.

### Exemplo 2: uma rodada de gradient boosting, à mão

Suponha que os valores-alvo verdadeiros de 3 exemplos sejam `[10, 20, 30]` e que o ensemble atual (talvez só uma primeira árvore bem simples) preveja `[8, 22, 25]`. Os resíduos, que o boosting ajusta em seguida, são:

```text
Resíduos = verdadeiro − previsto = [10−8, 20−22, 30−25] = [2, −2, 5]
```

Uma nova árvore rasa é então treinada especificamente para prever esses resíduos (e não os alvos originais), e suas previsões são *somadas* às previsões do ensemble atual (normalmente reduzidas por uma pequena taxa de aprendizado, exatamente como no gradient descent visto antes nesta disciplina). Se essa nova árvore prevê resíduos de `[1.8, −1.5, 4.2]`, a previsão atualizada do ensemble vira `[8+1.8, 22−1.5, 25+4.2] = [9.8, 20.5, 29.2]`, visivelmente mais perto dos verdadeiros `[10, 20, 30]` do que antes desta rodada de boosting.

## Equívocos Comuns e Armadilhas

- **"Mais árvores num ensemble com bagging sempre arriscam overfitting, assim como uma árvore isolada mais profunda."** Isso é falso especificamente para o bagging: acrescentar mais árvores de amostras bootstrap à média em geral não aumenta o risco de overfitting (reduz ainda mais a variância), ao contrário de aumentar a profundidade de uma árvore isolada, o que aumenta diretamente a capacidade dessa árvore de sofrer overfitting.
- **"Random forests e árvores com bagging são essencialmente a mesma coisa."** A etapa de subamostragem de features não é um detalhe menor: é especificamente o que descorrelaciona as árvores quando uma feature domina, e sua ausência (bagging simples) pode deixar um ensemble bem menos eficaz na redução de variância que uma random forest de verdade, em dados com alguns preditores muito fortes.
- **"Boosting e bagging são técnicas intercambiáveis para o mesmo objetivo."** Elas atacam metades diferentes da troca viés-variância: o bagging reduz principalmente a variância tirando a média de muitos modelos já de baixo viés e alta variância; o boosting reduz principalmente o viés acrescentando capacidade em sequência exatamente onde o ensemble atual sofre underfitting, muitas vezes partindo de árvores individuais de alto viés e baixa variância.

## Resumo

Métodos de ensemble combinam muitos modelos individualmente imperfeitos para superar qualquer um deles isolado. O bagging treina muitas árvores profundas e sem restrições em amostras bootstrap independentes e tira a média de suas previsões, reduzindo diretamente o componente de variância do erro identificado pela decomposição viés-variância desta disciplina; as random forests acrescentam subamostragem aleatória de features em cada divisão para descorrelacionar ainda mais as árvores e reduzir melhor a variância. O boosting adota uma estratégia totalmente diferente (construir árvores em sequência, cada uma corrigindo os erros residuais do ensemble atual), reduzindo principalmente o viés em vez da variância e normalmente usando árvores individuais bem mais rasas que as do bagging.

## Documentation Links

- [James, Witten, Hastie & Tibshirani: An Introduction to Statistical Learning](https://www.statlearning.com/): o Capítulo 7 cobre bagging, random forests e boosting juntos, com o enquadramento de viés-variância usado aqui.
- [Caltech CS 156: Learning From Data, Lecture 8: Bias-Variance Tradeoff](https://work.caltech.edu/telecourse.html): a decomposição que este conceito aplica diretamente para explicar por que o bagging funciona.
