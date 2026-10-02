---
version: 1.0
updatedAt: 2026-09-06
title: Variáveis de Condição
summary: "Um lock sozinho não consegue deixar uma thread esperar que alguma condição se torne verdadeira sem ficar girando ocupada; uma variável de condição acrescenta exatamente isso: uma fila em que uma thread pode dormir, e um sinal que outra thread envia quando a espera acaba."
---
## Objetivos de Aprendizagem

- Explicar o que um lock sozinho não consegue fazer: deixar uma thread esperar de forma eficiente que alguma condição diferente de "este lock está livre?" se torne verdadeira.
- Descrever as duas operações de uma variável de condição, `wait()` e `signal()`, e como o `wait()` libera o lock de forma atômica ao ir dormir.
- Acompanhar o problema clássico do produtor-consumidor e explicar por que conferir a condição num laço `while`, e não num `if`, é necessário para a correção.
- Explicar por que uma thread sinalizada precisa reconferir sua condição depois de acordar, em vez de supor que ela agora é verdadeira.

## Contexto e Motivação

Os locks resolvem a exclusão mútua, mas não resolvem nada de uma necessidade diferente e igualmente comum: uma thread que precisa esperar até que alguma *condição* se torne verdadeira (uma fila deixou de estar vazia, um buffer tem espaço, um contador chegou a zero) antes de poder prosseguir de forma útil. O spin lock do conceito anterior poderia, tecnicamente, ser reaproveitado para isso, girando na própria condição, mas o exemplo resolvido de lá já mostrou o custo real de girar: queimar ciclos de CPU sem fazer nada de útil, possivelmente por muito tempo se a condição demorar a se tornar verdadeira. Uma **variável de condição** é a ferramenta construída especificamente para esse caso: ela deixa uma thread ir dormir de verdade (sem consumir CPU nenhuma) até que outra thread sinalize explicitamente que a condição pode agora valer.

## Teoria Central

### A interface da variável de condição

Uma variável de condição suporta duas operações centrais, sempre usadas junto com um lock associado:

- **`wait(cv, lock)`**: chamada enquanto se segura `lock`. Libera `lock` de forma atômica e põe a thread chamadora para dormir em `cv`, num único passo indivisível; quando a thread é acordada depois, ela readquire `lock` antes de o `wait()` retornar.
- **`signal(cv)`**: acorda uma thread que esteja dormindo em `cv` (se houver alguma esperando), permitindo que ela prossiga quando conseguir readquirir o lock.

A atomicidade do passo de liberar e dormir do `wait()` é essencial: se liberar o lock e ir dormir fossem dois passos separados, um sinal poderia chegar no vão entre eles e se perder por completo, já que nada ainda estaria escutando por ele; é precisamente o tipo de perigo de intercalação contra o qual o conceito do problema da seção crítica já alertou, agora reaparecendo no próprio mecanismo de espera, caso ele não fosse construído corretamente.

### Por que o `wait()` precisa liberar o lock, e de forma atômica

Uma thread que chama `wait()` já está, por definição, segurando o lock que protege o estado compartilhado que ela está conferindo (foi assim que ela conferiu a condição com segurança em primeiro lugar). Se o `wait()` simplesmente bloqueasse a thread *sem* liberar o lock, nenhuma outra thread jamais conseguiria adquirir esse lock para mudar o estado compartilhado e acabar chamando `signal()`: o sistema entraria em deadlock imediatamente, com a thread em espera segurando um lock que nada mais consegue obter para fazer progresso na condição pela qual ela espera. O `wait()`, portanto, libera o lock como parte de ir dormir, deixando outras threads prosseguirem e acabarem mudando a condição, e então readquire o lock automaticamente quando acordada, de modo que a thread retoma segurando o lock de novo, exatamente como se tivesse acabado de voltar de um `acquire()` comum.

### O problema do produtor-consumidor

