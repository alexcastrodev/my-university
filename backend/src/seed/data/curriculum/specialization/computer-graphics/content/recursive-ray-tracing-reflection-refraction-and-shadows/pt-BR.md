---
version: 1.0
updatedAt: 2026-09-08
title: "Ray Tracing Recursivo: Reflexão, Refração e Sombras"
summary: "Um raio primário sozinho só encontra a superfície visível mais próxima, o mesmo trabalho que o z-buffering já faz para a rasterização; o ray tracing recursivo adiciona raios de sombra (testando oclusão entre um ponto de acerto e cada luz), raios de reflexão (traçando recursivamente a direção de reflexão de espelho e misturando o resultado com o sombreamento local) e raios de refração (a mesma estrutura recursiva, seguindo uma direção computada da lei de Snell), todos limitados a uma profundidade de recursão finita para garantir terminação."
---
## Objetivos de Aprendizagem

- Explicar o que um único raio primário encontra (a superfície visível mais próxima) e por que isso sozinho não é o bastante para reflexões, refrações ou sombras precisas.
- Rastrear um raio de sombra de um ponto de acerto em direção a uma luz e determinar se esse ponto está genuinamente em sombra, com um oclusor concreto.
- Rastrear um raio de reflexão recursivamente e combinar a sua cor retornada com a refletividade de uma superfície, com números concretos.
- Enunciar, no nível da lei de Snell, o que um raio de refração computa diferente de um raio de reflexão, e por que o ray tracing trata ambos com a mesma estrutura recursiva.

## Contexto e Motivação

`bounding-volume-hierarchies-and-ray-tracing-acceleration` tornou rápido encontrar a interseção mais próxima de um raio; um único raio primário, uma vez que encontra essa superfície mais próxima, fez exatamente o mesmo trabalho que `z-buffering-and-visibility-determination` já fez para a rasterização, identificar a superfície visível mais próxima num pixel. O que o ray tracing consegue fazer que a rasterização não consegue fazer naturalmente é recursar: de um ponto de acerto, lançar mais raios, em direção a luzes para testar sombras, e para fora da própria superfície para computar reflexões e refrações, cada um aproximando mais um passo da integral de transporte de luz que `the-rendering-equation-and-the-limits-of-real-time-shading` enunciou mas a rasterização de tempo real truncou depois do primeiro ricochete. Este conceito constrói essa estrutura recursiva.

## Teoria Central

### Raios de sombra

Uma vez que um raio primário encontra um ponto de acerto, decidir corretamente se esse ponto está iluminado exige saber se algo bloqueia a linha reta entre ele e cada fonte de luz. Um raio de sombra é lançado do ponto de acerto em direção à luz; se esse raio intersecta qualquer outro objeto antes de alcançar a luz, o ponto está em sombra em relação àquela luz (a sua contribuição difusa e especular daquela luz são ambas zero, pela própria lógica de `local-illumination-lambertian-diffuse-reflection`, já que nenhuma luz daquela fonte de fato alcança o ponto); se o raio de sombra alcança a luz desobstruído, o ponto é iluminado normalmente. Isto produz sombras nítidas e geometricamente precisas diretamente da mesma maquinaria de interseção raio-objeto que `ray-casting-generating-and-intersecting-rays` já construiu, sem nenhum algoritmo de sombra separado necessário.

### Raios de reflexão

Numa superfície reflexiva, um raio de reflexão é lançado do ponto de acerto na direção de reflexão de espelho (a mesma fórmula de vetor de reflexão que `specular-reflection-the-phong-and-blinn-phong-models` usou para o destaque de Phong, R = 2(N.L)N - L, aqui aplicada à direção de visão incidente em vez de a uma direção de luz), e esse raio é traçado recursivamente, exatamente como um raio primário, encontrando o seu próprio acerto mais próximo e computando o seu próprio sombreamento completo, incluindo os seus próprios raios adicionais de sombra, reflexão e refração se essa superfície também for reflexiva ou refrativa. A cor final no ponto de acerto original mistura o seu próprio sombreamento local (difuso mais especular, das luzes diretas de fato visíveis via raios de sombra) com a cor de reflexão traçada recursivamente, ponderada pela própria refletividade da superfície.

### Raios de refração e a lei de Snell

Uma superfície transparente e refrativa (vidro, água) curva um raio passando por ela em vez de ricocheteá-lo de volta, governada pela lei de Snell: n1 * sin(theta1) = n2 * sin(theta2), onde n1 e n2 são os índices de refração dos dois materiais (aproximadamente 1.0 para ar, aproximadamente 1.5 para vidro comum) e theta1, theta2 são os ângulos de incidência e refração medidos a partir da normal da superfície. Um raio de refração é traçado com a mesma estrutura recursiva de um raio de reflexão, só que numa direção diferente, computada da lei de Snell em vez da fórmula de reflexão de espelho, e um objeto totalmente transparente tipicamente produz tanto um raio de reflexão (alguma luz sempre ricocheteia de uma superfície transparente também, um efeito físico real) quanto um raio de refração, misturados juntos.

### Profundidade de recursão

Já que um raio de reflexão ou refração pode ele mesmo atingir outra superfície reflexiva ou refrativa, este processo é naturalmente recursivo, e um renderizador real tem de limitar a profundidade de recursão (um número máximo de ricochetes, comumente em algum lugar entre 4 e 50 dependendo da cena e da qualidade desejada) para garantir terminação, já que dois espelhos de frente um para o outro, por exemplo, de outra forma ricocheteariam um raio para trás e para frente indefinidamente.

## Exemplos Resolvidos

### Exemplo 1: um raio de sombra encontra um oclusor

