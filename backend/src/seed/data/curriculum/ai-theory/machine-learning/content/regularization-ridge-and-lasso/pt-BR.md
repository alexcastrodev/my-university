---
version: 1.0
updatedAt: 2026-09-06
title: "Regularização: Ridge e Lasso"
summary: Combater o overfitting diretamente penalizando pesos grandes na função de perda. A penalidade circular e suave da regressão ridge encolhe um pouco cada peso, enquanto a penalidade em forma de losango do lasso consegue encolher alguns pesos exatamente a zero, uma diferença geométrica real com consequências reais.
---
## Objetivos de Aprendizagem

- Explicar a ideia geral da regularização: restringir a capacidade efetiva de um modelo penalizando valores grandes de parâmetros, sem mudar a contagem bruta de parâmetros do modelo.
- Enunciar os termos de penalidade ridge (L2) e lasso (L1) e suas funções objetivo combinadas.
- Explicar a razão geométrica pela qual o lasso consegue encolher coeficientes exatamente a zero e o ridge não, usando a forma da região de restrição de cada penalidade.
- Rastrear, num pequeno exemplo resolvido, como aumentar a força da regularização muda os coeficientes ajustados.

## Contexto e Motivação

Os dois conceitos anteriores estabeleceram que o overfitting vem de uma classe de modelos com capacidade efetiva grande demais em relação aos dados disponíveis, medida com rigor pela dimensão VC. A regularização é a contramedida prática mais direta: em vez de mudar a forma estrutural do modelo (menos features, um polinômio de grau menor), ela restringe o quanto os parâmetros ajustados podem crescer, acrescentando à função de perda um termo de penalidade que cresce com o tamanho do vetor de parâmetros. Isso reduz a capacidade *efetiva* de um modelo sofrer overfitting sem descartar nenhuma feature de vez, ou, no caso do lasso, descarta automaticamente as menos úteis.

## Teoria Central

### Regressão ridge (penalidade L2)

A **regressão ridge** acrescenta à perda comum de mínimos quadrados uma penalidade proporcional à soma dos coeficientes ao quadrado:

```text
J_ridge(θ) = ‖Xθ − y‖² + λ · Σⱼ θⱼ²
```

em que `λ ≥ 0` é um hiperparâmetro que controla a força da penalidade: `λ = 0` recupera exatamente os mínimos quadrados comuns, e um `λ` maior encolhe cada coeficiente em direção a zero de forma mais agressiva, embora raramente exatamente a zero.

### Regressão lasso (penalidade L1)

O **lasso** troca a penalidade dos coeficientes ao quadrado pela soma dos valores absolutos:

```text
J_lasso(θ) = ‖Xθ − y‖² + λ · Σⱼ |θⱼ|
```

A forma matemática parece parecida, mas o comportamento difere bastante: o lasso consegue encolher alguns coeficientes *exatamente* a zero, fazendo na prática uma seleção automática de features ao descartar as de que o modelo não precisa. O ridge, em contraste, encolhe cada coeficiente em direção a zero, mas essencialmente nunca zera um deles exatamente.

### A razão geométrica da diferença

Os dois objetivos penalizados podem ser entendidos como mínimos quadrados comuns sujeitos a uma região de restrição: o ridge restringe `θ` a ficar dentro de um círculo (ou uma esfera em dimensões maiores), enquanto o lasso restringe `θ` a ficar dentro de um losango (uma forma com cantos pontudos sobre os eixos). A solução de mínimos quadrados, quando restrita a ficar dentro de qualquer uma das regiões, tende a cair no ponto da região mais próximo do ótimo sem restrição. Como os cantos do losango ficam exatamente sobre os eixos coordenados (onde um coeficiente é zero), o ótimo restrito frequentemente cai precisamente num canto, zerando exatamente aquele coeficiente. O círculo não tem cantos, então o ótimo restrito pode cair em qualquer ponto da borda, essencialmente nunca exatamente sobre um eixo, e é exatamente por isso que o ridge encolhe, mas não zera, os coeficientes.

## Exemplos Resolvidos

### Exemplo 1: o ridge encolhendo coeficientes conforme λ aumenta

