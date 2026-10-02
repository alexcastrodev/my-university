---
version: 1.0
updatedAt: 2026-09-07
title: Pooling, Strides, Padding e Compartilhamento de Pesos
summary: A mecânica que transforma uma única convolução em uma camada prática e treinável. O stride controla quanto o filtro salta entre posições, o padding controla o que acontece na borda e o pooling descarta detalhes espaciais de propósito para embutir alguma tolerância à translação. E o motivo mais profundo de uma camada convolucional precisar de ordens de grandeza menos parâmetros que uma totalmente conectada: cada posição da imagem reaproveita exatamente os mesmos pesos do filtro.
---
## Objetivos de Aprendizagem

- Calcular o tamanho da saída de uma convolução dados o stride e o padding, e explicar o que cada parâmetro controla.
- Explicar a operação de max pooling e por que ela é aplicada depois das camadas convolucionais.
- Enunciar o número exato de parâmetros de uma camada convolucional versus o de uma camada totalmente conectada equivalente, e explicar por que o compartilhamento de pesos produz essa diferença.
- Explicar por que o compartilhamento de pesos combina especificamente com dados de imagem, em termos de invariância à translação.

## Contexto e Motivação

O conceito anterior calculou à mão uma convolução pequena, deslizando um filtro um passo de cada vez, sem padding; o caso mais simples possível. Construir uma camada convolucional real e prática exige mais duas escolhas de projeto (stride e padding) e mais uma operação empilhada depois da convolução (pooling) de que a maioria das arquiteturas de CNN depende. Por baixo de tudo isso está a mesma ideia apresentada, mas ainda não quantificada, no conceito anterior: como os pesos do filtro são compartilhados em todas as posições, uma camada convolucional precisa de muito menos parâmetros que uma camada totalmente conectada processando a mesma entrada; este conceito torna essa economia concreta e explica com precisão por que é a própria estrutura espacial dos dados de imagem que faz o compartilhamento de pesos se encaixar tão bem.

## Teoria Central

### Stride: quanto o filtro anda a cada passo

O **stride** é o número de posições que o filtro se desloca entre uma aplicação e outra. Um stride de 1 (o padrão do conceito anterior) desliza o filtro para toda posição possível; um stride de 2 pula uma posição sim, outra não, calculando cerca de um quarto das saídas em duas dimensões. Para uma entrada de tamanho `n`, filtro de tamanho `k` e stride `s` (sem padding), o tamanho da saída é:

```text
tamanho da saída = ⌊(n − k) / s⌋ + 1
```

Um stride maior produz um mapa de features menor e mais grosseiro com menos custo, ao preço de alguma resolução espacial.

### Padding: controlando a borda e o tamanho da saída

O padding acrescenta valores extras (quase sempre zeros) em volta da borda da entrada antes de convoluir. Duas convenções são comuns: o padding **valid** (nenhum padding, como nos exemplos do conceito anterior) encolhe a saída em relação à entrada, enquanto o padding **same** acrescenta borda suficiente para manter a saída do mesmo tamanho da entrada. Para uma entrada de tamanho `n`, filtro de tamanho `k`, stride `s` e padding `p` em cada lado, a fórmula geral do tamanho da saída é:

```text
tamanho da saída = ⌊(n + 2p − k) / s⌋ + 1
```

O padding também tem um efeito secundário que vale nomear: sem ele, um pixel exatamente no canto de uma imagem é tocado por muito menos posições do filtro que um pixel perto do centro, sub-representando na prática a informação da borda ao longo de muitas camadas convolucionais empilhadas; o padding mantém os pixels da borda envolvidos em mais ou menos tantas posições de convolução quanto os do interior.

### Pooling: descartando detalhes de propósito

Uma camada de pooling (mais comumente **max pooling**) desliza uma pequena janela sobre cada mapa de features (sem nenhum peso aprendido) e reduz cada janela a um único valor: normalmente o máximo (max pooling) ou a média (average pooling) dos valores daquela janela. Uma janela de max pooling 2×2 com stride 2, por exemplo, reduz pela metade as duas dimensões espaciais de um mapa de features. A perda deliberada de informação espacial precisa é o objetivo: o pooling dá à rede alguma tolerância a pequenas translações da entrada (uma feature detectada um pouco à esquerda ou à direita de onde apareceu no treino ainda sobrevive ao pooling, desde que caia na mesma janela de pooling) e reduz o tamanho espacial, e portanto o custo computacional, de cada camada seguinte.

### Compartilhamento de pesos: o argumento do número de parâmetros, tornado concreto

Uma camada convolucional com filtro `k × k` (e, digamos, `c` canais de entrada) tem exatamente `k · k · c` pesos (mais um bias) **qualquer que seja o tamanho espacial da entrada**: o mesmo filtro é aplicado em todas as posições, então o número de posições em que o filtro é aplicado não acrescenta nenhum parâmetro novo. Uma camada totalmente conectada processando a mesma entrada, ao contrário, precisa de um peso independente por par (pixel de entrada, unidade de saída), um número que cresce com o tamanho espacial total da entrada. É exatamente por isso que o compartilhamento de pesos combina especificamente com dados de imagem: um detector de bordas útil no canto superior esquerdo de uma imagem é, pela natureza das imagens, muito provavelmente igualmente útil aplicado ao canto inferior direito; o *mesmo* padrão pode aparecer em qualquer lugar da imagem, então faz sentido detectá-lo com o *mesmo* filtro em todo lugar, em vez de aprender um filtro independente e sem relação para cada posição possível.

