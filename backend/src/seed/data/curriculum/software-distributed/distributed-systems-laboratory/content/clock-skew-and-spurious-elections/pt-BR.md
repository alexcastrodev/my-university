---
version: 1.0
updatedAt: 2026-09-12
title: "Lab: Deslize de Relógio e Eleições Espúrias"
summary: "O timeout de eleição aleatorizado do Raft é uma resposta direta e prática a um problema específico de relógio físico que este lab torna concreto em vez de teórico: os relógios de máquina reais derivam uns em relação aos outros, então um timeout fixo e idêntico em todo nó deixaria dois seguidores darem timeout e começarem uma eleição no mesmo instante com frequência demais, dividindo votos e estagnando o progresso. Este lab instrumenta a implementação do Lab 3 para injetar deslize de relógio artificial e varrer a janela de aleatorização do timeout de eleição para baixo rumo a zero, medindo, empiricamente, o ponto em que eleições espúrias e desnecessárias começam a dominar e a estabilidade do líder colapsa, transformando os próprios requisitos de timing enunciados do artigo do Raft num número de fato medido, não só lido."
---
## Objetivos de Aprendizagem

- Instrumentar a implementação de `raft-leader-election-implemented` para injetar deslize de relógio artificial entre nós simulados e varrer a janela de aleatorização do timeout de eleição.
- Medir, empiricamente, como a frequência de eleições e a estabilidade do líder se degradam conforme a janela de aleatorização se estreita rumo a um timeout fixo e idêntico.
- Conectar o ponto de ruptura medido aos próprios requisitos de timing enunciados do Raft, e ao tratamento teórico de `distributed-systems-i` sobre o deslize de relógio físico.
- Distinguir uma eleição espúria, disparada só por timing sem nenhuma falha de líder real, de uma legítima, num log experimental registrado.

## Contexto e Motivação

**Sincronização e Deslize de Relógio Físico** de `distributed-systems-i` estabelece, teoricamente, que os relógios de máquina reais rodam em taxas ligeiramente diferentes e não podem ser perfeitamente sincronizados, que é precisamente a realidade física que o timeout de eleição aleatorizado do Raft, já implementado em `raft-leader-election-implemented`, é projetado para tolerar. Este lab não adiciona nova lógica de protocolo; ele instrumenta a implementação existente para tornar essa tolerância mensurável em vez de meramente argumentada, injetando deslize artificial e estreitando a janela de aleatorização até as próprias suposições documentadas do protocolo começarem a ruir.

## Teoria Central

O próprio artigo do Raft enuncia um requisito de timing concreto que este lab é construído para testar diretamente: o tempo de difusão (tempo para enviar um RPC e receber uma resposta) deve ser uma ordem de magnitude menor do que o timeout de eleição, e o timeout de eleição deve ele mesmo ser algumas vezes o tempo de difusão, largo o bastante para que um timeout escolhido aleatoriamente raramente colida com o de outro servidor. O deslize de relógio corrói a margem da qual esse requisito depende: se os relógios de dois servidores derivam o bastante um do outro, os seus tempos de espera *de fato* decorridos, medidos em tempo real de parede em vez do próprio relógio local de cada servidor, podem acabar próximos um do outro mesmo quando os seus valores de timeout locais e aleatorizados foram escolhidos distantes, reintroduzindo o problema de divisão de votos que a aleatorização existe para evitar.

## Exemplos Resolvidos

### Especificação da API

```text
network.SetClockSkew(node string, drift time.Duration) — todo
  timer que este nó agenda dispara `drift` cedo ou tarde em relação ao
  tempo de parede simulado verdadeiro (drift positivo = o relógio do nó roda
  rápido, então os seus timers disparam cedo)

network.SetElectionWindow(min, max time.Duration) — sobrescreve
  a janela de aleatorização padrão de 300-600ms de
  raft-leader-election-implemented para este experimento
```

### Passo 1 — injetar deslize na lógica de timer existente

```go
func (rf *Raft) resetElectionTimer() {
    base := rf.newElectionTimeout() // de raft-leader-election-implemented
    skewed := base - rf.network.ClockSkewFor(rf.me) // relógio rápido -> dispara mais cedo
    rf.electionTimer.Reset(skewed)
}
```

Nenhuma mudança na própria *lógica* de eleição, a regra de concessão de voto de RequestVote, o pipeline de commit, qualquer coisa de labs anteriores, só em quando o próprio timer de cada servidor de fato dispara em relação ao tempo simulado verdadeiro, isolando o deslize de relógio como a única variável que este experimento mede.

### Passo 2 — varrer a janela de aleatorização e registrar os desfechos

```go
func TestElectionStabilityUnderSkew(t *testing.T) {
    windows := []struct{ min, max time.Duration }{
        {300 * time.Millisecond, 600 * time.Millisecond}, // padrão do próprio Raft
        {450 * time.Millisecond, 550 * time.Millisecond}, // mais estreita
        {490 * time.Millisecond, 510 * time.Millisecond}, // ainda mais estreita
        {500 * time.Millisecond, 500 * time.Millisecond}, // fixa: nenhuma aleatorização de forma alguma
    }
    skews := []time.Duration{0, 20 * time.Millisecond, 60 * time.Millisecond}

    for _, w := range windows {
        for _, skew := range skews {
            cfg := MakeConfig(t, 5, net)
            cfg.net.SetElectionWindow(w.min, w.max)
            for i := 0; i < 5; i++ {
                cfg.net.SetClockSkew(cfg.servers[i], skewFor(i, skew))
            }
            electionCount := cfg.runAndCountElections(30 * time.Second)
            t.Logf("window=%v skew=%v -> %d elections in 30s", w, skew, electionCount)
        }
    }
}
```

