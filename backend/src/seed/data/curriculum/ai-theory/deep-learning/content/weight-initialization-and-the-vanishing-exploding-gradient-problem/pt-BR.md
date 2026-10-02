---
version: 1.0
updatedAt: 2026-09-07
title: Inicialização de Pesos e o Problema do Gradiente que Desaparece/Explode
summary: Por que uma rede profunda não pode simplesmente ser inicializada com pesos todos zero ou aleatórios arbitrários. O backpropagation multiplica as derivadas de muitas camadas, então um viés sistemático na escala dessas derivadas se compõe multiplicativamente com a profundidade, encolhendo os gradientes até perto de zero ou fazendo-os explodir; e por que esquemas calibrados, como as inicializações Xavier e He, existem especificamente para manter esse produto estável.
---
## Objetivos de Aprendizagem

- Explicar por que inicializar todos os pesos de uma rede com zero (ou com o mesmo valor) é um erro fatal, independentemente da profundidade.
- Explicar, quantitativamente, por que os gradientes de uma rede profunda podem encolher até perto de zero ou crescer sem limite conforme a profundidade aumenta, puramente como consequência da multiplicação repetida na regra da cadeia.
- Enunciar os esquemas de inicialização Xavier e He e explicar que propriedade do forward pass cada um foi projetado especificamente para preservar.
- Rastrear um pequeno exemplo numérico mostrando como um viés sistemático na escala do gradiente por camada se compõe multiplicativamente com a profundidade.

## Contexto e Motivação

O backpropagation, de dois conceitos atrás, calcula o gradiente de cada camada multiplicando uma cadeia de gradientes locais, um por camada entre o loss e aquele parâmetro. Este conceito faz a próxima pergunta óbvia: o que acontece com esse produto conforme o número de camadas cresce? A resposta não é neutra. Se cada gradiente local da cadeia for sistematicamente um pouco menor que 1, o produto encolhe para perto de zero exponencialmente com a profundidade; se cada um for sistematicamente um pouco maior que 1, o produto cresce sem limite. Esse é o **problema do gradiente que desaparece/explode**, e é uma consequência direta e inevitável da regra da cadeia aplicada repetidamente, e não um bug de alguma implementação específica.

A inicialização dos pesos é a primeira, e mais barata, defesa contra esse problema: escolher a *escala* (e não só evitar valores degenerados) dos pesos iniciais de uma rede para que o fator multiplicativo por camada dessa cadeia fique perto de 1 no início do treino.

## Teoria Central

### Por que a inicialização com tudo zero (ou tudo igual) falha de imediato

Se todos os pesos de uma camada forem inicializados exatamente com o mesmo valor (zero ou qualquer outro), cada unidade dessa camada calcula exatamente a mesma pré-ativação a partir da mesma entrada e, portanto, recebe exatamente o mesmo gradiente durante o backpropagation. Todas as unidades da camada se atualizam de forma idêntica, para sempre; a camada se comporta como se tivesse uma única unidade, não importa quantas recebeu. Essa falha não tem nada a ver com profundidade: ela acontece até com uma única camada oculta, e é por isso que toda rede desta disciplina é inicializada com pesos aleatórios independentes, quebrando essa simetria desde o primeiro passo.

### O gradiente que desaparece/explode, quantificado

Considere uma rede muito profunda em que o gradiente local de cada camada (o fator que o backpropagation multiplica naquela camada, combinando a escala da matriz de pesos e a derivada da função de ativação) tem alguma magnitude típica `c`. Depois de `L` camadas, o fator multiplicativo total acumulado na regra da cadeia é aproximadamente `c^L`. Se `c < 1` (mesmo, digamos, `c = 0.9`), então `c^L` encolhe para perto de zero exponencialmente rápido conforme `L` cresce: depois de 50 camadas, `0.9^50 ≈ 0.005`, e depois de 100 camadas, `0.9^100 ≈ 0.00003`; o gradiente que chega às primeiras camadas é desprezível, e essas camadas, na prática, param de aprender. Se `c > 1` (digamos `c = 1.1`), `c^L` cresce exponencialmente: `1.1^50 ≈ 117`, `1.1^100 ≈ 13.781`; e os gradientes (e muitas vezes as atualizações de pesos correspondentes) explodem para magnitudes numericamente inutilizáveis. Os dois modos de falha são consequências diretas e demonstráveis da multiplicação repetida, e não algo específico de uma arquitetura; é o motivo de o caso da "unidade morta" da ReLU do conceito anterior importar tanto quando há muitas camadas envolvidas: um único gradiente local sistematicamente zero em qualquer ponto da cadeia zera tudo a montante dele.

### Inicialização calibrada: Xavier e He

A correção mira `c` diretamente: escolher a variância dos pesos iniciais de modo que a variância das ativações (forward pass) e dos gradientes (backward pass) fique mais ou menos constante de uma camada para a outra, em vez de encolher ou crescer. Para uma camada com `n` entradas, a **inicialização Xavier/Glorot** (projetada para ativações sigmoid/tanh) tira cada peso de uma distribuição escalada por `1/√n`:

```text
w ~ Normal(0, 1/n)     (equivalentemente, amostre de uma normal padrão e divida por √n)
```

A **inicialização He** (projetada especificamente para a ReLU, que zera cerca de metade das suas entradas e por isso precisa de uma escala maior para compensar) escala por `√(2/n)`:

```text
w ~ Normal(0, 2/n)
```

Os dois esquemas servem exatamente ao mesmo propósito (manter o fator multiplicativo típico `c` entre camadas perto de 1 no início do treino), com a constante específica ajustada à função de ativação de fato usada.

## Exemplos Resolvidos

### Exemplo 1: compondo uma escala de gradiente sistemática ao longo da profundidade

Suponha que cada camada de uma rede de 20 camadas tenha um gradiente local de magnitude exatamente `0.8` (um valor plausível para unidades sigmoid saturadas longe de zero). O fator acumulado pelo backpropagation até a primeira camada é:

```text
0.8^20 = 0.0115...  (cerca de 1,15%)
```

Um gradiente de magnitude 1 chegando à camada de saída chega à primeira camada reduzido a cerca de 1,15% do tamanho original; na prática, muitas vezes pequeno o bastante para que os pesos da primeira camada quase não se mexam durante o treino, embora o loss que a rede tenta reduzir dependa deles tanto quanto dos pesos de qualquer outra camada.

### Exemplo 2: escolhendo a escala da inicialização He para uma camada concreta

Para uma camada densa com `n = 512` entradas alimentando unidades ReLU, a inicialização He tira os pesos de `Normal(0, 2/512) = Normal(0, 0.0039)`, ou seja, um desvio padrão de `√0.0039 ≈ 0.0625`. Compare com tirar ingenuamente de `Normal(0, 1)` (desvio padrão 1): uma pré-ativação `z = Σᵢ wᵢxᵢ` somada sobre 512 desses pesos grandes e não escalados teria uma variância cerca de 512 vezes maior que a pretendida, muito provavelmente empurrando muitas unidades para regiões extremas e mal condicionadas antes mesmo de o treino começar. Escalar por `√(2/n)` é precisamente a correção que mantém a variância da pré-ativação estável, não importa quantas entradas uma dada camada tenha.

## Equívocos Comuns e Armadilhas

- **"Inicializar os pesos com zero é seguro, já que o treino vai movê-los de qualquer jeito."** O exemplo mostra o contrário: a inicialização com zero (ou qualquer inicialização perfeitamente simétrica) faz cada unidade de uma camada receber um gradiente idêntico para sempre, desperdiçando permanentemente a capacidade da camada, por mais tempo que o treino rode.
- **"O problema do gradiente que desaparece é uma propriedade de uma função de ativação específica, e não um fenômeno geral."** Ele é uma consequência geral de a regra da cadeia multiplicar muitos gradientes locais; o Exemplo 1 não faz nenhuma suposição sobre qual função de ativação produziu o fator 0.8. Certas ativações (sigmoid, tanh) simplesmente tornam mais provável um fator `c < 1`, e é por isso que a ReLU virou o padrão e por isso que a inicialização He compensa especificamente o comportamento da própria ReLU.
- **"Um bom esquema de inicialização resolve completamente o problema do gradiente que desaparece/explode, em qualquer profundidade."** A inicialização só calibra o *ponto de partida* do treino; ela não garante que o fator multiplicativo fique perto de 1 conforme os pesos mudam durante o treino. `batch-normalization`, alguns conceitos adiante, e as conexões residuais (`cnn-architectures-and-residual-connections`) são técnicas adicionais e complementares justamente porque a inicialização sozinha nem sempre basta em profundidades muito grandes.

## Resumo

A inicialização de pesos com tudo zero ou perfeitamente simétrica é uma falha fatal e independente da profundidade (cada unidade de uma camada se atualiza de forma idêntica para sempre); o problema do gradiente que desaparece/explode depende da profundidade e surge porque a regra da cadeia do backpropagation multiplica um gradiente local por camada, então um fator sistemático por camada abaixo ou acima de 1 se compõe exponencialmente com a profundidade da rede. As inicializações Xavier e He tratam isso escalando a variância inicial dos pesos de cada camada para manter esse fator multiplicativo perto de 1 no início do treino, calibradas, respectivamente, para as funções de ativação sigmoid/tanh e ReLU; a primeira e mais barata linha de defesa entre as várias que esta disciplina cobre para treinar redes genuinamente profundas.

## Documentation Links

- [CS231n: Neural Networks Part 2: Weight Initialization](https://cs231n.github.io/neural-networks-2/): os esquemas de inicialização `1/√n` e He (`√(2/n)`) que este conceito deriva diretamente.
- [CS231n: Neural Networks Part 1: Setting up the Architecture](https://cs231n.github.io/neural-networks-1/): o contexto das funções de ativação (sigmoid/tanh vs. ReLU) que motiva por que os dois esquemas usam constantes diferentes.
