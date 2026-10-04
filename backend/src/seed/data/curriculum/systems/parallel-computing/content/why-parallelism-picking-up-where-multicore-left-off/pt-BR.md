---
version: 1.0
updatedAt: 2026-09-06
title: "Por que Paralelismo: Retomando de Onde o Multicore Parou"
summary: "Arquitetura de Computadores explicou por que os fabricantes de chips pararam de deixar núcleos individuais mais rápidos e passaram a entregar mais deles; esta disciplina retoma exatamente dali, fazendo uma pergunta diferente: dados muitos núcleos (ou muitas máquinas), como um programador de fato faz um programa usá-los?"
---
## Objetivos de Aprendizagem

- Explicar, em uma frase, por que a migração de toda a indústria para chips multicore (já coberta em Arquitetura de Computadores) não deixa automaticamente nenhum programa existente mais rápido.
- Enunciar o escopo desta disciplina: modelos de programação e técnicas de projeto para usar muitos processadores ao mesmo tempo, como algo distinto do hardware que fornece esses processadores.
- Distinguir o paralelismo fortemente acoplado e síncrono desta disciplina do mundo fracamente acoplado e tolerante a falhas dos sistemas distribuídos (uma disciplina posterior).
- Listar as duas famílias de hardware contra as quais esta disciplina programa: máquinas multicore de memória compartilhada e clusters de máquinas de memória distribuída.

## Contexto e Motivação

Arquitetura de Computadores encerrou a sua própria história com um fato histórico bem específico: por volta de 2004-2005, os fabricantes de chips bateram numa parede física real (a Regra de Pollack: o desempenho escala apenas com a raiz quadrada da lógica de transistores adicionada, enquanto a potência escala linearmente com ela) e mudaram de rumo, em toda a indústria, de deixar um núcleo mais rápido a cada ano para colocar mais núcleos, mais simples, no mesmo chip. Aquela disciplina cobriu em detalhe as consequências dessa mudança no hardware: como múltiplos núcleos compartilham memória, como a coerência de cache mantém consistentes as visões que eles têm da memória, como o false sharing transforma um protocolo de corretude num bug de desempenho, e como lanes SIMD e streaming multiprocessors de GPU levam o paralelismo de dados ainda mais longe dentro de um único chip.

Nada desse hardware, por si só, faz um programa single-threaded rodar mais rápido. Um programa escrito como um único fluxo sequencial de instruções usa exatamente um desses núcleos, não importa quantos outros fiquem ociosos ao lado dele. O ensaio de Herb Sutter de 2005, citado no próprio capstone de Arquitetura de Computadores, nomeou isso com precisão: "the free lunch is over" (o almoço grátis acabou). Por décadas, o software ficou mais rápido de graça conforme as frequências de clock subiam, e essa carona gratuita terminou no momento em que o crescimento da frequência de clock terminou. Fazer um programa de fato usar mais de um núcleo exige que o programador diga explicitamente quais partes da computação podem acontecer ao mesmo tempo, e esse ato explícito (decompor um problema em pedaços que podem rodar concorrentemente e coordenar esses pedaços corretamente) é inteiramente o assunto desta disciplina.

Esta disciplina fica entre duas outras no currículo. De um lado, `computer-architecture` já respondeu "que hardware existe para rodar coisas em paralelo?": multicore, coerência de cache, SIMD, GPUs. Do outro lado, uma disciplina posterior, `distributed-systems-i`, responderá uma pergunta relacionada mas genuinamente diferente: como máquinas independentes, conectadas por uma rede não confiável, cada uma podendo falhar por conta própria, se coordenam corretamente? Esta disciplina ocupa o meio-termo: um conjunto fixo e conhecido de processadores (ou os núcleos de uma máquina, compartilhando memória, ou um pequeno cluster de máquinas que um programador controla diretamente) cooperando de forma síncrona numa computação, sem os modos de falha (falha parcial, atraso de rede ilimitado, necessidade de consenso sobre quem ainda está vivo) que definem os sistemas distribuídos propriamente ditos.

