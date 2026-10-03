---
version: 1.0
updatedAt: 2026-09-08
title: "Coordenadas Homogêneas e Transformações Afins 2D"
summary: "Uma matriz linear sozinha não consegue mover um ponto sem também mover a origem, então a translação, a operação mais comum em gráficos, não é linear e não pode ser expressa por uma matriz 2x2 comum; as coordenadas homogêneas consertam isto preenchendo todo ponto 2D com uma terceira coordenada (1 para pontos, 0 para vetores de direção) e usando matrizes 3x3, deixando translação, rotação e escala todas virarem a mesma operação: uma única multiplicação de matriz."
---
## Objetivos de Aprendizagem

- Explicar precisamente por que uma matriz linear 2x2 simples não consegue representar a translação, e o que "não fixa a origem" significa concretamente para um ponto movido.
- Construir as matrizes homogêneas 3x3 para translação, rotação e escala 2D, e aplicar cada uma a um ponto concreto.
- Compor duas transformações numa única matriz e mostrar, com números, que a ordem de composição muda o resultado.
- Conectar este conserto diretamente a `matrices-as-linear-transformations` (`mathematics-for-computing`): o que aquele conceito provou sobre mapas lineares, e exatamente qual caso ele deixou sem solução.

## Contexto e Motivação

`matrices-as-linear-transformations` (`mathematics-for-computing`) provou que multiplicar um vetor por uma matriz o rotaciona, escala ou reflete, operações reais e úteis para gráficos. Mas ele também implica uma limitação real, enunciada precisamente aqui em vez de deixada implícita: um mapa linear sempre envia o vetor zero para o vetor zero (M * 0 = 0 para qualquer matriz M), então nenhuma matriz, por si só, consegue mover um ponto para longe da origem sem também mover a própria origem. A translação, a operação individual mais comum em gráficos, mover um objeto de um lugar para outro, não é uma transformação linear. Todo pipeline de gráficos precisa que translação, rotação e escala componham numa operação uniforme (a model matrix, `3d-transformations-and-composing-the-model-matrix` constrói em seguida), e isso exige um conserto real. Este conceito constrói esse conserto: coordenadas homogêneas, o truque padrão, ensinado em todo curso de gráficos, incluindo o CS4620 de Cornell, que transforma a translação numa multiplicação de matriz também.

## Teoria Central

### Por que a translação quebra a linearidade

Uma translação move todo ponto por um offset fixo: T(x, y) = (x + tx, y + ty). Cheque a propriedade definidora de um mapa linear, T(0) = 0: T(0, 0) = (tx, ty), que é (0, 0) só quando o próprio offset é zero. A translação genuinamente não é linear (para qualquer offset não nulo), então nenhuma matriz 2x2, aplicada da forma comum, consegue representá-la. Esta não é uma limitação de uma matriz particular; é um fato estrutural sobre o que matrizes 2x2 conseguem expressar de todo.

### O conserto: coordenadas homogêneas

O conserto padrão preenche todo ponto 2D (x, y) com uma terceira coordenada, virando (x, y, 1), e trabalha com matrizes 3x3 em vez de 2x2. Uma translação por (tx, ty) vira:

```text
| 1  0  tx |   | x |   | x + tx |
| 0  1  ty | * | y | = | y + ty |
| 0  0  1  |   | 1 |   |   1    |
```

A linha e coluna extras deixam a matriz adicionar um offset constante durante a multiplicação, algo que um mapa linear 2x2 puro nunca poderia fazer. Rotação e escala ainda funcionam exatamente como `matrices-as-linear-transformations` descreveu, só que embutidas no bloco 2x2 superior esquerdo de uma matriz 3x3 com a última linha e coluna deixadas como identidade:

```text
Rotação pelo ângulo theta:    Escala por (sx, sy):
| cos(t) -sin(t)  0 |         | sx  0   0 |
| sin(t)  cos(t)  0 |         | 0   sy  0 |
|   0       0     1 |         | 0   0   1 |
```

Pontos usam uma terceira coordenada de 1 (eles podem ser transladados); vetores de direção, que nunca deveriam ser movidos por uma translação, usam uma terceira coordenada de 0, e a mesma matriz de translação aplicada a um vetor o deixa inalterado, já que os termos tx e ty multiplicam contra 0 em vez de 1. Esta única convenção, uma coordenada extra, é o que deixa translação, rotação e escala todas virarem "multiplicar por uma matriz 3x3", de forma que um pipeline nunca precisa tratar nenhuma delas como caso especial.

### Compondo transformações

Porque toda transformação afim 2D agora é uma matriz 3x3, aplicar várias em sequência é só multiplicação de matriz, e a leitura de composição-de-funções da multiplicação de matriz de `matrices-as-linear-transformations` carrega diretamente: aplicar a transformação A depois a transformação B a um ponto p é B * (A * p), que é igual a (B * A) * p por associatividade, então B * A é a única matriz combinada. Porque a multiplicação de matriz não comuta, A * B e B * A são, em geral, matrizes diferentes, e aplicar rotação depois translação genuinamente não é o mesmo que aplicar translação depois rotação.

