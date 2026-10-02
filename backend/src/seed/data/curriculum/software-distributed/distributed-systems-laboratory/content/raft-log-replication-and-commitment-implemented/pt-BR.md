---
version: 1.0
updatedAt: 2026-09-12
title: "Lab: Replicação e Commit de Log do Raft, Implementados"
summary: "Este lab estende o líder eleito do lab anterior num log replicado real, implementando RPCs AppendEntries, a contabilidade de nextIndex por seguidor do líder, e a regra de maioria que avança o índice de commit, correspondendo ao Lab 3B do MIT 6.5840, e especificamente força o caminho de reparo de inconsistência de log que só a teoria raramente torna concreto: matar e reiniciar seguidores no meio do fluxo até o log de um seguidor ter genuinamente divergido do log do líder, depois verificar que a implementação de fato o traz de volta ao acordo em vez de só funcionar no caminho fácil, sem falha."
---
## Objetivos de Aprendizagem

- Implementar RPCs AppendEntries carregando entradas de log reais, e a contabilidade de `nextIndex` por seguidor do líder que rastreia o quão longe cada seguidor se atualizou.
- Implementar a regra de commit: uma entrada tem commit uma vez que está armazenada numa maioria de servidores, e só entradas do termo atual do líder diretamente disparam o avanço do índice de commit.
- Implementar a checagem de consistência de log e o retrocesso de reparo que ela força quando o log de um seguidor divergiu do do líder.
- Verificar, matando e reiniciando seguidores deliberadamente no meio do fluxo, que um log genuinamente divergido é reparado corretamente, não só o caminho fácil sem falha.

## Contexto e Motivação

**Raft: Replicação e Commit de Log** de `distributed-systems-i` já prova por que a regra de maioria é o que torna uma entrada com commit durável por entre mudanças de líder, e por que uma entrada só é segura de ter commit uma vez que uma entrada do próprio termo atual do líder tenha ela mesma tido commit pela regra de maioria (não qualquer entrada de termo anterior sozinha). Este lab transforma essa prova no segundo quarto de uma implementação de Raft funcional, correspondendo ao Lab 3B do MIT 6.5840, especificamente engenheirado para forçar o caminho de reparo de inconsistência de log que um teste sem falha nunca exercitaria.

## Teoria Central

Este lab estende os heartbeats de `raft-leader-election-implemented`, anteriormente chamadas AppendEntries vazias, em RPCs reais que carregam log. O líder mantém, por seguidor, um `nextIndex`, o seu melhor chute sobre onde o log daquele seguidor começa a divergir do seu, e uma checagem de consistência em toda chamada AppendEntries ou confirma o acordo até aquele ponto ou força o líder a recuar o chute e tentar de novo, exatamente o mecanismo de reparo que `raft-log-replication-and-commitment` já estabelece ser necessário uma vez que um seguidor perdeu entradas que um líder agora suplantado enviou.

## Exemplos Resolvidos

### Especificação da API

```text
AppendEntriesArgs  { Term, LeaderId, PrevLogIndex, PrevLogTerm,
                      Entries[], LeaderCommit }
AppendEntriesReply { Term, Success, ConflictIndex, ConflictTerm }
```

### Passo 1 — a checagem de consistência do lado receptor

```go
func (rf *Raft) AppendEntries(args *AppendEntriesArgs, reply *AppendEntriesReply) {
    rf.mu.Lock()
    defer rf.mu.Unlock()

    if args.Term < rf.currentTerm {
        reply.Success = false
        return
    }
    rf.resetElectionTimer() // um líder válido está vivo; permanecer seguidor

    // A checagem de consistência central: o NOSSO log concorda com a
    // afirmação do líder sobre o que imediatamente precede estas novas entradas?
    if args.PrevLogIndex >= len(rf.log) || rf.log[args.PrevLogIndex].Term != args.PrevLogTerm {
        reply.Success = false
        reply.ConflictIndex, reply.ConflictTerm = rf.findConflictPoint(args.PrevLogIndex)
        return
    }

    rf.log = append(rf.log[:args.PrevLogIndex+1], args.Entries...)
    if args.LeaderCommit > rf.commitIndex {
        rf.commitIndex = min(args.LeaderCommit, len(rf.log)-1)
    }
    reply.Success = true
}
```

### Passo 2 — a contabilidade por seguidor e o retrocesso do líder

