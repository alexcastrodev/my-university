---
version: 1.0
updatedAt: 2026-09-07
title: Convolução como um Produto Escalar Deslizante
summary: A operação que o curso âncora desta disciplina (CS231n) existe para ensinar a fundo. Um pequeno filtro aprendido desliza sobre uma imagem calculando um produto escalar (exatamente a operação já vista como fato da álgebra vetorial) em cada posição, produzindo um mapa de features que acende onde quer que apareça o padrão que o filtro aprendeu a detectar.
---
## Objetivos de Aprendizagem

- Explicar por que uma camada totalmente conectada é um encaixe arquitetural ruim para entradas de imagem, em termos de número de parâmetros e da estrutura espacial que ela descarta.
- Definir convolução (como implementada em frameworks de deep learning, tecnicamente uma correlação cruzada) como um filtro deslizando sobre uma entrada e calculando um produto escalar em cada posição.
- Calcular à mão o mapa de features de saída de uma convolução pequena, dados um filtro e uma entrada.
- Explicar o que um filtro convolucional aprendido consegue detectar, usando um exemplo concreto de detecção de bordas.

## Contexto e Motivação

Toda rede vista até aqui nesta disciplina trata sua entrada como um único vetor achatado. Aplicar isso diretamente a uma imagem é possível, mas desperdiçador: uma camada totalmente conectada que processa uma modesta imagem RGB de 224×224 (150.528 valores de entrada) em uma única camada oculta de só 1.000 unidades já exige mais de 150 milhões de pesos só nessa camada, antes de contar qualquer camada adicional; e, pior, tratar cada pixel como uma entrada independente joga fora o fato de que pixels vizinhos se relacionam de um jeito que importa visualmente (uma borda, uma textura, uma forma), enquanto pixels distantes na imagem normalmente não. O conceito `the-kernel-trick` de `ai-theory/machine-learning` enfrentou um problema parecido nas SVMs (o próprio espaço de entrada não tinha a estrutura certa para um modelo linear) e o resolveu de um jeito muito diferente, mapeando implicitamente para um espaço de dimensão maior. As CNNs resolvem o problema das imagens com uma mudança arquitetural: uma camada deliberadamente restrita a só combinar pixels *próximos*, usando o *mesmo* pequeno conjunto de pesos em cada posição da imagem. O CS231n de Stanford existe especificamente para ensinar essa operação, e as arquiteturas construídas a partir dela, a fundo.

## Teoria Central

### A operação de convolução (correlação cruzada)

Uma camada convolucional substitui o "toda saída se conecta a toda entrada" de uma camada totalmente conectada por um pequeno **filtro** (ou **kernel**) aprendido (uma pequena matriz de pesos, normalmente 3×3 ou 5×5) que desliza sobre a entrada calculando um produto escalar em cada posição:

```text
output[i,j] = Σ_u Σ_v filter[u,v] · input[i+u, j+v]
```

Em cada posição `(i,j)`, o filtro é sobreposto ao trecho correspondente da entrada, cada par de valores alinhados é multiplicado e os produtos são somados; exatamente o produto escalar já visto como operação da álgebra vetorial, calculado uma vez para cada posição que o filtro pode ocupar. (O que os frameworks de deep learning chamam de "convolução" é, matematicamente, correlação cruzada: o filtro não é invertido antes de deslizar, ao contrário da definição estrita de convolução em processamento de sinais; mas a terminologia da área de deep learning chama isso de convolução mesmo assim, e esta disciplina segue essa convenção.) A grade completa de saídas produzida ao deslizar um filtro por toda a entrada se chama **mapa de features** (feature map).

### Por que um filtro, reaproveitado em todo lugar, é o ponto central

Os pesos do mesmo filtro são usados em todas as posições; esse é o significado concreto de **compartilhamento de pesos**, desenvolvido por completo como conceito próprio a seguir. Por ora, a consequência central: qualquer que seja o padrão que um filtro aprendeu a detectar (uma borda, um canto, uma transição de cor), ele detecta esse padrão onde quer que apareça na imagem, usando um único conjunto pequeno e fixo de pesos, em vez de um conjunto separado de pesos para cada posição possível da imagem.

### Tamanho da saída: quão grande é o mapa de features?

Para uma entrada 1D de tamanho `n` e um filtro de tamanho `k`, deslizar o filtro por todas as posições válidas (sem padding, andando um passo de cada vez) produz uma saída de tamanho `n − k + 1`. Em duas dimensões, uma entrada `n × n` convoluída com um filtro `k × k` produz uma saída `(n−k+1) × (n−k+1)`. Esse encolhimento é uma consequência direta e mecânica de o filtro precisar caber inteiramente dentro da entrada em cada posição que ocupa; `pooling-strides-padding-and-weight-sharing`, a seguir, cobre como stride e padding dão controle explícito sobre esse tamanho de saída.

## Exemplos Resolvidos

### Exemplo 1: uma convolução 2D calculada à mão

Entrada (4×4):

```text
1  2  0  1
0  1  3  1
2  1  0  2
1  0  1  1
```

Filtro (2×2):

```text
1  0
0  -1
```

Deslizando o filtro por todo trecho 2×2 válido e calculando o produto escalar em cada posição (a saída é 3×3, já que `4 − 2 + 1 = 3`):

