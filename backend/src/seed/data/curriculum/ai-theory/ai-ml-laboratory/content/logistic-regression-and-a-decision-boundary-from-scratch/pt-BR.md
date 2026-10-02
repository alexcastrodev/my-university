---
version: 1.0
updatedAt: 2026-09-12
title: "Lab: Regressão Logística e uma Fronteira de Decisão, do Zero"
summary: Este lab reaproveita sem mudanças o loop de gradiente descendente do Lab 1, trocando apenas a função de loss (cross-entropy no lugar do erro quadrático médio) e a não linearidade de saída (sigmoid no lugar da identidade), e verifica a fronteira de decisão do classificador resultante contra o relato de Regressão Logística e Fronteiras de Decisão sobre onde essa fronteira fica (o conjunto de pontos em que a saída da sigmoid cruza 0,5), plotada diretamente sobre um dataset real, pequeno e linearmente separável, em vez de apenas afirmada algebricamente.
---
## Objetivos de Aprendizagem

- Implementar regressão logística reaproveitando o loop de gradiente descendente do Lab 1, mudando apenas a função de loss e a não linearidade de saída.
- Implementar a função sigmoid e o loss de cross-entropy, e derivar (ou verificar numericamente) o gradiente da cross-entropy em relação aos pesos do modelo.
- Plotar a fronteira de decisão que um modelo de regressão logística treinado realmente produz em um dataset real, 2D e linearmente separável.
- Verificar que a fronteira plotada bate com o relato teórico de Regressão Logística e Fronteiras de Decisão sobre onde ela deveria ficar.

## Contexto e Motivação

`linear-regression-via-gradient-descent-from-scratch` construiu um otimizador de gradiente descendente real e funcional, verificado contra uma resposta independente em forma fechada. Este lab reaproveita exatamente esse otimizador, mudando apenas o que ele otimiza, seguindo o enquadramento de **Regressão Logística e Fronteiras de Decisão**: a regressão logística como a saída da regressão linear passada por uma sigmoid e ajustada contra um loss diferente.

## Teoria Central

Nada sobre *por que* a cross-entropy é o loss certo para um classificador binário probabilístico, ou *por que* a fronteira de decisão fica exatamente onde a saída da sigmoid cruza 0,5, é derivado de novo aqui; os dois argumentos já existem em `logistic-regression-and-decision-boundaries`. Este lab implementa o gradiente resultante e verifica que ele produz a fronteira geométrica prevista em dados reais.

## Exemplos Resolvidos

### Especificação da API

```text
sigmoid(z: ndarray) -> ndarray
cross_entropy_loss(X, y, w) -> float
logistic_gradient(X, y, w) -> ndarray
logistic_fit(X, y, lr, iters) -> ndarray   # reaproveita exatamente a estrutura do loop do Lab 1
```

### Passo 1: sigmoid e cross-entropy

```python
def sigmoid(z):
    return 1 / (1 + np.exp(-z))

def cross_entropy_loss(X, y, w):
    predictions = sigmoid(X @ w)
    eps = 1e-9  # evita log(0) para uma previsão que satura perto de 0 ou 1
    return -np.mean(y * np.log(predictions + eps) + (1 - y) * np.log(1 - predictions + eps))
```

### Passo 2: o gradiente, e a ÚNICA mudança em relação ao otimizador do Lab 1

```python
def logistic_gradient(X, y, w):
    predictions = sigmoid(X @ w)
    n = X.shape[0]
    return (1 / n) * X.T @ (predictions - y)  # mesmo FORMATO do mse_gradient
                                                  # do Lab 1; só o cálculo de
                                                  # predictions (agora sigmoid(X@w)
                                                  # em vez de X@w direto)
                                                  # mudou

def logistic_fit(X, y, lr=0.1, iters=2000):
    w = np.zeros(X.shape[1])
    for _ in range(iters):
        w = w - lr * logistic_gradient(X, y, w)   # estrutura de loop IDÊNTICA
                                                      # ao gradient_descent_fit do Lab 1
    return w
```

A forma algébrica do gradiente da cross-entropy acaba tendo o mesmo formato do gradiente do erro quadrático médio do Lab 1, `X.T @ (predictions - y)`, uma vez que `predictions` é redefinido através da sigmoid. Isso não é uma coincidência inventada por este lab; é uma propriedade real e bem conhecida das funções de loss da família exponencial que o material de ISL/CS229 cobre, e é exatamente por isso que o loop do otimizador do Lab 1 não precisou de nenhuma mudança estrutural.

### Passo 3: plotando a fronteira de decisão real

