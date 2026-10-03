---
version: 1.0
updatedAt: 2026-09-08
title: "Ray Casting: Gerando e Intersectando Raios"
summary: "O ray tracing trabalha de trás para frente a partir de cada pixel: um raio é gerado da câmera por esse pixel usando a equação do raio P(t) = origin + t * direction, e encontrar o que ele atinge se reduz a resolver um teste de interseção por objeto, trabalhado aqui por completo para uma esfera como uma equação quadrática em t cujo discriminante classifica o raio como errando, tangente a, ou passando pelo objeto, mantendo a menor raiz positiva como o ponto de acerto visível."
---
## Objetivos de Aprendizagem

- Explicar a reversão central que o ray tracing faz em relação à rasterização: trabalhar de trás para frente a partir de cada pixel para dentro da cena, em vez de empurrar triângulos para frente por um pipeline.
- Escrever a equação do raio, e gerar um raio de câmera concreto para um dado pixel, reusando a geometria de espaço de câmera que `the-view-matrix-and-camera-space` já construiu.
- Derivar e resolver a equação quadrática de interseção raio-esfera para um raio e esfera concretos, e interpretar cada um dos seus desfechos possíveis (nenhuma raiz, uma raiz, duas raízes).
- Enunciar, num alto nível, o que muda para a interseção raio-triângulo em vez de raio-esfera, sem uma derivação completa.

## Contexto e Motivação

`the-rendering-equation-and-the-limits-of-real-time-shading` nomeou o limite honesto do pipeline de rasterização construído por toda esta disciplina até agora: o sombreamento de tempo real só considera luz direta de uma pequena lista fixa de fontes nomeadas. O ray tracing toma uma abordagem estruturalmente diferente para renderizar o mesmo tipo de cena, uma que naturalmente suporta os ricochetes recursivos que conceitos posteriores adicionam: em vez de empurrar todo triângulo por um pipeline compartilhado de transformar-depois-rasterizar-depois-sombrear, um ray tracer trabalha de trás para frente, um raio por pixel, perguntando "o que a câmera de fato vê por este exato pixel". Este conceito constrói o algoritmo mínimo e real, geração de raio mais interseção raio-esfera, do qual todo ray tracer, de um renderizador hobbista de fim de semana a um renderizador de filme de produção, começa, seguindo o livremente disponível Ray Tracing in One Weekend de Shirley, Black e Hollasch.

## Teoria Central

### A equação do raio e gerar um raio de câmera

Um raio é uma semirreta começando num ponto de origem e estendendo-se numa direção fixa: P(t) = origin + t * direction, para t >= 0, onde direction é tipicamente um vetor unitário e t é uma distância escalar ao longo do raio. Para renderização, um raio é gerado por pixel, começando na própria posição da câmera (a mesma posição que `the-view-matrix-and-camera-space` colocou no espaço de mundo) e apontando pela localização daquele pixel num plano de imagem imaginário a uma distância fixa na frente da câmera; um pixel mais perto do centro do plano de imagem produz um raio apontando quase reto para frente, enquanto um pixel perto de uma borda produz um raio angulado para fora, reproduzindo exatamente o mesmo efeito de campo de visão que o frustum de `the-projection-matrix-perspective-and-clipping` já definiu, só que computado traçando raios para fora da câmera em vez de projetar geometria para dentro em direção a ela.

### Interseção raio-esfera

Dado um raio P(t) = O + tD (origem O, direção D) e uma esfera com centro C e raio r, um ponto no raio se situa na superfície da esfera exatamente quando a distância ao quadrado daquele ponto a C é igual a r ao quadrado: |P(t) - C|^2 = r^2. Substituir a equação do raio e expandir produz uma equação quadrática padrão em t:

```text
a*t^2 + b*t + c = 0, onde:
a = D . D
b = 2 * D . (O - C)
c = (O - C) . (O - C) - r^2
```

O discriminante, b^2 - 4ac, decide o desfecho: negativo significa que o raio erra a esfera inteiramente (nenhuma raiz real); zero significa que o raio é exatamente tangente (uma raiz repetida); positivo significa que o raio passa pela esfera, entrando na raiz menor e saindo na maior, e um renderizador mantém a menor raiz positiva (a primeira superfície que o raio de fato atinge, já que um acerto atrás da câmera, t < 0, não conta).

### Interseção raio-triângulo, num alto nível

Renderizar uma cena arbitrária precisa de interseção raio-triângulo além de raio-esfera, já que a maioria da geometria real é malhas de triângulos, não esferas. A estrutura do problema é a mesma em espírito, expressar o raio parametricamente e resolver para onde ele satisfaz a própria equação de plano do triângulo, depois checar que o ponto resultante de fato cai dentro do triângulo, que é exatamente o mesmo problema de teste-interior que `triangle-rasterization-edge-functions-and-barycentric-coordinates` já resolveu com funções de aresta e coordenadas baricêntricas, só que aplicado em 3D a um ponto de interseção raio-plano em vez de em 2D a um pixel de espaço de tela. Este conceito não deriva a fórmula raio-triângulo completa em detalhe, mantendo a derivação totalmente trabalhada no caso de esfera mais simples e ainda completamente geral.

## Exemplos Resolvidos

