---
version: 1.0
updatedAt: 2026-09-12
title: "Lab: Trabalho com Datasets, Splits, Vazamento e Avaliação Honesta"
summary: Splits de Treino, Teste e Validação já estabelece por que um modelo só pode ser avaliado com honestidade em dados que ele nunca tocou durante o treino; este lab torna essa disciplina concreta e, de propósito, torna concreta também a sua violação. Primeiro um split correto, depois uma segunda versão intencionalmente quebrada que vaza informação do conjunto de teste para o treino (por meio de um passo de pré-processamento, como uma normalização de features ajustada no dataset inteiro antes do split), medindo diretamente quanto esse vazamento infla a acurácia relatada, exatamente a diferença entre avaliação honesta e desonesta que a disciplina k-fold de Validação Cruzada existe para fechar.
---
## Objetivos de Aprendizagem

- Implementar um split correto de treino/validação/teste, garantindo que o conjunto de teste nunca seja tocado até a avaliação final.
- Implementar uma versão deliberadamente quebrada que vaza informação do conjunto de teste para o pré-processamento (um passo de normalização ajustado no dataset inteiro antes do split) e medir quanto esse vazamento infla a acurácia relatada.
- Implementar validação cruzada k-fold e explicar que problema ela resolve que um único split de validação não resolve.
- Conectar o efeito de vazamento medido diretamente à hipótese do Lab 5: o resultado avaliado com honestidade ainda a sustenta ou a refuta, depois que o vazamento é removido?

## Contexto e Motivação

`forming-a-falsifiable-hypothesis-on-a-real-dataset` produziu uma afirmação precisa e falseável, mas essa afirmação só pode ser testada com honestidade se a própria avaliação for honesta. **Splits de Treino, Teste e Validação** já estabelece por que um modelo só pode ser avaliado de forma justa em dados que ele nunca tocou durante o treino; este lab torna essa disciplina concreta e, de propósito, torna concreta também a sua violação, implementando um split correto e um quebrado e medindo a diferença numérica real entre eles.

## Teoria Central

Nada sobre *por que* avaliar em dados de treino superestima o desempenho real é derivado de novo aqui; esse argumento já existe em `training-test-and-validation-splits`. Este lab implementa o split correto, um bug de vazamento específico, comum e fácil de não perceber, e a disciplina k-fold de `cross-validation`, tratando a diferença de acurácia medida entre a versão correta e a quebrada como o resultado central e real deste lab.

## Exemplos Resolvidos

### Passo 1: um split correto, com o conjunto de teste trancado até o fim

```python
def correct_split(X, y, test_size=0.2, val_size=0.2, seed=0):
    rng = np.random.default_rng(seed)
    n = len(X)
    indices = rng.permutation(n)
    test_end = int(n * test_size)
    val_end = test_end + int(n * val_size)

    test_idx, val_idx, train_idx = indices[:test_end], indices[test_end:val_end], indices[val_end:]
    return (X[train_idx], y[train_idx]), (X[val_idx], y[val_idx]), (X[test_idx], y[test_idx])
    # test_idx é retornado, mas NÃO PODE ser tocado de novo até a
    # avaliação final, feita uma única vez, no Lab 8
```

### Passo 2: a versão quebrada de propósito, com normalização ajustada no dataset INTEIRO

```python
def broken_split_with_leakage(X, y, test_size=0.2, val_size=0.2, seed=0):
    # O BUG: ajustar a média/desvio padrão do normalizador em TODO o X,
    # incluindo o que vai virar o conjunto de teste, ANTES do split; um
    # erro real e comum, porque parece inofensivo: "só normalizando os dados."
    mean, std = X.mean(axis=0), X.std(axis=0)
    X_normalized = (X - mean) / std

    return correct_split(X_normalized, y, test_size, val_size, seed)  # o split
                                                                          # acontece
                                                                          # DEPOIS
                                                                          # do vazamento
```

O bug está especificamente em calcular `mean` e `std` sobre o dataset inteiro, o que deixa informação sobre a própria distribuição do conjunto de teste (sua média e sua dispersão) vazar para as features normalizadas de cada exemplo de treino, antes mesmo de acontecer o split que deveria manter o conjunto de teste invisível.

### Passo 3: medindo o tamanho real do vazamento

