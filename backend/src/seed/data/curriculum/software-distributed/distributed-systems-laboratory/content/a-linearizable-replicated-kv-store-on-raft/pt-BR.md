---
version: 1.0
updatedAt: 2026-09-12
title: "Lab: Uma Store KV Replicada Linearizável sobre Raft"
summary: "Este lab é onde \"o banco replicado\" para o qual esta disciplina é nomeada de fato é construído: o serviço chave-valor Put/Get/Append do Lab 2 reconstruído sobre a implementação completa de Raft dos Labs 3-6, de modo que toda escrita passa por commit no log antes de ser aplicada e toda leitura reflete o último estado com commit, correspondendo ao Lab 4 do MIT 6.5840 por completo, incluindo a sua barra de correção de fato, a linearizabilidade verificada sob clientes concorrentes aleatorizados, crashes de servidor e partições tudo na mesma execução de teste, não meramente a correção sob o caso fácil de nenhuma concorrência e nenhuma falha."
---
## Objetivos de Aprendizagem

- Reconstruir a interface Put/Append/Get do Lab 2 sobre a implementação completa de Raft dos Labs 3-6, roteando toda escrita pelo log replicado antes de aplicá-la.
- Implementar a lógica do lado do cliente que encontra o líder atual, incluindo tratar um líder em cache obsoleto e tentar de novo contra um servidor diferente.
- Combinar a tabela de detecção de duplicatas do Lab 2 com o pipeline de commit do Raft para que uma requisição seja aplicada no máximo uma vez mesmo após uma mudança de líder no meio da requisição.
- Verificar a linearizabilidade diretamente, usando um verificador em vez de olhar a saída a olho, contra uma carga de trabalho rodada sob clientes concorrentes, crashes e partições simultaneamente.

## Contexto e Motivação

Este é o lab para o qual toda esta disciplina é nomeada: "o banco replicado" com que a própria descrição de uma linha de tasks.md desta disciplina abre. Todo lab anterior foi uma peça pré-requisito: o simulador do Lab 1, a semântica de detecção de duplicatas do Lab 2, a implementação completa de Raft dos Labs 3 a 6. Este lab os monta numa store chave-valor replicada real, correspondendo ao Lab 4 do MIT 6.5840 por completo, e se segura à barra de correção de fato daquele lab: a linearizabilidade, a própria garantia rigorosamente definida de `distributed-systems-i`, verificada sob concorrência e falha simultaneamente, não meramente a correção no caso fácil, sequencial, sem falha.

## Teoria Central

**A Abordagem de Máquina de Estado Replicada** de `distributed-systems-i` já estabelece a arquitetura que este lab implementa diretamente: uma máquina de estado determinística (aqui, o mapa `data` da store KV), alimentada com uma única sequência de operações acordada por consenso, produz estado idêntico em toda réplica. O trabalho inteiro deste lab é ligar o serviço KV de `single-node-kv-server-with-at-most-once-semantics` para consumir essa sequência acordada do pipeline de commit do Raft, em vez de aplicar operações diretamente ao seu próprio estado local no instante em que uma requisição chega.

## Exemplos Resolvidos

### Especificação da API

Interface voltada ao cliente idêntica à do Lab 2 (`Put`, `Append`, `Get`), mas todo servidor é agora um par Raft, e a requisição de um cliente tem de alcançar qualquer servidor que atualmente segura a liderança Raft; uma requisição enviada a um seguidor é rejeitada, não silenciosamente mal roteada.

### Passo 1 — submeter uma operação de cliente pelo Raft, não aplicá-la diretamente

```go
func (kv *KVServer) Put(args *PutArgs, reply *PutReply) {
    op := Op{Type: "Put", Key: args.Key, Value: args.Value,
              ClientId: args.ClientId, RequestId: args.RequestId}
    index, _, isLeader := kv.rf.Start(op) // submete ao Raft; NÃO aplica ainda
    if !isLeader {
        reply.Err = ErrWrongLeader
        return
    }

    ch := kv.waitChannelFor(index)
    select {
    case appliedOp := <-ch:
        if appliedOp.ClientId != args.ClientId || appliedOp.RequestId != args.RequestId {
            // Uma operação DIFERENTE acabou com commit neste índice,
            // a liderança deste servidor foi perdida e reconquistada, ou uma
            // resposta de RPC obsoleta correu contra uma mais nova. Reporte falha em vez
            // de confirmar falsamente uma escrita que de fato não passou por commit.
            reply.Err = ErrWrongLeader
            return
        }
        reply.Err = OK
    case <-time.After(kv.opTimeout):
        reply.Err = ErrTimeout
    }
}
```

A checagem dentro do `select` é a única linha mais importante deste lab: `Start` retornando um índice é só uma promessa de que a operação *pode* ter commit ali, não uma garantia de que terá, já que uma mudança de líder antes do commit pode deixar uma operação diferente acabar naquele mesmo índice em vez disso. Pular essa checagem é uma fonte real e comum de um cliente silenciosamente acreditar que uma escrita teve sucesso quando uma escrita completamente diferente de fato passou por commit naquela posição do log.

### Passo 2 — aplicar operações com commit, com a detecção de duplicatas do Lab 2 reusada sem modificação

