---
version: 1.0
updatedAt: 2026-09-07
title: Arquiteturas de CNN e Conexões Residuais
summary: Como empilhar blocos de convolução/pooling evoluiu do LeNet para o AlexNet, o VGG e o ResNet, e por que simplesmente empilhar mais camadas acabou piorando a acurácia até que as conexões residuais (skip connections) deixassem uma camada aprender uma correção sobre sua entrada, em vez de uma representação inteiramente nova, combatendo diretamente o problema do gradiente que desaparece em redes muito profundas. Também explica por que a operação central de toda esta disciplina, a multiplicação de matrizes, é exatamente o tipo de carga massivamente paralela em dados para a qual as GPUs foram construídas.
---
## Objetivos de Aprendizagem

- Rastrear a tendência arquitetural geral do LeNet ao AlexNet e ao VGG: empilhar mais blocos de convolução/pooling e ir mais fundo.
- Explicar o "problema de degradação" empírico que apareceu quando as redes ficaram muito profundas, e por que ele é diferente de overfitting.
- Enunciar a ideia da conexão residual (skip connection) e explicar, em termos de backpropagation, por que ela trata diretamente o problema do gradiente que desaparece em redes muito profundas.
- Explicar por que as multiplicações de matrizes e convoluções em que toda esta disciplina se apoia combinam naturalmente com hardware de GPU, ligando-se à cobertura de SIMD e SIMT de `computer/computer-architecture`.

## Contexto e Motivação

Cada bloco convolucional visto até aqui (convolução, pooling, stride, padding, compartilhamento de pesos) é uma única camada. Este conceito monta esses blocos em arquiteturas completas e reais e segue uma progressão histórica e técnica genuína: conforme as CNNs ficaram mais profundas, elas ficaram dramaticamente mais precisas, até que a própria profundidade começou a prejudicar ativamente a acurácia, por motivos que se revelaram ser exatamente o problema do gradiente que desaparece já diagnosticado vários conceitos atrás, agora aparecendo na sua forma mais aguda e com mais consequências. As conexões residuais são a correção arquitetural, e são fundamentais o bastante para que a mesma ideia de skip connection reapareça, praticamente sem mudança, dentro da arquitetura Transformer vista mais adiante nesta disciplina.

## Teoria Central

### Do LeNet ao VGG: empilhando mais fundo

O LeNet (uma das primeiras CNNs práticas) alternava um pequeno número de camadas de convolução e pooling antes de um classificador final; uma aplicação direta e literal dos blocos convolucionais desta disciplina. O AlexNet escalou isso bastante (mais filtros, mais camadas, ReLU em vez de ativações que saturam, e dropout), demonstrando que uma CNN profunda treinada em um grande dataset rotulado podia superar dramaticamente abordagens anteriores de visão computacional não neurais. O VGG levou a mesma ideia adiante com uma regra de projeto simples e disciplinada: empilhar muitas convoluções pequenas de 3×3 em vez de poucas grandes, já que duas convoluções 3×3 empilhadas cobrem o mesmo campo receptivo de uma convolução 5×5 com menos parâmetros no total e com uma não linearidade extra no meio. A tendência nos três: mais camadas, aplicadas com disciplina arquitetural crescente, produziam melhor acurácia.

### O problema de degradação: a profundidade para de ajudar e depois começa a prejudicar

Essa tendência quebrou a partir de certa profundidade. Redes com mais camadas começaram a ter desempenho *pior* que versões mais rasas da mesma arquitetura, e, crucialmente, pior até no conjunto de *treino*, e não só em dados retidos. Isso descarta a explicação usual de overfitting de `the-bias-variance-tradeoff` (que prevê bom desempenho no treino e pior no teste); uma rede que não consegue nem se ajustar aos próprios dados de treino tão bem quanto uma versão mais rasa de si mesma tem um problema genuíno de otimização, e não de generalização. A causa remete diretamente ao problema do gradiente que desaparece de vários conceitos atrás: mesmo com inicialização cuidadosa e batch normalization, os gradientes que se propagam de volta por dezenas de camadas convolucionais empilhadas ainda podem encolher a ponto de as primeiras camadas quase não serem atualizadas, desperdiçando na prática boa parte da profundidade da rede.

