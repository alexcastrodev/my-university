---
version: 1.0
updatedAt: 2026-11-04
title: "Multi-Paxos: De uma Decisão a um Log Replicado"
summary: "Do Paxos de decisão única a um log replicado: um líder estável, pular a fase 1 nos slots seguintes, preencher lacunas, e o que a lição existente de Paxos deixou de fora sobre vivacidade."
---
## Objetivos de Aprendizagem

- Explicar por que o Multi-Paxos é uma família de práticas, e atribuir cada detalhe à fonte que o apresenta.
- Explicar por que a fase 1 pode rodar uma vez para muitos slots, e o que um líder estável economiza.
- Rastrear a recuperação de um log com lacunas por um novo líder, incluindo a escolha dos valores e o preenchimento com no-op.
- Descrever os mecanismos de vivacidade que o Paxos de decisão única deixa em aberto, do proponente distinguido aos timeouts crescentes e ao boosting do número de sequência.
- Comparar o log do Paxos, slot a slot, com o log do Raft.

## Contexto e Motivação

`paxos-the-original-consensus-protocol` cobriu a segurança de uma decisão e nomeou os proponentes em duelo sem resolvê-los. `total-order-broadcast-built-on-consensus` mostrou que um serviço replicado precisa de uma sequência de decisões e deixou em aberto o custo por decisão. O Multi-Paxos é a resposta às duas coisas, mas não é um protocolo só. Ongaro e Ousterhout, os autores do [Raft](/papers/raft-understandable-consensus-algorithm), são diretos: "there is no widely agreed-upon algorithm for multi-Paxos." [Paxos Made Simple](/papers/paxos-made-simple) esboça a ideia sem usar o nome, o Paxos Made Live do Google usa o nome e relata o que a produção exigiu, e o Paxos Made Moderately Complex de van Renesse e Altinbuken (PMMC a seguir) traz pseudocódigo completo. Esta lição mantém essas fontes separadas.

## Teoria Central

### Uma instância por slot, um proponente distinguido

Lamport implementa uma máquina de estados com "a sequence of separate instances of the Paxos consensus algorithm", em que o valor escolhido pela instância i é o comando i. Um único líder eleito atua como proponente distinguido em todas as instâncias. Os clientes enviam comandos a ele, e ele decide onde cada um entra.

O PMMC chama as posições de slots e acrescenta um aviso que vale guardar: números de ballot e números de slot são ortogonais. Um ballot pode decidir muitos slots, e um slot pode ser tentado por muitos ballots.

### Por que a fase 1 pode ser pulada

A observação central de Lamport é que "the value to be proposed is not chosen until phase 2". A fase 1 reserva um número de proposta e coleta o histórico, e nenhuma das duas coisas depende do próximo comando. Então um novo líder roda a fase 1 para todas as instâncias em aberto de uma vez, com o mesmo número de proposta e "a single reasonably short message". Um aceitador responde com mais que um OK só nas instâncias em que já aceitou algo.

Depois disso, cada novo comando precisa só da fase 2. O Paxos Made Live dá a forma de produção: "Propose messages may be omitted if the coordinator identity does not change between instances." A segurança não muda, porque qualquer réplica ainda pode fazer broadcast de uma mensagem propose com número maior a qualquer momento. Pular a fase 1 é uma otimização para o caso em que ninguém faz isso.

Números únicos vêm de conjuntos disjuntos. O esquema do Paxos Made Live: num sistema de n réplicas, a réplica r de id i_r escolhe o menor número de sequência acima de qualquer um que tenha visto tal que s mod n = i_r. O PMMC usa pares ordenados de um número de rodada e um id de líder.

### Recuperação, lacunas e no-ops

Os slots são decididos de forma independente, então o log pode ter buracos. O líder de Lamport pode propor o comando 142 antes de saber que o 141 foi escolhido. Se um líder pode se adiantar α comandos, uma lacuna de até α - 1 comandos pode surgir quando ele falha.

Um novo líder roda a fase 1 para todo slot que não conhece. O PMMC enuncia a regra por slot: se nenhum aceitador da maioria reporta valor para um slot, nada foi escolhido ali e o líder pode propor qualquer coisa; caso contrário, ele precisa pegar o valor de maior ballot. Os buracos restantes abaixo do maior slot conhecido bloqueiam a execução, então o líder de Lamport os preenche na hora com um comando no-op, que deixa o estado inalterado. Ele menciona a alternativa de usar os próximos comandos de clientes. O preenchimento é, portanto, uma escolha de latência, não um requisito de segurança.

### A vivacidade que o Paxos de decisão única deixa em aberto

O PMMC é explícito: o protocolo Synod não garante progresso, "even in the absence of any failure whatsoever". A solução de Lamport é um proponente distinguido, com a ressalva de `leader-based-consensus-in-the-synchronous-model`: elegê-lo de forma confiável exige aleatoriedade ou tempo real. A segurança não depende disso. Dois líderes autoproclamados podem travar um slot, mas não podem causar desacordo. Daí em diante, as fontes diferem no mecanismo.

