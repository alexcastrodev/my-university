---
version: 1.0
updatedAt: 2026-11-04
title: "Gerenciamento de Grupo e View Synchrony"
summary: "Group membership como uma sequência de views acordadas, a comunicação view-synchronous e como o modelo de virtual synchrony se relaciona com a replicação baseada em consenso."
---
## Objetivos de Aprendizagem

- Definir group membership como uma sequência acordada de views, e distinguir serviços de componente primário de serviços particionáveis.
- Enunciar Same View Delivery, Sending View Delivery e a propriedade Virtual Synchrony, e conferi-las num trace.
- Explicar como o Isis transforma uma suspeita imperfeita num evento com autoridade, quanto isso custa e por que o membership não escapa dos resultados de impossibilidade.
- Relacionar a comunicação view-synchronous com a replicação baseada em consenso, incluindo a lacuna de irrevogabilidade e a regra de entrega mais forte que a fecha.

## Contexto e Motivação

`failure-detectors` deu a cada processo uma lista privada de suspeitos, que pode discordar da lista de todos os outros. Os algoritmos de Chandra e Toueg toleram essa discordância. A linha de trabalho do Isis, a partir de Birman e Joseph, foi pelo caminho oposto: fazer todos verem a mesma lista, mudá-la por uma sequência ordenada e programar como se falhas fossem eventos globais limpos. `reconfiguration-changing-membership-in-paxos-and-raft` chegou a uma sequência de configurações pelo lado da máquina de estados. Esta lição vem pelo lado da comunicação e termina onde os dois se encontram.

## Teoria Central

### Views

Um sistema de comunicação em grupo orientado a views (GCS) oferece um serviço de membership e um serviço de multicast confiável. O serviço de membership acompanha os processos ativos e conectados no momento e informa cada mudança instalando uma nova view, que tem um identificador e um conjunto de membros. O survey de Chockler, Keidar e Vitenberg (2001) unifica mais de trinta especificações em torno dessas propriedades. Duas são básicas:

- **Self Inclusion:** um processo que instala uma view é membro dela.
- **Local Monotonicity:** um processo instala views com identificadores crescentes, então dois processos que instalam as mesmas duas views as instalam na mesma ordem.

Birman e Joseph mostram por que a lista acordada importa. No Isis, todo membro vê a mesma sequência de mudanças, e a lista é ordenada por idade decrescente. Os membros podem então se coordenar por qualquer regra determinística, sem mensagens extras: o índice de um membro serve como seu número para dividir requisições, e quando um coordenador falha, todos os seus cohorts ficam sabendo e escolhem o substituto pela mesma regra.

### Componente primário ou particionável

Num serviço de **componente primário**, as views formam uma ordem total, e views consecutivas compartilham um processo que sobrevive de uma para a outra e pode levar informação adiante. Num serviço **particionável**, as views têm só uma ordem parcial, então views disjuntas podem existir ao mesmo tempo. O Isis assume que partições podem acontecer, mas deixa só um componente prosseguir: processos desligados "commit suicide", na expressão do survey. Sistemas posteriores como Transis e Totem são particionáveis, o que serve a aplicações capazes de continuar trabalhando em cada componente. Aplicações que mantêm estado compartilhado costumam deixar só uma view primária atualizá-lo.

Dentro do Isis, a história escrita por Birman descreve como o serviço de membership evita split brain: passar da view `i` para a view `i + 1` exige confirmação explícita de uma maioria dos seus próprios processos na view `i`. Um serviço de 5 processos que se divide em `{a,b,c}` e `{d,e}` continua do lado de 3 processos. Um que divide 4 processos em 2 e 2 não tem maioria, e nenhum lado prossegue.

### Virtual synchrony

Birman e Joseph (1987) partem de um ambiente totalmente síncrono, em que multicasts são atômicos e todos os eventos ocorrem na mesma ordem em toda parte. Isso tornaria esses problemas fáceis, mas ordenar toda mensagem é proibitivamente caro. O virtual synchrony mantém a aparência e relaxa a realidade: para qualquer processo, parece que "all processes observed the same events in the same order", incluindo falhas, recuperações e mudanças de membership. As ordens reais podem diferir quando os resultados são equivalentes, e é daí que vem a concorrência. As primitivas são ABCAST (ordem total), CBCAST (ordem causal) e GBCAST (ordenada em relação às duas, usada para membership). O sistema de 1987 tolera perda de mensagens, mas não partições, que podiam deixar partes dele travadas.

O survey separa três propriedades de entrega fáceis de confundir:

```text
Same View Delivery:    se p e q recebem m, recebem na mesma view.
Sending View Delivery: m é recebida na view em que foi enviada.
Virtual Synchrony:     se p e q instalam a mesma nova view V na mesma
                       view anterior V', então qualquer mensagem que p
                       recebeu em V' também foi recebida por q em V'.
```

Sending View Delivery tem um preço: o GCS precisa bloquear o envio durante uma mudança de view, pedindo um flush à aplicação e esperando. Same View Delivery existe para evitar esse bloqueio.

