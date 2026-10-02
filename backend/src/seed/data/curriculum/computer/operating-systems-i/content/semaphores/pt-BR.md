---
version: 1.0
updatedAt: 2026-09-06
title: Semáforos
summary: "Um único contador inteiro com duas operações atômicas, wait e signal, geral o bastante para implementar um lock, a sinalização de uma variável de condição ou um limite de quantas threads podem prosseguir ao mesmo tempo: a única primitiva de Dijkstra que faz o trabalho de várias."
---
## Objetivos de Aprendizagem

- Definir um semáforo como um contador inteiro com duas operações atômicas, `wait` (decremento) e `signal` (incremento), que bloqueia uma thread quando o contador ficaria negativo.
- Mostrar como um semáforo binário (inicializado em 1) implementa exatamente a mesma exclusão mútua que um lock oferece.
- Mostrar como um semáforo de contagem (inicializado em N) implementa um limite de quantas threads podem prosseguir ao mesmo tempo, generalizando para além da simples exclusão mútua.
- Usar um semáforo para resolver o problema do produtor-consumidor, e comparar o resultado com a solução de lock mais variável de condição do conceito anterior.

## Contexto e Motivação

Os locks resolvem a exclusão mútua; as variáveis de condição resolvem a espera por uma condição arbitrária; mas usá-los corretamente juntos, como o exemplo do produtor-consumidor mostrou, exige cuidado (um lock, duas variáveis de condição e a reverificação num laço while, tudo coordenado à mão). O **semáforo** de Edsger Dijkstra, apresentado décadas antes de locks e variáveis de condição serem formalizados como primitivas separadas, é uma única ferramenta geral o bastante para expressar os dois trabalhos: um contador inteiro com duas operações atômicas, tradicionalmente chamadas de `P` (do holandês *proberen*, "testar", hoje mais comumente chamada de `wait`) e `V` (*verhogen*, "aumentar", hoje mais comumente `signal`). O notável no semáforo, como este conceito mostra concretamente, é que as *mesmas* duas operações, diferindo só no valor inicial do contador, conseguem implementar tanto um lock quanto a lógica de espera limitada do buffer de um produtor-consumidor.

## Teoria Central

### As duas operações do semáforo

Um semáforo guarda um único valor inteiro e suporta:

- **`wait(s)`** (decremento): decrementa de forma atômica o valor do semáforo; se o valor resultante for negativo, a thread chamadora bloqueia até que alguma outra thread chame `signal`.
- **`signal(s)`** (incremento): incrementa de forma atômica o valor do semáforo; se houver threads bloqueadas esperando, uma delas é acordada.

As duas operações têm atomicidade garantida pela própria implementação do semáforo (construída, no fim, sobre o mesmo tipo de instruções atômicas de hardware ou de estado interno protegido por lock já visto para os locks); uma thread nunca precisa se preocupar com sua própria chamada de `wait` ou `signal` ser interrompida no meio.

### Semáforos binários: exatamente um lock

Inicialize um semáforo em `1` e use-o em volta de uma seção crítica exatamente como um lock:

```c
sem_t lock;
sem_init(&lock, 1);   // valor inicial 1

wait(&lock);      // decrementa para 0 se estiver livre; se já estiver em 0, decrementa
                   // para -1 e bloqueia (outra thread o segura)
    counter++;     // seção crítica
signal(&lock);     // incrementa de volta em direção a 1, acordando uma thread bloqueada, se houver
```

A primeira thread a chamar `wait` decrementa o semáforo de 1 para 0 e prossegue (sem bloquear, já que o valor não ficou negativo). Uma segunda thread chamando `wait` antes de a primeira chamar `signal` decrementa de 0 para −1 e bloqueia. Quando a primeira thread chama `signal`, o valor sobe de −1 de volta para 0, e a thread bloqueada é acordada; reproduzindo exatamente o comportamento de exclusão mútua de `acquire`/`release` de um lock, com o `wait` fazendo o papel de `acquire` e o `signal` fazendo o papel de `release`.

### Semáforos de contagem: limitando quantas threads prosseguem ao mesmo tempo

Inicialize um semáforo com algum valor `N > 1`, e as *mesmas* duas operações passam a limitar quantas threads podem estar "dentro" ao mesmo tempo a no máximo `N`, em vez de exatamente 1:

```c
sem_t pool;
sem_init(&pool, 5);   // no máximo 5 threads podem segurar uma conexão ao mesmo tempo

wait(&pool);      // prossegue se menos de 5 estiverem "emprestadas" no momento;
                   // bloqueia quando a 5ª já está emprestada e uma 6ª tenta
    use_connection();
signal(&pool);     // devolve uma vaga, acordando uma thread bloqueada, se houver
```

Essa é uma generalização genuína que um lock simples não consegue expressar sozinho: um lock é intrinsecamente uma ferramenta de "um de cada vez", enquanto um semáforo de contagem com valor inicial `N` limita naturalmente o acesso concorrente a um pool de recursos de tamanho `N` (um número fixo de conexões de banco de dados, um número fixo de vagas de trabalho), usando exatamente a mesma interface `wait`/`signal` do caso de exclusão mútua, diferindo só na contagem inicial.

### Semáforos como espera no estilo de variável de condição

Como o `wait` bloqueia uma thread sempre que o contador ficaria negativo, um semáforo inicializado em `0` consegue expressar diretamente "espere até que alguém diga que isto está pronto": uma thread chama `wait` e bloqueia imediatamente (0 decrementa para −1), até que o `signal` de outra thread a libere. Isso é funcionalmente parecido com o par `wait`/`signal` de uma variável de condição, mas com a contagem embutida diretamente no próprio estado do semáforo, em vez de exigir uma condição booleana acompanhada separadamente e conferida sob um lock.

## Exemplos Resolvidos

### Exemplo 1: produtor-consumidor usando dois semáforos de contagem

```c
sem_t empty, full;
sem_init(&empty, BUFFER_SIZE);   // começa em N: N vagas vazias disponíveis
sem_init(&full, 0);               // começa em 0: nenhuma vaga cheia ainda

void producer() {
    while (1) {
        int item = produce_item();
        wait(&empty);          // bloqueia se o buffer tiver 0 vagas vazias
        add_to_buffer(item);
        signal(&full);         // agora existe mais uma vaga cheia
    }
}

void consumer() {
    while (1) {
        wait(&full);           // bloqueia se o buffer tiver 0 vagas cheias
        int item = remove_from_buffer();
        signal(&empty);        // agora existe mais uma vaga vazia
        consume_item(item);
    }
}
```

`empty` começa em `BUFFER_SIZE` e é decrementado pelas produtoras (que precisam de uma vaga vazia para preencher) e incrementado pelas consumidoras (que liberam uma); `full` começa em `0` e é decrementado pelas consumidoras (que precisam de uma vaga cheia para retirar) e incrementado pelas produtoras (que criam uma). Uma produtora bloqueia automaticamente quando o buffer fica completamente cheio (`empty` foi decrementado até o ponto em que ficaria negativo); uma consumidora bloqueia automaticamente quando o buffer fica completamente vazio (`full` ficaria negativo); a lógica de espera limitada que exigia uma verificação explícita de condição num laço `while` sob um lock no conceito anterior sai diretamente da própria contagem dos semáforos aqui.

### Exemplo 2: acompanhando os valores num buffer pequeno (tamanho 2)

Estado inicial: `empty = 2`, `full = 0`, o buffer tem 0 itens.

```text
A produtora acrescenta o item 1: wait(empty) -> empty=1; acrescenta; signal(full) -> full=1
A produtora acrescenta o item 2: wait(empty) -> empty=0; acrescenta; signal(full) -> full=2
A produtora tenta o item 3:      wait(empty) -> iria para -1 -> BLOQUEIA (buffer cheio)

A consumidora retira o item 1: wait(full) -> full=1; retira; signal(empty) -> empty=1
  Esse signal(empty) acorda a produtora bloqueada acima, que agora completa com
  sucesso seu wait(empty), decrementando empty para 0.
```

O bloqueio da produtora e o desbloqueio posterior feito pela consumidora acontecem puramente pelos contadores dos semáforos cruzando o zero em cada direção; nenhuma flag compartilhada explícita de "o buffer está cheio?" precisa ser conferida separadamente, ao contrário do `while (buffer_is_full())` da versão com variáveis de condição.

### Exemplo 3: semáforo vs. lock mais variável de condição, lado a lado

