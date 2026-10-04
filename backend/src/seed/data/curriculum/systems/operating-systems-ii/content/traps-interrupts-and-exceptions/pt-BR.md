---
version: 1.0
updatedAt: 2026-09-06
title: "Traps, Interrupções e Exceções"
summary: "Uma chamada de sistema, uma interrupção de hardware e uma page fault parecem completamente diferentes para o programador, mas a CPU trata as três com exatamente o mesmo mecanismo de trap: salva o estado atual, salta para um ponto de entrada fixo do kernel e deixa o kernel descobrir por que foi chamado."
---
## Objetivos de Aprendizagem

- Definir o mecanismo de trap como o único caminho de hardware do modo usuário para o modo kernel, e descrever as suas três fontes reais: chamadas de sistema, interrupções de hardware e exceções.
- Distinguir estas três fontes pelo que as dispara (pedido deliberado do programa, evento de hardware assíncrono, erro síncrono do programa) explicando por que a CPU trata as três pelo mesmo mecanismo subjacente.
- Descrever o que é um trap frame e por que o hardware (ou um stub mínimo em assembly) precisa salvá-lo antes que qualquer código C do kernel rode.
- Explicar por que um trap sempre salta para um conjunto pequeno e fixo de pontos de entrada do kernel em vez de um endereço fornecido pelo código que causou o trap.

## Contexto e Motivação

O conceito anterior estabeleceu que o modo usuário não pode executar instruções privilegiadas e não pode se promover arbitrariamente ao modo kernel. Mas programas de usuário precisam legitimamente de serviços do kernel o tempo todo (ler um arquivo, alocar memória, esperar por E/S), e o kernel precisa legitimamente recuperar o controle periodicamente mesmo quando um processo não pede nada (para fazer a preempção dele depois do seu quantum de escalonamento, ou para atender uma leitura de disco concluída). As duas necessidades são atendidas pelo mesmo mecanismo de hardware subjacente: o trap.

Um trap é o salto implementado no próprio hardware da CPU de qualquer código que esteja executando (em qualquer modo) para uma rotina do kernel, com privilégio de kernel, num de um conjunto pequeno e fixo de endereços que o kernel estabeleceu quando inicializou. Esta é a única porta pela qual o controle jamais passa de execução menos privilegiada para mais privilegiada, e entendê-la com precisão (o que a dispara, que estado ela preserva e onde ela aterrissa) é o pré-requisito para entender chamadas de sistema, E/S dirigida por interrupções, as page faults da memória virtual e a técnica trap-and-emulate da virtualização, todos construídos diretamente por esta disciplina sobre este único mecanismo.

## Teoria Central

### Três fontes reais de um trap, um mecanismo

O hardware real distingue três fontes de um trap pelo que o causou, embora a resposta de fato da CPU seja estruturalmente a mesma em cada caso:

1. **Chamadas de sistema**: um pedido deliberado e síncrono do código de usuário, executado via uma instrução de trap dedicada (`ecall` no RISC-V, `syscall` ou o mais antigo `int 0x80` no x86). O programa escolhe exatamente quando isso acontece.
2. **Interrupções de hardware**: eventos assíncronos vindos inteiramente de fora do programa em execução: um timer disparando, um disco terminando uma leitura, uma tecla sendo pressionada. Elas podem ocorrer literalmente em qualquer fronteira entre instruções, sem relação com o que o código interrompido estava fazendo.
3. **Exceções**: síncronas, mas *não planejadas* pelo programa: uma page fault (a tradução de endereço falhou), uma divisão por zero, uma instrução ilegal, uma violação de proteção vinda da checagem de instrução privilegiada do conceito anterior. O programa não pediu isto, mas é uma consequência direta e imediata da instrução que ele acabou de executar.

O insight unificador (aquele que o kernel xv6 do 6.S081 do MIT torna explícito no seu próprio código de tratamento de traps) é que a CPU responde às três com a mesma ação de hardware subjacente: para o fluxo de instruções em execução, salva estado suficiente para retomá-lo depois, troca para o modo kernel e salta para um tratador definido pelo kernel. O código de despacho de traps do *kernel* então examina um registrador de causa para decidir qual das três de fato aconteceu e encaminha conforme o caso, mas a própria sequência de entrada em trap do hardware não precisa de três mecanismos diferentes, apenas um, examinado depois.

### O trap frame: o que precisa ser salvo, e por quem

