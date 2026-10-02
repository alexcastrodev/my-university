---
version: 1.0
updatedAt: 2026-09-12
title: "Lab: Uma Pequena Rede Neural e Backpropagation, do Zero"
summary: A regressão logística do Lab 2 é, no sentido exato descrito em Redes Multicamadas como Transformações Lineares Compostas, uma rede neural com zero camadas ocultas; este lab acrescenta uma camada oculta e implementa à mão o cálculo de gradiente por regra da cadeia do backpropagation, camada por camada, e depois verifica cada gradiente derivado à mão contra a verificação numérica de gradiente (uma pequena perturbação por diferenças finitas em cada peso), que é a forma padrão e real de confirmar na prática a correção descrita em Backpropagation, em vez de apenas confiar na derivação.
---
## Objetivos de Aprendizagem

- Implementar a propagação direta (forward) em uma rede pequena com uma camada oculta, estendendo a regressão logística do Lab 2 em exatamente uma camada.
- Implementar à mão o cálculo de gradiente por regra da cadeia do backpropagation, camada por camada, para todo peso da rede.
- Implementar a verificação numérica de gradiente (aproximação por diferenças finitas) e usá-la para verificar de forma independente cada gradiente analítico derivado à mão.
- Explicar por que a verificação de gradiente, e não uma curva de loss decrescente, é a forma padrão e real de confirmar que uma implementação de backpropagation está correta.

## Contexto e Motivação

**Redes Multicamadas como Transformações Lineares Compostas** já descreve com precisão o próprio modelo de `logistic-regression-and-a-decision-boundary-from-scratch`: uma rede neural com zero camadas ocultas. Este lab acrescenta uma camada oculta e implementa à mão o cálculo de gradiente de **Backpropagation: A Regra da Cadeia Através de um Grafo Computacional**, e depois o verifica do mesmo jeito que as suítes de teste dos frameworks reais de deep learning verificam novas implementações de camadas: numericamente, e não apenas inspecionando a derivação.

## Teoria Central

Nada sobre *por que* a regra da cadeia se compõe corretamente através de um grafo computacional, ou *por que* o gradiente local de cada camada se multiplica pelo gradiente que volta da camada seguinte, é derivado de novo aqui; os dois argumentos já existem em `backpropagation-the-chain-rule-through-a-computational-graph`. Este lab implementa esse cálculo diretamente, para uma rede pequena e concreta de duas camadas, e trata a verificação de gradiente como o verdadeiro teste de correção.

## Exemplos Resolvidos

### Especificação da API

```text
forward(X, W1, b1, W2, b2) -> (hidden, output)
backward(X, y, W1, b1, W2, b2, hidden, output) -> (dW1, db1, dW2, db2)
numerical_gradient(loss_fn, param, epsilon=1e-5) -> ndarray  # SOMENTE para verificação
```

### Passo 1: propagação direta, uma camada oculta

```python
def forward(X, W1, b1, W2, b2):
    z1 = X @ W1 + b1
    hidden = np.tanh(z1)                # ativação da camada oculta
    z2 = hidden @ W2 + b2
    output = sigmoid(z2)                # reaproveitando a sigmoid do Lab 2
    return hidden, output
```

### Passo 2: backpropagation, a regra da cadeia aplicada camada por camada

```python
def backward(X, y, W1, b1, W2, b2, hidden, output):
    n = X.shape[0]

    # Camada de saída: dL/d(z2) para cross-entropy + sigmoid se simplifica em
    # (output - y), a MESMA forma algébrica que o gradiente do Lab 2 já usava
    d_z2 = (output - y.reshape(-1, 1)) / n
    dW2 = hidden.T @ d_z2
    db2 = np.sum(d_z2, axis=0, keepdims=True)

    # Regra da cadeia PARA DENTRO da camada oculta: o gradiente volta por
    # W2 e depois pela derivada local da tanh (1 - tanh(z1)^2)
    d_hidden = d_z2 @ W2.T
    d_z1 = d_hidden * (1 - hidden ** 2)  # tanh'(z1) = 1 - tanh(z1)^2
    dW1 = X.T @ d_z1
    db1 = np.sum(d_z1, axis=0, keepdims=True)

    return dW1, db1, dW2, db2
```

### Passo 3: verificação numérica de gradiente, o VERDADEIRO teste de correção

