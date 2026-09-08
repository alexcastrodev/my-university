---
version: 1.0
updatedAt: 2026-08-20
title: "Filas de Tarefa e Jobs Atrasados no Redis"
summary: Redis in Action constrói dois padrões de fila de tarefa ad hoc diretamente a partir de tipos de dado centrais: uma fila FIFO em uma LIST (RPUSH/BLPOP, com várias lists dando faixas de prioridade baratas) e uma fila atrasada/agendada em um ZSET com score de timestamp de execução, com polling manual já que ZSETs não têm pop bloqueante. Os dois permanecem estruturalmente atuais segundo a própria documentação de fila de trabalho do Redis, mas o consumidor BLPOP simples que esta seção do livro usa não tem recuperação de crash para um worker que morre no meio de um job: a lacuna que os consumer groups do Streams (e bibliotecas de produção como Sidekiq, BullMQ, e Redisson) fecham nativamente.
---
## Objective

Aprender os dois padrões de fila de tarefa ad hoc que *Redis in Action* constrói diretamente a partir de tipos de dado centrais (nenhum produto de fila dedicado, nenhum Streams, só uma `LIST` e um `ZSET` usados deliberadamente) e entender exatamente o que cada um compra e o que não compra. O livro enquadra a ideia inteira claramente: "ao lidar com requisições de clientes web, às vezes operações levam mais tempo para executar do que gostaríamos de gastar imediatamente. Podemos adiar essas operações colocando informação sobre nossa tarefa a ser realizada dentro de uma fila, que processamos depois. Esse método de adiar trabalho para algum processador de tarefa é chamado de fila de tarefa." O primeiro padrão é uma fila first-in, first-out construída a partir de `RPUSH`/`BLPOP` em uma `LIST`. O segundo a estende com atraso e agendamento, usando um `ZSET` com score de timestamp de execução porque "normalmente quando falamos sobre tempos, geralmente começamos a falar sobre ZSETs." **Essa é a camada mais antiga e simples de enfileiramento do Redis**: o conceito irmão `redis-streams` cobre a evolução mais nova e mais robusta da mesma ideia: os consumer groups do Streams adicionam confirmação por mensagem e recuperação automática de crash, fechando uma lacuna para a qual essa abordagem baseada em List nunca teve uma resposta nativa. Entender essa lacuna (e exatamente onde ela morde) é tanto o ponto deste conceito quanto a mecânica em si.

## Use Cases

- **Adiar uma operação lenta e propensa a falha para fora do caminho de requisição**: o exemplo corrente do livro é exatamente isso: email de saída "é um daqueles serviços de internet que podem ter latências muito altas e podem falhar", então uma venda de marketplace empurra um blob JSON `{'seller_id', 'item_id', 'price', 'buyer_id', 'time'}` em `queue:email` em vez de enviar o email inline, e um processo worker separado o esvazia.
- **Um único worker genérico despachando muitos tipos de tarefa diferentes por nome**: em vez de uma fila por operação, o `worker_watch_queue()` do livro desempacota cada item como `['FUNCTION_NAME', [ARG1, ARG2, ...]]` e chama qualquer callback registrado que corresponda, então um pool de worker consegue rodar envios de email, notificações, e qualquer outro job que caiba no mesmo envelope.
- **Prioridades de tarefa em grão grosso sem uma estrutura de dado de fila de prioridade**: passar vários nomes de lista para `BLPOP`/`BRPOP` (`high`, `medium`, `low`) e deixar a própria semântica do Redis ("a primeira LIST a ter algum item nela vai ter seu primeiro item removido") fazer a priorização, sem contabilidade extra necessária.
- **Agendar trabalho para um horário futuro específico**: o próprio exemplo de recurso do livro é venda atrasada: "em vez de colocar um item à venda agora, jogadores podem dizer ao jogo para colocar um item à venda no futuro", que precisa de uma fila que entenda *quando*, não só *se*, um item deveria rodar.
- **Uma alternativa leve a montar um broker dedicado**: o livro explicitamente enquadra isso como a opção ad hoc ao lado de "muitas peças de software diferentes projetadas especificamente para filas de tarefa (ActiveMQ, RabbitMQ, Gearman, Amazon SQS, e outros)", útil quando um projeto já depende do Redis e não quer uma segunda peça de infraestrutura só para mover jobs alguns saltos.

## Deep Dive

