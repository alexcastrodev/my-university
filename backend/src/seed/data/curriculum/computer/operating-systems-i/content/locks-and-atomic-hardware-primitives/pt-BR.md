---
version: 1.0
updatedAt: 2026-09-06
title: Locks e Primitivas Atômicas de Hardware
summary: "Um lock só funciona se adquiri-lo for ele mesmo imune à mesma condição de corrida que ele impede, e é por isso que locks reais são construídos sobre instruções atômicas fornecidas pelo hardware, como test-and-set e compare-and-swap, e não sobre load/store comuns."
---
## Objetivos de Aprendizagem

- Definir a interface de um lock (`acquire`/`release`) e o que ele garante: só uma thread segura o lock por vez.
- Explicar por que a própria implementação de um lock não pode ser construída com instruções comuns de load/store, e o que o test-and-set oferece no lugar.
- Acompanhar como o test-and-set, como uma única instrução atômica garantida pelo hardware, implementa corretamente a exclusão mútua onde a flag ingênua do conceito anterior falhou.
- Distinguir um spin lock (espera ocupada) do custo de girar, e ligar esse custo ao motivo de as variáveis de condição (o próximo conceito) serem necessárias para esperas mais longas.

## Contexto e Motivação

O conceito anterior mostrou que um lock construído com instruções comuns de load e store não consegue fornecer corretamente a exclusão mútua: a sequência de conferir e depois marcar não é ela mesma atômica, então duas threads podem passar pela verificação ao mesmo tempo. A correção não é um arranjo mais esperto de instruções comuns; é um bloco de construção fundamentalmente diferente: os fabricantes de hardware fornecem **instruções atômicas** especiais, operações que a própria CPU garante que terminam como um único passo indivisível, sem que nenhum outro núcleo consiga observar ou interferir no meio do caminho. Os **locks** são construídos diretamente sobre essas primitivas atômicas, e entender essa base é o que deixa claro por que um lock de fato funciona onde uma flag ingênua não funcionou.

## Teoria Central

### A interface do lock

Um lock fornece exatamente duas operações: `acquire()`, que uma thread chama antes de entrar numa seção crítica (bloqueando, se necessário, até o lock ficar disponível), e `release()`, chamada depois de sair da seção crítica, deixando o lock disponível para alguma outra thread em espera. O código entre um par correspondente de `acquire()`/`release()` é, por construção, uma seção crítica protegida por aquele lock: no máximo uma thread pode estar executando entre seu próprio `acquire()` e `release()` no mesmo lock a qualquer momento, que é precisamente a propriedade de exclusão mútua que o conceito anterior exigia.

```text
acquire(&lock);
    counter++;          // seção crítica: protegida pelo lock
release(&lock);
```

### Test-and-set: uma instrução de hardware, feita de forma atômica

O **test-and-set** é uma única instrução de CPU que, como um passo indivisível garantido pelo hardware, lê o valor antigo de um local de memória *e* escreve um novo valor nele, devolvendo o valor antigo a quem chamou. Como a CPU garante que nenhum outro núcleo consegue observar ou se intercalar com essa instrução no meio do caminho, ela fecha exatamente a lacuna que quebrou a flag ingênua do conceito anterior: lá, "conferir a flag" e "marcar a flag" eram duas instruções separadas e interrompíveis; o test-and-set faz as duas como uma única instrução que o próprio hardware protege.

```text
// Comportamento conceitual de test-and-set(ptr, new_value):
int test_and_set(int *ptr, int new_value) {
    int old_value = *ptr;   // estes dois passos acontecem como UMA
    *ptr = new_value;       // operação de hardware atômica e indivisível
    return old_value;
}
```

Um spin lock simples construído sobre test-and-set:

```c
void acquire(int *lock) {
    while (test_and_set(lock, 1) == 1) {
        // o lock já estava seguro (valor antigo 1): continue girando
    }
    // test_and_set devolveu 0: o lock estava livre, e acabamos de colocá-lo em 1
    // de forma atômica, então agora o seguramos corretamente
}

void release(int *lock) {
    *lock = 0;
}
```