### Exemplo 1: um raio que atinge uma esfera, duas raízes reais

Origem do raio O = (0, 0, 0) (a câmera), direção D = (0, 0, -1) (olhando reto para baixo em -Z, um vetor unitário). Centro da esfera C = (0, 0, -5), raio r = 1.

```text
a = D.D = 0+0+1 = 1
b = 2*D.(O-C) = 2*(0,0,-1).(0,0,5) = 2*(-5) = -10
c = (O-C).(O-C) - r^2 = (0,0,5).(0,0,5) - 1 = 25 - 1 = 24

discriminante = b^2 - 4ac = 100 - 4*1*24 = 100 - 96 = 4 (positivo: 2 raízes)
t = (-b +/- sqrt(4)) / (2a) = (10 +/- 2) / 2 = 6 ou 4
```

A menor raiz positiva, t = 4, é a primeira superfície atingida: P(4) = (0,0,0) + 4*(0,0,-1) = (0, 0, -4), o ponto no lado próximo da esfera (consistente com uma esfera centrada em z=-5 com raio 1, cujo ponto de superfície próximo ao longo deste raio está em z = -5 + 1 = -4).

### Exemplo 2: um raio que erra a esfera inteiramente

A mesma esfera, origem do raio O = (2, 0, 0), a mesma direção D = (0, 0, -1) (um raio paralelo, deslocado 2 unidades para o lado):

```text
a = 1
b = 2*(0,0,-1).(2,0,5) = 2*(-5) = -10
c = (2,0,5).(2,0,5) - 1 = (4+0+25) - 1 = 28

discriminante = 100 - 4*1*28 = 100 - 112 = -12 (negativo: nenhuma raiz real)
```

Um discriminante negativo confirma que o raio, deslocado 2 unidades do centro da esfera enquanto o raio da esfera é só 1, erra a esfera inteiramente, exatamente como esperado geometricamente.

### Exemplo 3: um raio tangente à esfera, uma raiz repetida

Origem do raio O = (1, 0, 0), a mesma direção D = (0, 0, -1) (deslocado exatamente 1 unidade, correspondendo ao raio da esfera):

```text
a = 1
b = 2*(0,0,-1).(1,0,5) = 2*(-5) = -10
c = (1,0,5).(1,0,5) - 1 = (1+0+25) - 1 = 25

discriminante = 100 - 4*1*25 = 100 - 100 = 0 (exatamente zero: tangente)
t = -b / (2a) = 10 / 2 = 5
```

Um discriminante de exatamente zero confirma que o raio apenas roça a superfície da esfera num único ponto, P(5) = (1, 0, -5), o ponto na esfera diretamente de frente para este raio deslocado, consistente com o raio passando exatamente 1 unidade (o raio) do centro da esfera.

## Equívocos Comuns e Armadilhas

- **"Um ray tracer precisa de uma noção fundamentalmente diferente de câmera do que um rasterizador."** Os raios de câmera são gerados da posição e orientação de câmera idênticas que `the-view-matrix-and-camera-space` já computou; o ray tracing muda o que acontece depois de um raio deixar a câmera (intersectar a geometria de cena diretamente, em vez de projetar a geometria em direção à câmera), não como a própria câmera é definida.
- **"Um discriminante negativo é um erro de computação a consertar."** O Exemplo 2 mostra que um discriminante negativo corretamente e honestamente reporta um fato geométrico, este raio particular não atinge esta esfera particular, exatamente o desfecho de que um ray tracer precisa para todo raio que voa além de um objeto para o espaço vazio ou em direção a um objeto diferente inteiramente.
- **"Qualquer raiz positiva serve igualmente bem como 'o' ponto de interseção."** As duas raízes positivas do Exemplo 1 (4 e 6) são os pontos de entrada e saída do raio pela esfera; um renderizador tem de tomar a menor especificamente, já que esse é o primeiro ponto de superfície visível do lado da câmera, usar a raiz maior renderizaria incorretamente a superfície interior distante e oculta da esfera em vez disso.

## Resumo

O ray tracing trabalha de trás para frente a partir de cada pixel: um raio é gerado da câmera por esse pixel usando a equação do raio P(t) = origin + t * direction, e encontrar o que ele atinge se reduz a resolver um teste de interseção por objeto, trabalhado aqui por completo para uma esfera como uma equação quadrática em t cujo discriminante classifica o raio como errando, tangente a, ou passando pelo objeto, mantendo a menor raiz positiva como o ponto de acerto visível. A interseção raio-triângulo segue o mesmo formato de problema contra geometria de malha real, reusando o mesmo teste interior-de-triângulo que `triangle-rasterization-edge-functions-and-barycentric-coordinates` já construiu. `bounding-volume-hierarchies-and-ray-tracing-acceleration`, em seguida, cobre o conserto real e necessário para testar todo raio contra todo objeto numa cena de qualquer tamanho realista.

## Documentation Links

- [Shirley, Black, and Hollasch: Ray Tracing in One Weekend](https://raytracing.github.io/books/RayTracingInOneWeekend.html): o livro livremente disponível que a equação do raio e a derivação de interseção raio-esfera deste conceito seguem diretamente, a introdução canônica voltada ao profissional ao ray tracing citada por entre cursos universitários.
