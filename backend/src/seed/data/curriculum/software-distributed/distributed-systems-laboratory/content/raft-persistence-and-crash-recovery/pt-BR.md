---
version: 1.0
updatedAt: 2026-09-12
title: "Lab: Persistência e Recuperação de Crash do Raft"
summary: "Um servidor Raft que perde o seu termo, voto e log no instante em que falha pode votar duas vezes no mesmo termo após reiniciar, violando silenciosamente a propriedade de segurança de um-voto-por-termo da qual todo este protocolo depende; este lab implementa a persistência de exatamente o estado que o próprio argumento de segurança do Raft exige que seja durável, e o seu teste real é um ciclo deliberado e repetido de matar todo servidor do cluster simultaneamente (uma falha de energia total, não só o crash de um nó) e confirmar que o sistema inteiro retoma corretamente a partir do disco, correspondendo ao Lab 3C do MIT 6.5840."
---
## Objetivos de Aprendizagem

- Identificar exatamente quais pedaços do estado do Raft têm de ser duráveis por um crash para que as propriedades de segurança do protocolo se mantenham, e quais pedaços podem com segurança ser perdidos.
- Implementar a persistência desse estado usando uma chamada simples e síncrona de salvar-em-disco disparada em toda mudança de estado que a exige.
- Implementar a recuperação no reinício que reconstrói um servidor em memória a partir do estado persistido em vez de começar do zero.
- Verificar a correção sob uma falha de energia total, todo servidor do cluster falhando e reiniciando de uma vez, não só o crash de um único nó.

## Contexto e Motivação

O próprio `crash-faults-vs-byzantine-faults` de `distributed-systems-i` estabelece as falhas por crash, um servidor parando e possivelmente reiniciando com o seu estado anterior intacto, como o modelo de falha contra o qual o Raft é projetado. Esse modelo tem uma suposição oculta que este lab torna explícita: ele assume que o estado anterior de um servidor reiniciado de fato sobreviveu ao crash. Um servidor que reinicia com um `currentTerm` e `votedFor` em branco pode conceder um segundo voto conflitante num termo em que já votou antes de falhar, violando diretamente a regra de um-voto-por-termo da qual `raft-leader-election-implemented` depende. Este lab, correspondendo ao Lab 3C do MIT 6.5840, fecha essa lacuna.

## Teoria Central

Nem todo pedaço do estado de um servidor Raft precisa sobreviver a um crash, só os pedaços dos quais o argumento de segurança do protocolo de fato depende serem duráveis. `currentTerm` e `votedFor` têm de persistir, porque perdê-los deixa um servidor reiniciado violar o um-voto-por-termo. O log tem de persistir, porque perder entradas com commit viola a durabilidade que um cliente já foi dito que uma escrita com commit tem. `commitIndex`, `nextIndex` e `matchIndex`, em contraste, são reconstruíveis com segurança, um servidor reiniciado pode com segurança começar com um `commitIndex` conservador de 0 e recomputar o resto por meio de trocas comuns de AppendEntries, exatamente o tipo de comportamento de autocura que a checagem de consistência de `raft-log-replication-and-commitment-implemented` já fornece.

## Exemplos Resolvidos

### Especificação da API

```text
Interface Persister (fornecida, simulando um disco real):
  Save(raftState []byte, snapshot []byte)
  ReadRaftState() []byte

Um servidor Raft chama persist() de forma síncrona, antes de retornar de qualquer
handler de RPC, sempre que currentTerm, votedFor ou o log mudam.
```

### Passo 1 — o que é serializado, e o que não é

```go
func (rf *Raft) persist() {
    w := new(bytes.Buffer)
    e := gob.NewEncoder(w)
    e.Encode(rf.currentTerm)
    e.Encode(rf.votedFor)
    e.Encode(rf.log)
    // Deliberadamente NÃO persistidos: commitIndex, nextIndex, matchIndex,
    // e qual par (se houver) este servidor atualmente acredita ser líder.
    // Todos são reconstruídos com segurança após o reinício; persisti-los só
    // custaria I/O de disco em todo heartbeat sem benefício de segurança.
    rf.persister.Save(w.Bytes(), rf.persister.ReadSnapshot())
}
```

### Passo 2 — chamar persist exatamente nos pontos certos

```go
func (rf *Raft) RequestVote(args *RequestVoteArgs, reply *RequestVoteReply) {
    rf.mu.Lock()
    defer rf.mu.Unlock()
    // ... lógica de concessão de voto de raft-leader-election-implemented ...
    if voteGranted {
        rf.votedFor = args.CandidateId
        rf.persist() // TEM de persistir antes de a resposta ser enviada, não depois
    }
}
```

