---
version: 1.0
updatedAt: 2026-09-06
title: Regressão Logística e Fronteiras de Decisão
summary: Adaptar a maquinaria de modelo linear mais gradient descent recém-construída a uma tarefa fundamentalmente diferente (prever uma categoria, e não um número), espremendo um escore linear por uma sigmoide e traçando a fronteira onde ela cruza um meio.
---
## Objetivos de Aprendizagem

- Explicar por que a perda de erro quadrático da regressão linear se ajusta mal a um alvo de classificação binária e como a regressão logística adapta o modelo linear para corrigir isso.
- Enunciar a função sigmoide e explicar como ela transforma um escore linear `θᵀx` numa probabilidade válida entre 0 e 1.
- Derivar a perda da regressão logística (log loss / entropia cruzada) a partir da máxima verossimilhança e explicar por que ela, ao contrário do erro quadrático, é convexa para este modelo.
- Definir a fronteira de decisão e calculá-la à mão num pequeno exemplo resolvido.

## Contexto e Motivação

Os dois conceitos anteriores ajustaram a regressão linear, primeiro como um problema direto de mínimos quadrados e depois como um argumento de máxima verossimilhança supondo ruído gaussiano. Este conceito enfrenta um tipo diferente de alvo: não um número, mas uma categoria. Um cliente cancela ou não; um e-mail é spam ou não. Aplicar a regressão linear diretamente a um alvo 0/1 é um erro real e comum: o modelo pode prever valores abaixo de 0 ou acima de 1, que não têm interpretação sensata como probabilidade, e o erro quadrático penaliza uma previsão correta e confiante (digamos, prever 0.99 para um rótulo verdadeiro 1) quase tanto quanto uma inútil.

A regressão logística mantém o mesmo escore linear `θᵀx` da regressão linear (reaproveitando exatamente a maquinaria recém-construída, incluindo o gradient descent do conceito anterior), mas passa esse escore por uma função nova, a sigmoide, projetada especificamente para espremer qualquer número real numa probabilidade válida.

## Teoria Central

### A função sigmoide

A função **sigmoide** (ou logística) é:

```text
σ(z) = 1 / (1 + e^(−z))
```

Ela tem três propriedades que importam aqui: `σ(z) → 0` quando `z → −∞`, `σ(z) → 1` quando `z → +∞` e `σ(0) = 0.5`. A regressão logística prevê `P(y=1 | x) = σ(θᵀx)`: o mesmo escore linear `θᵀx` da regressão linear, agora interpretado como uma probabilidade por meio da sigmoide, em vez de uma previsão numérica direta.

### A fronteira de decisão

Uma previsão é classificada como `1` quando `P(y=1|x) ≥ 0.5`, o que (como `σ(0) = 0.5` e `σ` é estritamente crescente) acontece exatamente quando `θᵀx ≥ 0`. O conjunto de pontos em que `θᵀx = 0` é a **fronteira de decisão**: um hiperplano no espaço de features (uma reta em 2D, um plano em 3D) que separa a região prevista como classe 1 da região prevista como classe 0. Como essa fronteira é definida por uma equação linear em `x`, a regressão logística é um **classificador linear**: sua fronteira de decisão é sempre uma reta (ou hiperplano), mesmo que a *probabilidade* que ela produz varie de forma suave, e não como uma função degrau.

### O objetivo de log loss, a partir da máxima verossimilhança

Seguindo o mesmo padrão de máxima verossimilhança usado na regressão linear, suponha que cada rótulo `y⁽ⁱ⁾ ∈ {0, 1}` seja sorteado de uma distribuição de Bernoulli (a mesma distribuição já vista em `foundations/probability-statistics`) com probabilidade de sucesso `σ(θᵀx⁽ⁱ⁾)`. A verossimilhança dos dados de treino é:

```text
L(θ) = Πᵢ σ(θᵀx⁽ⁱ⁾)^(y⁽ⁱ⁾) · (1 − σ(θᵀx⁽ⁱ⁾))^(1 − y⁽ⁱ⁾)
```

Tomar o logaritmo negativo dá a **log loss** (também chamada de perda de entropia cruzada), que é minimizada em vez de maximizar a verossimilhança diretamente:

```text
J(θ) = − Σᵢ [ y⁽ⁱ⁾ log(σ(θᵀx⁽ⁱ⁾)) + (1 − y⁽ⁱ⁾) log(1 − σ(θᵀx⁽ⁱ⁾)) ]
```

Ao contrário do erro quadrático aplicado à saída de uma sigmoide (que é não convexo e pode prender o gradient descent em mínimos locais ruins), esse objetivo de log loss é convexo em `θ`: o gradient descent do conceito anterior tem garantia de convergir para o único mínimo global.

## Exemplos Resolvidos

### Exemplo 1: calculando uma previsão e sua probabilidade

Suponha que um modelo de regressão logística ajustado para detecção de spam tenha `θᵀx = 2.0` para um dado e-mail (um escore linear positivo, vindo de features como "contém a palavra 'grátis'" e "excesso de pontos de exclamação"). Então:

```text
P(spam | x) = σ(2.0) = 1 / (1 + e^(−2.0)) = 1 / (1 + 0.1353) ≈ 0.881
```

Uma probabilidade prevista de 88.1% de spam; como isso passa de 0.5, o modelo classifica o e-mail como spam.

### Exemplo 2: encontrando a fronteira de decisão à mão

Suponha que um modelo ajustado com 2 features tenha `θ = [θ₀, θ₁, θ₂] = [−4, 1, 1]` (com `x₀ = 1` como termo de intercepto), então `θᵀx = −4 + x₁ + x₂`. A fronteira de decisão é onde `θᵀx = 0`:

```text
−4 + x₁ + x₂ = 0
        x₂ = 4 − x₁
```

Essa é uma reta com inclinação −1 e intercepto 4. Um ponto como `(x₁, x₂) = (1, 1)` dá `θᵀx = −4 + 1 + 1 = −2 < 0`, então é classificado como classe 0; um ponto como `(3, 3)` dá `θᵀx = −4 + 3 + 3 = 2 > 0`, classificado como classe 1. O modelo traça exatamente essa reta e classifica tudo de um lado como 1 e do outro como 0.

## Equívocos Comuns e Armadilhas

- **"A regressão logística é um modelo de regressão, então prevê um alvo contínuo como a regressão linear."** Apesar do nome (um artefato histórico), a regressão logística é um método de classificação: a quantidade contínua que ela produz é uma probabilidade de pertencer à classe, e não a própria variável-alvo.
- **"Como a fronteira de decisão é linear, a regressão logística só consegue separar classes linearmente separáveis."** Isso vale para o modelo *básico* nas features brutas, mas, exatamente como na regressão linear, features não lineares construídas (`x₁²`, `x₁x₂` etc.) podem ser acrescentadas como entradas adicionais, permitindo que a mesma maquinaria de fronteira de decisão linear em `θ` produza fronteiras curvas no espaço de features original.
- **"O erro quadrático teria funcionado igualmente bem aqui, só que com menos elegância."** Aplicar o erro quadrático diretamente às saídas da sigmoide torna a perda não convexa, o que significa que o gradient descent pode empacar em mínimos locais ruins. O objetivo de log loss não é uma preferência estilística: é especificamente o que mantém esse problema de otimização convexo e tratável.

## Resumo

A regressão logística reaproveita o escore linear `θᵀx` da regressão linear, mas o passa pela função sigmoide para produzir uma probabilidade válida, e classifica conforme essa probabilidade passe ou não de 0.5, o que equivale a `θᵀx` ser positivo ou não, definindo uma fronteira de decisão linear. Seguir a mesma lógica de máxima verossimilhança usada na regressão linear, mas supondo um rótulo com distribuição de Bernoulli em vez de ruído gaussiano, produz o objetivo de log loss: convexo e ajustado pelo mesmo gradient descent apresentado no conceito anterior.

## Documentation Links

- [Stanford CS229: Lecture Notes, Part I: Linear Regression](https://cs229.stanford.edu/main_notes.pdf): cobre a derivação da regressão logística por máxima verossimilhança na seção seguinte à regressão linear.
- [James, Witten, Hastie & Tibshirani: An Introduction to Statistical Learning](https://www.statlearning.com/): o Capítulo 3 (Classification) apresenta a regressão logística como a porta de entrada padrão da classificação.