- **Detecção de falhas (PMMC).** Um líder preterido por um ballot maior não tenta de novo na hora. Ele faz ping no vencedor e espera, e só inicia um scout quando os pings param de ser respondidos.
- **Timeouts crescentes (PMMC).** O timeout sobe com o ballot concorrente, então algum líder correto acaba tendo tempo suficiente. Isso supõe que existam limites para o desvio de relógio e o tratamento de mensagens, sem supor que sejam conhecidos. O PMMC sugere um esquema parecido com o do TCP: multiplicar o timeout na preempção e reduzi-lo linearmente a cada proposta escolhida.
- **Boosting (Paxos Made Live).** Um mestre antigo desconectado pode aumentar o seu número de sequência ao contatar outra réplica e, ao voltar, desalojar o novo mestre, que mantém um número fixo. Repetido, isso gera trocas rápidas de mestre. A solução deles é o mestre rodar periodicamente uma rodada completa do Paxos para aumentar o próprio número. Uma nota de rodapé relata que, num sistema carregado, menos de um por cento das instâncias roda o algoritmo completo.

### O que um log precisa além do consenso

Nada do que segue está em Paxos Made Simple. Cada item é a resposta de uma equipe.

```text
Master leases, PML 5.2       Enquanto o lease vale, nenhuma outra
                             réplica consegue passar um valor pelo
                             Paxos, então o mestre lê localmente.
Leases em leituras,          Uma maioria de aceitadores concede o
PMMC 4.5                     lease; supõe desvio de relógio limitado.
Epoch numbers, PML 5.3       Aborta um pedido se a liderança mudou
                             durante o seu tratamento.
Corrupção de disco, PML 5.1  Uma réplica que perdeu estado entra sem
                             voto, para não quebrar uma promessa.
Snapshots, PML 5.5           A aplicação tira o snapshot; o framework
                             trunca o log.
Batching, PML 4.2            Muitos valores numa instância.
Duplicatas, PMMC 2.1         Um comando pode ser decidido em dois
                             slots; a réplica o aplica uma vez.
Coleta de lixo, PMMC 4.2     Quando f + 1 réplicas aprenderam um slot,
                             os aceitadores podem descartar o estado.
```

(PML é o Paxos Made Live.) Trocar o conjunto de servidores é o maior desses temas e tem lição própria: `reconfiguration-changing-membership-in-paxos-and-raft`.

### Contraste com o Raft

A diferença em relação ao Raft é estrutural. No Multi-Paxos, como Lamport o descreve, o slot 142 pode ser escolhido com o 141 em aberto. Em `raft-log-replication-and-commitment`, um seguidor rejeita uma entrada a menos que ela combine com a anterior, então os logs não têm buracos e confirmar o índice N cobre tudo antes de N. O novo líder do Raft também dispensa recuperação por slot: `raft-safety-the-election-restriction-and-log-completeness` restringe os votos a candidatos com logs atualizados. Ongaro e Ousterhout argumentam que há "little benefit to choosing a collection of log entries independently and then melding them into a sequential log". Esse é o julgamento deles. O preço que o Raft paga é que os seguidores não podem aceitar fora de ordem.

## Exemplos Resolvidos

### Exemplo 1: um novo líder recupera o log de Lamport

O cenário de Lamport: o novo líder conhece os comandos 1 a 134, 138 e 139. Os relatos de aceitadores abaixo foram construídos para este rastreamento. Três aceitadores, novo ballot 7, e uma maioria {A, B} responde à fase 1.

```text
slot   A reporta       B reporta       o líder propõe
135    (ballot 4, x)   nada            x   (forçado)
136    nada            nada            no-op
137    nada            nada            no-op
138    já escolhido                    (nenhuma ação)
139    já escolhido                    (nenhuma ação)
140    nada            (ballot 5, w)   w   (forçado)
141+   nada            nada            livre para clientes
```

C pode ter (ballot 3, old) no slot 135, fora da maioria, e isso não importa. Se "old" tivesse sido escolhido no ballot 3, o ballot 4 teria sido forçado a carregá-lo, então A não poderia ter x. Depois da fase 2 do ballot 7, os comandos 135 a 140 estão todos escolhidos e o líder pode executar até o 140. Sem os no-ops, ele só executaria até o 135, e 138 a 140 esperariam clientes fornecerem mais dois comandos. O slot 141 vai para o próximo pedido de cliente, e a fase 1 não se repete.

### Exemplo 2: um histórico sobrescrito continua seguro

O PMMC reduz o estado do aceitador ao pvalue mais recente por slot, o que parece perigoso. Com aceitadores a1, a2, a3:

```text
1. a1, a2 aceitam <ballot L, slot 1, c>   -> c é escolhido; L cai
2. L' faz a2, a3 adotarem um ballot maior
3. a2 reporta c, então L' precisa propor c
4. a2 aceita <ballot L', slot 1, c>

Estado agora: a1 tem (L, c), a2 tem (L', c), a3 não tem nada.
```

