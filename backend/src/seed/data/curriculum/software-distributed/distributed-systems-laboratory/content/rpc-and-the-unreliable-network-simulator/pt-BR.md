---
version: 1.0
updatedAt: 2026-09-12
title: "Lab: RPC e o Simulador de Rede Não Confiável"
summary: "Todo lab nesta disciplina roda os seus sistemas replicados sobre uma rede simulada, não uma real, e este primeiro lab constrói esse simulador do zero: uma camada de RPC básica mais um transporte que pode ser mandado, sob comando, a atrasar uma mensagem, descartá-la silenciosamente, reordená-la, ou cortar um par específico de nós um do outro inteiramente, a mesma abordagem de simular-primeiro-depois-quebrá-lo que o próprio curso 6.5840 do MIT fornece pronto para os seus estudantes, construído aqui deliberadamente à mão em vez disso para que a sua mecânica de fato, não só a sua API, seja entendida antes de todo lab posterior nesta disciplina depender dele."
---
## Objetivos de Aprendizagem

- Implementar uma camada de RPC mínima que deixa uma goroutine chamar um método em outra como se fosse local, enquanto a chamada de fato cruza uma fronteira de rede simulada.
- Implementar uma camada de transporte injetável capaz de atrasar uma mensagem, descartá-la silenciosamente, reordená-la em relação a outras mensagens, e cortar a comunicação entre um par específico de nós inteiramente.
- Projetar um pequeno arcabouço de experimento que consiga declarar um cenário de rede (quais pares estão particionados, qual é a taxa de descarte) e rodar uma carga de trabalho contra ele de forma repetível.
- Explicar por que todo lab posterior nesta disciplina depende deste simulador em vez de uma rede real, e o que essa dependência compra em troca de desistir de condições de rede reais.

## Contexto e Motivação

As próprias **Chamadas de Procedimento Remoto e a Ilusão de uma Chamada Local** de `distributed-systems-i` já fizeram o caso teórico: o trabalho inteiro de um mecanismo de RPC é fazer uma chamada a outra máquina parecer, do código do chamador, uma chamada de função local comum, enquanto uma realidade muito diferente e muito menos confiável, mensagens que podem ser atrasadas, perdidas, duplicadas ou chegar fora de ordem, fica por baixo dessa ilusão. Este lab não rederiva esse argumento; ele constrói a coisa sobre a qual esse argumento é, para que todo lab posterior que precisa quebrar um cluster Raft ou uma store replicada de propósito tenha uma forma real e controlável de fazê-lo.

O MIT 6.5840, o curso no qual o arco de toda esta disciplina de laboratório é modelado, fornece exatamente esse tipo de simulador, o seu próprio pacote `labrpc`, pronto para os seus estudantes especificamente para que eles possam gastar o seu esforço em lógica de Raft e replicação em vez de em simulação de rede. Este lab faz uma escolha pedagógica deliberada e diferente: construir uma versão simplificada desse mesmo tipo de simulador à mão primeiro, para que a sua mecânica de fato, não só a sua API, seja entendida antes de depender dele como uma caixa-preta por mais oito labs.

## Teoria Central

Este lab se constrói diretamente sobre o próprio modelo de duas partes de `remote-procedure-calls-and-the-illusion-of-a-local-call` de uma chamada RPC: um stub de cliente que empacota argumentos e bloqueia esperando uma resposta, e um despachante do lado do servidor que desempacota uma requisição, invoca o método real e envia o resultado de volta. Nada sobre *por que* o RPC precisa dessa estrutura é rederivado aqui; é usado como teoria já entendida. O que é novo aqui é o transporte por baixo dela, deliberadamente tornado não confiável sob comando em vez de assumido confiável, que é também a fundação de que `at-least-once-at-most-once-and-exactly-once-semantics` precisa, coberto a seguir em `single-node-kv-server-with-at-most-once-semantics`.