### Filas first-in, first-out: RPUSH entra, BLPOP sai

A fila FIFO é uma `LIST` comum, empurrada em uma ponta e removida da outra: "vamos empurrar emails para enviar para a ponta direita da fila com RPUSH, e removê-los da ponta esquerda da fila com LPOP. (Fazemos isso porque faz sentido visualmente para leitores de linguagens da esquerda para a direita.)" Como o trabalho inteiro de um processo worker é ficar sentado nessa fila, o livro recorre ao pop bloqueante em vez de fazer polling: "vamos usar a versão bloqueante do nosso pop de list, BLPOP, com um timeout de 30 segundos." Um timeout de 30 segundos no `BLPOP` não é arbitrário: é um despertar periódico para que o loop `while not QUIT` do worker ainda consiga perceber um sinal de desligamento mesmo quando a fila está vazia, em vez de bloquear para sempre.

```python
def send_sold_email_via_queue(conn, seller, item, price, buyer):
    data = {
        'seller_id': seller, 'item_id': item, 'price': price,
        'buyer_id': buyer, 'time': time.time()
    }
    conn.rpush('queue:email', json.dumps(data))          # producer

def process_sold_email_queue(conn):
    while not QUIT:
        packed = conn.blpop(['queue:email'], 30)          # consumer
        if not packed:
            continue
        to_send = json.loads(packed[1])
        try:
            fetch_data_and_send_sold_email(to_send)
        except EmailSendError as err:
            log_error("Failed to send sold email", err, to_send)
        else:
            log_success("Sent sold email", to_send)
```

**Como o Redis só entrega um item removido a um único chamador**, o livro observa, "podemos ter certeza de que nenhum dos emails é duplicado e enviado duas vezes": essa atomicidade é real e de graça. Mas uma fila de propósito único como essa só escala para um tipo de job por list. A generalização é `worker_watch_queue()`: em vez de fixar no código "enviar um email", cada item enfileirado nomeia a função a chamar e seus argumentos, e o worker busca o nome em uma tabela de callback:

```python
def worker_watch_queue(conn, queue, callbacks):
    while not QUIT:
        packed = conn.blpop([queue], 30)
        if not packed:
            continue
        name, args = json.loads(packed[1])
        if name not in callbacks:
            log_error("Unknown callback %s" % name)
            continue
        callbacks[name](*args)
```

**Prioridades** saem de um recurso que `BLPOP`/`BRPOP` já têm: aceitar vários nomes de list em uma chamada e remover de qualquer uma que tenha itens primeiro: "lembre dos comandos BLPOP/BRPOP: podemos fornecer várias LISTs das quais remover um item; a primeira LIST a ter algum item nela vai ter seu primeiro item removido." Transformar três filas separadamente empurradas (`high`, `medium`, `low`) em um esquema de prioridade é uma mudança de uma linha em `worker_watch_queue()`: passe uma lista de nomes de fila em vez de um, e o `BLPOP` lida com a ordenação:

```python
def worker_watch_queues(conn, queues, callbacks):     # queues, plural, in priority order
    while not QUIT:
        packed = conn.blpop(queues, 30)
        if not packed:
            continue
        name, args = json.loads(packed[1])
        if name not in callbacks:
            log_error("Unknown callback %s" % name)
            continue
        callbacks[name](*args)
```

O livro é honesto de que isso não é uma fila de prioridade geral: é ordenação estrita entre um pequeno número fixo de raias, não prioridade por item dentro de uma raia, e sinaliza que "há situações em que várias filas são usadas como uma forma de separar itens de fila diferentes... sem nenhum desejo de ser 'justo'", onde uma aplicação pode querer reordenar a lista de fila ocasionalmente para que uma fila de crescimento rápido não deixe as outras sem recursos. Também aponta para fora em vez de reivindicar que isso é novidade: "se você está usando Ruby, pode usar um pacote open source chamado Resque que foi lançado pelos programadores do GitHub. Ele usa Redis para filas baseadas em Ruby usando lists, parecido com o que discutimos aqui."

### Tarefas atrasadas: um ZSET com score de horário de execução

Uma `LIST` não tem noção de "ainda não": tudo nela é elegível para pop imediatamente. Agendamento exige uma segunda estrutura, e o livro percorre três designs candidatos antes de escolher um:

> "Poderíamos incluir um horário de execução como parte dos itens de fila, e se um processo worker vê um item com um horário de execução mais tarde do que agora, ele pode esperar por um período breve e depois reenfileirar o item." Rejeitado, porque desperdiça o tempo do worker.
>
> "O processo worker poderia ter uma lista local de espera para quaisquer itens que já viu e que precisam ser executados no futuro..." Rejeitado, porque "se o processo worker travar por um motivo não relacionado, perdemos qualquer item de trabalho pendente que ele conhecia."
>
> "E se, para qualquer item que quiséssemos executar no futuro, o adicionássemos a um ZSET em vez de uma LIST, com seu score sendo o horário em que queremos que ele execute? Então teríamos um processo que checa por itens que deveriam ser executados agora, e se houver algum, o processo o remove do ZSET, adicionando-o à LIST de fila apropriada." A que o livro constrói, "porque é simples, direta, e podemos usar um lock da seção 6.2 para garantir que a movimentação é segura."

A segunda opção rejeitada é a importante de notar: é o mesmo modo de falha de "estado vive só na memória de um processo que pode travar" do qual este capítulo inteiro se afasta (veja a discussão de janela de crash do conceito irmão `redis-distributed-locking-and-semaphores`); o conserto, de novo, é colocar o estado no próprio Redis.

`execute_later()` é o lado produtor. Um item atrasado é uma quádrupla codificada em JSON (identificador único, fila de destino, nome de callback, e seus argumentos) e pousa ou na `LIST` (imediato) ou no `ZSET` `delayed:` (futuro), dependendo de um atraso ter sido solicitado:

```python
def execute_later(conn, queue, name, args, delay=0):
    identifier = str(uuid.uuid4())
    item = json.dumps([identifier, queue, name, args])
    if delay > 0:
        conn.zadd('delayed:', item, time.time() + delay)
    else:
        conn.rpush('queue:' + queue, item)
    return identifier
```

O lado consumidor é onde a limitação do ZSET aparece diretamente: "infelizmente, não há um método conveniente no Redis para bloquear em ZSETs até que um score seja menor do que o timestamp Unix atual, então precisamos fazer polling manualmente." `poll_queue()` busca o único item com menor score, checa se seu horário chegou, e, se sim, adquire um lock granular fino no identificador do item antes de movê-lo do ZSET para sua `LIST` de destino, para que dois pollers concorrentes não possam ambos mover (e duplicar) o mesmo item:

```python
def poll_queue(conn):
    while not QUIT:
        item = conn.zrange('delayed:', 0, 0, withscores=True)
        if not item or item[0][1] > time.time():
            time.sleep(.01)                     # nothing due yet — poll again
            continue

        item = item[0][0]
        identifier, queue, function, args = json.loads(item)

        locked = acquire_lock(conn, identifier)
        if not locked:
            continue                             # someone else is already moving it

        if conn.zrem('delayed:', item):
            conn.rpush('queue:' + queue, item)   # hand off to the FIFO queue
        release_lock(conn, identifier, locked)
```

Como mover itens para filas comuns é tudo que esse poller faz, "só precisamos ter um ou dois desses rodando a qualquer momento (em vez de tantos quantos temos workers), então nosso overhead de polling se mantém baixo." O `time.sleep(.01)` é um custo real e ajustável: um loop de polling apertado trocando CPU e idas e voltas ao Redis por precisão de agendamento, e o livro sinaliza o refinamento óbvio sem implementá-lo: "poderíamos adicionar um método adaptativo que aumenta o tempo de sleep quando não vê nenhum item por um tempo, ou poderíamos usar o horário em que o próximo item foi agendado para ajudar a determinar por quanto tempo dormir, limitando isso a 100 milissegundos."

**Respeitar prioridades para itens atrasados** reutiliza a mesma ideia das raias de prioridade da fila FIFO: lists `*-delayed` extras (`high-delayed`, `medium-delayed`, `low-delayed`) colocadas *antes* de seus equivalentes não atrasados na lista passada para `worker_watch_queues()`, para que uma tarefa cujo horário acabou de chegar pule na frente do backlog em seu nível de prioridade. O livro tem o cuidado de explicar por que isso usa `RPUSH` em uma raia atrasada dedicada em vez do aparentemente mais simples `LPUSH` direto na frente da fila existente: "suponha que todos os nossos workers estejam trabalhando em tarefas para a fila medium... suponha também que temos três tarefas atrasadas que são encontradas e recebem LPUSH na frente da fila medium. A primeira é empurrada, depois a segunda, e depois a terceira. Mas na fila medium, a terceira tarefa a ser empurrada vai ser executada primeiro, o que viola nossa expectativa de que coisas que queremos executar mais cedo deveriam ser executadas mais cedo." `LPUSH` inverte a ordenação entre itens empurrados em sequência; uma raia FIFO separada não.