### Conexões residuais: aprender uma correção, não uma substituição

Uma conexão residual (ou skip connection) acrescenta um atalho direto em volta de uma ou mais camadas, de modo que, em vez de um bloco de camadas calcular diretamente alguma saída desejada `H(x)` a partir da entrada `x`, ele calcula só a diferença:

```text
output = F(x) + x
```

em que `F(x)` (o "resíduo") é o que as camadas empilhadas dentro do bloco de fato calculam, e `x` passa sem mudança pelo atalho. Se a melhor coisa que um dado bloco pode fazer é não fazer nada (`F(x) = 0`), o bloco pode aprender isso trivialmente, e o atalho passa `x` sem modificação; um alvo muito mais fácil para o gradiente descendente encontrar do que fazer cada camada aprender um mapeamento identidade exato por meio de toda a sua matriz de pesos. O efeito no backpropagation é o mecanismo central: o gradiente que volta por um bloco residual tem um caminho direto e desimpedido pelo atalho `+x`, além do caminho pelas camadas de `F(x)`; então, mesmo que o gradiente local de `F(x)` seja pequeno (o cenário de gradiente que desaparece de antes), o atalho ainda leva um gradiente de magnitude próxima de 1 direto pelo bloco, deixando os gradientes chegarem às primeiras camadas praticamente intactos, mesmo em redes com mais de cem camadas. Essa é precisamente a inovação arquitetural que permitiu a redes no estilo ResNet escalar para profundidades que antes sofriam do problema de degradação.

### Por que o treino de deep learning roda em GPUs

Toda operação vista até aqui nesta disciplina (a multiplicação de matriz de uma camada densa, os muitos produtos escalares independentes de uma convolução, os forward e backward passes de um batch calculados juntos) compartilha uma propriedade estrutural: a *mesma* operação pequena (uma multiplicação-soma, um produto escalar) repetida um número enorme de vezes, de forma independente, sobre pedaços diferentes de dados. O conceito `flynns-taxonomy-and-simd` de `computer/computer-architecture` já classificou exatamente esse padrão (uma única instrução aplicada a muitos elementos de dados ao mesmo tempo), e `gpu-architecture-and-the-simt-execution-model` cobriu o hardware construído especificamente para explorá-lo: milhares de núcleos simples executando o mesmo fluxo de instruções sobre dados diferentes (single-instruction, multiple-thread), em vez do punhado de núcleos complexos e de uso geral que uma CPU oferece. Uma convolução deslizando um filtro por milhares de posições de uma imagem, ou uma camada densa multiplicando uma matriz de pesos por um batch de muitos vetores de entrada de uma vez, é exatamente a carga paralela em dados para a qual as GPUs foram projetadas; esse é o motivo concreto, no nível do hardware, de treinar redes profundas modernas só em CPUs ser impraticavelmente lento, e de os modelos desta disciplina serem treinados em GPUs (ou em aceleradores especializados construídos sobre o mesmo princípio SIMT) como algo normal, e não como uma otimização opcional.

## Exemplos Resolvidos

### Exemplo 1: o caminho do gradiente por um bloco residual, rastreado

Considere um bloco residual `output = F(x) + x`, em que o gradiente do loss em relação à saída do bloco é algum valor `g`. Pela regra da soma da derivação (aplicada pelo backpropagation):

```text
∂L/∂x = ∂L/∂output · ∂output/∂x
      = g · (∂F(x)/∂x + 1)
      = g·∂F(x)/∂x + g
```

Mesmo que `∂F(x)/∂x` seja muito pequeno (o caso de gradiente que desaparece nas camadas internas do bloco), o segundo termo, `g`, ainda passa totalmente sem atenuação pelo `+1` vindo do atalho identidade. Compare com um bloco simples (não residual) que calcula `output = F(x)` diretamente: `∂L/∂x = g · ∂F(x)/∂x`; sem o termo do atalho, um `∂F(x)/∂x` pequeno atenua totalmente o gradiente, sem nada para compensar.