A propriedade Virtual Synchrony se paga na transferência de estado. Réplicas que passam juntas de `V'` para `V` receberam as mesmas mensagens, então já têm o mesmo estado e não precisam de transferência. Só que um processo nem sempre sabe quem passou junto com ele, porque a propriedade fala do que outros processos instalaram (Exemplo 3). Um **conjunto transicional** entregue com cada view lhe dá essa informação.

### Transformando suspeita em fato

O membership continua apoiado em timeouts, que continuam imperfeitos. O Isis trata o veredito como autoridade. Uma vez declarada a falha, o sistema corta o processo, e um processo que estava vivo precisa voltar como um processo novo. As aplicações passam a ver um detector que não comete erros visíveis, o que a história de Birman descreve como implementar um modelo fail-stop.

Chandra e Toueg mostram o custo. Cada suspeita falsa remove um processo vivo, então o Isis precisa de timeouts muito conservadores, mais perto do pior caso, e eles relatam um timeout acima de 10 segundos na versão do Isis daquela época. Com os detectores deles, um timeout prematuro só atrasa o progresso, então os timeouts podem ficar mais perto do caso médio.

O membership também não escapa dos resultados de impossibilidade. Chandra e Toueg citam uma prova de que group membership é insolúvel em sistemas assíncronos com crashes, mesmo com a abordagem do Isis de matar processos suspeitos. O survey prova um resultado complementar: um serviço de membership preciso é tão forte quanto ◇P, porque cada view pode servir de saída de um detector de falha. Por isso a vivacidade de um GCS é enunciada de forma condicional, para execuções em que o detector se comporta como ◇P e a rede estabiliza.

### Onde encontra a replicação baseada em consenso

Lamport, Malkhi e Zhou dão um mapeamento direto: uma view corresponde a uma configuração, mensagens a comandos, e mensagens entregues a comandos escolhidos. A diferença é onde roda o consenso confiável. Um GCS entrega cada mensagem com um consenso não confiável, em geral um líder cuja falha impede o progresso, e roda consenso tolerante a falhas só na mudança de view, para fixar as mensagens entregues na view antiga e a nova composição. A replicação de máquina de estados roda consenso confiável para cada comando. Eles argumentam que a distância é menor do que parece: o passo por mensagem é como a primeira rodada de votação do Paxos, e a mudança de view é como um novo líder rodando uma nova votação para todas as instâncias pendentes de uma vez. Nas palavras deles, "A state-machine implementation and a strong GC service perform essentially the same actions; those actions are just viewed differently."

A palavra "strong" importa. Segundo o relato deles, Virtual Synchrony como definido originalmente não garante irrevogabilidade, já que uma mensagem entregue só a um processo que depois cai não precisa sobreviver (Exemplo 2). A correção deles: antes de entregar, um processo fica sabendo que uma maioria da view sabe que a mensagem foi enviada, e o valor proposto na mudança de view precisa incluir toda mensagem que alguma maioria conhece. O GBCAST do Isis e as mensagens Safe do Transis e do Totem dão esse tipo de garantia.

A história de Birman apresenta o padrão mais fraco como uma escolha deliberada: entregar eventos instáveis foi uma decisão de desempenho, e multicast uniforme, GBCAST ou um flush dão garantias idênticas às do Paxos quando a aplicação precisa delas. Ele conclui que as suítes de protocolos reais usam elementos das duas coisas. Os relatos diferem em ênfase num detalhe: Lamport, Malkhi e Zhou dizem que a definição original exige que a nova view contenha uma maioria da antiga, enquanto Birman descreve a maioria como obrigatória dentro do serviço de membership e opcional, por configuração, para grupos de aplicação.

Mais uma diferença: o GCS tradicional faz a nova view rodar o consenso de mudança de view, e usa uma sobreposição de maioria entre views para mantê-las únicas. Em Rα, a configuração antiga escolhe a nova e, como dizem os autores, "there is no need for any overlap between the old and new views".

**Livro vs hoje:** o survey é de 2001, então sua lista de sistemas é um retrato daquele momento. O vocabulário de propriedades dele é o que esta lição usa.

## Exemplos Resolvidos

Os traces dos Exemplos 1 e 2 são inventados para ilustração.

### Exemplo 1: uma mudança de view restaura Virtual Synchrony

```text
V1 = <1,{p,q,r,s}>, V2 = <2,{p,q,r}>. s cai.

Recebidas em V1 antes da mudança de view:
  p {m1,m2}   q {m2}   r {m2}      (m1 veio de s e só alcançou p)

Virtual Synchrony para os pares que passam de V1 a V2:
  (p,q) diferem em m1   (p,r) diferem em m1   VIOLADA

A mudança de view fixa o conjunto de mensagens de V1:
  união relatada pelos sobreviventes = {m1,m2}
  p, q e r recebem {m1,m2} em V1 e depois instalam V2.
  Todos os pares iguais. VALE.
```

### Exemplo 2: a lacuna de irrevogabilidade e a regra da maioria

Mesmo início, mas agora `s` entrega `m3` a si mesmo, responde a um cliente e cai antes de qualquer outro ter `m3`.