### Passo 3 — resultados medidos representativos, e o que eles mostram

```text
window=[300ms,600ms]  skew=0    -> 1 eleição em 30s   (baseline: estável)
window=[300ms,600ms]  skew=60ms -> 1 eleição em 30s   (ainda estável: janela
                                                          larga absorve o deslize)
window=[490ms,510ms]  skew=0    -> 3 eleições em 30s  (a janela estreita sozinha
                                                          começa a causar divisões)
window=[490ms,510ms]  skew=60ms -> 11 eleições em 30s (o deslize piora muito:
                                                          os timeouts efetivos agora
                                                          frequentemente coincidem)
window=[500ms,500ms]  skew=any  -> eleições a cada poucos segundos, nenhum líder
                                     estável por mais do que alguns poucos termos
```

O padrão que esses números mostram diretamente é o ponto teórico que `physical-clock-synchronization-and-drift` faz abstratamente: uma janela de aleatorização larga absorve o deslize de relógio realista sem muito custo, mas conforme a janela se estreita, o deslize para de ser um efeito de segunda ordem e começa a dominar, até um timeout fixo e não aleatorizado produzir eleições espúrias quase contínuas independentemente do deslize, exatamente o modo de falha que a seção de Equívocos Comuns de `raft-leader-election-implemented` previu, mas não mediu.

### Passo 4 — identificar uma eleição espúria num log registrado

```text
[Server 2] term 14 -> 15, became candidate (no AppendEntries heard in 502ms)
[Server 2] elected leader, term 15
[Server 4] term 14 -> 15, became candidate (no AppendEntries heard in 498ms)
   -- O próprio timer do Server 4 disparou só 4ms após o do Server 2, apesar de AMBOS
      os servidores terem anteriormente recebido o MESMO heartbeat do mesmo
      líder no mesmo tempo lógico; essa lacuna de 4ms, bem dentro do
      deslize de 60ms injetado desta execução, é por que o experimento de janela estreita
      produz tantas mais eleições do que a baseline.
[Server 4] election fails: Server 2 already collected a majority
```

Essa é uma eleição espúria precisamente porque nenhuma falha de líder real ocorreu, o líder anterior estava vivo e enviando heartbeats normalmente; a eleição foi disparada puramente por dois servidores cujos timeouts efetivos, depois de levar em conta o deslize de relógio injetado, caíram próximos o bastante para ambos dispararem antes de qualquer um receber o próximo heartbeat do outro, ou do líder.

## Equívocos Comuns e Armadilhas

- **"O deslize de relógio é uma preocupação menor e teórica com que os sistemas reais não precisam se preocupar na prática."** Os próprios números medidos deste lab mostram o oposto uma vez que a janela de aleatorização é estreita: deslize da ordem de dezenas de milissegundos, bem dentro do que os relógios de máquina reais e não sincronizados de fato exibem, aumenta mensuravelmente as eleições espúrias, exatamente a consequência prática que `physical-clock-synchronization-and-drift` prevê teoricamente.
- **"Uma janela de timeout de eleição mais estreita é estritamente melhor, já que significa detecção de falha mais rápida."** A detecção mais rápida é trocada diretamente contra a estabilidade, como os dados do Passo 3 mostram: estreitar a janela reduz o tempo de failover num crash de líder genuíno, mas aumenta a taxa de eleições espúrias quando não há falha real de forma alguma, uma troca real e medida, não uma melhoria gratuita.
- **"Este experimento só reconfirma algo já provado; nada novo é aprendido rodando-o."** O próprio requisito de timing do artigo do Raft, tempo de difusão uma ordem de magnitude abaixo do timeout de eleição, é enunciado como uma diretriz, não uma prova com um ponto de ruptura numérico exato; a varredura deste lab é o que transforma essa diretriz numa curva de fato medida para esta implementação e simulador específicos.

## Resumo

Este lab instrumenta a lógica de timer existente de `raft-leader-election-implemented` para injetar deslize de relógio artificial e varrer a janela de aleatorização do timeout de eleição, sem mudar nenhuma lógica de protocolo, transformando o argumento teórico de `physical-clock-synchronization-and-drift`, de que uma janela de aleatorização larga é o que torna o Raft tolerante ao deslize de relógio realista, numa curva medida mostrando exatamente como a frequência de eleições espúrias sobe conforme essa janela se estreita e o deslize cresce. Um timeout fixo e não aleatorizado, o caso degenerado numa ponta dessa varredura, produz de forma confiável eleições espúrias quase contínuas, confirmando empiricamente o que a própria seção de Equívocos Comuns de `raft-leader-election-implemented` enunciou como uma afirmação sem medição.

## Documentation Links

- [Ongaro & Ousterhout — In Search of an Understandable Consensus Algorithm (Raft, USENIX ATC 2014)](https://raft.github.io/raft.pdf): a fonte da razão tempo-de-difusão-para-timeout-de-eleição que a varredura deste lab testa diretamente contra dados medidos.
- [Lamport — Time, Clocks, and the Ordering of Events in a Distributed System (CACM 1978)](https://lamport.azurewebsites.net/pubs/time-clocks.pdf): o tratamento fundacional de por que os relógios físicos não podem ser perfeitamente sincronizados, o fenômeno de mundo real que o deslize injetado deste lab simula.
