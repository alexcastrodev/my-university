---
version: 1.0
updatedAt: 2026-09-12
title: "Lab: Regressão Linear via Gradiente Descendente, do Zero"
summary: Regressão Linear como Mínimos Quadrados e Gradiente Descendente como Otimizador Geral já provam, no papel, que minimizar o erro quadrático médio tem uma solução em forma fechada e que o gradiente descendente converge iterativamente para ela; este lab implementa as duas coisas, em NumPy puro, sem scikit-learn em nenhum ponto do loop, sobre um dataset real e pequeno, e verifica que as duas respostas calculadas de forma independente, a fechada e a iterativa, concordam entre si. Esse é o ponto real: prova de convergência e convergência de fato observada são coisas diferentes, e é neste lab que a segunda é checada.
---
## Objetivos de Aprendizagem

- Implementar em NumPy a solução em forma fechada (equação normal) da regressão linear por mínimos quadrados.
- Implementar gradiente descendente em lote para o mesmo problema, usando apenas a função de loss e seu gradiente, sem nenhum atalho de forma fechada.
- Verificar que o gradiente descendente converge para os mesmos parâmetros que a solução em forma fechada calcula diretamente, em um dataset real e pequeno.
- Explicar por que essa concordância, e não apenas uma curva de loss decrescente, é a verdadeira checagem de correção de que este lab depende.

## Contexto e Motivação

**Regressão Linear como Mínimos Quadrados** e **Gradiente Descendente como Otimizador Geral** já provam, no papel, dois fatos reais e independentes: que minimizar o erro quadrático médio sobre um modelo linear tem uma solução exata em forma fechada (a equação normal), e que o gradiente descendente, rodando sobre essa mesma função de loss, converge para um mínimo por meio de passos puramente iterativos e locais. Este lab é onde essas duas respostas, obtidas de forma independente, são calculadas de verdade e checadas uma contra a outra; é o primeiro lab do arco de construção do kit de ferramentas desta disciplina, usando apenas NumPy, sem scikit-learn em nenhum ponto da implementação.

## Teoria Central

Nada sobre *por que* a equação normal resolve exatamente os mínimos quadrados, ou *por que* o gradiente descendente converge com a taxa de aprendizado certa, é derivado de novo aqui; os dois argumentos já existem em `linear-regression-as-least-squares` e `gradient-descent-as-a-general-optimizer`. Este lab implementa os dois cálculos diretamente e trata a concordância entre eles como o verdadeiro teste de correção, e não a derivação de cada um isoladamente.

## Exemplos Resolvidos

### Especificação da API

```text
closed_form_fit(X: ndarray, y: ndarray) -> ndarray        # retorna os pesos
gradient_descent_fit(X, y, lr: float, iters: int) -> ndarray  # retorna os pesos
mse_loss(X, y, w) -> float
```

### Passo 1: a solução em forma fechada

```python
def closed_form_fit(X, y):
    # X: (n_samples, n_features), já com uma coluna de 1s no início
    # para o termo de bias. A equação normal: w = (X^T X)^-1 X^T y
    return np.linalg.inv(X.T @ X) @ X.T @ y
```

### Passo 2: gradiente descendente, usando SOMENTE o loss e seu gradiente

```python
def mse_loss(X, y, w):
    predictions = X @ w
    return np.mean((predictions - y) ** 2)

def mse_gradient(X, y, w):
    predictions = X @ w
    n = X.shape[0]
    return (2 / n) * X.T @ (predictions - y)

def gradient_descent_fit(X, y, lr=0.01, iters=1000):
    w = np.zeros(X.shape[1])
    loss_history = []
    for _ in range(iters):
        w = w - lr * mse_gradient(X, y, w)
        loss_history.append(mse_loss(X, y, w))
    return w, loss_history
```

Nada em `gradient_descent_fit` usa a inversa de matriz do Passo 1; a função chega à resposta apenas empurrando `w` repetidamente no sentido oposto ao gradiente, e é exatamente isso que torna a concordância entre as saídas finais das duas funções uma checagem real e independente, e não circular.

### Passo 3: a verdadeira checagem de correção, as duas respostas independentes concordam?

