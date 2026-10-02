---
version: 1.0
updatedAt: 2026-09-07
title: Self-Attention, Paralelismo e Positional Encoding
summary: Aplicar atenção aos próprios tokens de uma sequência, todos de uma vez, remove a dependência estrita da esquerda para a direita que força uma rede recorrente a processar um passo de tempo por vez, já que a atenção de cada posição pode ser calculada em paralelo. Mas esse mesmo paralelismo joga fora completamente a ordem das palavras, a menos que ela seja reinjetada explicitamente, e é exatamente isso que o positional encoding faz.
---
## Objetivos de Aprendizagem

- Definir self-attention: aplicar atenção em que as queries, keys e values vêm todos da mesma sequência.
- Explicar com precisão por que a self-attention pode ser calculada em paralelo em todas as posições, enquanto a recorrência de uma RNN fundamentalmente não pode.
- Explicar por que o positional encoding é necessário especificamente para a self-attention e descrever como um positional encoding senoidal é construído.
- Explicar a multi-head attention como rodar várias computações de atenção independentes e combinar seus resultados.

## Contexto e Motivação

O conceito anterior definiu atenção de forma geral (uma query, comparada com um conjunto de keys, recuperando uma combinação ponderada de values) sem especificar de onde vêm essas queries, keys e values. A **self-attention** responde a essa pergunta do jeito específico que torna a atenção uma *arquitetura* alternativa genuína à recorrência, e não só um acréscimo a ela: cada posição de uma sequência gera a própria query, key e value, todos dessa mesma sequência, e presta atenção a todas as outras posições (incluindo a si mesma). Este conceito cobre exatamente por que essa escolha de projeto importa (o argumento do paralelismo, que é o motivo concreto e prático de arquiteturas baseadas em self-attention terem substituído as recorrentes na maior parte da modelagem de sequências em larga escala) e a única informação que a self-attention descarta e que precisa ser reintroduzida explicitamente: a própria ordem da sequência.

## Teoria Central

### Self-attention: queries, keys e values da mesma fonte

Para uma sequência de `n` vetores de entrada, a self-attention calcula queries, keys e values para *cada* posição usando as mesmas matrizes de projeção aprendidas (`Q = XW_q`, `K = XW_k`, `V = XW_v`, em que `X` empilha os `n` vetores de entrada como linhas) e depois aplica a scaled dot-product attention do conceito anterior entre cada query e cada key:

```text
SelfAttention(X) = softmax(XW_q · (XW_k)^T / √d) · XW_v
```

Cada posição de saída é uma combinação ponderada do value de cada posição de entrada, com os pesos determinados por quão bem a query daquela posição casa com a key de cada outra posição; incluindo, notavelmente, comparar uma posição consigo mesma.

### Por que isso paraleliza e a recorrência não

`recurrent-neural-networks-and-backpropagation-through-time` estabeleceu que calcular `h_t` exige que `h_{t-1}` já seja conhecido; os estados ocultos de uma RNN precisam ser calculados estritamente um passo de tempo após o outro, uma dependência genuinamente sequencial que não pode ser quebrada, por mais computação paralela que esteja disponível. A self-attention não tem essa dependência: calcular a saída de atenção da posição 5 não exige que a saída de atenção da posição 4 tenha sido calculada antes; a query, a key e o value de cada posição podem ser calculados de forma independente e simultânea, e a matriz `n × n` inteira de pontuações de atenção pode ser calculada em uma única grande multiplicação de matrizes. É precisamente o tipo de carga massivamente paralela, com operações uniformes, que `cnn-architectures-and-residual-connections` já ligou ao hardware de GPU; a self-attention expõe muito mais desse paralelismo do que uma recorrência jamais consegue, e esse é o motivo computacional concreto de arquiteturas baseadas em Transformer treinarem dramaticamente mais rápido no mesmo hardware, para sequências de comprimento comparável, do que uma RNN de tamanho equivalente.

### Positional encoding: reinjetando a ordem

A self-attention trata sua entrada como um *conjunto* não ordenado de vetores: nada no cálculo acima usa o índice de cada posição; trocar duas posições de entrada (e suas queries, keys e values correspondentes) apenas troca duas linhas da saída de forma simétrica, sem nenhuma outra mudança. Mas a ordem das palavras claramente importa na linguagem, e a posição importa em muitas outras tarefas de sequência. O **positional encoding** corrige isso somando ao embedding de entrada de cada posição um vetor que codifica diretamente o índice daquela posição, antes de qualquer self-attention ser aplicada. Uma construção comum usa senoides de frequências variadas:

```text
PE(pos, 2i)   = sin(pos / 10000^(2i/d))
PE(pos, 2i+1) = cos(pos / 10000^(2i/d))
```

para a posição `pos` e o índice de dimensão do embedding `i` (de um total de `d` dimensões). Dimensões diferentes oscilam em frequências diferentes, então o vetor resultante é único para cada posição (dentro do período da codificação) e, como seno e cosseno de uma soma podem ser expressos em termos de seno e cosseno dos ângulos individuais, ele codifica informação de posição *relativa* em uma forma que as camadas lineares da rede conseguem aprender a explorar, e não apenas um índice arbitrário.

### Multi-head attention: várias computações de atenção, combinadas

Em vez de calcular uma saída de atenção por posição, a **multi-head attention** roda várias computações de atenção independentes ("cabeças") em paralelo, cada uma com as próprias projeções aprendidas `W_q`, `W_k`, `W_v` (normalmente para uma dimensionalidade menor que a do modelo completo, de modo que a computação total continue comparável à de uma única atenção grande), depois concatena as saídas de todas as cabeças e passa o resultado por mais uma camada linear aprendida. Cada cabeça fica livre para aprender uma noção diferente de "relevância" (uma cabeça pode se especializar em acompanhar relações sintáticas de curto alcance, outra em relações semânticas de longo alcance), dando ao modelo várias perspectivas independentes sobre a mesma sequência, em vez de ficar limitado a uma única função de similaridade aprendida.

