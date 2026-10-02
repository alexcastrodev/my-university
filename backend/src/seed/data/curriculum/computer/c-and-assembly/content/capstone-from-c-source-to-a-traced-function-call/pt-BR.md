---
version: 1.0
updatedAt: 2026-09-06
title: "Projeto Final: do Código-Fonte em C a uma Chamada de Função Rastreada"
summary: Uma pequena função recursiva em C compilada até o assembly x86-64 real e depois rastreada chamada por chamada, com todo ponteiro, stack frame e regra de convenção de chamada vistos nesta disciplina funcionando juntos para fazer a recursão, aceita por fé desde Programação e Pensamento Computacional, acontecer fisicamente.
---
## Objetivos de Aprendizagem

- Nomear, em ordem, as quatro etapas que uma toolchain real de C usa para transformar código-fonte num executável: pré-processamento, compilação, montagem (assembly) e ligação (linking).
- Ler o assembly x86-64 gerado pelo gcc para uma pequena função recursiva e associar cada instrução a um conceito específico visto antes nesta disciplina.
- Rastrear, frame por frame, a sequência exata de estados da pilha que as chamadas e retornos de uma função recursiva produzem, usando as regras de prólogo/epílogo e de convenção de chamada já vistas.
- Explicar, com precisão e sem rodeios, em que consiste fisicamente "a pilha de chamadas" na qual `recursion` (`programming-computational-thinking`) pediu ao leitor que confiasse.
- Identificar de quais conceitos anteriores desta disciplina cada etapa deste rastreamento depende, demonstrando que o material da disciplina se compõe num mecanismo coerente, e não numa lista de fatos separados.

## Contexto e Motivação

`programming-computational-thinking/recursion` apresentou funções recursivas e pediu ao leitor que confiasse, sem ainda poder verificar, que "a pilha de chamadas lembra para onde voltar" em cada chamada aninhada. Todo conceito da segunda metade desta disciplina (o espaço de endereçamento do processo, a pilha, registradores e instruções do x86-64, o mecanismo `call`/`ret` da pilha de execução, stack frames e a convenção de chamada) vem construindo, peça por peça, a capacidade de tornar essa confiança desnecessária: mostrar, de forma concreta e completa, exatamente o que acontece quando uma função recursiva em C executa, sem deixar nada implícito.

Este projeto final faz exatamente isso, usando o menor exemplo completo que ainda exercita todas as peças: uma função recursiva curta, compilada com um compilador real para assembly x86-64 real e depois rastreada chamada por chamada e retorno por retorno. Nada aqui é um conceito novo: cada instrução do assembly rastreado é uma instância de algo já visto antes nesta disciplina, e apontar exatamente a que conceito cada instrução pertence é todo o propósito deste rastreamento.

Este conceito também apresenta, brevemente, o único tema da ementa real do CMU 15-213 que esta disciplina deliberadamente tratou como fora de escopo além de uma menção de passagem: a **ligação** (linking). O pipeline de compilação completo (pré-processar → compilar → montar → ligar) é nomeado aqui especificamente porque é a resposta honesta e completa para "como o código-fonte em C vira um programa em execução", mas a mecânica profunda da própria ligação (resolução de símbolos, registros de relocação, ligação estática versus dinâmica) fica reservada para uma disciplina de sistemas mais avançada, ainda não alcançada neste currículo, exatamente como `digital-logic-computer-organization/assembly-to-machine-code-translation` já cobriu a etapa de tradução análoga para uma pequena ISA didática sem precisar de um linker completo para isso.

## Teoria Central

### O pipeline de compilação: quatro etapas, uma de cada vez

```text
factorial.c  --[pré-processar]-->  código-fonte expandido
             --[compilar]------->  factorial.s   (assembly x86-64, legível por humanos)
             --[montar]--------->  factorial.o    (código de máquina, arquivo objeto)
             --[ligar]---------->  factorial      (executável, pronto para rodar)
```

