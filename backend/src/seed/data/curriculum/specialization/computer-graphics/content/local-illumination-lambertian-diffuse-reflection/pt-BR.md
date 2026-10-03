---
version: 1.0
updatedAt: 2026-09-08
title: "Iluminação Local: Reflexão Difusa Lambertiana"
summary: "A reflexão difusa lambertiana modela a cor de uma superfície perfeitamente fosca como proporcional ao cosseno do ângulo entre a sua normal e a direção à luz, computado como uma única multiplicação escalar entre dois vetores unitários, multiplicado pelo albedo da superfície e pela cor e intensidade da luz, e limitado a zero sempre que esse produto escalar é negativo (a luz está atrás da superfície daquele ponto)."
---
## Objetivos de Aprendizagem

- Enunciar a lei do cosseno de Lambert: a intensidade de luz refletida de uma superfície perfeitamente fosca é proporcional ao cosseno do ângulo entre a normal da superfície e a direção à luz.
- Computar esse cosseno como um único produto escalar entre dois vetores unitários, e computar uma cor difusa concreta a partir de uma direção de luz, uma normal de superfície e um albedo de superfície.
- Explicar por que um produto escalar negativo tem de ser limitado a zero, e que geometria de superfície esse valor negativo representa fisicamente.
- Explicar, precisamente, por que todo modelo de sombreamento posterior nesta disciplina é a reflexão difusa mais um termo adicional, nunca uma substituição dela.

## Contexto e Motivação

`z-buffering-and-visibility-determination` decidiu qual fragmento é visível em cada pixel; este conceito inicia o trabalho separado de decidir que cor esse fragmento de fato é. A resposta mais simples e fisicamente motivada, e a que todo curso de gráficos, incluindo o CS4620 de Cornell, ensina primeiro, é a reflexão difusa lambertiana: a cor que uma superfície perfeitamente fosca (giz, madeira não acabada, a maioria dos tecidos) mostra sob uma luz, que depende só do ângulo entre a superfície e a luz, não de onde o observador está parado. Este é deliberadamente o modelo de iluminação real menos sofisticado da disciplina, escolhido primeiro porque todo modelo mais avançado que esta disciplina cobre adiciona um termo em cima dele em vez de descartá-lo.

## Teoria Central

### A lei do cosseno de Lambert

Uma superfície perfeitamente difusa (lambertiana) espalha a luz incidente igualmente em toda direção de saída, então a quantidade de luz refletida em direção a qualquer observador depende só de quanta luz a superfície de fato recebe, que ela mesma depende do ângulo em que a luz a atinge: luz atingindo uma superfície de frente entrega mais energia por unidade de área de superfície do que a mesma luz atingindo num ângulo rasante, exatamente o fato geométrico por trás de por que o sol do meio-dia parece mais forte do que um sol baixo da tarde atingindo o chão num ângulo raso. A lei de Lambert enuncia isto precisamente: a intensidade refletida é proporcional a cos(theta), onde theta é o ângulo entre a normal da superfície (um vetor unitário apontando para fora da superfície) e a direção à fonte de luz (também um vetor unitário).

### Computando o cosseno como um produto escalar

Para dois vetores unitários, o produto escalar é igual ao cosseno do ângulo entre eles diretamente: N . L = cos(theta), onde N é a normal da superfície e L é o vetor unitário apontando do ponto da superfície em direção à luz. Isto significa que a lei de Lambert não precisa de nenhuma função trigonométrica de todo no tempo de render, só um produto escalar por fragmento (três multiplicações e duas adições), avaliado pelos milhões de lanes paralelas que `gpu-architecture-and-the-simt-execution-model` já descreveu, uma vez por fragmento, por luz.

A cor difusa final multiplica este termo de cosseno pelo próprio albedo da superfície (a sua cor base, quanto de cada canal de cor ela reflete) e pela própria cor e intensidade da luz:

```text
diffuse_color = albedo * light_color * light_intensity * max(0, N . L)
```

### Limitando a zero

Quando N . L é negativo, o ângulo entre a normal e a direção da luz excede 90 graus, significando que a luz está atrás da superfície como vista daquele ponto (a superfície está totalmente voltada para longe da luz). Fisicamente, nenhuma luz alcança aquele lado da superfície daquela luz, então a contribuição difusa tem de ser zero, não uma cor negativa; o limite max(0, ...) na fórmula acima não é uma conveniência numérica, ele codifica este fato físico diretamente.

## Exemplos Resolvidos

### Exemplo 1: luz diretamente acima de uma superfície plana

