---
version: 1.0
updatedAt: 2026-09-08
title: "Rasterização de Triângulos: Funções de Aresta e Coordenadas Baricêntricas"
summary: "O teste de função de aresta de Pineda de 1988 decide se um pixel se situa dentro de um triângulo com três avaliações lineares, uma por aresta, todas não negativas para um ponto interior dado um enrolamento consistente; os mesmos três valores, normalizados pela área fixa do triângulo, são exatamente as coordenadas baricêntricas do ponto, que interpolam qualquer atributo por vértice com um conjunto compartilhado de pesos."
---
## Objetivos de Aprendizagem

- Enunciar o teste de função de aresta de Pineda precisamente, e usá-lo para decidir se um pixel concreto se situa dentro de um triângulo concreto.
- Derivar coordenadas baricêntricas a partir dos mesmos três valores de função de aresta, e explicar por que elas somam 1 para qualquer ponto dentro do triângulo.
- Interpolar um atributo por vértice (cor, profundidade ou coordenada de textura) pelo interior de um triângulo usando pesos baricêntricos, com números reais.
- Explicar por que este teste por pixel é genuinamente embaraçosamente paralelo, e conectar isso diretamente ao modelo de execução SIMT de `gpu-architecture-and-the-simt-execution-model`.

## Contexto e Motivação

`the-projection-matrix-perspective-and-clipping` terminou o lado geométrico do pipeline: todo triângulo sobrevivente agora tem os seus três vértices num espaço de coordenadas pequeno e padronizado, pronto para se tornar pixels. Este conceito cobre o mecanismo real e concreto, primeiro publicado por Pineda em 1988, que responde "como é que uma GPU de fato desenha um triângulo": para um dado pixel, decidir se ele se situa dentro do triângulo usando três testes lineares simples, e, ao mesmo tempo, obter os pesos de interpolação exatos necessários para misturar os atributos dos três vértices daquele triângulo naquele pixel. `gpu-architecture-and-the-simt-execution-model` (`computer-architecture`) já estabeleceu que uma GPU executa muitas lanes independentes em passo de trava sob SIMT; este teste de aresta por pixel é exatamente o tipo de carga de trabalho sem ramificação e embaraçosamente paralela que esse modelo de execução existe para rodar.

## Teoria Central

### A função de aresta

Para um triângulo com vértices A, B e C (no espaço de tela, depois de a transformação de viewport mapear coordenadas NDC para coordenadas de pixel de fato), defina uma função de aresta para a aresta de A a B, avaliada num ponto P:

```text
edge_AB(P) = (Bx - Ax) * (Py - Ay) - (By - Ay) * (Px - Ax)
```

Esta é uma função linear das coordenadas de P; ela avalia para zero exatamente na linha que passa por A e B, positiva de um lado, e negativa do outro. O insight de Pineda é que a mesma fórmula fixa, avaliada uma vez por aresta, diz a um rasterizador tudo que ele precisa: se os vértices de um triângulo são listados numa ordem de enrolamento consistente (digamos, anti-horário), um ponto P está dentro do triângulo exatamente quando todos os três de edge_AB(P), edge_BC(P) e edge_CA(P) são não negativos (ou todos não positivos, para o enrolamento oposto), um teste de sinal simples e uniforme sem nenhum tratamento especial para o formato ou orientação do triângulo.

### Coordenadas baricêntricas

Os mesmos três valores de função de aresta, uma vez normalizados pela área (com sinal) total do triângulo, se tornam as coordenadas baricêntricas do ponto (alpha, beta, gamma), um peso por vértice, satisfazendo alpha + beta + gamma = 1 para qualquer ponto no plano do triângulo:

```text
alpha = edge_BC(P) / edge_BC(A)      [peso para o vértice A]
beta  = edge_CA(P) / edge_CA(B)      [peso para o vértice B]
gamma = edge_AB(P) / edge_AB(C)      [peso para o vértice C]
```

(Cada denominador é essa mesma função de aresta avaliada no próprio vértice oposto do triângulo, que é igual a duas vezes a área com sinal do triângulo e é o mesmo para todo ponto P, então é computado uma vez por triângulo.) As coordenadas baricêntricas são o exato mesmo teste de não-negativo-quando-dentro que as funções de aresta cruas, mais a habilidade de ponderar qualquer atributo por vértice: interpolated_value = alpha * value_A + beta * value_B + gamma * value_C, para cor, profundidade, coordenadas de textura ou uma normal de superfície, todos usando os três pesos idênticos.

### Por que isto é embaraçosamente paralelo

O teste de dentro/fora de todo pixel e a interpolação de atributo de todo pixel dependem só das próprias coordenadas de tela daquele pixel e dos três vértices fixos do triângulo; a computação de nenhum pixel depende do resultado de qualquer outro pixel. Este é precisamente o modelo de execução SIMT que `gpu-architecture-and-the-simt-execution-model` descreveu: milhares de lanes independentes, cada uma avaliando a fórmula de função de aresta idêntica contra coordenadas de entrada diferentes, sem nenhuma dependência de dados entre lanes e sem ramificação (o teste de sinal é o único condicional, e ele é o mesmo formato de condicional para toda lane), deixando os warps de uma GPU executarem este estágio a throughput extremamente alto.

## Exemplos Resolvidos

### Exemplo 1: testando se um pixel está dentro de um triângulo

Triângulo A = (0, 0), B = (4, 0), C = (0, 4) (espaço de tela, enrolamento anti-horário). Teste o pixel P = (1, 1):

