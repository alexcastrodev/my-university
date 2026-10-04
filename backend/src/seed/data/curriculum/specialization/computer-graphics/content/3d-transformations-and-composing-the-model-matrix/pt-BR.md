---
version: 1.0
updatedAt: 2026-09-08
title: "Transformações 3D e a Composição da Matriz Model"
summary: "Estende o truque homogêneo 2D do conceito anterior para matrizes 4x4 sobre (x, y, z, 1), depois responde a pergunta que fez `matrices-as-linear-transformations` importar em primeiro lugar: a multiplicação de matrizes é composição de funções, então um modelo transformado por escala, depois rotação, depois translação é uma única matriz, S depois R depois T multiplicadas juntas (da direita para a esquerda), aplicada a todo vértice uma vez. Construir esta única matriz model, corretamente ordenada (a ordem genuinamente muda o resultado, já que a multiplicação de matrizes não comuta), é o mecanismo do qual todo grafo de cena 3D e todo objeto animado no pipeline desta disciplina depende."
---
## Objetivos de Aprendizagem

- Estender as coordenadas homogêneas de 2D (matrizes 3x3 sobre (x, y, 1)) para 3D (matrizes 4x4 sobre (x, y, z, 1)), e escrever as matrizes de translação, rotação e escala 3D.
- Compor escala, rotação e translação numa única matriz model, na ordem convencional, e explicar por que essa ordem é a convencional.
- Aplicar uma matriz model completa a um vértice 3D concreto e verificar o resultado à mão.
- Explicar, concretamente, por que a não comutatividade (já mostrada em 2D) significa que a ordem de composição da matriz model é uma decisão de projeto real, não arbitrária.

## Contexto e Motivação

`homogeneous-coordinates-and-2d-affine-transformations` resolveu a translação para pontos 2D preenchendo para três coordenadas e usando matrizes 3x3; este conceito faz a coisa idêntica uma dimensão acima, preenchendo pontos 3D para quatro coordenadas (x, y, z, 1) e usando matrizes 4x4, porque todo objeto numa cena real vive em três dimensões. O problema real e prático que este conceito resolve é a composição: um modelo 3D é tipicamente autorado em torno da sua própria origem, depois precisa ser escalado ao tamanho certo, rotacionado para ficar voltado para a direção certa, e transladado para a sua posição no mundo, três operações separadas que um pipeline de gráficos precisa como uma única matriz, aplicada uma vez por vértice, não três multiplicações separadas. `matrices-as-linear-transformations` (`mathematics-for-computing`) já estabeleceu que a multiplicação de matrizes é composição de funções; este conceito é a aplicação gráfica direta desse fato à única matriz, chamada de matriz model, que todo renderizador constrói para todo objeto numa cena.

## Teoria Central

### Matrizes homogêneas 3D

Um ponto 3D (x, y, z) se torna (x, y, z, 1); um vetor de direção 3D se torna (x, y, z, 0), pela mesma razão que em 2D: só pontos devem ser afetados pela translação. As três matrizes de transformação 4x4 básicas:

```text
Translação por (tx,ty,tz):      Escala por (sx,sy,sz):
| 1 0 0 tx |                    | sx 0  0  0 |
| 0 1 0 ty |                    | 0  sy 0  0 |
| 0 0 1 tz |                    | 0  0  sz 0 |
| 0 0 0 1  |                    | 0  0  0  1 |

Rotação em torno de Z pelo ângulo t:
| cos(t) -sin(t) 0 0 |
| sin(t)  cos(t) 0 0 |
|   0       0    1 0 |
|   0       0    0 1 |
```

A rotação em torno dos eixos X e Y segue o padrão idêntico, com o bloco de rotação 2x2 movido para o par de eixos em torno do qual se rotaciona. Um modelo 3D é agora transformado multiplicando a coordenada homogênea de todo vértice por quaisquer dessas matrizes que se apliquem, exatamente da forma que `matrices-as-linear-transformations` descreveu uma matriz agindo sobre um vetor, só que num cenário 4x4 e homogêneo.

### Compondo a matriz model: S, depois R, depois T

A convenção padrão constrói a matriz model como M = T * R * S (as matrizes multiplicam da direita para a esquerda sobre o vértice, então a escala é aplicada primeiro, depois a rotação, depois a translação): M * v = T * (R * (S * v)). Esta ordem não é arbitrária: escalar primeiro, enquanto o objeto ainda está centrado na sua própria origem local, o escala simetricamente em torno dessa origem; se a translação acontecesse primeiro, escalar depois também escalaria o próprio deslocamento da translação, movendo o objeto para mais longe de onde ele foi colocado. Rotacionar antes de transladar, similarmente, rotaciona o objeto em torno da sua própria origem local em vez de em torno de onde quer que ele por acaso esteja situado no mundo. Esta é a exata mesma não comutatividade que `homogeneous-coordinates-and-2d-affine-transformations` demonstrou numericamente em 2D, agora aplicada como uma regra de projeto deliberada em vez de deixada como um aviso.

