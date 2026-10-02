---
version: 1.0
updatedAt: 2026-09-06
title: A Visão Probabilística da Regressão Linear
summary: Por que minimizar o erro quadrático não é uma escolha arbitrária. Supondo que o ruído em torno da reta verdadeira tenha distribuição normal, maximizar a verossimilhança dos dados observados produz exatamente a mesma solução de mínimos quadrados já derivada geometricamente.
---
## Objetivos de Aprendizagem

- Enunciar a suposição probabilística por trás da regressão linear: os valores observados de `y` são iguais a `θᵀx` mais um ruído independente com distribuição normal.
- Derivar a log-verossimilhança dos dados de treino sob essa suposição e mostrar que maximizá-la é algebricamente idêntico a minimizar o erro quadrático.
- Explicar por que essa derivação justifica o erro quadrático como *a* perda natural da regressão linear, e não uma escolha arbitrária por conveniência.
- Ligar esse argumento à estimação por máxima verossimilhança como princípio geral para ajustar modelos a dados.

## Contexto e Motivação

O conceito anterior ajustou a regressão linear minimizando diretamente o erro quadrático, tratando essa escolha como dada. Este conceito faz a pergunta mais profunda: por que o erro quadrático, e não alguma outra medida de ajuste, como o erro absoluto? A resposta vem de fazer uma suposição probabilística explícita sobre como os dados foram gerados e mostrar que o erro quadrático não é uma convenção arbitrária, e sim a função de perda implicada pelo modelo de ruído mais natural de todos: ruído gaussiano independente em torno de uma relação linear verdadeira, exatamente a distribuição normal já vista na disciplina de probabilidade deste currículo.

Esta é a primeira aparição nesta disciplina de um padrão que se repete ao longo de todo o machine learning: a **estimação por máxima verossimilhança**, que escolhe os parâmetros do modelo de modo a tornar os dados observados os mais prováveis possíveis sob um modelo gerador suposto. A regressão linear é a ilustração mais limpa possível desse princípio, porque o problema de otimização resultante se revela um problema já resolvido.

## Teoria Central

### A suposição geradora

Suponha que cada `y⁽ⁱ⁾` observado seja gerado como:

```text
y⁽ⁱ⁾ = θᵀx⁽ⁱ⁾ + ε⁽ⁱ⁾,      ε⁽ⁱ⁾ ~ N(0, σ²), de forma independente
```

Ou seja: existe uma relação linear subjacente verdadeira `θᵀx`, e cada observação se desvia dela por um ruído independente sorteado de uma distribuição normal centrada em zero com alguma variância fixa `σ²`, a mesma distribuição normal cuja forma de sino e cujos parâmetros foram vistos em `foundations/probability-statistics`.

### A verossimilhança dos dados

Sob essa suposição, `y⁽ⁱ⁾` dado `x⁽ⁱ⁾` e `θ` tem ele próprio distribuição normal com média `θᵀx⁽ⁱ⁾` e variância `σ²`. A densidade de probabilidade de uma única observação é:

```text
p(y⁽ⁱ⁾ | x⁽ⁱ⁾; θ) = (1 / √(2πσ²)) · exp( − (y⁽ⁱ⁾ − θᵀx⁽ⁱ⁾)² / (2σ²) )
```

Supondo que os `N` exemplos de treino são independentes, a **verossimilhança** do conjunto de dados inteiro é o produto dessas densidades individuais:

```text
L(θ) = Πᵢ p(y⁽ⁱ⁾ | x⁽ⁱ⁾; θ)
```

### Maximizar a log-verossimilhança é minimizar o erro quadrático

Tomar o logaritmo de `L(θ)` (uma função estritamente crescente, então maximizar `log L(θ)` também maximiza `L(θ)`) transforma o produto numa soma:

```text
log L(θ) = Σᵢ [ −½log(2πσ²) − (y⁽ⁱ⁾ − θᵀx⁽ⁱ⁾)² / (2σ²) ]
         = N·(−½log(2πσ²)) − (1/2σ²) · Σᵢ (y⁽ⁱ⁾ − θᵀx⁽ⁱ⁾)²
```