O argumento-chave de correção: exatamente uma chamada de `test_and_set` de uma thread pode ser a que observa o valor antigo `0` (o lock estava livre); como a instrução é atômica, não há como duas threads verem ambas `0` e seguirem como se tivessem adquirido o lock, ao contrário da flag ingênua de conferir e depois marcar do conceito anterior.

### Compare-and-swap: uma primitiva atômica mais geral

O **compare-and-swap (CAS)** generaliza o test-and-set: ele confere de forma atômica se um local de memória guarda no momento um valor *esperado* e, se sim, o substitui por um valor *novo*, de novo como um único passo indivisível de hardware, devolvendo se a troca teve sucesso. O CAS é mais flexível que o test-and-set porque o "valor esperado" pode ser qualquer coisa, e não só uma constante fixa; ele é a primitiva sobre a qual muitas estruturas de dados lock-free e ferramentas de sincronização de nível mais alto são construídas, e é a mesma família de instruções atômicas já apresentada pelo lado do hardware no tratamento de coerência de memória multinúcleo da disciplina `computer/computer-architecture` desta plataforma.

### Girar: correto, mas potencialmente desperdiçador

A implementação de lock acima **gira** (spins): uma thread que não consegue adquirir o lock de imediato fica num laço, tentando de novo repetidamente, em vez de ceder a CPU. Num único núcleo, girar enquanto outra thread segura o lock é puro desperdício: a thread que gira não faz progresso e impede a thread *que segura o lock* de rodar (até que uma interrupção de timer acabe forçando uma troca), atrasando exatamente aquilo pelo qual a thread que gira está esperando. Em vários núcleos, girar pode fazer sentido para seções críticas muito curtas (o lock provavelmente vai ser liberado muito em breve, e girar evita uma troca de contexto comparativamente cara); mas para seções críticas que podem segurar o lock por muito tempo, ou para esperar por condições diferentes de "este lock está livre?", girar vira desperdício de outro jeito, motivando a alternativa do próximo conceito: as variáveis de condição deixam uma thread ir dormir de verdade (sem girar) e ser acordada só quando a condição pela qual espera for de fato verdadeira.

## Exemplos Resolvidos

### Exemplo 1: por que o test-and-set tem sucesso onde a flag ingênua falhou

Lembre a falha do conceito anterior: `while (flag == 1) {}` seguido de `flag = 1` são duas instruções separadas, permitindo que duas threads vejam ambas `flag == 0` antes de qualquer uma marcá-la. Com test-and-set:

```text
Thread A: test_and_set(&lock, 1): lê 0, escreve 1 e devolve 0, de forma atômica
          A vê o valor devolvido 0 -> A segura o lock

Thread B (mesmo que chame test_and_set quase no mesmo instante):
          test_and_set(&lock, 1): lê o que A acabou de escrever (1), escreve 1
                                  de novo (sem efeito) e devolve 1, de forma atômica
          B vê o valor devolvido 1 -> B sabe que o lock já estava seguro e continua girando
```

Como a leitura e a escrita dentro do test-and-set não podem ser divididas pelo acesso intercalado de outro núcleo, não existe temporização possível em que A e B observem ambas o resultado "o lock estava livre"; exatamente a garantia que a flag ingênua não conseguia oferecer.

### Exemplo 2: um `counter++` corretamente protegido usando o lock acima

```c
int counter = 0;
int lock = 0;

void *increment(void *arg) {
    for (int i = 0; i < 100000; i++) {
        acquire(&lock);
        counter++;        // agora comprovadamente seguro: uma thread por vez
        release(&lock);
    }
    return NULL;
}
```

Ao contrário da versão sem proteção dos dois conceitos anteriores, cada `counter++` aqui acontece estritamente entre o `acquire` e o `release` de uma thread: o `test_and_set` de nenhuma outra thread consegue adquirir o lock até que esta thread chame `release`, então a sequência de três instruções `LOAD`/`ADD`/`STORE` nunca pode ser intercalada com a sequência idêntica de outra thread. Rodar esta versão com duas threads produz de forma confiável exatamente 200000, todas as vezes.

### Exemplo 3: o custo de girar num único núcleo, de forma concreta