```text
Posição (0,0): trecho [[1,2],[0,1]] → 1(1)+2(0)+0(0)+1(-1) = 1 - 1 = 0
Posição (0,1): trecho [[2,0],[1,3]] → 2(1)+0(0)+1(0)+3(-1) = 2 - 3 = -1
Posição (0,2): trecho [[0,1],[3,1]] → 0(1)+1(0)+3(0)+1(-1) = 0 - 1 = -1
Posição (1,0): trecho [[0,1],[2,1]] → 0(1)+1(0)+2(0)+1(-1) = 0 - 1 = -1
Posição (1,1): trecho [[1,3],[1,0]] → 1(1)+3(0)+1(0)+0(-1) = 1 - 0 = 1
Posição (1,2): trecho [[3,1],[0,2]] → 3(1)+1(0)+0(0)+2(-1) = 3 - 2 = 1
Posição (2,0): trecho [[2,1],[1,0]] → 2(1)+1(0)+1(0)+0(-1) = 2 - 0 = 2
Posição (2,1): trecho [[1,0],[0,1]] → 1(1)+0(0)+0(0)+1(-1) = 1 - 1 = 0
Posição (2,2): trecho [[0,2],[1,1]] → 0(1)+2(0)+1(0)+1(-1) = 0 - 1 = -1

Mapa de features de saída (3×3):
 0  -1  -1
-1   1   1
 2   0  -1
```

Cada entrada exigiu exatamente um pequeno produto escalar entre o filtro e o trecho de entrada correspondente; o mapa de features inteiro é essa mesma operação, repetida em cada posição válida.

### Exemplo 2: um filtro que detecta uma borda vertical

Considere um filtro 1×2 `[1, -1]` deslizando por uma linha 1D de intensidades de pixels que representa a fronteira de uma faixa vertical: `input = (10, 10, 10, 0, 0, 0)` (claro, depois escuro).

```text
Posição 0: [10,10] → 1(10) + (-1)(10) = 0
Posição 1: [10,10] → 1(10) + (-1)(10) = 0
Posição 2: [10,0]  → 1(10) + (-1)(0)  = 10
Posição 3: [0,0]   → 1(0)  + (-1)(0)  = 0
Posição 4: [0,0]   → 1(0)  + (-1)(0)  = 0

Saída: (0, 0, 10, 0, 0)
```

A saída do filtro é zero em todo lugar onde a entrada é localmente constante e salta para 10 exatamente na única posição que fica sobre a transição do claro para o escuro; é o mesmo mecanismo, em uma escala pequena e calculável à mão, por trás de como os filtros das primeiras camadas de uma CNN real treinada aprendem a detectar bordas: a saída de um filtro é grande precisamente onde o padrão de entrada que os pesos do filtro codificam está de fato presente.

## Equívocos Comuns e Armadilhas

- **"Um filtro convolucional é um detector de bordas fixo, projetado à mão."** O Exemplo 2 usa um filtro escolhido à mão para ilustrar, mas em uma CNN real os pesos de cada filtro são aprendidos por backpropagation e gradiente descendente, exatamente como qualquer outro peso desta disciplina; a rede descobre quais padrões vale a pena detectar, ninguém os informa de antemão.
- **"A convolução em deep learning é a convolução matemática estrita do processamento de sinais."** Os frameworks de deep learning implementam correlação cruzada (sem inverter o filtro) e a chamam de "convolução" por convenção da área; a distinção raramente importa na prática, já que os pesos do filtro são aprendidos de qualquer jeito, mas a terminologia é um ponto comum de confusão ao consultar referências de processamento de sinais.
- **"O mapa de features de saída é sempre menor que a entrada, sem jeito de evitar."** O encolhimento nos exemplos deste conceito vem especificamente de não usar padding; `pooling-strides-padding-and-weight-sharing`, a seguir, cobre como aplicar padding à entrada antes de convoluir pode manter a saída do mesmo tamanho da entrada, quando isso é desejado.

## Resumo

Uma camada convolucional substitui as conexões densas e específicas de cada posição de uma camada totalmente conectada por um pequeno filtro aprendido que desliza sobre a entrada calculando um produto escalar (a mesma operação da álgebra vetorial já vista) em cada posição, produzindo um mapa de features que responde fortemente onde quer que o padrão que o filtro aprendeu a detectar esteja presente. Reaproveitar exatamente os mesmos pesos do filtro em cada posição (compartilhamento de pesos) é o que torna isso dramaticamente mais eficiente em parâmetros que uma camada totalmente conectada para entradas em formato de imagem, e é o que o CS231n, o curso âncora desta disciplina, existe especificamente para ensinar a fundo.

## Documentation Links

- [CS231n: Convolutional Neural Networks: Architectures, Convolution / Pooling Layers](https://cs231n.github.io/convolutional-networks/): a conectividade local e com pesos compartilhados da camada convolucional que este conceito segue diretamente.
- [Dive into Deep Learning: Convolutions for Images](https://d2l.ai/chapter_convolutional-neural-networks/conv-layer.html): a operação de correlação cruzada e o exemplo resolvido de detecção de bordas que o Exemplo 2 deste conceito espelha.
