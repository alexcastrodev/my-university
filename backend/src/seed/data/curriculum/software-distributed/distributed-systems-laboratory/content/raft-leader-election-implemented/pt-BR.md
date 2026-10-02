---
version: 1.0
updatedAt: 2026-09-12
title: "Lab: Eleição de Líder do Raft, Implementada"
summary: "Este lab implementa o primeiro quarto do Raft, correspondendo ao próprio Lab 3A do MIT 6.5840 exatamente: RPCs RequestVote, timeouts de eleição aleatorizados, e a lógica baseada em termo que garante no máximo um líder por termo, rodada contra o simulador do Lab 1 com cenários de falha reais e repetíveis (um líder isolado, um líder morto, uma rede não confiável demais para eleger qualquer um) em vez de uma descrição só em diagrama de como a eleição deveria funcionar."
---
## Objetivos de Aprendizagem

- Implementar o RPC RequestVote do Raft e a regra de votação baseada em termo que garante no máximo um líder por termo.
- Implementar timeouts de eleição aleatorizados e o mecanismo de heartbeat que suprime eleições desnecessárias enquanto um líder está vivo.
- Verificar, contra o simulador do Lab 1, que um único líder é eleito, que ele permanece líder na ausência de falhas, e que um novo líder assume uma vez que o antigo é morto ou particionado para longe.
- Identificar por que um timeout ingênuo e não aleatorizado causa divisões de voto repetidas, e confirmar o conserto empiricamente em vez de só por argumento.

## Contexto e Motivação

**Raft: Eleição de Líder** de `distributed-systems-i` já prova por que os números de termo e a regra de um-voto-por-termo são suficientes para garantir no máximo um líder por termo, e por que os timeouts aleatorizados tornam uma divisão de voto um evento raro e autocorrigível em vez de um impasse recorrente. Este lab não rederiva essa prova; ele é o primeiro quarto de transformá-la numa implementação real e em execução, correspondendo ao Lab 3A do MIT 6.5840 exatamente, rodado contra cenários de falha reais e repetíveis em vez de deixado como um diagrama.

## Teoria Central

Este lab reusa a máquina de estado de `raft-leader-election` sem modificação: cada servidor é Seguidor, Candidato ou Líder, um número de termo aumenta monotonicamente sempre que um servidor começa uma eleição, e um servidor concede o seu voto para um dado termo no máximo uma vez, por ordem de chegada. O que este lab adiciona é a maquinaria concreta: uma goroutine de fundo por servidor rastreando um timeout de eleição, um handler de RequestVote impondo a regra de um-voto-por-termo, e um mecanismo de heartbeat (RPCs AppendEntries vazios, cujo comportamento completo de carregar o log pertence a `raft-log-replication-and-commitment-implemented`) que reinicia os timeouts dos seguidores enquanto um líder está vivo.

## Exemplos Resolvidos

### Especificação da API

```text
RequestVoteArgs  { Term, CandidateId, LastLogIndex, LastLogTerm }
RequestVoteReply { Term, VoteGranted }

Cada servidor roda uma goroutine de vida longa que:
  - reinicia um timer de eleição aleatorizado sempre que recebe um
    heartbeat válido ou concede um voto
  - começa uma eleição (incrementa o seu termo, vota em si mesmo, envia
    RequestVote a todos os pares) se o timer dispara sem líder ouvido
```

### Passo 1 — a regra de concessão de voto

```go
func (rf *Raft) RequestVote(args *RequestVoteArgs, reply *RequestVoteReply) {
    rf.mu.Lock()
    defer rf.mu.Unlock()

    if args.Term < rf.currentTerm {
        reply.Term, reply.VoteGranted = rf.currentTerm, false
        return
    }
    if args.Term > rf.currentTerm {
        rf.currentTerm = args.Term
        rf.votedFor = -1 // um termo mais alto sempre reinicia qualquer voto anterior
        rf.state = Follower
    }
    // Um voto por termo: concede só se ainda não votou neste termo
    // (ou já votou neste mesmo candidato, para um RPC tentado de novo).
    if (rf.votedFor == -1 || rf.votedFor == args.CandidateId) && rf.logAtLeastAsUpToDateAs(args) {
        rf.votedFor = args.CandidateId
        reply.VoteGranted = true
        rf.resetElectionTimer()
    }
    reply.Term = rf.currentTerm
}
```

