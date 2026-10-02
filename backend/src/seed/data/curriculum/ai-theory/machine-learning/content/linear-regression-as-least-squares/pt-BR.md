---
version: 1.0
updatedAt: 2026-09-06
title: Regressão Linear como Mínimos Quadrados
summary: O modelo mais usado de toda a estatística e do machine learning chega aqui sem matemática nova alguma. Ele é exatamente o problema da equação normal já resolvido, geometricamente e por otimização, na disciplina de álgebra linear deste currículo, agora reenquadrado como previsão em dados não vistos.
---
## Objetivos de Aprendizagem

- Enunciar o modelo de regressão linear, `ŷ = θᵀx`, e a perda de erro quadrático que ele minimiza sobre um conjunto de treino.
- Explicar, com precisão, por que ajustar um modelo de regressão linear é exatamente o problema de mínimos quadrados já resolvido na disciplina de álgebra linear deste currículo: mesma equação, mesma solução pela equação normal.
- Calcular a solução de mínimos quadrados em forma fechada `θ = (XᵀX)⁻¹Xᵀy` num pequeno conjunto de dados resolvido.
- Explicar por que existe uma solução em forma fechada especificamente para a regressão linear, e por que a maioria dos modelos posteriores desta disciplina não tem uma e exige gradient descent.

## Contexto e Motivação

O primeiro modelo de aprendizado supervisionado desta disciplina não exige matemática nova alguma. `foundations/mathematics-for-computing` já construiu, por completo e do zero, a ferramenta exata de que este conceito precisa: `least-squares-via-linear-algebra`, o encerramento daquela disciplina, derivou a reta de melhor ajuste para dados sem solução exata duas vezes, uma geometricamente (como uma projeção no espaço coluna) e outra por otimização (igualando um gradiente a zero), e mostrou que os dois caminhos chegam à mesma equação normal. A regressão linear, como modelo de machine learning, é exatamente esse problema, reenquadrado com um vocabulário novo: a "reta de melhor ajuste" vira um "modelo treinado", e a promessa de que ele generaliza para novos valores de `x` que nunca viu é a afirmação nova que esta disciplina acrescenta por cima.

Cursos de cima para baixo no estilo Kurose-Ross tendem a apresentar aplicações antes do mecanismo; o CS229 e o curso do Caltech fazem o inverso para a regressão (mecanismo primeiro, já que o mecanismo aqui é genuinamente reaproveitado, e não novo). Este conceito segue essa mesma ordem: reenunciar o resultado de álgebra linear já provado e depois enquadrá-lo explicitamente como um modelo preditivo.

## Teoria Central

### O modelo e a função de perda

Um modelo de regressão linear prevê `ŷ = θᵀx` para um vetor de features de entrada `x` (com uma constante `1` acrescentada a `x` para que `θ` inclua um termo de intercepto) e um vetor de parâmetros `θ`. Dados `N` exemplos de treino `(x⁽ⁱ⁾, y⁽ⁱ⁾)`, o modelo é ajustado escolhendo `θ` para minimizar a soma dos erros quadráticos:

```text
J(θ) = Σᵢ (θᵀx⁽ⁱ⁾ − y⁽ⁱ⁾)²
```

Empilhando o `x⁽ⁱ⁾` de cada exemplo de treino como uma linha de uma matriz `X` e cada `y⁽ⁱ⁾` num vetor `y`, isso é exatamente `J(θ) = ‖Xθ − y‖²`, o mesmo objetivo de mínimos quadrados já minimizado em `least-squares-via-linear-algebra`.

### Reaproveitando a equação normal já provada

Aquele conceito anterior provou, tanto por um argumento geométrico de projeção quanto igualando a zero o gradiente de `‖Xθ − y‖²`, que o `θ` que minimiza satisfaz a **equação normal**:

```text
XᵀXθ = Xᵀy
```

que, sempre que `XᵀX` é invertível, tem a solução em forma fechada `θ = (XᵀX)⁻¹Xᵀy`. Nada aqui é derivado de novo; é a aplicação direta de um resultado já provado a um cenário novo: previsão em dados ainda não vistos, em vez do enquadramento puramente descritivo de "reta de melhor ajuste num conjunto de dados fixo" da disciplina anterior.

### Por que existe forma fechada aqui, mas raramente depois

