---
version: 1.0
updatedAt: 2026-09-12
title: "Lab: Seleção de Modelo e o Trade-off Viés-Variância, Medidos"
summary: O Trade-off Viés-Variância e Overfitting e a Dimensão VC já preveem, na teoria, uma curva de erro de validação em forma de U à medida que a complexidade do modelo aumenta, com underfitting de um lado e overfitting do outro; este lab varre a complexidade do modelo diretamente (grau do polinômio para o regressor do Lab 1, largura da camada oculta para a pequena rede do Lab 3), plota o erro de treino contra o erro de validação retido ao longo dessa varredura e mede o ponto exato em que a curva vira. Depois aplica o termo de penalidade de Regularização: Ridge e Lasso e confirma, empiricamente, que ele desloca esse ponto de virada, em vez de apenas afirmar isso.
---
## Objetivos de Aprendizagem

- Varrer a complexidade do modelo (grau do polinômio para o regressor do Lab 1, largura da camada oculta para a rede do Lab 3) e plotar o erro de treino contra o erro de validação retido ao longo da varredura.
- Localizar o ponto em que o erro de validação para de melhorar e começa a piorar, e conectá-lo à fronteira entre underfitting e overfitting que O Trade-off Viés-Variância e Overfitting e a Dimensão VC descrevem.
- Aplicar regularização Ridge e confirmar, empiricamente, que ela desloca esse ponto de virada, em vez de apenas afirmar isso.
- Selecionar uma complexidade de modelo e uma força de regularização finais usando apenas o conjunto de validação, respeitando a disciplina de `dataset-work-splits-leakage-and-honest-evaluation`.

## Contexto e Motivação

`dataset-work-splits-leakage-and-honest-evaluation` estabeleceu um split correto e sem vazamento de treino/validação/teste. Este lab usa esse split para fazer aquilo que ele existe para tornar honestamente possível: escolher a complexidade de um modelo. **O Trade-off Viés-Variância** e **Overfitting e a Dimensão VC** já preveem, na teoria, uma curva de erro de validação em forma de U à medida que a complexidade aumenta, com underfitting (viés alto) de um lado e overfitting (variância alta) do outro; este lab produz essa curva de verdade, a partir das implementações do Lab 1 e do Lab 3, e mede exatamente onde ela vira.

## Teoria Central

Nada sobre *por que* aumentar a complexidade do modelo troca viés por variância, ou *por que* esse trade-off produz uma curva de validação em forma de U, é derivado de novo aqui; os dois argumentos já existem em `the-bias-variance-tradeoff` e `overfitting-and-the-vc-dimension`. Este lab implementa a varredura que de fato produz a curva e aplica o termo de penalidade de `regularization-ridge-and-lasso` para confirmar diretamente o efeito previsto dele sobre essa curva.

## Exemplos Resolvidos

### Passo 1: varrendo o grau do polinômio para o regressor do Lab 1

```python
def polynomial_features(X, degree):
    return np.hstack([X ** d for d in range(1, degree + 1)])

def sweep_polynomial_complexity(X_train, y_train, X_val, y_val, max_degree=10):
    train_errors, val_errors = [], []
    for degree in range(1, max_degree + 1):
        X_train_poly = add_bias_column(polynomial_features(X_train, degree))
        X_val_poly = add_bias_column(polynomial_features(X_val, degree))
        w = closed_form_fit(X_train_poly, y_train)  # o solver do Lab 1, reaproveitado
        train_errors.append(mse_loss(X_train_poly, y_train, w))
        val_errors.append(mse_loss(X_val_poly, y_val, w))
    return train_errors, val_errors
```

### Passo 2: localizando o ponto de virada diretamente, não só plotando

```python
def test_validation_curve_is_u_shaped():
    X_train, y_train, X_val, y_val = load_split_from_lab6()
    train_errors, val_errors = sweep_polynomial_complexity(X_train, y_train, X_val, y_val)

    # O erro de treino deve diminuir (ou ficar estável) monotonicamente:
    # mais complexidade SEMPRE consegue ajustar o treino pelo menos tão bem
    for i in range(len(train_errors) - 1):
        assert train_errors[i + 1] <= train_errors[i] + 1e-9

    # O erro de validação NÃO deve ser monotonicamente decrescente: ele
    # deve ter um mínimo real em algum ponto do meio, e não na maior
    # complexidade testada
    best_degree = np.argmin(val_errors) + 1
    assert best_degree < len(val_errors), \
        "o melhor erro de validação deve ocorrer antes da complexidade máxima testada, confirmando que o overfitting aparece"
```

### Passo 3: regularização Ridge, e a confirmação de que ela desloca a curva