```python
def test_leakage_inflates_reported_accuracy():
    X, y = load_real_dataset()

    # Versão correta: normaliza usando SOMENTE estatísticas do conjunto de
    # treino, aplicadas depois à validação/teste
    (X_train, y_train), (X_val, y_val), (X_test, y_test) = correct_split(X, y)
    train_mean, train_std = X_train.mean(axis=0), X_train.std(axis=0)
    X_train_norm = (X_train - train_mean) / train_std
    X_test_norm = (X_test - train_mean) / train_std  # MESMAS estatísticas do treino
    model_correct = logistic_fit(add_bias_column(X_train_norm), y_train)
    acc_correct = accuracy(model_correct, add_bias_column(X_test_norm), y_test)

    # Versão quebrada: normaliza antes de qualquer split
    (X_train_b, y_train_b), (X_val_b, y_val_b), (X_test_b, y_test_b) = broken_split_with_leakage(X, y)
    model_broken = logistic_fit(add_bias_column(X_train_b), y_train_b)
    acc_broken = accuracy(model_broken, add_bias_column(X_test_b), y_test_b)

    print(f"Correta (sem vazamento): {acc_correct:.3f}")
    print(f"Quebrada (com vazamento): {acc_broken:.3f}")
    # Em um dataset real, acc_broken normalmente é maior; essa diferença É
    # o custo real e medido do vazamento, não um custo hipotético
```

### Passo 4: validação cruzada k-fold, um problema diferente do vazamento acima

```python
def k_fold_cross_validate(X, y, k=5, seed=0):
    rng = np.random.default_rng(seed)
    indices = rng.permutation(len(X))
    folds = np.array_split(indices, k)
    scores = []

    for i in range(k):
        val_idx = folds[i]
        train_idx = np.concatenate([folds[j] for j in range(k) if j != i])
        model = logistic_fit(add_bias_column(X[train_idx]), y[train_idx])
        scores.append(accuracy(model, add_bias_column(X[val_idx]), y[val_idx]))

    return np.mean(scores), np.std(scores)  # também relata a variabilidade entre os folds
```

A validação cruzada resolve um problema diferente do bug de vazamento acima: mesmo com um único split correto e sem vazamento, a estimativa de desempenho de um único conjunto de validação pode variar muito só por causa de quais exemplos específicos calharam de cair nele, especialmente em um dataset pequeno. O k-fold tira a média dessa estimativa sobre vários splits diferentes, e o desvio padrão relatado é em si uma informação real e útil sobre quão estável a estimativa realmente é, a mesma disciplina de relatar variabilidade que `aggregation-variability-and-reporting`, de `graduate-studies/research-statistics`, já cobre.

## Equívocos Comuns e Armadilhas

- **"Normalizar o dataset inteiro antes do split é uma conveniência de pré-processamento inofensiva."** A comparação medida no Passo 3 mostra diretamente o contrário: calcular estatísticas de normalização sobre dados que incluem o conjunto de teste deixa informação real sobre o teste vazar para o treino, inflando a acurácia relatada de um jeito que não vai se sustentar quando o modelo for de fato colocado em produção com dados genuinamente inéditos.
- **"Um único split correto de treino/teste é suficiente; validação cruzada é só rigor extra para um número um pouco melhor."** A validação cruzada trata de um problema genuinamente diferente, a instabilidade da estimativa de um único split em um dataset pequeno, e não do bug de vazamento em torno do qual os Passos 1 a 3 foram construídos; os dois importam, por razões diferentes, e confundi-los faz perder de vista contra o que cada um de fato protege.
- **"Depois que o vazamento é identificado e corrigido, a hipótese original pode ser reavaliada simplesmente rodando de novo os números da versão quebrada com o código corrigido."** A comparação honesta e correta é exatamente a que o Passo 3 já rodou; a hipótese de `forming-a-falsifiable-hypothesis-on-a-real-dataset` precisa ser checada contra `acc_correct`, não contra `acc_broken`, e se a inflação causada pelo vazamento foi grande o bastante para virar a hipótese de sustentada para refutada, esse é um achado real e importante que a medição deste lab trouxe à tona, não algo a esconder.

## Resumo

Este lab torna concreto, de duas formas, o alerta teórico de `training-test-and-validation-splits` contra avaliar em dados já vistos: implementando um split correto em que o conjunto de teste fica genuinamente trancado até a avaliação final, e implementando um bug de vazamento específico e realista, estatísticas de normalização calculadas antes do split, para depois medir diretamente quanto esse vazamento infla a acurácia relatada em um dataset real. A disciplina k-fold de `cross-validation` trata de uma preocupação diferente e complementar, a instabilidade da estimativa de um único split de validação, e a hipótese original do Lab 5 precisa ser checada contra o resultado avaliado com honestidade neste lab, não contra o resultado com vazamento, uma consequência real, que às vezes muda a hipótese, que a medição deste lab torna visível.

## Documentation Links

- [James, Witten, Hastie & Tibshirani: An Introduction to Statistical Learning](https://www.statlearning.com/): a fonte direta da disciplina de split, vazamento e validação cruzada que este lab implementa e mede.
- [Caltech CS 156: Learning From Data, Lecture 13: Validation](https://work.caltech.edu/telecourse.html): um segundo curso real e independente cobrindo o mesmo material de validação e avaliação honesta em que este lab se baseia.
