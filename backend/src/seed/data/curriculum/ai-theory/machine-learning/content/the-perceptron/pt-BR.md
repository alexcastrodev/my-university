---
version: 1.0
updatedAt: 2026-09-06
title: O Perceptron
summary: O algoritmo de aprendizado mais antigo deste bloco e o ancestral direto de toda rede neural. Uma única unidade linear com limiar que ajusta os próprios pesos, um exemplo classificado errado por vez, até (se os dados forem linearmente separáveis) convergir exatamente.
---
## Objetivos de Aprendizagem

- Enunciar o modelo do perceptron e sua regra de previsão e contrastá-la com a saída suave por sigmoide da regressão logística.
- Enunciar com precisão o algoritmo de aprendizado do perceptron e explicar por que ele só atualiza em exemplos classificados errado.
- Rastrear à mão o algoritmo do perceptron convergindo num pequeno conjunto de dados linearmente separável.
- Enunciar a garantia do teorema de convergência do perceptron e explicar com precisão por que ela falha quando os dados não são linearmente separáveis.

## Contexto e Motivação

Esta disciplina já cobriu classificadores lineares generativos e discriminativos (regressão logística, GDA, Naive Bayes), classificadores lineares e com kernel baseados em margem (SVMs) e modelos não lineares baseados em árvores. O perceptron, historicamente o primeiro de todos eles (apresentado por Frank Rosenblatt em 1958), volta ao classificador linear mais simples possível, tanto pelo seu papel histórico como ancestral direto de toda rede neural quanto porque sua regra de atualização é a ponte mais limpa possível para as redes em camadas, treinadas por gradiente, que o último bloco de conteúdo desta disciplina apresenta.

## Teoria Central

### O modelo do perceptron

Como a regressão logística, o perceptron calcula um escore linear `θᵀx`, mas em vez de passá-lo por uma sigmoide suave para obter uma probabilidade, aplica um limiar rígido:

```text
ŷ = +1  se θᵀx ≥ 0
ŷ = −1  se θᵀx < 0
```

Não há saída de probabilidade alguma, só uma decisão binária rígida, sem nenhuma noção de confiança como a que a saída sigmoide da regressão logística oferece.

### O algoritmo de aprendizado do perceptron

O perceptron é treinado por uma regra de atualização que só age quando ele erra: para cada exemplo de treino `(x⁽ⁱ⁾, y⁽ⁱ⁾)` com `y⁽ⁱ⁾ ∈ {+1, −1}`, se o modelo atual o classifica corretamente (`ŷ⁽ⁱ⁾ = y⁽ⁱ⁾`), não faz nada; se o classifica errado, atualiza:

```text
θ := θ + y⁽ⁱ⁾ · x⁽ⁱ⁾
```

Isso empurra `θ` na direção que teria deixado o escore deste exemplo específico mais positivo (se `y⁽ⁱ⁾ = +1`) ou mais negativo (se `y⁽ⁱ⁾ = −1`): uma correção simples e gulosa depois de cada erro, repetida percorrendo o conjunto de treino em ciclos até não ocorrerem mais erros.

### O teorema de convergência, e onde ele falha

O **teorema de convergência do perceptron** garante que, se os dados de treino forem linearmente separáveis, essa regra de atualização com certeza encontra um hiperplano separador num número finito de atualizações: uma garantia real e demonstrável de convergência para a regra de aprendizado mais simples possível. Crucialmente, essa garantia tem uma dependência rígida: se os dados *não* forem linearmente separáveis (como o clássico padrão XOR da discussão de dimensão VC deste currículo, ou qualquer conjunto de dados que exija uma fronteira não linear), o algoritmo do perceptron nunca converge. Ele fica em ciclo para sempre, corrigindo repetidamente erros que continuam voltando, porque nenhuma fronteira linear única consegue classificar os dados perfeitamente.

## Exemplos Resolvidos

### Exemplo 1: convergência do perceptron num conjunto de dados linearmente separável

Considere dados 2D com `x₀=1` (intercepto) sempre acrescentado no início: `x⁽¹⁾=(1,2,2), y⁽¹⁾=+1`; `x⁽²⁾=(1,−1,−1), y⁽²⁾=−1`. Começando com `θ = (0,0,0)`:

```text
Confere x⁽¹⁾: θᵀx⁽¹⁾ = 0, previsto +1 (empates classificados como +1 por convenção) → correto, sem atualização
Confere x⁽²⁾: θᵀx⁽²⁾ = 0, previsto +1, mas o rótulo verdadeiro é −1 → ERRO
  Atualiza: θ := θ + y⁽²⁾·x⁽²⁾ = (0,0,0) + (−1)·(1,−1,−1) = (−1, 1, 1)

Segunda passada, confere x⁽¹⁾: θᵀx⁽¹⁾ = −1 + 1·2 + 1·2 = 3 ≥ 0, previsto +1 → correto, sem atualização
Confere x⁽²⁾: θᵀx⁽²⁾ = −1 + 1·(−1) + 1·(−1) = −3 < 0, previsto −1 → correto, sem atualização
```

Os dois exemplos agora estão classificados corretamente com `θ = (−1, 1, 1)`: o algoritmo convergiu depois de exatamente uma atualização, exatamente como o teorema de convergência do perceptron garante para dados linearmente separáveis.

### Exemplo 2: um perceptron que nunca converge em dados do tipo XOR

Considere o clássico padrão não linearmente separável já invocado na discussão de dimensão VC desta própria disciplina como o motivo pelo qual um classificador linear 2D não consegue fragmentar 4 pontos: quatro pontos, `(1,1)→+1, (−1,−1)→+1, (1,−1)→−1, (−1,1)→−1`. Nenhuma reta consegue separar os pontos `+1` (numa diagonal) dos pontos `−1` (na diagonal oposta). Executando a regra de atualização do perceptron nesses dados: cada passada pelos quatro pontos produz pelo menos um erro, e a atualização correspondente perturba `θ` de um jeito que corrige esse erro, mas reintroduz outro num ponto diferente. O algoritmo fica em ciclo de atualizações indefinidamente, sem nunca chegar a um estado com zero erros, exatamente como a pré-condição do teorema de convergência (separabilidade linear) prevê que deve acontecer quando ela não é satisfeita.

## Equívocos Comuns e Armadilhas

- **"O perceptron sempre converge para um bom classificador, com tempo suficiente."** A garantia do teorema de convergência depende da separabilidade linear. Para dados genuinamente não separáveis, como mostra o Exemplo 2, nenhum tempo extra de treino vai produzir convergência; o algoritmo fica em ciclo para sempre.
- **"O perceptron e a regressão logística são basicamente o mesmo algoritmo."** Os dois calculam um escore linear e classificam pelo sinal dele, mas seus procedimentos de *treino* são fundamentalmente diferentes: o perceptron só atualiza em erros, sem noção de "quão errada" foi a previsão, enquanto a atualização por gradient descent da regressão logística (vista antes nesta disciplina) é guiada por uma perda suave baseada em probabilidade que reflete a confiança, atualizando até em pontos classificados corretamente se a probabilidade prevista ainda não for extrema o bastante.
- **"O perceptron é uma curiosidade puramente histórica, sem relevância moderna."** Seu mecanismo de atualizar ao errar é o ancestral conceitual direto do treino baseado em gradiente das redes neurais: empilhar muitas unidades parecidas com o perceptron em camadas e trocar o limiar rígido por uma função de ativação suave é exatamente o passo que o próximo conceito desta disciplina dá.

## Resumo

O perceptron calcula um escore linear e classifica pelo sinal dele, exatamente como a regressão logística, mas é treinado por uma regra simples de atualização guiada por erros, e não por gradient descent numa perda suave. O teorema de convergência do perceptron garante que essa regra de atualização encontra um hiperplano separador perfeito em tempo finito sempre que os dados são linearmente separáveis e, igualmente crucial, não garante nada (o algoritmo fica em ciclo para sempre) sempre que não são, uma limitação real ligada diretamente às preocupações de separabilidade linear já levantadas pela dimensão VC antes nesta disciplina. O perceptron é o ancestral histórico e conceitual direto das redes neurais que o próximo conceito apresenta.

## Documentation Links

- [Stanford CS229: Lecture Notes, Part I: Linear Regression](https://cs229.stanford.edu/main_notes.pdf): apresenta o perceptron junto com a regressão logística como um classificador linear relacionado, com uma regra de atualização diferente.
- [Caltech CS 156: Learning From Data, Lecture 3: The Linear Model I](https://work.caltech.edu/telecourse.html): cobre o algoritmo de aprendizado do perceptron e sua garantia de convergência no mesmo estilo de derivação usado aqui.