```text
edge_AB(P) = (4-0)*(1-0) - (0-0)*(1-0) = 4*1 - 0*1 = 4
edge_BC(P) = (0-4)*(1-0) - (4-0)*(1-4) = -4*1 - 4*(-3) = -4 + 12 = 8
edge_CA(P) = (0-0)*(1-0) - (0-4)*(1-0) = 0 - (-4) = 4
```

Todos os três valores (4, 8, 4) são não negativos: P = (1, 1) está dentro do triângulo.

### Exemplo 2: testando um pixel fora do triângulo

O mesmo triângulo, teste o pixel P = (3, 3):

```text
edge_AB(P) = (4-0)*(3-0) - (0-0)*(3-0) = 12 - 0 = 12
edge_BC(P) = (0-4)*(3-0) - (4-0)*(3-4) = -12 - 4*(-1) = -12 + 4 = -8
edge_CA(P) = (0-0)*(3-0) - (0-4)*(3-0) = 0 - (-12) = 12
```

edge_BC(P) = -8 é negativo enquanto os outros dois são positivos: os sinais não são todos iguais, então P = (3, 3) está fora do triângulo (corretamente, já que (3,3) se situa além da hipotenusa de (4,0) a (0,4)).

### Exemplo 3: interpolando uma cor no pixel interior

O mesmo triângulo, P = (1, 1) do Exemplo 1. Duas vezes a área do triângulo (os denominadores fixos) são edge_BC(A) = 16, edge_CA(B) = 16, edge_AB(C) = 16 (um triângulo retângulo com catetos de comprimento 4, área 8, então duas vezes a área é 16). Pesos baricêntricos em P:

```text
alpha = edge_BC(P) / edge_BC(A) = 8 / 16 = 0.5
beta  = edge_CA(P) / edge_CA(B) = 4 / 16 = 0.25
gamma = edge_AB(P) / edge_AB(C) = 4 / 16 = 0.25
(verificar: 0.5 + 0.25 + 0.25 = 1.0)
```

Se o vértice A é vermelho puro (1,0,0), o vértice B é verde puro (0,1,0), e o vértice C é azul puro (0,0,1), a cor interpolada em P é:

```text
0.5*(1,0,0) + 0.25*(0,1,0) + 0.25*(0,0,1) = (0.5, 0.25, 0.25)
```

Uma cor suave e inclinada ao vermelho, corretamente ponderada em direção ao vértice A já que P fica mais perto de A do que de B ou C.

## Equívocos Comuns e Armadilhas

- **"A função de aresta só testa dentro-versus-fora; a interpolação precisa de um cálculo separado e não relacionado."** O Exemplo 3 reusa os exatos mesmos valores de função de aresta do teste interior do Exemplo 1, normalizados por uma constante por-triângulo fixa, para obter os pesos de interpolação; ambos os trabalhos vêm de um conjunto de três números.
- **"A rasterização tem de testar todo pixel na tela contra todo triângulo."** Rasterizadores reais limitam a busca à caixa delimitadora de espaço de tela de cada triângulo (o menor retângulo contendo A, B e C) em vez do framebuffer inteiro, e o hardware de GPU ainda mais ladrilha este trabalho; o próprio teste de função de aresta ainda é avaliado por pixel candidato, só que sobre um conjunto de candidatos muito menor do que a tela inteira.
- **"Um valor de função de aresta negativo sempre significa um erro."** Um valor negativo simplesmente significa que o ponto está no lado oposto daquela aresta do interior do triângulo, para um triângulo consistentemente enrolado; o único valor negativo entre três do Exemplo 2 é o sinal esperado e correto de que o ponto está fora, não um bug.

## Resumo

O teste de função de aresta de Pineda de 1988 decide se um pixel se situa dentro de um triângulo com três avaliações lineares, uma por aresta, todas não negativas para um ponto interior dado um enrolamento consistente; os mesmos três valores, normalizados pela área fixa do triângulo, são exatamente as coordenadas baricêntricas do ponto, que interpolam qualquer atributo por vértice, cor, profundidade, coordenadas de textura, com um conjunto compartilhado de pesos. Porque o teste de todo pixel depende só das próprias coordenadas daquele pixel e dos vértices fixos do triângulo, sem nenhuma dependência de dados entre pixels, esta é genuinamente a carga de trabalho embaraçosamente paralela e sem ramificação que o modelo de execução SIMT de `gpu-architecture-and-the-simt-execution-model` foi construído para rodar em escala. `z-buffering-and-visibility-determination`, em seguida, usa esta mesma interpolação baricêntrica para computar a profundidade de cada fragmento para o teste de visibilidade.

## Documentation Links

- [Pineda: A Parallel Algorithm for Polygon Rasterization (SIGGRAPH, 1988)](https://history.siggraph.org/learning/a-parallel-algorithm-for-polygon-rasterization-by-pineda/): o artigo fonte para o teste de função de aresta do qual este conceito constrói, incluindo a sua própria ênfase em avaliação por pixel paralela e amigável ao hardware.
- [NVIDIA CUDA Programming Guide: SIMT Execution and Warps](https://docs.nvidia.com/cuda/cuda-programming-guide/03-advanced/advanced-kernel-programming.html): o modelo de execução de hardware concreto, warps de threads em passo de trava, que torna este teste por pixel o encaixe natural para o hardware de rasterizador de GPU real.