Suponha que a thread A segure o lock e esteja prestes a ser preemptada por uma interrupção de timer depois de usar sua fatia de tempo inteira, e que a thread B esteja girando, esperando por esse mesmo lock, no mesmíssimo núcleo único:

```text
t=0..10:  A segura o lock, fazendo trabalho útil dentro da seção crítica
t=10:     Interrupção de timer: o escalonador escolhe B em seguida (round-robin, digamos)
t=10..20: B roda, mas B só fica girando (o test_and_set continua falhando, já que A
          ainda segura o lock): ZERO trabalho útil é feito durante essa fatia inteira
t=20:     Interrupção de timer: o escalonador escolhe A de novo
t=20..25: A termina sua seção crítica e chama release()
```

A fatia de tempo inteira de B, de t=10 a t=20, não fez nada além de queimar ciclos de CPU que poderiam ter ido para A (que de fato segura o lock e terminaria antes se simplesmente continuasse rodando): 10 unidades inteiras de puro desperdício, motivando diretamente por que uma thread com uma espera potencialmente longa deve dormir em vez de girar, o assunto do próximo conceito.

## Equívocos Comuns e Armadilhas

- **"Um lock é só uma variável booleana compartilhada, conferida e marcada com código comum."** O conceito anterior mostrou exatamente por que load/store comuns não conseguem implementar um lock correto; o `acquire()` de um lock real é construído sobre uma instrução atômica garantida pelo hardware (test-and-set ou compare-and-swap), e não sobre uma sequência desprotegida de conferir e depois marcar.
- **"Test-and-set e compare-and-swap são técnicas de software."** Os dois são instruções de CPU específicas, garantidas como atômicas pelo próprio hardware; nenhuma sequência só de software, com instruções comuns, consegue oferecer a mesma garantia, e é exatamente por isso que existe suporte de hardware dedicado.
- **"Girar é sempre desperdício e nunca deve ser usado."** Para seções críticas muito curtas, especialmente em hardware de vários núcleos em que o lock provavelmente vai ser liberado quase de imediato, girar pode ser mais rápido que a sobrecarga de uma troca de contexto completa para dormir e depois ser acordada; o trade-off depende de quanto tempo a espera provavelmente vai durar, e não de uma regra geral.
- **"Quando uma thread adquire um lock por test-and-set, o lock garante justiça (espera limitada) automaticamente."** O spin lock simples mostrado aqui garante a exclusão mútua, mas não diz nada sobre *qual* thread em espera fica com o lock em seguida quando ele é liberado; uma implementação ingênua pode, em princípio, deixar algumas threads esperando muito mais que outras; garantir espera limitada costuma exigir estrutura adicional (como uma fila de threads em espera), e não só uma instrução atômica.

## Resumo

Um lock fornece `acquire()`/`release()`, garantindo exclusão mútua para o código que rodar entre eles; mas um lock correto não pode ser construído com instruções comuns de load/store, porque o conceito anterior mostrou exatamente como uma sequência de conferir e depois marcar deixa duas threads passarem. A correção é uma **instrução atômica** garantida pelo hardware: o test-and-set, que lê e sobrescreve um local de memória de forma atômica, como um único passo indivisível, ou o compare-and-swap, mais geral, fechando a lacuna que quebrou a flag ingênua. Um lock construído assim de fato funciona, como acompanhado nos exemplos resolvidos, mas uma thread que não consegue adquiri-lo de imediato precisa decidir como esperar: **girar** (laço ocupado) desperdiça ciclos de CPU que poderiam ir para quem de fato segura o lock, o que custa especialmente caro num único núcleo ou em esperas potencialmente longas, motivando o próximo conceito, as variáveis de condição, que deixam uma thread dormir em vez de girar e ser acordada precisamente quando a condição de que ela precisa for verdadeira.

## Documentation Links

- [Arpaci-Dusseau: Operating Systems: Three Easy Pieces, "Locks"](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-locks.pdf): o tratamento canônico da implementação de locks e das primitivas atômicas de hardware a partir do qual este conceito é construído.
- [UC Berkeley CS162: Operating Systems and Systems Programming](https://cs162.org/): curso que cobre test-and-set, compare-and-swap e spin locks como a base de hardware da sincronização.