## Teoria Central

### Dois tipos de hardware para programar

As duas arquiteturas de memória que Arquitetura de Computadores já introduziu estabelecem os dois mundos de programação que esta disciplina cobre:

- **Memória compartilhada**: todo processador pode ler e escrever diretamente no mesmo espaço de endereçamento. A comunicação entre processadores é tão simples quanto um escrever uma variável e outro lê-la, mas essa mesma simplicidade é exatamente o que torna a coerência de cache e a sincronização necessárias, já que dois processadores agora podem disputar o acesso à mesma posição de memória.
- **Memória distribuída**: cada processador (na prática, cada máquina num cluster) tem a sua própria memória privada, que nenhum outro processador pode tocar diretamente. A comunicação tem que acontecer por meio de mensagens explícitas enviadas por uma rede, mais lenta e mais deliberada do que uma escrita compartilhada, mas sem nenhuma possibilidade de dois processadores disputarem a mesma posição de memória, porque essa posição não existe.

Os dois grandes modelos de programação desta disciplina mapeiam diretamente nesses dois mundos: OpenMP, coberto na segunda metade, mira memória compartilhada; MPI, coberto na terceira parte, mira memória distribuída. O próximo conceito desenvolve essa distinção de hardware (e um terceiro caso, híbrido) em mais detalhe antes que qualquer modelo de programação seja introduzido.

### O que "paralelo" acrescenta em cima de "concorrente"

`programming-paradigms` já introduziu concorrência no nível conceitual: estado compartilhado versus troca de mensagens, e condições de corrida como um risco do primeiro. Esta disciplina não reensina esse material. Ela toma a concorrência como já entendida e faz uma pergunta mais estreita e mais concreta: dado um problema computacional específico e um número específico de processadores disponíveis, como o trabalho deve de fato ser dividido, e quanto custa dividi-lo em comunicação e coordenação? "Paralelo" aqui significa especificamente múltiplos processadores fazendo progresso simultâneo num problema, o que é uma afirmação mais forte e mais específica do que "concorrente", que só exige que as operações possam ser intercaladas corretamente, sem necessariamente rodarem no mesmo instante físico.

### Aonde esta disciplina vai chegar

O restante desta disciplina segue um arco deliberado, alinhado com a forma como cursos reais de programação paralela (o CS267 de Berkeley, os próprios materiais de treinamento do LLNL) são de fato estruturados: primeiro, o vocabulário de projeto para dividir trabalho (decomposição, granularidade, balanceamento de carga); depois, a matemática de quanto dividir o trabalho consegue de fato ajudar (Lei de Amdahl, Lei de Gustafson, escalabilidade forte e fraca); depois, dois modelos de programação concretos, reais e amplamente usados que colocam esse vocabulário de projeto em prática (OpenMP para memória compartilhada, MPI para memória distribuída), terminando com um capstone que amarra a escolha entre eles, e o modelo de GPU já coberto em Arquitetura de Computadores, numa decisão real.

## Exemplos Resolvidos

### Exemplo 1: O mesmo loop, sequencial vs. paralelo com threads

Considere um loop que calcula a soma dos quadrados de um array grande:

```c
double sum_sequential(double *a, int n) {
    double sum = 0.0;
    for (int i = 0; i < n; i++) {
        sum += a[i] * a[i];
    }
    return sum;
}
```

Num único núcleo, isto roda em tempo proporcional a `n`, usando exatamente um processador, não importa quantos outros a máquina tenha. Conceitos posteriores desta disciplina (work-sharing em OpenMP) mostrarão precisamente como uma mudança de uma linha neste mesmo loop permite que múltiplas threads calculem somas parciais concorrentemente e as combinem. A transformação de "código sequencial correto" em "código paralelo correto" é todo o assunto do segundo bloco desta disciplina, e não algo que acontece automaticamente só porque o hardware tem mais núcleos.

### Exemplo 2: Classificando um problema pelo seu hardware alvo

