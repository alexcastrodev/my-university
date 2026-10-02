---
version: 1.0
updatedAt: 2026-09-06
title: Gradient Descent como Otimizador Geral
summary: Transformar o gradiente informal já apresentado na disciplina de álgebra linear deste currículo num algoritmo iterativo completo, que dá passos repetidos no sentido oposto ao gradiente até atingir o mínimo de uma função de perda. É a técnica de otimização à qual quase todo modelo desta disciplina acaba se reduzindo.
---
## Objetivos de Aprendizagem

- Enunciar a regra de atualização do gradient descent e explicar, geometricamente, por que dar um passo no sentido oposto ao gradiente diminui uma função de perda.
- Explicar o papel da taxa de aprendizado e descrever o que acontece quando ela é escolhida grande ou pequena demais.
- Rastrear à mão uma execução concreta de gradient descent ao longo de várias iterações numa função de perda simples.
- Distinguir gradient descent em batch, estocástico e em mini-batch e explicar por que as variantes estocástica e em mini-batch importam para os grandes conjuntos de dados nos quais os modelos posteriores desta disciplina costumam ser treinados.

## Contexto e Motivação

`foundations/mathematics-for-computing` apresentou o gradiente como uma generalização vetorial da derivada de uma variável (a direção de subida mais íngreme de uma função de várias variáveis) e o usou, informalmente, para ajudar a derivar a equação normal dos mínimos quadrados igualando um gradiente a zero. Aquele uso anterior foi um truque pontual, específico de uma perda quadrática e convexa com solução em forma fechada. Este conceito transforma o mesmo gradiente no burro de carga de um algoritmo iterativo de otimização de uso geral: o gradient descent, que funciona para essencialmente qualquer função de perda diferenciável, exista ou não uma forma fechada.

Isso importa de imediato: a regressão logística, o próximo conceito desta disciplina, não tem solução em forma fechada como a regressão linear tem. O gradient descent (ou um parente próximo) é como a regressão logística, e quase todo outro modelo visto mais adiante nesta disciplina, incluindo as redes neurais, é de fato ajustado na prática.

## Teoria Central

### A regra de atualização

Para minimizar uma função de perda diferenciável `J(θ)`, o gradient descent atualiza repetidamente o vetor de parâmetros `θ` dando um passo no sentido oposto ao gradiente:

```text
θ := θ − α · ∇J(θ)
```

em que `∇J(θ)` é o gradiente de `J` avaliado no `θ` atual, e `α` (a **taxa de aprendizado**) é um pequeno tamanho de passo positivo escolhido de antemão. O gradiente aponta na direção de *aumento* mais íngreme de `J`; mover-se no sentido oposto é, portanto, a melhor direção local para diminuir `J`. Repetindo essa atualização, `θ` se move progressivamente em direção a um ponto onde o gradiente é zero: um mínimo local e, para uma perda convexa como a da regressão linear ou logística, o mínimo *global*.

### Escolhendo a taxa de aprendizado

A taxa de aprendizado `α` controla o tamanho de cada passo. Pequena demais, e a convergência é correta, mas dolorosamente lenta, exigindo muitas iterações para fazer progresso significativo. Grande demais, e a atualização pode ultrapassar o mínimo por completo, fazendo a perda oscilar ou até divergir para valores cada vez maiores em vez de diminuir. Na prática, `α` é escolhida por experimentação, muitas vezes começando grande e diminuindo ao longo do treino, ou testando vários valores no conjunto de validação (apresentado mais adiante no bloco de avaliação desta disciplina) e escolhendo o que converge mais rápido sem divergir.

### Variantes em batch, estocástica e em mini-batch

A regra de atualização acima usa o gradiente da perda somado sobre o conjunto de treino *inteiro* (**gradient descent em batch**): preciso, mas caro por passo quando o conjunto de treino é grande, já que cada atualização exige uma passada completa por todos os dados. O **gradient descent estocástico (SGD)**, em vez disso, atualiza `θ` usando o gradiente calculado a partir de um único exemplo de treino por vez, trocando uma direção por passo mais ruidosa e menos precisa por atualizações drasticamente mais baratas e mais frequentes. O **gradient descent em mini-batch** é o meio-termo prático usado quase universalmente: calcular o gradiente sobre um pequeno lote de exemplos (digamos, 32 ou 256) por vez, equilibrando a estabilidade do gradient descent em batch com a velocidade do SGD.

## Exemplos Resolvidos

### Exemplo 1: uma descida rastreada à mão numa quadrática simples