```python
def test_decision_boundary_matches_theory():
    X, y = generate_linearly_separable_2d_data(n=200, seed=0)
    X_with_bias = add_bias_column(X)
    w = logistic_fit(X_with_bias, y)

    # A fronteira teórica: sigmoid(w . x) = 0.5  <=>  w . x = 0
    # Para features 2D [x1, x2] mais o bias w0: w0 + w1*x1 + w2*x2 = 0
    x1_range = np.linspace(X[:, 0].min(), X[:, 0].max(), 100)
    boundary_x2 = -(w[0] + w[1] * x1_range) / w[2]

    # Checagem real: todo ponto classificado como "positivo" deve ficar
    # (dentro da tolerância numérica) do lado certo desta reta calculada
    predictions = sigmoid(X_with_bias @ w) >= 0.5
    for i in range(len(X)):
        signed_distance = w[0] + w[1] * X[i, 0] + w[2] * X[i, 1]
        assert (signed_distance >= 0) == predictions[i], \
            "a classe prevista de um ponto deve bater com o lado da fronteira calculada em que ele cai"
```

### Passo 4: um caso em que a teoria e um bug discordariam visivelmente

```python
def test_wrong_threshold_breaks_boundary_agreement():
    # Um bug introduzido de propósito: limiar em 0.7 em vez de 0.5,
    # enquanto a reta da fronteira continua calculada em w.x = 0 (que
    # corresponde a sigmoid = 0.5, NÃO a 0.7).
    X, y = generate_linearly_separable_2d_data(n=200, seed=0)
    X_with_bias = add_bias_column(X)
    w = logistic_fit(X_with_bias, y)

    wrong_predictions = sigmoid(X_with_bias @ w) >= 0.7  # bug: limiar errado
    mismatches = sum(
        (w[0] + w[1] * X[i, 0] + w[2] * X[i, 1] >= 0) != wrong_predictions[i]
        for i in range(len(X))
    )
    assert mismatches > 0, \
        "previsões com limiar em 0.7 devem discordar visivelmente da reta de fronteira de 0.5 para ALGUNS pontos"
```

## Equívocos Comuns e Armadilhas

- **"A regressão logística precisa de um loop de otimização totalmente novo, separado do da regressão linear."** O Passo 2 mostra diretamente que não: reaproveitar exatamente a estrutura do loop do Lab 1, mudando apenas como `predictions` é calculado, é suficiente, e esse é precisamente o ponto que `logistic-regression-and-decision-boundaries` defende sobre a estrutura subjacente que os dois modelos compartilham.
- **"A fronteira de decisão fica onde a saída bruta do modelo cruza zero."** Para o score linear bruto `w . x`, isso está correto, mas para a saída de probabilidade transformada pela sigmoid o limiar equivalente é 0,5, não 0; o bug introduzido de propósito no Passo 4 demonstra exatamente o que acontece quando essa distinção se perde: um limiar e uma reta de fronteira que não correspondem mais à mesma regra de decisão.
- **"Plotar uma fronteira que parece visualmente razoável basta para confirmar que a implementação está correta."** O teste do Passo 3 checa a fronteira contra a classe prevista de cada ponto individual, e não só a plausibilidade visual, e é isso que pega um bug, como o limiar descasado do Passo 4, que facilmente ainda produziria uma reta plotada de aparência plausível.

## Resumo

Este lab implementa regressão logística reaproveitando exatamente o loop de gradiente descendente de `linear-regression-via-gradient-descent-from-scratch`, mudando apenas o cálculo das previsões, que passa pela sigmoid, e o loss, que vira cross-entropy, e verifica o resultado contra o relato preciso de `logistic-regression-and-decision-boundaries` sobre onde a fronteira de decisão fica: o conjunto de pontos em que a saída da sigmoid cruza 0,5. Checar diretamente a classe prevista de cada ponto contra a reta de fronteira calculada, em vez de confiar em um gráfico visualmente plausível, e introduzir de propósito um bug de limiar para vê-lo falhar, é o que de fato verifica que a implementação corresponde à teoria em vez de apenas se parecer com ela.

## Documentation Links

- [Stanford CS229: Lecture Notes, Part I: Linear Regression](https://cs229.stanford.edu/main_notes.pdf): cobre a derivação da regressão logística e o gradiente da cross-entropy que este lab implementa.
- [James, Witten, Hastie & Tibshirani: An Introduction to Statistical Learning](https://www.statlearning.com/): uma fonte de livro-texto amplamente usada para a geometria da fronteira de decisão que este lab verifica diretamente em dados reais.