Antes que qualquer código C do kernel possa rodar com segurança, algo precisa preservar estado suficiente do programa interrompido para que ele possa ser retomado depois exatamente como se nada tivesse acontecido. Este estado salvo (o contador de programa, o ponteiro de pilha, os registradores de propósito geral e o nível de privilégio salvo) é o trap frame. Parte desse salvamento é feita automaticamente pelo próprio hardware (a entrada em trap do RISC-V, por exemplo, salva automaticamente o contador de programa em `sepc` e a causa em `scause`); o resto é trabalho de uma pequena quantidade de assembly escrito à mão que o kernel instala como as suas primeiríssimas instruções no endereço de entrada do trap, executado antes de qualquer código C gerado por compilador, justamente porque o próprio prólogo de uma função C comum já sobrescreveria registradores que o trap frame precisa preservar primeiro.

```mermaid
sequenceDiagram
    participant User as Código em modo usuário
    participant HW as Hardware da CPU
    participant Asm as Assembly de entrada de trap do kernel
    participant Kernel as Tratador de trap em C do kernel
    User->>HW: ecall / interrupção dispara / exceção ocorre
    HW->>HW: salva PC, causa; troca para modo kernel
    HW->>Asm: salta para o endereço fixo de entrada de trap
    Asm->>Asm: salva os registradores restantes no trap frame
    Asm->>Kernel: chama a função C de despacho de trap
    Kernel->>Kernel: examina a causa; trata (syscall / interrupção / exceção)
    Kernel->>Asm: retorna
    Asm->>Asm: restaura os registradores do trap frame
    Asm->>HW: sret / iret
    HW->>User: retoma no PC salvo, de volta ao modo usuário
```

### Por que o alvo do salto precisa ser fixo, e não fornecido pelo código que causou o trap

Um trap sempre aterrissa num de um número pequeno e fixo de endereços escolhidos pelo kernel (configurados uma vez, na inicialização, num registrador de hardware que o kernel controla: o `stvec` do RISC-V, a base da Interrupt Descriptor Table do x86), nunca num endereço que a própria instrução que causou o trap especifica. Isto não é uma escolha de projeto arbitrária: se o código de usuário pudesse especificar onde o seu próprio trap aterrissa, ele poderia simplesmente apontar esse endereço para código arbitrário de sua escolha e executá-lo em modo kernel, derrotando inteiramente a execução em modo dual. Ao fixar o ponto de entrada de antemão, na inicialização, antes que qualquer código de usuário jamais rode, o kernel garante que, não importa o que tenha disparado o trap, o controle sempre aterrissa em código que o próprio kernel escreveu e no qual confia.

### Interrupções versus exceções: síncronas ou não, e por que isso importa para a retomada

Uma exceção é síncrona com o fluxo de instruções: ela acontece como consequência direta, imediata e reproduzível da instrução específica que a causou (dividir por zero sempre falha naquela exata divisão, toda vez). Uma interrupção é assíncrona: ela pode ocorrer entre quaisquer duas instruções, sem nenhuma relação com o que o código interrompido calha de estar fazendo naquele momento. Esta distinção importa para como o tratador de trap decide se e como retomar: depois de tratar uma exceção de page fault, o kernel tipicamente reexecuta a exata instrução que falhou (agora que a página necessária está residente); depois de tratar uma interrupção de timer, o kernel tipicamente retoma na próxima instrução, já que nada na própria instrução interrompida falhou.

## Exemplos Resolvidos

### Exemplo 1: Uma sequência de trap concreta no RISC-V para uma chamada de sistema

```text
Código de usuário:     ecall                  ; instrução de trap
Hardware (automático): sepc  <- PC do ecall    ; salva o endereço de retorno
                        scause <- 8            ; "environment call from U-mode"
                        mode  <- S (supervisor) ; privilégio elevado
                        PC    <- stvec         ; salta para endereço fixo do kernel
Stub asm do kernel:     salva a0..a7, ra, sp, etc. num trap frame por processo
Tratador C do kernel:   lê scause -> 8, despacha para o tratador de syscall
                        lê a7 (número da syscall), a0..a2 (argumentos)
                        executa a syscall pedida, guarda o resultado em a0
Stub asm do kernel:     restaura os registradores do trap frame
                        sret                    ; mode <- U, PC <- sepc + 4
```

Note o `+ 4`: diferente de uma page fault (que reexecuta a mesma instrução que falhou), uma chamada de sistema concluída retoma na instrução *depois* do `ecall`, já que a chamada já rodou até o fim.

### Exemplo 2: Distinguindo as três fontes de trap pelo seu valor de `scause`