O **pré-processamento** expande macros e diretivas `#include` num único arquivo-fonte totalmente expandido, uma transformação puramente textual, ainda sem nenhum conhecimento da semântica de C. A **compilação** é onde quase tudo o que esta disciplina viu de fato acontece: o compilador traduz o código-fonte em C para assembly x86-64, aplicando todas as regras já estabelecidas (posicionamento de variáveis em `the-process-address-space`, layout de stack frame em `stack-frames-prologue-and-epilogue`, a convenção de chamada em `the-system-v-amd64-calling-convention` e a tradução de controle de fluxo em `translating-control-flow-if-while-for`). A **montagem** pega esse arquivo `.s` legível e converte cada mnemônico na sua codificação binária real: exatamente o conceito de "tradução de assembly para código de máquina" que `digital-logic-computer-organization` já cobriu estruturalmente para uma ISA didática, agora acontecendo de verdade para instruções x86-64 reais. A **ligação**, a etapa que esta disciplina não desenvolve mais, combina um ou mais arquivos objeto (e quaisquer bibliotecas de que o programa dependa) num único executável, resolvendo toda referência de um arquivo a uma função ou variável definida em outro. É uma etapa real e necessária para qualquer programa construído a partir de mais de um arquivo-fonte, mas sua mecânica interna (tabelas de símbolos, relocação) pertence a uma disciplina que este currículo ainda não alcançou.

### O exemplo: uma pequena função recursiva

```c
int factorial(int n) {
    if (n <= 1) {
        return 1;
    }
    return n * factorial(n - 1);
}
```

Compilada com `gcc -S -O0` (desativando de propósito as otimizações, para que o assembly gerado siga exatamente o padrão de prólogo/epílogo/convenção de chamada, em vez de uma variante fortemente otimizada e mais difícil de ler), o resultado fica assim, anotado com cada conceito anterior que ele usa:

```text
factorial:
    pushq %rbp                    ; prólogo (stack-frames-prologue-and-epilogue)
    movq  %rsp, %rbp                ; prólogo
    subq  $16, %rsp                  ; prólogo: reserva espaço para n e um temporário
    movl  %edi, -4(%rbp)              ; guarda o parâmetro n (chegou em %edi conforme
                                       ;   the-system-v-amd64-calling-convention)

    cmpl  $1, -4(%rbp)                ; códigos de condição (condition-codes-and-conditional-branches)
    jg    .L_recurse                  ; translating-control-flow-if-while-for: o teste do "if"

    movl  $1, %eax                     ; caso base: retorna 1 (valor de retorno em %eax, conforme a ABI)
    jmp   .L_done

.L_recurse:
    movl  -4(%rbp), %eax                ; carrega n
    subl  $1, %eax                       ; calcula n - 1  (arithmetic-and-logical-instructions)
    movl  %eax, %edi                      ; move n-1 para %edi: o registrador do primeiro argumento na ABI
    call  factorial                        ; the-x86-64-runtime-stack-call-and-ret: chamada recursiva
    imull -4(%rbp), %eax                   ; %eax (resultado de factorial(n-1)) * n

.L_done:
    leave                                   ; epílogo (stack-frames-prologue-and-epilogue)
    ret                                     ; the-x86-64-runtime-stack-call-and-ret
```

Cada instrução aqui pode ser associada a um conceito que esta disciplina já cobriu: não há nada de novo nesta listagem além do arranjo específico.

### Rastreando a pilha em `factorial(3)`

```mermaid
sequenceDiagram
    participant Main
    participant F3 as factorial(3)
    participant F2 as factorial(2)
    participant F1 as factorial(1)
    Main->>F3: call factorial (n=3 em %edi)
    F3->>F3: prólogo; n=3 guardado em -4(%rbp)
    F3->>F2: n<=1 falso; call factorial (n=2 em %edi)
    F2->>F2: prólogo; n=2 guardado em -4(%rbp)
    F2->>F1: n<=1 falso; call factorial (n=1 em %edi)
    F1->>F1: prólogo; n=1 guardado em -4(%rbp)
    F1->>F1: n<=1 verdadeiro; %eax = 1
    F1->>F2: epílogo; ret (retorna 1)
    F2->>F2: %eax = 1 * 2 = 2
    F2->>F3: epílogo; ret (retorna 2)
    F3->>F3: %eax = 2 * 3 = 6
    F3->>Main: epílogo; ret (retorna 6)
```

