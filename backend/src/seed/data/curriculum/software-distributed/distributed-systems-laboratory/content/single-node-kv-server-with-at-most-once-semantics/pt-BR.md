---
version: 1.0
updatedAt: 2026-09-12
title: "Lab: Servidor KV de Nó Único com Semântica At-Most-Once"
summary: "Antes de a replicação sequer entrar em cena, este lab constrói um servidor chave-valor Put/Get/Append de nó único sobre o próprio transporte não confiável do Lab 1, e imediatamente confronta o problema concreto que esse transporte cria: um cliente cuja resposta de RPC foi perdida não consegue dizer se a sua requisição nunca chegou ou chegou e teve sucesso, então ele tenta de novo, e um servidor ingênuo executa essa escrita retentada duas vezes. Implementar detecção de duplicatas (um ID de cliente e de requisição carimbado em todo RPC, uma tabela do lado do servidor lembrando quais IDs já foram aplicados) é o que de fato transforma \"entrega at-least-once de uma rede não confiável\" na garantia de execução at-most-once na qual o código do cliente pode confiar com segurança."
---
## Objetivos de Aprendizagem

- Implementar um servidor chave-valor Put/Append/Get de nó único sobre o transporte não confiável do Lab 1.
- Implementar a lógica de retentativa do lado do cliente que reenvia uma requisição quando `Call` retorna false, e explicar por que isso sozinho reintroduz um bug de execução duplicada.
- Implementar a detecção de duplicatas do lado do servidor usando um ID de cliente e um ID de requisição monotonicamente crescente, e verificar que ela corretamente suprime um Put reexecutado enquanto ainda permite um legitimamente novo.
- Projetar um teste que force a corrida exata que este lab existe para fechar: uma resposta perdida depois de um Put já ter sido aplicado, seguida de uma retentativa do cliente.

## Contexto e Motivação

**Semântica At-Least-Once, At-Most-Once e Exactly-Once** de `distributed-systems-i` já traçou a distinção teórica que este lab torna concreta: uma rede não confiável naturalmente dá entrega at-least-once (um cliente que não recebe uma resposta simplesmente tenta de novo, então uma requisição pode chegar e ser processada mais de uma vez), e transformar isso na garantia de execução at-most-once que o código de aplicação de fato quer exige contabilidade deliberada e explícita, não algo que um protocolo de rede forneça de graça. Este lab constrói um servidor chave-valor real especificamente para forçar essa lacuna teórica num bug concreto e reproduzível, depois a fecha.

Este lab também importa como pré-requisito para o capstone posterior da disciplina: `a-linearizable-replicated-kv-store-on-raft` reusa esta exata interface Put/Append/Get e a sua lógica de detecção de duplicatas, substituindo só o armazenamento de nó único por baixo por um log completo replicado por Raft.

## Teoria Central

Nada sobre *por que* a semântica at-most-once exige estado explícito é rederivado aqui, esse argumento já existe em `at-least-once-at-most-once-and-exactly-once-semantics`; este lab é a disciplina de transformá-lo em código funcional. Dois pedaços de estado o tornam concreto: um identificador de requisição anexado a toda chamada de cliente, único por cliente e monotonicamente crescente, e uma tabela do lado do servidor lembrando, por cliente, o ID de requisição mais alto já aplicado e qual resultado ele produziu.

## Exemplos Resolvidos

### Especificação da API

```text
Client.Put(key, value string)
Client.Append(key, value string)   // anexa value ao valor existente
Client.Get(key string) string      // retorna "" se a chave não existe

Todo RPC enviado pelo cliente inclui um ClientId fixo (um int64 aleatório
gerado uma vez, na criação do cliente) e um RequestId (incrementado antes
de cada nova chamada, incluindo retentativas da MESMA requisição lógica, que
reusam o MESMO RequestId da tentativa original).
```

### Passo 1 — a versão ingênua, e o seu bug

```go
func (kv *KVServer) Put(args *PutArgs, reply *PutReply) {
    kv.mu.Lock()
    defer kv.mu.Unlock()
    kv.data[args.Key] = args.Value
}
```

```go
func (c *Client) Put(key, value string) {
    args := &PutArgs{Key: key, Value: value, ClientId: c.id, RequestId: c.nextReqId()}
    for {
        var reply PutReply
        if c.Call("KVServer.Put", args, &reply) {
            return
        }
        // Call retornou false: tentar de novo com os MESMOS args, incluindo o
        // MESMO RequestId, já que esta é uma retentativa da mesma requisição
        // lógica, não uma nova.
    }
}
```

Rodado contra o simulador do Lab 1 com `SetUnreliable(0.3)`, esse par de funções falha num teste muito específico e real: forçar um cenário onde o servidor de fato aplica um `Put`, mas a resposta é descartada no caminho de volta (um desfecho real e comum uma vez que `SetUnreliable` é diferente de zero). O cliente vê `Call` retornar `false`, tenta de novo com argumentos idênticos, e o servidor ingênuo acima aplica o mesmo `Put` uma segunda vez. Para um `Put` simples, isso por acaso é inofensivo, já que a segunda escrita idêntica é um no-op em efeito, mas o mesmo padrão ingênuo aplicado a `Append` corrompe o valor, anexando o mesmo texto duas vezes.