Um cenário clássico que as variáveis de condição resolvem diretamente: uma ou mais threads **produtoras** acrescentam itens a um buffer compartilhado e limitado; uma ou mais threads **consumidoras** retiram itens dele. Uma produtora precisa esperar se o buffer estiver cheio; uma consumidora precisa esperar se o buffer estiver vazio. Normalmente são usadas duas variáveis de condição (uma para "buffer não cheio", em que as produtoras esperam, e uma para "buffer não vazio", em que as consumidoras esperam), cada uma pareada com o único lock que protege o estado do buffer compartilhado.

```mermaid
sequenceDiagram
    participant P as Thread produtora
    participant L as Lock + estado do buffer
    participant C as Thread consumidora
    P->>L: acquire(lock)
    P->>L: while (buffer cheio) wait(notFull, lock)
    P->>L: acrescenta item; signal(notEmpty)
    P->>L: release(lock)
    C->>L: acquire(lock)
    C->>L: while (buffer vazio) wait(notEmpty, lock)
    C->>L: retira item; signal(notFull)
    C->>L: release(lock)
```

### Por que a verificação da condição precisa ser um laço `while`, e não um `if`

Uma regra de correção sutil, mas crítica: depois que o `wait()` retorna (a thread foi acordada e readquiriu o lock), a thread precisa **reconferir** a condição pela qual esperava, usando um laço `while` em vez de uma verificação única com `if`, porque ser acordada não garante que a condição ainda seja verdadeira quando essa thread específica de fato chegar a rodar. Entre a chamada de `signal()` e a retomada desta thread, alguma *outra* thread pode ter entrado na corrida, adquirido o lock primeiro e mudado o estado compartilhado de volta (uma consumidora pode ter pegado o item recém-disponível antes que esta consumidora tivesse sua vez, por exemplo). Um laço `while` reverifica a condição e volta a dormir se ela não valer mais; um `if` seguiria em frente incorretamente com base numa suposição agora falsa.

## Exemplos Resolvidos

### Exemplo 1: uma produtora correta, usando um laço `while`

```c
void producer(void *arg) {
    while (1) {
        int item = produce_item();

        acquire(&lock);
        while (buffer_is_full()) {
            wait(&not_full, &lock);   // de forma atômica: libera o lock e dorme;
                                       // ao acordar: readquire o lock, e então
                                       // volta ao laço e reconfere a condição
        }
        add_to_buffer(item);
        signal(&not_empty);           // acorda uma consumidora, se houver alguma esperando
        release(&lock);
    }
}
```

O laço `while (buffer_is_full())`, e não um único `if`, é o que garante a correção: mesmo depois de ser sinalizada e acordar, esta produtora reconfere se o buffer *de fato* não está cheio agora antes de prosseguir e acrescentar seu item, protegendo contra o caso em que outra produtora entrou na corrida e encheu o buffer de novo nesse meio-tempo.

### Exemplo 2: acompanhando por que `if` em vez de `while` quebra com várias consumidoras

Suponha que duas consumidoras, C1 e C2, estejam ambas esperando em `not_empty` porque o buffer está vazio, e que uma única produtora acrescente exatamente um item e chame `signal(&not_empty)`:

```text
t0: A produtora acrescenta 1 item e chama signal(not_empty): acorda UMA consumidora em espera (digamos C1)
t1: C1 é acordada, mas antes de C1 de fato rodar e readquirir o lock,
    suponha que o SO escalone C2 primeiro por algum outro motivo
    (o signal() só promete acordar uma thread em espera, não uma ordem de execução específica)
t2: Se C2 usar "if (buffer_is_empty()) wait(...)" em vez de "while", e C2
    de algum jeito conferir o buffer DEPOIS de C1 já ter retirado o item
    (uma corrida genuína, dependendo de detalhes de implementação), C2 poderia
    prosseguir para remove_from_buffer() num buffer VAZIO: comportamento indefinido/incorreto.

Com "while (buffer_is_empty()) wait(...)": C2 reconferiria a condição depois de
qualquer despertar e voltaria corretamente a dormir se o buffer, de fato,
já estivesse vazio de novo quando C2 tivesse sua vez.
```

É precisamente por isso que o OSTEP e praticamente todo guia real de sincronização insistem em reconferir a condição num laço depois que o `wait()` retorna: um sinal é sempre só uma dica de que a condição *pode* agora ser verdadeira, nunca uma garantia de que ela ainda seja quando uma thread específica acordada retomar.