```go
func (kv *KVServer) applyLoop() {
    for msg := range kv.applyCh { // alimentado pelo pipeline de commit do Raft
        op := msg.Command.(Op)
        kv.mu.Lock()
        if last, ok := kv.lastOp[op.ClientId]; !ok || last.RequestId != op.RequestId {
            switch op.Type {
            case "Put":
                kv.data[op.Key] = op.Value
            case "Append":
                kv.data[op.Key] += op.Value
            }
            kv.lastOp[op.ClientId] = opResult{RequestId: op.RequestId, Value: kv.data[op.Key]}
        }
        kv.mu.Unlock()
        kv.notifyWaitChannel(msg.CommandIndex, op)
    }
}
```

Essa é exatamente a tabela de detecção de duplicatas de `single-node-kv-server-with-at-most-once-semantics`, sem modificação, agora consumindo do `applyCh` do Raft em vez de um handler de RPC diretamente, que é precisamente o ponto: o trabalho de correção do lab anterior é reusado, não refeito, aqui.

### Passo 3 — o cliente encontrando, e reencontrando, o líder atual

```go
func (c *Client) Put(key, value string) {
    args := &PutArgs{Key: key, Value: value, ClientId: c.id, RequestId: c.nextReqId()}
    for {
        var reply PutReply
        ok := c.Call(c.servers[c.leaderGuess], "KVServer.Put", args, &reply)
        if ok && reply.Err == OK {
            return
        }
        c.leaderGuess = (c.leaderGuess + 1) % len(c.servers) // chute errado; tentar o próximo servidor
    }
}
```

### Passo 4 — verificar a linearizabilidade, não só "o valor final parece certo"

```go
func TestPersistPartitionUnreliableLinearizable4B(t *testing.T) {
    cfg := MakeConfig(t, 5, net)
    cfg.net.SetUnreliable(0.1)

    var ops []porcupine.Operation // registradas, por cliente, com timestamps reais
    for round := 0; round < 5; round++ {
        cfg.partition(randomMajorityMinoritySplit())
        runConcurrentClients(cfg, &ops) // registra os tempos de chamada/retorno de toda op
        cfg.healPartition()
        cfg.crashOneRandomServer()
        cfg.restartIt()
    }

    if !porcupine.CheckOperations(kvModel, ops) {
        t.Fatal("history is not linearizable")
    }
}
```

`porcupine.CheckOperations` (ou um verificador de linearizabilidade equivalente) está fazendo um trabalho real e necessário aqui que uma checagem mais simples de "ler os valores finais das chaves e ver se parecem plausíveis" não consegue: a linearizabilidade é uma afirmação sobre a *ordenação inteira* de operações sobrepostas por todos os clientes, não só sobre o estado final, e um bug que produz um estado final que por acaso parece correto enquanto ainda viola a linearizabilidade em algum ponto intermediário é exatamente o tipo de bug que a barra de correção de fato deste lab é construída para pegar.

## Equívocos Comuns e Armadilhas

- **"Uma vez que `rf.Start()` retorna um índice, a operação tem commit."** Ela só foi submetida; uma mudança de líder antes de aquela posição do log de fato ter commit pode deixar uma operação completamente diferente acabar ali em vez disso, que é exatamente o que a checagem de identidade pós-espera do Passo 1 existe para detectar.
- **"Aplicar um comando diretamente no líder assim que `Start` é chamado, e pular a espera pelo `applyCh`, está tudo bem já que este servidor é o líder."** Isso aplica uma operação que pode nunca de fato ter commit, por exemplo se o líder é imediatamente particionado para longe antes de replicá-la a uma maioria, produzindo uma divergência de estado de toda outra réplica.
- **"Checar que os pares chave-valor finais batem com as expectativas é suficiente para confirmar a correção."** A linearizabilidade é uma afirmação sobre a ordenação completa de operações concorrentes, não só sobre o estado eventual; um verificador de linearizabilidade real rodado contra uma história de operações registrada, como no Passo 4, pega violações de ordenação que uma checagem só de estado final perderia inteiramente.

## Resumo

Este lab monta todo lab anterior nesta disciplina na store chave-valor replicada para a qual esta disciplina é nomeada: a interface Put/Append/Get e a lógica de detecção de duplicatas do Lab 2, sem modificação, agora alimentadas pela implementação completa de Raft dos Labs 3 a 6, com as requisições de cliente roteadas ao líder atual e confirmadas só uma vez que o próprio pipeline de commit do Raft, não meramente o valor de retorno de `Start`, reporta a operação aplicada. Corresponder ao Lab 4 do MIT 6.5840 por completo significa segurar esta implementação à sua barra de correção real, a linearizabilidade verificada com um verificador real contra clientes concorrentes, crashes e partições rodados simultaneamente, em vez de uma checagem de estado final que uma implementação genuinamente quebrada ainda poderia por acaso passar.

## Documentation Links

- [MIT 6.5840 — Lab 4: KV Raft 1](https://pdos.csail.mit.edu/6.824/labs/lab-kvraft1.html): o lab real ao qual este exercício corresponde, incluindo a sua suíte de testes de linearizabilidade (TestOnePartition4B, TestPersistPartitionUnreliableLinearizable4B).
- [Herlihy & Wing — Linearizability: A Correctness Condition for Concurrent Objects (1990)](https://cs.brown.edu/people/mph/HerlihyW90/p463-herlihy.pdf): o artigo original que define a propriedade de correção que os próprios testes deste lab verificam diretamente contra uma história de operações registrada.