### Passo 2 — timeout aleatorizado, deliberadamente não fixo

```go
func (rf *Raft) newElectionTimeout() time.Duration {
    // janela de 300-600ms: larga o bastante para que dois seguidores raramente
    // deem timeout dentro dos mesmos poucos milissegundos um do outro, estreita
    // o bastante para que a recuperação após uma falha de líder permaneça rápida, correspondendo
    // à própria restrição enunciada do MIT 6.5840 de um novo líder dentro de 5s.
    return time.Duration(300+rand.Intn(300)) * time.Millisecond
}
```

### Passo 3 — um teste que força, depois cura, uma falha de líder

```go
func TestReElection3A(t *testing.T) {
    cfg := MakeConfig(t, 3, net) // cluster de 3 servidores sobre o simulador do Lab 1
    leader1 := cfg.checkOneLeader()

    cfg.disconnect(leader1) // crash simulado: cortado, não morto
    leader2 := cfg.checkOneLeader()
    if leader2 == leader1 {
        t.Fatalf("expected a new leader after disconnecting old leader")
    }

    cfg.connect(leader1) // o líder antigo se rejunta; tem de recuar, não split-brain
    cfg.checkOneLeader()
}
```

## Equívocos Comuns e Armadilhas

- **"Um timeout fixo e idêntico em todo servidor é mais simples e deveria funcionar bem."** Ele produz divisões de voto recorrentes: todo seguidor dá timeout no mesmo instante, todos viram candidatos simultaneamente, e nenhum candidato único ganha uma maioria, repetindo-se indefinidamente; `clock-skew-and-spurious-elections` depois mede exatamente o quão ruim isso fica conforme a janela de aleatorização se estreita.
- **"Uma vez que um líder é eleito, o trabalho da lógica de eleição está feito."** Um líder antigo desconectado-e-depois-reconectado tem de reconhecer um termo mais alto dos heartbeats do novo líder e recuar; pular isso produz dois servidores simultaneamente acreditando que são líder, um bug real de split-brain que os testes deste lab especificamente sondam.
- **"Conceder um voto é um sim simples desde que o termo bata."** A checagem `logAtLeastAsUpToDateAs` (adiada em detalhe completo para `raft-log-replication-and-commitment-implemented`, mas já exigida aqui) existe porque conceder um voto a um candidato com um log obsoleto arrisca eleger um líder faltando entradas já com commit; pular isso passa nos testes mais simples deste lab enquanto silenciosamente viola a propriedade de segurança do Raft.

## Resumo

Este lab implementa a eleição de líder do Raft exatamente como o Lab 3A do MIT 6.5840 a especifica: a regra de um-voto-por-termo de RequestVote, timeouts de eleição aleatorizados que tornam uma divisão de voto rara e autocorrigível, e heartbeats que suprimem eleições desnecessárias enquanto um líder está vivo, verificados contra o simulador do Lab 1 com cenários reais e repetíveis, um líder desconectado forçando a reeleição, uma partição curada forçando o líder antigo a recuar, em vez de deixados como uma descrição não testada de como o protocolo deveria se comportar.

## Documentation Links

- [MIT 6.5840 — Lab 3: Raft 1](https://pdos.csail.mit.edu/6.824/labs/lab-raft1.html): o lab real ao qual este exercício corresponde, incluindo a sua suíte de testes de eleição de líder 3A (TestInitialElection3A, TestReElection3A, TestManyElections3A).
- [Ongaro & Ousterhout — In Search of an Understandable Consensus Algorithm (Raft, USENIX ATC 2014)](https://raft.github.io/raft.pdf): o artigo original que especifica a regra de concessão de voto e o mecanismo de timeout aleatorizado implementados neste lab.