O primeiro termo não depende de `θ`. Maximizar `log L(θ)` em `θ` é, portanto, equivalente a minimizar `Σᵢ (y⁽ⁱ⁾ − θᵀx⁽ⁱ⁾)²`, exatamente a perda de erro quadrático `J(θ)` do conceito anterior. É nesse sentido preciso que o erro quadrático não é uma convenção arbitrária: é a perda implicada pela suposição de ruído gaussiano, derivada do modelo probabilístico mais padrão de erro de medição.

## Exemplos Resolvidos

### Exemplo 1: a redução algébrica completa, passo a passo

Partindo da log-verossimilhança derivada acima, com `σ²` tratado como fixo:

```text
maximizar:  log L(θ) = C − (1/2σ²) · Σᵢ (y⁽ⁱ⁾ − θᵀx⁽ⁱ⁾)²        (C constante em θ)

⟺ maximizar:  − Σᵢ (y⁽ⁱ⁾ − θᵀx⁽ⁱ⁾)²      (descartando a constante positiva 1/2σ²)

⟺ minimizar:  Σᵢ (y⁽ⁱ⁾ − θᵀx⁽ⁱ⁾)²       (inverter o sinal troca max por min)
```

A última linha é exatamente o `J(θ)` de `linear-regression-as-least-squares`: a derivação é uma equivalência direta e mecânica, e não uma analogia.

### Exemplo 2: por que a variância do ruído σ² não afeta qual θ é escolhido

Repare, na derivação acima, que `σ²` só aparece como um fator de escala positivo `1/(2σ²)` multiplicando a soma dos erros quadráticos. Ele nunca muda *qual* `θ` minimiza a expressão, só quão fortemente a verossimilhança penaliza o desvio. Isso significa que a estimativa de máxima verossimilhança de `θ` é idêntica quer o ruído suposto seja pequeno (`σ² = 0.1`) ou grande (`σ² = 10`): uma consequência real e verificável da álgebra, e não uma coincidência, e o motivo pelo qual `θ` pode ser estimado por mínimos quadrados sem nunca precisar saber de antemão a verdadeira variância do ruído.

## Equívocos Comuns e Armadilhas

- **"Supor ruído gaussiano é só um truque conveniente sem justificativa real."** É uma suposição de modelagem específica e falseável. Se o ruído verdadeiro for muito assimétrico ou tiver outliers extremos, um modelo de ruído diferente (e uma função de perda correspondentemente diferente, como o erro absoluto sob ruído com distribuição de Laplace) seria mais adequado. A predominância do erro quadrático na prática vem de o ruído gaussiano ser uma aproximação excelente para muitos processos reais de medição, e não de não haver alternativa.
- **"Máxima verossimilhança e mínimos quadrados são duas técnicas diferentes que por acaso concordam aqui."** Para a regressão linear sob ruído gaussiano, elas não só concordam: são exatamente o mesmo problema de otimização, mostrado algebricamente idêntico acima.
- **"Esta derivação só importa para regressão."** O princípio de máxima verossimilhança usado aqui (escolher parâmetros que tornem os dados observados os mais prováveis sob um modelo suposto) reaparece mais adiante nesta disciplina, com outra roupagem, nos classificadores generativos (Análise Discriminante Gaussiana e Naive Bayes), que ajustam suas distribuições condicionais à classe pelo mesmo princípio.

## Resumo

Supor que os alvos observados são iguais a uma função linear verdadeira mais um ruído independente com distribuição normal, e escolher `θ` para maximizar a verossimilhança dos dados de treino observados sob essa suposição, é algebricamente idêntico a minimizar o erro quadrático, o mesmo objetivo já resolvido via álgebra linear. Isso dá ao erro quadrático uma justificativa probabilística real, em vez de tratá-lo como uma conveniência arbitrária, e apresenta a estimação por máxima verossimilhança, um princípio ao qual esta disciplina volta quando chega aos classificadores generativos.

## Documentation Links

- [Stanford CS229: Lecture Notes, Part I: Linear Regression](https://cs229.stanford.edu/main_notes.pdf): deriva exatamente esta interpretação probabilística dos mínimos quadrados.
- [Caltech CS 156: Learning From Data, Lecture 3: The Linear Model I](https://work.caltech.edu/telecourse.html): apresenta o modelo linear junto com sua motivação probabilística.