O comentário acima enuncia a fonte individual mais comum deste lab de um bug sutil e difícil de disparar: persistir *depois* de responder, ou num timer de fundo, deixa uma janela real onde um servidor concede um voto, responde, falha antes de a escrita alcançar o disco, e reinicia tendo esquecido o voto que já disse a um candidato que concedeu, silenciosamente reabrindo o exato bug de voto duplo que a persistência existe para fechar.

### Passo 3 — recuperação no reinício

```go
func Make(peers []*ClientEnd, me int, persister *Persister) *Raft {
    rf := &Raft{peers: peers, me: me, persister: persister}
    rf.readPersist(persister.ReadRaftState())
    if rf.log == nil {
        rf.log = []LogEntry{{Term: 0}} // início fresco: entrada sentinela
    }
    rf.commitIndex, rf.lastApplied = 0, 0 // deliberadamente NÃO restaurados;
                                            // reconstruídos com segurança via AppendEntries
    go rf.electionTimerLoop()
    return rf
}
```

### Passo 4 — um teste que força uma falha de energia total, não só o crash de um nó

```go
func TestPersist13C(t *testing.T) {
    cfg := MakeConfig(t, 3, net)
    cfg.one(11, 3)

    for i := 0; i < 3; i++ {
        cfg.crash(i) // simula perda de energia: estado sumido da memória
    }
    for i := 0; i < 3; i++ {
        cfg.restart(i) // reconstrói cada servidor via Make(), lendo o disco
    }

    cfg.one(12, 3) // o cluster tem de ainda alcançar o acordo corretamente
}
```

Falhar todo servidor simultaneamente, não só um, é deliberado: isso força o caminho de recuperação de todo servidor, não só de uma minoria que de outra forma poderia se apoiar em pares já corretos, e é o mais perto que o simulador deste lab chega de uma falha de energia real de cluster inteiro.

## Equívocos Comuns e Armadilhas

- **"Persistir num timer de fundo a cada poucas centenas de milissegundos é perto o bastante."** A janela entre uma mudança de estado e o próximo tique do timer é exatamente onde um crash pode perder um voto ou uma entrada de log que o servidor já disse a um par que tinha registrado; a garantia de segurança de `raft-leader-election-implemented` depende de a persistência acontecer de forma síncrona, antes de o handler de RPC que mudou o estado retornar.
- **"commitIndex deveria ser persistido também, já que rastreia um progresso importante."** É seguro, e mais barato, reconstruir: o `commitIndex` conservador de 0 de um servidor reiniciado é corrigido rapidamente por meio de AppendEntries comum do líder atual, pelo exato mecanismo que `raft-log-replication-and-commitment-implemented` já implementa; persisti-lo adiciona I/O de disco em todo commit sem nenhuma segurança que a análise de estado deste lab mostre ser de fato necessária.
- **"Testar o crash e reinício de um único servidor é suficiente para confiar na persistência."** Um teste de crash de nó único pode passar mesmo com lógica de persistência sutilmente errada, já que os outros servidores ainda vivos conseguem mascarar o bug; o crash simultâneo do cluster inteiro de `TestPersist13C` remove essa rede de segurança e é o que de fato verifica a correção da recuperação.

## Resumo

Este lab identifica exatamente qual estado do Raft, `currentTerm`, `votedFor` e o log, tem de sobreviver a um crash para que as garantias de um-voto-por-termo e de durabilidade de log do protocolo se mantenham, e implementa a persistência síncrona de exatamente esse estado, disparada antes de qualquer resposta de RPC que dependeu da mudança ser enviada, correspondendo ao Lab 3C do MIT 6.5840. Testar a recuperação sob um crash simultâneo de todo servidor do cluster, não só de um nó, é o que de fato força e verifica o caminho de recuperação de todo servidor, já que um teste de crash de nó único pode passar mesmo com uma implementação de persistência sutilmente quebrada que os pares sobreviventes por acaso mascaram.

## Documentation Links

- [MIT 6.5840 — Lab 3: Raft 1](https://pdos.csail.mit.edu/6.824/labs/lab-raft1.html): o lab real ao qual este exercício corresponde, incluindo a sua suíte de testes de persistência 3C (TestPersist13C, TestFigure83C).
- [Ongaro & Ousterhout — In Search of an Understandable Consensus Algorithm (Raft, USENIX ATC 2014)](https://raft.github.io/raft.pdf): o artigo original que especifica exatamente qual estado o Raft exige que seja persistido antes de responder a RPCs.