Ponto de acerto P = (0, 0, -4) (na esfera do Exemplo 1 de `ray-casting-generating-and-intersecting-rays`), luz em L_pos = (0, 10, -4) (diretamente acima de P). Direção do raio de sombra: normalize(L_pos - P) = normalize(0, 10, 0) = (0, 1, 0). Suponha que um segundo objeto opaco (uma placa fina) fica em y = 5, diretamente entre P e a luz, e o teste de interseção do raio de sombra contra essa placa retorna um acerto em t = 5, bem antes de alcançar a luz em t = 10:

```text
O raio de sombra atinge um oclusor em t=5, a luz está em t=10 (o oclusor está
  mais próximo): P está em sombra em relação a esta luz.
Contribuição difusa e especular desta luz em P: ambas 0,
  independentemente da própria normal de P ou da própria direção da luz, pela
  própria lógica de local-illumination-lambertian-diffuse-reflection.
```

### Exemplo 2: um raio de reflexão, combinado com o sombreamento local

Ponto de acerto P numa superfície parcialmente reflexiva, refletividade = 0.3 (30% reflexiva, 70% sombreamento local comum). O sombreamento local (difuso mais especular, de quaisquer luzes desobstruídas, pela lógica do Exemplo 1) computa local_color = (0.6, 0.2, 0.2). Um raio de reflexão lançado de P, traçado recursivamente, encontra um objeto azul próximo e retorna reflected_color = (0.1, 0.1, 0.8):

```text
final_color = (1 - refletividade) * local_color + refletividade * reflected_color
final_color = 0.7*(0.6,0.2,0.2) + 0.3*(0.1,0.1,0.8)
            = (0.42,0.14,0.14) + (0.03,0.03,0.24)
            = (0.45, 0.17, 0.38)
```

A cor final mostra majoritariamente o próprio sombreamento local avermelhado da superfície, com um tom visível e corretamente ponderado de azul do objeto refletido, exatamente o efeito visual que uma superfície parcialmente reflexiva deveria mostrar.

### Exemplo 3: ângulo de refração da lei de Snell, ar para vidro

Um raio viajando no ar (n1 = 1.0) atinge uma superfície de vidro (n2 = 1.5) num ângulo de incidência theta1 = 30 graus (sin 30 = 0.5):

```text
n1 * sin(theta1) = n2 * sin(theta2)
1.0 * 0.5 = 1.5 * sin(theta2)
sin(theta2) = 0.5 / 1.5 = 0.333
theta2 = arcsin(0.333) =~ 19.5 graus
```

O raio se curva em direção à normal (19.5 graus é menor do que o ângulo de incidência de 30 graus), a direção correta e fisicamente esperada quando a luz passa para um meio mais denso (índice de refração mais alto); o raio de refração é então lançado nesta nova direção curvada e traçado recursivamente exatamente como um raio de reflexão, só que seguindo uma direção diferente, derivada da lei de Snell.

## Equívocos Comuns e Armadilhas

- **"Um raio de sombra precisa encontrar o oclusor mais próximo exato, como um raio primário faz."** Um raio de sombra só precisa saber se algum oclusor existe entre o ponto de acerto e a luz, não qual é o mais próximo ou quão longe está; muitas implementações deliberadamente param no primeiro acerto encontrado, em qualquer ordem, uma otimização real e padrão indisponível a raios primários, que têm de encontrar o acerto mais próximo específico para sombrear a superfície visível correta.
- **"A recursão para reflexões tem de rodar até terminar naturalmente por conta própria."** Dois espelhos de frente um para o outro recursariam indefinidamente sem um limite de profundidade explícito; todo renderizador prático impõe uma profundidade de recursão máxima, um limite de engenharia deliberado e necessário, não um sinal de que a abordagem recursiva é falha.
- **"Reflexão e refração são dois algoritmos não relacionados."** O Exemplo 2 e o Exemplo 3 usam a estrutura recursiva idêntica, lançar um raio secundário do ponto de acerto, traçá-lo recursivamente, misturar a sua cor retornada com o sombreamento local, diferindo só em como a direção do raio secundário é computada (a fórmula de reflexão de espelho versus a lei de Snell); a própria recursão é o mesmo mecanismo de qualquer forma.

## Resumo

Um raio primário sozinho só encontra a superfície visível mais próxima, o mesmo trabalho que o z-buffering já faz para a rasterização; o ray tracing recursivo adiciona raios de sombra (testando oclusão entre um ponto de acerto e cada luz, produzindo sombras nítidas e geometricamente precisas sem nenhum algoritmo separado), raios de reflexão (traçando recursivamente a direção de reflexão de espelho e misturando o resultado com o sombreamento local pela refletividade da superfície) e raios de refração (a mesma estrutura recursiva, seguindo uma direção computada da lei de Snell em vez disso), todos limitados a uma profundidade de recursão finita para garantir terminação. `rasterization-vs-ray-tracing-tradeoffs-and-real-time-hardware`, em seguida, enuncia honestamente o que esta capacidade recursiva custa em relação à rasterização, e o que mudou recentemente para torná-la viável em tempo real.

## Documentation Links

- [Shirley, Black, and Hollasch: Ray Tracing in One Weekend](https://raytracing.github.io/books/RayTracingInOneWeekend.html): o livro livremente disponível cujo tratamento de materiais difusos, metálicos (reflexivos) e dielétricos (refrativos) a estrutura de reflexão e refração recursiva deste conceito segue.
- [Kajiya: The Rendering Equation (SIGGRAPH, 1986) : history via SIGGRAPH](https://history.siggraph.org/learning/the-rendering-equation-by-kajiya/): citado de novo aqui para tornar explícito que cada ricochete recursivo que este conceito adiciona aproxima mais um termo da mesma integral de transporte de luz que a rasterização de tempo real trunca depois do primeiro.
