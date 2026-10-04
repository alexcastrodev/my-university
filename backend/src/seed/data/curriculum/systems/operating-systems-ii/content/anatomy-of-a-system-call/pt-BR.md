---
version: 1.0
updatedAt: 2026-09-06
title: "Anatomia de uma Chamada de Sistema"
summary: "Rastreando uma única chamada como write() desde um invólucro de biblioteca em espaço de usuário, passando pela instrução de trap, entrando na tabela de chamadas de sistema do kernel, atravessando a rotina real do kernel e voltando: a maquinaria concreta por trás de todo serviço de SO que um programa jamais solicita."
---
## Objetivos de Aprendizagem

- Rastrear uma chamada de sistema concreta como `write()` desde uma função de biblioteca em espaço de usuário, passando pela instrução de trap, entrando no kernel e voltando.
- Explicar o papel do número da chamada de sistema e da tabela de chamadas de sistema em despachar uma única instrução de trap para a rotina correta do kernel entre centenas.
- Descrever como argumentos e valores de retorno cruzam a fronteira usuário/kernel através de registradores, e por que o kernel não pode simplesmente desreferenciar diretamente um ponteiro fornecido pelo usuário (prenunciando o próximo conceito).
- Distinguir a função invólucro da biblioteca C que um programador chama da chamada de sistema real que ela dispara, e explicar por que não são a mesma coisa.

## Contexto e Motivação

O conceito anterior estabeleceu o mecanismo de trap em geral, o caminho de hardware do modo usuário para o modo kernel, compartilhado por chamadas de sistema, interrupções e exceções. Este conceito torna esse mecanismo abstrato completamente concreto rastreando uma chamada de sistema real e comum do início ao fim: o que de fato acontece, instrução por instrução, quando um programa em C chama `write(fd, buf, count)`.

Este rastreamento concreto importa porque "o SO fornece serviços como ler e escrever arquivos" é uma afirmação que todo tratamento introdutório de sistemas operacionais faz, mas pouquíssimos tornam precisa. Uma chamada de sistema não é uma chamada de função no sentido comum: ela cruza uma fronteira de privilégio de hardware, seus argumentos são organizados através de registradores em vez de um quadro de pilha comum que a função chamada possa inspecionar livremente, e a rotina de kernel que de fato roda é selecionada entre centenas de possibilidades por nada mais que um único inteiro. Entender isso concretamente é o pré-requisito direto para a preocupação central do próximo conceito: por que o kernel não pode simplesmente confiar em nenhum dos valores que recebe dessa forma.

## Teoria Central

### O invólucro da biblioteca C não é a chamada de sistema

Quando um programa em C chama `write(fd, buf, count)`, ele não está invocando diretamente uma rotina do kernel: está chamando uma função comum de espaço de usuário, tipicamente fornecida pela biblioteca padrão C (glibc, musl ou similar), cujo trabalho inteiro é empacotar os argumentos da chamada nos registradores que uma instrução de trap real espera, executar essa instrução de trap e desempacotar o resultado depois. Essa função invólucro é código comum, sem privilégio, de modo usuário, executando exatamente como qualquer outra função que o programa chama: o evento de cruzamento de privilégio de fato não acontece até que o próprio invólucro execute a instrução de trap (`ecall` no RISC-V, `syscall` no x86-64). É por isso que "chamada de sistema" se refere especificamente ao evento de cruzamento do trap e à rotina de kernel que ele invoca, não à função de biblioteca mais amigável que um programador C escreve diretamente em seu próprio código-fonte.

### O número da chamada de sistema e a tabela de chamadas de sistema

Uma única instrução de trap é tudo o que o hardware fornece: ela não pode, por si só, dizer ao kernel se o programa chamador queria ler um arquivo, alocar memória ou terminar a si mesmo. A convenção que todo kernel de tipo Unix real usa para resolver isso é um número de chamada de sistema: antes de executar a instrução de trap, o invólucro da biblioteca coloca um pequeno inteiro identificando qual chamada de sistema está sendo solicitada em um registrador designado (convencionalmente `a7` no RISC-V no xv6, `rax` no x86-64 Linux). O código de despacho de trap do kernel, uma vez que tenha determinado (via a causa do trap) que esse trap foi uma chamada de sistema em vez de uma interrupção ou exceção, lê esse número e o usa como índice numa tabela de chamadas de sistema, um vetor de ponteiros de função, um por chamada de sistema, que o kernel preenche uma vez na inicialização. Um sistema Linux, por exemplo, tem várias centenas de números de chamada de sistema distintos; o xv6, sendo um kernel didático, tem perto de vinte, mas o mecanismo de despacho é idêntico independentemente do tamanho da tabela.

