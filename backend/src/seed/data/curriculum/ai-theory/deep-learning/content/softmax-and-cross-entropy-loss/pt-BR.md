---
version: 1.0
updatedAt: 2026-09-07
title: Softmax e Loss de Cross-Entropy
summary: A função de loss contra a qual quase todo classificador desta disciplina é de fato treinado. O softmax transforma os scores brutos de saída de uma rede em uma distribuição de probabilidade sobre as classes, e a cross-entropy, derivada aqui diretamente por máxima verossimilhança sobre essa distribuição (o mesmo argumento de MLE já usado na regressão logística), mede exatamente quão longe essa distribuição está do rótulo verdadeiro.
---
## Objetivos de Aprendizagem

- Definir a função softmax e explicar por que ela transforma scores reais arbitrários em uma distribuição de probabilidade válida sobre as classes.
- Derivar o loss de cross-entropy por estimação de máxima verossimilhança sobre a distribuição softmax, no mesmo estilo já usado na derivação probabilística da regressão logística.
- Calcular à mão as probabilidades do softmax e o loss de cross-entropy em um exemplo pequeno e concreto.
- Explicar por que o gradiente da cross-entropy em relação aos scores antes do softmax tem uma forma fechada incomumente simples, e por que isso importa para o backpropagation.

## Contexto e Motivação

O conceito `the-probabilistic-view-of-linear-regression` de `ai-theory/machine-learning` mostrou que minimizar o erro quadrático não é uma escolha arbitrária: ela decorre diretamente de maximizar a verossimilhança dos dados sob uma premissa de ruído gaussiano. `logistic-regression-and-decision-boundaries` fez a coisa análoga para classificação binária: espremer um score linear por uma sigmoid e interpretar o resultado como `P(y=1|x)`. Este conceito estende as duas ideias para o caso geral de várias classes com que as redes densas desta disciplina quase sempre terminam: a última camada de uma rede produz um score bruto por classe, o softmax transforma esses scores em uma distribuição de probabilidade e a cross-entropy é a função de loss que resulta de maximizar a verossimilhança do rótulo verdadeiro sob essa distribuição; o mesmo argumento de MLE, mais uma vez, agora para um resultado categórico em vez de gaussiano ou de Bernoulli.

Não é um detalhe periférico. Quase todo classificador treinado nesta disciplina (de uma rede multicamadas simples até as CNNs, RNNs e Transformers vistos depois) usa exatamente essa função de loss na camada de saída, calculada exatamente pelo mecanismo de backpropagation do conceito anterior.

## Teoria Central

### A função softmax

Dado um vetor de scores brutos (**logits**) `z = (z₁, ..., zₖ)` para `k` classes, o softmax os converte em uma distribuição de probabilidade:

```text
softmax(z)ᵢ = e^zᵢ / Σⱼ e^zⱼ
```

Toda saída é positiva (já que `e^zᵢ > 0` para qualquer `zᵢ` real), e todas as saídas somam exatamente 1 (por construção, ao dividir pelo total). O softmax também é **invariante a deslocamentos**: somar a mesma constante a todo `zᵢ` deixa a distribuição de saída inalterada, já que a constante sai como fator tanto do numerador quanto do denominador; uma propriedade usada na prática para subtrair o maior logit antes de exponenciar, por estabilidade numérica, sem mudar o resultado.

### Cross-entropy como máxima verossimilhança

Se `softmax(z)ᵢ` for interpretado como a estimativa do modelo para `P(y = i | x)`, então, para um exemplo de treino com rótulo verdadeiro `y`, a verossimilhança desse rótulo sob o modelo é `softmax(z)_y`, a probabilidade que o modelo atribuiu à classe correta. Maximizar essa verossimilhança equivale a minimizar o negativo do seu log, que é exatamente o **loss de cross-entropy**:

```text
L = −log(softmax(z)_y) = −log( e^z_y / Σⱼ e^zⱼ )
```

É exatamente o mesmo padrão de MLE que `the-probabilistic-view-of-linear-regression` já usou (escolher o loss que a maximização da verossimilhança produz, em vez de escolher um loss por intuição), aplicado aqui a um resultado categórico em vez de gaussiano. Com apenas duas classes, isso se reduz exatamente ao loss da regressão logística, confirmando softmax mais cross-entropy como a generalização direta para várias classes daquele conceito anterior, e não como uma ideia diferente.

### Por que o gradiente é incomumente simples

Derivar `L` em relação aos logits `zᵢ` antes do softmax dá um resultado surpreendentemente limpo:

```text
∂L/∂zᵢ = softmax(z)ᵢ − 1[i = y]
```