## Exemplos Resolvidos

### Exemplo 1: escalar, depois rotacionar, depois transladar um único vértice

Vértice de espaço de objeto v = (1, 0, 0, 1). Escale por (2, 2, 2), depois rotacione 90 graus em torno de Z, depois translade por (10, 0, 0).

```text
Passo 1 (escalar por 2):        (1,0,0,1) -> (2,0,0,1)
Passo 2 (rotacionar 90 em Z):   (2,0,0,1) -> (0,2,0,1)
  [cos90=0, sin90=1: x' = 0*2 - 1*0 = 0; y' = 1*2 + 0*0 = 2]
Passo 3 (transladar por (10,0,0)): (0,2,0,1) -> (10,2,0,1)
```

Posição final de espaço de mundo: (10, 2, 0).

### Exemplo 2: o mesmo vértice, ordem errada (transladar antes de escalar)

Mesmo vértice v = (1, 0, 0, 1), mesmas três operações, mas transladar primeiro: translade por (10, 0, 0), depois rotacione 90 em torno de Z, depois escale por 2.

```text
Passo 1 (transladar por (10,0,0)): (1,0,0,1) -> (11,0,0,1)
Passo 2 (rotacionar 90 em Z):      (11,0,0,1) -> (0,11,0,1)
Passo 3 (escalar por 2):           (0,11,0,1) -> (0,22,0,1)
```

Posição final: (0, 22, 0), nada perto do (10, 2, 0) do Exemplo 1, e não um pequeno desvio numérico, uma colocação completamente diferente: o objeto acaba escalado 2x mais longe da origem do mundo do que o pretendido, precisamente a falha de "o deslocamento da translação também é escalado" que a ordem convencional S-depois-R-depois-T evita.

### Exemplo 3: uma matriz model completa para um objeto colocado em (10, 0, 0), escalado por 2, sem rotação

Para o caso simples sem rotação, M = T * S diretamente, e aplicar M a todo vértice de um cubo unitário centrado na origem local do objeto (cantos em +/-0.5 em cada eixo) escala cada canto por 2 primeiro (cantos agora em +/-1.0), depois desloca o cubo inteiro por (10, 0, 0), colocando os cantos de espaço de mundo do cubo em, por exemplo, (9, -1, -1) e (11, 1, 1), um cubo 2x2x2 corretamente centrado em (10, 0, 0) no mundo, não em (20, 0, 0) nem a cavaleiro de algum outro ponto.

## Equívocos Comuns e Armadilhas

- **"Qualquer ordem de S, R, T funciona desde que todas as três sejam aplicadas eventualmente."** O (0, 22, 0) do Exemplo 2 versus o (10, 2, 0) do Exemplo 1 para as três operações idênticas no vértice inicial idêntico é uma refutação numérica direta; a ordem muda o resultado, não só o caminho até ele.
- **"Compor três matrizes 4x4 em tempo de execução, por vértice, é caro."** Na prática a matriz model M = T * R * S é computada uma vez por objeto por quadro (uma única multiplicação 4x4 * 4x4 * 4x4), depois essa única matriz resultante é aplicada a cada um dos vértices do objeto; o custo da composição não escala com a contagem de vértices.
- **"Rotação em torno de um eixo arbitrário precisa de um tipo de matriz inteiramente diferente."** Ainda é uma matriz 4x4 construída a partir da mesma família de matrizes de rotação (uma combinação linear da estrutura das matrizes de rotação X, Y e Z, via a fórmula de rotação de Rodrigues ou uma construção equivalente); o mecanismo, um mapa linear mais o truque de translação homogêneo, não muda.

## Resumo

Estender as coordenadas homogêneas para três dimensões transforma a translação, a rotação e a escala 3D em matrizes 4x4, deixando uma transformação model completa ser construída como uma única matriz, M = T * R * S, aplicada uma vez por vértice. A ordem de composição convencional, escala primeiro, depois rotação, depois translação, existe por uma razão concreta: ela escala e rotaciona um objeto em torno da sua própria origem local antes de colocá-lo no mundo, e o Exemplo 2 mostra numericamente o que dá errado (um resultado completamente diferente e incorretamente deslocado) quando essa ordem é invertida. Esta matriz model é o primeiro elo na cadeia model-view-projection que `the-view-matrix-and-camera-space` continua em seguida, movendo um vértice transformado do espaço de mundo para o próprio quadro de referência da câmera.

## Documentation Links

- [MIT 18.06: Linear Algebra (OCW course home, Gilbert Strang)](https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/): a fundação de álgebra linear para tratar uma sequência de multiplicações de matrizes como composição de funções, reusada aqui para o caso 3D, 4x4.
- [Cornell CS4620: Introduction to Computer Graphics (course page, Fall 2025)](https://www.cs.cornell.edu/courses/cs4620/2025fa/): um curso universitário real e atual cuja unidade "Basic Geometry & Transformations" constrói a mesma composição de matriz model 3D que este conceito cobre.
