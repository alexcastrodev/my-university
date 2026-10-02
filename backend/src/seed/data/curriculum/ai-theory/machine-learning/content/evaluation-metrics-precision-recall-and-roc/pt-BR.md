---
version: 1.0
updatedAt: 2026-09-06
title: "Métricas de Avaliação: Precisão, Recall e ROC"
summary: Por que a acurácia bruta mente em dados desbalanceados, e as métricas derivadas da matriz de confusão (precisão, recall, F1 e a troca entre taxa de verdadeiros positivos e de falsos positivos da curva ROC) pelas quais um classificador real precisa de fato ser julgado.
---
## Objetivos de Aprendizagem

- Explicar por que a acurácia bruta é uma métrica enganosa em dados de classificação desbalanceados, com um exemplo numérico concreto.
- Definir a matriz de confusão e derivar dela a precisão, o recall e o F1 score.
- Explicar a troca entre precisão e recall e descrever como a curva ROC a visualiza em todos os limiares de classificação possíveis.
- Escolher uma métrica adequada para um dado cenário real de classificação, com base no custo relativo de falsos positivos versus falsos negativos.

## Contexto e Motivação

Todo classificador visto até agora nesta disciplina (regressão logística, GDA, Naive Bayes) foi julgado, implicitamente, por suas previsões estarem corretas ou não. Este conceito torna esse julgamento preciso e, crucialmente, mostra que "correto" não é um número único quando as classes são desbalanceadas ou quando falsos positivos e falsos negativos têm custos reais diferentes. Um filtro de spam que nunca marca nada como spam ainda atinge uma acurácia bruta alta se o spam for raro, um resultado genuinamente enganoso que motiva todas as métricas apresentadas aqui.

## Teoria Central

### A matriz de confusão

Para um classificador binário, toda previsão cai numa de quatro categorias, formando a **matriz de confusão**:

```text
                    Previsto Positivo          Previsto Negativo
Real Positivo       Verdadeiro Positivo (TP)   Falso Negativo (FN)
Real Negativo       Falso Positivo (FP)        Verdadeiro Negativo (TN)
```

### Precisão, recall e F1

```text
Precisão = TP / (TP + FP)      : de tudo o que foi previsto positivo, que fração de fato é?
Recall   = TP / (TP + FN)      : de tudo o que de fato é positivo, que fração o modelo pegou?
F1       = 2 · (Precisão · Recall) / (Precisão + Recall)     : a média harmônica das duas
```

Precisão e recall respondem perguntas genuinamente diferentes e podem andar em direções opostas: um classificador que prevê "positivo" para quase tudo atinge um recall quase perfeito (pega quase todo verdadeiro positivo), mas uma precisão muito ruim (a maioria das suas previsões positivas está errada). O F1 combina as duas num único número, útil quando ambas importam e nenhuma deve ser otimizada à custa total da outra.

### A curva ROC

A maioria dos classificadores (como a regressão logística) produz uma probabilidade, e um limiar (comumente 0.5) converte essa probabilidade numa decisão rígida de positivo/negativo. A **curva ROC (Receiver Operating Characteristic)** traça a taxa de verdadeiros positivos contra a taxa de falsos positivos conforme esse limiar percorre todos os valores possíveis de 0 a 1, dando um quadro completo da troca entre pegar mais verdadeiros positivos e aceitar mais falsos positivos, em vez de se comprometer com o único ponto dessa troca correspondente a um único limiar. A **área sob a curva ROC (AUC)** resume essa troca inteira num número, útil para comparar classificadores independentemente da escolha de um limiar específico.

## Exemplos Resolvidos

### Exemplo 1: por que a acurácia engana em dados desbalanceados

Considere um conjunto de dados com 1000 e-mails, dos quais 950 são legítimos e 50 são spam (um desbalanceamento realista). Um classificador que prevê "não spam" para todo e-mail atinge:

```text
Acurácia = (TP + TN) / Total = (0 + 950) / 1000 = 95.0%
```

Uma acurácia de 95% completamente inútil: o classificador não pega nenhum spam. Seu recall é `0 / 50 = 0%`, o que expõe imediatamente o problema que a acurácia sozinha escondia.

### Exemplo 2: um exemplo resolvido completo de matriz de confusão

Suponha que o mesmo conjunto de 1000 e-mails seja avaliado com um classificador de spam de verdade, resultando em:

```text
                  Previsto Spam     Previsto Não Spam
Real Spam         TP = 35           FN = 15
Real Não Spam     FP = 20           TN = 930

Precisão = 35 / (35 + 20) = 35/55 ≈ 0.636   (63.6% dos e-mails marcados são de fato spam)
Recall   = 35 / (35 + 15) = 35/50 = 0.700   (70.0% do spam verdadeiro foi pego)
F1       = 2 · (0.636 · 0.700) / (0.636 + 0.700) ≈ 0.667

Acurácia = (35 + 930) / 1000 = 96.5%
```

Os 96.5% de acurácia parecem fortes, mas a precisão (63.6%) e o recall (70.0%) revelam o quadro real, mais matizado: quase um terço dos e-mails marcados são alarmes falsos, e 30% do spam real ainda passa. É informação que o número de acurácia sozinho esconde por completo.

## Equívocos Comuns e Armadilhas

- **"Um modelo com 99% de acurácia é quase certamente excelente."** Em dados desbalanceados, 99% de acurácia pode ser atingido por um classificador trivial que nunca prevê a classe rara, exatamente como demonstrado no Exemplo 1. A acurácia sozinha não informa nada sem saber o balanceamento das classes e conferir diretamente precisão/recall.
- **"Precisão e recall devem sempre ser maximizados juntos."** Elas frequentemente estão em tensão direta: aumentar o limiar de classificação normalmente aumenta a precisão (previsões positivas em menor número e com mais confiança) e diminui o recall (mais verdadeiros positivos perdidos). O equilíbrio certo depende inteiramente do custo real de um falso positivo versus um falso negativo. Por exemplo, no rastreamento de câncer, deixar passar um caso verdadeiro (recall baixo) costuma ser muito mais caro que um alarme falso, então se prioriza recall alto mesmo com algum custo de precisão.
- **"A AUC sozinha basta para avaliar completamente um classificador."** A AUC resume o desempenho em todos os limiares, o que é útil para comparar modelos em abstrato, mas um sistema em produção se compromete com um limiar específico; a precisão e o recall reais nesse ponto de operação escolhido ainda precisam ser conferidos diretamente, e não inferidos só a partir da AUC.

## Resumo

A acurácia bruta pode ser perigosamente enganosa em dados de classificação desbalanceados, exatamente como demonstra um classificador ingênuo que "sempre prevê a classe majoritária". A precisão (correção das previsões positivas) e o recall (cobertura dos verdadeiros positivos) decompõem a matriz de confusão em duas métricas que se equilibram uma contra a outra conforme o limiar de classificação muda, com o F1 combinando-as num único escore equilibrado e a curva ROC/AUC visualizando a troca completa em todos os limiares possíveis. Escolher a métrica certa, e o limiar certo, depende do custo relativo real de falsos positivos versus falsos negativos na aplicação específica.

## Documentation Links

- [James, Witten, Hastie & Tibshirani: An Introduction to Statistical Learning](https://www.statlearning.com/): o Capítulo 3 (Classification) apresenta a matriz de confusão, precisão/recall e curvas ROC no mesmo estilo de exemplo resolvido usado aqui.
- [Stanford CS229: Lecture Notes, Part II: Classification and Logistic Regression](https://cs229.stanford.edu/main_notes.pdf): cobre métricas de avaliação de classificadores junto com o modelo de regressão logística ao qual elas se aplicam.