## Exemplos Resolvidos

### Exemplo 1: valores de positional encoding para duas posições próximas

Usando a fórmula senoidal com `d = 4` (então `i` varia em 0 e 1), compare a posição 0 e a posição 1:

```text
PE(0, 0) = sin(0 / 10000^0)     = sin(0) = 0.000
PE(0, 1) = cos(0 / 10000^0)     = cos(0) = 1.000
PE(0, 2) = sin(0 / 10000^0.5)   = sin(0) = 0.000
PE(0, 3) = cos(0 / 10000^0.5)   = cos(0) = 1.000
PE(0, :) = (0.000, 1.000, 0.000, 1.000)

PE(1, 0) = sin(1 / 10000^0)     = sin(1) ≈ 0.841
PE(1, 1) = cos(1 / 10000^0)     = cos(1) ≈ 0.540
PE(1, 2) = sin(1 / 10000^0.5)   = sin(0.01) ≈ 0.010
PE(1, 3) = cos(1 / 10000^0.5)   = cos(0.01) ≈ 1.000
PE(1, :) = (0.841, 0.540, 0.010, 1.000)
```

As duas posições produzem vetores claramente diferentes, com as dimensões de baixa frequência (índices 2 e 3) quase não mudando entre posições vizinhas, enquanto as de alta frequência (índices 0 e 1) mudam bastante; isso dá à codificação uma sensibilidade fina a posições próximas e uma estrutura mais grosseira, que muda mais devagar, para distinguir posições distantes, tudo dentro do mesmo vetor de tamanho fixo.

### Exemplo 2: computação paralela versus sequencial, contada diretamente

Para uma sequência de comprimento `n = 100`, calcular todos os estados ocultos de uma RNN exige 100 passos sequenciais: o passo 50 genuinamente não pode começar antes de o passo 49 terminar, não importa quantos processadores estejam disponíveis. Calcular a self-attention sobre a mesma sequência exige formar uma matriz `100 × 100` de pontuações entre pares (`Q·K^T`), uma única grande multiplicação de matrizes que uma GPU consegue calcular com seus muitos núcleos trabalhando ao mesmo tempo em entradas diferentes, sem dependência passo a passo entre elas. A computação total da RNN não é necessariamente maior, mas seu caminho crítico (o número mínimo de passos sequenciais que precisam acontecer um depois do outro) é exatamente `n`; o caminho crítico da self-attention é um número pequeno e constante de operações matriciais, qualquer que seja `n`; esse é o sentido preciso em que a self-attention paraleliza e a recorrência não.

## Equívocos Comuns e Armadilhas

- **"A self-attention faz estritamente menos computação total que uma RNN, e por isso é mais rápida."** O total de FLOPs da self-attention para uma sequência de comprimento `n` na verdade escala como `n²` (cada posição presta atenção a todas as outras), muitas vezes *mais* computação total que os `n` passos sequenciais de uma RNN; a vantagem de velocidade na prática vem inteiramente da paralelizabilidade (um caminho crítico curto), e não de fazer menos trabalho no total.
- **"O positional encoding é só um detalhe menor de implementação."** Sem ele, a self-attention genuinamente não consegue distinguir "o cachorro mordeu o homem" de "o homem mordeu o cachorro"; o mecanismo é fundamentalmente cego à ordem, e o positional encoding é a correção específica e necessária, e não um refinamento opcional.
- **"A multi-head attention usa a dimensionalidade completa do modelo em cada cabeça, então é proporcionalmente mais cara que a atenção de uma cabeça."** Cada cabeça normalmente opera em uma dimensionalidade reduzida (a dimensão do modelo dividida pelo número de cabeças), então a computação total somando todas as cabeças é comparável a uma única computação de atenção com dimensionalidade completa; várias cabeças são um jeito de reorganizar a mesma computação total em várias perspectivas independentes, e não simplesmente de multiplicar o custo.

## Resumo

A self-attention aplica atenção com a query, a key e o value de cada posição vindo todos da mesma sequência, permitindo que cada posição preste atenção a todas as outras em uma única grande computação matricial sem dependências; um contraste nítido com a recorrência do estado oculto de uma RNN, inerentemente sequencial, que não pode ser paralelizada entre passos de tempo. Esse paralelismo é o motivo concreto, no nível do hardware, de arquiteturas baseadas em self-attention treinarem mais rápido que RNNs de tamanho equivalente no mesmo hardware de GPU. Como a self-attention não tem noção embutida de ordem, o positional encoding precisa injetar explicitamente o índice de cada posição no seu embedding antes de a atenção ser aplicada; a multi-head attention roda várias computações de atenção independentes em paralelo e as combina, dando ao modelo várias noções simultâneas de relevância em vez de só uma.

## Documentation Links

- [Dive into Deep Learning: Self-Attention and Positional Encoding](https://d2l.ai/chapter_attention-mechanisms-and-transformers/index.html): a fórmula do positional encoding senoidal e o enquadramento paralelo versus sequencial que este conceito cobre diretamente.
- [CS231n: Course Schedule (Stanford, Spring 2026)](https://cs231n.stanford.edu/schedule.html): "Self-Attention, Transformers" listado ao lado de aplicações de vision transformers, confirmando o papel da self-attention como a ponte do próprio curso para arquiteturas modernas.