### Argumentos e valores de retorno cruzam através de registradores, não de uma pilha compartilhada

Chamadas de função comuns de espaço de usuário passam argumentos na pilha ou em registradores de acordo com a convenção de chamada da plataforma, e a função chamada pode ler livremente o quadro de pilha do chamador se precisar. Uma chamada de sistema não pode se apoiar nisso, porque o kernel executa em sua própria pilha de kernel separada após o trap, não na pilha de modo usuário do processo chamador, então os argumentos de chamada de sistema são convencionalmente passados num conjunto pequeno e fixo de registradores de propósito geral (seguindo a convenção de chamada do RISC-V no xv6, os argumentos após o próprio número de syscall vão em `a0` até `a6`), e o valor de retorno é colocado de volta em `a0` antes de o kernel retornar via `sret`. Esta é uma interface deliberada e mínima: exatamente registradores suficientes para carregar um punhado de argumentos escalares e um resultado escalar, com qualquer coisa maior (um buffer de bytes a escrever, por exemplo) passada como um *ponteiro* para a memória do usuário em um desses registradores em vez dos próprios dados.

```mermaid
sequenceDiagram
    participant App as Programa de usuário
    participant Lib as Invólucro write() da libc
    participant HW as Trap
    participant Kernel as Tratador de syscall do kernel
    App->>Lib: write(fd, buf, count)
    Lib->>Lib: coloca número de syscall em a7, args em a0-a2
    Lib->>HW: ecall
    HW->>Kernel: trap para entrada fixa do kernel, modo = kernel
    Kernel->>Kernel: lê a7, indexa na tabela de syscall
    Kernel->>Kernel: executa sys_write(fd, buf, count)
    Kernel->>HW: coloca valor de retorno em a0; sret
    HW->>Lib: retoma em modo usuário, na instrução após ecall
    Lib->>App: retorna o valor de a0 ao chamador
```

### Por que passar um ponteiro, não os próprios dados, prepara o próximo conceito

Como `buf` em `write(fd, buf, count)` é um ponteiro para o *próprio espaço de endereçamento do processo chamador*, e o kernel está agora executando com privilégio total de hardware após o trap, o kernel precisa de algum modo ler `count` bytes começando nesse endereço fornecido pelo usuário, um endereço que o kernel não controla e, criticamente, não pode simplesmente confiar que seja válido, dentro dos limites, ou mesmo genuinamente apontando para memória que o processo chamador de fato possui. Esta é exatamente a preocupação que o próximo conceito, validar a entrada do usuário na fronteira do kernel, assume por completo: o mero fato de um ponteiro ter chegado em um registrador não o torna seguro de desreferenciar.

## Exemplos Resolvidos

### Exemplo 1: Despacho de chamada de sistema no estilo xv6, simplificado

```c
// Invólucro de biblioteca em espaço de usuário (simplificado; o código real costuma estar em assembly)
int write(int fd, const void *buf, int count) {
    // coloca número de syscall, invoca o trap, recupera o resultado
    return syscall(SYS_write, fd, buf, count);
}

// Kernel: a tabela de chamadas de sistema
static uint64 (*syscalls[])(void) = {
    [SYS_fork]  sys_fork,
    [SYS_exit]  sys_exit,
    [SYS_write] sys_write,
    // ... uma entrada por chamada de sistema suportada
};

// Kernel: despacho, chamado a partir do tratador de trap uma vez que scause
// identifica este trap como uma chamada de sistema (não uma interrupção/exceção)
void syscall_dispatch(struct trapframe *tf) {
    int num = tf->a7;               // qual chamada de sistema?
    if (num > 0 && num < NELEM(syscalls) && syscalls[num]) {
        tf->a0 = syscalls[num]();   // chama-a, guarda o resultado em a0
    } else {
        tf->a0 = -1;                 // número de syscall desconhecido
    }
}
```