No ponto mais profundo (dentro de `factorial(1)`), existem três stack frames completos ao mesmo tempo (os de `factorial(3)`, `factorial(2)` e `factorial(1)`), cada um com sua própria cópia de `n` no seu próprio `-4(%rbp)`, exatamente como `the-stack-and-automatic-storage` descreveu conceitualmente e `stack-frames-prologue-and-epilogue` descreveu estruturalmente. Conforme o caso base de cada chamada é atingido e ela retorna, seu frame é desmontado pelo epílogo, e a multiplicação (`imull -4(%rbp), %eax`) no frame chamador combina o seu próprio `n` com o que quer que a chamada recém-retornada tenha deixado em `%eax`, o registrador designado pela convenção de chamada para o valor de retorno.

## Exemplos Resolvidos

### Exemplo 1: o que "a pilha de chamadas lembra" de fato significa, tornado literal

`recursion` pediu ao leitor que confiasse que uma chamada recursiva "lembra seu lugar" e retoma corretamente depois que uma chamada mais profunda retorna. O rastreamento acima mostra exatamente em que consiste essa confiança: o próprio `n` de cada chamada, guardado no `-4(%rbp)` do seu próprio frame, sobrevive durante toda a duração de cada chamada mais profunda, especificamente porque `%rbp` é fixo por frame (`stack-frames-prologue-and-epilogue`) e a memória de cada frame não é tocada por nada que uma chamada mais profunda faça no seu próprio frame, separado. Não há nenhum "lembrar" além da memória comum que persiste até ser explicitamente recuperada por um epílogo: a confiança que `recursion` pediu sempre foi merecida por exatamente esse mecanismo.

### Exemplo 2: localizando onde a multiplicação de fato acontece

```text
    call  factorial                ; chamada recursiva: factorial(n-1)
    imull -4(%rbp), %eax           ; %eax (o resultado RECÉM-RETORNADO) * n (ainda em -4(%rbp))
```

Essa é a única instrução onde "n * factorial(n - 1)" de fato acontece, e ela só funciona corretamente porque dois fatos, ambos já estabelecidos separadamente nesta disciplina, valem ao mesmo tempo: a convenção de chamada (`the-system-v-amd64-calling-convention`) garante que o resultado de `factorial(n-1)` está em `%eax` no instante em que `call` retorna, e o frame pointer (`stack-frames-prologue-and-epilogue`) garante que `-4(%rbp)` ainda nomeia corretamente o `n` *deste* frame, totalmente intocado pelo que quer que a chamada mais profunda, agora retornada, tenha feito no seu próprio `-4(%rbp)`, separado.

### Exemplo 3: nomeando a etapa do pipeline a que cada transformação pertence

```text
factorial.c   → (compilar) →   a listagem de assembly mostrada acima
factorial.s   → (montar) →     factorial.o (código de máquina binário, opcodes de
                                mov/cmp/jg/call/imul/leave/ret)
factorial.o   → (ligar) →      factorial (um executável que roda, por exemplo combinado
                                com uma biblioteca C que fornece o código de inicialização de main)
```

Tudo o que os próprios exemplos resolvidos desta disciplina cobriram parou na etapa de "compilar": uma listagem de assembly legível por humanos. A etapa de `montar` (transformar `movl`, `cmpl`, `jg` e assim por diante nos seus opcodes binários reais) é a instância real, no x86-64, da mesma ideia de "tradução de assembly para código de máquina" que `digital-logic-computer-organization` já cobriu estruturalmente, e a etapa de `ligar` (combinar `factorial.o` com o que mais o programa final precisar, como o código de inicialização do runtime de C) é a única peça deste pipeline honestamente fora de escopo, reservada para uma disciplina que ainda não foi escrita.