```python
def numerical_gradient(loss_fn, param, epsilon=1e-5):
    # Para cada entrada de `param`, perturbe-a em +epsilon e -epsilon,
    # recalcule o loss nas duas vezes e aproxime a derivada como a
    # inclinação entre os dois valores; isso usa SOMENTE o forward pass,
    # nunca a função analítica backward() que está sendo verificada.
    grad = np.zeros_like(param)
    it = np.nditer(param, flags=['multi_index'])
    while not it.finished:
        idx = it.multi_index
        original = param[idx]
        param[idx] = original + epsilon
        loss_plus = loss_fn()
        param[idx] = original - epsilon
        loss_minus = loss_fn()
        param[idx] = original  # restaura
        grad[idx] = (loss_plus - loss_minus) / (2 * epsilon)
        it.iternext()
    return grad

def test_backprop_matches_numerical_gradient():
    X, y = generate_small_dataset(n=20, seed=0)
    W1, b1, W2, b2 = init_small_network(n_features=X.shape[1], n_hidden=4)

    hidden, output = forward(X, W1, b1, W2, b2)
    dW1_analytic, db1_analytic, dW2_analytic, db2_analytic = backward(X, y, W1, b1, W2, b2, hidden, output)

    def loss_fn():
        h, o = forward(X, W1, b1, W2, b2)
        return cross_entropy_loss_from_output(o, y)

    dW1_numeric = numerical_gradient(loss_fn, W1)
    assert np.allclose(dW1_analytic, dW1_numeric, atol=1e-4), \
        "o gradiente de backprop derivado à mão para W1 deve bater com o gradiente numérico calculado de forma independente"
```

Este é o teste que realmente importa neste lab: `numerical_gradient` nunca chama `backward()`, ele só chama `forward()` repetidamente com perturbações minúsculas, e é exatamente isso que o torna uma verificação independente da derivação por regra da cadeia de `backward()`. É a mesma técnica que as suítes de teste dos frameworks reais de deep learning usam para verificar novas implementações de camadas antes de confiar nelas.

### Passo 4: um bug introduzido de propósito, e a verificação de gradiente pegando-o

```python
def buggy_backward(X, y, W1, b1, W2, b2, hidden, output):
    dW1, db1, dW2, db2 = backward(X, y, W1, b1, W2, b2, hidden, output)
    dW1 = dW1 * 2  # um bug sutil e proposital: um fator 2 extra e incorreto
    return dW1, db1, dW2, db2

def test_gradient_check_catches_the_bug():
    X, y = generate_small_dataset(n=20, seed=0)
    W1, b1, W2, b2 = init_small_network(n_features=X.shape[1], n_hidden=4)
    hidden, output = forward(X, W1, b1, W2, b2)
    dW1_buggy, *_ = buggy_backward(X, y, W1, b1, W2, b2, hidden, output)
    dW1_numeric = numerical_gradient(lambda: cross_entropy_loss_from_output(forward(X, W1, b1, W2, b2)[1], y), W1)
    assert not np.allclose(dW1_buggy, dW1_numeric, atol=1e-4), \
        "a verificação de gradiente deve SINALIZAR este bug de fator 2 introduzido de propósito"
```

## Equívocos Comuns e Armadilhas

- **"Se o loss de treino diminui, a implementação de backpropagation deve estar correta."** Um gradiente sutilmente errado (fora por um fator constante, faltando um termo) ainda pode apontar mais ou menos na direção certa com frequência suficiente para o loss diminuir no geral, principalmente com uma taxa de aprendizado bem escolhida compensando o erro. O bug introduzido de propósito no Passo 4 é justamente o tipo de erro que uma curva de loss sozinha muito provavelmente deixaria passar, enquanto a verificação de gradiente o pega diretamente.
- **"A verificação de gradiente e o backward pass analítico estão calculando a mesma coisa do mesmo jeito, então compará-los é redundante."** Eles calculam o gradiente por métodos genuinamente independentes, um pela regra da cadeia aplicada algebricamente, o outro pela perturbação numérica direta apenas do forward pass, e é exatamente isso que torna a concordância (ou discordância) entre eles significativa em vez de circular.
- **"A verificação de gradiente é precisa o bastante para ser usada como o próprio método de treino, não só como checagem de correção."** Ela exige dois forward passes por parâmetro verificado, o que é caro demais computacionalmente para treinar uma rede real com muitos parâmetros; ela é usada especificamente como uma checagem de correção única (ou ocasional) do gradiente analítico, muito mais barato, e não como substituto dele durante o treino.

## Resumo

Este lab estende o modelo sem camadas ocultas de `logistic-regression-and-a-decision-boundary-from-scratch` em exatamente uma camada, implementa à mão, para cada camada, o cálculo de gradiente por regra da cadeia de `backpropagation-the-chain-rule-through-a-computational-graph` e verifica cada gradiente analítico contra um gradiente numérico calculado de forma independente, a técnica padrão e real para confirmar que uma implementação de backpropagation está correta. Introduzir de propósito um bug sutil, um fator 2 extra em um gradiente, e confirmar que a verificação de gradiente realmente o sinaliza mostra por que essa checagem importa: uma curva de loss decrescente sozinha muito plausivelmente teria deixado passar exatamente esse tipo de erro.

## Documentation Links

- [CS231n: Backpropagation, Intuitions](https://cs231n.github.io/optimization-2/): a fonte direta da derivação de backpropagation por regra da cadeia que este lab implementa à mão.
- [Dive into Deep Learning: Forward Propagation, Backward Propagation, and Computational Graphs](https://d2l.ai/chapter_multilayer-perceptrons/backprop.html): uma segunda fonte real e independente cobrindo o mesmo cálculo forward/backward e sua verificação.