### Exemplo 3: o deadlock que a atomicidade do `wait()` impede

Suponha, incorretamente, que o `wait()` fosse implementado como dois passos separados (liberar o lock e *depois*, separadamente, ir dormir) em vez de uma única operação atômica:

```text
Consumidora:  acquire(lock)
              confere: o buffer está vazio
              release(lock)              <- lock liberado
              [VÃO: uma produtora poderia acrescentar um item E sinalizar aqui]
              vai dormir em not_empty    <- mas o sinal já aconteceu
                                             e agora se perdeu; nada está
                                             mais escutando por ele
```

Se o `signal()` de uma produtora cair exatamente nesse vão, a consumidora dorme para sempre, tendo perdido o único chamado para acordar que jamais seria enviado para aquele item: um bug clássico de **despertar perdido** (lost wake-up). Como as implementações reais de `wait()` fazem o liberar e dormir como um único passo atômico (não existe vão em que um sinal possa se perder), essa falha específica não pode acontecer; é exatamente contra isso que o requisito de atomicidade da seção Teoria Central deste conceito protege.

## Equívocos Comuns e Armadilhas

- **"Uma variável de condição substitui um lock."** Uma variável de condição é sempre usada *junto com* um lock, nunca no lugar de um: o `wait()` exige que o lock já esteja seguro (para poder conferir com segurança a condição compartilhada) e cuida de liberar e readquirir esse mesmo lock como parte da sua própria operação.
- **"Depois que o `wait()` retorna, a condição pela qual ele esperava é garantidamente verdadeira."** Não é garantida: outra thread pode ter mudado o estado compartilhado de novo antes de esta thread específica ser escalonada depois de acordar, e é exatamente por isso que a condição precisa ser reconferida num laço `while`, e não suposta verdadeira a partir de uma verificação com `if`.
- **"O `signal()` acorda todas as threads que esperam na variável de condição."** O `signal()` (às vezes chamado de `notify` em outras APIs) acorda no máximo uma thread em espera; acordar *todas* as threads em espera é uma operação diferente (muitas vezes chamada de `broadcast` ou `notifyAll`), usada quando a condição de mais de uma thread em espera pode valer ao mesmo tempo.
- **"Liberar o lock e ir dormir no `wait()` poderiam muito bem ser dois passos separados, por simplicidade."** Separá-los cria uma janela real para um despertar perdido, como o Exemplo 3 acompanha concretamente; a atomicidade desse passo de liberar e dormir é um requisito de correção, não uma conveniência de implementação.

## Resumo

Uma variável de condição deixa uma thread dormir (sem consumir CPU, ao contrário do giro já visto como o custo real dos locks) até que outra thread sinalize que alguma condição pode agora ser verdadeira, sempre usada junto com um lock: `wait(cv, lock)` libera o lock de forma atômica e dorme, e então readquire o lock ao ser acordada, e `signal(cv)` acorda uma thread em espera. O problema clássico do produtor-consumidor mostra o padrão completo: produtoras e consumidoras esperam cada uma na sua própria variável de condição, sempre dentro de um laço `while` em vez de um único `if`, porque a condição de uma thread acordada não é garantidamente verdadeira quando ela de fato retoma; outra thread pode ter entrado na corrida primeiro. A atomicidade do passo de liberar e dormir do `wait()` impede especificamente um despertar perdido, em que um sinal enviado no vão entre liberar o lock e de fato dormir sumiria sem ser ouvido. O próximo conceito, semáforos, apresenta uma única primitiva mais geral capaz de expressar tanto a exclusão mútua quanto esse tipo de espera baseada em condição com uma ferramenta unificada.

## Documentation Links

- [Arpaci-Dusseau: Operating Systems: Three Easy Pieces, "Condition Variables"](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-cv.pdf): o tratamento canônico de variáveis de condição, do problema do produtor-consumidor e da regra de correção do laço while a partir do qual este conceito é construído.
- [UC Berkeley CS162: Operating Systems and Systems Programming](https://cs162.org/): curso que cobre variáveis de condição como a ferramenta padrão de coordenação de threads baseada em condição.