## Equívocos Comuns e Armadilhas

- **"A recursão funciona porque a linguagem tem alguma memória especial para chamadas recursivas."** Ela funciona por causa exatamente da mesma pilha, do mesmo prólogo/epílogo e do mesmo mecanismo de convenção de chamada que toda chamada de função comum (não recursiva) já usa. `factorial` chamando a si mesma é mecanicamente idêntico a quaisquer duas funções diferentes chamando uma à outra; nada na recursão especificamente exige maquinaria nova.
- **"Depois que uma chamada mais profunda retorna, o frame chamador precisa de algum jeito recuperar seu `n` salvo de algum lugar especial."** Nunca foi preciso recuperar nada: o `n` do frame chamador, no seu próprio deslocamento fixo `-4(%rbp)`, simplesmente nunca foi tocado pelo frame próprio e separado da chamada mais profunda. "Recuperá-lo" é só ler um endereço que foi válido o tempo todo.
- **"Compilar com otimizações ligadas mostraria um mecanismo fundamentalmente diferente."** Muito provavelmente produziria um assembly diferente e muitas vezes bem mais curto (um compilador poderia manter `n` num registrador em vez de na pilha num caso simples como este, ou até eliminar a chamada recursiva em favor de um laço equivalente), mas toda regra subjacente que esta disciplina cobriu (a convenção de chamada, a disciplina de pilha quando a pilha É usada, os códigos de condição) continua exatamente igual. A otimização muda qual código é gerado, e não quais convenções esse código precisa obedecer quando de fato usa a pilha ou faz uma chamada.
- **"A ligação é basicamente o mesmo tipo de etapa que a montagem, só que colando arquivos."** É um problema genuinamente distinto: resolver toda referência de um arquivo compilado a um símbolo (uma função ou variável) definido em outro e combinar potencialmente muitos arquivos objeto e bibliotecas num único espaço de endereçamento coerente. É exatamente por isso que ela é nomeada aqui como uma etapa real e necessária, mas deliberadamente não é desenvolvida nesta disciplina.

## Resumo

Uma toolchain real de C transforma código-fonte num programa em execução em quatro etapas (pré-processar, compilar, montar e ligar), e a etapa de compilação é onde quase todo conceito da segunda metade desta disciplina fica visível de uma vez. Uma pequena função recursiva como `factorial`, compilada para assembly x86-64, é uma composição direta da convenção de chamada (argumentos em `%edi`, resultados em `%eax`), dos códigos de condição e da tradução de controle de fluxo (o `cmp`/`jg` do caso base), do mecanismo `call`/`ret` da pilha de execução e do padrão de prólogo/epílogo que mantém as variáveis locais de cada frame (aqui, a cópia de `n` de cada chamada recursiva) válidas e intocadas por qualquer chamada mais profunda que aconteça dentro dele. Essa é a resposta completa e literal à confiança que `programming-computational-thinking/recursion` pediu ao leitor que depositasse em "a pilha de chamadas lembrar para onde voltar": ela não lembra nada além de memória comum, em stack frames comuns, governados exatamente pelas regras que esta disciplina inteira agora tornou totalmente explícitas.

## Documentation Links

- [Bryant & O'Hallaron: Computer Systems: A Programmer's Perspective (CS:APP)](https://csapp.cs.cmu.edu/): livro-texto cujo tratamento completo de compilação, montagem e ligação de programas C a visão geral do pipeline deste projeto final segue.
- [CMU 15-213: Introduction to Computer Systems](https://www.cs.cmu.edu/~213/): curso cuja sequência real de aulas (programação de máquina e depois ligação, como tema posterior e separado) confirma o lugar da ligação como uma etapa distinta que esta disciplina deliberadamente não desenvolve.