**Nota de linguagem**: os labs desta disciplina, começando aqui, usam Go, não o Python usado em `algorithm-laboratory`. Essa é uma escolha deliberada: o MIT 6.5840, o curso real no qual a sequência de labs desta disciplina é modelada, usa Go por toda parte, e as goroutines e canais do Go são um ajuste natural e de baixa cerimônia para o tratamento de RPC concorrente, os timers de fundo e a passagem de mensagens em torno dos quais toda esta disciplina é construída.

## Exemplos Resolvidos

### Especificação da API

```text
Interface Network (do que todo lab posterior depende):

  network.MakePair(from, to string) — declara um par endereçável
  network.Connect(from, to string) — permite mensagens entre o par
  network.Disconnect(from, to string) — simula uma partição: nenhuma
    mensagem em qualquer direção é entregue até reconectar
  network.SetUnreliable(rate float64) — uma fração de mensagens, escolhida
    independentemente por mensagem, é silenciosamente descartada em vez de entregue
  network.SetDelay(min, max time.Duration) — toda mensagem entregue
    é segurada por uma duração aleatória neste intervalo antes de chegar

Client.Call(server, method string, args, reply interface{}) bool —
  retorna false se a rede descarta a requisição ou a resposta
  (indistinguível ao chamador, correspondendo a uma rede real não confiável)
```

### Passo 1 — um servidor que despacha por nome de método

```go
type Server struct {
    mu      sync.Mutex
    methods map[string]reflect.Value // handlers registrados, por nome
}

func (s *Server) Register(name string, handler interface{}) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.methods[name] = reflect.ValueOf(handler)
}

func (s *Server) dispatch(method string, args interface{}) interface{} {
    s.mu.Lock()
    fn, ok := s.methods[method]
    s.mu.Unlock()
    if !ok {
        panic("unregistered RPC method: " + method)
    }
    // Chama o handler registrado com os argumentos decodificados,
    // exatamente como o despachante de um framework de RPC real faria.
    result := fn.Call([]reflect.Value{reflect.ValueOf(args)})
    return result[0].Interface()
}
```

### Passo 2 — uma rede que pode ser mandada a se comportar mal

```go
type Network struct {
    mu           sync.Mutex
    connected    map[string]bool     // chave de par "from->to" -> conectado
    unreliable   float64             // fração de mensagens descartadas
    minDelay     time.Duration
    maxDelay     time.Duration
    servers      map[string]*Server
}

func (n *Network) deliver(from, to, method string, args interface{}) (interface{}, bool) {
    n.mu.Lock()
    connected := n.connected[from+"->"+to]
    drop := rand.Float64() < n.unreliable
    delay := n.minDelay + time.Duration(rand.Int63n(int64(n.maxDelay-n.minDelay+1)))
    server := n.servers[to]
    n.mu.Unlock()

    if !connected || drop {
        return nil, false // partição simulada ou perda de pacote
    }
    time.Sleep(delay) // latência de rede simulada, deliberadamente variável
    return server.dispatch(method, args), true
}
```

As duas linhas que checam `connected` e `drop` são o mecanismo inteiro sobre o qual a injeção de falha de todo lab posterior repousa: `Disconnect` vira um booleano, `SetUnreliable` enviesa um lance de moeda, e todo RPC no sistema, em todo lab posterior, roteia por esta mesma função `deliver` sem nenhum código específico de lab precisar saber como a falha de fato está sendo simulada.

### Passo 3 — um stub de cliente que bloqueia e pode dar timeout

```go
func (c *Client) Call(server, method string, args, reply interface{}) bool {
    resultCh := make(chan struct{ value interface{}; ok bool }, 1)
    go func() {
        v, ok := c.network.deliver(c.name, server, method, args)
        resultCh <- struct{ value interface{}; ok bool }{v, ok}
    }()
    select {
    case res := <-resultCh:
        if res.ok {
            reflect.ValueOf(reply).Elem().Set(reflect.ValueOf(res.value))
        }
        return res.ok
    case <-time.After(c.timeout):
        return false // o chamador não consegue distinguir "descartado" de "só lento"
    }
}
```