```python
def test_gradient_descent_converges_to_closed_form():
    X, y = load_small_real_dataset()  # ex.: um dataset de preços de imóveis,
                                        # poucas features, valores reais
    X = add_bias_column(X)
    w_closed = closed_form_fit(X, y)
    w_gd, loss_history = gradient_descent_fit(X, y, lr=0.05, iters=5000)

    assert np.allclose(w_closed, w_gd, atol=1e-2), \
        f"o gradiente descendente {w_gd} deve convergir para perto da forma fechada {w_closed}"
    assert loss_history[-1] < loss_history[0], "o loss deve ter diminuído no geral"
    assert all(loss_history[i] >= loss_history[i+1] - 1e-9 for i in range(len(loss_history)-1)), \
        "com esta taxa de aprendizado, o loss deve diminuir monotonicamente, sem oscilar"
```

### Passo 4: diagnosticando uma taxa de aprendizado grande demais

```python
def test_too_large_learning_rate_diverges():
    X, y = load_small_real_dataset()
    X = add_bias_column(X)
    w_gd, loss_history = gradient_descent_fit(X, y, lr=5.0, iters=50)  # grande demais de propósito
    assert loss_history[-1] > loss_history[0], \
        "uma taxa de aprendizado excessiva deve PIORAR o loss, não melhorar, demonstrando o overshoot"
```

## Equívocos Comuns e Armadilhas

- **"Uma curva de loss caindo de forma constante é evidência suficiente de que o gradiente descendente foi implementado corretamente."** Uma curva de loss pode cair e ainda assim convergir para o ponto errado, ou convergir muito devagar para um ponto longe do verdadeiro mínimo, se o próprio cálculo do gradiente tiver um bug sutil; a comparação direta do Passo 3 contra a resposta em forma fechada, calculada de forma independente, é uma checagem muito mais forte que o formato da curva de loss sozinho.
- **"A taxa de aprendizado é um detalhe menor de ajuste, não algo que valha a pena testar diretamente."** O Passo 4 demonstra diretamente que uma taxa de aprendizado grande demais não apenas converge devagar: ela pode fazer o loss aumentar, passando do mínimo a cada passo. Esse modo de falha é real e comum o bastante para que testá-lo explicitamente, em vez de testar só o caso bem ajustado, valha o tempo do lab.
- **"Como a solução em forma fechada é exata e rápida, o gradiente descendente aqui é só um jeito mais lento e pior de resolver o mesmo problema."** Para regressão linear especificamente, essa é uma observação prática justa, mas o objetivo de implementar o gradiente descendente aqui é que ele se generaliza para problemas em que o Lab 2 e o Lab 3 precisam dele, regressão logística e redes neurais, que não têm solução em forma fechada nenhuma; este lab é onde a correção dele é verificada enquanto ainda existe uma resposta em forma fechada para comparar.

## Resumo

Este lab implementa, em NumPy puro, tanto a solução em forma fechada pela equação normal quanto o gradiente descendente iterativo para regressão linear por mínimos quadrados, e trata a concordância entre os dois, e não a derivação teórica de cada método isoladamente, como a verdadeira checagem de correção: o processo puramente local e iterativo do gradiente descendente convergir para os mesmos parâmetros que a solução em forma fechada calcula diretamente confirma que as duas implementações estão de fato corretas, e não apenas plausíveis. Essa implementação de gradiente descendente, e a disciplina de checá-la contra uma resposta independente, é reaproveitada sem mudanças no Lab 2 e estendida no Lab 3, onde não haverá nenhuma comparação em forma fechada disponível.

## Documentation Links

- [Stanford CS229: Lecture Notes, Part I: Linear Regression](https://cs229.stanford.edu/main_notes.pdf): a fonte direta tanto da equação normal quanto da derivação do gradiente descendente que este lab implementa e compara.
- [James, Witten, Hastie & Tibshirani: An Introduction to Statistical Learning](https://www.statlearning.com/): um livro-texto amplamente usado que cobre a mesma teoria de regressão por mínimos quadrados sobre a qual a implementação deste lab é construída.