A função de perda da regressão linear, `‖Xθ − y‖²`, é uma função suave e quadrática (e, portanto, convexa) de `θ`, e é exatamente por isso que igualar seu gradiente a zero produz uma única equação linear, globalmente ótima, a resolver. Quase todo outro modelo desta disciplina (regressão logística, redes neurais) tem uma função de perda que não é tão simples, e não existe solução em forma fechada; esses modelos são ajustados por gradient descent (o próximo conceito), um método iterativo que funciona para uma classe muito mais ampla de funções de perda, mas que, em geral, não chega à resposta exata num único passo.

## Exemplos Resolvidos

### Exemplo 1: um ajuste minúsculo em forma fechada

Ajustar `ŷ = θ₀ + θ₁x` a quatro pontos: `(1, 3), (2, 5), (3, 7), (4, 8)`.

```text
X = [[1, 1], [1, 2], [1, 3], [1, 4]]   (a primeira coluna é o termo de intercepto)
y = [3, 5, 7, 8]

XᵀX = [[4, 10], [10, 30]]
Xᵀy = [23, 71]

Resolvendo XᵀXθ = Xᵀy:
θ₀ ≈ 0.5,  θ₁ ≈ 2.0

Reta ajustada: ŷ = 0.5 + 2.0x
```

Conferindo: em `x=1`, `ŷ = 2.5` (real 3); em `x=4`, `ŷ = 8.5` (real 8). É um ajuste razoável, com pequenos erros residuais, exatamente como se espera de dados sem uma relação linear perfeita.

### Exemplo 2: prevendo numa entrada não vista

Usando a reta ajustada `ŷ = 0.5 + 2.0x` do Exemplo 1, o modelo agora pode prever para `x = 5`, um valor que nunca esteve nos dados de treino: `ŷ = 0.5 + 2.0(5) = 10.5`. Esse é todo o propósito do enquadramento de machine learning acrescentado sobre o resultado de álgebra linear preexistente: usar os parâmetros ajustados para generalizar para entradas novas, não vistas, e não apenas descrever os próprios pontos de treino.

## Equívocos Comuns e Armadilhas

- **"A regressão linear só ajusta retas."** O modelo é linear nos *parâmetros* `θ`, não necessariamente na entrada original. Features como `x²` ou `log(x)` podem ser acrescentadas como colunas adicionais de `X`, permitindo que a mesma maquinaria linear em `θ` ajuste curvas, ao custo de exigir mais cuidado com overfitting (visto mais adiante no bloco de complexidade de modelos desta disciplina).
- **"A equação normal sempre funciona."** Ela exige que `XᵀX` seja invertível, o que falha quando as features são perfeitamente colineares ou quando há mais features que exemplos. Na prática, isso é tratado com regularização (um conceito posterior) ou usando gradient descent, que não exige inverter nada.
- **"Este é um algoritmo completamente novo que preciso aprender do zero."** Não é: cada passo acima é uma reformulação direta de `least-squares-via-linear-algebra`, já provado na disciplina de álgebra linear deste currículo; a única ideia genuinamente nova aqui é o enquadramento preditivo.

## Resumo

A regressão linear ajusta `ŷ = θᵀx` minimizando o erro quadrático sobre um conjunto de treino, o que é exatamente o problema de mínimos quadrados `‖Xθ − y‖²` já resolvido por completo em `foundations/mathematics-for-computing`, com a mesma solução em forma fechada `θ = (XᵀX)⁻¹Xᵀy` derivada da equação normal. O conteúdo genuinamente novo que esta disciplina acrescenta é o enquadramento preditivo (usar os parâmetros ajustados em entradas nunca vistas durante o treino) e a observação de que essa forma fechada é uma conveniência especial da perda convexa e quadrática da regressão linear, e não algo disponível para a maioria dos modelos vistos depois.

## Documentation Links

- [Stanford CS229: Lecture Notes, Part I: Linear Regression](https://cs229.stanford.edu/main_notes.pdf): as notas de aula reais que derivam este mesmo modelo e a equação normal.
- [James, Witten, Hastie & Tibshirani: An Introduction to Statistical Learning](https://www.statlearning.com/): o Capítulo 2 (Regression) enquadra a regressão linear como porta de entrada do aprendizado estatístico, o mesmo papel que ela cumpre aqui.