```go
func (rf *Raft) replicateTo(peer int) {
    rf.mu.Lock()
    nextIdx := rf.nextIndex[peer]
    args := &AppendEntriesArgs{
        Term: rf.currentTerm, LeaderId: rf.me,
        PrevLogIndex: nextIdx - 1, PrevLogTerm: rf.log[nextIdx-1].Term,
        Entries: rf.log[nextIdx:], LeaderCommit: rf.commitIndex,
    }
    rf.mu.Unlock()

    var reply AppendEntriesReply
    if !rf.sendAppendEntries(peer, args, &reply) {
        return // descartado pelo simulador do Lab 1; um heartbeat posterior tenta de novo
    }

    rf.mu.Lock()
    defer rf.mu.Unlock()
    if reply.Success {
        rf.nextIndex[peer] = nextIdx + len(args.Entries)
        rf.matchIndex[peer] = rf.nextIndex[peer] - 1
        rf.tryAdvanceCommitIndex() // regra de maioria, ver Passo 3
        return
    }
    // A checagem de consistência falhou: recuar nextIndex usando a própria
    // info de conflito do seguidor em vez de recuar uma entrada por vez,
    // que é o que torna a recuperação de uma longa divergência rápida.
    rf.nextIndex[peer] = rf.backtrackUsingConflict(reply.ConflictIndex, reply.ConflictTerm)
}
```

### Passo 3 — a regra de commit, incluindo a restrição de termo atual

```go
func (rf *Raft) tryAdvanceCommitIndex() {
    for n := len(rf.log) - 1; n > rf.commitIndex; n-- {
        if rf.log[n].Term != rf.currentTerm {
            continue // a restrição crítica: só entradas do termo
                      // ATUAL avançam diretamente o commitIndex
        }
        count := 1 // o próprio líder
        for peer := range rf.peers {
            if rf.matchIndex[peer] >= n {
                count++
            }
        }
        if count > len(rf.peers)/2 {
            rf.commitIndex = n
            return
        }
    }
}
```

### Passo 4 — um teste que força divergência de log real, não só o caminho feliz

```go
func TestFailAgree3B(t *testing.T) {
    cfg := MakeConfig(t, 5, net)
    cfg.one(101, 5) // com commit em todos os 5 servidores

    leader := cfg.checkOneLeader()
    cfg.disconnect((leader + 1) % 5)
    cfg.disconnect((leader + 2) % 5) // 2 de 5 seguidores agora cortados

    cfg.one(102, 3) // ainda uma maioria (3 de 5); tem de ainda ter commit
    cfg.one(103, 3)

    cfg.connect((leader + 1) % 5)
    cfg.connect((leader + 2) % 5)
    cfg.one(104, 5) // os seguidores reconectados têm de se atualizar corretamente
}
```

## Equívocos Comuns e Armadilhas

- **"Fazer commit de uma entrada assim que uma maioria a tem, independentemente do termo, é mais simples e igualmente seguro."** A própria prova de segurança do Raft depende especificamente da restrição de termo atual do Passo 3; fazer commit de uma entrada de termo anterior puramente por contagem de maioria, sem uma entrada de termo atual também ter alcançado uma maioria, é uma forma real e documentada de violar a propriedade de completude do líder, mesmo que pareça correto em testes sem mudanças de líder.
- **"Recuar `nextIndex` uma entrada por AppendEntries falha está tudo bem."** É correto, mas, para um seguidor que divergiu por muitas entradas, força uma ida e volta por entrada para reparar, o que testes de cluster reais, incluindo o do Passo 4 em escala maior, podem dar timeout; usar o `ConflictIndex`/`ConflictTerm` do seguidor para saltar mais para trás num passo é o que as próprias expectativas de desempenho do Lab 3B do MIT 6.5840 assumem.
- **"Testar só o caso onde nenhum servidor é jamais desconectado é suficiente para confiar na implementação."** A checagem de consistência de log e a lógica de retrocesso dos Passos 1 e 2 nunca são exercitadas de forma alguma sem uma divergência real forçando-as; o desconectar-depois-reconectar deliberado de `TestFailAgree3B` é o que de fato verifica a lógica mais difícil deste lab, não os testes de acordo mais simples que passam mesmo com um caminho de reparo sutilmente quebrado.

## Resumo

Este lab transforma a prova de regra de maioria de `raft-log-replication-and-commitment` em RPCs AppendEntries funcionais, rastreamento de `nextIndex` por seguidor, e uma checagem de consistência com retrocesso de reparo, correspondendo ao Lab 3B do MIT 6.5840, com a restrição de termo atual da regra de commit implementada exatamente como a prova de segurança exige em vez do atalho mais simples e inseguro de contagem-de-maioria-independente-de-termo que uma suíte de testes sem mudanças de líder reais poderia não pegar. Desconectar e reconectar seguidores deliberadamente no meio do fluxo, como em `TestFailAgree3B`, é o que de fato força e verifica o caminho de reparo de log que a implementação deste lab existe para acertar.

## Documentation Links

- [MIT 6.5840 — Lab 3: Raft 1](https://pdos.csail.mit.edu/6.824/labs/lab-raft1.html): o lab real ao qual este exercício corresponde, incluindo a sua suíte de testes de replicação de log 3B (TestBasicAgree3B, TestFailAgree3B).
- [Ongaro & Ousterhout — In Search of an Understandable Consensus Algorithm (Raft, USENIX ATC 2014)](https://raft.github.io/raft.pdf): o artigo original que especifica a checagem de consistência de AppendEntries, a otimização de retrocesso e a restrição de commit de termo atual implementadas aqui.