```text
Sobreviventes relatam p {m2}  q {m2}  r {m2}. Conjunto acordado: {m2}.
Virtual Synchrony vale: s não instalou V2, então não é restringido.
O cliente tem uma resposta baseada em m3, e m3 sumiu.
```

Agora aplique a regra mais forte em `V = {p,q,r,s,t}`. `s` só entrega `m3` depois de saber que a maioria `K = {s,p,q}` sabe que ela foi enviada. Depois `s` cai. A mudança de view roda entre uma maioria qualquer, e sem `s` há quatro:

```text
{p,q,r} encontra K em {p,q}
{p,q,t} encontra K em {p,q}
{p,r,t} encontra K em {p}
{q,r,t} encontra K em {q}
```

Todas contêm um processo que relata `m3`, então `m3` sobrevive. Com só `K = {s,p}`, a maioria `{q,r,t}` não a encontra, e por isso conhecimento abaixo da maioria não basta.

### Exemplo 3: a mesma view, históricos diferentes

Este é o cenário da Figura 3 do survey. `p` se separa de `q`. `q` percebe primeiro, instala uma view sem `p`, e a rede volta antes de `p` reagir.

```text
p instala <1,{p,q}>, depois <3,{p,q}>
q instala <1,{p,q}>, <2,{q}>, depois <3,{p,q}>

Em p: <3,...> e a view anterior se intersectam em {p,q}.
      Mas a view anterior de q foi <2,{q}>, então a hipótese de
      Virtual Synchrony falha para o par (p,q).
      Conjunto transicional em p: {p}.
Em q: view anterior <2,{q}>. Conjunto transicional em q: {q}.
```

Os dois instalaram a mesma view, e nenhum pode assumir que o outro tem o mesmo estado. Cada um vê só a si mesmo no conjunto transicional, então cada um sabe que não pode dispensar uma transferência de estado com o outro.

## Equívocos Comuns e Armadilhas

- **"Virtual synchrony significa que o sistema é síncrono."** O sistema continua assíncrono, e o ponto do artigo de 1987 é preservar só a aparência, a um custo menor que o da ordenação em lock-step real.
- **"Virtual Synchrony dá entrega tudo ou nada."** O survey observa que tudo ou nada é impossível onde mensagens podem se perder, e a propriedade só amarra processos que passam juntos. O Exemplo 2 mostra uma mensagem entregue sumindo sem nenhuma violação.
- **"A mesma view nova significa as mesmas mensagens."** Também é preciso a mesma view anterior. O Exemplo 3 tem a mesma view nova e nenhuma garantia desse tipo.
- **"O membership contorna o consenso."** A própria história de Birman reconhece o protocolo de membership como uma solução de acordo tolerante a falhas, e os resultados de impossibilidade acima valem para ele.

## Resumo

O group membership troca listas privadas de suspeitos por uma sequência acordada de views, o que permite aos processos se coordenarem por regras determinísticas. O virtual synchrony preserva a aparência de que todos os processos veem os mesmos eventos na mesma ordem, e sua propriedade central diz que processos que passam juntos entre duas views receberam as mesmas mensagens, o que os poupa de uma transferência de estado. O Isis dá autoridade à suspeita removendo processos suspeitos, o que força timeouts conservadores e ainda assim não escapa da impossibilidade do membership em sistemas assíncronos. Uma view corresponde a uma configuração, e a diferença para a replicação baseada em consenso é onde roda o consenso confiável e se a entrega é irrevogável. Com a regra de entrega mais forte, os dois fazem essencialmente as mesmas ações.

## Documentation Links

- [Birman and Joseph (1987): Exploiting Virtual Synchrony in Distributed Systems](https://courses.csail.mit.edu/6.895/fall02/papers/Birman/sosp87-birman.pdf): o modelo de virtual synchrony, ABCAST, CBCAST, GBCAST e os grupos de processos no Isis.
- [Chockler, Keidar, and Vitenberg (2001): Group Communication Specifications: A Comprehensive Study](https://people.csail.mit.edu/idish/ftp/gcs-survey.pdf): as propriedades unificadas de membership e multicast, conjuntos transicionais e a prova de que membership preciso é tão forte quanto ◇P.
- [Lamport, Malkhi, and Zhou (2010): Reconfiguring a State Machine](https://lamport.azurewebsites.net/pubs/reconfiguration-tutorial.pdf): seção 4, sobre a correspondência entre comunicação em grupo e a abordagem de máquina de estados.
- [Chandra and Toueg (1996): Unreliable Failure Detectors for Reliable Distributed Systems](https://www.cs.utexas.edu/~lorenzo/corsi/cs380d/papers/p225-chandra.pdf): seção 9.3, comparando a abordagem do Isis, e seção 9.4, sobre a impossibilidade de group membership.
- [Birman (2010): A History of the Virtual Synchrony Replication Model](https://www.cs.purdue.edu/homes/bb/cs542-15Spr/Birman-Cornell-history-Replication.pdf): o relato do próprio autor sobre o serviço de membership, a entrega instável e a relação com o Paxos.