### Exemplo 2: duas convoluções 3×3 empilhadas versus uma 5×5

Para uma única posição de saída, uma convolução 5×5 sobre `c` canais de entrada usa `5 · 5 · c = 25c` pesos por canal de saída. Duas convoluções 3×3 empilhadas cobrindo o mesmo campo receptivo 5×5 (a saída da primeira convolução 3×3 já depende de uma região de entrada 3×3; empilhar uma segunda convolução 3×3 por cima estende o campo receptivo efetivo para 5×5) usam `3·3·c + 3·3·c = 9c + 9c = 18c` pesos no total; menos parâmetros (`18c` contra `25c`) e, ao mesmo tempo, uma não linearidade extra entre as duas convoluções menores, exatamente o argumento de projeto do VGG para preferir vários filtros pequenos a um grande.

## Equívocos Comuns e Armadilhas

- **"Redes mais profundas sempre têm desempenho melhor, com dados suficientes."** O problema de degradação é um contraexemplo real e documentado: a partir de certa profundidade, redes simples (não residuais) ficaram mensuravelmente piores até nos próprios dados de treino, e foi exatamente essa constatação empírica que motivou as conexões residuais.
- **"Conexões residuais são uma forma de regularização, como o dropout."** Elas tratam um problema de otimização (gradientes desaparecendo ao longo de muitas camadas empilhadas), e não de overfitting; uma rede residual sem o problema de degradação não tem desempenho pior nos dados de treino.
- **"Deep learning precisa especificamente de GPU porque CPUs não conseguem fazer as contas."** CPUs conseguem executar corretamente todas as operações envolvidas no treino de uma rede; a questão é vazão, e não capacidade. O projeto de uma CPU (poucos núcleos complexos, otimizados para trabalho variado e sequencial) simplesmente não combina estruturalmente com a carga real do treino (a mesma operação simples repetida sobre quantidades enormes de dados independentes), que é precisamente a distinção SIMD/SIMT que `computer/computer-architecture` já cobre.

## Resumo

As arquiteturas de CNN evoluíram do projeto com poucas camadas do LeNet, passando pelos aumentos disciplinados de profundidade do AlexNet e do VGG, até que a própria profundidade começou a prejudicar ativamente a acurácia de treino; o problema de degradação, que remete diretamente ao problema do gradiente que desaparece agravado por muitas camadas empilhadas. As conexões residuais corrigem isso fazendo cada bloco aprender uma correção somada a um atalho identidade direto, dando ao backpropagation um caminho de gradiente desimpedido por cada bloco, por menor que seja o gradiente local daquele bloco; a mesma ideia de skip connection reaproveitada mais adiante na arquitetura Transformer desta disciplina. À parte disso, as multiplicações de matrizes e convoluções por trás de toda arquitetura desta disciplina são exatamente a carga massivamente paralela em dados, com a mesma operação repetida muitas vezes, para a qual as GPUs (o modelo de execução SIMT de `computer/computer-architecture`) foram construídas, e esse é o motivo concreto de hardware para o treino de deep learning rodar em GPUs como prática padrão.

## Documentation Links

- [CS231n: Course Schedule (Stanford, Spring 2026)](https://cs231n.stanford.edu/schedule.html): "CNN Architectures" (batch normalization e os modelos marcantes AlexNet, VGG, ResNet) e "Large Scale Distributed Training" como temas de aula do próprio curso para este material.
- [CS231n: Transfer Learning and Fine-tuning Convolutional Neural Networks](https://cs231n.github.io/transfer-learning/): a progressão de features camada por camada (filtros genéricos no início, filtros específicos da tarefa no fim) que essas arquiteturas marcantes produzem, retomada em `representation-learning-the-network-learns-its-own-features`.