### Exemplo 2: Um layout concreto de registradores para `write(1, "hi\n", 3)`

```text
Registrador  Contém
----------  -------------------------------------------
a7          número de SYS_write (ex. 16)
a0          fd = 1 (stdout)
a1          buf = 0x7ffff7a01000 (um endereço virtual de usuário)
a2          count = 3

Depois que o kernel roda sys_write e retorna:
a0          3 (bytes de fato escritos), ou um código de erro negativo
```

### Exemplo 3: Por que um número de syscall inventado é rejeitado com segurança

```text
Código de usuário malicioso ou com bug define a7 = 9999 (não existe tal syscall)
e executa ecall.

Despacho do kernel: 9999 >= NELEM(syscalls), então a verificação de limites falha.
O kernel retorna -1 (ou um erro equivalente de "chamada de sistema inválida") em a0,
SEM NUNCA chamar através de um ponteiro de função não inicializado ou fora dos limites.
```

Esta verificação de limites é uma instância pequena mas real de um tema muito maior ao qual esta disciplina retorna explicitamente no próximo conceito: o kernel precisa tratar todo valor que chega do modo usuário, incluindo algo tão simples quanto um número de syscall, como entrada não confiável que exige validação antes do uso.

## Equívocos Comuns e Armadilhas

- **"Chamar `write()` em código C invoca diretamente o kernel."** Ele chama primeiro uma função invólucro de biblioteca comum e sem privilégio; o trap de cruzamento de privilégio de fato só acontece dentro desse invólucro, quando ele executa a instrução de trap.
- **"Os argumentos de chamada de sistema são passados da mesma forma que os argumentos de função comuns, na pilha."** Eles são convencionalmente passados num pequeno conjunto de registradores designados, porque o kernel roda em sua própria pilha de kernel separada após o trap e não pode ler a pilha do programa de usuário como uma função chamada comum poderia.
- **"O kernel recebe os bytes reais sendo escritos, não um ponteiro."** Para qualquer coisa além de um punhado de valores escalares, o kernel recebe um ponteiro para o próprio espaço de endereçamento do processo chamador e precisa explicitamente ler dessa memória de usuário por conta própria: ele não recebe uma cópia de dados arbitrariamente grandes através de registradores.
- **"Todo inteiro colocado no registrador de número de syscall corresponde a alguma rotina de kernel válida."** O kernel precisa verificar os limites do número de syscall antes de usá-lo para indexar a tabela de chamadas de sistema, exatamente como qualquer outra entrada não confiável que chega do modo usuário.

## Resumo

A anatomia real de uma chamada de sistema envolve três fases distintas: uma função invólucro de biblioteca em espaço de usuário (código comum e sem privilégio) que empacota os argumentos em registradores e executa a instrução de trap de fato; o próprio trap, cruzando para o modo kernel num ponto de entrada fixo; e o próprio código de despacho do kernel, que lê um número de chamada de sistema de um registrador designado, verifica seus limites e o usa para indexar uma tabela de chamadas de sistema preenchida na inicialização. Argumentos e o valor de retorno cruzam a fronteira usuário/kernel através de um pequeno conjunto de registradores em vez de uma pilha compartilhada, e qualquer coisa maior que um valor escalar é passada como um ponteiro para o próprio espaço de endereçamento do processo chamador, um ponteiro que o kernel precisa tratar como não confiável, que é exatamente de onde o próximo conceito parte.

## Documentation Links

- [MIT 6.S081 xv6 book: Traps, Interrupts, and Drivers](https://pdos.csail.mit.edu/6.S081/2021/xv6/book-riscv-rev2.pdf): a mecânica real de tabela de syscall e de despacho de trap da qual os exemplos resolvidos deste conceito são adaptados.
- [MIT 6.S081: Lab: System Calls](https://pdos.csail.mit.edu/6.S081/2021/labs/syscall.html): a atividade real em que os alunos adicionam uma nova chamada de sistema à tabela de despacho do xv6.