Normal da superfície N = (0, 0, 1) (apontando reto para cima, digamos que a superfície é um chão plano). Direção da luz L = (0, 0, 1) (a luz está diretamente acima). Albedo (0.8, 0.2, 0.2) (uma superfície vermelha suave), cor e intensidade da luz ambas 1 (uma luz branca simples a toda força):

```text
N . L = (0)(0) + (0)(0) + (1)(1) = 1
diffuse_color = (0.8, 0.2, 0.2) * 1 * 1 * max(0, 1) = (0.8, 0.2, 0.2)
```

A superfície mostra a sua cor de albedo completa e não modificada, exatamente como esperado quando a luz a atinge de frente.

### Exemplo 2: luz num ângulo de 45 graus

A mesma superfície e albedo, mas a luz agora vem de L = (0.707, 0, 0.707) (um vetor unitário a 45 graus da normal; note 0.707 ao quadrado vezes 2 é igual a 1, confirmando que é um vetor unitário):

```text
N . L = (0)(0.707) + (0)(0) + (1)(0.707) = 0.707
diffuse_color = (0.8, 0.2, 0.2) * 1 * 1 * 0.707 = (0.566, 0.141, 0.141)
```

A superfície está visivelmente mais fraca do que no Exemplo 1, cerca de 70,7% tão brilhante, exatamente cos(45 graus), mesmo que a própria intensidade da luz não tenha mudado; só o ângulo mudou.

### Exemplo 3: luz atrás da superfície, limitada a zero

A mesma superfície, mas a luz agora fica abaixo do chão, em L = (0, 0, -1) (fisicamente impossível para um chão iluminado de cima, mas um caso comum para uma face de um objeto de múltiplos lados voltada para longe de uma luz):

```text
N . L = (0)(0) + (0)(0) + (1)(-1) = -1
diffuse_color = (0.8, 0.2, 0.2) * 1 * 1 * max(0, -1) = (0.8, 0.2, 0.2) * 0 = (0, 0, 0)
```

A superfície não recebe nenhuma luz difusa de todo desta fonte, corretamente renderizada como preta (desta luz; uma luz separada ou um termo ambiente, se presente, ainda poderiam contribuir).

## Equívocos Comuns e Armadilhas

- **"O sombreamento difuso depende de onde a câmera está parada."** Ele deliberadamente não depende: a lei de Lambert usa só a normal da superfície e a direção da luz, nunca a direção de visão, que é exatamente por que a mesma superfície fosca parece igualmente brilhante de qualquer ângulo de visão sob uma luz fixa, uma propriedade real e fisicamente motivada de materiais perfeitamente difusos, e a propriedade sobre a qual `specular-reflection-the-phong-and-blinn-phong-models`, em seguida, adiciona um termo genuinamente dependente da visão.
- **"Um N . L negativo significa um erro na normal ou no vetor da luz."** O Exemplo 3 mostra que este é o sinal esperado e correto de que a luz está no lado oposto da superfície daquele ponto; limitá-lo a zero é a resposta física correta, não um conserto de bug.
- **"Dobrar a distância da luz deveria ser tratado dentro desta fórmula de cosseno."** A própria lei de Lambert só governa a queda angular; a intensidade de uma luz também cai com a distância (tipicamente como um termo de inverso-do-quadrado, um fator multiplicativo separado que o termo `light_intensity` deste conceito substitui), um efeito físico distinto que este conceito não deriva em detalhe, já que o termo angular é o que todo conceito de sombreamento posterior nesta disciplina constrói diretamente.

## Resumo

A reflexão difusa lambertiana modela a cor de uma superfície perfeitamente fosca como proporcional ao cosseno do ângulo entre a sua normal e a direção à luz, computado como um único produto escalar entre dois vetores unitários, multiplicado pelo albedo da superfície e pela cor e intensidade da luz, e limitado a zero sempre que esse produto escalar é negativo (a luz está atrás da superfície daquele ponto). Este é deliberadamente o termo de iluminação real mais simples da disciplina: `specular-reflection-the-phong-and-blinn-phong-models`, em seguida, adiciona um termo de destaque dependente da visão em cima exatamente deste termo difuso, nunca substituindo-o.

## Documentation Links

- [Cornell CS4620: Introduction to Computer Graphics (course page, Fall 2025)](https://www.cs.cornell.edu/courses/cs4620/2025fa/): um curso universitário real e atual cuja unidade "Rendering" cobre a reflexão difusa lambertiana como o termo de iluminação local fundamental que este conceito constrói.
