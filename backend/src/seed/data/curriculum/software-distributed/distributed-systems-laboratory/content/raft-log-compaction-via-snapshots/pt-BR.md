---
version: 1.0
updatedAt: 2026-09-12
title: "Lab: Compactação de Log do Raft por Snapshots"
summary: "Um log Raft sempre crescente e nunca truncado é uma falha real e prática esperando para acontecer, não só uma ineficiência, já que um seguidor que fica suficientemente para trás eventualmente não consegue se atualizar reproduzindo um log grande demais para segurar em memória ou reproduzir em tempo razoável; este lab implementa snapshotting periódico e o RPC InstallSnapshot que deixa um seguidor muito atrasado saltar direto para um estado recente em vez disso, correspondendo ao Lab 3D do MIT 6.5840, testado privando deliberadamente um seguidor de AppendEntries por tempo suficiente para que só um snapshot, não a replicação de log comum, consiga trazê-lo em dia de novo."
---
## Objetivos de Aprendizagem

- Explicar por que um log Raft ilimitado e nunca truncado é um modo de falha real e prático, não meramente uma ineficiência, para um seguidor que fica muito para trás.
- Implementar o snapshotting periódico que deixa um servidor descartar entradas de log já refletidas num snapshot de estado salvo.
- Implementar o RPC InstallSnapshot que deixa o líder trazer um seguidor muito atrasado em dia numa transferência em vez de reproduzir toda a sua história perdida.
- Verificar, privando deliberadamente um seguidor de AppendEntries por tempo suficiente para que a replicação de log comum não pudesse plausivelmente atualizá-lo, que só uma transferência de snapshot o restaura corretamente.

## Contexto e Motivação

`raft-persistence-and-crash-recovery` estabeleceu que o log de um servidor tem de persistir por completo para sobreviver a um crash com segurança. Deixado sem resolver, isso cria um custo real e crescente: o log de um cluster de longa duração cresce sem limite, e um seguidor que ficou desconectado, ou simplesmente lento, por tempo suficiente enfrenta reproduzir uma história enorme só para se atualizar, um trabalho cujo custo cresce com quanto tempo a divergência durou em vez de permanecer limitado. Este lab, correspondendo ao Lab 3D do MIT 6.5840, implementa o conserto: compactar periodicamente o log num snapshot, e uma transferência direta de snapshot para um seguidor atrasado demais para se atualizar de qualquer outra forma.

## Teoria Central

Um snapshot é uma representação compacta do estado do serviço num índice de log específico e já com commit, tudo o que é necessário para reconstruir aquele estado, sem precisar de nenhuma entrada de log naquele índice ou antes dele. Uma vez que um snapshot existe no índice `X`, toda entrada de log naquele índice ou antes dele é redundante, o seu efeito já está capturado no snapshot, e pode ser descartada com segurança. `InstallSnapshot`, enviado quando o `nextIndex` de um líder para um seguidor cai naquela entrada de log mais antiga restante do próprio líder ou antes dela, transfere o snapshot diretamente em vez de tentar reproduzir entradas de log que não existem mais do próprio lado do líder.

## Exemplos Resolvidos

### Especificação da API

```text
Snapshot(index int, snapshotData []byte)  — chamado pelo SERVIÇO
  (a camada KV construída em a-linearizable-replicated-kv-store-on-raft)
  uma vez que ele sabe que as entradas até `index` são seguras de descartar.

InstallSnapshotArgs  { Term, LeaderId, LastIncludedIndex,
                        LastIncludedTerm, Data }
InstallSnapshotReply { Term }
```

### Passo 1 — descartar o prefixo do log num snapshot

```go
func (rf *Raft) Snapshot(index int, snapshotData []byte) {
    rf.mu.Lock()
    defer rf.mu.Unlock()

    if index <= rf.lastIncludedIndex {
        return // já compactado pelo menos até aqui; nada a fazer
    }
    newLog := rf.log[index-rf.lastIncludedIndex:] // manter só entradas APÓS index
    rf.lastIncludedTerm = rf.log[index-rf.lastIncludedIndex].Term
    rf.lastIncludedIndex = index
    rf.log = newLog
    rf.persister.Save(rf.encodeState(), snapshotData) // atômico com o truncamento do log
}
```

Salvar o log truncado e os dados do snapshot juntos, numa chamada atômica, importa diretamente: persistí-los separadamente deixa uma janela real onde um crash entre as duas escritas produz um servidor cujo log e snapshot discordam sobre que estado o índice `lastIncludedIndex` de fato reflete, um bug de correção real e silencioso que os testes deste lab são construídos para pegar.

### Passo 2 — o líder decidindo quando enviar um snapshot em vez de entradas