### Passo 2 — detecção de duplicatas do lado do servidor

```go
type opResult struct {
    RequestId int64
    Value     string // para Get/Append, o valor a retornar numa retentativa
}

type KVServer struct {
    mu      sync.Mutex
    data    map[string]string
    lastOp  map[int64]opResult // ClientId -> op aplicada mais recente
}

func (kv *KVServer) Append(args *AppendArgs, reply *AppendReply) {
    kv.mu.Lock()
    defer kv.mu.Unlock()

    if last, ok := kv.lastOp[args.ClientId]; ok && last.RequestId == args.RequestId {
        // Esta requisição exata já foi aplicada; a resposta foi o que
        // foi perdido, não o efeito da requisição. Retorne o MESMO resultado
        // sem reaplicar o append.
        reply.Value = last.Value
        return
    }

    kv.data[args.Key] += args.Value
    kv.lastOp[args.ClientId] = opResult{RequestId: args.RequestId, Value: kv.data[args.Key]}
    reply.Value = kv.data[args.Key]
}
```

A checagem contra `lastOp` é o que de fato fecha a lacuna: uma requisição retentada com um `RequestId` já registrado é reconhecida como "já aplicada", e o servidor reproduz o resultado previamente computado em vez de reexecutar a operação, que é o que corretamente transforma a entrega at-least-once da rede na execução at-most-once de que o cliente de fato precisa.

### Passo 3 — um teste que força a corrida, não só torce por ela

```go
func TestDuplicateAppendSuppressed(t *testing.T) {
    net := MakeNetwork()
    net.SetUnreliable(0.0) // determinístico para esta checagem específica
    kv := StartKVServer(net)
    c := MakeClient(net)

    c.Append("x", "a")
    // Simular manualmente uma resposta perdida: chamar o servidor diretamente com o
    // MESMO RequestId uma segunda vez, exatamente o que o próprio laço de retentativa
    // do cliente produziria após uma resposta descartada.
    kv.Append(&AppendArgs{Key: "x", Value: "a", ClientId: c.id, RequestId: c.lastReqId}, &AppendReply{})

    if got := c.Get("x"); got != "a" {
        t.Fatalf("expected \"a\" (duplicate suppressed), got %q", got)
    }
}
```

## Equívocos Comuns e Armadilhas

- **"Tentar um RPC de novo numa falha é, ele mesmo, o bug."** Tentar de novo é o comportamento correto e necessário do cliente dada uma rede não confiável; o bug é um servidor que não tem como distinguir uma requisição genuinamente nova de uma retentativa de uma que já aplicou. O conserto vive do lado do servidor, não em evitar retentativas do lado do cliente.
- **"Um Put é idempotente por natureza, então a detecção de duplicatas não importa para ele."** Um `Put` simples e incondicional por acaso tolera a reaplicação de forma inofensiva, mas `Append` não, e um servidor construído para tratar só o caso fácil e idempotente silenciosamente corrompe o estado no momento em que uma operação não idempotente é adicionada.
- **"Testar isto com `SetUnreliable` e torcer para a corrida ocorrer eventualmente é suficiente."** Um teste probabilístico pode passar por sorte sem o bug subjacente ser consertado; a reprodução direta e manual do Passo 3 de uma requisição com um `RequestId` reusado força o cenário exato deterministicamente, que é o que de fato verifica o conserto em vez de meramente deixar de observar o bug numa execução.

## Resumo

Este lab transforma a distinção teórica de `at-least-once-at-most-once-and-exactly-once-semantics` num bug concreto e reproduzível e no seu conserto: um cliente que tenta de novo numa rede não confiável naturalmente produz entrega at-least-once, que silenciosamente corrompe uma operação não idempotente como `Append` a menos que o servidor explicitamente rastreie, por cliente, quais IDs de requisição já foram aplicados e qual resultado produziram. Esta exata interface Put/Append/Get e a sua lógica de detecção de duplicatas é reusada sem modificação em `a-linearizable-replicated-kv-store-on-raft`, onde o armazenamento de nó único por baixo é substituído por um log completo replicado por Raft.

## Documentation Links

- [MIT 6.5840 — Lab 2: Key/Value Server 1](https://pdos.csail.mit.edu/6.824/labs/lab-kvsrv1.html): o lab real no qual este exercício é modelado, incluindo o seu próprio requisito de correção de detecção de duplicatas.
- [Birrell & Nelson — Implementing Remote Procedure Calls (1984)](http://www.bitsavers.org/pdf/xerox/parc/techReports/CSL-83-7_Implementing_Remote_Procedure_Calls.pdf): a fonte original da distinção at-least-once-versus-at-most-once que este lab torna concreta.