```python
def ridge_fit(X, y, lam):
    n_features = X.shape[1]
    identity = np.eye(n_features)
    identity[0, 0] = 0  # não regulariza o termo de bias
    return np.linalg.inv(X.T @ X + lam * identity) @ X.T @ y

def test_regularization_reduces_overfitting_at_high_complexity():
    X_train, y_train, X_val, y_val = load_split_from_lab6()
    high_degree = 10  # escolhido de propósito bem além do ótimo sem regularização

    X_train_poly = add_bias_column(polynomial_features(X_train, high_degree))
    X_val_poly = add_bias_column(polynomial_features(X_val, high_degree))

    w_unregularized = closed_form_fit(X_train_poly, y_train)
    val_error_unregularized = mse_loss(X_val_poly, y_val, w_unregularized)

    w_regularized = ridge_fit(X_train_poly, y_train, lam=1.0)
    val_error_regularized = mse_loss(X_val_poly, y_val, w_regularized)

    assert val_error_regularized < val_error_unregularized, \
        "nesta complexidade alta escolhida de propósito, a regularização Ridge deve reduzir de forma mensurável o erro de validação"
```

### Passo 4: a mesma varredura, para a rede neural do Lab 3 (largura da camada oculta)

```python
def sweep_network_width(X_train, y_train, X_val, y_val, widths=(1, 2, 4, 8, 16, 32, 64)):
    train_errors, val_errors = [], []
    for width in widths:
        W1, b1, W2, b2 = init_small_network(n_features=X_train.shape[1], n_hidden=width)
        # treina por um número fixo de iterações usando a implementação
        # forward/backward do Lab 3 (omitida aqui por brevidade)
        train_errors.append(final_train_loss)
        val_errors.append(final_val_loss)
    return list(widths), train_errors, val_errors
```

Rodar a mesma metodologia de varrer e plotar contra uma classe de modelo genuinamente diferente, a regressão polinomial do Lab 1 e a rede neural do Lab 3, e observar o mesmo formato qualitativo de U nas duas é em si uma confirmação real e independente de que a afirmação de `the-bias-variance-tradeoff` é sobre complexidade de modelo em geral, e não um artefato específico de um algoritmo em particular.

### Passo 5: selecionando um modelo final, usando SOMENTE o erro de validação

```python
def select_final_model(train_errors, val_errors, complexities):
    best_idx = np.argmin(val_errors)
    return complexities[best_idx]
    # NOTA: esta seleção usa exclusivamente val_errors; o conjunto de teste
    # de dataset-work-splits-leakage-and-honest-evaluation não é tocado
    # em nenhum ponto desta função, e não será tocado até a checagem
    # final, feita uma única vez, de running-and-reporting-a-real-experiment
```

## Equívocos Comuns e Armadilhas

- **"O melhor modelo é o que atinge o menor erro de treino."** O próprio teste do Passo 2 confirma que o erro de treino diminui, ou fica estável, monotonicamente conforme a complexidade aumenta, essencialmente por construção: mais complexidade sempre consegue ajustar os dados de treino pelo menos tão bem. É o formato de U do erro de validação, e não o erro de treino, que revela onde a generalização de fato para de melhorar.
- **"Regularização sempre ajuda, então deve ser aplicada na força máxima."** O teste do Passo 3 aplica Ridge, de propósito, só em um nível de complexidade que já passou do ótimo sem regularização, onde o overfitting é um problema real e medido; regularização forte demais aplicada em um nível de complexidade que nem estava em overfitting empurraria o modelo para o underfitting, o OUTRO lado da mesma curva em U.
- **"Selecionar a complexidade final do modelo pode usar o desempenho no conjunto de teste, já que é só mais uma avaliação."** Esse é exatamente o vazamento contra o qual `dataset-work-splits-leakage-and-honest-evaluation` alerta, aplicado na etapa de seleção de modelo em vez da etapa de pré-processamento; a função de seleção do Passo 5 usa apenas o erro de validação justamente para que o conjunto de teste continue genuinamente inédito até a avaliação final, feita uma única vez, do Lab 8.

## Resumo

Este lab varre a complexidade do modelo (grau do polinômio para o regressor do Lab 1 e largura da camada oculta para a rede do Lab 3) e plota a curva de erro de validação em forma de U que `the-bias-variance-tradeoff` e `overfitting-and-the-vc-dimension` preveem na teoria, localizando o ponto de virada real em que o overfitting começa, em vez de apenas descrevê-lo. Aplicar a penalidade Ridge de `regularization-ridge-and-lasso` em um nível de complexidade alto escolhido de propósito e confirmar que ela reduz de forma mensurável o erro de validação, além de selecionar a complexidade final do modelo usando só o conjunto de validação, nunca o de teste, respeita tanto a teoria de viés-variância quanto a disciplina de avaliação honesta que todo este arco de labs vem construindo.

## Documentation Links

- [Caltech CS 156: Learning From Data, Lecture 8: Bias-Variance Tradeoff](https://work.caltech.edu/telecourse.html): a fonte direta da decomposição viés-variância que a varredura de complexidade deste lab foi construída para reproduzir empiricamente.
- [James, Witten, Hastie & Tibshirani: An Introduction to Statistical Learning](https://www.statlearning.com/): a fonte da regularização Ridge que este lab aplica e mede diretamente contra o caso sem regularização.