```go
func (rf *Raft) replicateTo(peer int) {
    rf.mu.Lock()
    if rf.nextIndex[peer] <= rf.lastIncludedIndex {
        // O seguidor precisa de entradas que o próprio líder não tem mais;
        // só uma transferência de snapshot consegue trazê-lo em dia.
        args := &InstallSnapshotArgs{
            Term: rf.currentTerm, LeaderId: rf.me,
            LastIncludedIndex: rf.lastIncludedIndex,
            LastIncludedTerm:  rf.lastIncludedTerm,
            Data:              rf.persister.ReadSnapshot(),
        }
        rf.mu.Unlock()
        rf.sendInstallSnapshot(peer, args)
        return
    }
    rf.mu.Unlock()
    rf.sendAppendEntries(peer) // caminho comum, de raft-log-replication-and-commitment-implemented
}
```

### Passo 3 — o seguidor aplicando um snapshot instalado

```go
func (rf *Raft) InstallSnapshot(args *InstallSnapshotArgs, reply *InstallSnapshotReply) {
    rf.mu.Lock()
    if args.Term < rf.currentTerm {
        reply.Term = rf.currentTerm
        rf.mu.Unlock()
        return
    }
    rf.log = []LogEntry{{Term: args.LastIncludedTerm}} // descarta tudo;
                                                          // o snapshot o suplanta
    rf.lastIncludedIndex, rf.lastIncludedTerm = args.LastIncludedIndex, args.LastIncludedTerm
    rf.persister.Save(rf.encodeState(), args.Data)
    rf.mu.Unlock()

    rf.applyCh <- ApplyMsg{SnapshotValid: true, Snapshot: args.Data, SnapshotIndex: args.LastIncludedIndex}
}
```

### Passo 4 — um teste que força uma transferência de snapshot, não uma atualização comum

```go
func TestSnapshotBasic3D(t *testing.T) {
    cfg := MakeConfig(t, 3, net)
    victim := (cfg.checkOneLeader() + 1) % 3
    cfg.disconnect(victim)

    for i := 0; i < 50; i++ {
        cfg.one(i, 2) // mais 50 commits no lado majoritário
        // Cada chamada Snapshot() na maioria descarta mais do log,
        // então quando `victim` reconecta, o líder não TEM mais
        // as entradas que `victim` está perdendo.
    }

    cfg.connect(victim)
    cfg.one(999, 3) // victim tem de se atualizar via InstallSnapshot, depois concordar
}
```

## Equívocos Comuns e Armadilhas

- **"Um log ilimitado é só um problema de eficiência de memória, não de correção."** Para um seguidor desconectado por tempo suficiente, uma vez que o líder já descartou as entradas de que aquele seguidor precisa, o AppendEntries comum genuinamente não consegue atualizá-lo de forma alguma; sem o InstallSnapshot, aquele seguidor fica travado permanentemente, o que é uma falha de disponibilidade real, não meramente memória desperdiçada.
- **"Truncar o log e salvar o snapshot podem acontecer como dois passos separados."** Um crash entre os dois deixa um servidor cujo log persistido e snapshot persistido descrevem estados inconsistentes; a única chamada atômica `persister.Save` do Passo 1 cobrindo ambos é o que a própria disciplina de persistência deste lab, estabelecida em `raft-persistence-and-crash-recovery`, exige aqui também.
- **"Testar a instalação de snapshot só significa chamar InstallSnapshot diretamente num teste unitário."** A abordagem de `TestSnapshotBasic3D`, desconectar um seguidor e conduzir commits reais suficientes para que o próprio log do líder genuinamente não alcance mais tão atrás, é o que de fato força a lógica de `replicateTo` do líder a escolher o caminho do InstallSnapshot ela mesma, em vez de testar o handler de RPC em isolamento da decisão que o dispara.

## Resumo

Um log Raft ilimitado é uma falha de disponibilidade real esperando para acontecer para qualquer seguidor que fica para trás por tempo suficiente para que as entradas de que ele precisa já tenham sido suplantadas em outro lugar; este lab implementa o snapshotting periódico, descartando entradas de log que um snapshot já tornou redundantes, e o RPC InstallSnapshot que transfere um snapshot diretamente a um seguidor atrasado demais para a replicação de log comum ajudar, correspondendo ao Lab 3D do MIT 6.5840. Salvar um log truncado e o seu snapshot correspondente atomicamente, e testar a lógica deste lab forçando genuinamente o líder a descartar entradas de que um seguidor desconectado ainda precisa, são o que de fato verifica a implementação deste lab em vez de exercitar só o seu caminho mais fácil, sem divergência real.

## Documentation Links

- [MIT 6.5840 — Lab 3: Raft 1](https://pdos.csail.mit.edu/6.824/labs/lab-raft1.html): o lab real ao qual este exercício corresponde, incluindo a sua suíte de testes de snapshotting 3D (TestSnapshotBasic3D, TestSnapshotInstall3D).
- [Ongaro & Ousterhout — In Search of an Understandable Consensus Algorithm (Raft, USENIX ATC 2014)](https://raft.github.io/raft.pdf): a seção de compactação de log do artigo original que especifica o RPC InstallSnapshot implementado aqui.
