---
version: 1.0
updatedAt: 2026-09-12
title: "Laboratório: o Malloc Lab, um Alocador de Memória do Zero"
summary: "O Heap e a Alocação Dinâmica já explica por que o malloc e o free precisam acompanhar eles mesmos o espaço livre e o alocado, já que o sistema operacional subjacente só distribui páginas de granularidade grossa; o próprio Malloc Lab da CMU é onde um estudante implementa malloc, free e realloc de verdade, apoiados numa lista livre que passa pelos próprios blocos não usados e em boundary tags que permitem a coalescência em tempo constante de blocos livres adjacentes, avaliados no mesmo trade-off real e concreto que todo projeto de alocador de fato enfrenta: vazão (operações por segundo) contra utilização de memória (quão pouco espaço é desperdiçado com fragmentação e sobrecarga de contabilidade)."
---
## Objetivos de Aprendizagem

- Implementar `malloc`, `free` e `realloc` em C, gerenciando uma região de heap obtida em grandes pedaços do sistema operacional, em vez de uma alocação por vez.
- Implementar uma lista livre que passa pelos próprios blocos não usados, e boundary tags que permitem a coalescência em tempo constante de blocos livres adjacentes.
- Explicar o trade-off concreto entre vazão e utilização que toda decisão de projeto de alocador deste laboratório de fato enfrenta.
- Medir o alocador pronto contra um arcabouço de testes real, guiado por traços, fornecido, correspondendo à própria metodologia de avaliação do Malloc Lab da CMU.

## Contexto e Motivação

**O Heap e a Alocação Dinâmica** já explica por que o `malloc` e o `free` precisam acompanhar eles mesmos o espaço livre e o alocado: o sistema operacional distribui memória em páginas de granularidade grossa, e não nos pedaços pequenos e de tamanho preciso que o código da aplicação de fato pede, e alguém precisa preencher essa lacuna. Este laboratório é onde essa explicação vira um alocador real e funcional, correspondendo ao próprio Malloc Lab da CMU, um exercício que a própria página de laboratórios do CS:APP trata como um dos seus trabalhos mais exigentes, justamente porque uma implementação ingênua e aparentemente correta esbarra em problemas de desempenho reais e mensuráveis muito antes de esbarrar em bugs declarados.

## Teoria Central

Nada sobre *por que* um alocador precisa da sua própria contabilidade de espaço livre é rederivado aqui; esse argumento pertence a `the-heap-and-dynamic-allocation`. Este laboratório implementa um projeto específico e padrão para essa contabilidade: boundary tags, um cabeçalho (e um rodapé correspondente) em todo bloco, livre ou alocado, registrando o tamanho e o status de alocação daquele bloco, que é o que torna a coalescência de dois blocos livres adjacentes num bloco maior uma operação O(1), em vez de uma varredura pelo heap inteiro.

## Exemplos Resolvidos

### Especificação da API

```text
void *mm_malloc(size_t size);   // devolve um ponteiro para um bloco utilizável
                                  // de pelo menos `size` bytes, ou NULL
void mm_free(void *ptr);        // devolve o bloco em ptr para a lista livre
void *mm_realloc(void *ptr, size_t size);  // redimensiona, preservando o conteúdo
```

### Passo 1: o cabeçalho de um bloco, carregando tamanho e status de alocação juntos

```c
// Tamanho e bit de alocação empacotados numa palavra: o bit baixo guarda
// alocado (1) vs. livre (0), já que o tamanho de um bloco real é sempre
// múltiplo de 8 e seus próprios 3 bits baixos ficam de outra forma sem uso.
#define PACK(size, alloc)  ((size) | (alloc))
#define GET_SIZE(header)   (*(header) & ~0x7)
#define GET_ALLOC(header)  (*(header) & 0x1)

typedef struct {
    size_t header;
    // ... os bytes de payload vêm a seguir ...
    // size_t footer;   (uma cópia correspondente de `header`, no fim do bloco)
} block_t;
```

### Passo 2: a coalescência, tornada O(1) pelo rodapé do bloco ANTERIOR a este

```c
void *coalesce(void *bp) {
    size_t prev_alloc = get_alloc(footer_of(prev_block(bp)));  // O(1): lê
    size_t next_alloc = get_alloc(header_of(next_block(bp)));   // um deslocamento fixo,
    size_t size = get_size(header_of(bp));                       // sem varredura

    if (prev_alloc && next_alloc) {
        return bp;  // nenhum bloco livre adjacente; nada a fundir
    } else if (prev_alloc && !next_alloc) {
        size += get_size(header_of(next_block(bp)));
        set_header_footer(bp, size, FREE);
    } else if (!prev_alloc && next_alloc) {
        size += get_size(footer_of(prev_block(bp)));
        bp = prev_block(bp);
        set_header_footer(bp, size, FREE);
    } else {
        size += get_size(footer_of(prev_block(bp))) + get_size(header_of(next_block(bp)));
        bp = prev_block(bp);
        set_header_footer(bp, size, FREE);
    }
    return bp;
}
```

O propósito inteiro do rodapé é este Passo: sem ele, conferir se o bloco imediatamente *antes* de `bp` está livre exigiria varrer para trás desde o começo do heap, já que os blocos têm tamanho variável e não há, de outra forma, como saber onde o bloco anterior começa; o rodapé, lido num deslocamento fixo e constante imediatamente antes de `bp`, torna essa checagem O(1).