```text
Valor de scause (ilustrativo)  Fonte              Síncrona?   Retoma em
-----------------------------  -----------------  ----------  -----------------
8 (environment call, U-mode)   Chamada de sistema Síncrona    PC do ecall + 4
13 (page fault)                 Exceção            Síncrona    mesmo PC que falhou
Bit de interrupção + timer      Interrupção        Assíncrona  próxima instrução
```

A única função de despacho de traps do kernel lê este único valor para decidir qual de três caminhos de tratamento totalmente diferentes seguir: um mecanismo de entrada de hardware, três resultados logicamente distintos.

### Exemplo 3: O que dá errado se o trap frame for salvo incorretamente

```text
Bug: o assembly de entrada de trap do kernel esquece de salvar
     o registrador t0 antes de chamar a função C de despacho.

Consequência: a função C de despacho (código compilado, livre para
usar qualquer registrador) sobrescreve t0 para os seus próprios fins.

Resultado: quando o trap retorna e o programa de usuário é retomado,
t0 guarda lixo em vez de qualquer valor que o programa de usuário
tinha colocado ali antes de o trap disparar -- um bug de corretude
que pode parecer acontecer "aleatoriamente", já que ele só se manifesta
quando o compilador calha de ter um valor vivo em t0 atravessando a
exata instrução que disparou o trap.
```

É precisamente por isso que kernels reais (o xv6 incluído) escrevem à mão o assembly de entrada de trap com cuidado extremo, salvando todo registrador que a convenção de chamada não garante já estar preservado, antes que qualquer código C comum execute.

## Equívocos Comuns e Armadilhas

- **"Chamadas de sistema, interrupções e exceções são três mecanismos de hardware sem relação."** Elas são tratadas pelo mesmo mecanismo de trap subjacente (salvar o estado, elevar o privilégio, saltar para um endereço fixo do kernel), diferindo apenas no que disparou o trap e, consequentemente, em como o código de despacho do kernel responde e onde a execução é retomada depois.
- **"O kernel pode simplesmente escrever código C comum como as suas primeiríssimas instruções de tratamento de trap."** O trap frame (registradores de propósito geral, o endereço de retorno) precisa ser salvo por assembly escrito à mão *antes* que qualquer função C gerada por compilador rode, porque o próprio prólogo de uma função C comum é livre para sobrescrever registradores que o trap frame ainda precisa preservar.
- **"Um trap pode aterrissar em qualquer endereço, desde que esteja em código do kernel."** Ele aterrissa num endereço fixo específico escolhido pelo kernel (ou numa pequena tabela deles) configurado uma vez na inicialização, justamente para que nenhuma instrução que cause trap, como quer que tenha sido disparada, possa redirecionar o controle para código escolhido por um atacante.
- **"Exceções e interrupções retomam ambas na instrução seguinte à que causou o trap."** Uma exceção de page fault retoma reexecutando a mesmíssima instrução que falhou (agora que os seus dados estão residentes); uma interrupção retoma na próxima instrução, já que a instrução interrompida em si não falhou.

## Resumo

Os traps são o único caminho de hardware do modo usuário para o modo kernel, usados para os três casos: uma chamada de sistema (um pedido deliberado e síncrono), uma interrupção de hardware (um evento assíncrono sem relação com o código interrompido) e uma exceção (uma falha síncrona e não planejada). O hardware salva estado suficiente (o trap frame, com a ajuda de assembly do kernel escrito à mão que precisa rodar antes de qualquer código compilado comum) para retomar corretamente depois o código interrompido, e sempre salta para um de um conjunto pequeno e fixo de endereços de entrada escolhidos pelo kernel, nunca um fornecido pelo próprio código que causou o trap, que é precisamente o que mantém significativa a execução em modo dual. O próprio código de despacho do kernel então examina um valor de causa para decidir qual dos três de fato aconteceu e como a execução deve ser retomada. Todo mecanismo que esta disciplina cobre a seguir (a anatomia de uma chamada de sistema, o trap-and-emulate de máquinas virtuais) é construído diretamente sobre este único mecanismo de trap.

## Documentation Links

- [OSTEP: Direct Execution](https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-mechanisms.pdf): cobre a transição baseada em traps entre o modo usuário e o modo kernel sobre a qual este conceito é construído.
- [MIT 6.S081 xv6 book: Traps, Interrupts, and Drivers](https://pdos.csail.mit.edu/6.S081/2021/xv6/book-riscv-rev2.pdf): a mecânica real e concreta de trap frame e despacho do RISC-V da qual os exemplos resolvidos deste conceito são extraídos.