Dados três cenários computacionais, classifique qual arquitetura de memória (e, mais tarde, qual modelo de programação) cada um naturalmente mira:

```text
Cenário                                           Alvo
-------------------------------------------------  ------------------
Simular numericamente o fluxo de ar sobre uma      Memória distribuída
  asa, dividido entre 512 máquinas de um cluster,   (MPI)
  nenhuma compartilhando memória
Somar um array de 10 milhões de elementos numa     Memória compartilhada
  estação de trabalho com 16 núcleos                (OpenMP)
Aplicar o mesmo ajuste de brilho a cada pixel de    SIMD / GPU
  uma imagem 4K, de forma independente              (já coberto em
                                                      Arquitetura de
                                                      Computadores)
```

O padrão a notar: o hardware disponível (os núcleos de uma máquina vs. um cluster de máquinas) e o formato do problema (muitas operações pequenas e independentes vs. um número menor de tarefas mais grossas) juntos determinam qual das ferramentas desta disciplina é o encaixe natural, uma decisão à qual o capstone desta disciplina voltará diretamente, com o raciocínio explicitado em vez de presumido.

## Equívocos Comuns e Armadilhas

- **"Mais núcleos significam automaticamente um programa mais rápido."** Um programa precisa ser explicitamente reescrito para usar mais de um núcleo; um programa puramente sequencial usa exatamente um núcleo, independentemente de quantos fiquem ociosos ao lado dele.
- **"Paralelo e concorrente são a mesma coisa."** Concorrência trata de intercalar corretamente operações que podem ou não rodar no mesmo instante físico; paralelismo significa especificamente múltiplos processadores fazendo progresso literalmente simultâneo. Uma máquina de um núcleo consegue rodar código concorrente (via fatiamento de tempo), mas não consegue rodar nada em paralelo de verdade.
- **"Esta disciplina é sobre sistemas distribuídos."** Não é. Um cluster pequeno e fixo sob o controle de um programador, comunicando-se de forma síncrona, é um problema fundamentalmente mais fácil do que as falhas parciais, os atrasos ilimitados e as questões de consenso que definem os sistemas distribuídos, cobertos numa disciplina posterior e separada.
- **"Memória compartilhada significa que nenhuma coordenação é necessária."** O oposto é verdade: a memória compartilhada torna o acesso não coordenado fácil de escrever e fácil de errar (corridas, como já introduzido em `programming-paradigms`); a memória distribuída força a coordenação a ser explícita por meio de mensagens, o que é mais verboso, mas mais difícil de errar silenciosamente.

## Resumo

Esta disciplina retoma exatamente de onde o material de multicore/SIMD/GPU de Arquitetura de Computadores parou: dado um hardware capaz de fazer muitas coisas ao mesmo tempo, como um programador de fato decompõe um problema, comunica entre os pedaços e raciocina sobre quanto speedup é sequer alcançável? Ela mira dois mundos de hardware concretos (memória compartilhada: uma máquina, muitos núcleos, um único espaço de endereçamento; e memória distribuída: muitas máquinas, nenhum espaço de endereçamento compartilhado, mensagens explícitas) e para antes do mundo mais difícil e sujeito a falhas dos sistemas distribuídos propriamente ditos, coberto separadamente. A disciplina se constrói em ordem: decomposição e vocabulário de projeto, a matemática de desempenho que limita o que o paralelismo pode alcançar, e depois dois modelos de programação reais (OpenMP, MPI) que colocam ambos em prática.

## Documentation Links

- [LLNL: Introduction to Parallel Computing Tutorial](https://hpc.llnl.gov/documentation/tutorials/introduction-parallel-computing-tutorial): a fonte principal para o vocabulário de projeto e os conceitos de desempenho desta disciplina.
- [ACM/IEEE CS2013: Parallel and Distributed Computing Knowledge Area](https://csed.acm.org/knowledge-areas-parallel-and-distributed-computing-pd-cs2013-version/): diretrizes curriculares que confirmam o escopo e a distinção terminológica entre paralelo/distribuído/concorrente usada ao longo da disciplina.