### Livro vs. hoje

A documentação atual de [fila de trabalho do Redis](https://redis.io/docs/latest/develop/use-cases/job-queue/) confirma que os instintos arquiteturais centrais do livro ainda estão exatamente certos, treze anos depois: Lists para ordenação FIFO/LIFO, sorted sets para execução atrasada e por prioridade: "Rode filas FIFO, LIFO, de prioridade, e de execução atrasada em estruturas de dado centrais do Redis... Sorted sets (ZADD, ZRANGEBYSCORE) para execução atrasada e filas de prioridade, com score pelo timestamp de execução ou prioridade." O padrão de `ZSET` com score de horário de execução neste conceito é, estruturalmente, a mesma coisa que a própria documentação do Redis recomenda hoje.

O que mudou é o padrão de confiabilidade. A mesma documentação é explícita que uma fila de trabalho viável "precisa de entrega at-least-once, um handoff atômico de fila para worker, e uma forma de recuperar jobs de workers que travaram no meio do processamento": e ela nomeia o consumidor `BLPOP` simples que este conceito constrói como exatamente a lacuna: "se um processo worker trava depois que o RPOP removeu a mensagem mas antes de terminar de processá-la, essa mensagem é perdida." O conserto que o Redis documenta hoje é o mesmo que o conceito irmão `redis-core-data-types-strings-lists-hashes` cobre: fazer pop para uma lista de *processamento* com `BRPOPLPUSH` (ou seu substituto moderno e não obsoleto, `BLMOVE`) em vez de um `BLPOP` puro, para que o job reivindicado-mas-não-terminado de um worker que travou ainda esteja sentado em algum lugar encontrável, com um recuperador varrendo por entradas com timeout. Notavelmente, *esta seção específica do livro* (6.4, filas de tarefa) não recorre a esse idioma de jeito nenhum: ela usa `BLPOP`/`RPUSH` puros, sem lista de processamento: então a lacuna de segurança contra crash aqui está de fato um passo atrás do padrão de fila confiável que o próprio livro constrói duas seções antes no mesmo capítulo para locking.

**Onde o `redis-streams` se encaixa.** Mesmo o conserto de lista de processamento tem uma aresta manual: nada remove automaticamente um job da lista de processamento em caso de sucesso, e nada rastreia *quantas vezes* um job foi recuperado. Esse é precisamente o problema que o Streams resolve estruturalmente em vez de por convenção: a Pending Entries List de um consumer group rastreia posse por consumidor nativamente, `XACK` retira um job no instante em que ele genuinamente termina, e `XCLAIM`/`XAUTOCLAIM` reatribuem qualquer coisa deixada ociosa além de um limiar, tudo sem a aplicação precisar manter uma segunda lista à mão. A documentação atual do Redis lista isso diretamente entre os blocos de construção recomendados de hoje: "Streams com consumer groups para fan-out entre vários pools de worker com rastreamento de progresso independente." Para uma fila onde perder um job silenciosamente é inaceitável, ou onde mais de um pool de worker independente precisa ver o mesmo stream de job, Streams são a evolução mais robusta e com garantias de exatamente o padrão neste conceito; veja `redis-streams` para o mecanismo completo.

**Sistemas de produção hoje majoritariamente não fazem nenhuma das duas versões à mão.** A mesma documentação do Redis agora lista um ecossistema inteiro de bibliotecas mantidas construídas por cima dessas primitivas: Sidekiq e Resque para Ruby, Celery/RQ/Dramatiq para Python, Bull/BullMQ para Node.js, Asynq para Go, e para a JVM especificamente, Redisson e o repositório de job Redis do Spring Batch, encerrando com a mesma conclusão que o próprio livro já alcançou sobre filas de prioridade apontando para o Resque: "use bibliotecas estabelecidas (Sidekiq, Celery, Bull/BullMQ, RQ) que implementam padrões de fila confiável no Redis prontos para uso." O código do livro ainda é a forma certa de entender o que uma fila de tarefa do Redis precisa acertar; reproduzi-lo do zero em um sistema real majoritariamente significa resolver de novo a recuperação de crash que uma biblioteca mantida, ou o Streams, já resolveu.

## Trade-offs

- **A fila FIFO com `BLPOP` puro é genuinamente simples e genuinamente não segura contra crash.** Um item removido por `BLPOP` se foi do Redis no instante em que é retornado: se o worker morre antes de terminar o que quer que fosse fazer com ele, esse job se perde sem nenhum vestígio de que já existiu. O próprio capítulo do livro constrói o conserto para exatamente esse modo de falha (uma lista de processamento, ou por fim um lock) para um problema diferente duas seções antes; as filas da seção 6.4 não o aplicam. Recorra ao idioma `BRPOPLPUSH`/`BLMOVE`-para-uma-lista-de-processamento, ou ao Streams, no momento em que um job perdido é um incidente real e não uma perda rara aceitável.
- **Raias de prioridade baseadas em List são estritas, não justas.** Várias lists passadas para `BLPOP` garantem que um item de alta prioridade é sempre pego antes de um médio, mas não garantem que a raia de baixa prioridade jamais seja atendida sob carga sustentada de alta prioridade: o livro nomeia isso diretamente e sua única mitigação é reordenar manualmente a lista de fila ocasionalmente. Um escalonador verdadeiramente ponderado e justo está inteiramente fora do escopo desse padrão.
- **A fila atrasada de ZSET troca uma primitiva bloqueante por um loop de polling.** `LIST`s ganham `BLPOP` de graça; `ZSET`s não têm equivalente de "bloquear até que o menor score seja ≤ agora", então o poller gasta CPU e idas e voltas ao Redis checando `ZRANGE ... WITHSCORES` em um intervalo fixo (`time.sleep(.01)` no livro) haja ou não algo vencido. Esse é um custo real e ajustável: polling mais apertado significa latência de agendamento menor e carga maior; polling mais frouxo é o oposto; e é por isso que o livro recomenda rodar só um ou dois pollers em vez de um por worker.
- **`LPUSH`-para-a-frente parece a forma óbvia de priorizar uma tarefa atrasada e silenciosamente quebra a ordenação.** O próprio exemplo resolvido do livro (três tarefas atrasadas recebendo LPUSH em sequência executam em ordem reversa) vale a pena internalizar como uma lição geral sobre semântica de `LIST`, não só um fato sobre esse padrão: empurrar vários itens para a mesma ponta em sequência sempre inverte sua ordem relativa naquela ponta.
- **Esse padrão inteiro é um exercício de compreensão tanto quanto uma recomendação de produção hoje.** É a forma certa de entender o que uma fila Redis precisa acertar (handoff atômico, ordenação, atraso, prioridade), mas segundo a seção "Livro vs. hoje" acima, tanto a documentação atual do Redis quanto o próprio comentário do livro sobre o Resque apontam na mesma direção: sistemas de produção recorrem aos consumer groups do Streams quando a lacuna de recuperação de crash importa, ou a uma biblioteca mantida (Sidekiq, BullMQ, Celery, ou Redisson na JVM) que já codificou a versão confiável desse padrão, em vez de rederivá-lo do zero a partir de `LPUSH`/`BLPOP`/`ZADD`.

## Documentation Links

- [Josiah Carlson, "Redis in Action" (Manning, 2013), Chapter 6, "Application components in Redis," section 6.4 "Task queues" (6.4.1 First-in, first-out queues; 6.4.2 Delayed tasks), p. 134-140] - doc
- [Redis Documentation: Redis job queue (use case guide)](https://redis.io/docs/latest/develop/use-cases/job-queue/) - doc
- [Redis Documentation: LPUSH](https://redis.io/docs/latest/commands/lpush/) - doc
- [Redis Documentation: BLPOP](https://redis.io/docs/latest/commands/blpop/) - doc
- [Redis Documentation: BLMOVE (non-deprecated replacement for BRPOPLPUSH)](https://redis.io/docs/latest/commands/blmove/) - doc
- [Redis Documentation: ZADD](https://redis.io/docs/latest/commands/zadd/) - doc
- [Redis Documentation: ZRANGEBYSCORE](https://redis.io/docs/latest/commands/zrangebyscore/) - doc
- [Redis Documentation: Redis Streams (consumer groups, at-least-once delivery)](https://redis.io/docs/latest/develop/data-types/streams/) - doc