Em palavras: o gradiente em cada saída é simplesmente "probabilidade prevista menos 1 se esta é a classe verdadeira, probabilidade prevista menos 0 caso contrário". Essa forma fechada é precisamente o motivo de softmax e cross-entropy quase sempre andarem juntos na prática: combinados, eles entregam ao backpropagation (o conceito anterior) um gradiente local extremamente barato para começar a propagar para trás, em vez de exigir que a regra da cadeia seja aplicada separadamente por um nó de softmax e depois por um nó de log.

## Exemplos Resolvidos

### Exemplo 1: probabilidades do softmax e loss para um vetor de scores de 3 classes

Seja a saída bruta da rede para um exemplo `z = (2.0, 1.0, 0.1)`, com rótulo verdadeiro `y = 1` (a primeira classe, indexada a partir de zero como classe 0).

```text
e^2.0 = 7.389,  e^1.0 = 2.718,  e^0.1 = 1.105
Soma = 7.389 + 2.718 + 1.105 = 11.212

softmax(z)₀ = 7.389 / 11.212 ≈ 0.659
softmax(z)₁ = 2.718 / 11.212 ≈ 0.242
softmax(z)₂ = 1.105 / 11.212 ≈ 0.099

L = −log(softmax(z)_0) = −log(0.659) ≈ 0.417
```

O modelo atribuiu 65,9% de probabilidade à classe correta, produzindo um loss moderado de cerca de 0,417; uma previsão correta e confiante empurraria essa probabilidade para perto de 1 e o loss para perto de 0.

### Exemplo 2: a forma fechada do gradiente, conferida diretamente

Usando o mesmo `z` e `y = 0` do Exemplo 1, a fórmula do gradiente dá:

```text
∂L/∂z₀ = softmax(z)₀ − 1 = 0.659 − 1 = −0.341
∂L/∂z₁ = softmax(z)₁ − 0 = 0.242
∂L/∂z₂ = softmax(z)₂ − 0 = 0.099
```

O gradiente negativo na classe correta (`−0.341`) significa que o gradiente descendente vai *aumentar* `z₀`, empurrando o modelo a atribuir ainda mais probabilidade à classe correta, enquanto os gradientes positivos nas classes incorretas empurram os scores delas para baixo. É exatamente o comportamento intuitivo esperado de um loss de classificação, agora derivado, e não presumido.

## Equívocos Comuns e Armadilhas

- **"Softmax e cross-entropy são duas escolhas de projeto independentes."** Eles costumam ser derivados e usados juntos por um motivo: o softmax é aquilo por que os scores brutos de uma rede passam para virar uma distribuição válida, e a cross-entropy é exatamente o loss que a máxima verossimilhança produz para essa distribuição; usar cross-entropy sem softmax (ou o contrário) quebra a interpretação probabilística que este conceito derivou.
- **"O loss de cross-entropy não tem relação com o loss da regressão logística."** Fazer `k = 2` na fórmula de softmax com cross-entropy se reduz algebricamente ao loss de cross-entropy binária da regressão logística; este conceito é a generalização direta para várias classes já antecipada por `logistic-regression-and-decision-boundaries`, e não um loss novo sem relação.
- **"Uma previsão errada confiante e uma previsão errada sem confiança são penalizadas mais ou menos igual."** O termo `−log` da cross-entropy cresce sem limite conforme a probabilidade atribuída à classe correta se aproxima de zero; uma resposta errada confiante (digamos, `softmax(z)_y = 0.01`) é penalizada muito mais pesadamente que uma sem confiança (`softmax(z)_y = 0.4`), e é precisamente esse o comportamento pretendido para um loss probabilístico.

## Resumo

O softmax converte os scores brutos de saída de uma rede em uma distribuição de probabilidade válida sobre as classes; o loss de cross-entropy é exatamente o negativo da log-verossimilhança do rótulo verdadeiro sob essa distribuição, a mesma derivação por máxima verossimilhança já usada nas regressões linear e logística, agora aplicada ao caso categórico. O gradiente resultante em relação aos scores antes do softmax tem uma forma fechada incomumente simples (`probabilidade prevista menos o rótulo verdadeiro em one-hot`), e é exatamente isso que torna softmax mais cross-entropy a camada de saída e o loss padrão de quase todo classificador que esta disciplina cobre daqui em diante.

## Documentation Links

- [CS231n: Neural Networks Part 2: Setting up the Data and the Loss](https://cs231n.github.io/neural-networks-2/): o loss do classificador softmax `−log(e^f_yi / Σⱼe^f_j)` que este conceito deriva e usa.
- [Eaton & Epstein: Artificial Intelligence in the CS2023 Undergraduate Computer Science Curriculum](https://ojs.aaai.org/index.php/AAAI/article/view/30352/32394): confirma "objective functions and gradient descent" como conteúdo explícito do KA Core na cobertura de machine learning na graduação, o mesmo enquadramento sobre o qual este conceito e o anterior se apoiam.