```text
Lock + variáveis de condição (conceito anterior):
  - 1 lock protegendo diretamente o estado compartilhado do buffer
  - 2 variáveis de condição (not_full, not_empty)
  - Reverificação explícita, num laço while, de buffer_is_full()/buffer_is_empty()
    depois de cada wait()

Semáforos (este conceito):
  - 2 semáforos de contagem (empty, full), cujas próprias contagens internas
    representam diretamente "quantas vagas vazias/cheias existem"
  - Não é preciso uma verificação de condição separada num laço while: a própria
    operação wait() do semáforo bloqueia exatamente quando a contagem ficaria
    negativa, e ISSO É a condição
```

As duas soluções resolvem corretamente o mesmíssimo problema do produtor-consumidor; a versão com semáforos embute a verificação da condição diretamente na semântica do próprio contador, enquanto a versão com lock e variáveis de condição mantém a condição como uma expressão booleana explícita, conferida separadamente; uma escolha de projeto real, com implicações para a legibilidade e para quão naturalmente a solução se generaliza (um semáforo de contagem que captura "N vagas" costuma encaixar de forma mais direta que uma condição booleana conferida num laço).

## Equívocos Comuns e Armadilhas

- **"Um semáforo é fundamentalmente diferente de um lock."** Um semáforo binário (valor inicial 1) se comporta exatamente como um lock: `wait` e `signal` reproduzem com precisão `acquire` e `release`, como o primeiro exemplo acompanha. Um semáforo é uma generalização, e não uma alternativa sem relação.
- **"Os semáforos substituem a necessidade de locks em toda situação."** Os semáforos conseguem expressar a exclusão mútua, mas um lock mutex simples costuma ser mais simples e mais claro quando é genuinamente só disso que se precisa; os semáforos justificam sua complexidade especificamente quando a contagem (limitar o acesso concorrente a N recursos) é o requisito real.
- **"O `wait` sempre bloqueia a thread chamadora."** O `wait` só bloqueia se decrementar o valor do semáforo o deixasse negativo; se o valor ainda for zero ou positivo depois do decremento, a thread prossegue imediatamente sem bloquear, exatamente como a primeira chamada bem-sucedida no exemplo do lock com semáforo binário.
- **"Inicializar um semáforo de contagem com um número grande não tem efeito real."** O valor inicial determina diretamente quantas threads conseguem prosseguir ao mesmo tempo antes que alguma delas bloqueie: inicializar em 1 dá acesso exclusivo no estilo de lock; inicializar em N permite de fato até N threads de uma vez, uma decisão de projeto real e com consequências, e não um detalhe cosmético.

## Resumo

Um semáforo é a primitiva de sincronização única e geral de Dijkstra: um contador inteiro com duas operações atômicas, `wait` (decremento, bloqueando se o resultado ficaria negativo) e `signal` (incremento, acordando uma thread bloqueada, se houver). Inicializado em 1, ele se comporta exatamente como um lock, oferecendo exclusão mútua; inicializado em N, as mesmas duas operações limitam o acesso concorrente a no máximo N threads de uma vez, uma generalização genuína além do que um lock simples consegue expressar. Aplicados ao problema do produtor-consumidor, dois semáforos de contagem (`empty` e `full`) embutem a condição de cheio/vazio do buffer diretamente nas próprias contagens dos semáforos, evitando a verificação explícita de condição num laço while que a solução com lock e variáveis de condição exigia. Com a exclusão mútua (locks), a espera baseada em condição (variáveis de condição) e esta única primitiva geral de contagem (semáforos) cobertas, o próximo conceito se volta para um modo de falha que só se torna possível quando vários locks ou semáforos são combinados: o deadlock, em que threads esperam umas pelas outras num ciclo, para sempre.

## Documentation Links

- [Arpaci-Dusseau: Operating Systems: Three Easy Pieces, "Semaphores"](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-sema.pdf): o tratamento canônico dos semáforos, das suas duas formas e da solução do produtor-consumidor a partir do qual este conceito é construído.
- [ACM/IEEE CS2013: Operating Systems Knowledge Area](https://csed.acm.org/knowledge-areas-operating-systems-os-cs2013-version/): diretrizes curriculares que cobrem os semáforos como uma primitiva central de sincronização.