Este último ponto vale tornar explícito porque a lógica de detecção de duplicatas e de retentativa de todo lab posterior depende dele: `Call` retornando `false` cobre duas situações reais genuinamente diferentes, a requisição ou a resposta foi de fato descartada, ou ela está simplesmente ainda em voo e lenta, e o código do lado do cliente não tem como dizer qual. Essa não é uma limitação deste simulador específico; é a propriedade de fato, irredutível, das redes reais não confiáveis que este simulador existe para tornar concreta.

### Passo 4 — um cenário de falha repetível

```go
func TestPartitionScenario(t *testing.T) {
    net := MakeNetwork()
    // ... registrar servidores a, b, c ...
    net.SetUnreliable(0.1)
    net.Disconnect("a", "c")
    net.Disconnect("c", "a")
    // Rodar uma carga de trabalho aqui; c agora só consegue alcançar b, não a.
    // A lógica de eleição de líder de um lab posterior é exercitada contra
    // exatamente esse tipo de partição declarada e repetível.
}
```

## Equívocos Comuns e Armadilhas

- **"Um RPC descartado e um RPC lento parecem diferentes ao chamador."** Por design, não parecem; `Call` retornando `false` após um timeout é genuinamente ambíguo entre "a rede o comeu" e "ele ainda está em voo", que é a propriedade real e desconfortável das redes não confiáveis que este simulador é construído especificamente para preservar, não um atalho de implementação.
- **"Simular uma partição só significa descartar todo pacote com alguma probabilidade."** Uma partição é uma falha específica e estrutural, a comunicação entre um par particular de nós é cortada enquanto o resto da rede funciona normalmente, distinta de uma taxa geral e uniforme de perda de pacotes; `Disconnect` e `SetUnreliable` modelam dois modos de falha reais genuinamente diferentes, e os labs posteriores precisam de ambos, controláveis separadamente.
- **"Este simulador é só andaime de teste, não algo que valha entender profundamente."** As afirmações de correção de todo lab posterior, uma partição majoritária progride, uma partição minoritária corretamente estagna, um nó com crash se recupera corretamente, só são tão confiáveis quanto a própria correção deste simulador; um bug aqui invalidaria silenciosamente todo teste construído sobre ele.

## Resumo

Este lab constrói a fundação da qual todo lab posterior nesta disciplina depende: uma camada de RPC implementando o modelo de stub-de-cliente-e-despachante-de-servidor que `remote-procedure-calls-and-the-illusion-of-a-local-call` já cobriu teoricamente, rodando sobre um transporte que pode ser mandado, sob comando, a atrasar, descartar, reordenar ou particionar pares específicos de nós, em Go em vez do Python usado em outros labs desta plataforma, correspondendo ao curso real, o MIT 6.5840, no qual a sequência de labs desta disciplina é modelada. Toda afirmação de correção posterior que esta disciplina faz, sobre a segurança do Raft sob crashes, sobre a linearizabilidade de uma store replicada sob partição, só é tão confiável quanto a própria correção deste simulador, que é exatamente por que ele é construído e entendido primeiro, à mão, em vez de tratado como uma caixa-preta opaca.

## Documentation Links

- [MIT 6.5840 (Distributed Systems) — Course Overview](https://pdos.csail.mit.edu/6.824/index.html): o curso real no qual a sequência de labs desta disciplina é modelada, incluindo o seu próprio simulador `labrpc` do qual este lab constrói uma versão simplificada à mão.
- [Birrell & Nelson — Implementing Remote Procedure Calls (1984)](http://www.bitsavers.org/pdf/xerox/parc/techReports/CSL-83-7_Implementing_Remote_Procedure_Calls.pdf): o artigo original que estabelece o modelo de RPC que a implementação de stub-de-cliente-e-despachante deste lab segue.