## Exemplos Resolvidos

### Exemplo 1: transladando um ponto

Ponto p = (2, 3). Transladar por (5, -1): usando a matriz acima com tx = 5, ty = -1:

```text
| 1  0  5  |   | 2 |   | 2 + 5  |   | 7  |
| 0  1  -1 | * | 3 | = | 3 - 1  | = | 2  |
| 0  0  1  |   | 1 |   |   1    |   | 1  |
```

Resultado: (7, 2), exatamente a resposta de aritmética simples, agora produzida por uma única multiplicação de matriz.

### Exemplo 2: rotacionando um ponto 90 graus

Ponto p = (1, 0). Rotacionar por 90 graus (cos 90 = 0, sin 90 = 1):

```text
| 0  -1  0 |   | 1 |   | 0*1 + (-1)*0 + 0*1 |   | 0 |
| 1   0  0 | * | 0 | = | 1*1 +   0*0  + 0*1 | = | 1 |
| 0   0  1 |   | 1 |   |         1          |   | 1 |
```

Resultado: (0, 1), o ponto no eixo x positivo corretamente rotacionado um quarto de volta ao eixo y positivo.

### Exemplo 3: a ordem importa, transladar-depois-rotacionar vs. rotacionar-depois-transladar

Comece com o ponto p = (1, 0). Transladar por (2, 0) primeiro, depois rotacionar 90 graus:

```text
Passo 1 (transladar): (1,0) -> (3, 0)
Passo 2 (rotacionar 90): (3,0) -> (0, 3)
```

Agora rotacionar 90 graus primeiro, depois transladar por (2, 0):

```text
Passo 1 (rotacionar 90):   (1,0) -> (0, 1)
Passo 2 (transladar):      (0,1) -> (2, 1)
```

Os dois resultados finais, (0, 3) e (2, 1), são diferentes. Isto não é um erro de computação; é a consequência direta e concreta da multiplicação de matriz não comutar, o exato fato do qual `3d-transformations-and-composing-the-model-matrix` depende quando insiste numa ordem específica (escala, depois rotação, depois translação) para construir uma model matrix.

## Equívocos Comuns e Armadilhas

- **"Coordenadas homogêneas são só um truque notacional sem efeito real."** Os Exemplos 1 a 3 mostram que a terceira coordenada genuinamente muda o que a multiplicação de matriz computa (é o que permite o offset aditivo de todo); descartá-la de volta para matrizes 2x2 simples torna a translação impossível de expressar como uma multiplicação de matriz de novo.
- **"Um vetor e um ponto com os mesmos valores (x, y) se comportam identicamente sob estas matrizes."** Eles não: um ponto usa coordenada homogênea 1 e é transladado; um vetor de direção usa coordenada homogênea 0 e não é, por design, já que uma direção (como uma normal de superfície ou uma velocidade) não deveria deslocar só porque o objeto ao qual pertence se moveu.
  ```text
  Transladando o ponto (1, 1, 1) por (5, 0): -> (6, 1, 1) (movido)
  Transladando o vetor (1, 1, 0) por (5, 0): -> (1, 1, 0) (inalterado, tx*0 = 0)
  ```
- **"Qualquer ordem de compor transformações dá o mesmo resultado visual."** A contradição numérica do Exemplo 3 (0, 3) versus (2, 1) é o caso geral, não um especial; a ordem correta para um efeito específico tem de ser escolhida deliberadamente, que é exatamente por que `3d-transformations-and-composing-the-model-matrix` enuncia uma convenção fixa em vez de deixá-la arbitrária.

## Resumo

Uma matriz linear sozinha não consegue mover um ponto sem também mover a origem, então a translação, a operação mais comum em gráficos, não é linear e não pode ser expressa por uma matriz 2x2 comum. As coordenadas homogêneas consertam isto preenchendo todo ponto 2D com uma terceira coordenada (1 para pontos, 0 para vetores de direção) e usando matrizes 3x3, deixando translação, rotação e escala todas virarem a mesma operação: uma única multiplicação de matriz. Porque a multiplicação de matriz é composição de funções mas não comuta, compor várias transformações produz uma matriz combinada cuja ordem genuinamente muda o resultado, o exato mecanismo que `3d-transformations-and-composing-the-model-matrix` estende a cenas 3D completas em seguida.

## Documentation Links

- [MIT 18.06: Linear Algebra (OCW course home, Gilbert Strang)](https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/): a fundação de álgebra linear, multiplicação e composição de matriz, sobre a qual este conceito constrói a extensão de coordenadas homogêneas.
- [Cornell CS4620: Introduction to Computer Graphics (course page, Fall 2025)](https://www.cs.cornell.edu/courses/cs4620/2025fa/): um curso universitário real e atual cuja unidade "Basic Geometry & Transformations" cobre coordenadas homogêneas como a ferramenta padrão para representar a translação como uma matriz.