### Passo 3: a lista livre, passando pelo próprio espaço de payload dos blocos livres

```c
// Um bloco livre reaproveita seus PRÓPRIOS bytes de payload não usados para
// guardar os ponteiros next/prev; nenhuma memória separada é alocada para a
// contabilidade da lista livre, já que um bloco livre, por definição, não tem
// dados de payload a preservar.
typedef struct free_block {
    size_t header;
    struct free_block *next;
    struct free_block *prev;
} free_block_t;

void *find_fit(size_t asize) {
    for (free_block_t *bp = free_list_head; bp != NULL; bp = bp->next) {
        if (get_size(header_of(bp)) >= asize) {
            return bp;  // first-fit: o primeiro bloco livre grande o bastante
        }
    }
    return NULL;  // nenhum encaixe encontrado; quem chamou precisa estender o heap
}
```

### Passo 4: o trade-off real que as decisões de projeto deste laboratório de fato enfrentam

```text
First-fit (Passo 3):        rápido para achar UM encaixe, mas pode deixar muitos
                              fragmentos pequenos e inutilizáveis espalhados cedo no heap

Best-fit:                   varre a lista livre INTEIRA pelo menor bloco adequado,
                              reduzindo a fragmentação, mas custando vazão real em
                              toda alocação

Listas livres segregadas
(baldes por classe de tamanho): um meio-termo real e padrão: busca quase O(1)
                              dentro de uma classe de tamanho, mantendo ainda a
                              fragmentação mais baixa que o first-fit simples numa
                              única lista
```

O próprio Malloc Lab da CMU avalia as submissões exatamente por esse trade-off, uma nota combinada que pesa a vazão medida (operações por segundo num traço real de chamadas de malloc/free/realloc) contra a utilização medida (pico de memória de fato usada versus pico de memória pedida), e não só por passar numa única checagem de correção.

### Passo 5: verificando contra um arcabouço de testes real, guiado por traços

```text
$ ./mdriver -f traces/binary-bal.rep

Results for mm malloc:
trace  valid  util     ops      secs   Kops
 0       yes  99%     5694  0.000267   21318
 ...
Perf index = 45 (util) + 40 (thru) = 85/100
```

O driver fornecido pela CMU reproduz um traço real e gravado de pedidos de alocação, exatamente o tipo de carga realista sob a qual o próprio tratamento teórico de `the-heap-and-dynamic-allocation` argumenta que um alocador precisa se sair bem, e não um benchmark sintético e uniforme para o qual uma implementação poderia ser ajustada de forma estreita só para passar, sem de fato ser um bom alocador de propósito geral.

## Equívocos Comuns e Armadilhas

- **"Um alocador só precisa estar correto; o desempenho é uma preocupação secundária."** A própria metodologia de avaliação da CMU pesa a utilização e a vazão tão fortemente quanto a correção, porque um alocador correto, mas lento, ou correto, mas esbanjador, é uma falha real e prática para qualquer coisa que de fato chame `malloc` com frequência, que é o objetivo inteiro de construir um teste guiado por traços, em vez de um baseado só em correção.
- **"A coalescência exige varrer o heap para achar blocos livres adjacentes."** O ponto de projeto inteiro do Passo 2 é que não exige: um rodapé no bloco imediatamente antes de `bp`, lido num deslocamento fixo, torna a checagem do status de alocação desse bloco uma operação O(1), que é exatamente o que mantém o próprio `free` rápido, seja qual for o tamanho do heap.
- **"Uma lista livre precisa da sua própria memória alocada separadamente para os ponteiros next/prev."** O projeto do Passo 3 reaproveita o próprio espaço de payload não usado de um bloco livre exatamente para essa contabilidade, já que um bloco que está livre, por definição, não tem dados de payload que precisem ser preservados; alocar memória separada para os metadados da lista livre desperdiçaria exatamente o espaço que este projeto recupera de graça.

## Resumo

Este laboratório implementa `malloc`, `free` e `realloc` de verdade, correspondendo ao próprio Malloc Lab da CMU: boundary tags (um cabeçalho e um rodapé em todo bloco) que permitem a coalescência O(1) de blocos livres adjacentes, uma lista livre que passa pelo próprio espaço de payload não usado dos blocos livres em vez de alocada separadamente, e uma estratégia de busca de encaixe (first-fit aqui) escolhida de um espaço real e concreto de trade-offs entre vazão e utilização que a própria metodologia de avaliação guiada por traços do laboratório mede diretamente. Verificar contra um traço real e gravado de pedidos de alocação, em vez de um benchmark sintético, é o que de fato testa se o alocador se sai bem sob a carga realista e irregular que o próprio tratamento teórico de `the-heap-and-dynamic-allocation` argumenta que um alocador real precisa aguentar.

## Documentation Links

- [CS:APP: Lab Assignments (Malloc Lab)](https://csapp.cs.cmu.edu/3e/labs.html): o próprio Malloc Lab oficial da CMU ao qual este exercício corresponde exatamente, incluindo sua metodologia de avaliação guiada por traços.
- [Arpaci-Dusseau: Operating Systems: Three Easy Pieces, "Free-Space Management"](https://pages.cs.wisc.edu/~remzi/OSTEP/vm-freespace.pdf): a fonte do projeto de lista livre e de boundary tags que o alocador deste laboratório implementa.