## Exemplos Resolvidos

### Exemplo 1: tamanho da saída para diferentes escolhas de stride e padding

Para uma entrada 32×32 e um filtro 5×5:

```text
Stride 1, sem padding:    ⌊(32 - 5)/1⌋ + 1 = 27 + 1 = 28   → saída 28×28
Stride 1, padding 2:      ⌊(32 + 4 - 5)/1⌋ + 1 = 31 + 1 = 32  → saída 32×32 (padding same)
Stride 2, sem padding:    ⌊(32 - 5)/2⌋ + 1 = ⌊13.5⌋ + 1 = 13 + 1 = 14  → saída 14×14
```

Um padding de exatamente 2 em cada lado (para um filtro 5×5, stride 1) recupera o tamanho original 32×32; essa relação específica, `p = (k−1)/2` para stride 1, é a fórmula padrão do padding "same".

### Exemplo 2: número de parâmetros, convolucional versus totalmente conectada

Considere uma entrada 32×32×3 (RGB) alimentando uma camada que produz 16 mapas de features de saída.

```text
Camada convolucional (filtros 5×5):
  Parâmetros = (5 · 5 · 3 + 1) · 16 = (75 + 1) · 16 = 76 · 16 = 1.216 pesos

Camada totalmente conectada (entrada achatada, 16 unidades de saída):
  Tamanho da entrada = 32 · 32 · 3 = 3.072
  Parâmetros = (3.072 + 1) · 16 = 3.073 · 16 = 49.168 pesos
```

A camada convolucional usa cerca de 40 vezes menos parâmetros para produzir o mesmo número de mapas de features de saída a partir da mesma entrada, e essa diferença cresce ainda mais conforme o tamanho espacial da entrada aumenta, já que o número de parâmetros da camada convolucional depende só do tamanho do filtro, nunca da altura ou da largura da entrada.

## Equívocos Comuns e Armadilhas

- **"O padding serve só para controlar o tamanho da saída, nada mais."** O padding de fato controla o tamanho da saída, mas tem um efeito secundário real em quão uniformemente a informação perto da borda da imagem é processada ao longo de muitas camadas convolucionais; um detalhe fácil de ignorar quando só se confere a aritmética.
- **"O max pooling tem pesos aprendíveis, como uma camada convolucional."** O pooling não tem peso nenhum: ele aplica uma operação fixa e não aprendida (máximo ou média) dentro de cada janela. É uma fonte comum de confusão, já que camadas de pooling costumam aparecer em diagramas ao lado de camadas convolucionais com notação parecida de janela/stride.
- **"O compartilhamento de pesos funcionaria igualmente bem para qualquer tipo de entrada, não só imagens."** O compartilhamento de pesos explora especificamente a **invariância à translação**: a premissa de que um padrão local útil pode aparecer em qualquer lugar da entrada e deve ser detectado do mesmo jeito em todo lugar. Dados sem essa propriedade (por exemplo, dados tabulares em que cada coluna tem um significado fixo e não intercambiável) não se beneficiam da mesma premissa arquitetural, e é exatamente por isso que as CNNs são a arquitetura especializada em imagens desta disciplina, e não um substituto universal das camadas densas vistas antes.

## Resumo

O stride controla quanto um filtro convolucional anda entre aplicações, e o padding controla o tratamento da borda da entrada e o tamanho de saída resultante; juntos, dão um controle preciso, guiado por fórmulas, sobre as dimensões de saída de uma camada convolucional. O pooling (normalmente max pooling) descarta de propósito detalhes espaciais finos, sem usar pesos aprendidos, para embutir alguma tolerância a pequenas translações e reduzir a computação exigida pelas camadas seguintes. Por baixo de tudo isso, o compartilhamento de pesos é o que dá a uma camada convolucional sua vantagem dramática de eficiência em parâmetros sobre uma camada totalmente conectada processando a mesma entrada; uma vantagem que depende especificamente da propriedade de invariância à translação das imagens, que é exatamente a propriedade que torna reaproveitar um filtro em todo lugar uma boa premissa arquitetural.

## Documentation Links

- [CS231n: Convolutional Neural Networks: Architectures, Convolution / Pooling Layers](https://cs231n.github.io/convolutional-networks/): a fórmula do tamanho de saída com stride/padding e a operação de max pooling que este conceito cobre diretamente.
- [CS231n: Course Schedule (Stanford, Spring 2026)](https://cs231n.stanford.edu/schedule.html): confirma "Convolution and pooling for hierarchical feature learning" como o enquadramento do próprio curso para exatamente este bloco de ideias.