Minimize `J(θ) = (θ − 3)²`, uma quadrática unidimensional com mínimo único em `θ = 3`. Sua derivada é `J'(θ) = 2(θ − 3)`. Começando em `θ₀ = 0` com taxa de aprendizado `α = 0.3`:

```text
Iteração 0: θ = 0.000,   J'(θ) = 2(0 − 3)     = −6.000,   θ ← 0.000 − 0.3(−6.000) = 1.800
Iteração 1: θ = 1.800,   J'(θ) = 2(1.8 − 3)   = −2.400,   θ ← 1.800 − 0.3(−2.400) = 2.520
Iteração 2: θ = 2.520,   J'(θ) = 2(2.52 − 3)  = −0.960,   θ ← 2.520 − 0.3(−0.960) = 2.808
Iteração 3: θ = 2.808,   J'(θ) = 2(2.808 − 3) = −0.384,   θ ← 2.808 − 0.3(−0.384) = 2.9232
Iteração 4: θ = 2.9232,  J'(θ) ≈ −0.1536,               θ ← 2.9232 + 0.04608 ≈ 2.969
```

`θ` converge visivelmente para o verdadeiro mínimo em 3, movendo-se uma quantidade cada vez menor a cada iteração, exatamente o comportamento esperado conforme o próprio gradiente encolhe perto do mínimo.

### Exemplo 2: uma taxa de aprendizado que diverge

Repetindo o Exemplo 1 com `α = 1.1` (grande demais para esta perda):

```text
Iteração 0: θ = 0.000,  J'(θ) = −6.000,  θ ← 0.000 − 1.1(−6.000) = 6.600
Iteração 1: θ = 6.600,  J'(θ) = +7.200,  θ ← 6.600 − 1.1(7.200)  = −1.320
Iteração 2: θ = −1.320, J'(θ) = −8.640,  θ ← −1.320 − 1.1(−8.640) = 8.184
```

`θ` oscila com amplitude crescente em torno do verdadeiro mínimo 3, em vez de convergir: uma ilustração real e calculável de por que a taxa de aprendizado não pode simplesmente ser a maior possível para progredir mais rápido.

## Equívocos Comuns e Armadilhas

- **"O gradient descent sempre encontra o mínimo global."** Isso só é garantido quando a função de perda é convexa (como é na regressão linear e logística). Para perdas não convexas, como as usadas pelas redes neurais, o gradient descent pode convergir para um mínimo local que não é globalmente ótimo.
- **"Uma taxa de aprendizado menor é sempre mais segura e igualmente boa, só mais lenta."** Verdade no limite, mas na prática uma taxa de aprendizado desnecessariamente minúscula pode tornar o treino impraticavelmente lento ou empacar fazendo progresso desprezível muito antes de chegar a uma boa solução dentro de um orçamento de treino realista.
- **"O gradient descent estocástico é uma versão pior e aproximada do gradient descent em batch."** Suas atualizações mais ruidosas são uma troca genuína, e não estritamente uma desvantagem: o ruído pode ajudar a escapar de mínimos locais rasos ou pontos de sela em perdas não convexas, e seu custo por passo muito menor é o que torna o treino em conjuntos de dados muito grandes sequer praticável.

## Resumo

O gradient descent atualiza repetidamente os parâmetros dando passos no sentido oposto ao gradiente da função de perda, escalados por uma taxa de aprendizado. É uma generalização direta do gradiente informal já apresentado em `foundations/mathematics-for-computing`, agora transformado num algoritmo iterativo de otimização completo que funciona exista ou não uma solução em forma fechada. A taxa de aprendizado precisa ser ajustada com cuidado: pequena demais desperdiça tempo, grande demais pode causar divergência. As variantes em batch, estocástica e em mini-batch equilibram precisão do gradiente contra custo computacional por passo, sendo o mini-batch o padrão prático para o treino em grandes conjuntos de dados do qual os modelos posteriores desta disciplina, da regressão logística em diante, de fato dependem.

## Documentation Links

- [Stanford CS229: Lecture Notes, Part I: Linear Regression](https://cs229.stanford.edu/main_notes.pdf): apresenta o gradient descent (e sua variante estocástica) como o método geral de ajuste por trás dos modelos desta disciplina.
- [MIT 18.065: Syllabus (OCW)](https://ocw.mit.edu/courses/18-065-matrix-methods-in-data-analysis-signal-processing-and-machine-learning-spring-2018/pages/syllabus/): cobre métodos de otimização baseados em gradiente no mesmo enquadramento de álgebra linear aplicada que este currículo já usou para gradientes.