Suponha que os mínimos quadrados comuns (λ = 0) ajustem `θ = [θ₁, θ₂] = [5.0, 3.0]` para uma regressão com duas features. Aumentando a penalidade ridge:

```text
λ = 0:    θ = [5.00, 3.00]    (sem encolhimento: mínimos quadrados comuns)
λ = 1:    θ = [4.20, 2.55]    (os dois coeficientes encolhem em direção a 0, nenhum chega lá)
λ = 10:   θ = [2.10, 1.35]    (mais encolhimento, os dois ainda não nulos)
λ = 100:  θ = [0.45, 0.30]    (encolhimento forte: os dois quase zero, mas não exatamente)
```

Os dois coeficientes encolhem juntos, proporcionalmente, conforme `λ` cresce, mas nenhum é levado precisamente a zero mesmo com `λ` muito grande, coerente com a região de restrição circular do ridge, que não tem cantos.

### Exemplo 2: o lasso zerando um coeficiente

Ajustando os mesmos dados com lasso, a uma força de penalidade comparável:

```text
λ = 0:    θ = [5.00, 3.00]    (mínimos quadrados comuns)
λ = 1:    θ = [4.10, 2.30]
λ = 5:    θ = [2.60, 0.90]
λ = 8:    θ = [1.20, 0.00]    ← θ₂ foi levado exatamente a zero
λ = 12:   θ = [0.00, 0.00]    ← os dois coeficientes agora exatamente zero
```

Em `λ = 8`, o lasso na prática tirou a segunda feature do modelo por completo: seu coeficiente é exatamente zero, e não só pequeno. É um efeito real e calculável de seleção de features que o ridge, aplicado aos mesmos dados, não produziria com nenhum `λ` finito.

## Equívocos Comuns e Armadilhas

- **"A regularização sempre melhora um modelo."** A regularização troca algum aumento de viés por uma redução de variância, exatamente a troca viés-variância vista antes nesta disciplina. Uma força de regularização grande demais pode levar o modelo ao underfitting, encolhendo coeficientes úteis em direção a zero junto com os inúteis.
- **"O lasso é estritamente melhor que o ridge porque faz seleção de features."** A seleção de features do lasso é útil especificamente quando muitas features são de fato irrelevantes, mas, quando as features são altamente correlacionadas entre si, o lasso tende a escolher arbitrariamente uma e zerar as outras, enquanto o ridge encolhe as features correlacionadas juntas, de forma mais equilibrada. A melhor escolha depende genuinamente da estrutura das features reais.
- **"A força de regularização λ deve ser escolhida para minimizar o erro de treino."** Minimizar o erro de treino em relação a `λ` sempre favorece `λ = 0` (sem regularização), já que a regularização existe justamente para sacrificar parte do ajuste de treino em troca de melhor generalização. `λ` precisa ser escolhido usando um conjunto de validação separado ou validação cruzada (o próximo conceito desta disciplina), nunca só o conjunto de treino.

## Resumo

A regularização restringe a capacidade do modelo acrescentando à função de perda uma penalidade sobre o tamanho dos coeficientes, combatendo diretamente o risco de overfitting quantificado pela dimensão VC. A penalidade de coeficientes ao quadrado da regressão ridge encolhe todos os coeficientes suavemente em direção a zero sem eliminar nenhum; a penalidade de valor absoluto do lasso consegue levar alguns coeficientes exatamente a zero, fazendo seleção automática de features, uma consequência geométrica real dos cantos pontudos da região de restrição em losango do lasso versus a região circular, sem cantos, do ridge. Escolher a força de regularização corretamente exige um conjunto de validação separado, nunca os dados de treino aos quais o modelo foi ajustado.

## Documentation Links

- [James, Witten, Hastie & Tibshirani: An Introduction to Statistical Learning](https://www.statlearning.com/): o Capítulo 5 (Linear Model Selection and Regularization) deriva ridge e lasso com o mesmo argumento geométrico de região de restrição usado aqui.
- [Caltech CS 156: Learning From Data, Lecture 12: Regularization](https://work.caltech.edu/telecourse.html): a aula real que motiva a regularização diretamente a partir da preocupação com overfitting do conceito anterior.