Nenhuma maioria guarda agora o mesmo pvalue, então a evidência de que o ballot L escolheu c foi sobrescrita. Ainda assim é seguro. Toda maioria dos três aceitadores contém a1 ou a2, e ambos têm c, então qualquer líder posterior precisa propor c.

### Exemplo 3: o que pular a fase 1 economiza

Esta contabilidade foi construída a partir dos tipos de mensagem do Paxos Made Live, com 5 réplicas, um coordenador, sem batching e sem piggybacking. Cada tipo custa 4 mensagens.

```text
instância completa:   propose, promise, accept, ack, commit
                      5 tipos * 4 = 20 mensagens, 5 escritas em sequência
instância encadeada:  accept, ack, commit
                      3 tipos * 4 = 12 mensagens, 1 escrita por réplica em paralelo
```

Em 1000 comandos, com 10 deles (1 por cento, a ordem de grandeza da nota sobre boosting) rodando o algoritmo completo:

```text
sem encadear:  1000 * 20                 = 20000 mensagens
encadeando:    10 * 20 + 990 * 12        = 12080 mensagens
```

A contagem de mensagens melhora cerca de 40 por cento. O efeito na latência é maior: supondo 10 ms por flush em disco, o caminho crítico cai de 50 ms de escritas sequenciais para cerca de 10 ms.

### Exemplo 4: escolher um número de sequência e recuar

Com a numeração do Paxos Made Live, 5 réplicas e 13 como maior número visto, a réplica 2 escolhe 17, o menor número acima de 13 com 17 mod 5 = 2. A réplica 4 escolhe 14.

Para os timeouts, suponha que um líder precise de 350 ms para as suas fases, e use o esquema do PMMC com timeout inicial de 100 ms, dobrado na preempção e reduzido em 10 ms a cada proposta escolhida (os três números são ilustrativos). As preempções acontecem em 100 e 200 ms, desperdiçando 300 ms, e o timeout de 400 ms tem sucesso. Depois de 6 propostas escolhidas o timeout é 340 ms, curto demais de novo, e um líder saudável pode ser substituído. O PMMC diz que isso acaba acontecendo e aceita o fato: o objetivo é um timeout longo o bastante para um líder ter sucesso e curto o bastante para substituir rápido um líder falho.

## Equívocos Comuns e Armadilhas

- **"Multi-Paxos é um protocolo preciso, com uma especificação."** É uma família. O esboço de Lamport, o sistema do Chubby e o PMMC diferem em papéis, numeração, leases e recuperação, então uma afirmação sobre Multi-Paxos precisa de fonte.
- **"Pular a fase 1 enfraquece a segurança."** Qualquer réplica ainda pode rodar a fase 1 com número maior a qualquer momento. A otimização só supõe que isso seja raro.
- **"Um líder estável pode responder leituras do estado local."** O Paxos Made Live explica por que não: outro mestre pode ter sido eleito sem avisar o antigo. Leituras locais exigem leases, e leases exigem hipóteses de tempo.
- **"No-ops são necessários para a segurança."** Eles evitam espera. Lamport menciona a alternativa de atribuir às lacunas os próximos comandos de clientes.
- **"Aceito por uma maioria significa que uma maioria guarda o mesmo pvalue."** O Exemplo 2 mostra um valor escolhido sem nenhuma maioria com o mesmo pvalue.

## Resumo

O Multi-Paxos roda uma instância do Paxos por slot do log sob um líder. Como a fase 1 não depende do valor, um novo líder a roda uma vez sobre todos os slots em aberto e depois paga só a fase 2 por comando. A recuperação pega o valor de maior ballot por slot e preenche os buracos com no-ops. O progresso exige um único proponente ativo, o que depende de tempo ou aleatoriedade, e as fontes tratam disso de formas diferentes: o PMMC com pings e timeouts crescentes, o Paxos Made Live com boosting. Leases, snapshots e tratamento de corrupção vêm da prática de engenharia, não do algoritmo. O Raft chega a um log parecido proibindo buracos.

## Documentation Links

- [Lamport: Paxos Made Simple (2001)](https://lamport.azurewebsites.net/pubs/paxos-simple.pdf): instâncias, proponente distinguido, o cenário de recuperação de 135 a 140, no-ops e a janela α.
- [Chandra, Griesemer & Redstone: Paxos Made Live, An Engineering Perspective (2007)](https://www.cs.utexas.edu/~lorenzo/corsi/cs380d/papers/paper2-1.pdf): a otimização do Multi-Paxos, as contagens de escrita, master leases, boosting, epoch numbers, corrupção e snapshots no Chubby.
- [van Renesse & Altinbuken: Paxos Made Moderately Complex (ACM Computing Surveys 2015)](https://www.cs.cornell.edu/courses/cs7412/2011sp/paxos.pdf): slots, ballots, recuperação por slot, o cenário de vivacidade, timeouts, redução de estado, coleta de lixo e leases de leitura.
- [Ongaro & Ousterhout: In Search of an Understandable Consensus Algorithm (2014)](https://raft.github.io/raft.pdf): a crítica à decomposição em decisão única citada nesta lição.
